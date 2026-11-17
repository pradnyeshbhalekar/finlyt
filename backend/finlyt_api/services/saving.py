"""How much to save a month, and whether my spending leaves room for it.

The target is suggested from what Finlyt remembers: 20% of my income after commitments (rounded
down to ₹100). I can set my own instead (`MoneyProfile.saving_target_paise`); clearing it goes
back to the suggestion. The plan sets it against what I usually spend (this month's budget if
there is one, else the average of my last three months), my goals' monthly needs, what small
habits cost, and this month so far.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Budget, Expense, MoneyProfile
from ..timeutil import ist_day_bounds
from . import goals, habits, memory, planning, reports

SHARE = 5  # one fifth: save 20% of what's left after commitments


def suggested(after_commitments: int | None) -> int | None:
    if after_commitments is None:
        return None
    return max(after_commitments, 0) // SHARE // 100_00 * 100_00


def target(s: Session, user_id: int, after_commitments: int | None) -> tuple[int | None, bool]:
    """(the monthly target, whether I set it myself)."""
    p = memory.get_profile(s, user_id)
    if p is not None and p.saving_target_paise is not None:
        return p.saving_target_paise, True
    return suggested(after_commitments), False


def set_target(s: Session, user_id: int, paise: int | None) -> None:
    if paise is not None and paise <= 0:
        raise ApiError(422, "bad_target", "A saving target has to be more than zero")
    p = memory.get_profile(s, user_id)
    if p is None:
        if paise is None:
            return
        p = MoneyProfile(user_id=user_id)
        s.add(p)
    p.saving_target_paise = paise
    s.flush()


def _commitments_logged(s: Session, user_id: int, first: date, months: int) -> int:
    """What commitments took a month in the months behind "usual", where I logged paying them
    (so they aren't counted twice: once in usual spending, once as commitments)."""
    words = sorted({w for c in memory.active_commitments(s, user_id) for w in (c.match_words or []) if w.strip()})
    if not words or not months:
        return 0
    start = first
    for _ in range(months):
        start = reports.previous_month(start)
    lo, hi = ist_day_bounds(start, first - timedelta(days=1))
    total = s.scalar(
        select(func.coalesce(func.sum(Expense.my_share_paise), 0)).where(
            Expense.user_id == user_id,
            Expense.occurred_at >= lo,
            Expense.occurred_at < hi,
            or_(*[Expense.description.ilike(f"%{w}%") for w in words]),
        )
    )
    return int(total or 0) // months


def saving_plan(s: Session, user_id: int, today: date) -> dict[str, Any]:
    profile = memory.profile_json(s, user_id)
    income = profile["monthly_income_paise"]
    committed = profile["committed_paise"]
    after = profile["after_commitments_paise"]
    goal, is_set = target(s, user_id, after)

    first = planning.month_start(today)
    budget = s.scalar(select(Budget.amount_paise).where(Budget.user_id == user_id, Budget.month == first))
    _, usual_total, months = reports._usual(s, user_id, first)
    if budget:
        # Commitments are set aside inside the budget as planned items.
        spending, basis = int(budget), "budget"
    elif months:
        spending, basis = max(usual_total - _commitments_logged(s, user_id, first, months), 0) + committed, "usual"
    else:
        spending, basis = None, None
    room = income - spending if income is not None and spending is not None else None
    fits = room >= goal if room is not None and goal is not None else None

    active = [g for g in goals.list_goals(s, user_id) if not g["archived"] and not g["done"]]
    goals_monthly = sum(g["monthly_needed_paise"] or 0 for g in active)

    found = habits.habits(s, user_id, today)
    watched = [i for i in found["items"] if habits._counts(i)]
    top = watched[0] if watched else None

    last = planning.month_end(today)
    lo, hi = ist_day_bounds(first, today)
    spent = int(
        s.scalar(
            select(func.coalesce(func.sum(Expense.my_share_paise), 0)).where(
                Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi
            )
        )
        or 0
    )
    days_left = (last - today).days + 1
    left_to_spend = income - goal - spent if income is not None and goal is not None else None
    return {
        "monthly_income_paise": income,
        "committed_paise": committed,
        "after_commitments_paise": after,
        "suggested_paise": suggested(after),
        "target_paise": goal,
        "target_is_set": is_set,
        "spending_paise": spending,
        "spending_basis": basis,
        "usual_months": months,
        "room_paise": room,
        "fits": fits,
        "short_paise": max(goal - room, 0) if room is not None and goal is not None else None,
        "goals": [
            {
                "id": g["id"],
                "name": g["name"],
                "left_paise": g["left_paise"],
                "due_on": g["due_on"],
                "monthly_needed_paise": g["monthly_needed_paise"],
            }
            for g in active
        ],
        "goals_monthly_paise": goals_monthly,
        "goals_need_more": goal is not None and goals_monthly > goal,
        "habits_month_paise": found["total_month_paise"],
        "habits_half_paise": habits._round10(found["total_month_paise"] // 2),
        "habits_saved_paise": sum(i["saved_paise"] or 0 for i in found["items"]),
        "top_habit": {"key": top["key"], "label": top["label"], "year_paise": top["year_paise"]} if top else None,
        "month": {
            "spent_paise": spent,
            "left_to_spend_paise": left_to_spend,
            "days_left": days_left,
            "per_day_paise": max(left_to_spend, 0) // days_left // 1000 * 1000 if left_to_spend is not None else None,
        },
        "needs_income": income is None,
    }
