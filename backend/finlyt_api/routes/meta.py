from __future__ import annotations

from flask import Blueprint
from sqlalchemy import func, select

from ..auth import current_user
from ..db import get_session
from ..models import Account, Category, Expense, Person
from ..serializers import account_json, category_json, user_json
from ..timeutil import TZ_NAME, now_utc, to_ist_iso

bp = Blueprint("meta", __name__)


@bp.get("/meta")
def meta():
    user = current_user()
    s = get_session()
    accounts = s.scalars(
        select(Account)
        .where(Account.user_id == user.id, Account.is_active)
        .order_by(Account.sort_order, Account.id)
    ).all()
    categories = s.scalars(
        select(Category)
        .where(Category.user_id == user.id, Category.is_active)
        .order_by(Category.sort_order, Category.id)
    ).all()
    people = s.scalars(
        select(Person).where(Person.user_id == user.id).order_by(func.lower(Person.name))
    ).all()
    latest_import = s.scalar(
        select(func.max(Expense.occurred_at)).where(
            Expense.user_id == user.id, Expense.source == "import"
        )
    )

    return {
        "user": user_json(user),
        "timezone": TZ_NAME,
        "server_time": to_ist_iso(now_utc()),
        "accounts": [account_json(a) for a in accounts],
        "categories": [category_json(c) for c in categories],
        "people": [{"id": p.id, "name": p.name} for p in people],
        "latest_import_at": to_ist_iso(latest_import),
    }
