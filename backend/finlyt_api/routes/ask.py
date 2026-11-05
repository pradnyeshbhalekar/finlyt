"""Ask Finlyt: questions about your money, answered by the AI with the read-only data tools."""

from __future__ import annotations

from flask import Blueprint
from pydantic import Field

from ..auth import current_user
from ..db import get_session
from ..gemini import get_agent
from ..schemas import ChatMessageIn, _In
from ..services import insights
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
    messages: list[ChatMessageIn] = Field(min_length=1, max_length=40)


@bp.post("/ask")
def ask():
    data = parse_body(AskIn)
    s = get_session()
    user_id = current_user().id
    reply, model, used = get_agent()(
        system=f"{ASK_PROMPT}\n{insights.week_hint()}",
        messages=[(m.role, m.text) for m in data.messages],
        tools=insights.TOOLS,
        call=lambda name, args: insights.call(s, user_id, name, args),
    )
    return {"reply": reply, "model": model, "tools_used": used}
