"""Savings goals: something to save up for (a trip, a phone, an emergency fund), with a target
and maybe a date. Money is put towards a goal (or taken back out) as deposits, and each goal says
how much is saved, what's left, and how much a month it takes to get there by its date."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Goal, GoalDeposit
from ..money import rupees
from ..timeutil import ist_day_bounds, to_ist_iso, today_ist


def months_until(today: date, due: date) -> int:
    """Whole months left, counting this one: due later this month is 1."""
    return max((due.year - today.year) * 12 + due.month - today.month + 1, 1)


def get_goal(s: Session, user_id: int, goal_id: int) -> Goal:
    g = s.get(Goal, goal_id)
    if g is None or g.user_id != user_id:
        raise ApiError(404, "not_found", "That goal isn't there any more.")
    return g


def goal_json(s: Session, g: Goal, *, deposits: bool = False) -> dict[str, Any]:
    today = today_ist()
    saved = max(sum(d.amount_paise for d in g.deposits), 0)
    left = max(g.target_paise - saved, 0)
    months = months_until(today, g.due_on) if g.due_on and g.due_on >= today else None
    monthly = None
    if months and left:
        monthly = -(-left // months)  # what's left, spread over the months to go
        monthly = -(-monthly // 1000) * 1000  # rounded up to ₹10
    lo, hi = ist_day_bounds(today.replace(day=1), today)
    this_month = sum(d.amount_paise for d in g.deposits if lo <= d.created_at < hi)
    out = {
        "id": g.id,
        "name": g.name,
        "target_paise": g.target_paise,
        "saved_paise": saved,
        "left_paise": left,
        "progress": round(min(saved / g.target_paise, 1), 4),
        "due_on": g.due_on.isoformat() if g.due_on else None,
        "months_left": months,
        "monthly_needed_paise": monthly,
        "saved_this_month_paise": this_month,
        "done": saved >= g.target_paise,
        "archived": g.archived,
        "created_at": to_ist_iso(g.created_at),
    }
    if deposits:
        out["deposits"] = [
            {"id": d.id, "amount_paise": d.amount_paise, "note": d.note, "created_at": to_ist_iso(d.created_at)}
            for d in reversed(g.deposits)
        ]
    return out


def list_goals(s: Session, user_id: int) -> list[dict[str, Any]]:
    goals = s.scalars(select(Goal).where(Goal.user_id == user_id).order_by(Goal.archived, Goal.id)).all()
    return [goal_json(s, g) for g in goals]


def find_goal(s: Session, user_id: int, name: str) -> Goal | None:
    key = " ".join(name.lower().split())
    for g in s.scalars(select(Goal).where(Goal.user_id == user_id, Goal.archived.is_(False))):
        if " ".join(g.name.lower().split()) == key:
            return g
    return None


def create_goal(s: Session, user_id: int, name: str, target_paise: int, due_on: date | None) -> Goal:
    if due_on is not None and due_on < today_ist():
        raise ApiError(422, "past_date", "Pick a date that hasn't passed yet")
    g = Goal(user_id=user_id, name=name.strip()[:80], target_paise=target_paise, due_on=due_on)
    s.add(g)
    s.flush()
    return g


def add_deposit(s: Session, g: Goal, amount_paise: int, note: str | None) -> GoalDeposit:
    saved = s.scalar(select(func.coalesce(func.sum(GoalDeposit.amount_paise), 0)).where(GoalDeposit.goal_id == g.id)) or 0
    if saved + amount_paise < 0:
        raise ApiError(422, "not_enough", f"Only {rupees(saved)} is saved towards {g.name}")
    d = GoalDeposit(goal_id=g.id, amount_paise=amount_paise, note=(note or "").strip()[:120] or None)
    g.deposits.append(d)
    s.flush()
    return d


def context_lines(s: Session, user_id: int) -> list[str]:
    """Goals as lines for the AI's instructions (Ask and the check-in)."""
    lines = []
    for g in list_goals(s, user_id):
        if g["archived"]:
            continue
        line = f"- Saving for {g['name']}: {rupees(g['saved_paise'])} of {rupees(g['target_paise'])}"
        if g["done"]:
            line += ", reached"
        elif g["due_on"]:
            due = date.fromisoformat(g["due_on"]).strftime("%d %b %Y")
            line += f", by {due}, about {rupees(g['monthly_needed_paise'] or 0)} a month to get there"
        lines.append(line + ".")
    return lines
