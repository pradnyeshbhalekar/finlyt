"""Bank SMS → transaction. One parser per known format (see plan.md, "Known formats").

Direction comes from the sentence structure, not keywords: DNS Bank's credit SMS also says
"debited from VPA". Kotak gives only a date, so its time is when the SMS arrived.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime

from .money import to_paise
from .timeutil import IST

AMOUNT = r"Rs\.?\s*([\d,]+(?:\.\d{1,2})?)"


@dataclass(frozen=True)
class ParsedTxn:
    direction: str  # "debit" | "credit"
    amount_paise: int
    counterparty: str | None
    reference: str | None
    occurred_at: datetime | None  # None: use when the SMS arrived
    channel: str
    last4: str | None


KOTAK_DEBIT = re.compile(
    rf"Sent {AMOUNT} from Kotak Bank A(?:/c|C)\s*X*(\d{{3,4}}) to (.+?) on (\d{{2}}-\d{{2}}-\d{{2,4}})\.?\s*"
    r"UPI Ref:?\s*(\d+)",
    re.IGNORECASE,
)
KOTAK_CREDIT = re.compile(
    rf"Received {AMOUNT} in your Kotak Bank A(?:/c|C)\s*X*(\d{{3,4}}) from (.+?) on "
    r"(\d{2}-\d{2}-\d{2,4})\.?\s*UPI Ref:?\s*(\d+)",
    re.IGNORECASE,
)
DNS_DEBIT = re.compile(
    rf"a/c no\.?\s*X*(\d{{3,4}}) debited for {AMOUNT} on (\d{{2}}-\d{{2}}-\d{{4}}) (\d{{2}}:\d{{2}}:\d{{2}}) "
    r"trf to (.+?) \(RefNo\s*(\d+)\s*\)",
    re.IGNORECASE,
)
DNS_CREDIT = re.compile(
    rf"a/c no\.?\s*X*(\d{{3,4}}) is credited for {AMOUNT} on (\d{{2}}-\d{{2}}-\d{{4}}) "
    r"(\d{2}:\d{2}:\d{2}) and debited from VPA (.+?) \(UPI Ref no\s*(\d+)\s*\)",
    re.IGNORECASE,
)

OTP = re.compile(r"\b(?:OTP|one[- ]time password|verification code)\b", re.IGNORECASE)


def _dns_time(day: str, clock: str) -> datetime | None:
    try:
        return datetime.strptime(f"{day} {clock}", "%d-%m-%Y %H:%M:%S").replace(tzinfo=IST)
    except ValueError:
        return None


def parse(bank_code: str, body: str) -> ParsedTxn | None:
    text = " ".join(body.split())
    if OTP.search(text):
        return None
    if bank_code == "kotak":
        if m := KOTAK_DEBIT.search(text):
            amount, last4, party, _day, ref = m.groups()
            return ParsedTxn("debit", to_paise(amount.replace(",", "")), party.strip(), ref, None, "upi", last4)
        if m := KOTAK_CREDIT.search(text):
            amount, last4, party, _day, ref = m.groups()
            return ParsedTxn("credit", to_paise(amount.replace(",", "")), party.strip(), ref, None, "upi", last4)
    if bank_code == "dns":
        if m := DNS_CREDIT.search(text):
            last4, amount, day, clock, party, ref = m.groups()
            return ParsedTxn(
                "credit", to_paise(amount.replace(",", "")), party.strip(), ref, _dns_time(day, clock), "upi", last4
            )
        if m := DNS_DEBIT.search(text):
            last4, amount, day, clock, party, ref = m.groups()
            return ParsedTxn(
                "debit", to_paise(amount.replace(",", "")), party.strip(), ref, _dns_time(day, clock), "upi", last4
            )
    return None


_KNOWN = {
    "zomato": "Zomato", "swiggy": "Swiggy", "uber": "Uber", "olacabs": "Ola", "ola": "Ola",
    "rapido": "Rapido", "blinkit": "Blinkit", "zepto": "Zepto", "dmart": "DMart",
    "amazon": "Amazon", "flipkart": "Flipkart", "irctc": "IRCTC", "jio": "Jio", "airtel": "Airtel",
    "bigbasket": "BigBasket", "myntra": "Myntra", "netflix": "Netflix", "spotify": "Spotify",
}  # fmt: skip


def display_name(counterparty: str | None) -> str:
    """A readable name for a UPI ID or bank-shown name: "zomato@hdfcbank" → "Zomato"."""
    if not counterparty:
        return "Payment"
    raw = counterparty.strip()
    if "@" not in raw:
        return " ".join(w.capitalize() for w in raw.split())[:40]  # a name, e.g. "RAHUL SHARMA"
    local = raw.split("@", 1)[0].lower()
    for key, name in _KNOWN.items():
        if local.startswith(key):
            return name
    if local.startswith("paytmqr") or local.startswith("q") and local[1:].isdigit():
        return "UPI QR payment"
    if re.fullmatch(r"\d{10}", local):
        return f"UPI {local[:2]}••••{local[-2:]}"
    words = re.sub(r"[\d._-]+", " ", local).split()
    return " ".join(w.capitalize() for w in words)[:40] or raw
