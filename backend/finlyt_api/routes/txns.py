"""Bank transactions waiting to be explained on Home ("To log")."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import TxnResolveIn
from ..services import txns
from ..validation import parse_body

bp = Blueprint("txns", __name__)


@bp.get("/txns")
def pending_txns():
    """Bank transactions from the last 14 days still waiting to be explained."""
    return {"items": txns.pending(get_session(), current_user().id)}


@bp.post("/txns/<int:txn_id>/resolve")
def resolve_txn(txn_id: int):
    """Mark a pending transaction as a transfer, income or ignored (or undo that)."""
    data = parse_body(TxnResolveIn)
    s = get_session()
    txn = txns.resolve(s, current_user().id, txn_id, data.status)
    s.commit()
    return txns.txn_json(txn)
