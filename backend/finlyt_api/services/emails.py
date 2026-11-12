"""The emails Finlyt sends: a welcome on someone's first sign-in, and feedback from the app to
whoever runs Finlyt. Short, plain and in the app's voice, with a plain-text copy for every HTML
one. User text is escaped. Nothing here keeps a copy of what was sent."""

from __future__ import annotations

from datetime import datetime
from html import escape

from flask import current_app

from ..config import Settings
from ..errors import ApiError
from ..mailer import Email, get_mailer
from ..models import User
from ..timeutil import IST

SITE = "https://finlyt.onrender.com"
COIN = f"{SITE}/email/coin.png"
BRAND = "#3355FF"
FEEDBACK_KINDS = {"idea": "Idea", "problem": "Problem", "praise": "Something they like"}


def _settings() -> Settings:
    return current_app.config["SETTINGS"]


def _page(heading: str, body: str, footer: str) -> str:
    """A simple, table-based layout that reads well in Gmail, on phones and in dark mode."""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111412;">
<tr><td>
<img src="{COIN}" width="48" height="48" alt="Finlyt" style="display:block;border:0;border-radius:12px;">
<h1 style="margin:24px 0 0;font-size:26px;line-height:32px;letter-spacing:-0.5px;">{heading}</h1>
{body}
</td></tr>
</table>
<p style="max-width:520px;margin:16px auto 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8f8b;">{footer}</p>
</td></tr>
</table>
</body></html>"""


def _p(text: str, muted: bool = False) -> str:
    color = "#6b716d" if muted else "#111412"
    return f'<p style="margin:12px 0 0;font-size:16px;line-height:24px;color:{color};">{text}</p>'


WELCOME_TIPS = [
    (
        "Log it the way you'd say it",
        "Type or say “chai 40 cash, auto 120” at the bottom of Home. Finlyt works out the amount, the "
        "category and how you paid.",
    ),
    (
        "Plan your month",
        "A short chat in Plan turns your budget into a daily limit. What you don't spend is saved for surprises.",
    ),
    (
        "Check in once a week",
        "On your check-in day, Finlyt asks what's coming up and sets your limits for the week.",
    ),
]


def welcome(user: User) -> Email:
    first = (user.name or "").split(" ")[0]
    subject = f"Welcome to Finlyt, {first}" if first else "Welcome to Finlyt"
    tips_html = "".join(
        f'<tr><td valign="top" style="padding:16px 12px 0 0;"><div style="width:28px;height:28px;border-radius:14px;'
        f'background:#E9EDFF;color:{BRAND};font-weight:600;font-size:14px;line-height:28px;text-align:center;">{i}</div></td>'
        f'<td style="padding-top:16px;"><div style="font-size:16px;font-weight:600;line-height:22px;">{escape(title)}</div>'
        f'<div style="font-size:15px;line-height:22px;color:#6b716d;margin-top:2px;">{escape(text)}</div></td></tr>'
        for i, (title, text) in enumerate(WELCOME_TIPS, start=1)
    )
    body = (
        _p(f"Hi {escape(first)}, glad you're here. Finlyt helps you remember every rupee you spend. Three things to start with:" if first
           else "Glad you're here. Finlyt helps you remember every rupee you spend. Three things to start with:", muted=True)
        + f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:4px;">{tips_html}</table>'
        + _p(
            "Tracked your spending in Claude, ChatGPT or Gemini before? <b>Settings → Import from an AI chat</b> "
            "brings it all in, with this month's plan.",
            muted=True,
        )
        + f'<p style="margin:24px 0 0;"><a href="{SITE}" style="display:inline-block;background:{BRAND};color:#ffffff;'
        'text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px;">Open finlyt.onrender.com</a></p>'
        + _p("Questions or ideas? Just reply to this email.", muted=True)
    )
    footer = "You're getting this once, because you just signed in to Finlyt with this Google account."
    tips_text = "\n".join(f"{i}. {title}: {text}" for i, (title, text) in enumerate(WELCOME_TIPS, start=1))
    text = (
        f"{'Hi ' + first + ', glad' if first else 'Glad'} you're here. Finlyt helps you remember every rupee you spend.\n\n"
        f"{tips_text}\n\n"
        "Tracked your spending in Claude, ChatGPT or Gemini before? Settings → Import from an AI chat brings it all in, "
        "with this month's plan.\n\n"
        f"{SITE}\n\nQuestions or ideas? Just reply to this email.\n\n{footer}"
    )
    s = _settings()
    return Email(
        to=user.email,
        to_name=user.name,
        subject=subject,
        html=_page(escape(subject), body, footer),
        text=text,
        reply_to=s.feedback_to,
        tags=("welcome",),
    )


def send_welcome(user: User) -> bool:
    """Sends the welcome email if mail is set up. Never raises: signing in matters more."""
    mailer = get_mailer()
    if mailer is None:
        return False
    try:
        mailer(welcome(user))
        return True
    except Exception:  # noqa: BLE001 - a failed email must not fail the sign-in
        current_app.logger.warning("Welcome email for user %s wasn't sent", user.id, exc_info=True)
        return False


def feedback(user: User, kind: str, message: str, app_version: str | None, device: str | None) -> Email:
    s = _settings()
    label = FEEDBACK_KINDS.get(kind, "Feedback")
    who = user.name or user.email
    sent = datetime.now(IST).strftime("%d %b %Y, %I:%M %p")
    rows = [("From", f"{escape(user.name or '')} &lt;{escape(user.email)}&gt;".strip()), ("App", escape(app_version or "unknown")),
            ("Phone", escape(device or "unknown")), ("Sent", sent)]
    table = "".join(
        f'<tr><td style="padding:4px 16px 0 0;color:#8a8f8b;font-size:13px;">{k}</td><td style="padding-top:4px;font-size:13px;">{v}</td></tr>'
        for k, v in rows
    )
    body = (
        f'<p style="margin:12px 0 0;"><span style="display:inline-block;background:#E9EDFF;color:{BRAND};font-weight:600;'
        f'font-size:13px;padding:4px 12px;border-radius:999px;">{label}</span></p>'
        f'<div style="margin-top:16px;padding:16px;background:#f4f4f2;border-radius:16px;font-size:16px;line-height:24px;'
        f'white-space:pre-wrap;">{escape(message)}</div>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">{table}</table>'
        + _p("Reply to this email to answer them.", muted=True)
    )
    text = (
        f"{label} from {who} <{user.email}>\n\n{message}\n\nApp: {app_version or 'unknown'}\n"
        f"Phone: {device or 'unknown'}\nSent: {sent}\n\nReply to this email to answer them."
    )
    return Email(
        to=s.feedback_to or s.mail_from or "",
        to_name="Finlyt",
        subject=f"Finlyt feedback: {label.lower()} from {who}",
        html=_page(f"{escape(label)} from {escape(who)}", body, "Sent from the Finlyt app's Settings → Send feedback."),
        text=text,
        reply_to=user.email,
        reply_to_name=user.name,
        tags=("feedback", kind),
    )


def send_feedback(user: User, kind: str, message: str, app_version: str | None, device: str | None) -> None:
    mailer = get_mailer()
    if mailer is None:
        raise ApiError(503, "not_configured", "Feedback isn't switched on yet. Try again after the next update.")
    mailer(feedback(user, kind, message, app_version, device))
