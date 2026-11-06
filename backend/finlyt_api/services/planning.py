"""Monthly budget, Sunday check-ins and the daily limit.

The model (agreed with the user):
- A budget for each calendar month.
- Planned items: bigger known expenses set aside first (rent, a trip). Spending in a planned
  item's category that month counts against it, up to its amount, not against the daily limit.
- A daily limit for everyday spending, set at each check-in and fixed until the next one.
  Optionally, bigger days: a higher limit for a few days a week (most of my days are ₹50-100,
  a few go to ₹300). A day that goes past the usual limit becomes one of the week's bigger days
  while the week has some left. Weeks start on my check-in day.
- The buffer: what's left under each day's limit on past days is kept aside for unplanned
  things (and overspending eats into it). It is never added to later days' limits.

All the numbers are worked out here; Gemini only talks and proposes a plan, which is checked.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Budget, Category, Expense, PlannedItem, SpendingPlan, User
from ..money import rupees, to_paise
from ..timeutil import IST, ist_day_bounds

PLAN_SYSTEM_PROMPT = """\
You are Finlyt, a friendly money coach inside my expense tracker. Once a week, on my check-in \
day, we check in about the coming week the way I used to with a friend: I tell you what's \
coming up and you help me plan, so I get limits for everyday spending that fit how I really spend.

How the plan works:
- A budget for the whole month.
- Planned items: bigger, known expenses set aside first, like rent, bills, EMIs, trips, gifts, a \
family dinner or a big purchase. Each has an amount, a category, and a date if I know it.
- A usual-day limit for everything else (food, autos, chai), and optionally bigger days: a \
higher limit for a few days a week. A day that goes past the usual limit uses up one of that \
week's bigger days. Both stay the same until the next check-in. Whatever I don't spend under a \
day's limit is kept aside as a buffer for unplanned things; encourage keeping it for surprises.

Fit the limits to me, not to the budget:
- The limits describe how I really spend, from what I tell you and how my days have gone (the \
numbers below). If I give ranges, use them: "most days 50-100, sometimes 210-350" means a \
usual-day limit of about ₹100 (the top of my usual range) and a bigger-day limit of about ₹350 \
(the top of my bigger range). "Sometimes" or "a few days" is 1 or 2 bigger days a week, \
"rarely" is 1, "often" is 3.
- Never raise my limits just to use up the budget. Whatever the plan leaves unspent is savings: \
say how much it leaves spare for the month.
- Check it fits: usual x 7 + (bigger - usual) x bigger days, per week, for the weeks left must \
fit in what the budget leaves for everyday spending. If it doesn't, say so and suggest what to \
trim. If my days are steady, one limit with no bigger days is fine.
- Something coming up without an amount (a family dinner, a trip): ask roughly how much, with \
options, and add it as a planned item. If I'm not sure it will happen, still set it aside, so \
it's covered if it does.
- Round limits to ₹10. Say the plan in one or two lines with why.

How to talk:
- Short and warm: one to three sentences, like a friend who is good with money. Rupees, Indian \
style (₹1,200, ₹1.5 lakh). No emojis.
- I type the way I talk: casual English, Hinglish, shorthand. Read it like a friend would.
- One question at a time. If this month has no budget yet, ask for it first. Every check-in, ask \
what's coming up this week: outings, trips, family plans, bills or anything unusual.
- When you ask me something, put 2 to 4 short answers I might give in options (under 40 \
characters each, in my style, the most likely first), like "Nothing special this week" or "A \
trip on the weekend". I can always type my own, so never add an "Other" option. Leave options \
empty when you're not asking anything.
- Never make up amounts in options. When you ask for an amount, offer only amounts that come \
from the numbers below or from what I said (like last month's spending, or a sensible estimate \
for something I named); otherwise leave options empty and let me type it.
- After proposing the plan, offer options to confirm or tweak it, like "Looks good" or "Fewer \
bigger days".
- If there are no messages yet, open the check-in: one line on how the last week went, from the \
numbers below, then your first question.
- Use only the numbers given and what I tell you. Don't invent spending.
- Once you know the budget and what's coming up, set ready to true, fill in the plan, and say \
what you suggest. The app shows the plan and I can change the numbers myself. If I ask for \
changes, adjust it and keep ready true.
- planned_items must list every planned item for this month, including ones already planned, \
unless I say to drop one. My commitments (from memory, below) are set aside every month by the \
app, so you don't need to add them, but count them when checking the fit.

Remembering:
- When my latest message tells you something lasting about my money, fill it in: my monthly \
take-home income in remember_income, money I've promised every month in remember_commitments \
(with the total if it pays something off, what's already paid, and income rules like "₹6,000 \
once my salary is ₹55,000"), anything else in remember_notes. Only from my latest message; \
otherwise leave them empty. Say in a few words what you'll remember.
- If you know my income and the month has no budget yet, suggest one: income minus commitments \
minus saving (aim to save at least 20% of what's left), and say the split.
- When my income goes up, my commitments follow their rules. Suggest that at least half of what's \
left of the raise goes to saving, so saving grows with my salary.
"""



def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def floor10(paise: int) -> int:
    """Round down to whole tens of rupees."""
    return max(paise, 0) // 1000 * 1000


WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def week_start(day: date, weekday: int) -> date:
    """The start of the week `day` is in, for weeks that begin on `weekday` (Monday 0)."""
    return day - timedelta(days=(day.weekday() - weekday) % 7)


def has_big_days(plan: SpendingPlan) -> bool:
    return bool(
        plan.big_days_per_week
        and plan.big_day_limit_paise
        and plan.big_day_limit_paise > plan.daily_limit_paise
    )


def weekly_paise(daily: int, big: int | None, big_days: int) -> int:
    """What a week of the plan allows, if every bigger day is used."""
    extra = (big - daily) * big_days if big and big > daily and big_days else 0
    return daily * 7 + extra


def projected_paise(daily: int, big: int | None, big_days: int, days: int) -> int:
    """What the plan allows over `days` days (bigger days spread evenly over the weeks)."""
    extra = (big - daily) * big_days if big and big > daily and big_days else 0
    return daily * days + extra * days // 7


@dataclass
class DayLimit:
    limit: int
    big: bool


@dataclass
class MonthNumbers:
    today: date
    budget: Budget | None
    plans: list[SpendingPlan]  # every plan that could apply this month, oldest first
    items: list[PlannedItem]
    weekday: int = 6  # the check-in day; weeks start on it
    spent: int = 0
    flexible_by_day: dict[date, int] = field(default_factory=dict)
    # Everyday spend on the days of the first week that fall in last month (for bigger days).
    before_month_by_day: dict[date, int] = field(default_factory=dict)
    absorbed_by_category: dict[int, int] = field(default_factory=dict)

    def plan_on(self, day: date) -> SpendingPlan | None:
        current = None
        for plan in self.plans:
            if plan.starts_on <= day:
                current = plan
        return current

    @property
    def days_left(self) -> int:
        return (month_end(self.today) - self.today).days + 1

    @property
    def planned_total(self) -> int:
        return sum(i.amount_paise for i in self.items)

    def planned_by_category(self) -> dict[int, int]:
        totals: dict[int, int] = defaultdict(int)
        for item in self.items:
            if item.category_id is not None:
                totals[item.category_id] += item.amount_paise
        return totals

    @property
    def planned_left(self) -> int:
        left = 0
        absorbed = dict(self.absorbed_by_category)
        for item in self.items:
            if item.category_id is None:
                left += item.amount_paise
                continue
            used = min(absorbed.get(item.category_id, 0), item.amount_paise)
            absorbed[item.category_id] = absorbed.get(item.category_id, 0) - used
            left += item.amount_paise - used
        return left

    def everyday_on(self, day: date) -> int:
        return self.flexible_by_day.get(day, 0) if day >= month_start(self.today) else self.before_month_by_day.get(day, 0)

    def day_limits(self) -> tuple[dict[date, DayLimit], dict[date, int]]:
        """Each day's limit, from the start of the month's first week to today, and how many
        bigger days each week has used. Days are taken in order: one that goes past the usual
        limit is a bigger day while its week has some left."""
        limits: dict[date, DayLimit] = {}
        used: dict[date, int] = defaultdict(int)
        day = week_start(month_start(self.today), self.weekday)
        while day <= self.today:
            plan = self.plan_on(day)
            if plan is not None:
                week = week_start(day, self.weekday)
                big = (
                    has_big_days(plan)
                    and self.everyday_on(day) > plan.daily_limit_paise
                    and used[week] < plan.big_days_per_week
                )
                if big:
                    used[week] += 1
                limits[day] = DayLimit(plan.big_day_limit_paise if big else plan.daily_limit_paise, big)
            day += timedelta(days=1)
        return limits, used

    @property
    def buffer(self) -> int:
        """Under-limit savings on past days of this month (overspending draws it down)."""
        limits, _ = self.day_limits()
        first = month_start(self.today)
        return sum(
            limit.limit - self.flexible_by_day.get(day, 0)
            for day, limit in limits.items()
            if first <= day < self.today
        )

    def available(self, budget_paise: int | None = None, planned_left: int | None = None) -> int | None:
        """What the budget leaves for everyday spending from today to the month's end."""
        budget_paise = budget_paise if budget_paise is not None else (self.budget.amount_paise if self.budget else None)
        if budget_paise is None:
            return None
        left = planned_left if planned_left is not None else self.planned_left
        return budget_paise - self.spent - left

    def suggested_daily_limit(self, budget_paise: int | None = None, planned_left: int | None = None) -> int | None:
        available = self.available(budget_paise, planned_left)
        return None if available is None else floor10(available // self.days_left)


def load_month(s: Session, user_id: int, today: date) -> MonthNumbers:
    first, last = month_start(today), month_end(today)
    budget = s.scalar(select(Budget).where(Budget.user_id == user_id, Budget.month == first))
    plans = list(
        s.scalars(
            select(SpendingPlan)
            .where(SpendingPlan.user_id == user_id, SpendingPlan.starts_on <= last)
            .order_by(SpendingPlan.starts_on)
        )
    )
    items = list(
        s.scalars(
            select(PlannedItem)
            .where(PlannedItem.user_id == user_id, PlannedItem.month == first)
            .order_by(PlannedItem.due_on.nulls_last(), PlannedItem.id)
        )
    )
    weekday = s.scalar(select(User.check_in_weekday).where(User.id == user_id))
    numbers = MonthNumbers(today=today, budget=budget, plans=plans, items=items, weekday=6 if weekday is None else weekday)

    first_week = week_start(first, numbers.weekday)
    if first_week < first:
        before_start, before_end = ist_day_bounds(first_week, first - timedelta(days=1))
        for occurred_at, share in s.execute(
            select(Expense.occurred_at, Expense.my_share_paise).where(
                Expense.user_id == user_id, Expense.occurred_at >= before_start, Expense.occurred_at < before_end
            )
        ).all():
            day = occurred_at.astimezone(IST).date()
            numbers.before_month_by_day[day] = numbers.before_month_by_day.get(day, 0) + share

    start, end = ist_day_bounds(first, today)
    expenses = s.execute(
        select(Expense.occurred_at, Expense.category_id, Expense.my_share_paise)
        .where(Expense.user_id == user_id, Expense.occurred_at >= start, Expense.occurred_at < end)
        .order_by(Expense.occurred_at, Expense.id)
    ).all()
    room = numbers.planned_by_category()  # what each planned category can still absorb
    for occurred_at, category_id, share in expenses:
        numbers.spent += share
        absorbed = 0
        if category_id is not None and room.get(category_id, 0) > 0:
            absorbed = min(room[category_id], share)
            room[category_id] -= absorbed
            numbers.absorbed_by_category[category_id] = numbers.absorbed_by_category.get(category_id, 0) + absorbed
        day = occurred_at.astimezone(IST).date()
        numbers.flexible_by_day[day] = numbers.flexible_by_day.get(day, 0) + share - absorbed
    return numbers


def plan_json(plan: SpendingPlan) -> dict[str, Any]:
    big = has_big_days(plan)
    return {
        "starts_on": plan.starts_on.isoformat(),
        "daily_limit_paise": plan.daily_limit_paise,
        "big_day_limit_paise": plan.big_day_limit_paise if big else None,
        "big_days_per_week": plan.big_days_per_week if big else 0,
        "weekly_paise": weekly_paise(plan.daily_limit_paise, plan.big_day_limit_paise, plan.big_days_per_week if big else 0),
        "notes": plan.notes,
    }


def status(s: Session, user_id: int, today: date) -> dict[str, Any]:
    n = load_month(s, user_id, today)
    plan = n.plan_on(today)
    today_spent = n.flexible_by_day.get(today, 0)
    limits, used = n.day_limits()
    today_limit = limits.get(today)
    big_days_left = (
        max(plan.big_days_per_week - used[week_start(today, n.weekday)], 0) if plan is not None and has_big_days(plan) else None
    )
    absorbed = dict(n.absorbed_by_category)
    items = []
    for item in n.items:
        used = 0
        if item.category_id is not None:
            used = min(absorbed.get(item.category_id, 0), item.amount_paise)
            absorbed[item.category_id] = absorbed.get(item.category_id, 0) - used
        items.append(
            {
                "id": item.id,
                "description": item.description,
                "amount_paise": item.amount_paise,
                "spent_paise": used,
                "due_on": item.due_on.isoformat() if item.due_on else None,
                "category_id": item.category_id,
            }
        )
    check_in_day = today.weekday() == n.weekday
    return {
        "today": today.isoformat(),
        "month": month_start(today).isoformat(),
        "days_left": n.days_left,
        "budget_paise": n.budget.amount_paise if n.budget else None,
        "spent_month_paise": n.spent,
        "planned_total_paise": n.planned_total,
        "planned_left_paise": n.planned_left,
        "planned_items": items,
        "plan": plan_json(plan) if plan else None,
        "today_spent_paise": today_spent,
        # Today's limit: the usual one, or the bigger one once today has gone past it and the
        # week still has a bigger day left.
        "today_limit_paise": today_limit.limit if today_limit else None,
        "today_is_big_day": bool(today_limit and today_limit.big),
        "big_days_left": big_days_left,
        "today_left_paise": today_limit.limit - today_spent if today_limit else None,
        "buffer_paise": n.buffer,
        "available_paise": n.available(),
        "suggested_daily_limit_paise": n.suggested_daily_limit(),
        "check_in_weekday": n.weekday,
        # Time to talk: no plan yet, a new month without a budget, or a check-in day not yet planned.
        "check_in_due": plan is None
        or n.budget is None
        or (check_in_day and plan.starts_on < today)
        or (today - plan.starts_on).days >= 7,
    }


def _recent_everyday_spend(s: Session, user_id: int, today: date) -> tuple[int, list[tuple[str, int]], list[int]]:
    """Average spend per day over the last 28 days, the top categories, and each logged day's
    total (days with nothing logged are left out: the app may be new)."""
    start, end = ist_day_bounds(today - timedelta(days=28), today - timedelta(days=1))
    rows = s.execute(
        select(Expense.occurred_at, Expense.category_id, Expense.my_share_paise).where(
            Expense.user_id == user_id, Expense.occurred_at >= start, Expense.occurred_at < end
        )
    ).all()
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    by_category: dict[str, int] = defaultdict(int)
    by_day: dict[date, int] = defaultdict(int)
    for occurred_at, category_id, share in rows:
        by_category[names.get(category_id, "Other")] += share
        by_day[occurred_at.astimezone(IST).date()] += share
    total = sum(by_category.values())
    top = sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return total // 28, top, sorted(by_day.values())


def _pattern(days: list[int]) -> str | None:
    """How my logged days spread out, so Finlyt can set usual and bigger-day limits."""
    if len(days) < 3:
        return None
    def at(fraction: float) -> int:
        return days[min(int(len(days) * fraction), len(days) - 1)]
    return (
        f"My logged days over the last 4 weeks ({len(days)} days): a typical day {rupees(at(0.5))}, "
        f"most days (8 in 10) under {rupees(at(0.8))}, the biggest {rupees(days[-1])}."
    )


def build_context(s: Session, user_id: int, today: date) -> str:
    n = load_month(s, user_id, today)
    plan = n.plan_on(today)
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    lines = [
        f"Today: {today.strftime('%A %d %B %Y')}. Days left in {today.strftime('%B')}, including today: {n.days_left}.",
        f"My check-in day: {WEEKDAYS[n.weekday]}. Weeks run from one check-in to the next.",
        f"Budget for {today.strftime('%B')}: {rupees(n.budget.amount_paise) if n.budget else 'not set yet'}.",
        f"Spent so far this month (my share): {rupees(n.spent)}.",
    ]
    if n.items:
        lines.append("Planned items this month:")
        absorbed = dict(n.absorbed_by_category)
        for item in n.items:
            used = 0
            if item.category_id is not None:
                used = min(absorbed.get(item.category_id, 0), item.amount_paise)
                absorbed[item.category_id] = absorbed.get(item.category_id, 0) - used
            when = f" on {item.due_on.strftime('%d %b')}" if item.due_on else ""
            category = names.get(item.category_id, "Other") if item.category_id else "Other"
            lines.append(f"- {item.description}: {rupees(item.amount_paise)}{when} ({category}), {rupees(used)} spent")
    else:
        lines.append("No planned items yet this month.")
    if plan:
        since = plan.starts_on.strftime("%d %b")
        if has_big_days(plan):
            lines.append(
                f"Current plan (since {since}): usual days {rupees(plan.daily_limit_paise)}, "
                f"{plan.big_days_per_week} bigger days a week up to {rupees(plan.big_day_limit_paise)}."
            )
        else:
            lines.append(f"Current daily limit: {rupees(plan.daily_limit_paise)} (since {since}), no bigger days.")
        week = [today - timedelta(days=i) for i in range(7, 0, -1)]
        spent_week = sum(n.flexible_by_day.get(d, 0) for d in week if d.month == today.month)
        lines.append(f"Everyday spending in the last 7 days (this month): {rupees(spent_week)}.")
    else:
        lines.append("No daily limit set yet.")
    lines.append(f"Buffer kept aside for unplanned things: {rupees(n.buffer)}.")
    average, top, days = _recent_everyday_spend(s, user_id, today)
    if top:
        lines.append(f"Average spend per day over the last 4 weeks: {rupees(average)}.")
        lines.append("Top categories over the last 4 weeks: " + ", ".join(f"{k} {rupees(v)}" for k, v in top) + ".")
    pattern = _pattern(days)
    if pattern:
        lines.append(pattern)
    available = n.available()
    if available is not None:
        lines.append(
            f"Left for everyday spending this month after planned items: {rupees(max(available, 0))} "
            f"over {n.days_left} days, about {rupees(max(available, 0) * 7 // n.days_left)} a week."
        )
    suggested = n.suggested_daily_limit()
    if suggested is not None:
        lines.append(f"One flat daily limit from the formula would be {rupees(suggested)}.")
    lines.append("Categories: " + ", ".join(names.values()) + ".")
    return "\n".join(lines)


def resolve_plan(s: Session, user_id: int, today: date, g) -> dict[str, Any]:
    """Gemini's proposed plan → amounts in paise, ids, and defaults worked out here."""
    n = load_month(s, user_id, today)
    categories = {
        name.lower(): cid
        for cid, name in s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all()
    }
    issues: list[str] = []
    items = []
    first, last = month_start(today), month_end(today)
    for item in g.planned_items:
        amount = to_paise(item.amount)
        if amount <= 0 or not item.description.strip():
            continue
        due = None
        if item.date:
            try:
                due = date.fromisoformat(item.date.strip())
            except ValueError:
                due = None
            if due is not None and not (first <= due <= last):
                issues.append(f"{item.description} is dated outside this month, so the date was dropped")
                due = None
        items.append(
            {
                "description": item.description.strip()[:200],
                "amount_paise": amount,
                "due_on": due.isoformat() if due else None,
                "category_id": categories.get(item.category.strip().lower()) or categories.get("other"),
            }
        )
    _add_commitments(s, user_id, items, categories)
    budget = to_paise(g.monthly_budget) if g.monthly_budget else (n.budget.amount_paise if n.budget else None)
    if not budget or budget <= 0:
        raise ApiError(422, "no_budget", "There's no monthly budget yet")
    # Planned left with the proposed items, against what's been spent in their categories.
    room: dict[int, int] = defaultdict(int)
    for item in items:
        if item.get("category_id") is not None:
            room[item["category_id"]] += item["amount_paise"]
    planned_left = sum(i["amount_paise"] for i in items if i["category_id"] is None) + sum(
        max(total - n.absorbed_by_category.get(cid, 0), 0) for cid, total in room.items()
    )
    suggested = n.suggested_daily_limit(budget, planned_left) or 0
    daily = floor10(to_paise(g.daily_limit)) if g.daily_limit else suggested
    if daily <= 0:
        issues.append("The budget is already used up for this month at this rate")
        daily = max(suggested, 1000)
    big = floor10(to_paise(g.big_day_limit)) if g.big_day_limit else None
    big_days = min(max(int(g.big_days_per_week or 0), 0), 6)
    if not big or big <= daily or big_days == 0:
        big, big_days = None, 0
    available = n.available(budget, planned_left) or 0
    return {
        "monthly_budget_paise": budget,
        "daily_limit_paise": daily,
        "big_day_limit_paise": big,
        "big_days_per_week": big_days,
        "suggested_daily_limit_paise": suggested,
        # For the plan card, which checks the fit as you change the numbers.
        "available_paise": available,
        "days_left": n.days_left,
        "projected_paise": projected_paise(daily, big, big_days, n.days_left),
        "planned_items": items,
        "notes": (g.summary or "").strip()[:500] or None,
        "issues": issues,
    }


def _add_commitments(s: Session, user_id: int, items: list[dict[str, Any]], categories: dict[str, int]) -> None:
    """Every active commitment is set aside each month, at its current amount (or what's left
    of it, if that's less), whether or not the AI listed it."""
    from . import memory

    for c in memory.active_commitments(s, user_id):
        paid = memory.paid_so_far(s, user_id, c)
        left = c.total_paise - paid if c.total_paise else None
        if left is not None and left <= 0:
            continue
        amount = min(c.monthly_paise, left) if left is not None else c.monthly_paise
        title = c.title.lower()
        existing = next(
            (i for i in items if title in i["description"].lower() or i["description"].lower() in title), None
        )
        if existing is not None:
            existing["amount_paise"] = amount
            existing["description"] = c.title
            existing["category_id"] = c.category_id or existing["category_id"]
        else:
            items.append(
                {
                    "description": c.title[:200],
                    "amount_paise": amount,
                    "due_on": None,
                    "category_id": c.category_id or categories.get("other"),
                }
            )


def commit_plan(s: Session, user_id: int, today: date, data) -> None:
    first = month_start(today)
    budget = s.scalar(select(Budget).where(Budget.user_id == user_id, Budget.month == first))
    if budget is None:
        budget = Budget(user_id=user_id, month=first, amount_paise=data.monthly_budget_paise)
        s.add(budget)
    else:
        budget.amount_paise = data.monthly_budget_paise

    plan = s.scalar(select(SpendingPlan).where(SpendingPlan.user_id == user_id, SpendingPlan.starts_on == today))
    if plan is None:
        plan = SpendingPlan(user_id=user_id, starts_on=today, daily_limit_paise=data.daily_limit_paise)
        s.add(plan)
    plan.daily_limit_paise = data.daily_limit_paise
    plan.big_day_limit_paise = data.big_day_limit_paise if data.big_days_per_week else None
    plan.big_days_per_week = data.big_days_per_week if data.big_day_limit_paise else 0
    plan.notes = data.notes

    owned = set(s.scalars(select(Category.id).where(Category.user_id == user_id)))
    s.execute(delete(PlannedItem).where(PlannedItem.user_id == user_id, PlannedItem.month == first))
    for item in data.planned_items:
        if item.category_id is not None and item.category_id not in owned:
            raise ApiError(422, "unknown_category", f"Category {item.category_id} doesn't exist")
        if item.due_on is not None and month_start(item.due_on) != first:
            raise ApiError(422, "bad_date", f"{item.description} isn't dated this month")
        s.add(
            PlannedItem(
                user_id=user_id,
                month=first,
                due_on=item.due_on,
                description=item.description,
                amount_paise=item.amount_paise,
                category_id=item.category_id,
            )
        )
    s.flush()


def set_check_in_weekday(s: Session, user_id: int, weekday: int) -> None:
    user = s.get(User, user_id)
    if user is not None:
        user.check_in_weekday = weekday


def today_in_ist(now: datetime) -> date:
    return now.astimezone(IST).date()
