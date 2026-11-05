from __future__ import annotations

from flask import Blueprint, current_app, g
from sqlalchemy import select

from ..auth import create_session, current_user
from ..config import Settings
from ..db import get_session
from ..defaults import seed_user_defaults
from ..errors import ApiError
from ..models import User
from ..schemas import GoogleLoginIn
from ..serializers import user_json
from ..timeutil import now_utc
from ..validation import parse_body

bp = Blueprint("auth", __name__)


@bp.post("/auth/google")
def google_login():
    body = parse_body(GoogleLoginIn)
    settings: Settings = current_app.config["SETTINGS"]
    if not settings.google_web_client_id:
        raise ApiError(503, "not_configured", "GOOGLE_WEB_CLIENT_ID isn't set on the server")
    if not settings.allowed_emails:
        raise ApiError(
            503, "not_configured", "ALLOWED_EMAILS is empty on the server, so nobody can sign in"
        )

    identity = current_app.extensions["finlyt.google_verifier"](
        body.id_token, settings.google_web_client_id
    )
    if not identity.email or not identity.email_verified:
        raise ApiError(403, "email_unverified", "This Google account's email isn't verified")
    if not settings.email_allowed(identity.email):
        raise ApiError(403, "not_allowed", f"{identity.email} isn't allowed on this Finlyt server")

    s = get_session()
    user = s.scalar(select(User).where(User.google_sub == identity.sub))
    if user is None:
        # A user made with `flask dev-token` is taken over by the real Google account.
        user = s.scalar(select(User).where(User.email == identity.email))
        if user is not None and not user.google_sub.startswith("dev:"):
            raise ApiError(409, "email_in_use", "This email belongs to a different Google account")

    is_new_user = user is None
    if user is None:
        user = User(google_sub=identity.sub, email=identity.email)
        s.add(user)
        s.flush()
        seed_user_defaults(s, user)
    user.google_sub = identity.sub
    user.email = identity.email
    user.name = identity.name
    user.picture_url = identity.picture
    user.last_login_at = now_utc()
    token = create_session(s, user, body.device)
    s.commit()
    return {"token": token, "user": user_json(user), "is_new_user": is_new_user}


@bp.get("/auth/me")
def me():
    return {"user": user_json(current_user())}


@bp.post("/auth/logout")
def logout():
    s = get_session()
    s.delete(g.auth_session)
    s.commit()
    return "", 204
