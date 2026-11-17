"""How much to save a month: Finlyt's suggestion from my income, or my own target."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import SavingTargetIn
from ..services import saving
from ..timeutil import today_ist
from ..validation import parse_body

bp = Blueprint("saving", __name__)


@bp.get("/saving")
def show():
    return saving.saving_plan(get_session(), current_user().id, today_ist())


@bp.put("/saving")
def set_target():
    """{"target_paise": 900000} sets my own target; null goes back to the suggestion."""
    data = parse_body(SavingTargetIn)
    s = get_session()
    user_id = current_user().id
    saving.set_target(s, user_id, data.target_paise)
    s.commit()
    return saving.saving_plan(s, user_id, today_ist())
