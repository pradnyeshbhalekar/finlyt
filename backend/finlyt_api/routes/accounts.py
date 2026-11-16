"""Your accounts: the ways you pay (a bank, a card, cash). Add, rename, pick the usual one, delete.

A new user starts with "Bank" and "Cash" (defaults.py). The usual one (`is_primary`) is what an
entry is saved to when you don't say how you paid. An account with entries can't be deleted,
only renamed, so old entries always keep their account.

People who joined before 2026-11-14 got the first user's own banks (Kotak, DNS Bank). The bank's
name doesn't matter to anyone, so `POST /accounts/one-bank` folds every bank account into one
called "Bank", entries and all. Cash stays separate.
"""

from __future__ import annotations

from flask import Blueprint
from sqlalchemy import func, select, update

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..models import Account, BankTxn, ExpensePayment, SmsMessage
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


@bp.post("/accounts/one-bank")
def one_bank():
    """Fold all bank accounts into one called "Bank": the usual one (or the first) stays, takes the
    others' payments, bank payments and SMS, and the others go. Safe to call again."""
    user = current_user()
    s = get_session()
    banks = [a for a in _mine(s, user.id) if a.kind == "bank"]
    if not banks:
        raise ApiError(409, "no_bank_account", "You don't have a bank account to keep")
    keep = next((a for a in banks if a.is_primary), banks[0])
    moved = 0
    for old in banks:
        if old.id == keep.id:
            continue
        moved += s.execute(
            update(ExpensePayment).where(ExpensePayment.account_id == old.id).values(account_id=keep.id)
        ).rowcount
        # A transfer between your own banks leaves the same reference on both; one account can
        # hold each reference only once, so the second copy keeps its row but not the reference
        # (it only ever served to spot duplicates).
        kept_refs = set(
            s.scalars(select(BankTxn.reference).where(BankTxn.account_id == keep.id, BankTxn.reference.is_not(None)))
        )
        for txn in s.scalars(select(BankTxn).where(BankTxn.account_id == old.id)):
            if txn.reference in kept_refs:
                txn.reference = None
            txn.account_id = keep.id
            moved += 1
        s.flush()
        s.execute(update(SmsMessage).where(SmsMessage.account_id == old.id).values(account_id=keep.id))
        s.delete(old)
        s.flush()
    named_bank = s.scalar(
        select(Account.id).where(Account.user_id == user.id, func.lower(Account.name) == "bank", Account.id != keep.id)
    )
    if named_bank is None:
        keep.name = "Bank"
    keep.bank_code = None
    keep.last4 = None
    s.commit()
    return {"items": [account_json(a) for a in _mine(s, user.id)], "moved": moved}
