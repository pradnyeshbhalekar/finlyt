"""Monthly reports: the full "where did my money go" dashboard for one month."""

from __future__ import annotations

from flask import Blueprint, request

from ..auth import current_user
from ..db import get_session
from ..services import reports

bp = Blueprint("reports", __name__)


@bp.get("/reports/month")
def month():
    """?month=YYYY-MM (default this month)."""
    first = reports.parse_month(request.args.get("month"))
    return reports.month_report(get_session(), current_user().id, first)
