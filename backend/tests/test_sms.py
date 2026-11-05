"""Bank SMS parsing and sync. Every name, UPI ID, account digit and ref here is made up."""

from __future__ import annotations

from datetime import datetime

import pytest

from finlyt_api.sms_parsers import display_name, parse
from finlyt_api.timeutil import IST

KOTAK_DEBIT = (
    "Sent Rs.120.00 from Kotak Bank AC X1234 to autowala@okicici on 05-11-26.UPI Ref 600000001111. "
    "Not you, https://kotak.com/KBANKT/Fraud"
)
KOTAK_DEBIT_NAME = (
    "Sent Rs.1,250.50 from Kotak Bank A/c X1234 to RAVI KUMAR on 05-11-26. UPI Ref 600000002222. "
    "Not done by you? Tap https://kotak.bank.in/KBANKT/Fraud"
)
KOTAK_CREDIT = "Received Rs.200.00 in your Kotak Bank AC X1234 from friend@okaxis on 05-11-26.UPI Ref:600000003333."
DNS_DEBIT = (
    "Your a/c no. XX5678 debited for Rs.950.00 on 05-11-2026 19:24:08 trf to shop@ybl "
    "(RefNo 600000004444). If not u? Call 18002331700-DNS Bank"
)
DNS_CREDIT = (
    "Your a/c no. XX5678 is credited for Rs.900.00 on 05-11-2026 19:26:47 and debited from VPA "
    "friend@okaxis (UPI Ref no 600000005555 )-DNS Bank"
)


@pytest.mark.parametrize(
    ("bank", "body", "direction", "paise", "party", "ref"),
    [
        ("kotak", KOTAK_DEBIT, "debit", 12000, "autowala@okicici", "600000001111"),
        ("kotak", KOTAK_DEBIT_NAME, "debit", 125050, "RAVI KUMAR", "600000002222"),
        ("kotak", KOTAK_CREDIT, "credit", 20000, "friend@okaxis", "600000003333"),
        ("dns", DNS_DEBIT, "debit", 95000, "shop@ybl", "600000004444"),
        ("dns", DNS_CREDIT, "credit", 90000, "friend@okaxis", "600000005555"),
    ],
)
def test_parsers(bank, body, direction, paise, party, ref):
    p = parse(bank, body)
    assert p is not None
    assert (p.direction, p.amount_paise, p.counterparty, p.reference) == (direction, paise, party, ref)


def test_dns_has_its_own_time_and_kotak_uses_arrival():
    assert parse("dns", DNS_DEBIT).occurred_at == datetime(2026, 11, 5, 19, 24, 8, tzinfo=IST)
    assert parse("kotak", KOTAK_DEBIT).occurred_at is None


def test_otps_and_other_messages_are_not_transactions():
    assert parse("kotak", "123456 is your OTP for Kotak Bank netbanking. Do not share.") is None
    assert parse("kotak", "Your Kotak Bank credit card statement is ready.") is None


def test_display_names():
    assert display_name("zomato@hdfcbank") == "Zomato"
    assert display_name("paytmqr2810050501010@paytm") == "UPI QR payment"
    assert display_name("RAVI KUMAR") == "Ravi Kumar"
    assert display_name("autowala.raju@okicici") == "Autowala Raju"


def sms(body: str, at: str = "2026-11-05T19:30:00+05:30", sender: str = "AX-KOTAKB-S") -> dict:
    return {"sender": sender, "body": body, "received_at": at}


def test_sync_creates_pending_txns_once(client, me):
    resp = client.post(
        "/api/sms/sync",
        json={"messages": [sms(KOTAK_DEBIT), sms(KOTAK_CREDIT), sms(DNS_DEBIT, sender="VM-DNSBNK"), sms("Hi, lunch?", sender="AD-FRIEND")]},
    )
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["received"] == 4
    assert data["unparsed"] == 1
    names = sorted(t["name"] for t in data["new_txns"])
    assert names == ["Autowala", "Friend", "Shop"]
    dns = next(t for t in data["new_txns"] if t["name"] == "Shop")
    assert dns["account_id"] == me["acc"]["DNS Bank"]
    assert dns["occurred_at"] == "2026-11-05T19:24:08+05:30"

    # The same SMS again, or the same ref in a second message, adds nothing.
    again = client.post("/api/sms/sync", json={"messages": [sms(KOTAK_DEBIT), sms(KOTAK_DEBIT + " ")]}).get_json()
    assert again["new_txns"] == []
    assert again["duplicates"] == 2

    # /api/txns lists the last 14 days; these fixtures are dated 2026-11-05.
    pending = client.get("/api/txns").get_json()["items"]
    assert all(t["status"] == "pending" for t in pending)


def test_sync_links_a_payment_already_logged(client, me):
    client.post(
        "/api/expenses",
        json={
            "occurred_at": "2026-11-05T19:10:00+05:30",
            "description": "Auto",
            "payments": [{"account_id": me["acc"]["Kotak"], "amount_paise": 12000}],
        },
    )
    data = client.post("/api/sms/sync", json={"messages": [sms(KOTAK_DEBIT)]}).get_json()
    assert data["linked"] == 1
    assert data["new_txns"] == []
    auto = client.get("/api/expenses").get_json()["items"][0]
    assert auto["payments"][0]["bank_txn_id"] is not None


def test_resolve_marks_and_unmarks(client, me):
    txn = client.post("/api/sms/sync", json={"messages": [sms(DNS_DEBIT, sender="VM-DNSBNK")]}).get_json()["new_txns"][0]
    resp = client.post(f"/api/txns/{txn['id']}/resolve", json={"status": "transfer"})
    assert resp.get_json()["status"] == "transfer"
    assert client.post(f"/api/txns/{txn['id']}/resolve", json={"status": "ignored"}).status_code == 409
    assert client.post(f"/api/txns/{txn['id']}/resolve", json={"status": "pending"}).get_json()["status"] == "pending"
