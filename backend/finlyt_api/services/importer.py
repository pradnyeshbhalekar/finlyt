"""Import from an AI chat: the expenses someone tracked in Claude, ChatGPT or Gemini.

1. The app copies a prompt (built from my categories and accounts) to paste into that chat.
2. The chat answers with one JSON block. It's read here; if it drifted from the format, Gemini
   repairs it.
3. The preview maps every entry onto my accounts, categories and people, flags what looks like
   it's already logged, and links bank payments from SMS that are still waiting to be logged.
4. The kept entries are saved as one batch, oldest first, so paybacks find their dues. A
   payback or repayment that doesn't fit what's owed is skipped rather than failing the import.
5. Undoing deletes the batch and everything it made.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..gemini import GImport, GImportEntry, get_import_fixer
from ..models import Account, BankTxn, Category, Debt, Expense, ImportBatch, Settlement
from ..money import rupees, to_paise
from ..schemas import DebtIn, DueIn, ExpenseIn, ImportCommitIn, ImportEntryIn, RepayIn, SettlementIn
from ..timeutil import IST, ist_day_bounds, today_ist
from . import debts
from .dues import settle
from .expenses import create_expense, delete_expense, sync_txn_statuses

SOURCES = {"claude": "Claude", "chatgpt": "ChatGPT", "gemini": "Gemini", "other": "the AI chat"}
NOON = time(12, 0)

PROMPT = """\
I'm moving my expense tracking into an app called Finlyt. Go through this ENTIRE conversation, \
from the very first message, and pull out every expense and money movement I've told you about.

Reply with ONLY one JSON code block, nothing before or after it, in exactly this shape:

```json
{{
  "version": 1,
  "entries": [
    {{
      "date": "2026-10-30",
      "time": "13:30",
      "type": "expense",
      "description": "Lunch at Zomato with Rahul",
      "category": "Food",
      "amount": 450,
      "my_share": 250,
      "payments": [{{ "method": "{example_method}", "amount": 450 }}],
      "owed_by": [{{ "person": "Rahul", "amount": 200 }}],
      "person": null,
      "notes": ""
    }}
  ]
}}
```

Rules:
- One entry per item, oldest first. Don't merge items, skip small ones, or invent anything. If I \
gave you daily totals, list the individual items instead.
- date: YYYY-MM-DD. If I only said "today" or "yesterday", work out the real date from context. \
If unsure, give your best guess and write "date uncertain" in notes.
- time: "HH:MM" (24-hour) if known, otherwise null.
- amount: the full amount, as a plain number in rupees (no ₹, no commas).
- type:
  - "expense": something I paid for.
  - "payback": someone returning money they owed me (person = who, amount = how much).
  - "owe": someone paid for me and I owe them (person = who; description and category = what it was).
  - "repay": me paying back someone I owed (person = who; payments = how I paid).
  - "income": money I earned or received that isn't a payback.
  - "transfer": an ATM withdrawal or moving money between my own accounts.
- payments: how it was paid. method is one of {methods}. The amounts must add up to amount. \
Half cash, half GPay from {example_method} → [{{"method": "{example_method}", "amount": 250}}, \
{{"method": "cash", "amount": 250}}].
- my_share: my part if it was split, otherwise the same as amount. owed_by: who owes me what for \
this expense (empty list if nobody).
- category: one of {categories}.
- notes: anything else useful, otherwise "".
"""

FIX_PROMPT = """\
This is a reply from an AI chat that was asked to list someone's expenses as JSON in a fixed \
format, but it didn't follow the format exactly (or added text around it). Turn it into the \
format: one entry per item it lists, with the same dates, amounts, people and payment methods. \
Don't invent entries or amounts. Dates are YYYY-MM-DD, amounts are rupees as plain numbers. \
Types are expense, payback, owe, repay, income or transfer.
"""


def build_prompt(s: Session, user_id: int) -> str:
    accounts = list(s.scalars(select(Account).where(Account.user_id == user_id).order_by(Account.id)))
    categories = list(
        s.scalars(
            select(Category.name)
            .where(Category.user_id == user_id, Category.is_active.is_(True))
            .order_by(Category.sort_order, Category.id)
        )
    )
    banks = [a.name for a in accounts if a.kind == "bank"]
    methods = [f'"{name}"' for name in banks] + ['"cash"', '"upi" (bank unknown)', '"card"', '"unknown"']
    return PROMPT.format(
        example_method=banks[0] if banks else "upi",
        methods=", ".join(methods),
        categories=", ".join(categories) or "Other",
    )


# ── Reading the reply ────────────────────────────────────────────────────────

_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.S)


def _json_candidates(text: str) -> list[str]:
    found = [m.group(1).strip() for m in _FENCE.finditer(text)]
    for open_char, close_char in (("{", "}"), ("[", "]")):
        start, end = text.find(open_char), text.rfind(close_char)
        if start != -1 and end > start:
            found.append(text[start : end + 1])
    return found


def parse_reply(text: str) -> GImport | None:
    """The JSON block in an AI chat's reply, if it's readable as is."""
    for candidate in _json_candidates(text):
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(data, list):
            data = {"entries": data}
        try:
            parsed = GImport.model_validate(data)
        except ValidationError:
            continue
        if parsed.entries:
            return parsed
    return None


def read_reply(text: str) -> tuple[GImport, bool]:
    """The entries, and whether Gemini had to repair the reply."""
    parsed = parse_reply(text)
    if parsed is not None:
        return parsed, False
    today = today_ist()
    system = (
        f"{FIX_PROMPT}\nToday is {today.strftime('%A %d %B %Y')}. A date without a year is the most recent "
        "one on or before today (so this year, or last year if this year's would be in the future)."
    )
    fixed, _ = get_import_fixer()(system=system, text=text[:200_000])
    if not fixed.entries:
        raise ApiError(422, "nothing_found", "Couldn't find any expenses in that. Paste the whole reply.")
    return fixed, True


# ── The preview ──────────────────────────────────────────────────────────────


class _Mapper:
    """Turns the chat's words (method names, categories) into my accounts and categories."""

    def __init__(self, s: Session, user_id: int) -> None:
        self.accounts = list(s.scalars(select(Account).where(Account.user_id == user_id).order_by(Account.id)))
        cats = s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all()
        self.categories = {name.lower(): cid for cid, name in cats}
        banks = [a for a in self.accounts if a.kind == "bank"]
        self.cash = next((a for a in self.accounts if a.kind == "cash"), None)
        self.primary = next((a for a in banks if a.is_primary), None) or (banks[0] if banks else self.cash)

    def account(self, method: str) -> tuple[Account | None, bool]:
        """The account a payment method means, and whether it was a guess."""
        m = method.strip().lower()
        if m == "cash" and self.cash is not None:
            return self.cash, False
        for a in self.accounts:
            names = {a.name.lower(), (a.bank_code or "").lower()} - {""}
            if m in names or any(n in m or m in n for n in names if len(m) >= 3):
                return a, False
        return self.primary, m not in ("upi", "card", "unknown", "")

    def category(self, name: str) -> int | None:
        return self.categories.get(name.strip().lower()) or self.categories.get("other")


def _when(entry: GImportEntry) -> datetime | None:
    try:
        day = date.fromisoformat(entry.date.strip()[:10])
    except ValueError:
        return None
    at = NOON
    if entry.time:
        try:
            at = time.fromisoformat(entry.time.strip()[:5])
        except ValueError:
            at = NOON
    return datetime.combine(day, at, IST)


def _entry(index: int, e: GImportEntry, mapper: _Mapper, today: date) -> dict[str, Any]:
    kind = e.type.strip().lower()
    item: dict[str, Any] = {
        "index": index,
        "kind": kind,
        "skip_reason": None,
        "occurred_at": None,
        "day": None,
        "description": (e.description or "").strip()[:200] or kind.title(),
        "category_id": mapper.category(e.category or "Other"),
        "amount_paise": 0,
        "my_share_paise": None,
        "payments": [],
        "dues": [],
        "person_name": (e.person or "").strip()[:64] or None,
        "note_raw": (e.notes or "").strip()[:4000] or None,
        "warnings": [],
        "duplicate": False,
        "include": True,
    }

    def skip(reason: str) -> dict[str, Any]:
        item.update(kind="skip", skip_reason=reason, include=False)
        return item

    when = _when(e)
    if when is not None:
        item["occurred_at"] = when.isoformat()
        item["day"] = when.date().isoformat()
    try:
        amount = to_paise(e.amount)
    except ValueError:
        amount = 0
    item["amount_paise"] = max(amount, 0)

    if kind in ("income", "transfer"):
        return skip(kind)
    if kind not in ("expense", "payback", "owe", "repay"):
        return skip("unknown type")
    if when is None:
        return skip("no date")
    if when.date() > today:
        return skip("dated in the future")
    if amount <= 0:
        return skip("no amount")
    if kind != "expense":
        if not item["person_name"]:
            # The chat sometimes puts the person in owed_by instead.
            item["person_name"] = e.owed_by[0].person.strip()[:64] if e.owed_by else None
        if not item["person_name"]:
            return skip("no person")
    if kind == "repay" or kind == "expense":
        payments: list[dict[str, Any]] = []
        for p in e.payments:
            account, guessed = mapper.account(p.method)
            paise = to_paise(p.amount) if p.amount else 0
            if account is None or paise <= 0:
                continue
            if guessed:
                item["warnings"].append(f"Paid with “{p.method}”: saved to {account.name}")
            payments.append({"account_id": account.id, "amount_paise": paise, "bank_txn_id": None})
        paid = sum(p["amount_paise"] for p in payments)
        if not payments and mapper.primary is not None:
            payments = [{"account_id": mapper.primary.id, "amount_paise": amount, "bank_txn_id": None}]
        elif paid != amount:
            if len(payments) == 1:
                payments[0]["amount_paise"] = amount
            else:
                item["warnings"].append(f"The payments added up to {rupees(paid)}, so it's saved as {rupees(paid)}")
                amount = paid
                item["amount_paise"] = paid
        item["payments"] = payments
    if kind == "expense":
        dues = [
            {"person_name": o.person.strip()[:64], "amount_paise": to_paise(o.amount)}
            for o in e.owed_by
            if o.person.strip() and o.amount and to_paise(o.amount) > 0
        ]
        owed = sum(d["amount_paise"] for d in dues)
        if owed > amount:
            item["warnings"].append("More was owed than was paid, so who owes what was dropped")
            dues, owed = [], 0
        item["dues"] = dues
        mine = amount - owed
        if e.my_share is not None and to_paise(e.my_share) != mine:
            item["warnings"].append(f"Your share is saved as {rupees(mine)} (the total minus what's owed)")
        item["my_share_paise"] = mine
    return item


def preview(s: Session, user_id: int, text: str, source: str) -> dict[str, Any]:
    doc, repaired = read_reply(text)
    mapper = _Mapper(s, user_id)
    today = today_ist()
    entries = [_entry(i, e, mapper, today) for i, e in enumerate(doc.entries)]
    entries.sort(key=lambda x: (x["occurred_at"] or "9999", x["index"]))
    kept = [x for x in entries if x["kind"] != "skip"]

    if kept:
        first = date.fromisoformat(min(x["day"] for x in kept))
        last = date.fromisoformat(max(x["day"] for x in kept))
        start, end = ist_day_bounds(first, last)
        # Already logged: an expense on the same day for the same amount.
        logged = {
            (at.astimezone(IST).date().isoformat(), total)
            for at, total in s.execute(
                select(Expense.occurred_at, Expense.total_paise).where(
                    Expense.user_id == user_id, Expense.occurred_at >= start, Expense.occurred_at < end
                )
            ).all()
        }
        # Bank payments from SMS still waiting to be logged: link the matching ones.
        waiting: dict[tuple[str, int, int], list[int]] = {}
        for txn_id, account_id, at, paise in s.execute(
            select(BankTxn.id, BankTxn.account_id, BankTxn.occurred_at, BankTxn.amount_paise).where(
                BankTxn.user_id == user_id,
                BankTxn.status == "pending",
                BankTxn.direction == "debit",
                BankTxn.occurred_at >= start,
                BankTxn.occurred_at < end,
            )
        ).all():
            waiting.setdefault((at.astimezone(IST).date().isoformat(), account_id, paise), []).append(txn_id)
        for x in kept:
            if x["kind"] == "expense" and (x["day"], x["amount_paise"]) in logged:
                x["duplicate"] = True
                x["include"] = False
            for p in x["payments"]:
                ids = waiting.get((x["day"], p["account_id"], p["amount_paise"]))
                if ids:
                    p["bank_txn_id"] = ids.pop(0)

    included = [x for x in entries if x["include"]]
    days = sorted({x["day"] for x in kept})
    return {
        "source": source,
        "repaired": repaired,
        "entries": entries,
        "summary": {
            "found": len(entries),
            "importable": len(kept),
            "duplicates": sum(1 for x in kept if x["duplicate"]),
            "skipped": len(entries) - len(kept),
            "first_day": days[0] if days else None,
            "last_day": days[-1] if days else None,
            "spent_paise": sum(x["my_share_paise"] or 0 for x in included if x["kind"] == "expense"),
        },
    }


# ── Saving, listing and undoing ──────────────────────────────────────────────


def _save_one(s: Session, user_id: int, batch: ImportBatch, e: ImportEntryIn) -> None:
    if e.kind == "expense":
        create_expense(
            s,
            user_id,
            ExpenseIn(
                occurred_at=e.occurred_at,
                description=e.description,
                category_id=e.category_id,
                payments=e.payments,
                dues=[DueIn(person_name=d.person_name, amount_paise=d.amount_paise) for d in e.dues],
                note_raw=e.note_raw,
            ),
            source="import",
            import_batch_id=batch.id,
        )
    elif e.kind == "payback":
        for st in settle(s, user_id, SettlementIn(person_name=e.person_name, amount_paise=e.amount_paise, settled_at=e.occurred_at)):
            st.method = "import"
            st.import_batch_id = batch.id
    elif e.kind == "owe":
        debt = debts.create_debt(
            s,
            user_id,
            DebtIn(
                person_name=e.person_name,
                amount_paise=e.amount_paise,
                description=e.description,
                category_id=e.category_id,
                occurred_at=e.occurred_at,
                note_raw=e.note_raw,
            ),
        )
        debt.import_batch_id = batch.id
    else:  # repay
        account_id = e.payments[0].account_id if e.payments else None
        expense = debts.repay_from_request(
            s,
            user_id,
            RepayIn(person_name=e.person_name, amount_paise=e.amount_paise, account_id=account_id, paid_at=e.occurred_at),
            e.note_raw,
        )
        expense.source = "import"
        expense.import_batch_id = batch.id
    s.flush()


def commit(s: Session, user_id: int, data: ImportCommitIn) -> dict[str, Any]:
    """Save the kept entries as one batch. Each entry is its own savepoint, so one that doesn't
    fit (paying back more than is owed) is reported and skipped, and the rest still go in."""
    batch = ImportBatch(user_id=user_id, source=data.source, raw_text=data.raw_text or "", entry_count=0)
    s.add(batch)
    s.flush()
    saved: dict[str, int] = {"expense": 0, "payback": 0, "owe": 0, "repay": 0}
    skipped: list[dict[str, Any]] = []
    for i, entry in sorted(enumerate(data.entries), key=lambda pair: (pair[1].occurred_at, pair[0])):
        point = s.begin_nested()
        try:
            _save_one(s, user_id, batch, entry)
            point.commit()
            saved[entry.kind] += 1
        except ApiError as e:
            point.rollback()
            skipped.append({"index": i, "description": entry.description, "reason": e.message})
    batch.entry_count = sum(saved.values())
    if batch.entry_count == 0:
        raise ApiError(422, "nothing_imported", skipped[0]["reason"] if skipped else "Nothing to import")
    s.flush()
    return {"batch_id": batch.id, "imported": batch.entry_count, "saved": saved, "skipped": skipped}


def list_batches(s: Session, user_id: int) -> list[dict[str, Any]]:
    spans = dict(
        (bid, (lo, hi))
        for bid, lo, hi in s.execute(
            select(Expense.import_batch_id, func.min(Expense.occurred_at), func.max(Expense.occurred_at))
            .where(Expense.user_id == user_id, Expense.import_batch_id.is_not(None))
            .group_by(Expense.import_batch_id)
        ).all()
    )
    out = []
    for b in s.scalars(select(ImportBatch).where(ImportBatch.user_id == user_id).order_by(ImportBatch.created_at.desc())):
        lo, hi = spans.get(b.id, (None, None))
        out.append(
            {
                "id": b.id,
                "source": b.source,
                "source_name": SOURCES.get(b.source, "an AI chat"),
                "entry_count": b.entry_count,
                "created_at": b.created_at.astimezone(IST).isoformat(),
                "first_day": lo.astimezone(IST).date().isoformat() if lo else None,
                "last_day": hi.astimezone(IST).date().isoformat() if hi else None,
            }
        )
    return out


def undo(s: Session, user_id: int, batch_id: int) -> None:
    batch = s.get(ImportBatch, batch_id)
    if batch is None or batch.user_id != user_id:
        raise ApiError(404, "not_found", "That import isn't there any more.")
    expenses = list(s.scalars(select(Expense).where(Expense.import_batch_id == batch.id)))
    # Money I owed from before the import, paid back by an imported repayment, is owed again.
    s.execute(
        update(Debt)
        .where(Debt.user_id == user_id, Debt.import_batch_id.is_(None), Debt.expense_id.in_([e.id for e in expenses] or [-1]))
        .values(status="open", settled_at=None, expense_id=None)
    )
    for expense in expenses:
        delete_expense(s, expense)  # also puts linked bank payments back in "To log"
    txn_ids = set(s.scalars(select(Settlement.bank_txn_id).where(Settlement.import_batch_id == batch.id)))
    s.delete(batch)  # the batch's paybacks and money owed go with it
    s.flush()
    sync_txn_statuses(s, txn_ids)
