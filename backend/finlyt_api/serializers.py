from __future__ import annotations

from typing import Any

from .models import Account, Category, Due, Expense, User
from .timeutil import to_ist_iso


def user_json(u: User) -> dict[str, Any]:
    return {"id": u.id, "email": u.email, "name": u.name, "picture_url": u.picture_url}


def account_json(a: Account) -> dict[str, Any]:
    return {
        "id": a.id,
        "name": a.name,
        "kind": a.kind,
        "bank_code": a.bank_code,
        "last4": a.last4,
        "is_primary": a.is_primary,
    }


def category_json(c: Category) -> dict[str, Any]:
    return {"id": c.id, "name": c.name, "emoji": c.emoji, "color": c.color}


def due_json(d: Due) -> dict[str, Any]:
    return {
        "id": d.id,
        "person_id": d.person_id,
        "person_name": d.person.name,
        "amount_paise": d.amount_paise,
        "settled_paise": sum(st.amount_paise for st in d.settlements),
        "status": d.status,
    }


def expense_json(e: Expense) -> dict[str, Any]:
    return {
        "id": e.id,
        "occurred_at": to_ist_iso(e.occurred_at),
        "description": e.description,
        "category_id": e.category_id,
        "total_paise": e.total_paise,
        "my_share_paise": e.my_share_paise,
        "note_raw": e.note_raw,
        "source": e.source,
        "import_batch_id": e.import_batch_id,
        "payments": [
            {
                "id": p.id,
                "account_id": p.account_id,
                "amount_paise": p.amount_paise,
                "bank_txn_id": p.bank_txn_id,
            }
            for p in e.payments
        ],
        "dues": [due_json(d) for d in e.dues],
        "created_at": to_ist_iso(e.created_at),
        "updated_at": to_ist_iso(e.updated_at),
    }
