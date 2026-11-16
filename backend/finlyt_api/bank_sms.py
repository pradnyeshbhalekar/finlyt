"""A bank SMS pasted into the box → one bank transaction, read by rules (no AI).

Indian banks word their SMS differently, but the parts are the same: an amount, which way the
money went, the account or card, the other side (a UPI ID, a name or a shop), a date and a
reference. `parse()` finds those parts; it doesn't need to know the bank.

Direction comes from whichever money verb comes first, not from the keywords alone: DNS Bank's
credit SMS says "is credited for Rs.9000 ... and debited from VPA x@y", and ICICI's debit SMS
ends with "ZOMATO credited". "Credit card" and "debit card" name a card, not a direction.

Real samples in plan.md have their account digits, refs and names replaced; keep it that way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time

from .money import to_paise
from .timeutil import IST

_NUM = r"(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)"
_CUR = r"(?:rs\.?|inr|₹)"
AMOUNT = re.compile(rf"{_CUR}\s*{_NUM}", re.IGNORECASE)
# "debited by 20.0" (SBI) and "debited for Rs 500" (DNS, ICICI): the amount right after the verb.
VERB_AMOUNT = re.compile(
    rf"\b(?:debited|credited|deducted|spent|paid|sent|received|withdrawn|refunded|deposited)"
    rf"\s+(?:by|for|with|of)?\s*{_CUR}?\s*{_NUM}",
    re.IGNORECASE,
)
# Amounts that are a balance or a limit, not the payment.
BALANCE = re.compile(
    rf"(?:avl|avbl|available|avail|total|clear|closing|a/c|acct)?\.?\s*(?:bal(?:ance)?|limit|lmt)"
    rf"\s*(?:is|:|-|of)?\s*(?:{_CUR})?\s*:?\s*{_NUM}",
    re.IGNORECASE,
)

DEBIT = re.compile(
    r"\b(?:debited|debit(?=\s+(?:of|for|alert|txn|transaction))|sent|spent|paid|withdrawn|"
    r"withdrawal|deducted|purchase(?:d)?|trf to|transferred to|txn of|dr\.?(?=\s))\b",
    re.IGNORECASE,
)
CREDIT = re.compile(
    r"\b(?:credited|received|deposited|refund(?:ed)?|credit alert|cr\.?(?=\s)|added to)\b",
    re.IGNORECASE,
)
# Messages about money that hasn't moved (yet), or that are only codes.
NOT_A_PAYMENT = re.compile(
    r"\b(?:otp|one[- ]time password|verification code|will be (?:debited|credited|deducted)|"
    r"to be debited|is due|due on|due date|payment due|requested|has requested|collect request|"
    r"declined|failed|unsuccessful|could not be|mandate|autopay (?:set|registered)|e-?mandate|"
    r"cashback upto|offer|apply now|pre-?approved|win|congratulations)\b",
    re.IGNORECASE,
)
# Something that names a bank account or card, so a pasted message is a bank's, not a chat.
ACCOUNT_MARKER = re.compile(
    r"\b(?:a/c|a/cx|ac|acct|account|card|upi|vpa|neft|imps|rtgs|ref\s*no|refno|txn|bank)\b",
    re.IGNORECASE,
)
MASKED = re.compile(r"(?:\b[x*]+|\*)\d{3,4}\b|\bending(?:\s+(?:with|in))?\s*\d{4}\b", re.IGNORECASE)
BANK_WORDS = re.compile(r"\b(?:a/c|a/cx|acct|avl\.? bal|avbl|not you|if not (?:you|u)|sms block)\b", re.IGNORECASE)
LAST4 = re.compile(
    r"(?:a/c|a/cx|ac|acct|account|card)\s*(?:no\.?|number|ending(?:\s+(?:with|in))?)?\s*[:.]?\s*"
    r"[x*#.]*\s*[x*]*(\d{3,4})\b",
    re.IGNORECASE,
)
ENDING = re.compile(r"\bending(?:\s+(?:with|in))?\s*[x*]*(\d{4})\b", re.IGNORECASE)
REFERENCE = re.compile(
    r"(?:upi\s*ref(?:\s*no)?|ref(?:erence)?\s*(?:no|number)?|refno|rrn|utr|upi)\s*[:.#-]?\s*(\d{6,})",
    re.IGNORECASE,
)

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1
)}  # fmt: skip
DATE_NUMERIC = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b")
DATE_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
DATE_WORDS = re.compile(
    r"\b(\d{1,2})[- ]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[- ,]?(\d{2,4})\b",
    re.IGNORECASE,
)
TIME = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b", re.IGNORECASE)

# Where the other side is named, most specific first. Each captures the raw name or UPI ID.
_END = r"(?=\s+on\b|\s+dt\b|\s+date\b|\s*[.;(]\s|\s*\(|\s+ref|\s+upi\b|\s+avl|\s+via\b|\s+info|\s+not\b|\s*$)"
DEBIT_PARTY = [
    re.compile(r"\btrf to\s+(?:vpa\s+)?(.+?)" + _END, re.IGNORECASE),
    re.compile(r"[;.]\s*([A-Za-z0-9 .&'@_-]{2,40}?)\s+credited\b", re.IGNORECASE),  # ICICI
    re.compile(r"\bUPI/P2[AM]/\d+/([^/\n]+?)(?:/|\s+not\b|\s*$)", re.IGNORECASE),  # Axis
    re.compile(r"\bto\s+(?:vpa\s+)?(?!your\b|a/c\b|ac\b)(.+?)" + _END, re.IGNORECASE),
    re.compile(r"\bat\s+(?!\d)(.+?)" + _END, re.IGNORECASE),  # card spends: "at ZOMATO on …"
    re.compile(r"\bInfo:?\s*(?:UPI[-/])?([A-Za-z][^.\n]{1,40}?)(?:[-/]\d|\.|\s*$)", re.IGNORECASE),
    re.compile(r"\bon\s+(?!\d|date\b)([A-Za-z][^.;]+?)" + _END, re.IGNORECASE),  # "… on DMART AVENUE."
]
CREDIT_PARTY = [
    re.compile(r"\bfrom\s+(?:vpa\s+)?(?!your\b|a/c\b|ac\b)(.+?)" + _END, re.IGNORECASE),
    re.compile(r"\bby\s+(?!\(|ref\b|upi\b)(?:vpa\s+)?(.+?)" + _END, re.IGNORECASE),
]

BANKS: list[tuple[str, str, tuple[str, ...]]] = [
    # (code, name shown, words that identify it in the message)
    ("kotak", "Kotak", ("kotak",)),
    ("hdfc", "HDFC", ("hdfc",)),
    ("icici", "ICICI", ("icici",)),
    ("sbi", "SBI", ("sbi", "state bank")),
    ("axis", "Axis", ("axis",)),
    ("dns", "DNS Bank", ("dns bank",)),
    ("yes", "Yes Bank", ("yes bank", "yesbank")),
    ("idfc", "IDFC First", ("idfc",)),
    ("indusind", "IndusInd", ("indusind",)),
    ("pnb", "PNB", ("pnb", "punjab national")),
    ("bob", "Bank of Baroda", ("bank of baroda", "bob")),
    ("canara", "Canara", ("canara",)),
    ("union", "Union Bank", ("union bank",)),
    ("federal", "Federal", ("federal bank", "fedbank")),
    ("au", "AU Bank", ("au bank", "au small")),
    ("rbl", "RBL", ("rbl",)),
    ("bandhan", "Bandhan", ("bandhan",)),
    ("idbi", "IDBI", ("idbi",)),
    ("indian", "Indian Bank", ("indian bank",)),
    ("central", "Central Bank", ("central bank",)),
    ("uco", "UCO", ("uco bank",)),
    ("paytm", "Paytm Payments Bank", ("paytm payments bank", "paytm bank")),
    ("airtel", "Airtel Payments Bank", ("airtel payments bank",)),
    ("saraswat", "Saraswat", ("saraswat",)),
    ("cosmos", "Cosmos", ("cosmos bank",)),
    ("hsbc", "HSBC", ("hsbc",)),
    ("citi", "Citi", ("citibank", "citi bank")),
    ("sc", "Standard Chartered", ("standard chartered", "stanchart")),
    ("dbs", "DBS", ("dbs bank", "digibank")),
]


@dataclass(frozen=True)
class BankSms:
    direction: str  # "debit" | "credit"
    amount_paise: int
    channel: str  # "upi" | "card" | "atm" | "neft" | "imps" | "bank"
    counterparty: str | None
    bank: str | None  # a code from BANKS
    last4: str | None
    reference: str | None
    day: date | None
    clock: time | None


def _clean(text: str) -> str:
    return " ".join(text.split())


def looks_like_bank_sms(text: str) -> bool:
    """An amount, a money verb, and something only a bank writes: masked account or card digits
    (X1234), a reference number, "a/c", or a bank's name. "paid rs 200 to rahul by upi" is a note
    someone typed, so it goes to Gemini instead."""
    t = _clean(text)
    if len(t) < 30 or len(t) > 1200:
        return False
    neutral = _cards_neutral(t)
    has_amount = bool(AMOUNT.search(t) or VERB_AMOUNT.search(t))
    has_verb = bool(DEBIT.search(neutral) or CREDIT.search(neutral))
    if not (has_amount and has_verb and ACCOUNT_MARKER.search(t)):
        return False
    return bool(MASKED.search(t) or REFERENCE.search(t) or BANK_WORDS.search(t) or _bank(t))


def is_not_a_payment(text: str) -> bool:
    """OTPs, payment requests, failed payments, reminders and offers: nothing to log."""
    return bool(NOT_A_PAYMENT.search(_clean(text)))


def _cards_neutral(t: str) -> str:
    # "Credit Card XX12" / "Debit Card" name a card, not which way money went.
    return re.sub(r"\b(?:credit|debit)\s*card\b", "card", t, flags=re.IGNORECASE)


def _direction(t: str) -> str | None:
    t = _cards_neutral(t)
    debit, credit = DEBIT.search(t), CREDIT.search(t)
    if debit and credit:
        return "debit" if debit.start() < credit.start() else "credit"
    if debit:
        return "debit"
    if credit:
        return "credit"
    return None


def _amount(t: str) -> int | None:
    balances = [m.span() for m in BALANCE.finditer(t)]

    def inside_balance(pos: int) -> bool:
        return any(a <= pos < b for a, b in balances)

    candidates = [m for m in AMOUNT.finditer(t) if not inside_balance(m.start())]
    verb = next((m for m in VERB_AMOUNT.finditer(t) if not inside_balance(m.start(1))), None)
    match = min([m for m in [*candidates[:1], verb] if m], key=lambda m: m.start(), default=None)
    if match is None:
        return None
    paise = to_paise(match.group(1).replace(",", ""))
    return paise if paise > 0 else None


def _bank(t: str) -> str | None:
    """The bank named first. UPI IDs are left out: "x@okhdfcbank" says nothing about my bank."""
    low = re.sub(r"\S+@\S+", " ", t.lower())
    low = re.sub(r"https?://\S+", " ", low)
    hits = []
    for code, _, words in BANKS:
        for word in words:
            if m := re.search(rf"\b{re.escape(word.strip())}", low):
                hits.append((m.start(), code))
                break
    return min(hits)[1] if hits else None


def _last4(t: str) -> str | None:
    m = ENDING.search(t) or LAST4.search(t)
    return m.group(1) if m else None


def _year(y: str) -> int:
    n = int(y)
    return n + 2000 if n < 100 else n


def _day(t: str) -> date | None:
    for pattern, order in ((DATE_ISO, "ymd"), (DATE_WORDS, "dmy-words"), (DATE_NUMERIC, "dmy")):
        m = pattern.search(t)
        if not m:
            continue
        try:
            if order == "ymd":
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            if order == "dmy-words":
                return date(_year(m.group(3)), _MONTHS[m.group(2).lower()[:3]], int(m.group(1)))
            return date(_year(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            continue
    return None


def _clock(t: str) -> time | None:
    for pattern in (DATE_ISO, DATE_WORDS, DATE_NUMERIC):
        t = pattern.sub(" ", t)
    m = TIME.search(t)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    ampm = (m.group(4) or "").lower()
    if ampm == "pm" and hour < 12:
        hour += 12
    if ampm == "am" and hour == 12:
        hour = 0
    return time(hour, minute)


def _channel(t: str) -> str:
    low = t.lower()
    if re.search(r"\batm\b|cash withdrawal|withdrawn", low):
        return "atm"
    if re.search(r"\bupi\b|\bvpa\b|@[a-z]", low):
        return "upi"
    if "card" in low:
        return "card"
    for name in ("neft", "imps", "rtgs"):
        if re.search(rf"\b{name}\b", low):
            return name
    return "bank"


_JUNK = re.compile(r"^(?:your|you|a/c|ac|acct|account|bank|the|on|by|for|upi|vpa|card|ref)\b", re.IGNORECASE)
_NOT_A_NAME = re.compile(
    rf"^{_CUR}?\s*[\d,.]+$|^{_CUR}\.?\s*\d|\b(?:a/c|acct|account|card|bank)\b|\bx{{2,}}\d", re.IGNORECASE
)


def _party(t: str, direction: str) -> str | None:
    for pattern in DEBIT_PARTY if direction == "debit" else CREDIT_PARTY:
        for m in pattern.finditer(t):
            raw = m.group(1).strip(" .,:;-/")
            raw = re.sub(r"\s+(?:on|dt)\s*$", "", raw, flags=re.IGNORECASE)
            if not raw or _JUNK.match(raw) or re.fullmatch(r"[\d\s:/.-]+", raw) or _NOT_A_NAME.search(raw):
                continue  # an amount, a date or one of my own accounts, not the other side
            return raw[:80]
    return None


def parse(text: str) -> BankSms | None:
    """The transaction in a bank SMS, or None when it isn't one this can read."""
    t = _clean(text)
    if not looks_like_bank_sms(t) or is_not_a_payment(t):
        return None
    direction = _direction(t)
    amount = _amount(t)
    if direction is None or amount is None:
        return None
    ref = REFERENCE.search(t)
    return BankSms(
        direction=direction,
        amount_paise=amount,
        channel=_channel(t),
        counterparty=_party(t, direction),
        bank=_bank(t),
        last4=_last4(t),
        reference=ref.group(1) if ref else None,
        day=_day(t),
        clock=_clock(t),
    )


def when(sms: BankSms, now: datetime) -> datetime:
    """When it happened, in IST: the SMS's date and time when they make sense, else now."""
    today = now.astimezone(IST).date()
    day = sms.day if sms.day and (today - sms.day).days in range(0, 400) else None
    if day is None:
        return now.astimezone(IST)
    if sms.clock is not None:
        at = datetime.combine(day, sms.clock, tzinfo=IST)
        return at if at <= now.astimezone(IST) else now.astimezone(IST)
    if day == today:
        return now.astimezone(IST)
    return datetime.combine(day, time(12, 0), tzinfo=IST)


def bank_name(code: str | None) -> str | None:
    return next((name for c, name, _ in BANKS if c == code), None)
