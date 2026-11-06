from __future__ import annotations

import os
from dataclasses import dataclass


def normalize_db_url(url: str | None) -> str | None:
    """Neon hands out postgresql:// URLs; SQLAlchemy needs the psycopg (v3) driver name."""
    if not url:
        return None
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _split_emails(raw: str | None) -> frozenset[str]:
    return frozenset(part.strip().lower() for part in (raw or "").split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    database_url: str | None = None
    google_web_client_id: str | None = None
    allowed_emails: frozenset[str] = frozenset()
    gemini_api_key: str | None = None
    gemini_model: str | None = None
    groq_api_key: str | None = None
    groq_model: str | None = None
    # Ask Finlyt chats not touched for this many days are deleted.
    ask_keep_days: int = 10
    serverless: bool = False

    @classmethod
    def from_env(cls) -> Settings:
        env = os.environ.get
        return cls(
            database_url=normalize_db_url(env("DATABASE_URL")),
            google_web_client_id=env("GOOGLE_WEB_CLIENT_ID") or None,
            allowed_emails=_split_emails(env("ALLOWED_EMAILS")),
            gemini_api_key=env("GEMINI_API_KEY") or None,
            gemini_model=env("GEMINI_MODEL") or None,
            groq_api_key=env("GROQ_API_KEY") or None,
            groq_model=env("GROQ_MODEL") or None,
            ask_keep_days=int(env("ASK_KEEP_DAYS") or 10),
            # Vercel sets VERCEL=1 in deployments.
            serverless=bool(env("VERCEL")),
        )

    def email_allowed(self, email: str) -> bool:
        return "*" in self.allowed_emails or email.lower() in self.allowed_emails
