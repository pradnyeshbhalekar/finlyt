"""Savings goals: a target, money put towards it, and what a month it takes to get there."""

from __future__ import annotations

from datetime import date

import pytest

from .conftest import FRIEND, build_app, sign_in

TODAY = date(2026, 11, 7)


@pytest.fixture(autouse=True)
def today(monkeypatch):
    for module in ("goals", "memory", "insights", "reports"):
        monkeypatch.setattr(f"finlyt_api.services.{module}.today_ist", lambda: TODAY, raising=False)


def test_a_goal_with_money_put_towards_it(client, me):
    resp = client.post("/api/goals", json={"name": "Goa trip", "target_paise": 15000_00, "due_on": "2026-12-20"})
    assert resp.status_code == 201, resp.get_json()
    goal = resp.get_json()
    assert goal["saved_paise"] == 0 and goal["left_paise"] == 15000_00
    # November and December: two months to go.
    assert goal["months_left"] == 2
    assert goal["monthly_needed_paise"] == 7500_00

    goal = client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": 6000_00, "note": "Saved this month"}).get_json()
    assert goal["saved_paise"] == 6000_00
    assert goal["progress"] == 0.4
    assert goal["monthly_needed_paise"] == 4500_00
    assert goal["saved_this_month_paise"] == 6000_00
    assert goal["deposits"][0]["note"] == "Saved this month"

    # Taking some back out is fine; more than is saved isn't.
    goal = client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": -1000_00}).get_json()
    assert goal["saved_paise"] == 5000_00
    assert client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": -9000_00}).status_code == 422
    assert client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": 0}).status_code == 422

    goal = client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": 10000_00}).get_json()
    assert goal["done"] is True and goal["left_paise"] == 0 and goal["monthly_needed_paise"] is None


def test_changing_and_deleting_a_goal(client, me):
    goal = client.post("/api/goals", json={"name": "Phone", "target_paise": 20000_00, "due_on": "2027-03-01"}).get_json()
    goal = client.patch(f"/api/goals/{goal['id']}", json={"due_on": None, "target_paise": 25000_00}).get_json()
    assert goal["due_on"] is None and goal["monthly_needed_paise"] is None and goal["target_paise"] == 25000_00
    assert client.post("/api/goals", json={"name": "Old", "target_paise": 100_00, "due_on": "2026-01-01"}).status_code == 422
    assert client.delete(f"/api/goals/{goal['id']}").status_code == 204
    assert client.get("/api/goals").get_json()["items"] == []


def test_goals_are_private(engine):
    application, connection, outer = build_app(engine)
    try:
        client = application.test_client()
        sign_in(client)
        goal = client.post("/api/goals", json={"name": "Bike", "target_paise": 50000_00}).get_json()
        sign_in(client, FRIEND)
        assert client.get("/api/goals").get_json()["items"] == []
        assert client.post(f"/api/goals/{goal['id']}/deposits", json={"amount_paise": 100_00}).status_code == 404
        assert client.delete(f"/api/goals/{goal['id']}").status_code == 404
    finally:
        outer.rollback()
        connection.close()


class Agent:
    def __init__(self, calls):
        self.calls = calls

    def __call__(self, *, system, messages, tools, call):
        self.system = system
        for name, args in self.calls:
            call(name, args)
        return "Done.", "fake-agent", []


def test_ask_can_start_a_goal_and_sees_it_in_memory(client, me, app):
    app.extensions["finlyt.agent"] = Agent([("save_goal", {"name": "Goa trip", "target_rupees": 15000, "by_date": "2026-12-20"})])
    data = client.post("/api/ask", json={"text": "I want to save 15k for Goa by December"}).get_json()
    assert data["memory_updates"][0]["text"] == "Started a goal: Goa trip, ₹15,000 by 20 Dec"
    assert [g["name"] for g in client.get("/api/goals").get_json()["items"]] == ["Goa trip"]

    agent = Agent([])
    app.extensions["finlyt.agent"] = agent
    client.post("/api/ask", json={"text": "how am i doing?"})
    assert "Saving for Goa trip: ₹0 of ₹15,000, by 20 Dec 2026, about ₹7,500 a month" in agent.system
