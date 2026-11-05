"""Google sign-in and app sessions.

The phone signs in with Google and sends us the ID token once. We verify it, then hand
out our own random session token. Only its SHA-256 is stored; every API call sends the
token as `Authorization: Bearer <token>`.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta

from flask import Flask, g, request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_session
from .errors import ApiError
from .models import AuthSession, User
from .timeutil import now_utc

SESSION_TTL = timedelta(days=90)
# Extend a session's expiry at most this often, so most requests don't write.
TOUCH_INTERVAL = timedelta(hours=6)
PUBLIC_ENDPOINTS = frozenset({"health.health", "auth.google_login"})


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str | None
    picture: str | None


def verify_google_id_token(token: str, audience: str) -> GoogleIdentity:
    """Check a Google ID token's signature, expiry, issuer and audience."""
    # Imported lazily: only sign-in needs them, and it keeps cold starts lean.
    from google.auth import exceptions as google_exceptions
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(
            token, google_requests.Request(), audience=audience, clock_skew_in_seconds=10
        )
    except (ValueError, google_exceptions.GoogleAuthError) as exc:
        raise ApiError(
            401, "invalid_google_token", "Google sign-in couldn't be verified. Try again."
        ) from exc
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=str(claims.get("email", "")).lower(),
        email_verified=bool(claims.get("email_verified")),
        name=claims.get("name"),
        picture=claims.get("picture"),
    )


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(s: Session, user: User, device: str | None) -> str:
    token = secrets.token_urlsafe(32)
    now = now_utc()
    s.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            device=device,
            last_used_at=now,
            expires_at=now + SESSION_TTL,
        )
    )
    return token


def current_user() -> User:
    return g.user


def register_auth(app: Flask) -> None:
    # Tests swap this for a fake; everything else uses the real Google check.
    app.extensions.setdefault("finlyt.google_verifier", verify_google_id_token)

    @app.before_request
    def _authenticate():
        if (
            request.method == "OPTIONS"
            or request.endpoint is None  # unknown route: let Flask answer 404/405
            or request.endpoint in PUBLIC_ENDPOINTS
        ):
            return None

        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        token = token.strip()
        if scheme.lower() != "bearer" or not token:
            raise ApiError(401, "unauthorized", "Sign in required")

        s = get_session()
        row = s.execute(
            select(AuthSession, User)
            .join(User, AuthSession.user_id == User.id)
            .where(AuthSession.token_hash == hash_token(token))
        ).first()
        now = now_utc()
        if row is None or row[0].expires_at <= now:
            raise ApiError(401, "session_expired", "Your session has ended. Sign in again.")

        session_row, user = row
        if now - session_row.last_used_at >= TOUCH_INTERVAL:
            session_row.last_used_at = now
            session_row.expires_at = now + SESSION_TTL
            s.commit()
        g.user = user
        g.auth_session = session_row
        return None
