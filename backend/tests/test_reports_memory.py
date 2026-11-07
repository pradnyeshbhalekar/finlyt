"""Month reports ("where did my money go"), and what Finlyt remembers (income, commitments)."""

from __future__ import annotations

from datetime import date, datetime

import pytest

from finlyt_api.gemini import FinishTurn, GCommitment, GIncomeRule
from finlyt_api.models import BankTxn
from finlyt_api.timeutil import ensure_aware

from .test_plan import FakePlanner, turn

TODAY = date(2026, 11, 20)


@pytest.fixture(autouse=True)
def today(monkeypatch):
    for module in ("reports", "memory", "insights", "planning"):
        monkeypatch.setattr(f"finlyt_api.services.{module}.today_ist", lambda: TODAY, raising=False)
    monkeypatch.setattr("finlyt_api.routes.plan.today_ist", lambda: TODAY)


def spend(client, me, day: str, category: str, rupees: int, description: str = "Spend", account: str = "Kotak"):
    resp = client.post(
        "/api/expenses",
        json={
            "occurred_at": f"{day}T13:00:00+05:30",
            "description": description,
            "category_id": me["cat"][category],
            "payments": [{"account_id": me["acc"][account], "amount_paise": rupees * 100}],
        },
    )
    assert resp.status_code == 201, resp.get_json()


def bank(app, me, rupees: int, when: datetime, direction: str, status: str, ref: str):
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        s.add(BankTxn(user_id=me["user"]["id"], account_id=me["acc"]["Kotak"], direction=direction,
                      amount_paise=rupees * 100, channel="upi", counterparty="someone@upi", reference=ref,
                      occurred_at=ensure_aware(when), status=status))
        s.commit()
        s.close()


def test_month_report_says_where_the_money_went(client, me, app):
    # Usual: September and October.
    spend(client, me, "2026-09-10", "Food", 3000)
    spend(client, me, "2026-10-10", "Food", 5000)
    spend(client, me, "2026-10-12", "Bills", 499, "Netflix")
    spend(client, me, "2026-09-12", "Bills", 499, "Netflix")
    # This month, up to the 20th.
    spend(client, me, "2026-11-02", "Food", 6000, "Dinner out")
    spend(client, me, "2026-11-05", "Transport", 400, "Auto", account="Cash")
    spend(client, me, "2026-11-12", "Bills", 499, "Netflix")
    bank(app, me, 45000, datetime(2026, 11, 1, 9), "credit", "income", "salary1")
    bank(app, me, 350, datetime(2026, 11, 18, 20), "debit", "pending", "unlogged1")

    r = client.get("/api/reports/month?month=2026-11").get_json()
    assert r["label"] == "November 2026" and r["current"] is True
    assert r["days_counted"] == 20 and len(r["by_day"]) == 20
    assert r["spent_paise"] == (6000 + 400 + 499) * 100
    food = r["categories"][0]
    assert food["name"] == "Food" and food["spent_paise"] == 6000_00
    assert food["usual_paise"] == (3000 + 5000) // 2 * 100
    assert food["pace_paise"] == 6000_00  # one ₹6,000 dinner isn't projected over the month
    assert r["usual"]["months"] == 2
    assert r["last_month"]["label"] == "October" and r["last_month"]["same_point_paise"] == (5000 + 499) * 100
    assert r["money_in"]["income_paise"] == 45000_00
    assert r["money_in"]["income_source"] == "bank"
    # On pace: the dinner and Netflix (one-offs) count once; only the ₹400 auto is everyday.
    assert r["pace_paise"] == (6000 + 499 + 400 * 30 // 20) * 100
    assert r["one_off_paise"] == (6000 + 499) * 100 and r["everyday_paise"] == 400_00
    assert r["money_in"]["left_paise"] == 45000_00 - r["pace_paise"]
    assert r["money_in"]["spent_share"] == round(6899 / 45000, 4)
    assert r["unlogged"] == {"count": 1, "paise": 350_00}
    assert [b["description"] for b in r["biggest"]][:2] == ["Dinner out", "Netflix"]
    assert [x["description"] for x in r["regular"]] == ["Netflix"]
    assert {p["name"] for p in r["paid_from"]} == {"Kotak", "Cash"}
    assert any("Food was" in n for n in r["notes"])
    assert any("aren't logged yet" in n for n in r["notes"])
    assert any("more than your usual" in n for n in r["notes"])


def test_report_months_are_checked(client, me):
    assert client.get("/api/reports/month?month=2026-12").status_code == 422
    assert client.get("/api/reports/month?month=nov").status_code == 422
    assert client.get("/api/reports/month").get_json()["month"] == "2026-11"


class ReportAgent:
    def __call__(self, *, system, messages, tools, call):
        self.system = system
        data = call("month_report", {"month": "2026-11", "show": True})
        assert data["spent_rupees"] == 250.0  # the model reads rupees
        return "₹250 this month, all on food.", "fake-agent", ["month_report"]


def test_ask_shows_the_report_with_follow_ups(client, me, app):
    spend(client, me, "2026-11-03", "Food", 250)
    agent = ReportAgent()
    app.extensions["finlyt.agent"] = agent
    data = client.post("/api/ask", json={"text": "Where did my money go this month?"}).get_json()
    assert data["report"]["spent_paise"] == 250_00
    assert data["followups"] == ["Is that more than usual?", "Anything else I'm missing?", "How much should I save?"]
    assert data["tools_used"] == ["month_report"]
    assert "What Finlyt remembers about my money" in agent.system
    saved = client.get(f"/api/ask/threads/{data['thread_id']}").get_json()["messages"][1]
    assert saved["report"]["month"] == "2026-11" and saved["followups"]


class RememberingAgent:
    """Hears about the laptop money and the salary, the way a model would call the tools."""

    def __init__(self, calls):
        self.calls = calls

    def __call__(self, *, system, messages, tools, call):
        results = [call(name, args) for name, args in self.calls]
        return f"Saved. {results}", "fake-agent", [name for name, _ in self.calls]


def test_ask_remembers_a_commitment_that_follows_income(client, me, app):
    app.extensions["finlyt.agent"] = RememberingAgent([
        ("remember_income", {"monthly_rupees": 45000, "note": "salary"}),
        ("remember_commitment", {
            "title": "Sister, for the laptop", "monthly_rupees": 3000, "category": "Gifts",
            "total_rupees": 24000, "already_paid_rupees": 6000, "match_words": ["sister"],
            "rules": [{"when_income_at_least_rupees": 0, "monthly_rupees": 3000},
                      {"when_income_at_least_rupees": 55000, "monthly_rupees": 6000}],
        }),
    ])
    data = client.post("/api/ask", json={"text": "I give my sister 3k a month for the 24k laptop..."}).get_json()
    assert [u["kind"] for u in data["memory_updates"]] == ["income", "commitment"]
    assert data["tools_used"] == []  # memory tools aren't data the answer looked at

    spend(client, me, "2026-11-01", "Gifts", 3000, "Paid sister for laptop")
    mem = client.get("/api/memory").get_json()
    laptop = mem["commitments"][0]
    assert mem["monthly_income_paise"] == 45000_00
    assert laptop["monthly_paise"] == 3000_00
    assert laptop["paid_paise"] == (6000 + 3000) * 100
    assert laptop["left_paise"] == 15000_00 and laptop["months_left"] == 5
    assert mem["after_commitments_paise"] == 42000_00

    # A raise: the rule moves the sister's money to ₹6,000.
    app.extensions["finlyt.agent"] = RememberingAgent([("remember_income", {"monthly_rupees": 55000})])
    data = client.post("/api/ask", json={"text": "my salary is 55k now"}).get_json()
    texts = [u["text"] for u in data["memory_updates"]]
    assert texts[0].startswith("Monthly income ₹55,000 (was ₹45,000)")
    assert any("₹3,000 → ₹6,000" in t for t in texts)
    laptop = client.get("/api/memory").get_json()["commitments"][0]
    assert laptop["monthly_paise"] == 6000_00 and laptop["months_left"] == 3

    # The same salary again changes nothing, so nothing is announced.
    data = client.post("/api/ask", json={"text": "salary still 55k"}).get_json()
    assert data["memory_updates"] == []


def test_memory_can_be_seen_and_corrected(client, me):
    resp = client.put("/api/memory/income", json={"monthly_income_paise": 45000_00})
    assert resp.status_code == 200
    resp = client.post("/api/memory/commitments", json={
        "title": "Sister, for the laptop", "monthly_paise": 3000_00, "total_paise": 24000_00,
        "rules": [{"min_income_paise": 5500000, "monthly_paise": 600000}],
    })
    assert resp.status_code == 201
    c = resp.get_json()["commitments"][0]
    assert c["monthly_paise"] == 3000_00
    assert c["match_words"] == ["laptop", "sister"]  # picked from the title

    resp = client.put("/api/memory/income", json={"monthly_income_paise": 55000_00})
    assert resp.get_json()["commitments"][0]["monthly_paise"] == 6000_00
    assert len(resp.get_json()["updates"]) == 2
    # Back under ₹55,000, it goes back to the amount it started at.
    resp = client.put("/api/memory/income", json={"monthly_income_paise": 50000_00})
    assert resp.get_json()["commitments"][0]["monthly_paise"] == 3000_00

    cid = c["id"]
    assert client.patch(f"/api/memory/commitments/{cid}", json={"active": False}).get_json()["committed_paise"] == 0
    assert client.delete(f"/api/memory/commitments/{cid}").get_json()["commitments"] == []
    assert client.delete("/api/memory/income").get_json()["monthly_income_paise"] is None
    assert client.delete("/api/memory/commitments/99999").status_code == 404


def test_check_in_remembers_and_sets_commitments_aside(client, me, app):
    planner = FakePlanner(turn(
        planned_items=[],
        monthly_budget=20000,
        remember_income=45000,
        remember_commitments=[GCommitment(title="Sister, for the laptop", monthly=3000, total=24000,
                                          rules=[GIncomeRule(when_income_at_least=55000, monthly=6000)])],
        remember_notes=["Salary comes on the 1st"],
    ))
    app.extensions["finlyt.planner"] = planner
    data = client.post("/api/plan/chat", json={"messages": [{"role": "user", "text": "salary 45k, 3k to my sister"}]}).get_json()
    assert [u["kind"] for u in data["memory_updates"]] == ["income", "commitment", "note"]
    items = data["plan"]["planned_items"]
    assert [(i["description"], i["amount_paise"]) for i in items] == [("Sister, for the laptop", 3000_00)]

    # Next turn: memory is in the instructions, and nothing new is announced.
    planner.turn = turn(planned_items=[], monthly_budget=20000)
    data = client.post("/api/plan/chat", json={"messages": [{"role": "user", "text": "ok"}]}).get_json()
    assert data["memory_updates"] == []
    assert "Commitment: Sister, for the laptop, ₹3,000 a month" in planner.calls[-1]["system"]
    assert "Note: Salary comes on the 1st" in planner.calls[-1]["system"]
    assert data["plan"]["planned_items"][0]["amount_paise"] == 3000_00


def test_finish_turn_is_still_importable():
    assert issubclass(FinishTurn, Exception)


def test_the_same_commitment_under_a_slightly_different_name_is_one(client, me):
    client.post("/api/memory/commitments", json={"title": "Sister, for laptop", "monthly_paise": 3000_00})
    resp = client.post("/api/memory/commitments", json={"title": "Sister for the laptop", "monthly_paise": 3000_00})
    assert [c["title"] for c in resp.get_json()["commitments"]] == ["Sister, for laptop"]
    assert resp.get_json()["updates"] == []  # nothing changed


def test_saving_numbers_are_worked_out_for_the_ai(client, me, app):
    client.put("/api/memory/income", json={"monthly_income_paise": 45000_00})
    client.post("/api/memory/commitments", json={"title": "Sister", "monthly_paise": 3000_00})

    class Peek:
        def __call__(self, *, system, messages, tools, call):
            self.system = system
            return "ok", "fake-agent", []

    peek = Peek()
    app.extensions["finlyt.agent"] = peek
    client.post("/api/ask", json={"text": "am i saving enough?"})
    assert "Income left after commitments: ₹42,000 a month." in peek.system
    assert "Saving 20% of that is ₹8,400 a month, which leaves ₹33,600" in peek.system


def test_rent_isnt_projected_over_the_month(client, me):
    spend(client, me, "2026-11-01", "Rent", 16000, "Rent")
    spend(client, me, "2026-11-02", "Food", 100, "Lunch")
    spend(client, me, "2026-11-03", "Food", 100, "Lunch")
    r = client.get("/api/reports/month").get_json()
    # 20 days in: rent once, plus ₹200 of food at that rate for 30 days.
    assert r["pace_paise"] == (16000 + 200 * 30 // 20) * 100
    assert r["per_day_paise"] % 100 == 0  # whole rupees


def test_possible_duplicates_from_overlapping_imports(client, me):
    def entry(desc: str) -> dict:
        return {"kind": "expense", "occurred_at": "2026-11-05T12:00:00+05:30", "description": desc,
                "category_id": me["cat"]["Groceries"], "amount_paise": 2360_00,
                "payments": [{"account_id": me["acc"]["DNS Bank"], "amount_paise": 2360_00}]}
    client.post("/api/import/commit", json={"source": "claude", "entries": [entry("Groceries")]})
    client.post("/api/import/commit", json={"source": "claude", "entries": [entry("Groceries at DMart")]})
    # Two ₹20 chais logged by hand on one day aren't duplicates.
    for _ in range(2):
        spend(client, me, "2026-11-06", "Food", 20, "Chai")
    groups = client.get("/api/expenses/duplicates").get_json()["groups"]
    assert len(groups) == 1
    assert groups[0]["total_paise"] == 2360_00
    assert sorted(i["description"] for i in groups[0]["items"]) == ["Groceries", "Groceries at DMart"]
