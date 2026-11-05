from __future__ import annotations

from flask import Blueprint, request
from sqlalchemy import text

from ..db import get_session

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    body = {"ok": True}
    if request.args.get("db"):
        get_session().execute(text("SELECT 1"))
        body["db"] = True
    return body
