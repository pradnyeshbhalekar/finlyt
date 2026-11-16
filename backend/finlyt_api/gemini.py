"""Gemini (with Groq as the fallback): turns a voice note and/or typed text into a structured
spending proposal, and runs the Sunday check-in chat.

Gemini answers in rupees with names and transaction labels (T1, T2…). The proposal
service maps that onto ids and paise and checks the money adds up; nothing here touches
the database.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Callable, Iterator, Protocol

import httpx

from flask import current_app
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .config import Settings
from .errors import ApiError

log = logging.getLogger(__name__)

# Tried in order until one answers; GEMINI_MODEL overrides this with a comma-separated list.
# Each model has its own free-tier daily quota. On 2026-11-05 the Flash models allowed only 20
# requests a day (a 429 said "limit: 20"), so the Flash-Lite models (about 500 a day) come after
# them, and Groq after all of these (see FallbackProposer). Since 2026-11-16 the stable
# gemini-2.5-flash goes first: the 3.x previews were taking 26–40 s or refusing ("high demand")
# while it answered in about a second. A 429 costs well under a second, so a used-up quota
# just moves things along (and that model cools down; see attempts()).
DEFAULT_MODELS = (
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
)
# Overloaded or rate-limited: worth trying the next model. Anything else is our problem.
FALLBACK_CODES = {429, 500, 503, 504}

# How long a model gets before we move on to the next. A healthy Flash model reads a note in
# 1–8 s. On 2026-11-16 gemini-3.5-flash took 26 s to say "ok" and 40 s to fail, and 3.8-flash
# was "high demand", so every log and Ask took ~80 s before gemini-2.5-flash answered in 1 s.
# The last model in line gets the full time; the whole request stays under Vercel's 120 s.
FIRST_TRIES_MS = 15_000
FIRST_TRIES_HEAVY_MS = 30_000  # voice notes, receipt photos, long imported chats
LAST_TRY_MS = 40_000
BUDGET_S = 95
# When Groq is set up and can take the request, Gemini gets less time before Groq answers
# (usually in 1–2 s). Voice notes can't go to Groq, so they keep the full budget.
HANDOFF_S = 20
HANDOFF_HEAVY_S = 45

# A model that just failed or timed out goes to the back of the line for a while, so the next
# requests (on this server instance) start with one that's answering.
COOLDOWN_S = 600
_cooling: dict[str, float] = {}


def model_order(models: list[str]) -> list[str]:
    """Models in their configured order, except those cooling down after a failure go last
    (soonest-recovered first), so they're still tried if nothing else answers."""
    now = time.monotonic()
    ready = [m for m in models if _cooling.get(m, 0.0) <= now]
    cooling = sorted((m for m in models if _cooling.get(m, 0.0) > now), key=lambda m: _cooling[m])
    return ready + cooling


def cool_down(model: str) -> None:
    _cooling[model] = time.monotonic() + COOLDOWN_S


def recovered(model: str) -> None:
    _cooling.pop(model, None)


def attempts(models: list[str], *, heavy: bool = False, budget_s: float = BUDGET_S) -> Iterator[tuple[str, int]]:
    """Each model to try, best bet first, with its time limit in ms, within the request budget."""
    order = model_order(models)
    start = time.monotonic()
    for i, model in enumerate(order):
        left_ms = int((budget_s - (time.monotonic() - start)) * 1000)
        if left_ms < 5_000:
            return
        limit = LAST_TRY_MS if i == len(order) - 1 else (FIRST_TRIES_HEAVY_MS if heavy else FIRST_TRIES_MS)
        yield model, min(limit, left_ms)


class GPayment(BaseModel):
    source: str = Field(
        description='A transaction label such as "T1" when the money left in that transaction, '
        "otherwise the name of one of my accounts, e.g. Cash"
    )
    amount: float = Field(description="Rupees")


class GOwed(BaseModel):
    person: str
    amount: float = Field(description="Rupees")


class GExpense(BaseModel):
    description: str = Field(description="Short and specific, e.g. 'Lunch at Zomato with Rahul'")
    category: str = Field(description="Exactly one of my category names")
    time: str | None = Field(description='"YYYY-MM-DD HH:MM" in IST, or null if unknown')
    total: float = Field(description="Full amount paid, rupees. Equals the sum of payments")
    my_share: float = Field(description="My part of the total, rupees")
    payments: list[GPayment]
    owed_by: list[GOwed] = Field(description="Who owes me part of this, and how much")


class GSettlement(BaseModel):
    person: str
    amount: float = Field(description="Rupees")
    txn: str | None = Field(description="The credit transaction label it came in as, or null for cash")


class GOwe(BaseModel):
    person: str = Field(description="Who paid for me")
    amount: float = Field(description="Rupees I owe them")
    description: str = Field(description="What it was for, e.g. 'Movie ticket'")
    category: str = Field(description="Exactly one of my category names")


class GRepay(BaseModel):
    person: str = Field(description="Whom I paid back")
    amount: float = Field(description="Rupees")
    txn: str | None = Field(description="The debit transaction label it went out as, or null for cash")


class GTxnNote(BaseModel):
    txn: str = Field(description='Transaction label, e.g. "T2"')
    reason: str


class GProposal(BaseModel):
    transcript: str = Field(description="The voice note word for word; empty if there is none")
    expenses: list[GExpense]
    settlements: list[GSettlement] = Field(description="People paying me back")
    transfers: list[GTxnNote] = Field(
        description="Transactions that move money between my own accounts, or ATM withdrawals"
    )
    ignored: list[GTxnNote] = Field(description="Transactions I asked to skip")
    questions: list[str] = Field(description="Short questions about anything genuinely unclear")
    i_owe: list[GOwe] = Field(default_factory=list, description="Money I owe others because they paid for me")
    repaid: list[GRepay] = Field(default_factory=list, description="Me paying someone back what I owed them")


# A photo sent with a note: (bytes, mime type), e.g. a scanned receipt as image/jpeg.
Image = tuple[bytes, str]


class Proposer(Protocol):
    def __call__(
        self,
        *,
        system: str,
        prompt: str,
        audio: bytes | None,
        audio_mime: str | None,
        images: list[Image] | None = None,
    ) -> tuple[GProposal, str]:
        """Returns the proposal and the model that wrote it. `images` are only passed when there
        are some, so fakes written before receipts don't need the argument."""
        ...


# ── Sunday check-in planning ────────────────────────────────────────────────


class GPlannedItem(BaseModel):
    description: str = Field(description="Short, e.g. 'Rent', 'Pune trip'")
    amount: float = Field(description="Rupees")
    date: str | None = Field(description='"YYYY-MM-DD" if known, else null')
    category: str = Field(description="Exactly one of my category names")


def _all_required(schema: dict) -> None:
    """Ask the model for every field, while parsing stays lenient about the newer ones."""
    schema["required"] = list(schema.get("properties", {}))


class GIncomeRule(BaseModel):
    when_income_at_least: float = Field(description="Rupees a month")
    monthly: float = Field(description="Rupees a month from then on")


class GCommitment(BaseModel):
    """Money promised every month, e.g. ₹3,000 to my sister for a ₹24,000 laptop."""

    title: str = Field(description="Short, e.g. 'Sister, for the laptop'")
    monthly: float = Field(description="Rupees a month now")
    category: str | None = Field(default=None, description="One of my category names")
    total: float | None = Field(default=None, description="If it pays something off: the whole amount")
    already_paid: float | None = Field(default=None, description="Paid before I told you")
    rules: list[GIncomeRule] = Field(default_factory=list, description="How the amount changes with my income")
    match_words: list[str] = Field(default_factory=list, description="Words that show up when I log paying it")
    notes: str | None = None


class GPlanTurn(BaseModel):
    model_config = ConfigDict(json_schema_extra=_all_required)

    reply: str = Field(description="What Finlyt says next: one to three short sentences")
    options: list[str] = Field(
        default_factory=list,
        description="If the reply asks me something: 2-4 short answers I could tap, most likely first. Else empty.",
    )
    ready: bool = Field(description="True once a plan can be shown for me to confirm")
    monthly_budget: float | None = Field(description="This month's budget in rupees, if known")
    daily_limit: float | None = Field(description="Usual-day limit in rupees, if worked out")
    big_day_limit: float | None = Field(default=None, description="Bigger-day limit in rupees, or null for one flat limit")
    big_days_per_week: int | None = Field(default=None, description="How many bigger days a week (0-6), or null")
    planned_items: list[GPlannedItem] = Field(description="Every planned item for this month")
    summary: str = Field(description="One line summing up the plan, for later")
    remember_income: float | None = Field(
        default=None, description="My monthly take-home income in rupees, only if my latest message says it"
    )
    remember_commitments: list[GCommitment] = Field(
        default_factory=list, description="Monthly commitments my latest message tells you about or changes; else empty"
    )
    remember_notes: list[str] = Field(
        default_factory=list, description="Other lasting facts about my money from my latest message; else empty"
    )


class Planner(Protocol):
    def __call__(self, *, system: str, messages: list[tuple[str, str]]) -> tuple[GPlanTurn, str]:
        """`messages` are (role, text) with role "user" or "finlyt". Returns the turn and model."""
        ...


class _Gemini:
    """Shared client: tries each model in turn and parses JSON into a Pydantic model."""

    def __init__(self, settings: Settings) -> None:
        from google import genai
        from google.genai import types

        # No retries on the same model: when one is busy it's faster to move to the next.
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            http_options=types.HttpOptions(
                timeout=40_000, retry_options=types.HttpRetryOptions(attempts=1)
            ),
        )
        configured = [m.strip() for m in (settings.gemini_model or "").split(",") if m.strip()]
        self.models = configured or list(DEFAULT_MODELS)
        # Set by get_*() when Groq is there to take over: then Gemini hands over sooner.
        self.handoff = False

    def _budget(self, *, heavy: bool, groq_can_help: bool = True) -> float:
        if self.handoff and groq_can_help:
            return HANDOFF_HEAVY_S if heavy else HANDOFF_S
        return BUDGET_S

    def _generate(
        self, *, system: str, contents, schema: type[BaseModel], heavy: bool = False, groq_can_help: bool = True
    ):
        from google.genai import errors, types

        def config_for(model: str, limit_ms: int) -> types.GenerateContentConfig:
            # Gemini 3 models take a thinking level; 2.5 uses a token budget instead.
            thinking = (
                types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
                if model.startswith("gemini-3")
                else types.ThinkingConfig(thinking_budget=1024)
            )
            return types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=schema.model_json_schema(),
                thinking_config=thinking,
                http_options=types.HttpOptions(timeout=limit_ms),
            )

        last_code: int | None = None
        budget_s = self._budget(heavy=heavy, groq_can_help=groq_can_help)
        for model, limit_ms in attempts(self.models, heavy=heavy, budget_s=budget_s):
            try:
                response = self._client.models.generate_content(
                    model=model, contents=contents, config=config_for(model, limit_ms)
                )
            except errors.APIError as e:
                log.warning("Gemini %s failed: %s %s", model, e.code, e.message)
                last_code = e.code
                if e.code in FALLBACK_CODES:
                    cool_down(model)
                    continue
                raise ApiError(
                    502, "gemini_error", f"Gemini couldn't process this ({e.code}). Try again."
                ) from e
            except httpx.TransportError as e:  # our own timeout, or the network dropped
                log.warning("Gemini %s didn't answer in %d ms: %s", model, limit_ms, e)
                last_code = 504
                cool_down(model)
                continue
            recovered(model)
            try:
                return schema.model_validate_json(response.text or ""), model
            except ValidationError as e:
                log.warning("Gemini %s returned an unexpected shape: %s", model, e)
                raise ApiError(
                    502, "gemini_bad_output", "Gemini's answer wasn't in the expected shape. Try again."
                ) from e
        raise ApiError(
            503, "gemini_busy", f"Gemini is busy right now ({last_code}). Try again in a minute."
        )


class GeminiProposer(_Gemini):
    def __call__(
        self,
        *,
        system: str,
        prompt: str,
        audio: bytes | None,
        audio_mime: str | None,
        images: list[Image] | None = None,
    ) -> tuple[GProposal, str]:
        from google.genai import types

        parts = []
        for data, mime in images or []:
            parts.append(types.Part.from_bytes(data=data, mime_type=mime))
        if audio:
            parts.append(types.Part.from_bytes(data=audio, mime_type=audio_mime or "audio/aac"))
        parts.append(types.Part.from_text(text=prompt))
        return self._generate(
            system=system, contents=parts, schema=GProposal, heavy=bool(audio or images), groq_can_help=not audio
        )


class GeminiPlanner(_Gemini):
    def __call__(self, *, system: str, messages: list[tuple[str, str]]) -> tuple[GPlanTurn, str]:
        from google.genai import types

        contents = [
            types.Content(
                role="model" if role == "finlyt" else "user", parts=[types.Part.from_text(text=text)]
            )
            for role, text in messages
        ]
        if not contents or contents[0].role != "user":
            contents.insert(
                0, types.Content(role="user", parts=[types.Part.from_text(text="(Check-in started.)")])
            )
        return self._generate(system=system, contents=contents, schema=GPlanTurn)


# ── Groq: the fallback when Gemini is busy, rate-limited or down ─────────────

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b"
# Reads receipt photos. On 2026-11-16 this account had no Llama 4 vision models; Qwen read a test
# receipt (grand total, date, cash, items) in 1.2 s with the JSON schema.
DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.8-27b"
GROQ_MAX_WAIT_S = 6
# Groq takes base64 images up to 4 MB per request.
MAX_GROQ_IMAGE_B64 = 4 * 1024 * 1024 - 64 * 1024


class GroqJson:
    """Groq's OpenAI-compatible chat API with structured JSON output, checked with Pydantic.

    Text, and photos (receipts) through a vision model; not audio (its Whisper refuses the AAC
    voice notes the app records). Asks for a JSON-schema response first; if Groq rejects the
    schema, retries in plain JSON mode with the schema written into the instructions.
    """

    def __init__(
        self,
        api_key: str,
        model: str | None = None,
        http: httpx.Client | None = None,
        vision_model: str | None = None,
    ) -> None:
        self.api_key = api_key
        self.model = model or DEFAULT_GROQ_MODEL
        self.vision_model = vision_model or DEFAULT_GROQ_VISION_MODEL
        self._http = http or httpx.Client(timeout=30)

    @staticmethod
    def _with_images(messages: list[dict], images: list[Image]) -> list[dict]:
        """The images go into the last user message, as data URLs, after its text."""
        parts = []
        size = 0
        for data, mime in images:
            encoded = base64.b64encode(data).decode()
            size += len(encoded)
            parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}})
        if size > MAX_GROQ_IMAGE_B64:
            raise ApiError(413, "groq_image_too_big", "That receipt is too big for the backup reader. Scan it again.")
        out = [dict(m) for m in messages] or [{"role": "user", "content": ""}]
        last = out[-1]
        text = last.get("content") or ""
        last["content"] = [{"type": "text", "text": text}, *parts] if text else parts
        return out

    def _post(self, body: dict) -> httpx.Response:
        try:
            response = self._http.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
        except httpx.HTTPError as e:
            log.warning("Groq unreachable: %s", e)
            raise ApiError(503, "groq_unreachable", "Groq couldn't be reached. Try again.") from e
        # Free-tier limits are per minute (8,000 tokens for the vision model in Nov 2026). A short
        # wait is worth it; a long one isn't, so that fails with a clear message instead.
        if response.status_code == 429:
            try:
                wait = float(response.headers.get("retry-after", ""))
            except ValueError:
                wait = None
            if wait is not None and wait <= GROQ_MAX_WAIT_S:
                log.warning("Groq %s rate-limited; retrying in %.1f s", body.get("model"), wait)
                time.sleep(wait)
                try:
                    response = self._http.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
                except httpx.HTTPError as e:
                    raise ApiError(503, "groq_unreachable", "Groq couldn't be reached. Try again.") from e
        return response

    def generate(self, *, system: str, messages: list[dict], schema: type[BaseModel], images: list[Image] | None = None):
        schema_json = schema.model_json_schema()
        model = self.vision_model if images else self.model
        if images:
            messages = self._with_images(messages, images)
        body = {
            "model": model,
            "temperature": 0.2,
            "messages": [{"role": "system", "content": system}, *messages],
            "response_format": {"type": "json_schema", "json_schema": {"name": schema.__name__, "schema": schema_json}},
        }
        response = self._post(body)
        if response.status_code == 400 and "schema" in response.text.lower():
            # Schema not accepted: plain JSON mode, with the schema spelled out.
            body["response_format"] = {"type": "json_object"}
            body["messages"][0] = {
                "role": "system",
                "content": f"{system}\n\nReply with only a JSON object matching this JSON Schema:\n{json.dumps(schema_json)}",
            }
            response = self._post(body)
        self._check(response, model)
        try:
            content = response.json()["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError) as e:
            raise ApiError(502, "groq_bad_output", "Groq's answer wasn't readable. Try again.") from e
        try:
            return schema.model_validate_json(content), f"groq/{model}"
        except ValidationError as e:
            if images and content.strip():
                # The vision model read the photo but doesn't always keep to the schema (on
                # 2026-11-16 it once answered {"amount": 462, ...}). The text model does: let it
                # put what was read into the right shape.
                log.warning("Groq %s read the photo off-schema; reshaping with %s", model, self.model)
                read = f"A vision model read the attached receipt and wrote this:\n{content}"
                text = next((m.get("content") for m in reversed(messages) if m.get("role") == "user"), "")
                if isinstance(text, list):
                    text = " ".join(p.get("text", "") for p in text if isinstance(p, dict))
                parsed, _ = self.generate(
                    system=system, messages=[{"role": "user", "content": f"{text}\n\n{read}"}], schema=schema
                )
                return parsed, f"groq/{model}+{self.model}"
            log.warning("Groq %s returned an unexpected shape: %s", model, e)
            raise ApiError(502, "groq_bad_output", "Groq's answer wasn't in the expected shape. Try again.") from e

    def _check(self, response: httpx.Response, model: str | None = None) -> None:
        model = model or self.model
        if response.status_code in FALLBACK_CODES:
            log.warning("Groq %s busy: %s %s", model, response.status_code, response.text[:300])
            raise ApiError(
                503,
                "groq_busy",
                f"Gemini and the backup (Groq) are both busy right now ({response.status_code}). Try again in a minute.",
            )
        if response.status_code >= 400:
            log.warning("Groq %s failed: %s %s", model, response.status_code, response.text[:300])
            raise ApiError(502, "groq_error", f"Groq couldn't process this ({response.status_code}).")


    def agent(self, *, system: str, messages: list[dict], tools: list, call) -> tuple[str, str, list[str]]:
        """OpenAI-style tool calling on Groq."""
        spec = [
            {"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}}
            for t in tools
        ]
        chat = [{"role": "system", "content": system}, *messages]
        used: list[str] = []
        try:
            return self._agent_rounds(chat, spec, call, used)
        except FinishTurn as done:
            return done.reply, f"groq/{self.model}", used

    def _agent_rounds(self, chat: list[dict], spec: list[dict], call, used: list[str]) -> tuple[str, str, list[str]]:
        for _ in range(MAX_TOOL_ROUNDS):
            response = self._post({"model": self.model, "temperature": 0.2, "messages": chat, "tools": spec, "tool_choice": "auto"})
            self._check(response)
            try:
                message = response.json()["choices"][0]["message"]
            except (ValueError, KeyError, IndexError) as e:
                raise ApiError(502, "groq_bad_output", "Groq's answer wasn't readable. Try again.") from e
            tool_calls = message.get("tool_calls") or []
            if not tool_calls:
                return (message.get("content") or "").strip() or GAVE_UP, f"groq/{self.model}", used
            chat.append({"role": "assistant", "content": message.get("content") or "", "tool_calls": tool_calls})
            for tc in tool_calls:
                name = tc.get("function", {}).get("name", "")
                used.append(name)
                try:
                    args = json.loads(tc.get("function", {}).get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = _safe_call(call, name, args if isinstance(args, dict) else {})
                chat.append({"role": "tool", "tool_call_id": tc.get("id"), "content": json.dumps(result, ensure_ascii=False)})
        return GAVE_UP, f"groq/{self.model}", used


class FallbackProposer:
    """Gemini first; Groq if Gemini fails (text only: a voice note or a photo can't go to Groq)."""

    def __init__(self, gemini: Proposer | None, groq: GroqJson | None) -> None:
        self.gemini = gemini
        self.groq = groq

    def __call__(
        self,
        *,
        system: str,
        prompt: str,
        audio: bytes | None,
        audio_mime: str | None,
        images: list[Image] | None = None,
    ) -> tuple[GProposal, str]:
        failure: ApiError | None = None
        extra = {"images": images} if images else {}
        if self.gemini is not None:
            try:
                return self.gemini(system=system, prompt=prompt, audio=audio, audio_mime=audio_mime, **extra)
            except ApiError as e:
                failure = e
        if self.groq is not None and not audio:
            if failure is not None:
                log.warning("Gemini failed (%s); trying Groq%s", failure.code, " with the photos" if images else "")
            return self.groq.generate(
                system=system, messages=[{"role": "user", "content": prompt}], schema=GProposal, **extra
            )
        raise failure or ApiError(503, "not_configured", "No AI model is set up on the server")


class FallbackPlanner:
    """The Sunday check-in: Gemini first, Groq if Gemini fails."""

    def __init__(self, gemini: Planner | None, groq: GroqJson | None) -> None:
        self.gemini = gemini
        self.groq = groq

    def __call__(self, *, system: str, messages: list[tuple[str, str]]) -> tuple[GPlanTurn, str]:
        failure: ApiError | None = None
        if self.gemini is not None:
            try:
                return self.gemini(system=system, messages=messages)
            except ApiError as e:
                failure = e
        if self.groq is not None:
            if failure is not None:
                log.warning("Gemini failed (%s); trying Groq for the check-in", failure.code)
            chat = [{"role": "assistant" if role == "finlyt" else "user", "content": text} for role, text in messages]
            if not chat or chat[0]["role"] != "user":
                chat.insert(0, {"role": "user", "content": "(Check-in started.)"})
            return self.groq.generate(system=system, messages=chat, schema=GPlanTurn)
        raise failure or ApiError(503, "not_configured", "No AI model is set up on the server")


# ── Import from an AI chat: the reply's format, and repairing one that drifted ─


class GImportPayment(BaseModel):
    method: str = Field(default="unknown", description="An account name from the list, cash, upi, card or unknown")
    amount: float = Field(description="Rupees")


class GImportOwed(BaseModel):
    person: str
    amount: float = Field(description="Rupees")


class GImportEntry(BaseModel):
    """One item from the chat. Lenient on purpose: AIs drift, and the app shows what it made of it."""

    date: str = Field(description='"YYYY-MM-DD"')
    time: str | None = Field(default=None, description='"HH:MM" 24-hour, or null')
    type: str = Field(default="expense", description="expense, payback, owe, repay, income or transfer")
    description: str = ""
    category: str = "Other"
    amount: float = Field(description="Full amount in rupees")
    my_share: float | None = None
    payments: list[GImportPayment] = Field(default_factory=list)
    owed_by: list[GImportOwed] = Field(default_factory=list)
    person: str | None = Field(default=None, description="For payback, owe and repay: who")
    notes: str | None = ""


class GImportPlannedItem(BaseModel):
    """A bigger spend planned this month, from the chat. Lenient like the entries."""

    description: str = ""
    amount: float = Field(description="Rupees")
    date: str | None = Field(default=None, description='"YYYY-MM-DD" if known, else null')
    category: str = "Other"


class GImportPlan(BaseModel):
    """The budget or spending plan for the current month or week, if the chat had one."""

    month: str | None = Field(default=None, description='The month it is for, "YYYY-MM"')
    monthly_budget: float | None = Field(default=None, description="The month's budget in rupees, if set")
    weekly_budget: float | None = Field(default=None, description="A weekly budget in rupees, if that's how it was set")
    daily_limit: float | None = Field(default=None, description="A daily limit in rupees, if set")
    big_day_limit: float | None = Field(default=None, description="A bigger day's limit in rupees, if any")
    big_days_per_week: int | None = Field(default=None, description="How many bigger days a week, if any")
    planned_items: list[GImportPlannedItem] = Field(default_factory=list)
    notes: str | None = ""


class GImport(BaseModel):
    version: int = 1
    entries: list[GImportEntry] = Field(default_factory=list)
    plan: GImportPlan | None = Field(default=None, description="This month's or week's plan, or null if there wasn't one")


class ImportFixer(Protocol):
    def __call__(self, *, system: str, text: str) -> tuple[GImport, str]:
        """Turns an AI chat's reply that didn't match the format into entries. Returns the model too."""
        ...


class GeminiImportFixer(_Gemini):
    def __call__(self, *, system: str, text: str) -> tuple[GImport, str]:
        from google.genai import types

        return self._generate(system=system, contents=[types.Part.from_text(text=text)], schema=GImport, heavy=True)


class FallbackImportFixer:
    def __init__(self, gemini: ImportFixer | None, groq: GroqJson | None) -> None:
        self.gemini = gemini
        self.groq = groq

    def __call__(self, *, system: str, text: str) -> tuple[GImport, str]:
        failure: ApiError | None = None
        if self.gemini is not None:
            try:
                return self.gemini(system=system, text=text)
            except ApiError as e:
                failure = e
        if self.groq is not None:
            if failure is not None:
                log.warning("Gemini failed (%s); asking Groq to read the import", failure.code)
            return self.groq.generate(system=system, messages=[{"role": "user", "content": text}], schema=GImport)
        raise failure or ApiError(503, "not_configured", "No AI model is set up on the server")


# ── Ask Finlyt: answering questions with the read-only data tools ───────────

MAX_TOOL_ROUNDS = 6
GAVE_UP = "I looked through a lot but couldn't pin that down. Try a narrower question."


class Agent(Protocol):
    def __call__(
        self, *, system: str, messages: list[tuple[str, str]], tools: list, call: Callable[[str, dict], dict]
    ) -> tuple[str, str, list[str]]:
        """Returns the reply, the model that wrote it, and the tools it used."""
        ...


def _final_text(response) -> str:
    """The answer's text. Gemini sometimes sends the answer twice in two text parts (a draft and
    the final), which `response.text` glues together, so take the last one."""
    try:
        parts = response.candidates[0].content.parts or []
    except (AttributeError, IndexError, TypeError):
        parts = []
    texts = [p.text.strip() for p in parts if getattr(p, "text", None) and not getattr(p, "thought", False)]
    texts = [t for t in texts if t]
    if texts:
        return texts[-1]
    return (getattr(response, "text", None) or "").strip()


class FinishTurn(Exception):
    """Raised by a tool call to end the turn with this text as the reply (e.g. a question back)."""

    def __init__(self, reply: str) -> None:
        super().__init__(reply)
        self.reply = reply


def _safe_call(call: Callable[[str, dict], dict], name: str, args: dict) -> dict:
    try:
        return call(name, args)
    except ApiError as e:
        return {"error": e.message}


class GeminiAgent(_Gemini):
    def __call__(self, *, system, messages, tools, call):
        from google.genai import errors, types

        declarations = [
            types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.input_schema)
            for t in tools
        ]
        last_code: int | None = None
        for model, limit_ms in attempts(self.models, budget_s=self._budget(heavy=False)):
            contents = [
                types.Content(role="model" if role == "finlyt" else "user", parts=[types.Part.from_text(text=text)])
                for role, text in messages
            ]
            if contents[0].role != "user":
                contents.insert(0, types.Content(role="user", parts=[types.Part.from_text(text="Hi")]))
            config = types.GenerateContentConfig(
                system_instruction=system,
                tools=[types.Tool(function_declarations=declarations)],
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                thinking_config=(
                    types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
                    if model.startswith("gemini-3")
                    else types.ThinkingConfig(thinking_budget=1024)
                ),
                http_options=types.HttpOptions(timeout=limit_ms),
            )
            used: list[str] = []
            try:
                for _ in range(MAX_TOOL_ROUNDS):
                    response = self._client.models.generate_content(model=model, contents=contents, config=config)
                    calls = response.function_calls or []
                    if not calls:
                        recovered(model)
                        return _final_text(response) or GAVE_UP, model, used
                    contents.append(response.candidates[0].content)
                    parts = []
                    for c in calls:
                        used.append(c.name)
                        result = _safe_call(call, c.name, dict(c.args or {}))
                        parts.append(types.Part.from_function_response(name=c.name, response={"result": result}))
                    contents.append(types.Content(role="user", parts=parts))
                return GAVE_UP, model, used
            except FinishTurn as done:
                recovered(model)
                return done.reply, model, used
            except httpx.TransportError as e:  # our own timeout, or the network dropped
                log.warning("Gemini %s didn't answer in %d ms: %s", model, limit_ms, e)
                last_code = 504
                cool_down(model)
                continue
            except errors.APIError as e:
                log.warning("Gemini %s failed answering: %s %s", model, e.code, e.message)
                last_code = e.code
                if e.code in FALLBACK_CODES:
                    cool_down(model)
                    continue
                raise ApiError(502, "gemini_error", f"Gemini couldn't answer that ({e.code}). Try again.") from e
        raise ApiError(503, "gemini_busy", f"Gemini is busy right now ({last_code}). Try again in a minute.")


class FallbackAgent:
    def __init__(self, gemini: Agent | None, groq: GroqJson | None) -> None:
        self.gemini = gemini
        self.groq = groq

    def __call__(self, *, system, messages, tools, call):
        failure: ApiError | None = None
        if self.gemini is not None:
            try:
                return self.gemini(system=system, messages=messages, tools=tools, call=call)
            except ApiError as e:
                failure = e
        if self.groq is not None:
            if failure is not None:
                log.warning("Gemini failed (%s); asking Groq", failure.code)
            chat = [{"role": "assistant" if role == "finlyt" else "user", "content": text} for role, text in messages]
            return self.groq.agent(system=system, messages=chat, tools=tools, call=call)
        raise failure or ApiError(503, "not_configured", "No AI model is set up on the server")


def _providers() -> tuple[Settings, GroqJson | None]:
    settings: Settings = current_app.config["SETTINGS"]
    if not settings.gemini_api_key and not settings.groq_api_key:
        raise ApiError(503, "not_configured", "GEMINI_API_KEY isn't set on the server")
    groq = (
        GroqJson(settings.groq_api_key, settings.groq_model, vision_model=settings.groq_vision_model)
        if settings.groq_api_key
        else None
    )
    return settings, groq


def get_proposer() -> Proposer:
    """Gemini with Groq as the fallback, created on first use. Tests put a fake in the same slot."""
    extensions = current_app.extensions
    if "finlyt.gemini" not in extensions:
        settings, groq = _providers()
        gemini = GeminiProposer(settings) if settings.gemini_api_key else None
        if gemini is not None:
            gemini.handoff = groq is not None
        extensions["finlyt.gemini"] = FallbackProposer(gemini, groq)
    return extensions["finlyt.gemini"]


def get_agent() -> Agent:
    """Ask Finlyt's model: Gemini with tool calling, Groq as the fallback."""
    extensions = current_app.extensions
    if "finlyt.agent" not in extensions:
        settings, groq = _providers()
        gemini = GeminiAgent(settings) if settings.gemini_api_key else None
        if gemini is not None:
            gemini.handoff = groq is not None
        extensions["finlyt.agent"] = FallbackAgent(gemini, groq)
    return extensions["finlyt.agent"]


def get_import_fixer() -> ImportFixer:
    extensions = current_app.extensions
    if "finlyt.import_fixer" not in extensions:
        settings, groq = _providers()
        gemini = GeminiImportFixer(settings) if settings.gemini_api_key else None
        if gemini is not None:
            gemini.handoff = groq is not None
        extensions["finlyt.import_fixer"] = FallbackImportFixer(gemini, groq)
    return extensions["finlyt.import_fixer"]


def get_planner() -> Planner:
    extensions = current_app.extensions
    if "finlyt.planner" not in extensions:
        settings, groq = _providers()
        gemini = GeminiPlanner(settings) if settings.gemini_api_key else None
        if gemini is not None:
            gemini.handoff = groq is not None
        extensions["finlyt.planner"] = FallbackPlanner(gemini, groq)
    return extensions["finlyt.planner"]
