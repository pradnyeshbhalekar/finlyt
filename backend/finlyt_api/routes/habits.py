"""Small habits (little spends that add up) and what I decided about each one."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import HabitRuleIn
from ..services import habits, memory
from ..timeutil import today_ist
from ..validation import parse_body

bp = Blueprint("habits", __name__)


@bp.get("/habits")
def list_habits():
    return habits.habits(get_session(), current_user().id, today_ist())


@bp.get("/habits/question")
def ask_one():
    """The check-in's closing question about one habit, or null when there's nothing to ask."""
    return {"question": habits.question(get_session(), current_user().id, today_ist())}


@bp.put("/habits/<key>")
def decide(key: str):
    """Set a limit, say it's fine, say it's a need, or ask later. Returns the habits again."""
    data = parse_body(HabitRuleIn)
    s = get_session()
    user_id = current_user().id
    today = today_ist()
    _, update = habits.set_rule(
        s,
        user_id,
        key,
        today,
        status=data.status,
        times_per_week=data.times_per_week,
        paise_per_week=data.paise_per_week,
        label=data.label,
        goal_id=data.goal_id,
    )
    if data.note:
        memory.add_note(s, user_id, data.note)
    s.commit()
    return {**habits.habits(s, user_id, today), "update": update.json() if update else None}


@bp.delete("/habits/<key>")
def forget(key: str):
    """Forget the decision: the habit is spotted (or asked about) like a new one."""
    s = get_session()
    user_id = current_user().id
    habits.forget_rule(s, user_id, key)
    s.commit()
    return habits.habits(s, user_id, today_ist())
