"""Monthly budget and the Sunday check-in with Finlyt."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..gemini import get_planner
from ..schemas import PlanChatIn, PlanIn
from ..services import planning
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
    system = planning.PLAN_SYSTEM_PROMPT + "\nNumbers for this check-in:\n" + planning.build_context(s, user_id, today)
    turn, model = get_planner()(system=system, messages=[(m.role, m.text) for m in data.messages])
    plan = None
    if turn.ready:
        try:
            plan = planning.resolve_plan(s, user_id, today, turn)
        except ApiError:
            plan = None  # no budget yet: keep talking
    return {"reply": turn.reply.strip(), "plan": plan, "model": model}


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
