"""Groq takes over when Gemini fails. No network: Groq's HTTP API is mocked."""

from __future__ import annotations

import json

import httpx
import pytest

from finlyt_api.errors import ApiError
from finlyt_api.gemini import (
    FallbackPlanner,
    FallbackProposer,
    GPlanTurn,
    GProposal,
    GroqJson,
)

PROPOSAL = {
    "transcript": "",
    "expenses": [],
    "settlements": [],
    "transfers": [],
    "ignored": [],
    "questions": ["How much was the chai?"],
}
TURN = {
    "reply": "What's your budget for November?",
    "ready": False,
    "monthly_budget": None,
    "daily_limit": None,
    "planned_items": [],
    "summary": "",
}


class FailingGemini:
    def __init__(self, status: int = 503) -> None:
        self.status = status
        self.calls = 0

    def __call__(self, **kwargs):
        self.calls += 1
        raise ApiError(self.status, "gemini_busy", "busy")


class FakeGroq:
    def __init__(self, answer) -> None:
        self.answer = answer
        self.calls: list[dict] = []

    def generate(self, *, system, messages, schema):
        self.calls.append({"system": system, "messages": messages, "schema": schema})
        return schema.model_validate(self.answer), "groq/fake"


def test_groq_takes_over_when_gemini_fails():
    groq = FakeGroq(PROPOSAL)
    proposer = FallbackProposer(FailingGemini(), groq)
    proposal, model = proposer(system="s", prompt="chai", audio=None, audio_mime=None)
    assert model == "groq/fake"
    assert proposal.questions == ["How much was the chai?"]
    assert groq.calls[0]["messages"] == [{"role": "user", "content": "chai"}]


def test_gemini_answers_first_when_it_can():
    class OkGemini:
        def __call__(self, **kwargs):
            return GProposal(**PROPOSAL), "gemini-3.5-flash"

    groq = FakeGroq(PROPOSAL)
    _, model = FallbackProposer(OkGemini(), groq)(system="s", prompt="chai", audio=None, audio_mime=None)
    assert model == "gemini-3.5-flash"
    assert groq.calls == []


def test_voice_notes_cannot_go_to_groq():
    groq = FakeGroq(PROPOSAL)
    with pytest.raises(ApiError) as caught:
        FallbackProposer(FailingGemini(), groq)(system="s", prompt="", audio=b"aac", audio_mime="audio/aac")
    assert caught.value.code == "gemini_busy"
    assert groq.calls == []


def test_groq_alone_when_there_is_no_gemini_key():
    _, model = FallbackProposer(None, FakeGroq(PROPOSAL))(system="s", prompt="chai", audio=None, audio_mime=None)
    assert model == "groq/fake"


def test_planner_maps_roles_for_groq():
    groq = FakeGroq(TURN)
    turn, _ = FallbackPlanner(FailingGemini(), groq)(
        system="s", messages=[("finlyt", "Hi! Budget?"), ("user", "35k")]
    )
    assert turn.reply.startswith("What's your budget")
    assert groq.calls[0]["messages"] == [
        {"role": "user", "content": "(Check-in started.)"},
        {"role": "assistant", "content": "Hi! Budget?"},
        {"role": "user", "content": "35k"},
    ]
    assert groq.calls[0]["schema"] is GPlanTurn


def groq_with(handler) -> GroqJson:
    return GroqJson("test-key", http=httpx.Client(transport=httpx.MockTransport(handler)))


def completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def test_groq_client_sends_schema_and_parses():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return completion(json.dumps(PROPOSAL))

    proposal, model = groq_with(handler).generate(system="sys", messages=[{"role": "user", "content": "chai"}], schema=GProposal)
    assert model == "groq/openai/gpt-oss-120b"
    assert proposal.questions == ["How much was the chai?"]
    assert seen["auth"] == "Bearer test-key"
    assert seen["body"]["response_format"]["type"] == "json_schema"
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}


def test_groq_client_retries_in_json_mode_when_schema_is_rejected():
    formats = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        formats.append(body["response_format"]["type"])
        if body["response_format"]["type"] == "json_schema":
            return httpx.Response(400, json={"error": {"message": "invalid JSON schema for response_format"}})
        assert "JSON Schema" in body["messages"][0]["content"]
        return completion(json.dumps(PROPOSAL))

    groq_with(handler).generate(system="sys", messages=[], schema=GProposal)
    assert formats == ["json_schema", "json_object"]


@pytest.mark.parametrize(("status", "code"), [(429, "groq_busy"), (503, "groq_busy"), (401, "groq_error")])
def test_groq_client_errors(status, code):
    with pytest.raises(ApiError) as caught:
        groq_with(lambda request: httpx.Response(status, json={})).generate(system="s", messages=[], schema=GProposal)
    assert caught.value.code == code


def test_groq_client_rejects_answers_in_the_wrong_shape():
    with pytest.raises(ApiError) as caught:
        groq_with(lambda request: completion('{"not": "a proposal"}')).generate(system="s", messages=[], schema=GProposal)
    assert caught.value.code == "groq_bad_output"


def test_a_model_that_just_failed_goes_to_the_back(monkeypatch):
    from finlyt_api import gemini

    monkeypatch.setattr(gemini, "_cooling", {})
    models = ["a", "b", "c"]
    # The first models get a short time, the last one the full time.
    assert list(gemini.attempts(models)) == [
        ("a", gemini.FIRST_TRIES_MS), ("b", gemini.FIRST_TRIES_MS), ("c", gemini.LAST_TRY_MS)
    ]
    assert [m for m, _ in gemini.attempts(models, heavy=True)][:2] == ["a", "b"]
    assert dict(gemini.attempts(models, heavy=True))["a"] == gemini.FIRST_TRIES_HEAVY_MS

    gemini.cool_down("a")
    assert gemini.model_order(models) == ["b", "c", "a"]  # still tried, last
    gemini.cool_down("b")
    assert gemini.model_order(models) == ["c", "a", "b"]  # the one that failed first recovers first
    gemini.recovered("a")
    assert gemini.model_order(models) == ["a", "c", "b"]


class FakeVisionGroq(FakeGroq):
    def generate(self, *, system, messages, schema, images=None):
        self.calls.append({"system": system, "messages": messages, "schema": schema, "images": images})
        return schema.model_validate(self.answer), "groq/vision"


def test_receipt_photos_go_to_groq_when_gemini_fails():
    groq = FakeVisionGroq(PROPOSAL)
    photo = [(b"\xff\xd8jpeg", "image/jpeg")]
    _, model = FallbackProposer(FailingGemini(), groq)(
        system="s", prompt="The receipt has 1 page.", audio=None, audio_mime=None, images=photo
    )
    assert model == "groq/vision"
    assert groq.calls[0]["images"] == photo


def test_groq_reads_photos_with_its_vision_model():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return completion(json.dumps(PROPOSAL))

    _, model = groq_with(handler).generate(
        system="sys",
        messages=[{"role": "user", "content": "The receipt has 1 page."}],
        schema=GProposal,
        images=[(b"abc", "image/jpeg")],
    )
    assert model == "groq/qwen/qwen3.8-27b"
    body = seen["body"]
    assert body["model"] == "qwen/qwen3.8-27b"
    assert body["messages"][1]["content"] == [
        {"type": "text", "text": "The receipt has 1 page."},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,YWJj"}},
    ]


def test_gemini_hands_over_sooner_only_when_groq_can_help():
    from finlyt_api import gemini

    g = object.__new__(gemini._Gemini)  # no client needed for the budget
    g.handoff = False
    assert g._budget(heavy=False) == gemini.BUDGET_S
    g.handoff = True
    assert g._budget(heavy=False) == gemini.HANDOFF_S
    assert g._budget(heavy=True) == gemini.HANDOFF_HEAVY_S
    assert g._budget(heavy=True, groq_can_help=False) == gemini.BUDGET_S  # voice notes


def test_groq_waits_out_a_short_rate_limit(monkeypatch):
    from finlyt_api import gemini

    waits = []
    monkeypatch.setattr(gemini.time, "sleep", waits.append)
    replies = iter([httpx.Response(429, headers={"retry-after": "2"}, json={}), completion(json.dumps(PROPOSAL))])
    proposal, _ = groq_with(lambda request: next(replies)).generate(system="s", messages=[], schema=GProposal)
    assert waits == [2.0]
    assert proposal.questions == ["How much was the chai?"]


def test_a_long_rate_limit_fails_with_a_clear_message(monkeypatch):
    from finlyt_api import gemini

    monkeypatch.setattr(gemini.time, "sleep", lambda s: pytest.fail("shouldn't wait 50 s"))
    with pytest.raises(ApiError) as caught:
        groq_with(lambda request: httpx.Response(429, headers={"retry-after": "50"}, json={})).generate(
            system="s", messages=[], schema=GProposal
        )
    assert caught.value.code == "groq_busy"
    assert "Try again in a minute" in caught.value.message


def test_an_off_schema_photo_reading_is_reshaped_by_the_text_model():
    models = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        models.append(body["model"])
        if body["model"] == "qwen/qwen3.8-27b":
            return completion(json.dumps({"amount": 462, "shop": "Spice Route"}))
        assert "A vision model read the attached receipt" in body["messages"][1]["content"]
        return completion(json.dumps(PROPOSAL))

    _, model = groq_with(handler).generate(
        system="s", messages=[{"role": "user", "content": "1 page"}], schema=GProposal, images=[(b"x", "image/jpeg")]
    )
    assert models == ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"]
    assert model == "groq/qwen/qwen3.8-27b+openai/gpt-oss-120b"
