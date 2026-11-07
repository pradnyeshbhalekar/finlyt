"""Ask Finlyt: questions about your money, answered by the AI with the data tools.

It reads my data (and never changes expenses), can show a month report as a dashboard, asks
back when a question is unclear, and remembers what I tell it about my money (income,
commitments, notes) with the memory tools.
"""

from __future__ import annotations

from flask import Blueprint, current_app
from pydantic import Field, model_validator

from ..auth import current_user
from ..db import get_session
from ..gemini import FinishTurn, get_agent
from ..money import to_paise
from ..schemas import ChatMessageIn, _In
from ..services import ask_history, insights, memory, reports
from ..validation import parse_body

bp = Blueprint("ask", __name__)

ASK_PROMPT = """\
You are Finlyt, the assistant inside my personal expense tracker, like a friend who's good with \
money. Answer my questions about my money using the tools: they read my real data (India, \
rupees, IST). You never change my expenses, but you do remember what I tell you about my money.

How to answer:
- Be brief: one to four sentences, or a short list. Rupees in Indian style (₹1,200, ₹1.5 lakh), \
whole rupees for averages. Never write a negative amount like ₹-690: say "₹690 over" or "₹690 \
short" instead. No emojis.
- Plain text only, no markdown: no asterisks, hashes or bold. For a list, start each line with "• ".
- Pick the obvious date range for vague questions ("this week", "last month", "kal") and say \
which dates you used.
- Look things up rather than guess. If the data doesn't have it, say so plainly.
- Reply in the language of my latest message: English if I wrote English, Hinglish only if I \
wrote Hinglish.
- If my question is unclear in a way that changes the answer (which month, which person, \
spending or money owed), call ask_user with one short question and 2 to 4 likely answers, \
instead of guessing. Don't ask when the obvious reading is fine. Never make up amounts in options.

Reports:
- "Where did my money go", a monthly report, a dashboard, or how a month went: call month_report \
with show true. The app shows the full dashboard under your reply, so keep the reply to two or \
three sentences: the total, where most of it went, and the one thing most worth noticing (more \
than usual, payments from bank SMS not logged yet, money owed to me).
- "Is that more than usual?": compare with my usual and with last month at the same point, from \
month_report (show false), category by category where it matters.
- "Anything else I'm missing?": bank payments not logged yet, money owed either way, regular \
payments coming up, commitments, planned items, and unusual one-off spends.

Earning, saving and planning:
- For "am I spending more than I earn" or "how much should I save", use my monthly income from \
memory, and money_in_and_out (income there is only bank credits I marked as income). If you \
don't know my income, ask for it with ask_user (no amounts in options), then remember it.
- Commitments (like money I give family every month, or an EMI) come out of income first, like rent.
- A good aim is saving at least 20% of take-home pay after commitments, and building an \
emergency fund of 3 to 6 months of spending. Say what my numbers mean against that, and give one \
or two concrete ways to save more from what I actually spend on. It's general guidance, not \
financial advice; say so once if I ask about investing.
- When my income changes, my commitments follow their rules (the memory tools apply them). Then \
always spell out what changed, with numbers from memory: the commitments, what's left after \
commitments before and after, and the new saving target. If the raise all went to commitments, \
say so plainly and suggest how saving can still grow (trimming my biggest categories). Use the \
numbers worked out in memory; don't do your own arithmetic when they're there.

Memory:
- When I tell you something lasting about my money, save it: remember_income for my monthly \
take-home income (and any change to it), remember_commitment for money I've promised every month \
(with the total if it's paying something off, what's already paid, and income rules like "₹6,000 \
once my salary is ₹55,000"), remember_note for anything else useful later. Then say in a few \
words what you saved and what it changes.
- When I say I want to save up for something, call save_goal. My goals are in memory below: say \
how I'm doing against them, and what a month it takes to reach them, when it helps.
- Don't save one-off spends; those are logged on Home.
"""


# Not a data tool: it ends the turn with a question back to me and answers I can tap.
ASK_USER = insights.Tool(
    name="ask_user",
    description=(
        "Ask me one short clarifying question when my question is unclear in a way that changes "
        "the answer. Give 2-4 likely answers I can tap (I can also type my own, so no 'Other')."
    ),
    input_schema={
        "type": "object",
        "properties": {
            "question": {"type": "string", "description": "One short question"},
            "options": {"type": "array", "items": {"type": "string"}, "description": "2-4 short answers, most likely first"},
        },
        "required": ["question", "options"],
    },
    run=lambda s, user_id, args: {},
)


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


_RULES = {
    "type": "array",
    "description": "How the monthly amount changes with my income",
    "items": {
        "type": "object",
        "properties": {
            "when_income_at_least_rupees": {"type": "number"},
            "monthly_rupees": {"type": "number"},
        },
        "required": ["when_income_at_least_rupees", "monthly_rupees"],
    },
}

MEMORY_TOOLS = [
    insights.Tool(
        name="remember_income",
        description="Save my monthly take-home income (salary). Commitments with income rules update to match.",
        input_schema={
            "type": "object",
            "properties": {
                "monthly_rupees": {"type": "number"},
                "note": {"type": "string", "description": "e.g. 'salary, credited on the 1st'"},
            },
            "required": ["monthly_rupees"],
        },
        run=lambda s, user_id, args: {},
    ),
    insights.Tool(
        name="remember_commitment",
        description=(
            "Save or change money I've promised every month, e.g. ₹3,000 to my sister for a ₹24,000 laptop. "
            "The same title updates the existing one."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short, e.g. 'Sister, for the laptop'"},
                "monthly_rupees": {"type": "number", "description": "What I give now"},
                "category": {"type": "string", "description": "One of my category names"},
                "total_rupees": {"type": "number", "description": "If it's paying something off: the whole amount"},
                "already_paid_rupees": {"type": "number", "description": "Paid before I told you"},
                "rules": _RULES,
                "match_words": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Words that appear when I log paying it, e.g. ['sister', 'didi']",
                },
                "notes": {"type": "string"},
            },
            "required": ["title", "monthly_rupees"],
        },
        run=lambda s, user_id, args: {},
    ),
    insights.Tool(
        name="save_goal",
        description=(
            "Start a savings goal, or change the one with the same name: what it's for, how much, and by when. "
            "E.g. ₹15,000 for a Goa trip by December."
        ),
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Short, e.g. 'Goa trip'"},
                "target_rupees": {"type": "number"},
                "by_date": {"type": "string", "description": "YYYY-MM-DD, or leave out"},
            },
            "required": ["name", "target_rupees"],
        },
        run=lambda s, user_id, args: {},
    ),
    insights.Tool(
        name="remember_note",
        description="Remember something else useful about my money for later.",
        input_schema={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        run=lambda s, user_id, args: {},
    ),
]

def _save_goal(s, user_id: int, args: dict) -> dict:
    from datetime import date

    from ..money import rupees
    from ..services import goals

    name = str(args.get("name") or "").strip()[:80] or "Savings"
    target = to_paise(args.get("target_rupees") or 0)
    if target <= 0:
        return {"kind": "note", "text": "A goal needs an amount"}
    due = None
    if args.get("by_date"):
        try:
            due = date.fromisoformat(str(args["by_date"])[:10])
        except ValueError:
            due = None
    g = goals.find_goal(s, user_id, name)
    if g is None:
        g = goals.create_goal(s, user_id, name, target, due)
        verb = "Started a goal"
    else:
        g.target_paise, verb = target, "Updated the goal"
        if due:
            g.due_on = due
        s.flush()
    when = f" by {g.due_on.strftime('%d %b')}" if g.due_on else ""
    return {"kind": "note", "text": f"{verb}: {g.name}, {rupees(g.target_paise)}{when}"}


FOLLOWUPS = ["Is that more than usual?", "Anything else I'm missing?", "How much should I save?"]


def _keep_days() -> int:
    return current_app.config["SETTINGS"].ask_keep_days


class Answer:
    def __init__(self) -> None:
        self.options: list[str] = []
        self.report: dict | None = None
        self.memory: list[dict] = []

    def remember(self, updates) -> None:
        for u in updates:
            item = u.json() if hasattr(u, "json") else u
            if item["kind"] == "income":
                self.memory = [m for m in self.memory if m["kind"] != "income"]
            if item not in self.memory:
                self.memory.append(item)

    def extras(self) -> dict:
        out: dict = {}
        if self.report is not None:
            out["report"] = self.report
            out["followups"] = FOLLOWUPS
        if self.memory:
            out["memory_updates"] = self.memory
        return out


NOT_DATA = {ASK_USER.name, *(t.name for t in MEMORY_TOOLS)}


def _answer(s, user_id: int, messages: list[tuple[str, str]]) -> tuple[str, str, list[str], Answer]:
    """The reply, the model, the data tools it used, and what comes with it (answers to tap, a
    report to show, what it remembered)."""
    got = Answer()

    def call(name: str, args: dict) -> dict:
        if name == ASK_USER.name:
            question = str(args.get("question") or "").strip()
            raw = args.get("options") or []
            got.options.extend(o.strip()[:60] for o in raw if isinstance(o, str) and o.strip())
            raise FinishTurn(question or "Could you say a bit more?")
        if name == "remember_income":
            updates = memory.set_income(s, user_id, to_paise(args.get("monthly_rupees") or 0), args.get("note"))
            got.remember(updates)
            return {"saved": [u.text for u in updates] or ["Nothing changed"]}
        if name == "remember_commitment":
            update = memory.apply_rupees_commitment(s, user_id, args)
            if update:
                got.remember([update])
            return {"saved": update.text if update else "Nothing changed"}
        if name == "save_goal":
            update = _save_goal(s, user_id, args)
            got.remember([update])
            return {"saved": update["text"]}
        if name == "remember_note":
            update = memory.add_note(s, user_id, str(args.get("text") or ""))
            got.remember([update])
            return {"saved": update.text}
        if name == "month_report":
            report = reports.month_report(s, user_id, reports.parse_month(args.get("month")))
            if args.get("show"):
                got.report = report
            return reports.for_model(report)
        return insights.call(s, user_id, name, args)

    system = f"{ASK_PROMPT}\n{memory.context(s, user_id)}\n{insights.week_hint()}"
    reply, model, used = get_agent()(
        system=system,
        messages=messages,
        tools=[*insights.TOOLS, ASK_USER, *MEMORY_TOOLS],
        call=call,
    )
    tools = [t for t in dict.fromkeys(used) if t not in NOT_DATA]
    got.options = got.options[:4]
    return reply, model, tools, got


@bp.post("/ask")
def ask():
    data = parse_body(AskIn)
    s = get_session()
    user_id = current_user().id
    if data.messages is not None:
        reply, model, used, _ = _answer(s, user_id, [(m.role, m.text) for m in data.messages])
        s.commit()  # anything it remembered
        return {"reply": reply, "model": model, "tools_used": used}

    ask_history.prune(s, user_id, _keep_days())
    thread = ask_history.get_thread(s, user_id, data.thread_id) if data.thread_id is not None else None
    question = data.text or ""
    reply, model, used, got = _answer(s, user_id, [*ask_history.history(thread), ("user", question)])
    # Saved only once there's an answer, so a failed question leaves no empty chat behind.
    extras = got.extras()
    thread = ask_history.add_turn(s, user_id, thread, question, reply, model, used, got.options, extras)
    s.commit()
    return {
        "thread_id": thread.id,
        "title": thread.title,
        "reply": reply,
        "options": got.options,
        "report": extras.get("report"),
        "followups": extras.get("followups", []),
        "memory_updates": extras.get("memory_updates", []),
        "model": model,
        "tools_used": used,
    }


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
