"""Money I owe others, and settling both directions from bank SMS.

- A debt (they paid for me) is recorded but isn't spending yet. Paying it back creates an
  expense linked to the payment, so the money is counted once, when it leaves my account.
- A UPI debit to someone I owe exactly that much (one debt, or all of them together) is matched
  automatically. So is a UPI credit from someone who owes me (their dues are settled, oldest first).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Account, BankTxn, Debt, Expense, Person
from ..money import rupees
from ..schemas import DebtIn, ExpenseIn, PaymentIn, RepayIn, SettlementIn
from ..timeutil import ensure_aware, now_utc
from .dues import open_dues, outstanding, settle
from .expenses import create_expense
from .people import find_or_create_person, learn_alias, match_person


def open_debts(s: Session, user_id: int, person_id: int) -> list[Debt]:
    return list(
        s.scalars(
            select(Debt)
            .where(Debt.user_id == user_id, Debt.person_id == person_id, Debt.status == "open")
            .order_by(Debt.occurred_at, Debt.id)
        )
    )


def create_debt(s: Session, user_id: int, data: DebtIn) -> Debt:
    if data.person_id is not None:
        person = s.scalar(select(Person).where(Person.id == data.person_id, Person.user_id == user_id))
        if person is None:
            raise ApiError(422, "unknown_person", f"Person {data.person_id} doesn't exist")
    else:
        person = find_or_create_person(s, user_id, data.person_name or "")
    debt = Debt(
        user_id=user_id,
        person_id=person.id,
        description=data.description,
        category_id=data.category_id,
        amount_paise=data.amount_paise,
        occurred_at=ensure_aware(data.occurred_at) if data.occurred_at else now_utc(),
        note_raw=data.note_raw,
    )
    s.add(debt)
    s.flush()
    return debt


def repay(
    s: Session,
    user_id: int,
    person: Person,
    amount_paise: int,
    *,
    account_id: int,
    txn: BankTxn | None,
    when: datetime,
    note: str | None = None,
) -> Expense:
    """Settle what I owe `person` with one payment: one debt of exactly that amount, or all of them."""
    debts = open_debts(s, user_id, person.id)
    owed = sum(d.amount_paise for d in debts)
    single = next((d for d in debts if d.amount_paise == amount_paise), None)
    chosen = [single] if single else (debts if debts and owed == amount_paise else [])
    if not chosen:
        raise ApiError(
            422, "repay_mismatch", f"You owe {person.name} {rupees(owed)}, not {rupees(amount_paise)}"
        )
    what = chosen[0].description if len(chosen) == 1 else "what you owed"
    expense = create_expense(
        s,
        user_id,
        ExpenseIn(
            occurred_at=when,
            description=f"{what} · paid back {person.name}"[:200],
            category_id=chosen[0].category_id if len(chosen) == 1 else None,
            payments=[PaymentIn(account_id=account_id, amount_paise=amount_paise, bank_txn_id=txn.id if txn else None)],
            note_raw=note,
        ),
        source="log",
    )
    for debt in chosen:
        debt.status = "settled"
        debt.settled_at = when
        debt.expense_id = expense.id
    s.flush()
    return expense


def repay_from_request(s: Session, user_id: int, data: RepayIn, note: str | None) -> Expense:
    if data.person_id is not None:
        person = s.scalar(select(Person).where(Person.id == data.person_id, Person.user_id == user_id))
    else:
        from .dues import find_person

        person = find_person(s, user_id, data.person_name or "")
    if person is None:
        raise ApiError(422, "unknown_person", f"You don't owe {data.person_name or 'them'} anything")
    txn = None
    if data.bank_txn_id is not None:
        txn = s.scalar(select(BankTxn).where(BankTxn.id == data.bank_txn_id, BankTxn.user_id == user_id))
        if txn is None or txn.direction != "debit":
            raise ApiError(422, "unknown_txn", "Paying someone back has to be money going out")
        account_id = txn.account_id
        when = txn.occurred_at
    else:
        cash = s.scalar(select(Account).where(Account.user_id == user_id, Account.kind == "cash"))
        account_id = data.account_id or (cash.id if cash else None)
        if account_id is None:
            raise ApiError(422, "no_account", "Say which account you paid from")
        when = ensure_aware(data.paid_at) if data.paid_at else now_utc()
    expense = repay(s, user_id, person, data.amount_paise, account_id=account_id, txn=txn, when=when, note=note)
    if txn is not None:
        learn_alias(person, txn.counterparty)  # the next payment to this UPI ID is matched by itself
    return expense


def auto_repay(s: Session, user_id: int, txn: BankTxn) -> dict | None:
    """A UPI debit to someone I owe exactly that much: pay the debt off with it."""
    person = match_person(s, user_id, txn.counterparty)
    if person is None or not open_debts(s, user_id, person.id):
        return None
    try:
        repay(
            s,
            user_id,
            person,
            txn.amount_paise,
            account_id=txn.account_id,
            txn=txn,
            when=txn.occurred_at,
            note="Matched from bank SMS",
        )
    except ApiError:
        return None
    learn_alias(person, txn.counterparty)
    return {"kind": "repaid", "person": person.name, "amount_paise": txn.amount_paise, "txn_id": txn.id}


def auto_payback(s: Session, user_id: int, txn: BankTxn) -> dict | None:
    """A UPI credit from someone who owes me (no more than they owe): settle their dues with it."""
    person = match_person(s, user_id, txn.counterparty)
    if person is None:
        return None
    owed = sum(outstanding(d) for d in open_dues(s, user_id, person.id))
    if owed == 0 or txn.amount_paise > owed:
        return None
    settle(s, user_id, SettlementIn(person_id=person.id, amount_paise=txn.amount_paise, bank_txn_id=txn.id))
    learn_alias(person, txn.counterparty)
    return {"kind": "payback", "person": person.name, "amount_paise": txn.amount_paise, "txn_id": txn.id}


def balances(s: Session, user_id: int) -> dict:
    """Who owes me (open dues) and whom I owe (open debts), per person."""
    from ..models import Due
    from sqlalchemy.orm import selectinload

    owed_to_me: dict[int, dict] = {}
    dues = s.scalars(
        select(Due)
        .join(Expense)
        .where(Expense.user_id == user_id, Due.status == "open")
        .options(selectinload(Due.person), selectinload(Due.settlements), selectinload(Due.expense))
        .order_by(Expense.occurred_at)
    )
    for d in dues:
        left = outstanding(d)
        if left <= 0:
            continue
        row = owed_to_me.setdefault(d.person_id, {"person_id": d.person_id, "name": d.person.name, "amount_paise": 0, "items": []})
        row["amount_paise"] += left
        row["items"].append({"expense_id": d.expense_id, "description": d.expense.description, "amount_paise": left})
    i_owe: dict[int, dict] = {}
    for debt in s.scalars(
        select(Debt).where(Debt.user_id == user_id, Debt.status == "open").order_by(Debt.occurred_at)
    ):
        row = i_owe.setdefault(debt.person_id, {"person_id": debt.person_id, "name": debt.person.name, "amount_paise": 0, "items": []})
        row["amount_paise"] += debt.amount_paise
        row["items"].append({"debt_id": debt.id, "description": debt.description, "amount_paise": debt.amount_paise})
    order = lambda rows: sorted(rows.values(), key=lambda r: -r["amount_paise"])  # noqa: E731
    return {"owed_to_me": order(owed_to_me), "i_owe": order(i_owe)}
