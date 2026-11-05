"""Finlyt API."""

from __future__ import annotations

import logging

from flask import Flask

from . import db
from .auth import register_auth
from .cli import register_cli
from .config import Settings
from .errors import register_error_handlers
from .routes import auth as auth_routes
from .routes import activity, ask, expenses, health, log, mcp, meta, plan, sms, stats


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or Settings.from_env()
    logging.basicConfig(level=logging.INFO)

    app = Flask(__name__)
    app.config["SETTINGS"] = settings
    # Voice notes are the largest uploads (POST /api/log/propose caps audio at 4 MB).
    app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024
    app.json.sort_keys = False  # type: ignore[attr-defined]
    app.json.ensure_ascii = False  # type: ignore[attr-defined]

    engine = (
        db.make_engine(settings.database_url, serverless=settings.serverless)
        if settings.database_url
        else None
    )
    db.init_app(app, engine)
    register_auth(app)
    register_error_handlers(app)
    for module in (health, auth_routes, meta, expenses, stats, log, plan, sms, activity, ask, mcp):
        app.register_blueprint(module.bp, url_prefix="/api")
    register_cli(app)
    return app
