"""Accounts: what a new user starts with, and adding, renaming, picking the usual one, deleting."""

from __future__ import annotations

from .conftest import FRIEND, build_app, sign_in


def test_a_new_user_starts_with_bank_and_cash(engine, monkeypatch):
    # The real defaults, not the two banks the other tests sign up with.
    monkeypatch.undo()
    app, connection, outer = build_app(engine)
    try:
        client = app.test_client()
        sign_in(client)
        accounts = client.get("/api/meta").get_json()["accounts"]
        assert [(a["name"], a["kind"], a["is_primary"]) for a in accounts] == [
            ("Bank", "bank", True),
            ("Cash", "cash", False),
        ]
        # With no word about how it was paid, a quick note goes to Bank; "cash" goes to Cash.
        chai = client.post("/api/log/propose", json={"text": "chai 40"}).get_json()
        assert chai["model"] == "quick"
        assert chai["expenses"][0]["payments"][0]["account_id"] == accounts[0]["id"]
        auto = client.post("/api/log/propose", json={"text": "auto 120 cash"}).get_json()
        assert auto["expenses"][0]["payments"][0]["account_id"] == accounts[1]["id"]
    finally:
        outer.rollback()
        connection.close()


def test_adding_renaming_and_picking_the_usual_account(client, me):
    resp = client.post("/api/accounts", json={"name": "HDFC card"})
    assert resp.status_code == 201, resp.get_json()
    card = resp.get_json()
    assert card["kind"] == "bank" and card["is_primary"] is False

    # Names are yours alone, whatever the capitals.
    assert client.post("/api/accounts", json={"name": "hdfc CARD"}).status_code == 409
    assert client.patch(f"/api/accounts/{card['id']}", json={"name": "Cash"}).status_code == 409
    assert client.post("/api/accounts", json={"name": "  "}).status_code == 422

    renamed = client.patch(f"/api/accounts/{card['id']}", json={"name": "HDFC", "is_primary": True}).get_json()
    assert renamed["name"] == "HDFC" and renamed["is_primary"] is True
    by_name = {a["name"]: a for a in client.get("/api/accounts").get_json()["items"]}
    assert [name for name, a in by_name.items() if a["is_primary"]] == ["HDFC"]
    assert "HDFC" in {a["name"] for a in client.get("/api/meta").get_json()["accounts"]}


def test_deleting_an_account(client, me):
    spare = client.post("/api/accounts", json={"name": "Wallet", "kind": "cash"}).get_json()
    assert client.delete(f"/api/accounts/{spare['id']}").status_code == 204

    # One with entries stays, so those entries keep their account.
    resp = client.post(
        "/api/expenses",
        json={
            "occurred_at": "2026-11-14T10:00:00+05:30",
            "description": "Chai",
            "category_id": me["cat"]["Food"],
            "payments": [{"account_id": me["acc"]["Kotak"], "amount_paise": 40_00}],
            "dues": [],
        },
    )
    assert resp.status_code == 201, resp.get_json()
    resp = client.delete(f"/api/accounts/{me['acc']['Kotak']}")
    assert resp.status_code == 409 and resp.get_json()["error"]["code"] == "account_in_use"

    # Deleting the usual one hands that on; the last one can't go.
    client.patch(f"/api/accounts/{me['acc']['DNS Bank']}", json={"is_primary": True})
    assert client.delete(f"/api/accounts/{me['acc']['DNS Bank']}").status_code == 204
    left = client.get("/api/accounts").get_json()["items"]
    assert sum(a["is_primary"] for a in left) == 1
    assert client.delete(f"/api/accounts/{me['acc']['Cash']}").status_code == 204
    assert client.delete(f"/api/accounts/{me['acc']['Kotak']}").status_code == 409


def test_accounts_are_private(engine):
    app, connection, outer = build_app(engine)
    try:
        mine = app.test_client()
        sign_in(mine)
        account = mine.post("/api/accounts", json={"name": "Mine"}).get_json()
        theirs = app.test_client()
        sign_in(theirs, FRIEND)
        assert theirs.patch(f"/api/accounts/{account['id']}", json={"name": "Theirs"}).status_code == 404
        assert theirs.delete(f"/api/accounts/{account['id']}").status_code == 404
    finally:
        outer.rollback()
        connection.close()
