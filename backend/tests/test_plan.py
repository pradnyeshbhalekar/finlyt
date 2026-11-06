"""Monthly budget, daily limit, buffer and the weekly check-in (Gemini faked)."""

from __future__ import annotations

from datetime import date

import pytest

from finlyt_api.gemini import GPlannedItem, GPlanTurn


def on(monkeypatch, day: date) -> None:
    monkeypatch.setattr("finlyt_api.routes.plan.today_ist", lambda: day)


def spend(client, me, when: str, category: str, rupees: int, description: str = "Spend") -> None:
    resp = client.post(
        "/api/expenses",
        json={
            "occurred_at": f"{when}T13:00:00+05:30",
            "description": description,
            "category_id": me["cat"][category],
            "payments": [{"account_id": me["acc"]["Kotak"], "amount_paise": rupees * 100}],
        },
    )
    assert resp.status_code == 201, resp.get_json()


def test_no_plan_yet(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 20))
    st = client.get("/api/plan").get_json()
    assert st["plan"] is None
    assert st["budget_paise"] is None
    assert st["today_left_paise"] is None
    assert st["check_in_due"] is True
    assert st["days_left"] == 11


def test_daily_limit_buffer_and_planned_items(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 17))
    resp = client.post(
        "/api/plan",
        json={
            "monthly_budget_paise": 30000_00,
            "daily_limit_paise": 500_00,
            "planned_items": [
                {"description": "Rent", "amount_paise": 15000_00, "due_on": "2026-11-07", "category_id": me["cat"]["Rent"]}
            ],
            "notes": "Rent first, 500 a day after",
        },
    )
    assert resp.status_code == 201, resp.get_json()

    spend(client, me, "2026-11-07", "Rent", 15000, "Rent")  # absorbed by the planned item
    spend(client, me, "2026-11-10", "Food", 999)  # before the plan: not in the buffer
    spend(client, me, "2026-11-17", "Food", 300)  # 200 under
    spend(client, me, "2026-11-18", "Food", 650)  # 150 over
    # 19th: nothing spent, 500 under
    spend(client, me, "2026-11-20", "Transport", 120)  # today

    on(monkeypatch, date(2026, 11, 20))
    st = client.get("/api/plan").get_json()
    assert st["plan"]["daily_limit_paise"] == 500_00
    assert st["budget_paise"] == 30000_00
    assert st["today_spent_paise"] == 120_00
    assert st["today_left_paise"] == 380_00
    assert st["buffer_paise"] == (200 - 150 + 500) * 100
    assert st["spent_month_paise"] == (15000 + 999 + 300 + 650 + 120) * 100
    assert st["planned_left_paise"] == 0
    assert st["planned_items"][0]["spent_paise"] == 15000_00
    # (budget - spent - planned left) / 11 days left, rounded down to ₹10.
    expected = (30000_00 - st["spent_month_paise"]) // 11 // 1000 * 1000
    assert st["suggested_daily_limit_paise"] == expected
    assert st["check_in_due"] is False

    on(monkeypatch, date(2026, 11, 22))  # Sunday, plan from the 17th
    assert client.get("/api/plan").get_json()["check_in_due"] is True


def test_rent_over_plan_counts_as_everyday_spend(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 5))
    client.post(
        "/api/plan",
        json={
            "monthly_budget_paise": 20000_00,
            "daily_limit_paise": 300_00,
            "planned_items": [{"description": "Rent", "amount_paise": 1000_00, "category_id": me["cat"]["Rent"]}],
        },
    )
    spend(client, me, "2026-11-05", "Rent", 1200, "Rent")
    st = client.get("/api/plan").get_json()
    assert st["today_spent_paise"] == 200_00  # 1,200 rent against 1,000 planned
    assert st["today_left_paise"] == 100_00


def test_replanning_replaces_items_and_keeps_one_plan_per_day(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 22))
    body = {
        "monthly_budget_paise": 40000_00,
        "daily_limit_paise": 600_00,
        "planned_items": [{"description": "Trip", "amount_paise": 3000_00, "category_id": me["cat"]["Travel"]}],
    }
    assert client.post("/api/plan", json=body).status_code == 201
    body["daily_limit_paise"] = 550_00
    body["planned_items"] = []
    st = client.post("/api/plan", json=body).get_json()
    assert st["plan"]["daily_limit_paise"] == 550_00
    assert st["planned_items"] == []


def test_plan_rejects_items_outside_the_month(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 22))
    resp = client.post(
        "/api/plan",
        json={
            "monthly_budget_paise": 40000_00,
            "daily_limit_paise": 600_00,
            "planned_items": [{"description": "Rent", "amount_paise": 100, "due_on": "2026-12-01"}],
        },
    )
    assert resp.status_code == 422


class FakePlanner:
    def __init__(self, turn: GPlanTurn) -> None:
        self.turn = turn
        self.calls: list[dict] = []

    def __call__(self, *, system, messages):
        self.calls.append({"system": system, "messages": messages})
        return self.turn, "fake-flash"


def turn(**overrides) -> GPlanTurn:
    values = {
        "reply": "Rent's set aside. ₹2,270 a day for the rest of the month?",
        "ready": True,
        "monthly_budget": 40000,
        "daily_limit": None,
        "big_day_limit": None,
        "big_days_per_week": None,
        "options": [],
        "planned_items": [GPlannedItem(description="Rent", amount=15000, date="2026-11-25", category="rent")],
        "summary": "Rent on the 25th, rest daily",
    }
    values.update(overrides)
    return GPlanTurn(**values)


@pytest.fixture
def planner(app):
    fake = FakePlanner(turn())
    app.extensions["finlyt.planner"] = fake
    return fake


def test_chat_proposes_a_checked_plan(client, me, planner, monkeypatch):
    on(monkeypatch, date(2026, 11, 20))
    resp = client.post(
        "/api/plan/chat",
        json={"messages": [{"role": "finlyt", "text": "What's coming up?"}, {"role": "user", "text": "rent 15k on 25th, budget 40k"}]},
    )
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    assert data["model"] == "fake-flash"
    plan = data["plan"]
    assert plan["monthly_budget_paise"] == 40000_00
    assert plan["planned_items"] == [
        {"description": "Rent", "amount_paise": 15000_00, "due_on": "2026-11-25", "category_id": me["cat"]["Rent"]}
    ]
    # Nothing spent yet: (40,000 - 15,000) / 11 days, rounded down to ₹10.
    assert plan["daily_limit_paise"] == (25000_00 // 11) // 1000 * 1000
    assert plan["issues"] == []

    call = planner.calls[0]
    assert "Budget for November: not set yet" in call["system"]
    assert call["messages"][-1] == ("user", "rent 15k on 25th, budget 40k")


def test_chat_keeps_talking_until_ready(client, me, planner, monkeypatch):
    on(monkeypatch, date(2026, 11, 20))
    planner.turn = turn(ready=False, reply="What's your budget for November?")
    data = client.post("/api/plan/chat", json={"messages": []}).get_json()
    assert data["plan"] is None
    assert data["reply"] == "What's your budget for November?"

    planner.turn = turn(monthly_budget=None)  # ready, but no budget anywhere yet
    assert client.post("/api/plan/chat", json={"messages": []}).get_json()["plan"] is None
