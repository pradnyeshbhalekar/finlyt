"""Test setup.

DB tests run against TEST_DATABASE_URL (tables are dropped and recreated) and are skipped
without it. Each test runs inside a transaction that is rolled back afterwards. Google is
faked: an ID token "google:<sub>:<email>" verifies as that account.
"""

from __future__ import annotations

import os

import pytest
from dotenv import load_dotenv
from sqlalchemy.orm import sessionmaker

from finlyt_api import create_app
from finlyt_api import models  # noqa: F401
from finlyt_api.auth import GoogleIdentity
from finlyt_api.config import Settings, normalize_db_url
from finlyt_api.db import Base, make_engine
from finlyt_api.errors import ApiError

load_dotenv()

CLIENT_ID = "test-web-client.apps.googleusercontent.com"
ME = ("sub-me", "me@example.com")
FRIEND = ("sub-friend", "friend@example.com")


def fake_google(token: str, audience: str) -> GoogleIdentity:
    assert audience == CLIENT_ID
    if not token.startswith("google:"):
        raise ApiError(401, "invalid_google_token", "Google sign-in couldn't be verified.")
    _, sub, email = token.split(":", 2)
    return GoogleIdentity(
        sub=sub, email=email, email_verified=True, name=email.split("@")[0].title(), picture=None
    )


def make_settings(**overrides) -> Settings:
    values = {
        "database_url": None,
        "google_web_client_id": CLIENT_ID,
        "allowed_emails": frozenset({ME[1], FRIEND[1]}),
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture(scope="session")
def engine():
    url = normalize_db_url(os.environ.get("TEST_DATABASE_URL"))
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    eng = make_engine(url)
    Base.metadata.drop_all(eng)
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


def build_app(engine, **settings):
    connection = engine.connect()
    outer = connection.begin()
    application = create_app(make_settings(**settings))
    application.config["TESTING"] = True
    application.extensions["finlyt.sessionmaker"] = sessionmaker(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    application.extensions["finlyt.google_verifier"] = fake_google
    return application, connection, outer


@pytest.fixture
def app(engine):
    application, connection, outer = build_app(engine)
    yield application
    outer.rollback()
    connection.close()


@pytest.fixture
def client(app):
    return app.test_client()


def sign_in(client, who=ME) -> dict:
    sub, email = who
    resp = client.post("/api/auth/google", json={"id_token": f"google:{sub}:{email}", "device": "pytest"})
    assert resp.status_code == 200, resp.get_json()
    data = resp.get_json()
    client.environ_base["HTTP_AUTHORIZATION"] = f"Bearer {data['token']}"
    return data


@pytest.fixture
def me(client) -> dict:
    """Sign in as ME and return handy ids from /api/meta."""
    data = sign_in(client)
    meta = client.get("/api/meta").get_json()
    return {
        **data,
        "meta": meta,
        "acc": {a["name"]: a["id"] for a in meta["accounts"]},
        "cat": {c["name"]: c["id"] for c in meta["categories"]},
    }
