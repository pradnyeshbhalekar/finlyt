"""Ask Finlyt: questions about your money, answered by the AI with the read-only data tools."""

from __future__ import annotations

from flask import Blueprint, current_app
from pydantic import Field, model_validator

from ..auth import current_user
from ..db import get_session
from ..gemini import get_agent
from ..schemas import ChatMessageIn, _In
from ..services import ask_history, insights
from ..validation import parse_body

bp = Blueprint("ask", __name__)

ASK_PROMPT = """\
You are Finlyt, the assistant inside my personal expense tracker. Answer my questions about my \
money using the tools: they read my real data (India, rupees, IST). You can only read, not change.

- Be brief: one to four sentences, or a short list. Rupees in Indian style (₹1,200, ₹1.5 lakh). \
No emojis.
- Plain text only, no markdown: no asterisks, hashes or bold. For a list, start each line with "• ".
- Pick the obvious date range for vague questions ("this week", "last month", "kal") and say \
which dates you used.
- Look things up rather than guess. If the data doesn't have it, say so plainly.
- I type the way I talk, Hinglish included; reply in the same style I used.
"""


class AskIn(_In):
    """A new question, in a saved chat (`thread_id`) or starting one.

    Older app builds send the whole conversation as `messages` instead; those chats aren't saved.
    """

    text: str | None = Field(default=None, min_length=1, max_length=2000)
    thread_id: int | None = None
    messages: list[ChatMessageIn] | None = Field(default=None, min_length=1, max_length=40)

    @model_validator(mode="after")
    def _one_shape(self) -> AskIn:
        if (self.text is None) == (self.messages is None):
            raise ValueError("Send text (with thread_id to continue a chat), or messages")
        if self.messages is not None and self.thread_id is not None:
            raise ValueError("thread_id goes with text, not messages")
        return self


def _keep_days() -> int:
    return current_app.config["SETTINGS"].ask_keep_days


def _answer(s, user_id: int, messages: list[tuple[str, str]]) -> tuple[str, str, list[str]]:
    reply, model, used = get_agent()(
        system=f"{ASK_PROMPT}\n{insights.week_hint()}",
        messages=messages,
        tools=insights.TOOLS,
        call=lambda name, args: insights.call(s, user_id, name, args),
    )
    return reply, model, list(dict.fromkeys(used))


@bp.post("/ask")
def ask():
    data = parse_body(AskIn)
    s = get_session()
    user_id = current_user().id
    if data.messages is not None:
        reply, model, used = _answer(s, user_id, [(m.role, m.text) for m in data.messages])
        return {"reply": reply, "model": model, "tools_used": used}

    ask_history.prune(s, user_id, _keep_days())
    thread = ask_history.get_thread(s, user_id, data.thread_id) if data.thread_id is not None else None
    question = data.text or ""
    reply, model, used = _answer(s, user_id, [*ask_history.history(thread), ("user", question)])
    # Saved only once there's an answer, so a failed question leaves no empty chat behind.
    thread = ask_history.add_turn(s, user_id, thread, question, reply, model, used)
    s.commit()
    return {"thread_id": thread.id, "title": thread.title, "reply": reply, "model": model, "tools_used": used}


@bp.get("/ask/threads")
def list_threads():
    s = get_session()
    user_id = current_user().id
    ask_history.prune(s, user_id, _keep_days())
    items = ask_history.list_threads(s, user_id)
    s.commit()
    return {"items": items, "keep_days": _keep_days()}


@bp.get("/ask/threads/<int:thread_id>")
def get_thread(thread_id: int):
    s = get_session()
    user_id = current_user().id
    ask_history.prune(s, user_id, _keep_days())
    s.commit()
    return ask_history.thread_json(ask_history.get_thread(s, user_id, thread_id))


@bp.delete("/ask/threads/<int:thread_id>")
def delete_thread(thread_id: int):
    s = get_session()
    s.delete(ask_history.get_thread(s, current_user().id, thread_id))
    s.commit()
    return "", 204
