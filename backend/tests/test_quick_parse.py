"""Simple notes are parsed without AI; anything else must be left to Gemini (None)."""

from __future__ import annotations

from datetime import datetime

import pytest

from finlyt_api.models import Account, BankTxn, Category, Person
from finlyt_api.services.proposals import LogContext
from finlyt_api.services.quick_parse import parse
from finlyt_api.timeutil import IST

NOW = datetime(2026, 11, 5, 20, 30, tzinfo=IST)
NAMES = ["Food", "Groceries", "Transport", "Shopping", "Bills", "Rent", "Fitness", "Entertainment",
         "Health", "Personal care", "Education", "Travel", "Gifts", "Investments", "Other"]  # fmt: skip


def ctx(txns=()) -> LogContext:
    return LogContext(
        accounts=[
            Account(id=1, name="Kotak", kind="bank", bank_code="kotak", is_primary=True),
            Account(id=2, name="DNS Bank", kind="bank", bank_code="dns", is_primary=False),
            Account(id=3, name="Cash", kind="cash", bank_code=None, is_primary=False),
        ],
        categories=[Category(id=i, name=n) for i, n in enumerate(NAMES, 1)],
        people=[Person(id=1, name="Rahul", aliases=["rahul@okaxis"])],
        txns=list(txns),
    )


def items(text: str, context: LogContext | None = None):
    proposal = parse(text, context or ctx(), now=NOW)
    if proposal is None:
        return None
    return [
        (e.description, e.category, e.total, e.payments[0].source, e.time) for e in proposal.expenses
    ]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("chai 40", [("Chai", "Food", 40, "Kotak")]),
        ("chai 40 cash", [("Chai", "Food", 40, "Cash")]),
        ("Auto ₹120", [("Auto", "Transport", 120, "Kotak")]),
        ("40 rs samosa", [("Samosa", "Food", 40, "Kotak")]),
        ("paid 250 for lunch via gpay", [("Lunch", "Food", 250, "Kotak")]),
        ("metro 30 dns", [("Metro", "Transport", 30, "DNS Bank")]),
        ("dmart groceries 1.2k upi", [("DMart groceries", "Groceries", 1200, "Kotak")]),
        ("rent 15,000 kotak", [("Rent", "Rent", 15000, "Kotak")]),
        ("Petrol 500/-", [("Petrol", "Transport", 500, "Kotak")]),
        (
            "chai 40 cash, samosa 30 and uber 250",
            [("Chai", "Food", 40, "Cash"), ("Samosa", "Food", 30, "Kotak"), ("Uber", "Transport", 250, "Kotak")],
        ),
        ("chai 40 cash aur auto 120", [("Chai", "Food", 40, "Cash"), ("Auto", "Transport", 120, "Kotak")]),
    ],
)
def test_simple_notes_parse_without_ai(text, expected):
    got = items(text)
    assert got is not None, text
    assert [g[:4] for g in got] == expected
    assert all(g[4] == "2026-11-05 20:30" for g in got)


@pytest.mark.parametrize(
    "text",
    [
        "lunch 450 with rahul, he owes 200",  # people
        "zomato 450 rahul ke saath",  # people (Hinglish)
        "rahul 200",  # a known person
        "auto 120 plus 30 cash",  # extra amount
        "auto 120 + 30 cash",
        "split dinner 1800 with rahul and asha",
        "rahul paid me back 200",  # payback
        "chai 40 yesterday",  # another day
        "chai",  # no amount
        "xyz 40",  # unfamiliar word: Gemini picks a category
        "2 samosa 30",  # two numbers
        "chai 40 cash upi",  # two ways of paying
        "auto wale ko dedh sau diye",  # amount in words
        "movie 300 popcorn food 200",  # one item pulled two ways, two amounts
        "",
    ],
)
def test_anything_else_goes_to_gemini(text):
    assert items(text) is None, text


def test_pending_bank_sms_needs_gemini_unless_cash():
    txn = BankTxn(id=9, account_id=1, direction="debit", amount_paise=12000, channel="upi",
                  counterparty="paytmqr@paytm", occurred_at=NOW)  # fmt: skip
    assert items("auto 120", ctx([txn])) is None  # might be that UPI payment
    assert items("chai 40 cash", ctx([txn])) == [("Chai", "Food", 40, "Cash", "2026-11-05 20:30")]
