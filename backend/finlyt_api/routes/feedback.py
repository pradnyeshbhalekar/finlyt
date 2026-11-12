"""Feedback from the app (Settings → Send feedback), emailed to whoever runs Finlyt."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..schemas import FeedbackIn
from ..services import emails
from ..validation import parse_body

bp = Blueprint("feedback", __name__)


@bp.post("/feedback")
def send_feedback():
    data = parse_body(FeedbackIn)
    emails.send_feedback(current_user(), data.kind, data.message, data.app_version, data.device)
    return {"sent": True}, 201
