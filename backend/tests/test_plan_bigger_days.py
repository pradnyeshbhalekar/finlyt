"""Usual and bigger days, the chosen check-in day, and questions with answers to tap."""

from __future__ import annotations

from datetime import date

import httpx

from finlyt_api.gemini import FinishTurn, GroqJson

from .test_plan import FakePlanner, on, spend, turn

# November 2026: the 1st, 8th, 15th, 22nd and 29th are Sundays, the default check-in day.


def plan(client, **overrides) -> None:
    body = {
        "monthly_budget_paise": 10000_00,
        "daily_limit_paise": 100_00,
        "big_day_limit_paise": 350_00,
        "big_days_per_week": 2,
    }
    body.update(overrides)
    resp = client.post("/api/plan", json=body)
    assert resp.status_code == 201, resp.get_json()


def test_days_past_the_usual_limit_use_up_the_weeks_bigger_days(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 8))
    plan(client)
    spend(client, me, "2026-11-08", "Food", 60)  # usual: 40 under
    spend(client, me, "2026-11-09", "Food", 300)  # bigger day 1: 50 under
    spend(client, me, "2026-11-10", "Food", 400)  # bigger day 2: 50 over
    spend(client, me, "2026-11-11", "Food", 200)  # none left, so usual: 100 over
    # 12th: nothing, 100 under
    spend(client, me, "2026-11-13", "Food", 150)  # today, still no bigger day left

    on(monkeypatch, date(2026, 11, 13))
    st = client.get("/api/plan").get_json()
    assert st["plan"]["big_day_limit_paise"] == 350_00
    assert st["plan"]["big_days_per_week"] == 2
    assert st["plan"]["weekly_paise"] == (100 * 7 + 250 * 2) * 100
    assert st["buffer_paise"] == (40 + 50 - 50 - 100 + 100) * 100
    assert st["today_limit_paise"] == 100_00
    assert st["today_is_big_day"] is False
    assert st["today_left_paise"] == -50_00
    assert st["big_days_left"] == 0

    # A new week (Sunday the 15th) brings its bigger days back.
    spend(client, me, "2026-11-15", "Food", 250)
    on(monkeypatch, date(2026, 11, 15))
    st = client.get("/api/plan").get_json()
    assert st["today_is_big_day"] is True
    assert st["today_limit_paise"] == 350_00
    assert st["today_left_paise"] == 100_00
    assert st["big_days_left"] == 1


def test_a_quiet_day_stays_a_usual_day(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 8))
    plan(client)
    spend(client, me, "2026-11-08", "Food", 70)
    st = client.get("/api/plan").get_json()
    assert st["today_limit_paise"] == 100_00
    assert st["today_left_paise"] == 30_00
    assert st["big_days_left"] == 2


def test_one_flat_limit_still_works(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 8))
    plan(client, big_day_limit_paise=None, big_days_per_week=0, daily_limit_paise=210_00)
    spend(client, me, "2026-11-08", "Food", 300)
    st = client.get("/api/plan").get_json()
    assert st["plan"]["big_day_limit_paise"] is None
    assert st["plan"]["big_days_per_week"] == 0
    assert st["today_limit_paise"] == 210_00
    assert st["today_left_paise"] == -90_00
    assert st["big_days_left"] is None


def test_a_bigger_day_must_be_bigger(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 8))
    resp = client.post(
        "/api/plan",
        json={"monthly_budget_paise": 10000_00, "daily_limit_paise": 300_00, "big_day_limit_paise": 200_00, "big_days_per_week": 2},
    )
    assert resp.status_code == 422


def test_check_in_day_is_the_users_choice(client, me, monkeypatch):
    on(monkeypatch, date(2026, 11, 10))  # a Tuesday
    assert client.get("/api/plan").get_json()["check_in_weekday"] == 6  # Sunday by default
    plan(client)

    resp = client.put("/api/plan/check-in", json={"weekday": 4})  # Friday
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["check_in_weekday"] == 4
    assert client.put("/api/plan/check-in", json={"weekday": 7}).status_code == 422

    on(monkeypatch, date(2026, 11, 13))  # Friday, plan from Tuesday: time to check in
    assert client.get("/api/plan").get_json()["check_in_due"] is True
    on(monkeypatch, date(2026, 11, 15))  # Sunday isn't the check-in day any more
    assert client.get("/api/plan").get_json()["check_in_due"] is False


def test_weeks_start_on_the_check_in_day(client, me, monkeypatch):
    client.put("/api/plan/check-in", json={"weekday": 2})  # Wednesday
    on(monkeypatch, date(2026, 11, 9))  # Monday
    plan(client)
    spend(client, me, "2026-11-09", "Food", 300)  # bigger day 1 (week from Wed 4th)
    spend(client, me, "2026-11-10", "Food", 300)  # bigger day 2
    spend(client, me, "2026-11-11", "Food", 300)  # Wednesday: a new week, bigger day 1 again
    on(monkeypatch, date(2026, 11, 11))
    st = client.get("/api/plan").get_json()
    assert st["today_is_big_day"] is True
    assert st["big_days_left"] == 1
    assert st["buffer_paise"] == (50 + 50) * 100


def test_chat_proposes_usual_and_bigger_days_and_checks_the_fit(client, me, app, monkeypatch):
    on(monkeypatch, date(2026, 11, 20))  # 11 days left
    fake = FakePlanner(turn(daily_limit=100, big_day_limit=350, big_days_per_week=2, planned_items=[], monthly_budget=10000))
    app.extensions["finlyt.planner"] = fake
    data = client.post("/api/plan/chat", json={"messages": [{"role": "user", "text": "most days 50-100, sometimes 350"}]}).get_json()
    p = data["plan"]
    assert (p["daily_limit_paise"], p["big_day_limit_paise"], p["big_days_per_week"]) == (100_00, 350_00, 2)
    assert p["available_paise"] == 10000_00
    assert p["days_left"] == 11
    assert p["issues"] == []
    assert "My check-in day: Sunday" in fake.calls[0]["system"]

    # 11 days: 100 a day, plus 250 extra on 2 days a week (spread over 11/7 weeks).
    assert p["projected_paise"] == 100_00 * 11 + 250_00 * 2 * 11 // 7

    # A "bigger" day that isn't bigger is dropped.
    fake.turn = turn(daily_limit=300, big_day_limit=200, big_days_per_week=2, planned_items=[], monthly_budget=10000)
    p = client.post("/api/plan/chat", json={"messages": []}).get_json()["plan"]
    assert (p["big_day_limit_paise"], p["big_days_per_week"]) == (None, 0)


def test_chat_questions_come_with_answers_to_tap(client, me, app, monkeypatch):
    on(monkeypatch, date(2026, 11, 20))
    options = ["Nothing special this week", "  Dinner with family ", "", "A trip", "Bills", "Too many"]
    app.extensions["finlyt.planner"] = FakePlanner(turn(ready=False, reply="What's coming up this week?", options=options))
    data = client.post("/api/plan/chat", json={"messages": []}).get_json()
    assert data["reply"] == "What's coming up this week?"
    assert data["options"] == ["Nothing special this week", "Dinner with family", "A trip", "Bills"]


class AskingAgent:
    """Asks a question back through the ask_user tool, the way the real agents run tools."""

    def __call__(self, *, system, messages, tools, call):
        assert "ask_user" in [t.name for t in tools]
        try:
            call("ask_user", {"question": "This month or last month?", "options": ["This month", "Last month"]})
        except FinishTurn as done:
            return done.reply, "fake-agent", ["ask_user"]
        return "should not get here", "fake-agent", []


def test_ask_can_ask_back_with_answers_to_tap(client, me, app):
    app.extensions["finlyt.agent"] = AskingAgent()
    data = client.post("/api/ask", json={"text": "food kitna hua?"}).get_json()
    assert data["reply"] == "This month or last month?"
    assert data["options"] == ["This month", "Last month"]
    assert data["tools_used"] == []
    chat = client.get(f"/api/ask/threads/{data['thread_id']}").get_json()
    assert chat["messages"][1]["options"] == ["This month", "Last month"]
    assert chat["messages"][0]["options"] == []


def test_groq_agent_stops_when_a_tool_finishes_the_turn():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        tool_call = {
            "id": "c1",
            "type": "function",
            "function": {"name": "ask_user", "arguments": '{"question": "Which month?", "options": ["Nov", "Oct"]}'},
        }
        return httpx.Response(200, json={"choices": [{"message": {"content": "", "tool_calls": [tool_call]}}]})

    groq = GroqJson("test-key", http=httpx.Client(transport=httpx.MockTransport(handler)))

    def call(name, args):
        raise FinishTurn(args["question"])

    reply, model, used = groq.agent(system="sys", messages=[{"role": "user", "content": "food?"}], tools=[], call=call)
    assert (reply, used) == ("Which month?", ["ask_user"])
    assert model.startswith("groq/")
    assert len(calls) == 1  # no second round after the question
