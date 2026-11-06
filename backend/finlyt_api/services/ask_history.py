"""Ask Finlyt chat history: threads of questions and answers, kept for ASK_KEEP_DAYS.

A chat that hasn't been touched for that long is deleted the next time any Ask route runs, so
there's no cron to set up. Continuing an old chat resets its clock.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import AskMessage, AskThread
from ..timeutil import now_utc, to_ist_iso

TITLE_CHARS = 40
PREVIEW_CHARS = 140
# Earlier turns sent back to the model with a new question (the newest ones).
HISTORY_TURNS = 30
LIST_LIMIT = 100


def prune(s: Session, user_id: int, keep_days: int) -> None:
    cutoff = now_utc() - timedelta(days=keep_days)
    s.execute(delete(AskThread).where(AskThread.user_id == user_id, AskThread.updated_at < cutoff))


def get_thread(s: Session, user_id: int, thread_id: int) -> AskThread:
    thread = s.get(AskThread, thread_id)
    if thread is None or thread.user_id != user_id:
        raise ApiError(404, "not_found", "That chat isn't there any more.")
    return thread


def history(thread: AskThread | None) -> list[tuple[str, str]]:
    if thread is None:
        return []
    return [(m.role, m.text) for m in thread.messages[-HISTORY_TURNS:]]


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0] if " " in text[:limit] else text[:limit]
    return cut.rstrip(" ,.;:?!") + "…"


def title_for(question: str) -> str:
    return _clip(question, TITLE_CHARS)


def add_turn(
    s: Session,
    user_id: int,
    thread: AskThread | None,
    question: str,
    reply: str,
    model: str | None,
    tools_used: list[str],
    options: list[str] | None = None,
    extras: dict | None = None,
) -> AskThread:
    """Store a question and its answer, starting a new chat if there's no thread yet."""
    now = now_utc()
    if thread is None:
        thread = AskThread(user_id=user_id, title=title_for(question), created_at=now)
        s.add(thread)
    thread.updated_at = now
    thread.messages.append(AskMessage(role="user", text=question, created_at=now))
    thread.messages.append(
        AskMessage(role="finlyt", text=reply, model=model, tools_used=tools_used, options=options or [], extras=extras or {}, created_at=now)
    )
    s.flush()
    return thread


def list_threads(s: Session, user_id: int) -> list[dict[str, Any]]:
    last_text = (
        select(AskMessage.text)
        .where(AskMessage.thread_id == AskThread.id)
        .order_by(AskMessage.id.desc())
        .limit(1)
        .scalar_subquery()
    )
    rows = s.execute(
        select(AskThread, last_text)
        .where(AskThread.user_id == user_id)
        .order_by(AskThread.updated_at.desc(), AskThread.id.desc())
        .limit(LIST_LIMIT)
    ).all()
    return [
        {
            "id": t.id,
            "title": t.title,
            "updated_at": to_ist_iso(t.updated_at),
            "preview": _clip(preview or "", PREVIEW_CHARS),
        }
        for t, preview in rows
    ]


def message_json(m: AskMessage) -> dict[str, Any]:
    return {
        "id": m.id,
        "role": m.role,
        "text": m.text,
        "tools_used": list(m.tools_used or []),
        "options": list(m.options or []),
        "report": (m.extras or {}).get("report"),
        "followups": (m.extras or {}).get("followups", []),
        "memory_updates": (m.extras or {}).get("memory_updates", []),
        "created_at": to_ist_iso(m.created_at),
    }


def thread_json(t: AskThread) -> dict[str, Any]:
    return {
        "id": t.id,
        "title": t.title,
        "created_at": to_ist_iso(t.created_at),
        "updated_at": to_ist_iso(t.updated_at),
        "messages": [message_json(m) for m in t.messages],
    }
