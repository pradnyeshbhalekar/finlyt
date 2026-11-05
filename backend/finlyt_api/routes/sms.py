"""Phase 5: bank SMS from the phone become pending transactions to explain on Home."""

from __future__ import annotations

from flask import Blueprint

from ..auth import current_user
from ..db import get_session
from ..schemas import SmsSyncIn, TxnResolveIn
from ..services import sms
from ..validation import parse_body

bp = Blueprint("sms", __name__)


@bp.post("/sms/sync")
def sync_sms():
    """Bank SMS in; new pending transactions out (debits already logged by hand get linked)."""
    data = parse_body(SmsSyncIn)
    s = get_session()
    result = sms.sync(s, current_user().id, data.messages)
    s.commit()
    return result


@bp.get("/txns")
def pending_txns():
    """Bank transactions from the last 14 days still waiting to be explained."""
    return {"items": sms.pending(get_session(), current_user().id)}


@bp.post("/txns/<int:txn_id>/resolve")
def resolve_txn(txn_id: int):
    """Mark a pending transaction as a transfer, income or ignored (or undo that)."""
    data = parse_body(TxnResolveIn)
    s = get_session()
    txn = sms.resolve(s, current_user().id, txn_id, data.status)
    s.commit()
    return sms.txn_json(txn)
