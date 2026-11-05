"""Phase 3: log spending by voice or text through Gemini, review it, then save it."""

from __future__ import annotations

import json

from flask import Blueprint, request

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..gemini import get_proposer
from ..schemas import LogCommitIn, ProposeIn
from ..services import proposals, quick_parse
from ..timeutil import now_utc
from ..validation import parse_body

bp = Blueprint("log", __name__)

MAX_AUDIO_BYTES = 4 * 1024 * 1024  # Vercel caps request bodies at 4.5 MB
# What Gemini accepts. Android records AAC (ADTS); the rest are for other clients.
AUDIO_TYPES = {
    "audio/aac", "audio/x-aac", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
    "audio/aiff", "audio/x-aiff", "audio/ogg", "audio/flac", "audio/mp4", "audio/m4a",
    "audio/x-m4a", "audio/webm",
}  # fmt: skip


def _form_input() -> tuple[ProposeIn, bytes | None, str | None]:
    raw_ids = request.form.get("txn_ids")
    txn_ids = None
    if raw_ids:
        try:
            txn_ids = json.loads(raw_ids) if raw_ids.strip().startswith("[") else raw_ids.split(",")
        except json.JSONDecodeError as e:
            raise ApiError(400, "invalid_txn_ids", "txn_ids must be a JSON list of ids") from e
    data = ProposeIn.model_validate({"text": request.form.get("text") or None, "txn_ids": txn_ids})

    upload = request.files.get("audio")
    if upload is None:
        return data, None, None
    mime = (upload.mimetype or "").lower()
    if mime not in AUDIO_TYPES:
        raise ApiError(415, "unsupported_audio", f"Can't use {mime or 'that'} audio; record AAC instead")
    audio = upload.read(MAX_AUDIO_BYTES + 1)
    if len(audio) > MAX_AUDIO_BYTES:
        raise ApiError(413, "audio_too_long", "That voice note is too long. Keep it under 3 minutes.")
    return data, audio or None, mime


@bp.post("/log/propose")
def propose():
    """Voice note and/or text in, an editable proposal out. Nothing is saved.

    Simple text is parsed without AI; anything more goes to Gemini. `model` in the reply says which.
    """
    if request.mimetype == "multipart/form-data":
        data, audio, mime = _form_input()
    else:
        data, audio, mime = parse_body(ProposeIn), None, None
    if not (audio or (data.text and data.text.strip())):
        raise ApiError(422, "nothing_to_log", "Record a voice note or type what you spent")

    s = get_session()
    user_id = current_user().id
    now = now_utc()
    ctx = proposals.load_context(s, user_id, data.txn_ids)
    # Simple notes ("chai 40 cash") are parsed by rules: instant, and no AI involved.
    quick = None if audio else quick_parse.parse(data.text or "", ctx, now=now)
    if quick is not None:
        answer, model = quick, "quick"
    else:
        answer, model = get_proposer()(
            system=proposals.SYSTEM_PROMPT,
            prompt=proposals.build_prompt(ctx, text=data.text, has_audio=bool(audio), now=now),
            audio=audio,
            audio_mime=mime,
        )
    result = proposals.resolve(s, user_id, ctx, answer, now=now)
    result["model"] = model
    return result


@bp.post("/log/commit")
def commit():
    """Save a reviewed proposal in one database transaction."""
    data = parse_body(LogCommitIn)
    s = get_session()
    result = proposals.commit(s, current_user().id, data)
    s.commit()
    return result, 201
