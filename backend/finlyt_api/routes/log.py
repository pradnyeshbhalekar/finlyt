"""Phase 3: log spending by voice or text through Gemini, review it, then save it."""

from __future__ import annotations

import json

from flask import Blueprint, request

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..gemini import get_proposer
from ..schemas import LogCommitIn, ProposeIn
from ..services import habits, proposals, quick_parse, sms_paste
from ..timeutil import now_utc, today_ist
from ..validation import parse_body

bp = Blueprint("log", __name__)

MAX_AUDIO_BYTES = 4 * 1024 * 1024  # Vercel caps request bodies at 4.5 MB
MAX_IMAGE_BYTES = 4 * 1024 * 1024  # all pages of a receipt together; the app sends ~0.3 MB a page
MAX_PAGES = 4
IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}
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
    text = data.text or ""
    issues: list[str] = []
    # A pasted bank SMS is read by rules, and so are simple notes ("chai 40 cash"): instant, and
    # no AI involved. Anything else goes to Gemini.
    pasted = None if audio or data.txn_ids else sms_paste.propose(s, user_id, ctx, text, now=now)
    quick = None if audio or pasted else quick_parse.parse(text, ctx, now=now)
    if pasted is not None:
        answer, model, issues = pasted.answer, "sms", pasted.issues
    elif quick is not None:
        answer, model = quick, "quick"
    else:
        answer, model = get_proposer()(
            system=proposals.SYSTEM_PROMPT,
            prompt=proposals.build_prompt(ctx, text=data.text, has_audio=bool(audio), now=now),
            audio=audio,
            audio_mime=mime,
        )
    answer = proposals.use_picked_txn(ctx, answer, data.text)
    result = proposals.resolve(s, user_id, ctx, answer, now=now)
    if issues and result["expenses"]:
        result["expenses"][0]["issues"].extend(issues)
    result["model"] = model
    return result


@bp.post("/log/receipt")
def receipt():
    """A scanned receipt (one image per page, as `image`) in, a proposal of one expense out.

    Nothing is saved: the app asks who owes what and sends it to /log/commit like any proposal.
    """
    uploads = request.files.getlist("image")
    if not uploads:
        raise ApiError(422, "no_image", "Scan a receipt first")
    if len(uploads) > MAX_PAGES:
        raise ApiError(413, "too_many_pages", f"Scan at most {MAX_PAGES} pages of a receipt")
    images: list[tuple[bytes, str]] = []
    size = 0
    for upload in uploads:
        mime = (upload.mimetype or "").lower()
        if mime not in IMAGE_TYPES:
            raise ApiError(415, "unsupported_image", f"Can't read {mime or 'that'} images; send a JPEG")
        data = upload.read(MAX_IMAGE_BYTES + 1)
        size += len(data)
        if size > MAX_IMAGE_BYTES:
            raise ApiError(413, "image_too_big", "That receipt is too big to send. Scan it again.")
        if data:
            images.append((data, "image/jpeg" if mime == "image/jpg" else mime))
    if not images:
        raise ApiError(422, "no_image", "Scan a receipt first")

    s = get_session()
    user_id = current_user().id
    now = now_utc()
    ctx = proposals.load_context(s, user_id, None)
    note = (request.form.get("text") or "").strip()[:500] or None
    prompt = proposals.build_prompt(ctx, text=note, has_audio=False, now=now)
    answer, model = get_proposer()(
        system=proposals.RECEIPT_PROMPT,
        prompt=f"{prompt}\nThe receipt has {len(images)} page{'s' if len(images) > 1 else ''}.",
        audio=None,
        audio_mime=None,
        images=images,
    )
    # One receipt is one expense, paid in full by me: who owes what is asked on the phone.
    if len(answer.expenses) > 1:
        answer = answer.model_copy(update={"expenses": answer.expenses[:1]})
    answer = answer.model_copy(
        update={
            "expenses": [e.model_copy(update={"owed_by": [], "my_share": e.total}) for e in answer.expenses],
            "settlements": [],
            "transfers": [],
            "ignored": [],
            "i_owe": [],
            "repaid": [],
        }
    )
    result = proposals.resolve(s, user_id, ctx, answer, now=now)
    result["model"] = model
    return result


@bp.post("/log/commit")
def commit():
    """Save a reviewed proposal in one database transaction."""
    data = parse_body(LogCommitIn)
    s = get_session()
    user_id = current_user().id
    result = proposals.commit(s, user_id, data)
    s.commit()
    result["habits"] = habits.alerts_after_save(s, user_id, result["expense_ids"], today_ist())
    return result, 201
