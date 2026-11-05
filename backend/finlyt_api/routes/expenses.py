from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..models import Expense, ExpensePayment
from ..schemas import ExpenseIn, ExpenseListQuery, ExpensePatch
from ..serializers import expense_json
from ..services.expenses import (
    create_expense,
    delete_expense,
    expense_query,
    get_expense,
    update_expense,
)
from ..timeutil import ist_day_bounds
from ..validation import parse_body, parse_query

bp = Blueprint("expenses", __name__)


@bp.get("/expenses")
def list_expenses():
    q = parse_query(ExpenseListQuery)
    stmt = expense_query(current_user().id).order_by(Expense.occurred_at.desc(), Expense.id.desc())
    if q.from_ is not None:
        stmt = stmt.where(Expense.occurred_at >= ist_day_bounds(q.from_, q.from_)[0])
    if q.to is not None:
        stmt = stmt.where(Expense.occurred_at < ist_day_bounds(q.to, q.to)[1])
    if q.category_id is not None:
        stmt = stmt.where(Expense.category_id == q.category_id)
    if q.account_id is not None:
        stmt = stmt.where(Expense.payments.any(ExpensePayment.account_id == q.account_id))
    items = get_session().scalars(stmt.limit(q.limit).offset(q.offset)).all()
    return {"items": [expense_json(e) for e in items], "limit": q.limit, "offset": q.offset}


@bp.post("/expenses")
def add_expense():
    data = parse_body(ExpenseIn)
    s = get_session()
    user_id = current_user().id
    expense = create_expense(s, user_id, data, source="manual")
    s.commit()
    return expense_json(get_expense(s, user_id, expense.id)), 201


@bp.get("/expenses/<int:expense_id>")
def read_expense(expense_id: int):
    return expense_json(get_expense(get_session(), current_user().id, expense_id))


@bp.patch("/expenses/<int:expense_id>")
def edit_expense(expense_id: int):
    patch = parse_body(ExpensePatch)
    s = get_session()
    user_id = current_user().id
    expense = update_expense(s, user_id, get_expense(s, user_id, expense_id), patch)
    s.commit()
    return expense_json(get_expense(s, user_id, expense.id))


@bp.delete("/expenses/<int:expense_id>")
def remove_expense(expense_id: int):
    s = get_session()
    user_id = current_user().id
    delete_expense(s, get_expense(s, user_id, expense_id))
    s.commit()
    return "", 204
