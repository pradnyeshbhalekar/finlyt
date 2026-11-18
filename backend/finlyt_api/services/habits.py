"""Small habits: little spends that come back most days and add up over a year.

Ice cream for ₹10 most days doesn't look like much, but it's about ₹3,000 a year. This finds
them in the last four weeks: things on a watch list (cigarettes, ice cream, cold drinks, chai,
snacks…) bought on at least 6 days, and anything else non-essential bought on at least 8 days
for a small amount. Needs are never habits: groceries, rent, bills, medicine, getting around and
meals. Food delivery is its own case: for someone who lives alone it's how they eat, so it's
never flagged until I've said how I use it (meals get a weekly budget, treats a limit).

What I decide about a habit (a limit, it's fine, it's a need, ask later) is a HabitRule, keyed
by the habit's key ("ice cream"). Alerts after logging (`alerts_for`) and the weekly check-in's
question (`context`) both read it.

Only an entry's description is read, not my words (`note_raw`): one note can cover several
entries ("chai 20, petrol 500"), so its words don't say which entry is which.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import HABIT_STATUSES, Category, Expense, Goal, HabitRule, User
from ..money import rupees
from ..timeutil import IST, ist_day_bounds
from .memory import Update
from .planning import week_start
from .quick_parse import CATEGORY_OF

WINDOW_DAYS = 28
MIN_DAYS = 6  # a watched item bought on this many days in four weeks is a habit
MIN_DAYS_REPEAT = 8  # anything else needs more days…
REPEAT_MAX_PAISE = 300_00  # …and to be small: the typical one costs at most this
SPOTTED_AT = (10, 15, 20)  # day counts that say "spotted" again (after the first)
BIG_ORDER = 2  # a delivery order this many times the usual one is pointed out
MIN_ORDERS = 4  # orders needed before there's a "usual" order
ASK_AGAIN_LATER_DAYS = 28
ASK_AGAIN_KEEP_DAYS = 90
SAVINGS_WEEKS = 26  # savings from a limit are counted over at most this many weeks
DELIVERY = "food delivery"


@dataclass(frozen=True)
class Group:
    key: str
    label: str
    words: frozenset[str]
    # Never part of a meal or a grocery run, so staple words in the same entry don't hide it.
    strong: bool = False


def _words(text: str) -> frozenset[str]:
    return frozenset(text.split())


# Watched items, most specific first: "zomato ice cream" is ice cream, not a meal.
GROUPS: tuple[Group, ...] = (
    Group(
        "cigarettes",
        "Cigarettes",
        _words("cigarette cigaret cigarete ciggy ciggie cig sutta bidi beedi vape goldflake marlboro smoke"),
        strong=True,
    ),
    Group("tobacco", "Paan and tobacco", _words("paan panmasala gutkha tobacco khaini zarda kharra rajnigandha vimal"), strong=True),
    Group("drinks", "Drinks", _words("beer daru whisky whiskey vodka rum wine liquor alcohol pub theka breezer"), strong=True),
    Group("ice cream", "Ice cream", _words("icecream kulfi sundae gelato softy cornetto baskin")),
    Group(
        "chocolate",
        "Chocolate and sweets",
        _words("chocolate choco dairymilk kitkat snickers munch candy toffee mithai sweet jalebi brownie"),
    ),
    Group(
        "cold drinks",
        "Cold drinks",
        _words(
            "coke cocacola pepsi sprite fanta limca thumsup mountaindew maaza frooti soda colddrink "
            "softdrink redbull monster sting energydrink"
        ),
    ),
    Group(
        "chai",
        "Chai and coffee",
        _words("chai tea coffee coldcoffee starbucks ccd chaayos chaipoint cappuccino latte espresso bluetokai"),
    ),
    Group(
        "snacks",
        "Snacks",
        _words(
            "chip snack lays kurkure biscuit namkeen samosa vadapav panipuri golgappa golgappe bhel sevpuri chaat "
            "maggi momo puff pastry kachori pakoda pakora bhajiya frankie nacho popcorn cookie donut"
        ),
    ),
)
GROUP_BY_KEY = {g.key: g for g in GROUPS}
DELIVERY_WORDS = _words("zomato swiggy eatsure")

# Two words that mean one thing: "ice cream" is one item, like "icecream".
JOINS = {
    "ice cream": "icecream",
    "cold drink": "colddrink",
    "soft drink": "softdrink",
    "cold coffee": "coldcoffee",
    "energy drink": "energydrink",
    "thums up": "thumsup",
    "mountain dew": "mountaindew",
    "coca cola": "cocacola",
    "red bull": "redbull",
    "dairy milk": "dairymilk",
    "kit kat": "kitkat",
    "pan masala": "panmasala",
    "gold flake": "goldflake",
    "vada pav": "vadapav",
    "pani puri": "panipuri",
    "sev puri": "sevpuri",
    "chai point": "chaipoint",
    "blue tokai": "bluetokai",
}
_JOIN = re.compile(r"\b(" + "|".join(re.escape(p) for p in sorted(JOINS, key=len, reverse=True)) + r")\b")

# Needs. A staple or a meal in an entry means it isn't a treat ("milk, bread, biscuits" is a
# grocery run, "lunch with coffee" a meal).
STAPLES = _words(
    "milk doodh bread egg vegetable veggie sabzi sabji fruit atta rice dal ration grocery groceries "
    "lunch dinner breakfast tiffin dabba thali meal khana food "
    "poha upma idli dosa paratha roti chapati khichdi biryani pulao "
    "medicine tablet doctor "
    "petrol diesel fuel cng auto rickshaw metro bus train uber ola rapido cab taxi parking toll "
    "recharge rent bill electricity wifi gas water"
)
# Shops and places: a need when that's all it says, but "ice cream from the medical store" or
# "blinkit coke" names a treat.
NEED_PLACES = _words(
    "blinkit zepto instamart bigbasket dmart kirana jiomart medical pharmacy chemist canteen mess "
    "restaurant hotel dhaba"
)
NEED_CATEGORIES = {"groceries", "rent", "bills", "health", "transport", "education", "investments", "travel", "gifts"}
# Words that don't say what was bought.
QUIET = _words(
    "the a an for of to my and at from in on with by via cash upi gpay paytm phonepe card online paid pay "
    "rs inr bought buy some one two daily today shop stall store near office home fresh small big large "
    "extra cup glass packet pack bottle piece"
)


def _stem(word: str) -> str:
    return word[:-1] if len(word) > 3 and word.endswith("s") and not word.endswith("ss") else word


def words_of(description: str) -> list[str]:
    text = " ".join(re.findall(r"[a-z]+", description.lower()))
    return _JOIN.sub(lambda m: JOINS[m.group(1)], text).split()


def classify(description: str, category: str | None) -> tuple[str, str, str] | None:
    """(key, label, kind) for an entry that could be part of a habit, or None for a need.
    kind is "treat" (on the watch list), "delivery" or "repeat" (anything else non-essential)."""
    words = words_of(description)
    if not words:
        return None
    forms = {*words, *(_stem(w) for w in words)}
    staple = bool(forms & STAPLES)
    for g in GROUPS:
        if forms & g.words and (g.strong or not staple):
            return g.key, g.label, "treat"
    if forms & DELIVERY_WORDS:
        # Swiggy Instamart is groceries; a Zomato lunch is still delivery.
        return None if forms & NEED_PLACES else (DELIVERY, "Food delivery", "delivery")
    if staple or forms & NEED_PLACES or (category or "").strip().lower() in NEED_CATEGORIES:
        return None
    meaningful = [w for w in words if w not in QUIET and len(w) > 1]
    if not meaningful:
        return None
    known = next((w for w in meaningful if w in CATEGORY_OF), None)
    return (known or " ".join(meaningful[:2])), "", "repeat"


def normalise_key(key: str) -> str:
    return " ".join(key.lower().split())[:60]


# ── Reading the habits ────────────────────────────────────────────────────────


@dataclass
class _Item:
    key: str
    label: str
    kind: str
    entries: list[tuple[date, int, int]] = field(default_factory=list)  # (day, paise, expense id)
    label_day: date | None = None


def _round10(paise: int) -> int:
    return round(paise / 1000) * 1000


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def _weekday(s: Session, user_id: int) -> int:
    value = s.scalar(select(User.check_in_weekday).where(User.id == user_id))
    return 6 if value is None else int(value)


def _rules(s: Session, user_id: int) -> dict[str, HabitRule]:
    return {r.key: r for r in s.scalars(select(HabitRule).where(HabitRule.user_id == user_id))}


def _load(s: Session, user_id: int, since: date, until: date) -> dict[str, _Item]:
    lo, hi = ist_day_bounds(since, until)
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    rows = s.execute(
        select(Expense.id, Expense.occurred_at, Expense.description, Expense.category_id, Expense.my_share_paise)
        .where(
            Expense.user_id == user_id,
            Expense.occurred_at >= lo,
            Expense.occurred_at < hi,
            Expense.my_share_paise > 0,
        )
        .order_by(Expense.occurred_at)
    ).all()
    items: dict[str, _Item] = {}
    for expense_id, at, description, category_id, share in rows:
        found = classify(description, names.get(category_id))
        if found is None:
            continue
        key, label, kind = found
        day = at.astimezone(IST).date()
        item = items.setdefault(key, _Item(key, label, kind))
        item.entries.append((day, int(share), expense_id))
        if kind == "repeat" and (item.label_day is None or day >= item.label_day):
            # Named the way I last wrote it.
            item.label, item.label_day = description.strip()[:60], day
    return items


def _qualifies(kind: str, days: int, typical: int) -> bool:
    if kind == "repeat":
        return days >= MIN_DAYS_REPEAT and typical <= REPEAT_MAX_PAISE
    return days >= MIN_DAYS


def _since(today: date, weekday: int, rules: dict[str, HabitRule]) -> date:
    """How far back to read: two windows, and the weeks since each limit started."""
    since = today - timedelta(days=WINDOW_DAYS * 2 - 1)
    oldest = today - timedelta(weeks=SAVINGS_WEEKS)
    for r in rules.values():
        if r.status == "limit":
            since = min(since, max(week_start(r.decided_on, weekday), oldest))
    return since


def _savings(rule: HabitRule, entries: list[tuple[date, int, int]], today: date, weekday: int) -> tuple[int, int | None]:
    """What a limit has saved: each full week since it started, against what a week cost before.
    Returns (all of it, last week's) — last week's is None before a full week has passed."""
    first = week_start(rule.decided_on, weekday)
    if first != rule.decided_on:
        first += timedelta(days=7)  # the week I decided in was only partly under the limit
    first = max(first, week_start(today, weekday) - timedelta(weeks=SAVINGS_WEEKS))
    this_week = week_start(today, weekday)
    total, last = 0, None
    week = first
    while week < this_week:
        spent = sum(p for d, p, _ in entries if week <= d < week + timedelta(days=7))
        last = max(rule.baseline_paise_per_week - spent, 0)
        total += last
        week += timedelta(days=7)
    return total, last


def rule_json(r: HabitRule) -> dict[str, Any]:
    return {
        "status": r.status,
        "times_per_week": r.times_per_week,
        "paise_per_week": r.paise_per_week,
        "baseline_paise_per_week": r.baseline_paise_per_week,
        "goal_id": r.goal_id,
        "decided_on": r.decided_on.isoformat(),
    }


def _item_json(item: _Item, rule: HabitRule | None, today: date, weekday: int) -> dict[str, Any]:
    start = today - timedelta(days=WINDOW_DAYS - 1)
    before = start - timedelta(days=WINDOW_DAYS)
    now = [(d, p) for d, p, _ in item.entries if start <= d <= today]
    amounts = sorted(p for _, p in now)
    spent = sum(amounts)
    week = week_start(today, weekday)
    this_week = [p for d, p in now if d >= week]
    saved, saved_last_week = (None, None)
    if rule is not None and rule.status == "limit":
        saved, saved_last_week = _savings(rule, item.entries, today, weekday)
    last = max((d for d, _ in now), default=None)
    over = False
    if rule is not None and rule.status == "limit":
        if rule.times_per_week is not None and len(this_week) > rule.times_per_week:
            over = True
        if rule.paise_per_week and sum(this_week) > rule.paise_per_week:
            over = True
    return {
        "key": item.key,
        "label": rule.label if rule is not None else item.label,
        "kind": item.kind,
        "days": len({d for d, _ in now}),
        "times": len(now),
        "spent_paise": spent,
        "typical_paise": amounts[len(amounts) // 2] if amounts else 0,
        "month_paise": _round10(spent * 30 // WINDOW_DAYS),
        "year_paise": _round10(spent * 365 // WINDOW_DAYS),
        "previous_paise": sum(p for d, p, _ in item.entries if before <= d < start),
        "this_week": {"starts_on": week.isoformat(), "times": len(this_week), "spent_paise": sum(this_week)},
        "rule": rule_json(rule) if rule is not None else None,
        "over": over,
        "saved_paise": saved,
        "saved_last_week_paise": saved_last_week,
        "per_week": round(len(now) * 7 / WINDOW_DAYS, 1),
        "suggested_budget_paise": max(spent * 7 // WINDOW_DAYS * 9 // 10 // 5000 * 5000, 100_00)
        if item.kind == "delivery"
        else None,
        "needs_answer": item.kind == "delivery" and rule is None,
        "last_on": last.isoformat() if last else None,
    }


def _counts(item: dict[str, Any]) -> bool:
    """Part of "small habits cost ₹X a month": not ones I said are fine, and delivery only when
    I said it's a treat (as meals it's food, with a budget)."""
    rule = item["rule"]
    if rule is not None and rule["status"] == "keep":
        return False
    if item["kind"] == "delivery":
        return rule is not None and rule["status"] == "limit" and rule["times_per_week"] is not None
    return True


def habits(s: Session, user_id: int, today: date) -> dict[str, Any]:
    weekday = _weekday(s, user_id)
    rules = _rules(s, user_id)
    loaded = _load(s, user_id, _since(today, weekday, rules), today)
    items = []
    for key, item in loaded.items():
        rule = rules.get(key)
        if rule is not None and rule.status == "need":
            continue
        data = _item_json(item, rule, today, weekday)
        if rule is None and not _qualifies(item.kind, data["days"], data["typical_paise"]):
            continue
        items.append(data)
    # Decisions about habits that have gone quiet stay listed (a limit of 0 that's working).
    for key, rule in rules.items():
        if key not in loaded and rule.status in ("limit", "keep", "later"):
            group = GROUP_BY_KEY.get(key)
            kind = "treat" if group else ("delivery" if key == DELIVERY else "repeat")
            items.append(_item_json(_Item(key, rule.label, kind), rule, today, weekday))
    items.sort(key=lambda i: (i["year_paise"], i["times"]), reverse=True)
    counted = [i for i in items if _counts(i)]
    return {
        "window_days": WINDOW_DAYS,
        "week_starts_on": week_start(today, weekday).isoformat(),
        "items": items,
        "needs": [{"key": r.key, "label": r.label} for r in rules.values() if r.status == "need"],
        "total_month_paise": sum(i["month_paise"] for i in counted),
        "total_year_paise": sum(i["year_paise"] for i in counted),
    }


# ── Alerts after logging ──────────────────────────────────────────────────────


def alerts_for(s: Session, user_id: int, expense_ids: list[int], today: date) -> list[dict[str, str]]:
    """One line per habit the entries just saved touch, when there's something to say:
    over_limit (past my weekly limit or budget), big_order (a delivery order about twice the
    usual, when delivery has a budget) or spotted (no decision yet, and it just reached 6, 10,
    15 or 20 days in four weeks). The app shows them according to my alert setting."""
    if not expense_ids:
        return []
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    saved: dict[str, set[int]] = {}
    for expense_id, description, category_id in s.execute(
        select(Expense.id, Expense.description, Expense.category_id).where(
            Expense.user_id == user_id, Expense.id.in_(expense_ids), Expense.my_share_paise > 0
        )
    ).all():
        found = classify(description, names.get(category_id))
        if found is not None:
            saved.setdefault(found[0], set()).add(expense_id)
    if not saved:
        return []
    weekday = _weekday(s, user_id)
    rules = _rules(s, user_id)
    start = today - timedelta(days=WINDOW_DAYS - 1)
    loaded = _load(s, user_id, start, today)
    week = week_start(today, weekday)
    out = []
    for key, ids in saved.items():
        item = loaded.get(key)
        if item is None:
            continue  # saved for a day outside the last four weeks: old news
        rule = rules.get(key)
        new = [(d, p) for d, p, i in item.entries if i in ids]
        label = rule.label if rule is not None else item.label
        if rule is not None and rule.status == "limit":
            if not any(d >= week for d, _ in new):
                continue
            this_week = [(d, p, i) for d, p, i in item.entries if d >= week]
            times, spent = len(this_week), sum(p for _, p, _ in this_week)
            text, kind = None, "over_limit"
            if rule.times_per_week is not None and times > rule.times_per_week:
                if rule.times_per_week == 0:
                    text = f"{label} again: {_ordinal(times)} time this week. You wanted to stop."
                else:
                    text = f"{label}: {_ordinal(times)} time this week. Your limit is {rule.times_per_week}."
            elif rule.paise_per_week and spent > rule.paise_per_week:
                text = f"{label} this week: {rupees(spent)}, over your {rupees(rule.paise_per_week)} budget."
            elif rule.paise_per_week and item.kind == "delivery":
                earlier = sorted(p for _, p, i in item.entries if i not in ids)
                biggest = max(p for d, p in new if d >= week)
                if len(earlier) >= MIN_ORDERS:
                    usual = earlier[len(earlier) // 2]
                    if biggest >= usual * BIG_ORDER:
                        text, kind = (
                            f"{rupees(biggest)} on food delivery, about {round(biggest / usual)} times your usual "
                            f"{rupees(_round10(usual))} order.",
                            "big_order",
                        )
            if text:
                out.append({"key": key, "label": label, "kind": kind, "text": text})
            continue
        if rule is not None or item.kind == "delivery":
            continue  # fine, a need, ask later, or delivery not asked about yet: say nothing
        amounts = sorted(p for _, p, _ in item.entries)
        days_after = len({d for d, _, _ in item.entries})
        days_before = len({d for d, _, i in item.entries if i not in ids})
        typical = amounts[len(amounts) // 2]
        floor = MIN_DAYS_REPEAT if item.kind == "repeat" else MIN_DAYS
        if not _qualifies(item.kind, days_after, typical):
            continue
        if any(days_before < t <= days_after for t in (floor, *SPOTTED_AT) if t >= floor):
            year = _round10(sum(amounts) * 365 // WINDOW_DAYS)
            out.append(
                {
                    "key": key,
                    "label": label,
                    "kind": "spotted",
                    "text": f"{label} on {days_after} days in the last 4 weeks: about {rupees(year)} a year.",
                }
            )
    return out


# ── For the check-in and Ask ──────────────────────────────────────────────────


def question_for(data: dict[str, Any], today: date) -> dict[str, Any] | None:
    """The one habit worth asking about now: the costliest with no decision yet, or one I said
    to ask about later (after four weeks) or said was fine (after three months)."""
    candidates = []
    for item in data["items"]:
        rule = item["rule"]
        if rule is None:
            candidates.append(item)
            continue
        decided = date.fromisoformat(rule["decided_on"])
        if rule["status"] == "later" and (today - decided).days >= ASK_AGAIN_LATER_DAYS and item["days"] >= MIN_DAYS:
            candidates.append(item)
        elif rule["status"] == "keep" and (today - decided).days >= ASK_AGAIN_KEEP_DAYS and item["days"] >= MIN_DAYS:
            candidates.append(item)
    return max(candidates, key=lambda i: i["year_paise"], default=None)


def _line(item: dict[str, Any]) -> str:
    count = f"{item['times']} orders" if item["kind"] == "delivery" else f"{item['days']} days"
    line = (
        f"- {item['label']} (key \"{item['key']}\"): {count} in the last 4 weeks, {rupees(item['spent_paise'])}, "
        f"about {rupees(item['month_paise'])} a month or {rupees(item['year_paise'])} a year"
    )
    rule, week = item["rule"], item["this_week"]
    if rule is None:
        if item["kind"] == "delivery":
            line += "; not asked yet whether delivery is how I get my meals or a treat"
        else:
            line += "; no decision yet"
    elif rule["status"] == "limit":
        if rule["times_per_week"] is not None:
            limit = "stop it (none a week)" if rule["times_per_week"] == 0 else f"at most {rule['times_per_week']} a week"
            line += f"; my limit: {limit}, {week['times']} so far this week"
        else:
            line += f"; my budget: {rupees(rule['paise_per_week'] or 0)} a week, {rupees(week['spent_paise'])} so far this week"
        if item["saved_last_week_paise"] is not None:
            line += (
                f"; last week cost {rupees(item['saved_last_week_paise'])} less than a week before the limit, "
                f"{rupees(item['saved_paise'] or 0)} saved since"
            )
    elif rule["status"] == "keep":
        line += "; I said it's fine"
    elif rule["status"] == "later":
        line += "; I said to ask another time"
    return line + "."


def context(s: Session, user_id: int, today: date) -> str:
    """Small habits as lines for an AI's instructions (the check-in and Ask)."""
    data = habits(s, user_id, today)
    head = (
        "Small habits (little non-essential spends that repeat; needs like groceries, rent, bills, "
        "medicine, getting around and meals are never habits):"
    )
    lines = [_line(i) for i in data["items"][:6]]
    if not lines:
        lines.append("- None spotted in the last 4 weeks.")
    elif data["total_month_paise"]:
        lines.append(
            f"- Together: about {rupees(data['total_month_paise'])} a month, {rupees(data['total_year_paise'])} a year."
        )
    if data["needs"]:
        lines.append("- Needs, not habits (never bring these up): " + ", ".join(n["label"] for n in data["needs"]) + ".")
    return head + "\n" + "\n".join(lines)


def question(s: Session, user_id: int, today: date) -> dict[str, Any] | None:
    """The check-in's closing question about one habit, with answers to tap. Each answer carries
    the decision it makes (the body for PUT /api/habits/<key>), so no AI is needed to read it."""
    data = habits(s, user_id, today)
    pick = question_for(data, today)
    if pick is None:
        return None
    label = pick["label"]
    if pick["kind"] == "delivery":
        budget = pick["suggested_budget_paise"]
        treats = max(1, int(pick["per_week"] // 2))
        text = (
            f"One more thing: you ordered food {pick['times']} times in the last 4 weeks, about "
            f"{rupees(pick['month_paise'])} a month. How do you use delivery?"
        )
        options = [
            {
                "label": "It's how I get my meals",
                "status": "limit",
                "paise_per_week": budget,
                "note": "Orders food delivery for most meals",
            },
            {"label": "Mostly treats", "status": "limit", "times_per_week": treats},
            {"label": "Both", "status": "limit", "paise_per_week": budget},
            {"label": "Not now", "status": "later"},
        ]
    else:
        cut = max(1, min(3, int(pick["per_week"] // 2)))
        text = (
            f"One more thing: {label[:1].lower() + label[1:] if pick['kind'] == 'treat' else label} on "
            f"{pick['days']} days in the last 4 weeks. That's about {rupees(pick['year_paise'])} a year."
        )
        goal = s.scalar(
            select(Goal.name).where(Goal.user_id == user_id, Goal.archived.is_(False)).order_by(Goal.due_on.nulls_last(), Goal.id)
        )
        freed = _round10(max(pick["year_paise"] - pick["typical_paise"] * cut * 52, 0))
        if goal and freed:
            text += f" At {cut} a week, about {rupees(freed)} a year could go to {goal} instead."
        text += " Want to set a limit?"
        options = [{"label": f"Cut to {cut} a week", "status": "limit", "times_per_week": cut}]
        if cut == 3:
            options.append({"label": "Weekends only", "status": "limit", "times_per_week": 2})
        options += [
            {"label": "Stop it", "status": "limit", "times_per_week": 0},
            {"label": "It's fine", "status": "keep"},
            {"label": "It's a need", "status": "need"},
            {"label": "Not now", "status": "later"},
        ]
    return {"key": pick["key"], "label": label, "kind": pick["kind"], "text": text, "options": options}


# ── Decisions ─────────────────────────────────────────────────────────────────


def _describe(rule: HabitRule) -> str:
    if rule.status == "limit":
        if rule.times_per_week is not None:
            n = rule.times_per_week
            return f"{rule.label}: none from now on" if n == 0 else f"{rule.label}: at most {n} {'time' if n == 1 else 'times'} a week"
        return f"{rule.label}: {rupees(rule.paise_per_week or 0)} a week"
    return {
        "keep": f"{rule.label}: fine as it is",
        "need": f"{rule.label}: a need, not a habit",
        "later": f"{rule.label}: ask another time",
    }[rule.status]


def set_rule(
    s: Session,
    user_id: int,
    key: str,
    today: date,
    *,
    status: str,
    times_per_week: int | None = None,
    paise_per_week: int | None = None,
    label: str | None = None,
    goal_id: int | None = None,
) -> tuple[HabitRule, Update | None]:
    """Make or change the decision about a habit. A new limit remembers what a week cost before
    it, so what it saves can be counted. No update if nothing changed."""
    key = normalise_key(key)
    if not key:
        raise ApiError(422, "bad_habit", "Which habit?")
    if status not in HABIT_STATUSES:
        raise ApiError(422, "bad_status", f"A decision is one of {', '.join(HABIT_STATUSES)}")
    if status == "limit" and times_per_week is None and not paise_per_week:
        raise ApiError(422, "no_limit", "Say how many times a week, or a weekly budget")
    if goal_id is not None:
        g = s.get(Goal, goal_id)
        if g is None or g.user_id != user_id:
            raise ApiError(404, "not_found", "That goal isn't there any more.")
    rule = s.scalar(select(HabitRule).where(HabitRule.user_id == user_id, HabitRule.key == key))
    before = None if rule is None else (rule.status, rule.times_per_week, rule.paise_per_week, rule.label, rule.goal_id)
    start = today - timedelta(days=WINDOW_DAYS - 1)
    item = _load(s, user_id, start, today).get(key)
    if rule is None:
        group = GROUP_BY_KEY.get(key)
        fallback = group.label if group else ("Food delivery" if key == DELIVERY else key[:1].upper() + key[1:])
        rule = HabitRule(user_id=user_id, key=key, label=(item.label if item and item.label else fallback)[:60], status=status, decided_on=today)
        s.add(rule)
    if label and label.strip():
        rule.label = label.strip()[:60]
    if status == "limit" and (before is None or before[0] != "limit"):
        spent = sum(p for d, p, _ in item.entries if d >= start) if item else 0
        rule.baseline_paise_per_week = spent * 7 // WINDOW_DAYS
        rule.decided_on = today
    elif before is not None and before[0] != status:
        rule.decided_on = today
    elif status == "later":
        rule.decided_on = today  # "not now" again: ask again in four weeks from now
    rule.status = status
    rule.times_per_week = times_per_week if status == "limit" else None
    rule.paise_per_week = (paise_per_week or None) if status == "limit" else None
    if goal_id is not None:
        rule.goal_id = goal_id
    s.flush()
    if before == (rule.status, rule.times_per_week, rule.paise_per_week, rule.label, rule.goal_id):
        return rule, None
    return rule, Update("habit", _describe(rule))


def forget_rule(s: Session, user_id: int, key: str) -> None:
    s.execute(delete(HabitRule).where(HabitRule.user_id == user_id, HabitRule.key == normalise_key(key)))
    s.flush()


def find_key(s: Session, user_id: int, name: str, today: date) -> str | None:
    """A habit as an AI names it ("ice cream", "Ice cream", "Cigarettes") → its key."""
    wanted = normalise_key(name)
    if not wanted:
        return None
    rules = _rules(s, user_id)
    if wanted in rules or wanted in GROUP_BY_KEY or wanted == DELIVERY:
        return wanted
    for r in rules.values():
        if normalise_key(r.label) == wanted:
            return r.key
    for g in GROUPS:
        if normalise_key(g.label) == wanted:
            return g.key
    for item in habits(s, user_id, today)["items"]:
        if normalise_key(item["label"]) == wanted or item["key"] == wanted:
            return item["key"]
    found = classify(name, None)
    return found[0] if found else None


def alerts_after_save(s: Session, user_id: int, expense_ids: list[int], today: date) -> list[dict[str, str]]:
    """`alerts_for`, run after the save is committed. A failure here never fails the save: it was
    already saved, and an error would make the app think it wasn't (and save it again)."""
    import logging

    try:
        return alerts_for(s, user_id, expense_ids, today)
    except Exception:  # noqa: BLE001 - nothing here is worth losing a save over
        logging.getLogger(__name__).exception("habit alerts failed")
        s.rollback()
        return []


# ── For the month report ──────────────────────────────────────────────────────


def _floor(kind: str, covered: int) -> int:
    """Days needed to count as a habit over `covered` days: the four-week thresholds, scaled down
    for part of a month (but never below 3)."""
    base = MIN_DAYS_REPEAT if kind == "repeat" else MIN_DAYS
    return max(3, -(-base * min(covered, WINDOW_DAYS) // WINDOW_DAYS))


def for_month(s: Session, user_id: int, first: date, end: date) -> dict[str, Any]:
    """Small habits in one calendar month (up to `end`: today, for the current month), each
    against the month before. The same habits as the Small habits total: not ones I said are
    fine or a need, and food delivery only when I said it's a treat."""
    rules = _rules(s, user_id)
    prev_last = first - timedelta(days=1)
    prev_first = prev_last.replace(day=1)
    covered = (end - first).days + 1
    items = []
    for key, item in _load(s, user_id, prev_first, end).items():
        rule = rules.get(key)
        if rule is not None and rule.status in ("need", "keep"):
            continue
        treats = rule is not None and rule.status == "limit" and rule.times_per_week is not None
        if item.kind == "delivery" and not treats:
            continue
        now = sorted(p for d, p, _ in item.entries if first <= d <= end)
        if not now:
            continue
        days = len({d for d, _, _ in item.entries if first <= d <= end})
        typical = now[len(now) // 2]
        limited = rule is not None and rule.status == "limit"
        small = item.kind != "repeat" or typical <= REPEAT_MAX_PAISE
        if not limited and not (days >= _floor(item.kind, covered) and small):
            continue
        spent = sum(now)
        items.append(
            {
                "key": key,
                "label": rule.label if rule is not None else item.label,
                "kind": item.kind,
                "days": days,
                "times": len(now),
                "spent_paise": spent,
                "typical_paise": typical,
                "previous_paise": sum(p for d, p, _ in item.entries if prev_first <= d <= prev_last),
                "year_paise": _round10(spent * 365 // covered),
                "rule": rule_json(rule) if rule is not None else None,
            }
        )
    items.sort(key=lambda i: (i["spent_paise"], i["times"]), reverse=True)
    spent = sum(i["spent_paise"] for i in items)
    return {
        "items": items[:6],
        "more": max(len(items) - 6, 0),
        "spent_paise": spent,
        "previous_paise": sum(i["previous_paise"] for i in items),
        "previous_label": prev_first.strftime("%B"),
        "year_paise": _round10(spent * 365 // covered),
    }
