"""Read-only questions about the user's money, as tools for AI models.

The same tools serve the MCP endpoint (/api/mcp, for Claude or any MCP client) and Finlyt's own
"Ask" chat (/api/ask). Every tool reads only the signed-in user's data and changes nothing.
Amounts are in rupees (not paise) because that's what people ask in.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Account, BankTxn, Category, Expense, ExpensePayment
from ..sms_parsers import display_name
from ..timeutil import IST, ist_day_bounds, today_ist
from . import activity, debts, planning
from .expenses import expense_query


def _r(paise) -> float:
    """Paise → rupees. int() first: Postgres returns sums of BIGINT as Decimal."""
    return round(int(paise or 0) / 100, 2)


def _date(value: Any, default: date) -> date:
    if value in (None, ""):
        return default
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as e:
        raise ApiError(422, "bad_date", f"Dates look like 2026-11-05, not {value!r}") from e


def _range(args: dict) -> tuple[date, date]:
    today = today_ist()
    start = _date(args.get("start_date"), today.replace(day=1))
    end = _date(args.get("end_date"), today)
    if end < start:
        start, end = end, start
    if (end - start).days > 400:
        raise ApiError(422, "range_too_long", "Ask about at most about a year at a time")
    return start, end


def _names(s: Session, user_id: int) -> tuple[dict[int, str], dict[int, str]]:
    cats = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    accts = dict(s.execute(select(Account.id, Account.name).where(Account.user_id == user_id)).all())
    return cats, accts


def spending_summary(s: Session, user_id: int, args: dict) -> dict:
    start, end = _range(args)
    lo, hi = ist_day_bounds(start, end)
    cats, accts = _names(s, user_id)
    rows = s.execute(
        select(Expense.occurred_at, Expense.category_id, Expense.my_share_paise).where(
            Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi
        )
    ).all()
    by_cat: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_day: dict[str, int] = defaultdict(int)
    for at, cat, share in rows:
        name = cats.get(cat, "Uncategorised")
        by_cat[name][0] += share
        by_cat[name][1] += 1
        by_day[at.astimezone(IST).date().isoformat()] += share
    paid = s.execute(
        select(ExpensePayment.account_id, func.sum(ExpensePayment.amount_paise))
        .join(Expense)
        .where(Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi)
        .group_by(ExpensePayment.account_id)
    ).all()
    total = sum(share for *_, share in rows)
    days = (end - start).days + 1
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "total_rupees": _r(total),
        "entries": len(rows),
        "average_per_day_rupees": _r(total // days),
        "by_category": [
            {"category": k, "rupees": _r(v[0]), "entries": v[1]}
            for k, v in sorted(by_cat.items(), key=lambda kv: -kv[1][0])
        ],
        "paid_from_accounts": [{"account": accts.get(a, "?"), "rupees": _r(p)} for a, p in paid],
        "by_day": [{"date": d, "rupees": _r(v)} for d, v in sorted(by_day.items())],
    }


def find_expenses(s: Session, user_id: int, args: dict) -> dict:
    start, end = _range(args)
    lo, hi = ist_day_bounds(start, end)
    cats, accts = _names(s, user_id)
    q = expense_query(user_id).where(Expense.occurred_at >= lo, Expense.occurred_at < hi)
    if args.get("category"):
        wanted = str(args["category"]).strip().lower()
        ids = [cid for cid, name in cats.items() if name.lower() == wanted]
        q = q.where(Expense.category_id.in_(ids or [-1]))
    if args.get("text"):
        q = q.where(
            Expense.description.ilike(f"%{args['text']}%") | Expense.note_raw.ilike(f"%{args['text']}%")
        )
    if args.get("min_rupees") is not None:
        q = q.where(Expense.my_share_paise >= int(float(args["min_rupees"]) * 100))
    if args.get("max_rupees") is not None:
        q = q.where(Expense.my_share_paise <= int(float(args["max_rupees"]) * 100))
    limit = min(int(args.get("limit") or 50), 100)
    items = s.scalars(q.order_by(Expense.occurred_at.desc()).limit(limit)).all()
    return {
        "count": len(items),
        "expenses": [
            {
                "id": e.id,
                "when": e.occurred_at.astimezone(IST).strftime("%Y-%m-%d %H:%M"),
                "description": e.description,
                "category": cats.get(e.category_id, "Uncategorised"),
                "my_share_rupees": _r(e.my_share_paise),
                "total_rupees": _r(e.total_paise),
                "paid_with": [{"account": accts.get(p.account_id, "?"), "rupees": _r(p.amount_paise)} for p in e.payments],
                "owed_by": [
                    {"person": d.person.name, "rupees": _r(d.amount_paise), "status": d.status} for d in e.dues
                ],
                "said": e.note_raw,
            }
            for e in items
        ],
    }


def people(s: Session, user_id: int, args: dict) -> dict:
    b = debts.balances(s, user_id)

    def rows(key: str) -> list[dict]:
        return [
            {
                "person": r["name"],
                "rupees": _r(r["amount_paise"]),
                "for": [{"what": i["description"], "rupees": _r(i["amount_paise"])} for i in r["items"]],
            }
            for r in b[key]
        ]

    return {"they_owe_me": rows("owed_to_me"), "i_owe_them": rows("i_owe")}


def budget(s: Session, user_id: int, args: dict) -> dict:
    st = planning.status(s, user_id, today_ist())
    cats, _ = _names(s, user_id)
    return {
        "today": st["today"],
        "days_left_in_month": st["days_left"],
        "monthly_budget_rupees": _r(st["budget_paise"]) if st["budget_paise"] else None,
        "spent_this_month_rupees": _r(st["spent_month_paise"]),
        "daily_limit_rupees": _r(st["plan"]["daily_limit_paise"]) if st["plan"] else None,
        "spent_today_rupees": _r(st["today_spent_paise"]),
        "left_today_rupees": _r(st["today_left_paise"]) if st["today_left_paise"] is not None else None,
        "saved_for_surprises_rupees": _r(st["buffer_paise"]),
        "planned_this_month": [
            {
                "what": i["description"],
                "rupees": _r(i["amount_paise"]),
                "spent_rupees": _r(i["spent_paise"]),
                "due": i["due_on"],
                "category": cats.get(i["category_id"], None),
            }
            for i in st["planned_items"]
        ],
    }


def bank_payments(s: Session, user_id: int, args: dict) -> dict:
    start, end = _range(args)
    lo, hi = ist_day_bounds(start, end)
    _, accts = _names(s, user_id)
    q = select(BankTxn).where(BankTxn.user_id == user_id, BankTxn.occurred_at >= lo, BankTxn.occurred_at < hi)
    if args.get("status"):
        q = q.where(BankTxn.status == str(args["status"]))
    limit = min(int(args.get("limit") or 50), 100)
    rows = s.scalars(q.order_by(BankTxn.occurred_at.desc()).limit(limit)).all()
    return {
        "count": len(rows),
        "payments": [
            {
                "when": t.occurred_at.astimezone(IST).strftime("%Y-%m-%d %H:%M"),
                "direction": "out" if t.direction == "debit" else "in",
                "rupees": _r(t.amount_paise),
                "with": display_name(t.counterparty),
                "account": accts.get(t.account_id, "?"),
                "status": t.status,
            }
            for t in rows
        ],
    }


def recent_activity(s: Session, user_id: int, args: dict) -> dict:
    limit = min(int(args.get("limit") or 30), 100)
    data = activity.feed(s, user_id, before=None, limit=limit)
    out = []
    for item in data["items"]:
        kind = item["type"]
        if kind == "expense":
            e = item["expense"]
            out.append({"when": item["at"], "type": "spent", "what": e["description"], "rupees": _r(e["my_share_paise"])})
        elif kind == "payback":
            out.append({"when": item["at"], "type": "paid me back", "who": item["person"], "rupees": _r(item["amount_paise"])})
        elif kind == "debt":
            out.append({"when": item["at"], "type": "I owe", "who": item["person"], "what": item["description"], "rupees": _r(item["amount_paise"]), "status": item["status"]})
        elif kind == "bank":
            out.append({"when": item["at"], "type": f"bank {item['status']}", "who": item["name"], "rupees": _r(item["amount_paise"])})
        elif kind == "plan":
            out.append({"when": item["at"], "type": "new plan", "daily_limit_rupees": _r(item["daily_limit_paise"])})
    return {"items": out}


def setup(s: Session, user_id: int, args: dict) -> dict:
    cats, accts = _names(s, user_id)
    return {"categories": sorted(cats.values()), "accounts": sorted(accts.values()), "today": today_ist().isoformat()}


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict
    run: Callable[[Session, int, dict], dict]


_DATES = {
    "start_date": {"type": "string", "description": "First day, YYYY-MM-DD (IST). Default: the 1st of this month."},
    "end_date": {"type": "string", "description": "Last day, YYYY-MM-DD (IST), inclusive. Default: today."},
}

TOOLS: list[Tool] = [
    Tool(
        "spending_summary",
        "Total spent (my share) between two dates, broken down by category, by account and by day.",
        {"type": "object", "properties": dict(_DATES), "additionalProperties": False},
        spending_summary,
    ),
    Tool(
        "find_expenses",
        "List individual entries between two dates, optionally filtered by category name, a word in the "
        "description or in what I said, or my share in rupees. Newest first.",
        {
            "type": "object",
            "properties": {
                **_DATES,
                "category": {"type": "string", "description": "Exact category name, e.g. Food"},
                "text": {"type": "string", "description": "A word to look for, e.g. zomato or rahul"},
                "min_rupees": {"type": "number"},
                "max_rupees": {"type": "number"},
                "limit": {"type": "integer", "description": "At most 100. Default 50."},
            },
            "additionalProperties": False,
        },
        find_expenses,
    ),
    Tool(
        "people_balances",
        "Who owes me money and how much, and whom I owe, with what each amount was for.",
        {"type": "object", "properties": {}, "additionalProperties": False},
        people,
    ),
    Tool(
        "budget_status",
        "This month's budget, spent so far, today's daily limit and what's left of it, money saved for "
        "surprises, and the bigger spends planned this month.",
        {"type": "object", "properties": {}, "additionalProperties": False},
        budget,
    ),
    Tool(
        "bank_payments",
        "UPI and bank payments picked up from bank SMS between two dates, with their status: pending "
        "(not explained yet), logged, transfer, payback, income, ignored.",
        {
            "type": "object",
            "properties": {
                **_DATES,
                "status": {"type": "string", "enum": ["pending", "logged", "transfer", "payback", "income", "ignored"]},
                "limit": {"type": "integer"},
            },
            "additionalProperties": False,
        },
        bank_payments,
    ),
    Tool(
        "recent_activity",
        "Everything that happened lately, newest first: spending, paybacks, money I owe, transfers, plans.",
        {"type": "object", "properties": {"limit": {"type": "integer"}}, "additionalProperties": False},
        recent_activity,
    ),
    Tool(
        "categories_and_accounts",
        "My category names and accounts, and today's date.",
        {"type": "object", "properties": {}, "additionalProperties": False},
        setup,
    ),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def call(s: Session, user_id: int, name: str, args: dict | None) -> dict:
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        raise ApiError(404, "unknown_tool", f"No tool called {name}")
    return tool.run(s, user_id, dict(args or {}))


def week_hint() -> str:
    today = today_ist()
    monday = today - timedelta(days=today.weekday())
    return f"Today is {today.strftime('%A %Y-%m-%d')} (IST); this week started {monday.isoformat()}."
