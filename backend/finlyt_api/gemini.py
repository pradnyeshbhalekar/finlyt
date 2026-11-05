"""Gemini: turns a voice note and/or typed text into a structured spending proposal.

Gemini answers in rupees with names and transaction labels (T1, T2…). The proposal
service maps that onto ids and paise and checks the money adds up; nothing here touches
the database.
"""

from __future__ import annotations

import logging
from typing import Protocol

from flask import current_app
from pydantic import BaseModel, Field, ValidationError

from .config import Settings
from .errors import ApiError

log = logging.getLogger(__name__)

# Tried in order until one answers. GEMINI_MODEL overrides this with a comma-separated list.
# 3.5 Flash leads because it answered in ~3 s in testing (2026-11-05) while the newer
# 3.8 Flash was overloaded and timing out. 2.5 Flash is the last resort when both are busy.
DEFAULT_MODELS = ("gemini-3.5-flash", "gemini-3.8-flash", "gemini-2.5-flash")
# Overloaded or rate-limited: worth trying the next model. Anything else is our problem.
FALLBACK_CODES = {429, 500, 503, 504}


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


class Proposer(Protocol):
    def __call__(
        self, *, system: str, prompt: str, audio: bytes | None, audio_mime: str | None
    ) -> tuple[GProposal, str]:
        """Returns the proposal and the model that wrote it."""
        ...


class GeminiProposer:
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

    def __call__(
        self, *, system: str, prompt: str, audio: bytes | None, audio_mime: str | None
    ) -> tuple[GProposal, str]:
        from google.genai import errors, types

        parts = []
        if audio:
            parts.append(types.Part.from_bytes(data=audio, mime_type=audio_mime or "audio/aac"))
        parts.append(types.Part.from_text(text=prompt))

        def config_for(model: str) -> types.GenerateContentConfig:
            # Gemini 3 models take a thinking level; 2.5 uses a token budget instead.
            thinking = (
                types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
                if model.startswith("gemini-3")
                else types.ThinkingConfig(thinking_budget=1024)
            )
            return types.GenerateContentConfig(
                system_instruction=system,
                response_mime_type="application/json",
                response_json_schema=GProposal.model_json_schema(),
                thinking_config=thinking,
            )

        last_code: int | None = None
        for model in self.models:
            try:
                response = self._client.models.generate_content(
                    model=model, contents=parts, config=config_for(model)
                )
            except errors.APIError as e:
                log.warning("Gemini %s failed: %s %s", model, e.code, e.message)
                last_code = e.code
                if e.code in FALLBACK_CODES:
                    continue
                raise ApiError(
                    502, "gemini_error", f"Gemini couldn't process this ({e.code}). Try again."
                ) from e
            try:
                return GProposal.model_validate_json(response.text or ""), model
            except ValidationError as e:
                log.warning("Gemini %s returned an unexpected shape: %s", model, e)
                raise ApiError(
                    502, "gemini_bad_output", "Gemini's answer wasn't in the expected shape. Try again."
                ) from e
        raise ApiError(
            503, "gemini_busy", f"Gemini is busy right now ({last_code}). Try again in a minute."
        )


def get_proposer() -> Proposer:
    """The app's Gemini client, created on first use. Tests put a fake in the same slot."""
    extensions = current_app.extensions
    if "finlyt.gemini" not in extensions:
        settings: Settings = current_app.config["SETTINGS"]
        if not settings.gemini_api_key:
            raise ApiError(503, "not_configured", "GEMINI_API_KEY isn't set on the server")
        extensions["finlyt.gemini"] = GeminiProposer(settings)
    return extensions["finlyt.gemini"]
