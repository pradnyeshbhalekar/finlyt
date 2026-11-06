"""What Finlyt remembers about my money (income, commitments, notes), to see and correct."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import CommitmentIn, CommitmentPatch, IncomeIn
from ..services import memory
from ..validation import parse_body

bp = Blueprint("memory", __name__)


def _done(s, user_id: int, updates=()):
    s.commit()
    return {**memory.profile_json(s, user_id), "updates": [u.json() for u in updates if u]}


@bp.get("/memory")
def show():
    s = get_session()
    return memory.profile_json(s, current_user().id)


@bp.put("/memory/income")
def set_income():
    data = parse_body(IncomeIn)
    s = get_session()
    user_id = current_user().id
    return _done(s, user_id, memory.set_income(s, user_id, data.monthly_income_paise, data.note))


@bp.delete("/memory/income")
def forget_income():
    s = get_session()
    user_id = current_user().id
    profile = memory.get_profile(s, user_id)
    if profile is not None:
        profile.monthly_income_paise = None
        profile.income_note = None
    return _done(s, user_id)


@bp.post("/memory/commitments")
def add_commitment():
    data = parse_body(CommitmentIn)
    s = get_session()
    user_id = current_user().id
    _, update = memory.save_commitment(
        s,
        user_id,
        title=data.title,
        monthly_paise=data.monthly_paise,
        category_id=data.category_id,
        total_paise=data.total_paise,
        paid_before_paise=data.paid_before_paise,
        rules=[r.model_dump() for r in data.rules] if data.rules is not None else None,
        match_words=data.match_words,
        notes=data.notes,
    )
    return _done(s, user_id, [update]), 201


@bp.patch("/memory/commitments/<int:commitment_id>")
def change_commitment(commitment_id: int):
    data = parse_body(CommitmentPatch)
    s = get_session()
    user_id = current_user().id
    c = memory.get_commitment(s, user_id, commitment_id)
    if data.title is not None:
        c.title = data.title.strip()
    if data.monthly_paise is not None:
        c.monthly_paise = data.monthly_paise
    if data.total_paise is not None:
        c.total_paise = data.total_paise or None
    if data.paid_before_paise is not None:
        c.paid_before_paise = data.paid_before_paise
    if data.rules is not None:
        c.rules = [r.model_dump() for r in data.rules]
    if data.active is not None:
        c.active = data.active
    return _done(s, user_id)


@bp.delete("/memory/commitments/<int:commitment_id>")
def delete_commitment(commitment_id: int):
    s = get_session()
    user_id = current_user().id
    s.delete(memory.get_commitment(s, user_id, commitment_id))
    return _done(s, user_id)


@bp.delete("/memory/notes/<int:note_id>")
def delete_note(note_id: int):
    s = get_session()
    user_id = current_user().id
    s.delete(memory.get_note(s, user_id, note_id))
    return _done(s, user_id)
