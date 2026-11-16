"""A bank SMS pasted into the box (or sent from "Paste a bank SMS") becomes a proposal by rules.

bank_sms.parse() reads the message; this turns it into what Gemini would have answered, so the
usual resolve step, the "Look right?" card and /api/log/commit all work unchanged:
- money out: one expense, paid from the account the SMS names, described by who it went to and
  put in a category from the payee's name ("ZOMATO" is Food). If it went to someone I owe exactly
  that much, it's me paying them back instead.
- money in from someone who owes me: their payback. Other money in isn't spending, so nothing
  is proposed and the reply says what to type if it was a payback.
- ATM withdrawals, OTPs, requests and failed payments: nothing to log, with a line saying why.
Messages the rules can't read go to Gemini like any other note (the prompt mentions SMS).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import bank_sms
from ..counterparty import display_name
from ..gemini import GExpense, GPayment, GProposal, GRepay, GSettlement
from ..models import Account, Expense, Person
from ..money import rupees
from ..timeutil import IST
from .dues import open_dues, outstanding
from .quick_parse import BRANDS, category_for


@dataclass
class Pasted:
    answer: GProposal
    # Things the person should look at before saving; they go on the expense after resolving.
    issues: list[str] = field(default_factory=list)


def _proposal(**parts) -> GProposal:
    values: dict = {"transcript": "", "expenses": [], "settlements": [], "transfers": [], "ignored": [], "questions": []}
    return GProposal(**(values | parts))


def _nothing(reason: str) -> Pasted:
    """Nothing to log; the reason is shown under the box."""
    return Pasted(_proposal(questions=[reason]))


def _account(ctx, sms: bank_sms.BankSms) -> tuple[Account, bool]:
    """The account the SMS is about, and whether that was a guess between several banks."""
    banks = [a for a in ctx.accounts if a.kind == "bank"]
    if sms.last4:
        for a in banks:
            if a.last4 and (a.last4.endswith(sms.last4) or sms.last4.endswith(a.last4)):
                return a, False
    if sms.bank:
        shown = (bank_sms.bank_name(sms.bank) or "").lower()
        for a in banks:
            name = a.name.lower()
            if a.bank_code == sms.bank or (shown and shown.split()[0] in name.split()) or sms.bank in name.split():
                return a, False
    primary = ctx.primary if ctx.primary.kind == "bank" else (banks[0] if banks else ctx.primary)
    return primary, len(banks) > 1


def _brand(name: str) -> str | None:
    for word in re.findall(r"[a-z]+", name.lower()):
        if word in BRANDS:
            return BRANDS[word]
    squashed = re.sub(r"[^a-z]", "", name.lower())
    return next((brand for key, brand in BRANDS.items() if squashed.startswith(key)), None)


def _description(sms: bank_sms.BankSms) -> str:
    if not sms.counterparty:
        return {"card": "Card payment", "upi": "UPI payment"}.get(sms.channel, "Bank payment")
    name = display_name(sms.counterparty)
    if brand := _brand(f"{sms.counterparty} {name}"):
        return brand
    if name == "UPI QR payment" or name.startswith("UPI "):
        return name
    if sms.channel == "card":
        return name  # a shop: "Dmart Avenue"
    return f"UPI to {name}" if sms.channel == "upi" else f"Paid {name}"


def _person(ctx, sms: bank_sms.BankSms) -> Person | None:
    """Someone I know, by a UPI ID or bank-shown name they've paid from, or by first name."""
    if not sms.counterparty:
        return None
    raw = sms.counterparty.strip().lower()
    name = display_name(sms.counterparty).lower()
    first = name.split()[0] if name.split() else ""
    for p in ctx.people:
        aliases = {a.lower() for a in p.aliases or []}
        if raw in aliases or name in aliases or p.name.lower() in {name, first}:
            return p
    return None


def _when(at: datetime) -> str:
    return at.astimezone(IST).strftime("%Y-%m-%d %H:%M")


def _logged_before(s: Session, user_id: int, text: str) -> datetime | None:
    return s.scalar(
        select(Expense.occurred_at)
        .where(Expense.user_id == user_id, Expense.note_raw == text.strip())
        .order_by(Expense.occurred_at.desc())
        .limit(1)
    )


def propose(s: Session, user_id: int, ctx, text: str, *, now: datetime) -> Pasted | None:
    """None when the text isn't a bank SMS the rules can read (Gemini gets it then)."""
    if not bank_sms.looks_like_bank_sms(text):
        return None
    if bank_sms.is_not_a_payment(text):
        return _nothing(
            "That SMS isn't a payment (it's a code, a request, a reminder or a payment that didn't "
            "go through), so there's nothing to log."
        )
    sms = bank_sms.parse(text)
    if sms is None:
        return None

    amount = sms.amount_paise / 100
    at = bank_sms.when(sms, now)

    if sms.direction == "credit":
        person = _person(ctx, sms)
        owed = sum(outstanding(d) for d in open_dues(s, user_id, person.id)) if person else 0
        if person is not None and owed > 0:
            return Pasted(_proposal(settlements=[GSettlement(person=person.name, amount=amount, txn=None)]))
        who = display_name(sms.counterparty) if sms.counterparty else None
        named = who is not None and not who.startswith("UPI")
        first = who.split()[0] if named and who else None
        coming = f"That's {rupees(sms.amount_paise)} coming in{f' from {who}' if named else ''}, so it isn't spending."
        if first:
            return _nothing(f"{coming} If {first} was paying you back, type “{first} paid me back {round(amount)}”.")
        return _nothing(f"{coming} If someone was paying you back, say who, like “Rahul paid me back {round(amount)}”.")

    if sms.channel == "atm":
        return _nothing(
            f"That's {rupees(sms.amount_paise)} taken out at an ATM. It moves your own money to cash, "
            "so it isn't spending. Log what you spend the cash on instead."
        )

    # Paying back someone I owe exactly this much.
    person = _person(ctx, sms)
    if person is not None:
        mine = [d for d in ctx.debts if d.person_id == person.id]
        if mine and sms.amount_paise in {sum(d.amount_paise for d in mine), *(d.amount_paise for d in mine)}:
            return Pasted(_proposal(repaid=[GRepay(person=person.name, amount=amount, txn=None)]))

    account, guessed = _account(ctx, sms)
    description = _description(sms)
    names = [c.name for c in ctx.categories]
    category = category_for(f"{description} {display_name(sms.counterparty)}", names) or (
        "Other" if any(n.lower() == "other" for n in names) else names[0]
    )
    expense = GExpense(
        description=description,
        category=category,
        time=_when(at),
        total=amount,
        my_share=amount,
        payments=[GPayment(source=account.name, amount=amount)],
        owed_by=[],
    )
    issues: list[str] = []
    if guessed:
        bank = bank_sms.bank_name(sms.bank)
        issues.append(
            f"Couldn't tell which of your accounts {f'“{bank}” is' if bank else 'this was'}, so it's set to "
            f"{account.name}. Tap Edit to change it."
        )
    if before := _logged_before(s, user_id, text):
        day = before.astimezone(IST).strftime("%-d %b")
        issues.append(f"You logged this SMS already, on {day}. Save it again only if it's a second payment.")
    return Pasted(_proposal(expenses=[expense]), issues)
