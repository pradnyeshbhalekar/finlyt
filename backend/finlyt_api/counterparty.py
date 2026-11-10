"""Readable names for the other side of a bank payment (a UPI ID or a bank-shown name)."""

from __future__ import annotations

import re

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
