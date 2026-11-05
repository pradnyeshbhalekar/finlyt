"""Money I owe, settling both ways from bank SMS, History's timeline, the MCP server and Ask.
Names, UPI IDs and refs are made up."""

from __future__ import annotations

from finlyt_api.gemini import GOwe, GRepay

from .test_expenses import lunch
from .test_log import FakeGemini, proposal


def sms(body: str, at: str = "2026-11-05T19:30:00+05:30", sender: str = "AX-KOTAKB-S") -> dict:
    return {"sender": sender, "body": body, "received_at": at}


def kotak_debit(rupees: int, to: str, ref: str) -> str:
    return f"Sent Rs.{rupees}.00 from Kotak Bank AC X1234 to {to} on 05-11-26.UPI Ref {ref}. Not you, https://kotak.com/KBANKT/Fraud"


def kotak_credit(rupees: int, frm: str, ref: str) -> str:
    return f"Received Rs.{rupees}.00 in your Kotak Bank AC X1234 from {frm} on 05-11-26.UPI Ref:{ref}."


def owe_aaditya(client, me, rupees: int = 200, what: str = "Movie ticket") -> None:
    resp = client.post(
        "/api/log/commit",
        json={"debts": [{"person_name": "Aaditya", "amount_paise": rupees * 100, "description": what, "category_id": me["cat"]["Entertainment"]}]},
    )
    assert resp.status_code == 201, resp.get_json()


def test_paying_back_by_upi_is_filled_in_from_sms(client, me):
    owe_aaditya(client, me)
    balances = client.get("/api/people/balances").get_json()
    assert balances["i_owe"][0]["name"] == "Aaditya"
    assert balances["i_owe"][0]["amount_paise"] == 20000

    data = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_debit(200, "AADITYA KULKARNI", "600000009001"))]}
    ).get_json()
    assert data["matched"] == [{"kind": "repaid", "person": "Aaditya", "amount_paise": 20000, "txn_id": data["matched"][0]["txn_id"]}]
    assert data["new_txns"] == []  # nothing left to explain

    assert client.get("/api/people/balances").get_json()["i_owe"] == []
    entry = client.get("/api/expenses").get_json()["items"][0]
    assert entry["description"] == "Movie ticket · paid back Aaditya"
    assert entry["my_share_paise"] == 20000
    assert entry["payments"][0]["bank_txn_id"] == data["matched"][0]["txn_id"]

    # The bank name is remembered: next time a UPI ID or name that was seen before matches directly.
    owe_aaditya(client, me, 50, "Chai")
    again = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_debit(50, "AADITYA KULKARNI", "600000009002"))]}
    ).get_json()
    assert again["matched"][0]["kind"] == "repaid"


def test_wrong_amount_or_unknown_person_stays_to_explain(client, me):
    owe_aaditya(client, me)
    data = client.post(
        "/api/sms/sync",
        json={
            "messages": [
                sms(kotak_debit(150, "AADITYA KULKARNI", "600000009101")),  # not what I owe
                sms(kotak_debit(200, "someone@okaxis", "600000009102")),  # not Aaditya
            ]
        },
    ).get_json()
    assert data["matched"] == []
    assert len(data["new_txns"]) == 2


def test_their_payback_by_upi_settles_what_they_owe(client, me):
    client.post("/api/expenses", json=lunch(me))  # Rahul owes ₹200
    data = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_credit(200, "rahul.verma@okaxis", "600000009201"))]}
    ).get_json()
    assert data["matched"][0] == {"kind": "payback", "person": "Rahul", "amount_paise": 20000, "txn_id": data["matched"][0]["txn_id"]}
    assert client.get("/api/people/balances").get_json()["owed_to_me"] == []


def test_paying_back_in_cash_through_the_log(client, me):
    owe_aaditya(client, me)
    resp = client.post("/api/log/commit", json={"repayments": [{"person_name": "aaditya", "amount_paise": 20000}]})
    assert resp.status_code == 201, resp.get_json()
    entry = client.get("/api/expenses").get_json()["items"][0]
    assert entry["payments"][0]["account_id"] == me["acc"]["Cash"]
    bad = client.post("/api/log/commit", json={"repayments": [{"person_name": "aaditya", "amount_paise": 100}]})
    assert bad.status_code == 422


def test_gemini_reads_owing_and_paying_back(client, me, app):
    owe_aaditya(client, me)
    fake = FakeGemini(
        proposal(
            expenses=[],
            questions=[],
            i_owe=[GOwe(person="neha", amount=300, description="Cab", category="Transport")],
            repaid=[GRepay(person="Aaditya", amount=200, txn=None)],
        )
    )
    app.extensions["finlyt.gemini"] = fake
    data = client.post("/api/log/propose", json={"text": "neha paid my cab 300, gave aaditya his 200 back cash"}).get_json()
    assert data["debts"] == [
        {"person_name": "Neha", "amount_paise": 30000, "description": "Cab", "category_id": me["cat"]["Transport"], "issues": []}
    ]
    assert data["repayments"][0]["owed_paise"] == 20000
    assert data["repayments"][0]["issues"] == []
    assert "I owe: Aaditya ₹200 for Movie ticket" in fake.calls[0]["prompt"]


def test_history_has_every_kind_of_event(client, me, app):
    client.post("/api/expenses", json=lunch(me))
    owe_aaditya(client, me)
    client.post("/api/log/commit", json={"settlements": [{"person_name": "Rahul", "amount_paise": 20000}]})
    txn = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_debit(5000, "myself@okicici", "600000009301"))]}
    ).get_json()["new_txns"][0]
    client.post(f"/api/txns/{txn['id']}/resolve", json={"status": "transfer"})
    client.post("/api/plan", json={"monthly_budget_paise": 3000000, "daily_limit_paise": 50000})

    feed = client.get("/api/activity").get_json()
    kinds = {item["type"] for item in feed["items"]}
    assert kinds == {"expense", "debt", "payback", "bank", "plan"}
    payback = next(i for i in feed["items"] if i["type"] == "payback")
    assert payback["person"] == "Rahul" and payback["for"] == ["Lunch with Rahul"]


def rpc(client, method, params=None, msg_id=1):
    body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if msg_id is not None:
        body["id"] = msg_id
    return client.post("/api/mcp", json=body)


def test_mcp_server_speaks_the_protocol(client, me):
    client.post("/api/expenses", json=lunch(me))
    init = rpc(client, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
    assert init.get_json()["result"]["serverInfo"]["name"] == "finlyt"
    assert init.get_json()["result"]["protocolVersion"] == "2025-06-18"
    assert rpc(client, "notifications/initialized", msg_id=None).status_code == 202

    tools = rpc(client, "tools/list").get_json()["result"]["tools"]
    assert {t["name"] for t in tools} >= {"spending_summary", "find_expenses", "people_balances", "budget_status"}
    assert all(t["annotations"]["readOnlyHint"] for t in tools)

    result = rpc(
        client, "tools/call", {"name": "spending_summary", "arguments": {"start_date": "2026-11-01", "end_date": "2026-11-30"}}
    ).get_json()["result"]
    assert result["isError"] is False
    assert result["structuredContent"]["total_rupees"] == 250.0
    assert result["structuredContent"]["by_category"][0]["category"] == "Food"

    found = rpc(client, "tools/call", {"name": "find_expenses", "arguments": {"text": "rahul", "start_date": "2026-11-01"}})
    assert found.get_json()["result"]["structuredContent"]["expenses"][0]["owed_by"][0]["person"] == "Rahul"

    missing = rpc(client, "tools/call", {"name": "drop_tables"}).get_json()["result"]
    assert missing["isError"] is True
    assert rpc(client, "resources/list").get_json()["error"]["code"] == -32601


def test_mcp_needs_a_token(client, me):
    client.environ_base.pop("HTTP_AUTHORIZATION", None)
    assert rpc(client, "tools/list").status_code == 401


def test_connect_token_gives_a_working_mcp_session(client, me):
    data = client.post("/api/auth/connect-token").get_json()
    assert data["mcp_url"].endswith("/api/mcp")
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {data['token']}"
    assert rpc(client, "ping").get_json()["result"] == {}


class FakeAgent:
    """Looks something up with the real tools, like the model would."""

    def __init__(self):
        self.seen = None

    def __call__(self, *, system, messages, tools, call):
        self.seen = {"system": system, "messages": messages, "tools": [t.name for t in tools]}
        summary = call("spending_summary", {"start_date": "2026-11-01", "end_date": "2026-11-30"})
        return f"You spent ₹{summary['total_rupees']:.0f} in November.", "fake-agent", ["spending_summary"]


def test_ask_answers_from_the_data(client, me, app):
    client.post("/api/expenses", json=lunch(me))
    agent = FakeAgent()
    app.extensions["finlyt.agent"] = agent
    resp = client.post("/api/ask", json={"messages": [{"role": "user", "text": "november me kitna kharcha hua?"}]})
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json() == {"reply": "You spent ₹250 in November.", "model": "fake-agent", "tools_used": ["spending_summary"]}
    assert "people_balances" in agent.seen["tools"]
    assert "Today is" in agent.seen["system"]


def test_explaining_a_payment_teaches_the_upi_id(client, me):
    # The first SMS shows only a phone-number UPI ID, so Finlyt can't tell it's Aaditya.
    owe_aaditya(client, me)
    first = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_debit(200, "9800000001@ybl", "600000009401"))]}
    ).get_json()
    assert first["matched"] == []
    txn_id = first["new_txns"][0]["id"]
    resp = client.post("/api/log/commit", json={"repayments": [{"person_name": "Aaditya", "amount_paise": 20000, "bank_txn_id": txn_id}]})
    assert resp.status_code == 201, resp.get_json()

    # Once I've said it was him, the next payment to that UPI ID is matched by itself.
    owe_aaditya(client, me, 80, "Snacks")
    again = client.post(
        "/api/sms/sync", json={"messages": [sms(kotak_debit(80, "9800000001@ybl", "600000009402"))]}
    ).get_json()
    assert again["matched"][0]["kind"] == "repaid"
    assert again["matched"][0]["person"] == "Aaditya"
