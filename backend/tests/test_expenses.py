from __future__ import annotations

import itertools
from datetime import datetime

from finlyt_api.models import BankTxn
from finlyt_api.timeutil import ensure_aware

from .conftest import FRIEND, sign_in


def lunch(me, **overrides) -> dict:
    """₹450 lunch: ₹300 Kotak + ₹150 cash, Rahul owes ₹200."""
    body = {
        "occurred_at": "2026-11-04T13:12:00+05:30",
        "description": "Lunch with Rahul",
        "category_id": me["cat"]["Food"],
        "payments": [
            {"account_id": me["acc"]["Kotak"], "amount_paise": 30000},
            {"account_id": me["acc"]["Cash"], "amount_paise": 15000},
        ],
        "dues": [{"person_name": "Rahul", "amount_paise": 20000}],
        "note_raw": "zomato was lunch with rahul, he owes me 200",
    }
    body.update(overrides)
    return body


_refs = itertools.count(111222)


def add_txn(app, me, amount_paise=45000, direction="debit") -> int:
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        txn = BankTxn(
            user_id=me["user"]["id"],
            account_id=me["acc"]["Kotak"],
            direction=direction,
            amount_paise=amount_paise,
            channel="upi",
            counterparty="zomato@hdfcbank",
            reference=f"999000{next(_refs)}",
            occurred_at=ensure_aware(datetime(2026, 11, 4, 13, 12)),
        )
        s.add(txn)
        s.commit()
        txn_id = txn.id
        s.close()
    return txn_id


def txn_status(app, txn_id: int) -> str:
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        status = s.get(BankTxn, txn_id).status
        s.close()
    return status


def test_half_cash_split_expense(client, me):
    resp = client.post("/api/expenses", json=lunch(me))
    assert resp.status_code == 201, resp.get_json()
    e = resp.get_json()
    assert e["total_paise"] == 45000
    assert e["my_share_paise"] == 25000
    assert e["occurred_at"] == "2026-11-04T13:12:00+05:30"
    assert [(p["account_id"], p["amount_paise"]) for p in e["payments"]] == [
        (me["acc"]["Kotak"], 30000),
        (me["acc"]["Cash"], 15000),
    ]
    assert [(d["person_name"], d["amount_paise"], d["status"]) for d in e["dues"]] == [
        ("Rahul", 20000, "open")
    ]


def test_share_and_dues_must_add_up(client, me):
    resp = client.post("/api/expenses", json=lunch(me, my_share_paise=10000))
    assert resp.status_code == 422
    resp = client.post(
        "/api/expenses", json=lunch(me, dues=[{"person_name": "Rahul", "amount_paise": 99999}])
    )
    assert resp.status_code == 422


def test_unknown_ids_are_rejected(client, me):
    body = lunch(me, payments=[{"account_id": 987654, "amount_paise": 100}], dues=[])
    resp = client.post("/api/expenses", json=body)
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "unknown_account"
    resp = client.post("/api/expenses", json=lunch(me, category_id=987654))
    assert resp.get_json()["error"]["code"] == "unknown_category"


def test_people_are_matched_case_insensitively(client, me):
    client.post("/api/expenses", json=lunch(me))
    client.post("/api/expenses", json=lunch(me, dues=[{"person_name": " rahul ", "amount_paise": 100}]))
    people = client.get("/api/meta").get_json()["people"]
    assert [p["name"] for p in people] == ["Rahul"]


def test_list_filters_by_ist_day(client, me):
    late = lunch(me, occurred_at="2026-11-04T23:30:00+05:30", description="Late snack", dues=[])
    after_midnight = lunch(me, occurred_at="2026-11-05T00:30:00+05:30", description="Midnight chai", dues=[])
    client.post("/api/expenses", json=late)
    client.post("/api/expenses", json=after_midnight)
    items = client.get("/api/expenses?from=2026-11-04&to=2026-11-04").get_json()["items"]
    assert [e["description"] for e in items] == ["Late snack"]
    items = client.get("/api/expenses?from=2026-11-05").get_json()["items"]
    assert [e["description"] for e in items] == ["Midnight chai"]


def test_list_filters_by_account(client, me):
    client.post("/api/expenses", json=lunch(me))
    only_cash = lunch(
        me,
        description="Chai",
        payments=[{"account_id": me["acc"]["Cash"], "amount_paise": 4000}],
        dues=[],
    )
    client.post("/api/expenses", json=only_cash)
    kotak = client.get(f"/api/expenses?account_id={me['acc']['Kotak']}").get_json()["items"]
    assert [e["description"] for e in kotak] == ["Lunch with Rahul"]


def test_patch_recomputes_totals_and_delete(client, me):
    created = client.post("/api/expenses", json=lunch(me)).get_json()
    resp = client.patch(
        f"/api/expenses/{created['id']}",
        json={
            "description": "Lunch at Zomato",
            "payments": [{"account_id": me["acc"]["Kotak"], "amount_paise": 50000}],
        },
    )
    assert resp.status_code == 200, resp.get_json()
    e = resp.get_json()
    assert e["description"] == "Lunch at Zomato"
    assert e["total_paise"] == 50000
    assert e["my_share_paise"] == 30000  # Rahul still owes ₹200
    resp = client.patch(f"/api/expenses/{created['id']}", json={"category_id": None})
    assert resp.get_json()["category_id"] is None

    assert client.delete(f"/api/expenses/{created['id']}").status_code == 204
    assert client.get(f"/api/expenses/{created['id']}").status_code == 404


def test_linking_a_bank_txn_marks_it_logged(app, client, me):
    txn_id = add_txn(app, me, amount_paise=45000)
    body = lunch(
        me,
        payments=[{"account_id": me["acc"]["Kotak"], "amount_paise": 45000, "bank_txn_id": txn_id}],
    )
    created = client.post("/api/expenses", json=body).get_json()
    assert txn_status(app, txn_id) == "logged"

    over = lunch(
        me,
        dues=[],
        payments=[{"account_id": me["acc"]["Kotak"], "amount_paise": 100, "bank_txn_id": txn_id}],
    )
    resp = client.post("/api/expenses", json=over)
    assert resp.get_json()["error"]["code"] == "txn_overallocated"

    wrong_account = lunch(
        me,
        dues=[],
        payments=[{"account_id": me["acc"]["Cash"], "amount_paise": 100, "bank_txn_id": txn_id}],
    )
    resp = client.post("/api/expenses", json=wrong_account)
    assert resp.get_json()["error"]["code"] == "txn_account_mismatch"

    client.delete(f"/api/expenses/{created['id']}")
    assert txn_status(app, txn_id) == "pending"


def test_users_cannot_touch_each_others_data(app, client, me):
    mine = client.post("/api/expenses", json=lunch(me)).get_json()

    other = app.test_client()
    sign_in(other, FRIEND)
    assert other.get("/api/expenses").get_json()["items"] == []
    assert other.get(f"/api/expenses/{mine['id']}").status_code == 404
    assert other.delete(f"/api/expenses/{mine['id']}").status_code == 404
    # Reusing my account or category ids must fail for them.
    resp = other.post("/api/expenses", json=lunch(me, dues=[], category_id=None))
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "unknown_account"
    resp = other.post("/api/expenses", json=lunch(me, dues=[]))
    assert resp.get_json()["error"]["code"] == "unknown_category"
