"""Sending email through Brevo's transactional API (free plan: 300 a day).

Off until BREVO_API_KEY and MAIL_FROM (a sender address verified in Brevo) are set; then
`get_mailer()` returns a sender, else None. Tests put a fake in app.extensions["finlyt.mailer"].
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx
from flask import current_app

from .config import Settings
from .errors import ApiError

BREVO_URL = "https://api.brevo.com/v3/smtp/email"


@dataclass(frozen=True)
class Email:
    to: str
    to_name: str | None
    subject: str
    html: str
    text: str
    reply_to: str | None = None
    reply_to_name: str | None = None
    tags: tuple[str, ...] = ()


class Mailer(Protocol):
    def __call__(self, email: Email) -> None:
        """Sends it, or raises ApiError."""
        ...


class BrevoMailer:
    def __init__(self, api_key: str, sender: str, sender_name: str, *, sandbox: bool = False) -> None:
        self.api_key = api_key
        self.sender = sender
        self.sender_name = sender_name
        self.sandbox = sandbox  # Brevo accepts the request but doesn't deliver it

    def __call__(self, email: Email) -> None:
        body: dict = {
            "sender": {"email": self.sender, "name": self.sender_name},
            "to": [{"email": email.to, **({"name": email.to_name} if email.to_name else {})}],
            "subject": email.subject,
            "htmlContent": email.html,
            "textContent": email.text,
        }
        if email.reply_to:
            body["replyTo"] = {"email": email.reply_to, **({"name": email.reply_to_name} if email.reply_to_name else {})}
        if email.tags:
            body["tags"] = list(email.tags)
        if self.sandbox:
            body["headers"] = {"X-Sib-Sandbox": "drop"}
        try:
            resp = httpx.post(
                BREVO_URL,
                json=body,
                headers={"api-key": self.api_key, "accept": "application/json"},
                timeout=8,
            )
        except httpx.HTTPError as e:
            raise ApiError(502, "mail_failed", "The email couldn't be sent. Try again in a minute.") from e
        if resp.status_code >= 300:
            current_app.logger.warning("Brevo answered %s: %s", resp.status_code, resp.text[:300])
            raise ApiError(502, "mail_failed", "The email couldn't be sent. Try again in a minute.")


def get_mailer() -> Mailer | None:
    fake = current_app.extensions.get("finlyt.mailer")
    if fake is not None:
        return fake
    settings: Settings = current_app.config["SETTINGS"]
    if not settings.brevo_api_key or not settings.mail_from:
        return None
    return BrevoMailer(settings.brevo_api_key, settings.mail_from, settings.mail_from_name)
