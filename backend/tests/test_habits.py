"""Small habits (little spends that add up), alerts after logging, the check-in question, and the
saving plan. Made-up data only: the repo is public."""

from __future__ import annotations

from datetime import date
from urllib.parse import quote

import pytest

from finlyt_api.gemini import GHabitRule
from finlyt_api.services.habits import classify
from finlyt_api.services.quick_parse import parse

from .test_plan import FakePlanner, turn
from .test_quick_parse import NOW, ctx

TODAY = date(2026, 11, 20)  # a Friday; check-in weeks start on Sunday the 15th


@pytest.fixture(autouse=True)
def today(monkeypatch):
    for module in ("services.goals", "services.memory", "services.insights", "services.reports"):
        monkeypatch.setattr(f"finlyt_api.{module}.today_ist", lambda: TODAY, raising=False)
    for module in ("habits", "saving", "plan", "log", "expenses"):
        monkeypatch.setattr(f"finlyt_api.routes.{module}.today_ist", lambda: TODAY)


def day(n: int) -> str:
    """November the nth."""
    return date(2026, 11, n).isoformat()


def entry(me, when: str, description: str, rupees: int, category: str = "Food") -> dict:
    return {
        "occurred_at": f"{when}T16:00:00+05:30",
        "description": description,
        "category_id": me["cat"][category],
        "payments": [{"account_id": me["acc"]["Cash"], "amount_paise": rupees * 100}],
    }


def spend(client, me, when: str, description: str, rupees: int, category: str = "Food") -> list[dict]:
    """Add an entry by hand; returns the habit alerts it brought."""
    resp = client.post("/api/expenses", json=entry(me, when, description, rupees, category))
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["habits"]


def log(client, me, when: str, description: str, rupees: int, category: str = "Food") -> list[dict]:
    """Save an entry the way a logged note is saved."""
    resp = client.post("/api/log/commit", json={"expenses": [entry(me, when, description, rupees, category)]})
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["habits"]


def decide(client, key: str, **body) -> dict:
    resp = client.put(f"/api/habits/{quote(key)}", json=body)
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()


def habits(client) -> dict:
    return client.get("/api/habits").get_json()


def test_what_counts_as_a_habit():
    assert classify("Ice cream", "Food")[:2] == ("ice cream", "Ice cream")
    assert classify("icecream from medical", "Health")[0] == "ice cream"
    assert classify("Kulfi", "Food")[0] == "ice cream"
    assert classify("Cigarettes", "Groceries")[0] == "cigarettes"  # named, so it counts anywhere
    assert classify("Milk, bread and cigarettes", "Groceries")[0] == "cigarettes"  # never a grocery item
    assert classify("Milk, bread, biscuits", "Groceries") is None  # a grocery run
    assert classify("Coke and chips", "Food")[0] == "cold drinks"
    assert classify("Lunch with coffee", "Food") is None  # a meal
    assert classify("Hair cutting", "Personal care")[2] == "repeat"  # not chai; a habit only if it repeats a lot
    assert classify("Zomato", "Food")[0] == "food delivery"
    assert classify("Zomato lunch", "Food")[0] == "food delivery"
    assert classify("Swiggy Instamart", "Groceries") is None
    assert classify("Blinkit coke", "Groceries")[0] == "cold drinks"
    assert classify("Blinkit", "Groceries") is None
    assert classify("Auto", "Transport") is None
    assert classify("Gym", "Fitness") == ("gym", "", "repeat")
    assert classify("Juice at the stall", "Food")[0] == "juice"
    assert classify("Electricity", "Bills") is None


def test_ice_cream_most_days_adds_up(client, me):
    for n in range(1, 21):
        spend(client, me, day(n), ["Ice cream", "icecream", "Kulfi"][n % 3], 10)
        spend(client, me, day(n), "Groceries", 150, "Groceries")  # needs are never habits
        spend(client, me, day(n), "Lunch", 120)
        spend(client, me, day(n), "Auto", 40, "Transport")
    data = habits(client)
    assert [i["key"] for i in data["items"]] == ["ice cream"]
    ice = data["items"][0]
    assert ice["label"] == "Ice cream" and ice["kind"] == "treat"
    assert (ice["days"], ice["times"], ice["spent_paise"]) == (20, 20, 200_00)
    assert ice["month_paise"] == 210_00  # ₹200 over 4 weeks, about ₹214 a month, rounded to ₹10
    assert ice["year_paise"] == 2610_00
    assert ice["this_week"] == {"starts_on": "2026-11-15", "times": 6, "spent_paise": 60_00}
    assert ice["rule"] is None and ice["needs_answer"] is False
    assert data["total_year_paise"] == 2610_00


def test_anything_else_has_to_repeat_and_be_small(client, me):
    for n in range(1, 9):
        spend(client, me, day(n), "Juice", 40)
        spend(client, me, day(n), "Headphones", 2000, "Shopping")
    for n in range(1, 8):
        spend(client, me, day(n), "Paan shop gum", 10)  # paan: a watched item from 6 days
    keys = {i["key"]: i for i in habits(client)["items"]}
    assert keys["juice"]["kind"] == "repeat" and keys["juice"]["label"] == "Juice"
    assert "headphones" not in keys  # repeats, but not small
    assert keys["tobacco"]["days"] == 7


def test_spotted_then_a_limit(client, me):
    for n in range(1, 6):
        assert spend(client, me, day(n), "Ice cream", 10) == []
    spotted = log(client, me, day(6), "Ice cream", 10)
    assert spotted == [
        {
            "key": "ice cream",
            "label": "Ice cream",
            "kind": "spotted",
            "text": "Ice cream on 6 days in the last 4 weeks: about ₹780 a year.",
        }
    ]
    assert spend(client, me, day(6), "Ice cream", 10) == []  # the same day again: no new day
    assert spend(client, me, day(7), "Ice cream", 10) == []

    data = decide(client, "ice cream", status="limit", times_per_week=3)
    assert data["update"] == {"kind": "habit", "text": "Ice cream: at most 3 times a week"}
    rule = data["items"][0]["rule"]
    assert rule["baseline_paise_per_week"] == 80_00 * 7 // 28  # what a week cost before
    assert rule["decided_on"] == TODAY.isoformat()

    for n in (15, 16, 17):  # this week, from Sunday
        assert log(client, me, day(n), "Ice cream", 10) == []
    over = log(client, me, day(18), "Ice cream", 10)
    assert over[0]["kind"] == "over_limit"
    assert over[0]["text"] == "Ice cream: 4th time this week. Your limit is 3."
    assert spend(client, me, day(2), "Ice cream", 10) == []  # an old week: not news
    assert habits(client)["items"][0]["over"] is True


def test_stop_fine_and_a_need(client, me):
    for n in range(1, 7):
        spend(client, me, day(n), "Cigarettes", 20, "Other")
        spend(client, me, day(n), "Cold drink", 20)
        spend(client, me, day(n), "Chai", 15)
    decide(client, "cigarettes", status="limit", times_per_week=0)
    decide(client, "cold drinks", status="keep")
    data = decide(client, "chai", status="need")
    assert data["needs"] == [{"key": "chai", "label": "Chai and coffee"}]
    assert "chai" not in {i["key"] for i in data["items"]}

    alerts = spend(client, me, day(16), "Cigarettes", 20, "Other")
    assert alerts[0]["text"] == "Cigarettes again: 1st time this week. You wanted to stop."
    assert spend(client, me, day(16), "Cold drink", 20) == []  # fine: nothing to say
    assert spend(client, me, day(16), "Chai", 15) == []  # a need

    client.delete(f"/api/habits/{quote('chai')}")
    assert "chai" in {i["key"] for i in habits(client)["items"]}

    assert client.put("/api/habits/cigarettes", json={"status": "limit"}).status_code == 422
    assert client.put("/api/habits/cigarettes", json={"status": "maybe"}).status_code == 422


def test_a_limit_counts_what_it_saved(client, me):
    for n in range(1, 15):
        spend(client, me, day(n), "Ice cream", 20)  # ₹140 a week before the limit
    decide(client, "ice cream", status="limit", times_per_week=2)
    # Decided on the 20th (a Friday). The first full week under the limit starts on the 22nd.
    item = habits(client)["items"][0]
    assert item["saved_paise"] == 0 and item["saved_last_week_paise"] is None


def test_food_delivery_waits_to_be_asked(client, me):
    for n in range(1, 9):
        spend(client, me, day(n), "Zomato", 300)
    assert spend(client, me, day(9), "Zomato", 300) == []  # never flagged before I've said
    data = habits(client)
    item = data["items"][0]
    assert item["kind"] == "delivery" and item["needs_answer"] is True
    assert item["suggested_budget_paise"] == 600_00  # ₹2,700 in 4 weeks: ₹675 a week, less 10%, to ₹50
    assert data["total_month_paise"] == 0  # delivery isn't a small habit unless it's treats

    q = client.get("/api/habits/question").get_json()["question"]
    assert q["key"] == "food delivery"
    meals = q["options"][0]
    assert meals["label"] == "It's how I get my meals"
    resp = client.put(
        f"/api/habits/{quote(q['key'])}", json={k: v for k, v in meals.items() if k != "label"}
    ).get_json()
    assert resp["update"]["text"] == "Food delivery: ₹600 a week"
    notes = client.get("/api/memory").get_json()["notes"]
    assert [n["text"] for n in notes] == ["Orders food delivery for most meals"]

    decide(client, "food delivery", status="limit", paise_per_week=2000_00)
    big = spend(client, me, day(16), "Zomato", 700)
    assert big[0]["kind"] == "big_order"
    assert big[0]["text"] == "₹700 on food delivery, about 2 times your usual ₹300 order."
    over = spend(client, me, day(17), "Swiggy", 1400)
    assert over[0]["kind"] == "over_limit"
    assert over[0]["text"] == "Food delivery this week: ₹2,100, over your ₹2,000 budget."
    assert spend(client, me, day(17), "Swiggy Instamart", 900, "Groceries") == []


def test_the_check_in_question(client, me):
    for n in range(1, 21):
        spend(client, me, day(n), "Ice cream", 10)
    for n in range(1, 7):
        spend(client, me, day(n), "Cigarettes", 350, "Other")
    client.post("/api/goals", json={"name": "Goa trip", "target_paise": 15000_00, "due_on": "2026-12-20"})

    q = client.get("/api/habits/question").get_json()["question"]
    assert q["key"] == "cigarettes"  # the costliest without a decision
    assert q["text"].startswith("One more thing: cigarettes on 6 days in the last 4 weeks.")
    assert [o["label"] for o in q["options"]] == ["Cut to 1 a week", "Stop it", "It's fine", "It's a need", "Not now"]

    decide(client, "cigarettes", status="later")
    q = client.get("/api/habits/question").get_json()["question"]
    assert q["key"] == "ice cream"
    assert "a year could go to Goa trip instead" in q["text"]
    assert q["options"][0] == {"label": "Cut to 2 a week", "status": "limit", "times_per_week": 2}

    decide(client, "ice cream", status="keep")
    assert client.get("/api/habits/question").get_json()["question"] is None


def test_check_in_sees_habits_and_saves_decisions(client, me, app):
    for n in range(1, 21):
        spend(client, me, day(n), "Ice cream", 10)
    planner = FakePlanner(
        turn(
            ready=False,
            habit_rules=[
                GHabitRule(habit="Ice cream", decision="limit", times_per_week=3),
                GHabitRule(habit="ice cream", decision="sometimes"),  # not a decision: skipped
                GHabitRule(habit="cigarettes", decision="limit"),  # a limit with no number: skipped
            ],
        )
    )
    app.extensions["finlyt.planner"] = planner
    data = client.post("/api/plan/chat", json={"messages": [{"role": "user", "text": "max 3 ice creams a week"}]}).get_json()
    assert data["memory_updates"] == [{"kind": "habit", "text": "Ice cream: at most 3 times a week"}]
    system = planner.calls[0]["system"]
    assert 'Ice cream (key "ice cream"): 20 days in the last 4 weeks, ₹200' in system
    assert habits(client)["items"][0]["rule"]["times_per_week"] == 3


def test_saving_plan(client, me):
    data = client.get("/api/saving").get_json()
    assert data["needs_income"] is True and data["target_paise"] is None

    client.put("/api/memory/income", json={"monthly_income_paise": 50000_00})
    client.post("/api/memory/commitments", json={"title": "Sister, for the laptop", "monthly_paise": 3000_00})
    for month in (8, 9, 10):
        client.post("/api/expenses", json={**entry(me, date(2026, month, 10).isoformat(), "Rent", 15000, "Rent")})
        client.post("/api/expenses", json={**entry(me, date(2026, month, 12).isoformat(), "Food", 10000)})
    data = client.get("/api/saving").get_json()
    assert data["after_commitments_paise"] == 47000_00
    assert data["suggested_paise"] == data["target_paise"] == 9400_00  # 20%, down to ₹100
    assert data["target_is_set"] is False
    assert data["spending_basis"] == "usual"
    assert data["spending_paise"] == 25000_00 + 3000_00
    assert data["room_paise"] == 22000_00 and data["fits"] is True and data["short_paise"] == 0
    assert data["month"]["left_to_spend_paise"] == 50000_00 - 9400_00
    assert data["month"]["days_left"] == 11

    data = client.put("/api/saving", json={"target_paise": 25000_00}).get_json()
    assert data["target_paise"] == 25000_00 and data["target_is_set"] is True
    assert data["fits"] is False and data["short_paise"] == 3000_00
    assert client.put("/api/saving", json={"target_paise": 0}).status_code == 422
    data = client.put("/api/saving", json={"target_paise": None}).get_json()
    assert data["target_paise"] == 9400_00 and data["target_is_set"] is False


def test_saving_target_in_what_finlyt_remembers(client, me, app):
    client.put("/api/memory/income", json={"monthly_income_paise": 50000_00})
    client.put("/api/saving", json={"target_paise": 12000_00})
    planner = FakePlanner(turn(ready=False))
    app.extensions["finlyt.planner"] = planner
    client.post("/api/plan/chat", json={"messages": []})
    assert "My saving target (I set it): ₹12,000 a month, which leaves ₹38,000" in planner.calls[0]["system"]


def test_ask_has_the_habit_and_saving_tools(client, me):
    from .test_people_ai import rpc

    for n in range(1, 8):
        spend(client, me, day(n), "Ice cream", 10)
    tools = {t["name"] for t in rpc(client, "tools/list").get_json()["result"]["tools"]}
    assert {"small_habits", "saving_plan"} <= tools
    result = rpc(client, "tools/call", {"name": "small_habits", "arguments": {}}).get_json()["result"]
    assert result["structuredContent"]["items"][0]["spent_rupees"] == 70.0


def test_quick_parse_knows_treats():
    def first(text):
        proposal = parse(text, ctx(), now=NOW)
        return None if proposal is None else (proposal.expenses[0].description, proposal.expenses[0].category)

    assert first("ice cream 10 cash") == ("Ice cream", "Food")
    assert first("cigarette 20 cash") == ("Cigarette", "Other")
    assert first("thums up 40") == ("Thums Up", "Food")
    assert first("chocolate 30, chips 20") == ("Chocolate", "Food")



def test_month_report_has_small_habits(client, me):
    for n in range(10, 31):  # October: ice cream on 21 days, ₹10 each
        spend(client, me, date(2026, 10, n).isoformat(), "Ice cream", 10)
    for n in range(1, 21):  # November so far: 20 days, ₹20 each
        spend(client, me, day(n), "Ice cream", 20)
        spend(client, me, day(n), "Groceries", 150, "Groceries")
    for n in range(1, 4):
        spend(client, me, day(n), "Cold drink", 40)  # 3 days in 20: not a habit yet (5 needed)

    r = client.get("/api/reports/month?month=2026-11").get_json()
    small = r["habits"]
    assert [i["key"] for i in small["items"]] == ["ice cream"]
    ice = small["items"][0]
    assert (ice["days"], ice["spent_paise"], ice["previous_paise"]) == (20, 400_00, 210_00)
    assert ice["year_paise"] == 7300_00  # ₹400 in 20 days, over a year
    assert small["previous_label"] == "October"
    assert small["share"] == round(400 / (400 + 3000 + 120), 4)
    assert "Small habits have come to ₹400, about ₹7,300 a year at this rate, most on ice cream." in r["notes"]

    october = client.get("/api/reports/month?month=2026-10").get_json()["habits"]
    assert october["items"][0]["days"] == 21 and october["items"][0]["previous_paise"] == 0

    decide(client, "ice cream", status="keep")  # fine as it is: not counted
    assert client.get("/api/reports/month?month=2026-11").get_json()["habits"]["items"] == []
