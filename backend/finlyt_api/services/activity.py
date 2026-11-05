"""Everything that happened with money, newest first: entries, paybacks received, money I owe,
bank payments set aside (transfers, income, ignored), and plan changes. Feeds History."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import BankTxn, Debt, Due, Expense, Person, Settlement, SpendingPlan
from ..serializers import expense_json
from ..sms_parsers import display_name
from ..timeutil import to_ist_iso
from .expenses import expense_query


def feed(s: Session, user_id: int, *, before: datetime | None, limit: int) -> dict[str, Any]:
    items: list[tuple[datetime, dict[str, Any]]] = []

    q = expense_query(user_id).order_by(Expense.occurred_at.desc(), Expense.id.desc()).limit(limit)
    if before is not None:
        q = q.where(Expense.occurred_at < before)
    for e in s.scalars(q):
        items.append((e.occurred_at, {"type": "expense", "expense": expense_json(e)}))

    # One payback can settle several dues: show it once.
    q = (
        select(Settlement, Person.name, Expense.description)
        .join(Due, Settlement.due_id == Due.id)
        .join(Person, Due.person_id == Person.id)
        .join(Expense, Due.expense_id == Expense.id)
        .where(Expense.user_id == user_id)
        .order_by(Settlement.settled_at.desc())
        .limit(limit * 3)
    )
    if before is not None:
        q = q.where(Settlement.settled_at < before)
    grouped: dict[tuple, dict[str, Any]] = {}
    for st, person, what in s.execute(q):
        key = (person, st.settled_at, st.method, st.bank_txn_id)
        row = grouped.setdefault(
            key,
            {"type": "payback", "person": person, "amount_paise": 0, "method": st.method, "for": [], "at": st.settled_at},
        )
        row["amount_paise"] += st.amount_paise
        if what not in row["for"]:
            row["for"].append(what)
    for row in grouped.values():
        items.append((row.pop("at"), row))

    q = (
        select(Debt)
        .where(Debt.user_id == user_id)
        .options(selectinload(Debt.person))
        .order_by(Debt.occurred_at.desc())
        .limit(limit)
    )
    if before is not None:
        q = q.where(Debt.occurred_at < before)
    for d in s.scalars(q):
        items.append(
            (
                d.occurred_at,
                {
                    "type": "debt",
                    "id": d.id,
                    "person": d.person.name,
                    "amount_paise": d.amount_paise,
                    "description": d.description,
                    "category_id": d.category_id,
                    "status": d.status,
                    "settled_at": to_ist_iso(d.settled_at),
                },
            )
        )

    q = (
        select(BankTxn)
        .where(BankTxn.user_id == user_id, BankTxn.status.in_(("transfer", "income", "ignored")))
        .order_by(BankTxn.occurred_at.desc())
        .limit(limit)
    )
    if before is not None:
        q = q.where(BankTxn.occurred_at < before)
    for t in s.scalars(q):
        items.append(
            (
                t.occurred_at,
                {
                    "type": "bank",
                    "id": t.id,
                    "status": t.status,
                    "direction": t.direction,
                    "name": display_name(t.counterparty),
                    "amount_paise": t.amount_paise,
                    "account_id": t.account_id,
                },
            )
        )

    q = select(SpendingPlan).where(SpendingPlan.user_id == user_id).order_by(SpendingPlan.created_at.desc()).limit(limit)
    if before is not None:
        q = q.where(SpendingPlan.created_at < before)
    for p in s.scalars(q):
        items.append(
            (p.created_at, {"type": "plan", "daily_limit_paise": p.daily_limit_paise, "notes": p.notes})
        )

    items.sort(key=lambda pair: pair[0], reverse=True)
    page = items[:limit]
    return {
        "items": [{**item, "at": to_ist_iso(at)} for at, item in page],
        "next_before": to_ist_iso(page[-1][0]) if len(items) > limit else None,
    }
