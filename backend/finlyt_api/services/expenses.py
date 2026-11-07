"""Creating, editing and deleting expenses while keeping the money invariants:

- total = sum(payments)
- total = my_share + sum(dues)
- payment legs linked to a bank txn never exceed its amount
- every referenced id belongs to the same user
"""

from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from ..errors import ApiError
from ..models import Account, BankTxn, Category, Due, Expense, ExpensePayment, Person, Settlement
from ..schemas import DueIn, ExpenseIn, ExpensePatch, PaymentIn
from ..timeutil import ensure_aware


def expense_query(user_id: int) -> Select:
    return (
        select(Expense)
        .where(Expense.user_id == user_id)
        .options(
            selectinload(Expense.payments),
            selectinload(Expense.dues).selectinload(Due.person),
            selectinload(Expense.dues).selectinload(Due.settlements),
        )
    )


def get_expense(s: Session, user_id: int, expense_id: int) -> Expense:
    expense = s.scalar(expense_query(user_id).where(Expense.id == expense_id))
    if expense is None:
        raise ApiError(404, "not_found", f"Expense {expense_id} not found")
    return expense


def _check_category(s: Session, user_id: int, category_id: int | None) -> None:
    if category_id is None:
        return
    found = s.scalar(
        select(Category.id).where(Category.id == category_id, Category.user_id == user_id)
    )
    if found is None:
        raise ApiError(422, "unknown_category", f"Category {category_id} doesn't exist")


def _person_for(s: Session, user_id: int, due: DueIn) -> Person:
    if due.person_id is not None:
        person = s.scalar(
            select(Person).where(Person.id == due.person_id, Person.user_id == user_id)
        )
        if person is None:
            raise ApiError(422, "unknown_person", f"Person {due.person_id} doesn't exist")
        return person
    name = " ".join((due.person_name or "").split())
    person = s.scalar(
        select(Person).where(Person.user_id == user_id, func.lower(Person.name) == name.lower())
    )
    if person is None:
        person = Person(user_id=user_id, name=name)
        s.add(person)
        s.flush()
    return person


def _build_dues(s: Session, user_id: int, dues: list[DueIn]) -> list[Due]:
    return [Due(person=_person_for(s, user_id, d), amount_paise=d.amount_paise) for d in dues]


def _build_payments(
    s: Session, user_id: int, payments: list[PaymentIn], *, expense_id: int | None
) -> list[ExpensePayment]:
    account_ids = {p.account_id for p in payments}
    owned = set(
        s.scalars(select(Account.id).where(Account.id.in_(account_ids), Account.user_id == user_id))
    )
    if missing := account_ids - owned:
        raise ApiError(422, "unknown_account", f"Unknown account id(s): {sorted(missing)}")

    wanted: dict[int, int] = {}
    for p in payments:
        if p.bank_txn_id is not None:
            wanted[p.bank_txn_id] = wanted.get(p.bank_txn_id, 0) + p.amount_paise
    for txn_id, amount in wanted.items():
        txn = s.scalar(select(BankTxn).where(BankTxn.id == txn_id, BankTxn.user_id == user_id))
        if txn is None:
            raise ApiError(422, "unknown_txn", f"Bank transaction {txn_id} doesn't exist")
        if txn.direction != "debit":
            raise ApiError(422, "txn_not_debit", f"Bank transaction {txn_id} is money coming in")
        if any(p.bank_txn_id == txn_id and p.account_id != txn.account_id for p in payments):
            raise ApiError(
                422, "txn_account_mismatch", f"Bank transaction {txn_id} is from a different account"
            )
        used = select(func.coalesce(func.sum(ExpensePayment.amount_paise), 0)).where(
            ExpensePayment.bank_txn_id == txn_id
        )
        if expense_id is not None:
            used = used.where(ExpensePayment.expense_id != expense_id)
        if s.scalar(used) + amount > txn.amount_paise:
            raise ApiError(
                422, "txn_overallocated", f"More than bank transaction {txn_id}'s amount is assigned"
            )

    return [
        ExpensePayment(account_id=p.account_id, amount_paise=p.amount_paise, bank_txn_id=p.bank_txn_id)
        for p in payments
    ]


def sync_txn_statuses(s: Session, txn_ids: Iterable[int | None]) -> None:
    """Keep each bank txn's status in step with what links to it."""
    for txn_id in {t for t in txn_ids if t is not None}:
        txn = s.get(BankTxn, txn_id)
        if txn is None:
            continue
        if txn.direction == "debit":
            link_model, linked_status = ExpensePayment, "logged"
        else:
            link_model, linked_status = Settlement, "payback"
        linked = s.scalar(
            select(func.count()).select_from(link_model).where(link_model.bank_txn_id == txn_id)
        )
        if linked and txn.status == "pending":
            txn.status = linked_status
        elif not linked and txn.status == linked_status:
            txn.status = "pending"


def create_expense(
    s: Session,
    user_id: int,
    data: ExpenseIn,
    *,
    source: str = "manual",
    import_batch_id: int | None = None,
) -> Expense:
    _check_category(s, user_id, data.category_id)
    expense = Expense(
        user_id=user_id,
        occurred_at=ensure_aware(data.occurred_at),
        description=data.description,
        category_id=data.category_id,
        total_paise=data.total_paise,
        my_share_paise=data.my_share_paise,
        note_raw=data.note_raw,
        source=source,
        import_batch_id=import_batch_id,
    )
    expense.payments = _build_payments(s, user_id, data.payments, expense_id=None)
    expense.dues = _build_dues(s, user_id, data.dues)
    s.add(expense)
    s.flush()
    sync_txn_statuses(s, (p.bank_txn_id for p in expense.payments))
    return expense


def update_expense(s: Session, user_id: int, expense: Expense, patch: ExpensePatch) -> Expense:
    fields = patch.model_fields_set
    if patch.occurred_at is not None:
        expense.occurred_at = ensure_aware(patch.occurred_at)
    if patch.description is not None:
        expense.description = patch.description
    if "category_id" in fields:
        _check_category(s, user_id, patch.category_id)
        expense.category_id = patch.category_id
    if "note_raw" in fields:
        expense.note_raw = patch.note_raw

    touched = {p.bank_txn_id for p in expense.payments}
    if patch.payments is not None:
        new_payments = _build_payments(s, user_id, patch.payments, expense_id=expense.id)
        expense.payments = new_payments  # delete-orphan removes the old rows
        expense.total_paise = sum(p.amount_paise for p in new_payments)
        touched |= {p.bank_txn_id for p in new_payments}
    if patch.dues is not None:
        if any(d.settlements for d in expense.dues):
            raise ApiError(
                409, "dues_have_paybacks", "Some of these dues already have paybacks recorded"
            )
        expense.dues = _build_dues(s, user_id, patch.dues)

    dues_total = sum(d.amount_paise for d in expense.dues)
    if patch.my_share_paise is not None:
        share = patch.my_share_paise
    elif patch.payments is not None or patch.dues is not None:
        share = expense.total_paise - dues_total
    else:
        share = expense.my_share_paise
    if share < 0 or share + dues_total != expense.total_paise:
        raise ApiError(422, "share_mismatch", "My share plus dues must equal the total paid")
    expense.my_share_paise = share

    s.flush()
    sync_txn_statuses(s, touched)
    return expense


def delete_expense(s: Session, expense: Expense) -> None:
    txn_ids = {p.bank_txn_id for p in expense.payments}
    txn_ids |= {st.bank_txn_id for d in expense.dues for st in d.settlements}
    s.delete(expense)
    s.flush()
    sync_txn_statuses(s, txn_ids)


def possible_duplicates(s: Session, user_id: int, days: int = 120) -> list[dict]:
    """Expenses that look like the same thing twice: the same IST day and amount, where at least
    one came from an import and they aren't all from the same import (two ₹20 chais logged on
    the same day are left alone)."""
    from collections import defaultdict
    from datetime import timedelta

    from .. import timeutil

    since, _ = timeutil.ist_day_bounds(timeutil.today_ist() - timedelta(days=days), timeutil.today_ist())
    rows = s.scalars(
        select(Expense).where(Expense.user_id == user_id, Expense.occurred_at >= since).order_by(Expense.occurred_at, Expense.id)
    ).all()
    groups: dict[tuple, list[Expense]] = defaultdict(list)
    for e in rows:
        groups[(e.occurred_at.astimezone(timeutil.IST).date(), e.total_paise)].append(e)
    out = []
    for (day, total), items in groups.items():
        if len(items) < 2 or not any(e.source == "import" for e in items):
            continue
        batches = {e.import_batch_id for e in items}
        if len(batches) == 1 and None not in batches:
            continue  # one import listing two of the same thing: probably real
        out.append(
            {
                "day": day.isoformat(),
                "total_paise": total,
                "items": [
                    {
                        "id": e.id,
                        "description": e.description,
                        "category_id": e.category_id,
                        "source": e.source,
                        "import_batch_id": e.import_batch_id,
                        "occurred_at": timeutil.to_ist_iso(e.occurred_at),
                    }
                    for e in items
                ],
            }
        )
    out.sort(key=lambda g: g["day"], reverse=True)
    return out
