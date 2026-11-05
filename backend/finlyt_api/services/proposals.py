"""Voice/text logging: build Gemini's prompt, then turn its answer into a reviewable proposal.

Nothing is saved here. The proposal uses the same shapes as POST /api/expenses so the app
can edit it and send it to /api/log/commit. Anything that doesn't add up is kept but
flagged in `issues`, so the person reviewing sees it instead of it being silently fixed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..gemini import GExpense, GProposal, GSettlement, GTxnNote
from ..models import Account, BankTxn, Category, Person
from ..money import rupees, to_paise
from ..schemas import LogCommitIn
from ..timeutil import IST, now_utc, to_ist_iso
from .dues import find_person, open_dues, outstanding, settle
from .expenses import create_expense

RECENT_TXN_DAYS = 14
MAX_TXNS = 40

SYSTEM_PROMPT = """\
You turn what I say about my spending into records for my personal expense tracker. I live in \
India and amounts are in rupees. I may speak English, Hindi, Marathi or a mix.

How to fill the answer:
- expenses: one per thing I bought or paid for. Don't merge separate items, skip small ones or \
invent anything I didn't say.
- payments: how each expense was paid. source is a transaction label (T1, T2…) when the money \
left in that bank transaction, otherwise the exact name of one of my accounts. Half cash, half \
UPI means two payments. A transaction can be split across several expenses, but never assign \
more than its amount. Extra paid on top in cash ("plus 30 cash") is a separate Cash payment.
- If I don't say how I paid and no transaction fits, use my primary account and ask about it \
in questions.
- total is the full amount paid and equals the sum of payments. my_share is my part. owed_by \
says who owes me what, and total = my_share + the sum of owed_by. If I treated someone, nobody \
owes me and my_share = total. If I lent money, my_share is 0 and the whole amount is owed.
- category: exactly one of my category names. Use Other if none fits.
- time: when the spending happened, "YYYY-MM-DD HH:MM" in IST. Use the transaction's time when \
linked to one, otherwise work it out from what I said ("lunch", "this morning", "yesterday"). \
null if there's no way to tell.
- settlements: people paying me back. txn is the credit transaction label it arrived as, or \
null if it was cash.
- transfers: transactions that only move money between my own accounts, or ATM withdrawals.
- ignored: transactions I tell you to skip.
- questions: only what you genuinely can't work out. Short. Leave transactions I don't mention \
alone; they stay pending.
- transcript: the voice note word for word, in the language I spoke. Empty if there's no audio.
"""


@dataclass
class LogContext:
    accounts: list[Account]
    categories: list[Category]
    people: list[Person]
    txns: list[BankTxn]

    @property
    def labels(self) -> dict[str, BankTxn]:
        return {f"T{i}": txn for i, txn in enumerate(self.txns, start=1)}

    @property
    def primary(self) -> Account:
        return next((a for a in self.accounts if a.is_primary), self.accounts[0])

    def account_name(self, account_id: int) -> str:
        return next((a.name for a in self.accounts if a.id == account_id), "an account")


def load_context(s: Session, user_id: int, txn_ids: list[int] | None) -> LogContext:
    accounts = list(
        s.scalars(
            select(Account)
            .where(Account.user_id == user_id, Account.is_active)
            .order_by(Account.sort_order, Account.id)
        )
    )
    if not accounts:
        raise ApiError(409, "no_accounts", "Add an account before logging")
    categories = list(
        s.scalars(
            select(Category)
            .where(Category.user_id == user_id, Category.is_active)
            .order_by(Category.sort_order, Category.id)
        )
    )
    people = list(s.scalars(select(Person).where(Person.user_id == user_id).order_by(Person.name)))

    stmt = (
        select(BankTxn)
        .where(BankTxn.user_id == user_id, BankTxn.status == "pending")
        .order_by(BankTxn.occurred_at, BankTxn.id)
    )
    if txn_ids is not None:
        txns = list(s.scalars(stmt.where(BankTxn.id.in_(txn_ids))))
        if missing := set(txn_ids) - {t.id for t in txns}:
            raise ApiError(
                409, "txn_not_pending", f"Transaction(s) {sorted(missing)} aren't waiting to be logged"
            )
    else:
        since = now_utc() - timedelta(days=RECENT_TXN_DAYS)
        txns = list(s.scalars(stmt.where(BankTxn.occurred_at >= since).limit(MAX_TXNS)))
    return LogContext(accounts, categories, people, txns)


def _when(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%Y-%m-%d %H:%M")


def build_prompt(ctx: LogContext, *, text: str | None, has_audio: bool, now: datetime) -> str:
    """The per-request part of the prompt. Account numbers, balances and refs are never sent."""
    lines = [f"Now: {now.astimezone(IST).strftime('%A %Y-%m-%d %H:%M')} IST."]

    accounts = []
    for a in ctx.accounts:
        note = "cash" if a.kind == "cash" else "bank account"
        accounts.append(f"{a.name} ({note}{', primary' if a.id == ctx.primary.id else ''})")
    lines.append("My accounts: " + "; ".join(accounts) + ".")
    lines.append("My categories: " + ", ".join(c.name for c in ctx.categories) + ".")
    if ctx.people:
        lines.append("People I know: " + ", ".join(p.name for p in ctx.people) + ".")

    if ctx.txns:
        lines.append("Bank transactions waiting to be explained:")
        for label, t in ctx.labels.items():
            arrow = "paid from" if t.direction == "debit" else "received in"
            party = f" {'to' if t.direction == 'debit' else 'from'} {t.counterparty}" if t.counterparty else ""
            lines.append(
                f"{label}: {rupees(t.amount_paise)} {arrow} {ctx.account_name(t.account_id)}"
                f"{party} at {_when(t.occurred_at)} ({t.channel})"
            )
    else:
        lines.append("There are no bank transactions waiting to be explained.")

    if has_audio:
        lines.append("My voice note is attached.")
    if text:
        lines.append(f"What I typed:\n{text}")
    return "\n".join(lines)


_LABEL = re.compile(r"^\s*T(\d+)\s*$", re.IGNORECASE)
_CASH_WORDS = {"cash", "wallet", "nakad"}


class _Resolver:
    def __init__(self, ctx: LogContext, now: datetime) -> None:
        self.ctx = ctx
        self.now = now
        self.labels = {k.upper(): v for k, v in ctx.labels.items()}
        self.txn_use: dict[int, int] = {}

    def txn(self, label: str | None) -> BankTxn | None:
        if not label:
            return None
        m = _LABEL.match(label)
        return self.labels.get(f"T{m.group(1)}") if m else None

    def account(self, source: str) -> Account | None:
        key = " ".join(source.split()).lower()
        for a in self.ctx.accounts:
            if key in (a.name.lower(), (a.bank_code or "").lower()):
                return a
        if key in _CASH_WORDS:
            return next((a for a in self.ctx.accounts if a.kind == "cash"), None)
        # "Kotak Bank", "DNS" → the account whose name starts with or contains it.
        return next(
            (a for a in self.ctx.accounts if a.name.lower() in key or key in a.name.lower()), None
        )

    def category(self, name: str) -> tuple[Category | None, str | None]:
        key = name.strip().lower()
        for c in self.ctx.categories:
            if c.name.lower() == key:
                return c, None
        other = next((c for c in self.ctx.categories if c.name.lower() == "other"), None)
        return other, f'Gemini picked "{name}", which isn\'t one of your categories'

    def person_name(self, name: str) -> str:
        known = next(
            (
                p
                for p in self.ctx.people
                if p.name.lower() == name.strip().lower()
                or name.strip().lower() in (a.lower() for a in p.aliases or [])
            ),
            None,
        )
        return known.name if known else " ".join(name.split()).title()

    def when(self, raw: str | None, linked: BankTxn | None, issues: list[str]) -> str:
        if raw:
            try:
                parsed = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=IST)
                if parsed > self.now + timedelta(minutes=5):
                    issues.append("The time Gemini gave is in the future, so it's set to now")
                    return to_ist_iso(self.now) or ""
                return to_ist_iso(parsed) or ""
            except ValueError:
                issues.append(f'Couldn\'t read the time "{raw}", so it\'s set to now')
        if linked is not None:
            return to_ist_iso(linked.occurred_at) or ""
        return to_ist_iso(self.now) or ""

    def expense(self, g: GExpense) -> dict[str, Any]:
        issues: list[str] = []
        payments: list[dict[str, Any]] = []
        first_txn: BankTxn | None = None
        for p in g.payments:
            amount = to_paise(p.amount)
            if amount <= 0:
                issues.append(f"Dropped a payment of {rupees(amount)} from {p.source}")
                continue
            txn = self.txn(p.source)
            if txn is not None:
                if txn.direction != "debit":
                    # Keep the account it came into, but don't link money coming in to a payment.
                    issues.append(f"{p.source} is money coming in, not a payment")
                    payments.append(
                        {"account_id": txn.account_id, "amount_paise": amount, "bank_txn_id": None, "txn_label": None}
                    )
                    continue
                else:
                    first_txn = first_txn or txn
                    self.txn_use[txn.id] = self.txn_use.get(txn.id, 0) + amount
                    if self.txn_use[txn.id] > txn.amount_paise:
                        issues.append(
                            f"More than {p.source}'s {rupees(txn.amount_paise)} is assigned to payments"
                        )
                    payments.append(
                        {
                            "account_id": txn.account_id,
                            "amount_paise": amount,
                            "bank_txn_id": txn.id,
                            "txn_label": p.source.strip().upper(),
                        }
                    )
                    continue
            account = self.account(p.source)
            if account is None:
                account = self.ctx.primary
                if not _LABEL.match(p.source):
                    issues.append(f'"{p.source}" isn\'t one of your accounts, so it\'s set to {account.name}')
                else:
                    issues.append(f"{p.source} isn't a pending transaction, so it's set to {account.name}")
            payments.append(
                {"account_id": account.id, "amount_paise": amount, "bank_txn_id": None, "txn_label": None}
            )

        if not payments:
            amount = to_paise(g.total)
            issues.append(f"Gemini didn't say how this was paid, so it's set to {self.ctx.primary.name}")
            if amount > 0:
                payments.append(
                    {"account_id": self.ctx.primary.id, "amount_paise": amount, "bank_txn_id": None, "txn_label": None}
                )

        total = sum(p["amount_paise"] for p in payments)
        if total != to_paise(g.total):
            issues.append(
                f"Gemini said the total was {rupees(to_paise(g.total))} but the payments add up to {rupees(total)}"
            )

        dues = []
        for o in g.owed_by:
            amount = to_paise(o.amount)
            if amount > 0 and o.person.strip():
                dues.append({"person_name": self.person_name(o.person), "amount_paise": amount})
        dues_total = sum(d["amount_paise"] for d in dues)
        share = total - dues_total
        if share < 0:
            issues.append(f"People owe {rupees(dues_total)}, more than the {rupees(total)} paid")
        elif share != to_paise(g.my_share):
            issues.append(
                f"Gemini said your share was {rupees(to_paise(g.my_share))}; "
                f"it's {rupees(share)} once the dues are taken off"
            )

        category, problem = self.category(g.category)
        if problem:
            issues.append(problem)

        return {
            "occurred_at": self.when(g.time, first_txn, issues),
            "description": g.description.strip()[:200] or "Expense",
            "category_id": category.id if category else None,
            "total_paise": total,
            "my_share_paise": max(share, 0),
            "payments": payments,
            "dues": dues,
            "issues": issues,
        }

    def settlement(self, s: Session, user_id: int, g: GSettlement) -> dict[str, Any]:
        issues: list[str] = []
        amount = to_paise(g.amount)
        txn = self.txn(g.txn)
        if g.txn and txn is None:
            issues.append(f"{g.txn} isn't a pending transaction, so this is recorded as cash")
        elif txn is not None and txn.direction != "credit":
            issues.append(f"{g.txn} is money going out, so this is recorded as cash")
            txn = None
        name = self.person_name(g.person)
        person = find_person(s, user_id, name)
        owed = sum(outstanding(d) for d in open_dues(s, user_id, person.id)) if person else 0
        if person is None or owed == 0:
            issues.append(f"{name} doesn't owe you anything right now")
        elif amount > owed:
            issues.append(f"{name} only owes you {rupees(owed)}")
        return {
            "person_name": name,
            "amount_paise": amount,
            "bank_txn_id": txn.id if txn else None,
            "txn_label": g.txn.strip().upper() if txn and g.txn else None,
            "owed_paise": owed,
            "issues": issues,
        }

    def txn_note(self, g: GTxnNote, kind: str) -> dict[str, Any] | None:
        txn = self.txn(g.txn)
        if txn is None:
            return None
        if kind == "transfer" and txn.direction != "debit":
            return None
        return {"bank_txn_id": txn.id, "txn_label": g.txn.strip().upper(), "reason": g.reason}


def resolve(
    s: Session, user_id: int, ctx: LogContext, g: GProposal, *, now: datetime
) -> dict[str, Any]:
    r = _Resolver(ctx, now)
    expenses = [r.expense(e) for e in g.expenses]
    settlements = [r.settlement(s, user_id, st) for st in g.settlements if to_paise(st.amount) > 0]
    transfers = [n for n in (r.txn_note(t, "transfer") for t in g.transfers) if n]
    ignored = [n for n in (r.txn_note(t, "ignored") for t in g.ignored) if n]
    return {
        "transcript": g.transcript.strip(),
        "questions": [q.strip() for q in g.questions if q.strip()],
        "txns": [
            {
                "label": label,
                "id": t.id,
                "account_id": t.account_id,
                "direction": t.direction,
                "amount_paise": t.amount_paise,
                "counterparty": t.counterparty,
                "occurred_at": to_ist_iso(t.occurred_at),
            }
            for label, t in ctx.labels.items()
        ],
        "expenses": expenses,
        "settlements": settlements,
        "transfers": transfers,
        "ignored": ignored,
    }


def _mark_txns(s: Session, user_id: int, txn_ids: list[int], status: str) -> None:
    for txn_id in txn_ids:
        txn = s.scalar(select(BankTxn).where(BankTxn.id == txn_id, BankTxn.user_id == user_id))
        if txn is None:
            raise ApiError(422, "unknown_txn", f"Bank transaction {txn_id} doesn't exist")
        if txn.status != "pending":
            raise ApiError(409, "txn_not_pending", f"Bank transaction {txn_id} is already {txn.status}")
        txn.status = status


def commit(s: Session, user_id: int, data: LogCommitIn) -> dict[str, Any]:
    """Save everything or nothing: the caller commits the session only if this returns."""
    expenses = [create_expense(s, user_id, e, source="log") for e in data.expenses]
    settlements = [st for item in data.settlements for st in settle(s, user_id, item)]
    _mark_txns(s, user_id, data.transfers, "transfer")
    _mark_txns(s, user_id, data.ignored, "ignored")
    s.flush()
    return {
        "expense_ids": [e.id for e in expenses],
        "settlement_count": len(settlements),
        "transfer_count": len(data.transfers),
        "ignored_count": len(data.ignored),
    }
