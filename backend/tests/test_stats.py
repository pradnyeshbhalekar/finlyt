from __future__ import annotations


def expense(me, when, description, payments, dues=()):
    return {
        "occurred_at": when,
        "description": description,
        "category_id": me["cat"]["Food"] if "Auto" not in description else me["cat"]["Transport"],
        "payments": [{"account_id": me["acc"][a], "amount_paise": p} for a, p in payments],
        "dues": [{"person_name": n, "amount_paise": p} for n, p in dues],
    }


def test_stats_use_my_share_and_ist_days(client, me):
    rows = [
        # ₹450 on Kotak, Rahul owes ₹200 → my share ₹250
        expense(me, "2026-11-04T13:12:00+05:30", "Lunch", [("Kotak", 45000)], [("Rahul", 20000)]),
        # ₹120 Kotak + ₹30 cash, late on the 4th (IST)
        expense(me, "2026-11-04T23:30:00+05:30", "Auto", [("Kotak", 12000), ("Cash", 3000)]),
        # After midnight IST → the 5th, even though it's still the 4th in UTC
        expense(me, "2026-11-05T00:30:00+05:30", "Chai", [("Cash", 4000)]),
    ]
    for row in rows:
        assert client.post("/api/expenses", json=row).status_code == 201

    day = client.get("/api/stats?from=2026-11-04&to=2026-11-04").get_json()
    assert day["spend_paise"] == 25000 + 15000
    assert day["expense_count"] == 2
    assert day["by_day"] == [{"day": "2026-11-04", "spend_paise": 40000}]
    by_account = {row["account_id"]: row["paid_paise"] for row in day["by_account"]}
    assert by_account == {me["acc"]["Kotak"]: 57000, me["acc"]["Cash"]: 3000}
    by_category = {row["category_id"]: row["spend_paise"] for row in day["by_category"]}
    assert by_category == {me["cat"]["Food"]: 25000, me["cat"]["Transport"]: 15000}
    assert day["open_dues_paise"] == 20000

    both = client.get("/api/stats?from=2026-11-04&to=2026-11-05").get_json()
    assert [d["day"] for d in both["by_day"]] == ["2026-11-04", "2026-11-05"]
    assert both["spend_paise"] == 44000


def test_stats_rejects_backwards_range(client, me):
    resp = client.get("/api/stats?from=2026-11-05&to=2026-11-04")
    assert resp.status_code == 422
