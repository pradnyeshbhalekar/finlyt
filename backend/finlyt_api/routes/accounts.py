"""Your accounts: the ways you pay (a bank, a card, cash). Add, rename, pick the usual one, delete.

A new user starts with "Bank" and "Cash" (defaults.py). The usual one (`is_primary`) is what an
entry is saved to when you don't say how you paid. An account with entries can't be deleted,
only renamed, so old entries always keep their account.
"""

from __future__ import annotations

from flask import Blueprint
from sqlalchemy import func, select

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..models import Account, BankTxn, ExpensePayment
from ..schemas import AccountIn, AccountPatch
from ..serializers import account_json
from ..validation import parse_body

bp = Blueprint("accounts", __name__)


def _mine(s, user_id: int) -> list[Account]:
    return list(
        s.scalars(
            select(Account)
            .where(Account.user_id == user_id, Account.is_active)
            .order_by(Account.sort_order, Account.id)
        )
    )


def _get(s, user_id: int, account_id: int) -> Account:
    account = s.get(Account, account_id)
    if account is None or account.user_id != user_id or not account.is_active:
        raise ApiError(404, "not_found", "That account doesn't exist")
    return account


def _check_name(s, user_id: int, name: str, *, except_id: int | None = None) -> None:
    taken = s.scalar(
        select(Account.id).where(
            Account.user_id == user_id, func.lower(Account.name) == name.lower(), Account.id != (except_id or 0)
        )
    )
    if taken is not None:
        raise ApiError(409, "name_taken", f"You already have an account called {name}")


def _make_primary(s, user_id: int, account: Account) -> None:
    for other in _mine(s, user_id):
        other.is_primary = other.id == account.id


@bp.get("/accounts")
def list_accounts():
    return {"items": [account_json(a) for a in _mine(get_session(), current_user().id)]}


@bp.post("/accounts")
def add_account():
    data = parse_body(AccountIn)
    user = current_user()
    s = get_session()
    _check_name(s, user.id, data.name)
    existing = _mine(s, user.id)
    account = Account(
        user_id=user.id,
        name=data.name,
        kind=data.kind,
        is_primary=not existing,
        sort_order=max((a.sort_order for a in existing), default=-1) + 1,
    )
    s.add(account)
    s.flush()
    if data.is_primary:
        _make_primary(s, user.id, account)
    s.commit()
    return account_json(account), 201


@bp.patch("/accounts/<int:account_id>")
def change_account(account_id: int):
    data = parse_body(AccountPatch)
    user = current_user()
    s = get_session()
    account = _get(s, user.id, account_id)
    if data.name is not None and data.name != account.name:
        _check_name(s, user.id, data.name, except_id=account.id)
        account.name = data.name
    if data.is_primary:
        _make_primary(s, user.id, account)
    s.commit()
    return account_json(account)


@bp.delete("/accounts/<int:account_id>")
def delete_account(account_id: int):
    user = current_user()
    s = get_session()
    account = _get(s, user.id, account_id)
    others = [a for a in _mine(s, user.id) if a.id != account.id]
    if not others:
        raise ApiError(409, "last_account", "Keep at least one account. You can rename this one instead.")
    used = s.scalar(select(func.count()).select_from(ExpensePayment).where(ExpensePayment.account_id == account.id))
    used += s.scalar(select(func.count()).select_from(BankTxn).where(BankTxn.account_id == account.id))
    if used:
        raise ApiError(
            409,
            "account_in_use",
            f"{account.name} has entries saved to it, so it can't be deleted. You can rename it instead.",
        )
    s.delete(account)
    if account.is_primary:
        others[0].is_primary = True
    s.commit()
    return "", 204
