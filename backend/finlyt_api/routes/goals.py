"""Savings goals: list, add, change, delete, and put money towards one (or take it out)."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import DepositIn, GoalIn, GoalPatch
from ..services import goals
from ..validation import parse_body

bp = Blueprint("goals", __name__)


@bp.get("/goals")
def list_goals():
    return {"items": goals.list_goals(get_session(), current_user().id)}


@bp.post("/goals")
def add_goal():
    data = parse_body(GoalIn)
    s = get_session()
    g = goals.create_goal(s, current_user().id, data.name, data.target_paise, data.due_on)
    s.commit()
    return goals.goal_json(s, g, deposits=True), 201


@bp.get("/goals/<int:goal_id>")
def show_goal(goal_id: int):
    s = get_session()
    return goals.goal_json(s, goals.get_goal(s, current_user().id, goal_id), deposits=True)


@bp.patch("/goals/<int:goal_id>")
def change_goal(goal_id: int):
    data = parse_body(GoalPatch)
    s = get_session()
    g = goals.get_goal(s, current_user().id, goal_id)
    fields = data.model_fields_set
    if data.name is not None:
        g.name = data.name.strip()
    if data.target_paise is not None:
        g.target_paise = data.target_paise
    if "due_on" in fields:
        g.due_on = data.due_on
    if data.archived is not None:
        g.archived = data.archived
    s.commit()
    return goals.goal_json(s, g, deposits=True)


@bp.delete("/goals/<int:goal_id>")
def delete_goal(goal_id: int):
    s = get_session()
    s.delete(goals.get_goal(s, current_user().id, goal_id))
    s.commit()
    return "", 204


@bp.post("/goals/<int:goal_id>/deposits")
def deposit(goal_id: int):
    data = parse_body(DepositIn)
    s = get_session()
    g = goals.get_goal(s, current_user().id, goal_id)
    goals.add_deposit(s, g, data.amount_paise, data.note)
    s.commit()
    return goals.goal_json(s, g, deposits=True), 201
