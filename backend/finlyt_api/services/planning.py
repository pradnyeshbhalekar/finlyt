"""Monthly budget, Sunday check-ins and the daily limit.

The model (agreed with the user):
- A budget for each calendar month.
- Planned items: bigger known expenses set aside first (rent, a trip). Spending in a planned
  item's category that month counts against it, up to its amount, not against the daily limit.
- A daily limit for everyday spending, set at each check-in and fixed until the next one.
- The buffer: what's left under the limit on past days is kept aside for unplanned things (and
  overspending eats into it). It is never added to later days' limits.

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
from ..models import Budget, Category, Expense, PlannedItem, SpendingPlan
from ..money import rupees, to_paise
from ..timeutil import IST, ist_day_bounds

PLAN_SYSTEM_PROMPT = """\
You are Finlyt, a friendly money coach inside my expense tracker. Every Sunday we check in about \
the coming week, the way I used to with a friend: I tell you what's coming up and you help me \
plan, so I get a daily limit for everyday spending.

How the plan works:
- A budget for the whole month.
- Planned items: bigger, known expenses set aside first, like rent, bills, EMIs, trips, gifts or \
a big purchase. Each has an amount, a category, and a date if I know it.
- A daily limit for everything else (food, autos, chai). It stays the same until the next \
check-in. Whatever I don't spend under the limit is kept aside as a buffer for unplanned things. \
Encourage keeping the buffer for surprises rather than spending it.

How to talk:
- Short and warm: one to three sentences, like a friend who is good with money. Rupees, Indian \
style (₹1,200, ₹1.5 lakh). No emojis.
- I type the way I talk: casual English, Hinglish, shorthand. Read it like a friend would.
- One question at a time. If this month has no budget yet, ask for it first. Then ask what's \
coming up this week (big or unusual spends).
- If there are no messages yet, open the check-in: one line on how the last week went, from the \
numbers below, then your first question.
- Use only the numbers given and what I tell you. Don't invent spending.
- Once you know the budget and the planned items, set ready to true, fill in the plan, and say \
what you suggest in the reply. The app shows the plan for me to confirm. If I ask for changes, \
adjust it and keep ready true.
- Suggested daily limit: (budget - spent so far - planned items not yet paid - a small cushion) \
divided by the days left, rounded down to the nearest ₹10. Say it in one line with why.
- planned_items must list every planned item for this month, including ones already planned, \
unless I say to drop one.
"""


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(day: date) -> date:
    return day.replace(day=calendar.monthrange(day.year, day.month)[1])


def floor10(paise: int) -> int:
    """Round down to whole tens of rupees."""
    return max(paise, 0) // 1000 * 1000


@dataclass
class MonthNumbers:
    today: date
    budget: Budget | None
    plans: list[SpendingPlan]  # every plan that could apply this month, oldest first
    items: list[PlannedItem]
    spent: int = 0
    flexible_by_day: dict[date, int] = field(default_factory=dict)
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

    @property
    def buffer(self) -> int:
        """Under-limit savings on past days of this month (overspending draws it down)."""
        total = 0
        day = month_start(self.today)
        while day < self.today:
            plan = self.plan_on(day)
            if plan is not None:
                total += plan.daily_limit_paise - self.flexible_by_day.get(day, 0)
            day += timedelta(days=1)
        return total

    def suggested_daily_limit(self, budget_paise: int | None = None, planned_left: int | None = None) -> int | None:
        budget_paise = budget_paise if budget_paise is not None else (self.budget.amount_paise if self.budget else None)
        if budget_paise is None:
            return None
        left = planned_left if planned_left is not None else self.planned_left
        return floor10((budget_paise - self.spent - left) // self.days_left)


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
    numbers = MonthNumbers(today=today, budget=budget, plans=plans, items=items)

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


def status(s: Session, user_id: int, today: date) -> dict[str, Any]:
    n = load_month(s, user_id, today)
    plan = n.plan_on(today)
    today_spent = n.flexible_by_day.get(today, 0)
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
    is_sunday = today.weekday() == 6
    return {
        "today": today.isoformat(),
        "month": month_start(today).isoformat(),
        "days_left": n.days_left,
        "budget_paise": n.budget.amount_paise if n.budget else None,
        "spent_month_paise": n.spent,
        "planned_total_paise": n.planned_total,
        "planned_left_paise": n.planned_left,
        "planned_items": items,
        "plan": (
            {
                "starts_on": plan.starts_on.isoformat(),
                "daily_limit_paise": plan.daily_limit_paise,
                "notes": plan.notes,
            }
            if plan
            else None
        ),
        "today_spent_paise": today_spent,
        "today_left_paise": plan.daily_limit_paise - today_spent if plan else None,
        "buffer_paise": n.buffer,
        "suggested_daily_limit_paise": n.suggested_daily_limit(),
        # Time to talk: no plan yet, a new month without a budget, or a Sunday not yet planned.
        "check_in_due": plan is None
        or n.budget is None
        or (is_sunday and plan.starts_on < today)
        or (today - plan.starts_on).days >= 7,
    }


def _recent_everyday_spend(s: Session, user_id: int, today: date) -> tuple[int, list[tuple[str, int]]]:
    """Average everyday spend per day over the last 28 days, and the top categories."""
    start, end = ist_day_bounds(today - timedelta(days=28), today - timedelta(days=1))
    rows = s.execute(
        select(Expense.category_id, Expense.my_share_paise).where(
            Expense.user_id == user_id, Expense.occurred_at >= start, Expense.occurred_at < end
        )
    ).all()
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    by_category: dict[str, int] = defaultdict(int)
    for category_id, share in rows:
        by_category[names.get(category_id, "Other")] += share
    total = sum(by_category.values())
    top = sorted(by_category.items(), key=lambda kv: kv[1], reverse=True)[:5]
    return total // 28, top


def build_context(s: Session, user_id: int, today: date) -> str:
    n = load_month(s, user_id, today)
    plan = n.plan_on(today)
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    lines = [
        f"Today: {today.strftime('%A %d %B %Y')}. Days left in {today.strftime('%B')}, including today: {n.days_left}.",
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
        lines.append(f"Current daily limit: {rupees(plan.daily_limit_paise)} (since {plan.starts_on.strftime('%d %b')}).")
        week = [today - timedelta(days=i) for i in range(7, 0, -1)]
        spent_week = sum(n.flexible_by_day.get(d, 0) for d in week if d.month == today.month)
        lines.append(f"Everyday spending in the last 7 days (this month): {rupees(spent_week)}.")
    else:
        lines.append("No daily limit set yet.")
    lines.append(f"Buffer kept aside for unplanned things: {rupees(n.buffer)}.")
    average, top = _recent_everyday_spend(s, user_id, today)
    if top:
        lines.append(f"Average spend per day over the last 4 weeks: {rupees(average)}.")
        lines.append("Top categories over the last 4 weeks: " + ", ".join(f"{k} {rupees(v)}" for k, v in top) + ".")
    suggested = n.suggested_daily_limit()
    if suggested is not None:
        lines.append(f"Daily limit from the formula right now: {rupees(suggested)}.")
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
    return {
        "monthly_budget_paise": budget,
        "daily_limit_paise": daily,
        "suggested_daily_limit_paise": suggested,
        "planned_items": items,
        "notes": (g.summary or "").strip()[:500] or None,
        "issues": issues,
    }


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
        plan = SpendingPlan(user_id=user_id, starts_on=today, daily_limit_paise=data.daily_limit_paise, notes=data.notes)
        s.add(plan)
    else:
        plan.daily_limit_paise = data.daily_limit_paise
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


def today_in_ist(now: datetime) -> date:
    return now.astimezone(IST).date()
