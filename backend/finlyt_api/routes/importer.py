"""Import from an AI chat (Claude, ChatGPT, Gemini): prompt, preview, save, list and undo."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import ImportCommitIn, ImportPreviewIn
from ..services import importer
from ..validation import parse_body

bp = Blueprint("import", __name__)


@bp.get("/import/prompt")
def prompt():
    """The prompt to paste into the AI chat, with my categories and accounts filled in."""
    return {"prompt": importer.build_prompt(get_session(), current_user().id)}


@bp.post("/import/preview")
def preview():
    """The chat's reply in, the entries Finlyt made of it out. Nothing is saved."""
    data = parse_body(ImportPreviewIn)
    return importer.preview(get_session(), current_user().id, data.text, data.source)


@bp.post("/import/commit")
def commit():
    data = parse_body(ImportCommitIn)
    s = get_session()
    result = importer.commit(s, current_user().id, data)
    s.commit()
    return result, 201


@bp.get("/import/batches")
def batches():
    return {"items": importer.list_batches(get_session(), current_user().id)}


@bp.delete("/import/batches/<int:batch_id>")
def undo(batch_id: int):
    s = get_session()
    importer.undo(s, current_user().id, batch_id)
    s.commit()
    return "", 204
