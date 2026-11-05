"""History's timeline, and who owes whom."""

from __future__ import annotations

from datetime import datetime

from flask import Blueprint, request

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..services import activity, debts
from ..timeutil import ensure_aware

bp = Blueprint("activity", __name__)


@bp.get("/activity")
def activity_feed():
    """Entries, paybacks, money owed, set-aside bank payments and plans, newest first."""
    before = request.args.get("before")
    try:
        before_at = ensure_aware(datetime.fromisoformat(before)) if before else None
        limit = min(max(int(request.args.get("limit", 60)), 1), 200)
    except ValueError as e:
        raise ApiError(422, "bad_query", "before must be an ISO time and limit a number") from e
    return activity.feed(get_session(), current_user().id, before=before_at, limit=limit)


@bp.get("/people/balances")
def people_balances():
    """Who owes me, and whom I owe, per person."""
    return debts.balances(get_session(), current_user().id)
