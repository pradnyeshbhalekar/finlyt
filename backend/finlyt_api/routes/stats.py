from __future__ import annotations

from flask import Blueprint
from sqlalchemy import func, literal_column, select

from ..auth import current_user
from ..db import get_session
from ..errors import ApiError
from ..models import Due, Expense, ExpensePayment, Settlement
from ..schemas import DateRangeQuery
from ..timeutil import TZ_NAME, ist_day_bounds, today_ist
from ..validation import parse_query

bp = Blueprint("stats", __name__)


@bp.get("/stats")
def stats():
    """Totals for an IST date range (default: this month so far). Spend uses my share."""
    q = parse_query(DateRangeQuery)
    today = today_ist()
    first_day = q.from_ or today.replace(day=1)
    last_day = q.to or today
    if last_day < first_day:
        raise ApiError(422, "bad_range", "`to` is before `from`")
    start, end = ist_day_bounds(first_day, last_day)

    user_id = current_user().id
    s = get_session()
    in_range = (Expense.user_id == user_id, Expense.occurred_at >= start, Expense.occurred_at < end)

    spend, count = s.execute(
        select(func.coalesce(func.sum(Expense.my_share_paise), 0), func.count(Expense.id)).where(
            *in_range
        )
    ).one()

    share = func.sum(Expense.my_share_paise)
    by_category = s.execute(
        select(Expense.category_id, share, func.count(Expense.id))
        .where(*in_range)
        .group_by(Expense.category_id)
        .order_by(share.desc())
    ).all()

    # A literal (not a bound parameter) so GROUP BY matches the SELECT expression.
    local_day = func.date(func.timezone(literal_column(f"'{TZ_NAME}'"), Expense.occurred_at))
    by_day = s.execute(
        select(local_day, share).where(*in_range).group_by(local_day).order_by(local_day)
    ).all()

    paid = func.sum(ExpensePayment.amount_paise)
    by_account = s.execute(
        select(ExpensePayment.account_id, paid)
        .join(Expense, ExpensePayment.expense_id == Expense.id)
        .where(*in_range)
        .group_by(ExpensePayment.account_id)
        .order_by(paid.desc())
    ).all()

    settled = (
        select(Settlement.due_id, func.sum(Settlement.amount_paise).label("paid"))
        .group_by(Settlement.due_id)
        .subquery()
    )
    open_dues = s.scalar(
        select(func.coalesce(func.sum(Due.amount_paise - func.coalesce(settled.c.paid, 0)), 0))
        .select_from(Due)
        .join(Expense, Due.expense_id == Expense.id)
        .outerjoin(settled, settled.c.due_id == Due.id)
        .where(Expense.user_id == user_id, Due.status == "open")
    )

    return {
        "from": first_day.isoformat(),
        "to": last_day.isoformat(),
        "spend_paise": int(spend),
        "expense_count": int(count),
        "by_category": [
            {"category_id": cid, "spend_paise": int(total), "count": int(n)}
            for cid, total, n in by_category
        ],
        "by_day": [{"day": day.isoformat(), "spend_paise": int(total)} for day, total in by_day],
        "by_account": [{"account_id": aid, "paid_paise": int(total)} for aid, total in by_account],
        # All open dues, not just this range: it's what people owe me right now.
        "open_dues_paise": int(open_dues or 0),
    }
