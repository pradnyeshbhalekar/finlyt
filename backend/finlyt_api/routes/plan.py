"""Monthly budget and the weekly check-in with Finlyt (on the day the user picked)."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..gemini import get_planner
from ..schemas import CheckInIn, PlanChatIn, PlanIn
from ..services import memory, planning
from ..timeutil import today_ist
from ..validation import parse_body

bp = Blueprint("plan", __name__)


@bp.get("/plan")
def plan_status():
    """Today's limit and what's left, the buffer, this month's budget and planned items."""
    return planning.status(get_session(), current_user().id, today_ist())


@bp.post("/plan/chat")
def plan_chat():
    """One turn of the check-in: Finlyt's reply, and a plan to confirm once it's ready."""
    data = parse_body(PlanChatIn)
    s = get_session()
    user_id = current_user().id
    today = today_ist()
    system = (
        planning.PLAN_SYSTEM_PROMPT
        + "\nNumbers for this check-in:\n"
        + planning.build_context(s, user_id, today)
        + "\n"
        + memory.context(s, user_id)
    )
    turn, model = get_planner()(system=system, messages=[(m.role, m.text) for m in data.messages])
    updates = remember(s, user_id, turn)
    plan = None
    if turn.ready:
        try:
            plan = planning.resolve_plan(s, user_id, today, turn)
        except ApiError:
            plan = None  # no budget yet: keep talking
    options = [o.strip()[:60] for o in turn.options if o.strip()][:4]
    s.commit()  # what it remembered
    return {
        "reply": turn.reply.strip(),
        "options": options,
        "plan": plan,
        "memory_updates": [u.json() for u in updates],
        "model": model,
    }


def remember(s, user_id: int, turn) -> list[memory.Update]:
    """Save what the check-in heard that lasts. A bad value is skipped, not fatal."""
    from ..money import to_paise

    updates: list[memory.Update] = []
    try:
        if turn.remember_income:
            updates += memory.set_income(s, user_id, to_paise(turn.remember_income))
        for c in turn.remember_commitments:
            update = memory.apply_rupees_commitment(
                s,
                user_id,
                {
                    "title": c.title,
                    "monthly_rupees": c.monthly,
                    "category": c.category,
                    "total_rupees": c.total,
                    "already_paid_rupees": c.already_paid,
                    "rules": [{"when_income_at_least_rupees": r.when_income_at_least, "monthly_rupees": r.monthly} for r in c.rules],
                    "match_words": c.match_words or None,
                    "notes": c.notes,
                },
            )
            if update:
                updates.append(update)
        for note in turn.remember_notes:
            if note.strip():
                updates.append(memory.add_note(s, user_id, note))
    except ApiError:
        pass
    return updates


@bp.put("/plan/check-in")
def set_check_in():
    """The weekly check-in day. The phone keeps the time and sends the reminder."""
    data = parse_body(CheckInIn)
    s = get_session()
    user_id = current_user().id
    planning.set_check_in_weekday(s, user_id, data.weekday)
    s.commit()
    return planning.status(s, user_id, today_ist())


@bp.post("/plan")
def save_plan():
    """Save a confirmed plan: budget for this month, daily limit from today, planned items."""
    data = parse_body(PlanIn)
    s = get_session()
    user_id = current_user().id
    today = today_ist()
    planning.commit_plan(s, user_id, today, data)
    s.commit()
    return planning.status(s, user_id, today), 201
