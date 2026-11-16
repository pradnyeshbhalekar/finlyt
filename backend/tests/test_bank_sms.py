"""Pasting a bank SMS into the box (read by rules) and scanning a receipt (read by Gemini).

Every message here is made up: account digits, refs, UPI IDs and names are not real.
"""

from __future__ import annotations

import io
from datetime import date, datetime, time

import pytest

from finlyt_api import bank_sms
from finlyt_api.gemini import GExpense, GOwed, GPayment, GProposal
from finlyt_api.services import proposals
from finlyt_api.timeutil import IST

from .test_expenses import lunch

KOTAK_DEBIT_NAME = (
    "Sent Rs.13.00 from Kotak Bank A/c X1234 to RAHUL SHARMA on 04-11-26. UPI Ref 600000000202. "
    "Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud"
)
KOTAK_CREDIT = "Received Rs.1000.00 in your Kotak Bank AC X1234 from priya.k@okicici on 22-07-26.UPI Ref:600000000303."
DNS_DEBIT = (
    "Your a/c no. XX5678 debited for Rs.9500.00 on 03-11-2026 19:24:08 trf to landlord@ybl "
    "(RefNo 600000000404). If not u? Call 18002331700-DNS Bank"
)
DNS_CREDIT = (
    "Your a/c no. XX5678 is credited for Rs.9000.00 on 03-11-2026 19:26:47 and debited from VPA "
    "amit@okhdfcbank (UPI Ref no 600000000505 )-DNS Bank"
)
HDFC_UPI = (
    "Sent Rs.450.00 From HDFC Bank A/C *1234 To ZOMATO On 12/11/26 Ref 612345678901 Not You? "
    "Call 18002586161/SMS BLOCK UPI to 7308080808"
)
ICICI_UPI = (
    "ICICI Bank Acct XX123 debited for Rs 240.00 on 12-Nov-26; SWIGGY credited. UPI:612345678903. "
    "Call 18002662 for dispute. SMS BLOCK 123 to 9215676766."
)
SBI_UPI = (
    "Dear UPI user A/C X1234 debited by 120.0 on date 12Nov26 trf to RAPIDO Refno 612345678904. "
    "If not u? call 1800111109. -SBI"
)
ICICI_CARD = (
    "INR 850.00 spent using ICICI Bank Card XX1234 on 12-Nov-26 on DMART AVENUE. Avl Limit: INR "
    "45,000.00. If not you, call 1800 2662/SMS BLOCK 1234 to 9215676766"
)
HDFC_CREDIT_CARD = (
    "Rs.1,299.00 spent on HDFC Bank Credit Card x1234 at AMAZON on 2026-11-12:10:15:20 Avl bal Rs "
    "50,000.00. Not you? Call 18002586161"
)
AXIS_UPI = (
    "INR 500.00 debited A/c no. XX1234 12-11-26 10:15:20 UPI/P2M/612345678905/BLINKIT Not you? "
    "SMS BLOCKUPI Cust ID to 919951860002 Axis Bank"
)
SBI_ATM = "Rs.2000 withdrawn at ATM from A/c XX1234 on 12-11-26. Avl Bal Rs 10,000. -SBI"
OTP = "123456 is your OTP for txn of Rs 500 at AMAZON on HDFC Bank card xx1234. Do not share."


@pytest.mark.parametrize(
    ("text", "direction", "paise", "party", "bank", "last4", "day", "clock", "channel"),
    [
        (KOTAK_DEBIT_NAME, "debit", 1300, "RAHUL SHARMA", "kotak", "1234", date(2026, 11, 4), None, "upi"),
        (KOTAK_CREDIT, "credit", 100000, "priya.k@okicici", "kotak", "1234", date(2026, 7, 22), None, "upi"),
        (DNS_DEBIT, "debit", 950000, "landlord@ybl", "dns", "5678", date(2026, 11, 3), time(19, 24), "upi"),
        # "credited … and debited from VPA": the first verb decides.
        (DNS_CREDIT, "credit", 900000, "amit@okhdfcbank", "dns", "5678", date(2026, 11, 3), time(19, 26), "upi"),
        (HDFC_UPI, "debit", 45000, "ZOMATO", "hdfc", "1234", date(2026, 11, 12), None, "upi"),
        # "…; SWIGGY credited" names the payee, it isn't money coming in.
        (ICICI_UPI, "debit", 24000, "SWIGGY", "icici", "123", date(2026, 11, 12), None, "upi"),
        # No "Rs" before the amount.
        (SBI_UPI, "debit", 12000, "RAPIDO", "sbi", "1234", date(2026, 11, 12), None, "upi"),
        # The limit after it isn't the amount.
        (ICICI_CARD, "debit", 85000, "DMART AVENUE", "icici", "1234", date(2026, 11, 12), None, "card"),
        # "Credit Card" is a card, not money coming in; the time is glued to the date.
        (HDFC_CREDIT_CARD, "debit", 129900, "AMAZON", "hdfc", "1234", date(2026, 11, 12), time(10, 15), "card"),
        (AXIS_UPI, "debit", 50000, "BLINKIT", "axis", "1234", date(2026, 11, 12), time(10, 15), "upi"),
        (SBI_ATM, "debit", 200000, None, "sbi", "1234", date(2026, 11, 12), None, "atm"),
    ],
)
def test_parse_reads_each_bank(text, direction, paise, party, bank, last4, day, clock, channel):
    sms = bank_sms.parse(text)
    assert sms is not None
    assert (sms.direction, sms.amount_paise, sms.counterparty) == (direction, paise, party)
    assert (sms.bank, sms.last4, sms.day, sms.clock, sms.channel) == (bank, last4, day, clock, channel)


def test_what_isnt_a_bank_payment():
    assert bank_sms.parse(OTP) is None
    assert bank_sms.is_not_a_payment(OTP)
    assert bank_sms.is_not_a_payment("Rahul has requested Rs 500 from you on Google Pay. Pay now via UPI a/c XX1234")
    # Notes people type, even with "rs" and "upi" in them, are for Gemini.
    for typed in ("chai 40 cash", "paid rs 200 to rahul by upi", "lunch 450 with rahul, he owes 200"):
        assert not bank_sms.looks_like_bank_sms(typed)


def test_when_uses_the_sms_date_and_time():
    now = datetime(2026, 11, 12, 18, 0, tzinfo=IST)
    dns = bank_sms.parse(DNS_DEBIT)
    assert bank_sms.when(dns, now) == datetime(2026, 11, 3, 19, 24, tzinfo=IST)
    kotak = bank_sms.parse(KOTAK_DEBIT_NAME)  # a date only
    assert bank_sms.when(kotak, now) == datetime(2026, 11, 4, 12, 0, tzinfo=IST)
    hdfc = bank_sms.parse(HDFC_UPI)  # today, no time: now
    assert bank_sms.when(hdfc, now) == now


# ── Through /api/log/propose ────────────────────────────────────────────────

NOW = datetime(2026, 11, 12, 18, 0, tzinfo=IST)


@pytest.fixture
def fixed_now(monkeypatch):
    monkeypatch.setattr("finlyt_api.routes.log.now_utc", lambda: NOW)


def propose(client, text):
    resp = client.post("/api/log/propose", json={"text": text})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def test_a_pasted_debit_is_one_expense_without_ai(client, me, fixed_now):
    p = propose(client, DNS_DEBIT)  # no Gemini configured: rules only
    assert p["model"] == "sms"
    (e,) = p["expenses"]
    assert e["description"] == "UPI to Landlord"
    assert e["total_paise"] == e["my_share_paise"] == 950000
    assert e["payments"] == [
        {"account_id": me["acc"]["DNS Bank"], "amount_paise": 950000, "bank_txn_id": None, "txn_label": None}
    ]
    assert e["occurred_at"] == "2026-11-03T19:24:00+05:30"
    assert e["issues"] == []


def test_a_known_payee_picks_the_category(client, me, fixed_now):
    p = propose(client, ICICI_CARD)
    (e,) = p["expenses"]
    assert e["description"] == "DMart"
    assert e["category_id"] == me["cat"]["Groceries"]
    # No ICICI account and two banks to choose from: the usual one, with a note to check.
    assert e["payments"][0]["account_id"] == me["acc"]["Kotak"]
    assert "Couldn't tell which of your accounts “ICICI” is" in e["issues"][0]

    p = propose(client, KOTAK_DEBIT_NAME)
    (e,) = p["expenses"]
    assert e["description"] == "UPI to Rahul Sharma"
    assert e["payments"][0]["account_id"] == me["acc"]["Kotak"]
    assert e["issues"] == []


def test_the_same_sms_twice_is_flagged(client, me, fixed_now):
    p = propose(client, HDFC_UPI)
    (e,) = p["expenses"]
    assert e["description"] == "Zomato"
    body = {
        "expenses": [
            {
                "occurred_at": e["occurred_at"],
                "description": e["description"],
                "category_id": e["category_id"],
                "payments": [{"account_id": x["account_id"], "amount_paise": x["amount_paise"]} for x in e["payments"]],
                "dues": [],
                "note_raw": HDFC_UPI,
            }
        ],
        "settlements": [],
        "transfers": [],
        "ignored": [],
    }
    assert client.post("/api/log/commit", json=body).status_code == 201
    again = propose(client, f"  {HDFC_UPI}\n")
    assert any("You logged this SMS already, on 12 Nov" in i for i in again["expenses"][0]["issues"])


def test_money_in_from_someone_who_owes_me_is_their_payback(client, me, fixed_now):
    client.post("/api/expenses", json=lunch(me))  # Rahul owes ₹200
    p = propose(
        client,
        "Received Rs.200.00 in your Kotak Bank AC X1234 from RAHUL on 12-11-26.UPI Ref:600000000909.",
    )
    assert p["expenses"] == []
    (s,) = p["settlements"]
    assert (s["person_name"], s["amount_paise"], s["issues"]) == ("Rahul", 20000, [])


def test_money_in_otherwise_and_atm_and_otp_log_nothing(client, me, fixed_now):
    p = propose(client, KOTAK_CREDIT)
    assert p["expenses"] == p["settlements"] == []
    assert p["questions"] == [
        "That's ₹1,000 coming in from Priya K, so it isn't spending. If Priya was paying you back, "
        "type “Priya paid me back 1000”."
    ]
    p = propose(client, SBI_ATM)
    assert p["expenses"] == [] and "taken out at an ATM" in p["questions"][0]
    p = propose(client, OTP)
    assert p["expenses"] == [] and "isn't a payment" in p["questions"][0]


class Fake:
    def __init__(self, answer: GProposal) -> None:
        self.answer = answer
        self.calls: list[dict] = []

    def __call__(self, *, system, prompt, audio, audio_mime, images=None):
        self.calls.append({"system": system, "prompt": prompt, "images": images})
        return self.answer, "fake-flash"


def empty(**parts) -> GProposal:
    values = {"transcript": "", "expenses": [], "settlements": [], "transfers": [], "ignored": [], "questions": []}
    return GProposal(**(values | parts))


def test_typed_notes_still_go_to_gemini(client, app, me):
    fake = Fake(empty(questions=["Who is Rahul?"]))
    app.extensions["finlyt.gemini"] = fake
    p = propose(client, "paid rs 200 to rahul by upi")
    assert p["model"] == "fake-flash"
    assert fake.calls[0]["system"] == proposals.SYSTEM_PROMPT


# ── Receipts: /api/log/receipt ──────────────────────────────────────────────


def test_a_receipt_is_one_expense_i_paid_in_full(client, app, me):
    fake = Fake(
        empty(
            transcript="Paneer tikka 320, Butter naan x2 120, GST 22",
            expenses=[
                GExpense(
                    description="Dinner at Spice Route",
                    category="Food",
                    time="2026-11-10 21:05",
                    total=462,
                    my_share=231,  # the model guessed a split; the phone asks instead
                    payments=[GPayment(source="Kotak", amount=462)],
                    owed_by=[GOwed(person="Rahul", amount=231)],
                ),
                GExpense(
                    description="Tip", category="Food", time=None, total=20, my_share=20,
                    payments=[GPayment(source="Cash", amount=20)], owed_by=[],
                ),
            ],
        )
    )
    app.extensions["finlyt.gemini"] = fake
    resp = client.post(
        "/api/log/receipt",
        data={
            "image": [
                (io.BytesIO(b"\xff\xd8page-one"), "page1.jpg", "image/jpeg"),
                (io.BytesIO(b"\xff\xd8page-two"), "page2.jpg", "image/jpeg"),
            ]
        },
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200, resp.get_json()
    p = resp.get_json()
    (e,) = p["expenses"]
    assert e["description"] == "Dinner at Spice Route"
    assert (e["total_paise"], e["my_share_paise"], e["dues"]) == (46200, 46200, [])
    assert e["occurred_at"] == "2026-11-10T21:05:00+05:30"
    assert e["issues"] == []
    assert p["transcript"] == "Paneer tikka 320, Butter naan x2 120, GST 22"

    call = fake.calls[0]
    assert call["system"] == proposals.RECEIPT_PROMPT
    assert call["images"] == [(b"\xff\xd8page-one", "image/jpeg"), (b"\xff\xd8page-two", "image/jpeg")]
    assert "The receipt has 2 pages." in call["prompt"]


def test_receipt_rejects_bad_uploads(client, app, me):
    app.extensions["finlyt.gemini"] = Fake(empty())
    resp = client.post("/api/log/receipt", data={}, content_type="multipart/form-data")
    assert resp.status_code == 422
    resp = client.post(
        "/api/log/receipt",
        data={"image": (io.BytesIO(b"%PDF"), "r.pdf", "application/pdf")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 415
    assert resp.get_json()["error"]["code"] == "unsupported_image"
