"""Ask Finlyt chat history: saved chats, continuing them, per-user scoping and the 10-day cutoff."""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select, update

from finlyt_api.models import AskMessage, AskThread
from finlyt_api.services.ask_history import title_for
from finlyt_api.timeutil import now_utc

from .conftest import FRIEND, build_app, sign_in


class EchoAgent:
    """Answers with the question it got and remembers every conversation it was sent."""

    def __init__(self):
        self.calls: list[list[tuple[str, str]]] = []

    def __call__(self, *, system, messages, tools, call):
        self.calls.append(list(messages))
        return f"Answer to: {messages[-1][1]}", "fake-agent", ["spending_summary", "spending_summary", "people_balances"]


def use_agent(app) -> EchoAgent:
    agent = EchoAgent()
    app.extensions["finlyt.agent"] = agent
    return agent


def age_thread(app, thread_id: int, days: float) -> None:
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        s.execute(update(AskThread).where(AskThread.id == thread_id).values(updated_at=now_utc() - timedelta(days=days)))
        s.commit()
        s.close()


def count(app, model) -> int:
    with app.app_context():
        s = app.extensions["finlyt.sessionmaker"]()
        n = s.scalar(select(func.count()).select_from(model))
        s.close()
    return n


def test_a_question_starts_a_saved_chat_that_can_be_continued(client, me, app):
    agent = use_agent(app)
    first = client.post("/api/ask", json={"text": "How much did I spend on food this month?"})
    assert first.status_code == 200, first.get_json()
    body = first.get_json()
    assert body["reply"] == "Answer to: How much did I spend on food this month?"
    assert body["title"] == "How much did I spend on food this month?"  # 40 characters fit
    assert body["tools_used"] == ["spending_summary", "people_balances"]
    thread_id = body["thread_id"]

    second = client.post("/api/ask", json={"thread_id": thread_id, "text": "aur kal?"}).get_json()
    assert second["thread_id"] == thread_id
    # The server sent the earlier turns along; the app only sent the new question.
    assert agent.calls[1] == [
        ("user", "How much did I spend on food this month?"),
        ("finlyt", "Answer to: How much did I spend on food this month?"),
        ("user", "aur kal?"),
    ]

    threads = client.get("/api/ask/threads").get_json()
    assert threads["keep_days"] == 10
    assert [(t["id"], t["title"], t["preview"]) for t in threads["items"]] == [
        (thread_id, body["title"], "Answer to: aur kal?")
    ]

    chat = client.get(f"/api/ask/threads/{thread_id}").get_json()
    assert [(m["role"], m["text"]) for m in chat["messages"]] == [
        ("user", "How much did I spend on food this month?"),
        ("finlyt", "Answer to: How much did I spend on food this month?"),
        ("user", "aur kal?"),
        ("finlyt", "Answer to: aur kal?"),
    ]
    assert chat["messages"][1]["tools_used"] == ["spending_summary", "people_balances"]
    assert chat["messages"][0]["tools_used"] == []


def test_newest_chat_comes_first(client, me, app):
    use_agent(app)
    older = client.post("/api/ask", json={"text": "Who owes me?"}).get_json()["thread_id"]
    newer = client.post("/api/ask", json={"text": "Kal kitna kharcha hua?"}).get_json()["thread_id"]
    assert [t["id"] for t in client.get("/api/ask/threads").get_json()["items"]] == [newer, older]
    # Asking again in the older chat moves it back to the top.
    client.post("/api/ask", json={"thread_id": older, "text": "And Rahul?"})
    assert [t["id"] for t in client.get("/api/ask/threads").get_json()["items"]] == [older, newer]


def test_chats_are_private(engine):
    application, connection, outer = build_app(engine)
    try:
        use_agent(application)
        client = application.test_client()
        sign_in(client)
        mine = client.post("/api/ask", json={"text": "Who owes me?"}).get_json()["thread_id"]

        sign_in(client, FRIEND)
        assert client.get("/api/ask/threads").get_json()["items"] == []
        assert client.get(f"/api/ask/threads/{mine}").status_code == 404
        assert client.post("/api/ask", json={"thread_id": mine, "text": "hi"}).status_code == 404
        assert client.delete(f"/api/ask/threads/{mine}").status_code == 404
    finally:
        outer.rollback()
        connection.close()


def test_chats_untouched_for_ten_days_are_deleted(client, me, app):
    use_agent(app)
    stale = client.post("/api/ask", json={"text": "October total?"}).get_json()["thread_id"]
    recent = client.post("/api/ask", json={"text": "This week?"}).get_json()["thread_id"]
    age_thread(app, stale, 10.1)
    age_thread(app, recent, 9.9)

    assert [t["id"] for t in client.get("/api/ask/threads").get_json()["items"]] == [recent]
    assert client.get(f"/api/ask/threads/{stale}").status_code == 404
    assert client.post("/api/ask", json={"thread_id": stale, "text": "and?"}).status_code == 404
    assert count(app, AskThread) == 1
    assert count(app, AskMessage) == 2  # the stale chat's messages went with it

    # Continuing a chat resets its clock.
    client.post("/api/ask", json={"thread_id": recent, "text": "and today?"})
    age_thread(app, recent, 9.9)
    assert [t["id"] for t in client.get("/api/ask/threads").get_json()["items"]] == [recent]


def test_keep_days_is_a_setting(engine):
    application, connection, outer = build_app(engine, ask_keep_days=3)
    try:
        use_agent(application)
        client = application.test_client()
        sign_in(client)
        thread_id = client.post("/api/ask", json={"text": "Who owes me?"}).get_json()["thread_id"]
        age_thread(application, thread_id, 4)
        listing = client.get("/api/ask/threads").get_json()
        assert listing == {"items": [], "keep_days": 3}
    finally:
        outer.rollback()
        connection.close()


def test_deleting_a_chat(client, me, app):
    use_agent(app)
    thread_id = client.post("/api/ask", json={"text": "Who owes me?"}).get_json()["thread_id"]
    assert client.delete(f"/api/ask/threads/{thread_id}").status_code == 204
    assert client.get("/api/ask/threads").get_json()["items"] == []
    assert count(app, AskMessage) == 0


def test_a_failed_answer_saves_nothing(client, me, app):
    from finlyt_api.errors import ApiError

    def broken(**_):
        raise ApiError(503, "ai_unavailable", "Finlyt's AI is busy.")

    app.extensions["finlyt.agent"] = broken
    assert client.post("/api/ask", json={"text": "Who owes me?"}).status_code == 503
    assert count(app, AskThread) == 0


def test_older_apps_that_resend_the_chat_still_get_answers(client, me, app):
    agent = use_agent(app)
    resp = client.post("/api/ask", json={"messages": [{"role": "user", "text": "Who owes me?"}]})
    assert resp.status_code == 200
    assert resp.get_json() == {
        "reply": "Answer to: Who owes me?",
        "model": "fake-agent",
        "tools_used": ["spending_summary", "people_balances"],
    }
    assert agent.calls == [[("user", "Who owes me?")]]
    assert count(app, AskThread) == 0


def test_bad_requests(client, me, app):
    use_agent(app)
    assert client.post("/api/ask", json={}).status_code == 422
    assert client.post("/api/ask", json={"text": "   "}).status_code == 422
    both = {"text": "hi", "messages": [{"role": "user", "text": "hi"}]}
    assert client.post("/api/ask", json=both).status_code == 422


def test_titles_are_clipped_at_a_word():
    assert title_for("  Who   owes me? ") == "Who owes me?"
    assert title_for("What were my biggest spends in October and September?") == "What were my biggest spends in October…"
    assert len(title_for("x" * 100)) == 41
