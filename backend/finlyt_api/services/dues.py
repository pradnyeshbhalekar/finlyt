"""Paybacks: money someone returns settles their open dues, oldest expense first."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..errors import ApiError
from ..models import BankTxn, Due, Expense, Person, Settlement
from ..money import rupees
from ..schemas import SettlementIn
from ..timeutil import ensure_aware, now_utc
from .expenses import sync_txn_statuses
from .people import learn_alias


def find_person(s: Session, user_id: int, name: str) -> Person | None:
    """Match a name against people's names and aliases, ignoring case and extra spaces."""
    wanted = " ".join(name.split()).lower()
    for person in s.scalars(select(Person).where(Person.user_id == user_id)):
        if person.name.lower() == wanted or wanted in (a.lower() for a in person.aliases or []):
            return person
    return None


def open_dues(s: Session, user_id: int, person_id: int) -> list[Due]:
    return list(
        s.scalars(
            select(Due)
            .join(Expense)
            .where(Expense.user_id == user_id, Due.person_id == person_id, Due.status == "open")
            .order_by(Expense.occurred_at, Due.id)
            .options(selectinload(Due.settlements))
        )
    )


def outstanding(due: Due) -> int:
    return due.amount_paise - sum(st.amount_paise for st in due.settlements)


def settle(s: Session, user_id: int, data: SettlementIn) -> list[Settlement]:
    if data.person_id is not None:
        person = s.scalar(select(Person).where(Person.id == data.person_id, Person.user_id == user_id))
    else:
        person = find_person(s, user_id, data.person_name or "")
    if person is None:
        who = data.person_name or f"person {data.person_id}"
        raise ApiError(422, "unknown_person", f"Nobody called {who} owes you money")

    txn = None
    if data.bank_txn_id is not None:
        txn = s.scalar(
            select(BankTxn).where(BankTxn.id == data.bank_txn_id, BankTxn.user_id == user_id)
        )
        if txn is None:
            raise ApiError(422, "unknown_txn", f"Bank transaction {data.bank_txn_id} doesn't exist")
        if txn.direction != "credit":
            raise ApiError(422, "txn_not_credit", "A payback has to be money coming in")
        used = s.scalar(
            select(func.coalesce(func.sum(Settlement.amount_paise), 0)).where(
                Settlement.bank_txn_id == txn.id
            )
        )
        if used + data.amount_paise > txn.amount_paise:
            raise ApiError(
                422, "txn_overallocated", f"That credit was only {rupees(txn.amount_paise)}"
            )

    if data.settled_at is not None:
        settled_at = ensure_aware(data.settled_at)
    else:
        settled_at = txn.occurred_at if txn is not None else now_utc()

    dues = open_dues(s, user_id, person.id)
    owed = sum(outstanding(d) for d in dues)
    if data.amount_paise > owed:
        raise ApiError(
            422,
            "overpaid",
            f"{person.name} owes you {rupees(owed)}, less than the {rupees(data.amount_paise)} payback",
        )

    created: list[Settlement] = []
    remaining = data.amount_paise
    for due in dues:
        take = min(outstanding(due), remaining)
        if take <= 0:
            continue
        settlement = Settlement(
            amount_paise=take,
            method="txn" if txn is not None else "cash",
            bank_txn_id=txn.id if txn is not None else None,
            settled_at=settled_at,
        )
        due.settlements.append(settlement)
        if outstanding(due) == 0:
            due.status = "settled"
        created.append(settlement)
        remaining -= take
        if remaining == 0:
            break

    s.flush()
    if txn is not None:
        sync_txn_statuses(s, [txn.id])
        learn_alias(person, txn.counterparty)  # remember their UPI ID
    return created
