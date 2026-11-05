from __future__ import annotations

from sqlalchemy import select

from finlyt_api import create_app
from finlyt_api.models import User

from .conftest import FRIEND, ME, build_app, make_settings, sign_in


def bare_client(**settings):
    """An app with no database, for checks that never reach it."""
    return create_app(make_settings(**settings)).test_client()


def test_health_is_public():
    resp = bare_client().get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"ok": True}


def test_api_needs_a_session():
    client = bare_client()
    assert client.get("/api/meta").get_json()["error"]["code"] == "unauthorized"
    resp = client.get("/api/meta", headers={"Authorization": "Basic abc"})
    assert resp.status_code == 401


def test_unknown_route_is_a_json_404():
    resp = bare_client().get("/api/nope")
    assert resp.status_code == 404
    assert resp.get_json()["error"]["code"] == "not_found"


def test_first_sign_in_creates_user_with_defaults(client):
    data = sign_in(client)
    assert data["is_new_user"] is True
    assert data["user"]["email"] == ME[1]
    meta = client.get("/api/meta").get_json()
    assert [a["name"] for a in meta["accounts"]] == ["Kotak", "DNS Bank", "Cash"]
    assert [a["is_primary"] for a in meta["accounts"]] == [True, False, False]
    assert len(meta["categories"]) == 15
    assert {f["bank_code"] for f in meta["sms_filters"]} == {"kotak", "dns"}

    again = sign_in(client)
    assert again["is_new_user"] is False
    assert again["user"]["id"] == data["user"]["id"]
    assert again["token"] != data["token"]


def test_sign_in_rejects_unlisted_email(client):
    resp = client.post("/api/auth/google", json={"id_token": "google:sub-x:stranger@example.com"})
    assert resp.status_code == 403
    assert resp.get_json()["error"]["code"] == "not_allowed"


def test_sign_in_rejects_bad_google_token(client):
    resp = client.post("/api/auth/google", json={"id_token": "definitely-not-a-google-token"})
    assert resp.status_code == 401
    assert resp.get_json()["error"]["code"] == "invalid_google_token"


def test_empty_allowlist_is_a_config_error(engine):
    application, connection, outer = build_app(engine, allowed_emails=frozenset())
    try:
        resp = application.test_client().post(
            "/api/auth/google", json={"id_token": f"google:{ME[0]}:{ME[1]}"}
        )
        assert resp.status_code == 503
        assert resp.get_json()["error"]["code"] == "not_configured"
    finally:
        outer.rollback()
        connection.close()


def test_logout_ends_the_session(client):
    sign_in(client)
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_bogus_session_token_is_rejected(client):
    sign_in(client)
    client.environ_base["HTTP_AUTHORIZATION"] = "Bearer not-a-real-session"
    assert client.get("/api/auth/me").get_json()["error"]["code"] == "session_expired"


def test_google_sign_in_takes_over_dev_user(app, client):
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        s.add(User(google_sub=f"dev:{FRIEND[1]}", email=FRIEND[1], name="dev"))
        s.commit()
        dev_id = s.scalar(select(User.id).where(User.email == FRIEND[1]))
        s.close()
    data = sign_in(client, FRIEND)
    assert data["user"]["id"] == dev_id
    assert data["is_new_user"] is False
