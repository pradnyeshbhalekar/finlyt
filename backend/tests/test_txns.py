"""Bank transactions waiting to be explained, and display names. Every name and UPI ID here is made up."""

from __future__ import annotations

from finlyt_api.counterparty import display_name

from .test_expenses import add_txn


def test_display_names():
    assert display_name("zomato@hdfcbank") == "Zomato"
    assert display_name("paytmqr2810050501010@paytm") == "UPI QR payment"
    assert display_name("RAVI KUMAR") == "Ravi Kumar"
    assert display_name("autowala.raju@okicici") == "Autowala Raju"


def test_sms_sync_is_gone(client, me):
    assert client.post("/api/sms/sync", json={"messages": []}).status_code == 404
    assert "sms_filters" not in client.get("/api/meta").get_json()


def test_resolve_marks_and_unmarks(client, me, app):
    txn_id = add_txn(app, me, amount_paise=95000)
    resp = client.post(f"/api/txns/{txn_id}/resolve", json={"status": "transfer"})
    assert resp.get_json()["status"] == "transfer"
    assert resp.get_json()["name"] == "Zomato"
    assert client.post(f"/api/txns/{txn_id}/resolve", json={"status": "ignored"}).status_code == 409
    assert client.post(f"/api/txns/{txn_id}/resolve", json={"status": "pending"}).get_json()["status"] == "pending"
