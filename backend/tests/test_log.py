"""Phase 3: /api/log/propose and /api/log/commit, with Gemini faked."""

from __future__ import annotations

import io

import pytest

from finlyt_api.gemini import GExpense, GOwed, GPayment, GProposal, GSettlement, GTxnNote
from finlyt_api.money import rupees, to_paise

from .test_expenses import add_txn, lunch, txn_status


class FakeGemini:
    def __init__(self, answer: GProposal) -> None:
        self.answer = answer
        self.calls: list[dict] = []

    def __call__(self, *, system, prompt, audio, audio_mime):
        self.calls.append({"system": system, "prompt": prompt, "audio": audio, "mime": audio_mime})
        return self.answer, "fake-flash"


def proposal(**overrides) -> GProposal:
    """The plan's example day: Zomato lunch split with Rahul, auto with cash on top, chai."""
    values = {
        "transcript": "",
        "expenses": [
            GExpense(
                description="Lunch at Zomato with Rahul",
                category="Food",
                time="2026-11-04 13:12",
                total=450,
                my_share=250,
                payments=[GPayment(source="T1", amount=450)],
                owed_by=[GOwed(person="rahul", amount=200)],
            ),
            GExpense(
                description="Auto",
                category="Transport",
                time=None,
                total=150,
                my_share=150,
                payments=[GPayment(source="T2", amount=120), GPayment(source="Cash", amount=30)],
                owed_by=[],
            ),
            GExpense(
                description="Chai",
                category="Food",
                time="2026-11-04 17:00",
                total=40,
                my_share=40,
                payments=[GPayment(source="cash", amount=40)],
                owed_by=[],
            ),
        ],
        "settlements": [],
        "transfers": [],
        "ignored": [],
        "questions": ["Was the chai today?"],
    }
    values.update(overrides)
    return GProposal(**values)


@pytest.fixture
def gemini(app):
    fake = FakeGemini(proposal())
    app.extensions["finlyt.gemini"] = fake
    return fake


@pytest.fixture
def txns(app, me):
    return {
        "T1": add_txn(app, me, amount_paise=45000),
        "T2": add_txn(app, me, amount_paise=12000),
    }


def test_money_helpers():
    assert to_paise(450) == 45000
    assert to_paise("12.345") == 1235
    assert to_paise(0.1 + 0.2) == 30
    assert rupees(45000) == "₹450"
    assert rupees(123456789) == "₹12,34,567.89"
    assert rupees(-5050) == "-₹50.50"


def test_propose_text_maps_labels_accounts_and_people(client, me, gemini, txns):
    client.post("/api/expenses", json=lunch(me))  # creates the person "Rahul"
    resp = client.post(
        "/api/log/propose",
        json={"text": "zomato was lunch with rahul...", "txn_ids": [txns["T1"], txns["T2"]]},
    )
    assert resp.status_code == 200, resp.get_json()
    p = resp.get_json()
    assert p["model"] == "fake-flash"
    assert [t["label"] for t in p["txns"]] == ["T1", "T2"]
    assert p["questions"] == ["Was the chai today?"]

    lunch_, auto, chai = p["expenses"]
    assert lunch_["payments"] == [
        {"account_id": me["acc"]["Kotak"], "amount_paise": 45000, "bank_txn_id": txns["T1"], "txn_label": "T1"}
    ]
    assert lunch_["dues"] == [{"person_name": "Rahul", "amount_paise": 20000}]
    assert lunch_["my_share_paise"] == 25000
    assert lunch_["category_id"] == me["cat"]["Food"]
    assert lunch_["occurred_at"] == "2026-11-04T13:12:00+05:30"
    assert lunch_["issues"] == []

    assert [x["account_id"] for x in auto["payments"]] == [me["acc"]["Kotak"], me["acc"]["Cash"]]
    assert auto["total_paise"] == 15000
    # No time given: it takes the linked transaction's time.
    assert auto["occurred_at"] == "2026-11-04T13:12:00+05:30"
    assert chai["payments"][0]["account_id"] == me["acc"]["Cash"]

    prompt = gemini.calls[0]["prompt"]
    assert "T1: ₹450 paid from Kotak to zomato@hdfcbank" in prompt
    assert "999000" not in prompt  # bank refs never go to Gemini
    assert "Rahul" in prompt
    assert gemini.calls[0]["audio"] is None


def test_propose_flags_what_doesnt_add_up(client, me, gemini, txns):
    gemini.answer = proposal(
        expenses=[
            GExpense(
                description="Dinner",
                category="Restaurants",
                time="tonight",
                total=500,
                my_share=500,
                payments=[GPayment(source="T1", amount=300), GPayment(source="Paytm wallet", amount=100)],
                owed_by=[GOwed(person="Asha", amount=100)],
            ),
            GExpense(
                description="Snacks",
                category="Food",
                time=None,
                total=200,
                my_share=200,
                payments=[GPayment(source="T1", amount=200), GPayment(source="T9", amount=10)],
                owed_by=[],
            ),
        ]
    )
    resp = client.post("/api/log/propose", json={"text": "dinner", "txn_ids": [txns["T1"]]})
    assert resp.status_code == 200, resp.get_json()
    dinner, snacks = resp.get_json()["expenses"]

    assert dinner["total_paise"] == 40000
    assert dinner["my_share_paise"] == 30000
    assert dinner["category_id"] == me["cat"]["Other"]
    assert dinner["payments"][1]["account_id"] == me["acc"]["Kotak"]  # unknown → primary
    issues = " | ".join(dinner["issues"])
    assert "Restaurants" in issues
    assert "Paytm wallet" in issues
    assert "payments add up to ₹400" in issues
    assert "your share was ₹500" in issues
    assert 'time "tonight"' in issues

    issues = " | ".join(snacks["issues"])
    assert "More than T1's ₹450" in issues
    assert "T9 isn't a pending transaction" in issues


def test_propose_credit_used_as_payment_is_not_linked(client, app, me, gemini):
    credit = add_txn(app, me, amount_paise=5000, direction="credit")
    gemini.answer = proposal(
        expenses=[
            GExpense(
                description="Snacks",
                category="Food",
                time=None,
                total=50,
                my_share=50,
                payments=[GPayment(source="T1", amount=50)],
                owed_by=[],
            )
        ]
    )
    resp = client.post("/api/log/propose", json={"text": "snacks", "txn_ids": [credit]})
    (snacks,) = resp.get_json()["expenses"]
    assert snacks["payments"] == [
        {"account_id": me["acc"]["Kotak"], "amount_paise": 5000, "bank_txn_id": None, "txn_label": None}
    ]
    assert snacks["issues"] == ["T1 is money coming in, not a payment"]


def test_propose_voice_note_multipart(client, me, gemini):
    resp = client.post(
        "/api/log/propose",
        data={"audio": (io.BytesIO(b"\xff\xf1fake-aac"), "note.aac", "audio/aac"), "text": ""},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200, resp.get_json()
    call = gemini.calls[0]
    assert call["audio"] == b"\xff\xf1fake-aac"
    assert call["mime"] == "audio/aac"
    assert "voice note is attached" in call["prompt"]


def test_propose_rejects_bad_input(client, me, gemini):
    assert client.post("/api/log/propose", json={"text": "  "}).status_code == 422
    resp = client.post(
        "/api/log/propose",
        data={"audio": (io.BytesIO(b"x"), "note.txt", "text/plain")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 415
    resp = client.post("/api/log/propose", json={"text": "chai", "txn_ids": [999999]})
    assert resp.status_code == 409
    assert gemini.calls == []


def test_propose_without_gemini_key(client, me):
    resp = client.post("/api/log/propose", json={"text": "chai 40 cash"})
    assert resp.status_code == 503
    assert resp.get_json()["error"]["code"] == "not_configured"


def _commit_body(me, txns) -> dict:
    return {
        "expenses": [
            {
                "occurred_at": "2026-11-04T13:12:00+05:30",
                "description": "Lunch at Zomato with Rahul",
                "category_id": me["cat"]["Food"],
                "payments": [
                    {"account_id": me["acc"]["Kotak"], "amount_paise": 45000, "bank_txn_id": txns["T1"]}
                ],
                "dues": [{"person_name": "Rahul", "amount_paise": 20000}],
                "note_raw": "zomato was lunch with rahul, he owes me 200",
            }
        ],
        "ignored": [txns["T2"]],
    }


def test_commit_saves_everything(client, app, me, txns):
    resp = client.post("/api/log/commit", json=_commit_body(me, txns))
    assert resp.status_code == 201, resp.get_json()
    result = resp.get_json()
    assert len(result["expense_ids"]) == 1
    assert result["ignored_count"] == 1

    saved = client.get(f"/api/expenses/{result['expense_ids'][0]}").get_json()
    assert saved["source"] == "log"
    assert saved["my_share_paise"] == 25000
    assert txn_status(app, txns["T1"]) == "logged"
    assert txn_status(app, txns["T2"]) == "ignored"


def test_commit_is_all_or_nothing(client, app, me, txns):
    body = _commit_body(me, txns)
    bad = dict(body["expenses"][0], payments=[{"account_id": 999999, "amount_paise": 100}])
    body["expenses"].append(bad)
    resp = client.post("/api/log/commit", json=body)
    assert resp.status_code == 422
    assert client.get("/api/expenses").get_json()["items"] == []
    assert txn_status(app, txns["T1"]) == "pending"
    assert txn_status(app, txns["T2"]) == "pending"


def test_commit_rejects_conflicting_txn_use(client, me, txns):
    body = _commit_body(me, txns)
    body["ignored"] = [txns["T1"]]
    assert client.post("/api/log/commit", json=body).status_code == 422


def test_paybacks_settle_oldest_dues_first(client, app, me):
    first = client.post("/api/expenses", json=lunch(me, occurred_at="2026-11-01T13:00:00+05:30"))
    second = client.post("/api/expenses", json=lunch(me, occurred_at="2026-11-03T13:00:00+05:30"))
    assert first.status_code == second.status_code == 201

    # ₹250 cash: settles the first ₹200 due and ₹50 of the second.
    resp = client.post(
        "/api/log/commit", json={"settlements": [{"person_name": "rahul", "amount_paise": 25000}]}
    )
    assert resp.status_code == 201, resp.get_json()
    assert resp.get_json()["settlement_count"] == 2
    due1 = client.get(f"/api/expenses/{first.get_json()['id']}").get_json()["dues"][0]
    due2 = client.get(f"/api/expenses/{second.get_json()['id']}").get_json()["dues"][0]
    assert (due1["status"], due1["settled_paise"]) == ("settled", 20000)
    assert (due2["status"], due2["settled_paise"]) == ("open", 5000)

    # The rest arrives over UPI; the credit txn becomes a payback.
    credit = add_txn(app, me, amount_paise=15000, direction="credit")
    resp = client.post(
        "/api/log/commit",
        json={"settlements": [{"person_name": "Rahul", "amount_paise": 15000, "bank_txn_id": credit}]},
    )
    assert resp.status_code == 201, resp.get_json()
    due2 = client.get(f"/api/expenses/{second.get_json()['id']}").get_json()["dues"][0]
    assert due2["status"] == "settled"
    assert txn_status(app, credit) == "payback"

    # Nothing left to pay back.
    resp = client.post(
        "/api/log/commit", json={"settlements": [{"person_name": "Rahul", "amount_paise": 100}]}
    )
    assert resp.status_code == 422
    assert resp.get_json()["error"]["code"] == "overpaid"


def test_propose_settlements_and_transfers(client, app, me, gemini):
    client.post("/api/expenses", json=lunch(me))
    credit = add_txn(app, me, amount_paise=20000, direction="credit")
    atm = add_txn(app, me, amount_paise=200000)
    gemini.answer = proposal(
        expenses=[],
        settlements=[GSettlement(person="Rahul", amount=200, txn="T1")],
        transfers=[GTxnNote(txn="T2", reason="ATM")],
        ignored=[GTxnNote(txn="T7", reason="not mine")],
    )
    resp = client.post("/api/log/propose", json={"text": "rahul paid back", "txn_ids": [credit, atm]})
    assert resp.status_code == 200, resp.get_json()
    p = resp.get_json()
    assert p["settlements"] == [
        {
            "person_name": "Rahul",
            "amount_paise": 20000,
            "bank_txn_id": credit,
            "txn_label": "T1",
            "owed_paise": 20000,
            "issues": [],
        }
    ]
    assert p["transfers"] == [{"bank_txn_id": atm, "txn_label": "T2", "reason": "ATM"}]
    assert p["ignored"] == []  # T7 doesn't exist
