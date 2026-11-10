"""Bank transactions waiting to be explained: the "To log" list, and marking them as a transfer,
income or ignored."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..counterparty import display_name
from ..errors import ApiError
from ..models import BankTxn
from ..timeutil import IST, to_ist_iso


def txn_json(t: BankTxn) -> dict[str, Any]:
    return {
        "id": t.id,
        "account_id": t.account_id,
        "direction": t.direction,
        "amount_paise": t.amount_paise,
        "channel": t.channel,
        "counterparty": t.counterparty,
        "name": display_name(t.counterparty),
        "occurred_at": to_ist_iso(t.occurred_at),
        "status": t.status,
    }


def pending(s: Session, user_id: int, days: int = 14) -> list[dict[str, Any]]:
    since = BankTxn.occurred_at >= datetime.now(IST) - timedelta(days=days)
    rows = s.scalars(
        select(BankTxn)
        .where(BankTxn.user_id == user_id, BankTxn.status == "pending", since)
        .order_by(BankTxn.occurred_at.desc(), BankTxn.id.desc())
    )
    return [txn_json(t) for t in rows]


RESOLVABLE = {"transfer", "ignored", "income", "pending"}


def resolve(s: Session, user_id: int, txn_id: int, status: str) -> BankTxn:
    txn = s.scalar(select(BankTxn).where(BankTxn.id == txn_id, BankTxn.user_id == user_id))
    if txn is None:
        raise ApiError(404, "not_found", f"Bank transaction {txn_id} not found")
    if status not in RESOLVABLE:
        raise ApiError(422, "bad_status", f"Can't mark a transaction as {status}")
    if status != "pending" and txn.status != "pending":
        raise ApiError(409, "txn_not_pending", f"It's already {txn.status}")
    if status == "pending" and txn.status not in {"transfer", "ignored", "income"}:
        raise ApiError(409, "txn_in_use", "It's linked to an entry; delete that entry instead")
    txn.status = status
    s.flush()
    return txn
