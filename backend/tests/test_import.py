"""Import from an AI chat: the prompt, reading the reply, the preview, saving and undoing."""

from __future__ import annotations

import json
from datetime import date, datetime

import pytest

from finlyt_api.gemini import GImport, GImportEntry, GImportPayment
from finlyt_api.models import BankTxn
from finlyt_api.timeutil import ensure_aware

from .conftest import FRIEND, build_app, sign_in

ENTRIES = [
    {
        "date": "2026-10-30",
        "time": "13:30",
        "type": "expense",
        "description": "Lunch at Zomato with Rahul",
        "category": "Food",
        "amount": 450,
        "my_share": 250,
        "payments": [{"method": "Kotak", "amount": 450}],
        "owed_by": [{"person": "Rahul", "amount": 200}],
        "notes": "",
    },
    {"date": "2026-10-31", "time": None, "type": "expense", "description": "Auto", "category": "transport",
     "amount": 120, "my_share": 120, "payments": [{"method": "cash", "amount": 60}, {"method": "dns", "amount": 60}]},
    {"date": "2026-11-01", "type": "payback", "description": "Rahul paid back", "amount": 200, "person": "Rahul"},
    {"date": "2026-11-02", "type": "owe", "description": "Movie ticket", "category": "Entertainment",
     "amount": 300, "person": "Aaditya"},
    {"date": "2026-11-03", "type": "repay", "description": "Paid Aaditya back", "amount": 300, "person": "Aaditya",
     "payments": [{"method": "upi", "amount": 300}]},
    {"date": "2026-11-03", "type": "income", "description": "Salary", "amount": 50000},
    {"date": "2026-11-04", "type": "transfer", "description": "ATM", "amount": 2000},
    {"date": "2026-12-25", "type": "expense", "description": "Christmas", "amount": 999},
]


def reply(entries=ENTRIES) -> str:
    return "Here you go!\n\n```json\n" + json.dumps({"version": 1, "entries": entries}) + "\n```\nLet me know."


@pytest.fixture(autouse=True)
def today(monkeypatch):
    monkeypatch.setattr("finlyt_api.services.importer.today_ist", lambda: date(2026, 11, 7))


def preview(client, text: str, source: str = "claude") -> dict:
    resp = client.post("/api/import/preview", json={"text": text, "source": source})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def keep(data: dict) -> list[dict]:
    """What the app sends back: the included entries, with the preview-only fields left out."""
    fields = ("kind", "occurred_at", "description", "category_id", "amount_paise", "my_share_paise",
              "payments", "dues", "person_name", "note_raw")
    return [{k: x[k] for k in fields} for x in data["entries"] if x["include"]]


def add_txn(app, me, rupees: int, when: datetime, account: str = "Kotak") -> int:
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        txn = BankTxn(user_id=me["user"]["id"], account_id=me["acc"][account], direction="debit",
                      amount_paise=rupees * 100, channel="upi", counterparty="zomato@hdfcbank",
                      reference=f"77700{rupees}{when.day}", occurred_at=ensure_aware(when))
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


def test_prompt_uses_my_categories_and_accounts(client, me):
    prompt = client.get("/api/import/prompt").get_json()["prompt"]
    assert '"Kotak"' in prompt and '"DNS Bank"' in prompt and '"cash"' in prompt
    assert "Personal care" in prompt
    assert '"owe"' in prompt and '"repay"' in prompt


def test_preview_maps_every_kind_of_entry(client, me):
    data = preview(client, reply())
    assert data["repaired"] is False
    by_desc = {x["description"]: x for x in data["entries"]}

    lunch = by_desc["Lunch at Zomato with Rahul"]
    assert lunch["kind"] == "expense" and lunch["include"] is True
    assert lunch["occurred_at"] == "2026-10-30T13:30:00+05:30"
    assert lunch["category_id"] == me["cat"]["Food"]
    assert lunch["payments"] == [{"account_id": me["acc"]["Kotak"], "amount_paise": 450_00, "bank_txn_id": None}]
    assert lunch["dues"] == [{"person_name": "Rahul", "amount_paise": 200_00}]
    assert lunch["my_share_paise"] == 250_00

    auto = by_desc["Auto"]
    assert auto["category_id"] == me["cat"]["Transport"]  # case doesn't matter
    assert [p["account_id"] for p in auto["payments"]] == [me["acc"]["Cash"], me["acc"]["DNS Bank"]]
    assert auto["occurred_at"].startswith("2026-10-31T12:00")  # no time: noon

    assert by_desc["Rahul paid back"]["kind"] == "payback"
    assert by_desc["Movie ticket"]["kind"] == "owe" and by_desc["Movie ticket"]["person_name"] == "Aaditya"
    repay = by_desc["Paid Aaditya back"]
    assert repay["kind"] == "repay" and repay["payments"][0]["account_id"] == me["acc"]["Kotak"]  # upi → primary

    skipped = {x["description"]: x["skip_reason"] for x in data["entries"] if x["kind"] == "skip"}
    assert skipped == {"Salary": "income", "ATM": "transfer", "Christmas": "dated in the future"}
    assert data["summary"]["importable"] == 5
    assert data["summary"]["first_day"] == "2026-10-30" and data["summary"]["last_day"] == "2026-11-03"
    assert data["summary"]["spent_paise"] == (250 + 120) * 100


def test_a_messy_reply_is_repaired_by_the_ai(client, me, app):
    class Fixer:
        def __call__(self, *, system, text):
            assert "didn't follow the format" in system
            assert "Today is Saturday 07 November 2026" in system  # so "5 Nov" means this year
            entry = GImportEntry(date="2026-11-05", type="expense", description="Chai", category="Food",
                                 amount=40, payments=[GImportPayment(method="cash", amount=40)])
            return GImport(entries=[entry]), "fake-fixer"

    app.extensions["finlyt.import_fixer"] = Fixer()
    data = preview(client, "5 Nov: chai 40 (cash)")
    assert data["repaired"] is True
    assert [(x["description"], x["amount_paise"]) for x in data["entries"]] == [("Chai", 40_00)]


def test_already_logged_entries_are_left_out(client, me):
    resp = client.post("/api/expenses", json={
        "occurred_at": "2026-10-31T09:00:00+05:30", "description": "auto to office",
        "payments": [{"account_id": me["acc"]["Cash"], "amount_paise": 120_00}],
    })
    assert resp.status_code == 201
    data = preview(client, reply())
    auto = next(x for x in data["entries"] if x["description"] == "Auto")
    assert auto["duplicate"] is True and auto["include"] is False
    assert data["summary"]["duplicates"] == 1


def test_bank_payments_waiting_to_be_logged_are_linked(client, me, app):
    txn_id = add_txn(app, me, 450, datetime(2026, 10, 30, 13, 31))
    data = preview(client, reply())
    lunch = next(x for x in data["entries"] if x["description"] == "Lunch at Zomato with Rahul")
    assert lunch["payments"][0]["bank_txn_id"] == txn_id

    client.post("/api/import/commit", json={"source": "claude", "entries": keep(data)})
    assert txn_status(app, txn_id) == "logged"


def test_saving_and_undoing_an_import(client, me, app):
    txn_id = add_txn(app, me, 450, datetime(2026, 10, 30, 13, 31))
    data = preview(client, reply())
    resp = client.post("/api/import/commit", json={"source": "claude", "raw_text": "…", "entries": keep(data)})
    assert resp.status_code == 201, resp.get_json()
    result = resp.get_json()
    assert result["saved"] == {"expense": 2, "payback": 1, "owe": 1, "repay": 1}
    assert result["skipped"] == []

    expenses = client.get("/api/expenses?from=2026-10-01&to=2026-11-30").get_json()["items"]
    assert sorted(e["description"] for e in expenses) == ["Auto", "Lunch at Zomato with Rahul", "Movie ticket · paid back Aaditya"]
    assert all(e["import_batch_id"] == result["batch_id"] for e in expenses)
    balances = client.get("/api/people/balances").get_json()
    assert balances["owed_to_me"] == [] and balances["i_owe"] == []  # Rahul paid back, Aaditya repaid

    batches = client.get("/api/import/batches").get_json()["items"]
    assert [(b["id"], b["source_name"], b["entry_count"], b["first_day"]) for b in batches] == [
        (result["batch_id"], "Claude", 5, "2026-10-30")
    ]

    assert client.delete(f"/api/import/batches/{result['batch_id']}").status_code == 204
    assert client.get("/api/expenses?from=2026-10-01&to=2026-11-30").get_json()["items"] == []
    assert client.get("/api/import/batches").get_json()["items"] == []
    balances = client.get("/api/people/balances").get_json()
    assert balances["owed_to_me"] == [] and balances["i_owe"] == []
    assert txn_status(app, txn_id) == "pending"  # back in "To log"


def test_a_payback_that_doesnt_fit_is_skipped_not_fatal(client, me):
    entries = [ENTRIES[1], {"date": "2026-11-01", "type": "payback", "description": "Priya paid", "amount": 500, "person": "Priya"}]
    data = preview(client, reply(entries))
    result = client.post("/api/import/commit", json={"entries": keep(data)}).get_json()
    assert result["saved"]["expense"] == 1
    assert [s["description"] for s in result["skipped"]] == ["Priya paid"]


def test_nothing_readable_or_nothing_to_save(client, me, app):
    class Empty:
        def __call__(self, *, system, text):
            return GImport(entries=[]), "fake-fixer"

    app.extensions["finlyt.import_fixer"] = Empty()
    resp = client.post("/api/import/preview", json={"text": "hello there"})
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "nothing_found"

    only_payback = [{"date": "2026-11-01", "type": "payback", "description": "Priya paid", "amount": 500, "person": "Priya"}]
    resp = client.post("/api/import/commit", json={"entries": keep(preview(client, reply(only_payback)))})
    assert resp.status_code == 422


def test_imports_are_private(engine):
    application, connection, outer = build_app(engine)
    try:
        client = application.test_client()
        sign_in(client)
        meta = client.get("/api/meta").get_json()
        cash = next(a["id"] for a in meta["accounts"] if a["name"] == "Cash")
        entry = {"kind": "expense", "occurred_at": "2026-11-01T12:00:00+05:30", "description": "Chai",
                 "amount_paise": 40_00, "payments": [{"account_id": cash, "amount_paise": 40_00}]}
        batch = client.post("/api/import/commit", json={"entries": [entry]}).get_json()["batch_id"]
        sign_in(client, FRIEND)
        assert client.get("/api/import/batches").get_json()["items"] == []
        assert client.delete(f"/api/import/batches/{batch}").status_code == 404
    finally:
        outer.rollback()
        connection.close()


def test_a_same_day_payback_finds_the_dinner_it_pays_back(client, me):
    """The dinner has a time (21:00); the payback that evening has none (so noon). It still settles."""
    entries = [
        {"date": "2026-11-05", "time": "21:00", "type": "expense", "description": "Barbeque Nation dinner",
         "category": "Food", "amount": 1600, "my_share": 800, "payments": [{"method": "Kotak", "amount": 1600}],
         "owed_by": [{"person": "Sneha", "amount": 800}]},
        {"date": "2026-11-05", "time": None, "type": "payback", "description": "Sneha paid back her share",
         "amount": 800, "person": "Sneha"},
    ]
    result = client.post("/api/import/commit", json={"entries": keep(preview(client, reply(entries)))}).get_json()
    assert result["skipped"] == []
    assert result["saved"] == {"expense": 1, "payback": 1, "owe": 0, "repay": 0}
    assert client.get("/api/people/balances").get_json()["owed_to_me"] == []
