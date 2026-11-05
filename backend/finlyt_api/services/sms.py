"""SMS sync: store bank SMS once and parse them into bank transactions. Each new one is then
matched where it can be, so it never needs explaining:
- a debit to a payment already logged by hand (same account, amount and IST day);
- a debit to someone I owe exactly that much (the debt is paid off; see debts.py);
- a credit from someone who owes me (their dues are settled).
Whatever is left stays pending for the "To log" list."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..banks import BANKS
from ..errors import ApiError
from ..models import Account, BankTxn, Expense, ExpensePayment, SmsMessage
from ..schemas import SmsIn
from ..sms_parsers import display_name, parse
from ..timeutil import IST, ensure_aware, ist_day_bounds, to_ist_iso
from . import debts


def identify_bank(sender: str, body: str) -> str | None:
    """The bank named in the message text wins; the sender id is the fallback."""
    sender_l, body_l = sender.lower(), body.lower()
    for bank in BANKS.values():
        if any(m.lower() in body_l for m in bank.body_markers):
            return bank.code
    for bank in BANKS.values():
        if any(p.lower() in sender_l for p in bank.sender_patterns):
            return bank.code
    return None


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


def auto_link(s: Session, user_id: int, txn: BankTxn) -> bool:
    """Link a new debit to a hand-logged payment with the same account, amount and IST day."""
    day = txn.occurred_at.astimezone(IST).date()
    start, end = ist_day_bounds(day, day)
    candidates = s.execute(
        select(ExpensePayment, Expense.occurred_at)
        .join(Expense, ExpensePayment.expense_id == Expense.id)
        .where(
            Expense.user_id == user_id,
            ExpensePayment.account_id == txn.account_id,
            ExpensePayment.bank_txn_id.is_(None),
            ExpensePayment.amount_paise == txn.amount_paise,
            Expense.occurred_at >= start,
            Expense.occurred_at < end,
        )
    ).all()
    if not candidates:
        return False
    payment, _ = min(candidates, key=lambda row: abs(row[1] - txn.occurred_at))
    payment.bank_txn_id = txn.id
    txn.status = "logged"
    return True


def sync(s: Session, user_id: int, messages: list[SmsIn]) -> dict[str, Any]:
    accounts = {
        a.bank_code: a
        for a in s.scalars(select(Account).where(Account.user_id == user_id, Account.is_active))
        if a.bank_code
    }
    new: list[BankTxn] = []
    matched: list[dict] = []
    counts = {"received": len(messages), "duplicates": 0, "unparsed": 0, "linked": 0}
    for m in messages:
        body = m.body.strip()
        body_hash = hashlib.sha256(body.encode()).hexdigest()
        if s.scalar(select(SmsMessage.id).where(SmsMessage.user_id == user_id, SmsMessage.body_hash == body_hash)):
            counts["duplicates"] += 1
            continue
        received_at = ensure_aware(m.received_at)
        code = identify_bank(m.sender, body)
        account = accounts.get(code) if code else None
        sms = SmsMessage(
            user_id=user_id,
            account_id=account.id if account else None,
            sender=m.sender[:64],
            body=body,
            received_at=received_at,
            device_msg_id=(m.device_id or None),
            body_hash=body_hash,
        )
        s.add(sms)
        s.flush()
        parsed = parse(code, body) if account is not None and code else None
        if parsed is None:
            sms.parse_status = "not_txn" if account is None or "rs" not in body.lower() else "failed"
            counts["unparsed"] += 1
            continue
        sms.parser = f"{code}_v1"
        if parsed.reference and s.scalar(
            select(BankTxn.id).where(BankTxn.account_id == account.id, BankTxn.reference == parsed.reference)
        ):
            sms.parse_status = "duplicate"
            counts["duplicates"] += 1
            continue
        txn = BankTxn(
            user_id=user_id,
            account_id=account.id,
            sms_id=sms.id,
            direction=parsed.direction,
            amount_paise=parsed.amount_paise,
            channel=parsed.channel,
            counterparty=(parsed.counterparty or "")[:128] or None,
            reference=parsed.reference,
            occurred_at=parsed.occurred_at or received_at,
        )
        s.add(txn)
        s.flush()
        sms.parse_status = "parsed"
        if txn.direction == "debit":
            if auto_link(s, user_id, txn):
                counts["linked"] += 1
            elif match := debts.auto_repay(s, user_id, txn):
                matched.append(match)
        elif match := debts.auto_payback(s, user_id, txn):
            matched.append(match)
        new.append(txn)
    s.flush()
    return {
        **counts,
        "matched": matched,
        "new_txns": [txn_json(t) for t in new if t.status == "pending"],
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
