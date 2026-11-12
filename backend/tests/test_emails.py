"""Email through Brevo: the welcome on a first sign-in, and feedback from the app."""

from __future__ import annotations

import pytest

from finlyt_api.errors import ApiError
from finlyt_api.mailer import BREVO_URL, BrevoMailer, Email

from .conftest import ME, build_app, sign_in


class FakeMailer:
    def __init__(self, fail: bool = False) -> None:
        self.sent: list[Email] = []
        self.fail = fail

    def __call__(self, email: Email) -> None:
        if self.fail:
            raise ApiError(502, "mail_failed", "Brevo is down")
        self.sent.append(email)


@pytest.fixture
def mail(engine):
    """An app with mail set up (sender and feedback address), and its fake mailer."""
    application, connection, outer = build_app(engine, mail_from="hello@finlyt.test", feedback_to="team@finlyt.test")
    mailer = FakeMailer()
    application.extensions["finlyt.mailer"] = mailer
    yield application.test_client(), mailer, application
    outer.rollback()
    connection.close()


def test_a_welcome_email_on_the_first_sign_in_only(mail):
    client, mailer, _ = mail
    assert sign_in(client)["is_new_user"] is True
    [email] = mailer.sent
    assert email.to == ME[1] and email.to_name == "Me"
    assert email.subject == "Welcome to Finlyt, Me"
    assert "chai 40 cash" in email.text and "Import from an AI chat" in email.text
    assert "https://finlyt.onrender.com/email/coin.png" in email.html
    assert email.reply_to == "team@finlyt.test" and email.tags == ("welcome",)

    assert sign_in(client)["is_new_user"] is False
    assert len(mailer.sent) == 1  # not again


def test_a_failed_welcome_email_doesnt_stop_the_sign_in(mail):
    client, _, app = mail
    app.extensions["finlyt.mailer"] = FakeMailer(fail=True)
    data = sign_in(client)
    assert data["is_new_user"] is True and data["token"]


def test_without_mail_there_is_no_email_and_feedback_says_so(client):
    sign_in(client)  # no Brevo key: signing in still works
    assert client.get("/api/meta").get_json()["feedback"] is False  # so the app hides Send feedback
    resp = client.post("/api/feedback", json={"message": "Love the coin"})
    assert resp.status_code == 503
    assert resp.get_json()["error"]["code"] == "not_configured"


def test_feedback_is_emailed_to_the_team_with_a_reply_to(mail):
    client, mailer, _ = mail
    sign_in(client)
    assert client.get("/api/meta").get_json()["feedback"] is True
    mailer.sent.clear()
    resp = client.post(
        "/api/feedback",
        json={"kind": "problem", "message": "The <b>mic</b> stops early", "app_version": "0.1.5", "device": "Pixel 10a · Android 17"},
    )
    assert resp.status_code == 201, resp.get_json()
    [email] = mailer.sent
    assert email.to == "team@finlyt.test"
    assert email.reply_to == ME[1] and email.reply_to_name == "Me"
    assert email.subject == "Finlyt feedback: problem from Me"
    assert "&lt;b&gt;mic&lt;/b&gt;" in email.html and "<b>mic</b>" not in email.html
    assert "Pixel 10a" in email.text and "0.1.5" in email.text
    assert email.tags == ("feedback", "problem")

    assert client.post("/api/feedback", json={"kind": "rant", "message": "hm"}).status_code == 422
    assert client.post("/api/feedback", json={"message": "x"}).status_code == 422


def test_feedback_needs_a_sign_in(mail):
    client, mailer, _ = mail
    assert client.post("/api/feedback", json={"message": "Hello there"}).status_code == 401
    assert mailer.sent == []


def test_the_brevo_request(app, monkeypatch):
    calls = []

    class Resp:
        def __init__(self, status):
            self.status_code = status
            self.text = "{}"

    def fake_post(url, json, headers, timeout):
        calls.append((url, json, headers))
        return Resp(201 if len(calls) == 1 else 401)

    monkeypatch.setattr("finlyt_api.mailer.httpx.post", fake_post)
    mailer = BrevoMailer("key-123", "hello@finlyt.test", "Finlyt", sandbox=True)
    email = Email(to="me@example.com", to_name="Me", subject="Hi", html="<p>Hi</p>", text="Hi",
                  reply_to="team@finlyt.test", tags=("welcome",))
    with app.app_context():
        mailer(email)
        with pytest.raises(ApiError) as failed:
            mailer(email)
    assert failed.value.status == 502
    url, body, headers = calls[0]
    assert url == BREVO_URL and headers["api-key"] == "key-123"
    assert body["sender"] == {"email": "hello@finlyt.test", "name": "Finlyt"}
    assert body["to"] == [{"email": "me@example.com", "name": "Me"}]
    assert body["replyTo"] == {"email": "team@finlyt.test"}
    assert body["tags"] == ["welcome"] and body["headers"] == {"X-Sib-Sandbox": "drop"}
    assert body["htmlContent"] == "<p>Hi</p>" and body["textContent"] == "Hi"
