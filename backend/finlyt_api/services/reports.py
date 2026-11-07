"""Monthly reports: where the money went, the way Claude's personal finance answers it.

`month_report` is the full dashboard for one calendar month (IST): what I spent by category and
against my usual, every day, money in and what's left, which accounts it left from, the biggest
spends, regular payments, money owed both ways, the budget, and bank payments from SMS I haven't
explained yet. Amounts are paise; `for_model` turns them into rupees for an AI to read.

"Usual" is the average of the last three months that have anything logged (so a new user isn't
compared with empty months). For the current month, `pace` projects the month at today's rate.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Account, BankTxn, Budget, Category, Due, Expense, ExpensePayment, Settlement
from ..money import rupees
from ..timeutil import IST, ist_day_bounds, today_ist
from . import debts, memory, planning

USUAL_MONTHS = 3
# Spending that happens once a month, not every day: never projected forward ("on pace").
ONE_OFF_CATEGORIES = {"rent", "bills", "investments", "education", "travel", "gifts"}
BIG_ONE_OFF_PAISE = 2000_00


def whole(paise: int) -> int:
    """Round to whole rupees (averages and projections shouldn't show paise)."""
    return round(paise / 100) * 100


def month_start(day: date) -> date:
    return day.replace(day=1)


def month_end(day: date) -> date:
    return planning.month_end(day)


def previous_month(first: date) -> date:
    return month_start(first - timedelta(days=1))


def parse_month(value: str | None) -> date:
    today = today_ist()
    if not value:
        return month_start(today)
    try:
        year, month = (int(part) for part in str(value).strip()[:7].split("-"))
        first = date(year, month, 1)
    except (ValueError, TypeError) as e:
        raise ApiError(422, "bad_month", f"Months look like 2026-11, not {value!r}") from e
    if first > today:
        raise ApiError(422, "future_month", "That month hasn't happened yet")
    return first


def _spend_by_category(s: Session, user_id: int, first: date, last: date) -> dict[int | None, int]:
    lo, hi = ist_day_bounds(first, last)
    return {
        cid: int(total)
        for cid, total in s.execute(
            select(Expense.category_id, func.sum(Expense.my_share_paise))
            .where(Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi)
            .group_by(Expense.category_id)
        ).all()
    }


def _usual(s: Session, user_id: int, first: date) -> tuple[dict[int | None, int], int, int]:
    """Average spend per category over the last few months with anything logged, their total,
    and how many months that is."""
    months: list[dict[int | None, int]] = []
    m = previous_month(first)
    for _ in range(12):  # look back up to a year for three months with data
        spend = _spend_by_category(s, user_id, m, month_end(m))
        if spend:
            months.append(spend)
            if len(months) == USUAL_MONTHS:
                break
        m = previous_month(m)
    if not months:
        return {}, 0, 0
    totals: dict[int | None, int] = defaultdict(int)
    for spend in months:
        for cid, paise in spend.items():
            totals[cid] += paise
    usual = {cid: paise // len(months) for cid, paise in totals.items()}
    return usual, sum(usual.values()), len(months)


_WORDS = re.compile(r"[a-z]+")


def _key(description: str) -> str:
    """'Netflix · Nov' and 'netflix' are the same payment; numbers and punctuation don't count."""
    return " ".join(_WORDS.findall(description.lower())[:3])


def _regular(s: Session, user_id: int, last: date, names: dict[int, str]) -> list[dict[str, Any]]:
    """Payments that come back month after month (rent, Netflix, a recharge): the same thing in
    at least two of the last three months, about once a month, for about the same amount."""
    first = month_start(previous_month(previous_month(month_start(last))))
    lo, hi = ist_day_bounds(first, last)
    seen: dict[str, dict[str, Any]] = {}
    for description, cid, share, at in s.execute(
        select(Expense.description, Expense.category_id, Expense.my_share_paise, Expense.occurred_at).where(
            Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi
        )
    ).all():
        key = _key(description)
        if not key:
            continue
        item = seen.setdefault(key, {"description": description, "category_id": cid, "months": set(), "amounts": [], "last": None})
        day = at.astimezone(IST).date()
        item["months"].add(month_start(day))
        item["amounts"].append(share)
        if item["last"] is None or day > item["last"]:
            item["last"], item["description"] = day, description
    out = []
    for item in seen.values():
        amounts = sorted(item["amounts"])
        # Regular means every month or so, for about the same amount (not "food" twice).
        if len(item["months"]) < 2 or len(amounts) > len(item["months"]) * 2:
            continue
        if amounts[0] <= 0 or amounts[-1] > amounts[0] * 1.25:
            continue
        out.append(
            {
                "description": item["description"],
                "category": names.get(item["category_id"], "Other"),
                "typical_paise": amounts[len(amounts) // 2],
                "months": len(item["months"]),
                "last_day": item["last"].isoformat(),
            }
        )
    out.sort(key=lambda r: -r["typical_paise"])
    return out[:6]


def month_report(s: Session, user_id: int, first: date) -> dict[str, Any]:
    today = today_ist()
    first = month_start(first)
    last = month_end(first)
    end = min(last, today)
    current = first <= today <= last
    lo, hi = ist_day_bounds(first, end)
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    accounts = dict(s.execute(select(Account.id, Account.name).where(Account.user_id == user_id)).all())

    rows = s.execute(
        select(Expense.id, Expense.occurred_at, Expense.category_id, Expense.my_share_paise, Expense.description).where(
            Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi
        )
    ).all()
    spent = sum(r.my_share_paise for r in rows)
    days_counted = (end - first).days + 1
    days_in_month = (last - first).days + 1

    by_day = {first + timedelta(days=i): 0 for i in range(days_counted)}
    by_cat: dict[int | None, list[int]] = defaultdict(lambda: [0, 0, 0])  # spent, entries, everyday part
    for r in rows:
        by_day[r.occurred_at.astimezone(IST).date()] += r.my_share_paise
        by_cat[r.category_id][0] += r.my_share_paise
        by_cat[r.category_id][1] += 1
        one_off = names.get(r.category_id, "").lower() in ONE_OFF_CATEGORIES or r.my_share_paise >= BIG_ONE_OFF_PAISE
        if not one_off:
            by_cat[r.category_id][2] += r.my_share_paise

    usual, usual_total, usual_months = _usual(s, user_id, first)
    # The same point in last month, for a fair comparison mid-month.
    prev = previous_month(first)
    prev_end = min(month_end(prev), prev + timedelta(days=days_counted - 1))
    prev_total = sum(_spend_by_category(s, user_id, prev, month_end(prev)).values())
    prev_same_point = sum(_spend_by_category(s, user_id, prev, prev_end).values())

    def pace(spent_paise: int, everyday_paise: int) -> int:
        """The month at today's rate: one-offs (rent, bills, big buys) count once, and only
        everyday spending is projected over the days left."""
        if not current:
            return spent_paise
        return whole(spent_paise - everyday_paise + everyday_paise * days_in_month // days_counted)

    everyday_total = sum(v[2] for v in by_cat.values())

    categories = [
        {
            "category_id": cid,
            "name": names.get(cid, "Uncategorised"),
            "spent_paise": paise,
            "entries": count,
            "share": round(paise / spent, 4) if spent else 0,
            "usual_paise": usual.get(cid) if usual_months else None,
            "pace_paise": pace(paise, everyday),
        }
        for cid, (paise, count, everyday) in sorted(by_cat.items(), key=lambda kv: -kv[1][0])
    ]

    paid_from = [
        {"account_id": aid, "name": accounts.get(aid, "?"), "paid_paise": int(total)}
        for aid, total in s.execute(
            select(ExpensePayment.account_id, func.sum(ExpensePayment.amount_paise))
            .join(Expense)
            .where(Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi)
            .group_by(ExpensePayment.account_id)
            .order_by(func.sum(ExpensePayment.amount_paise).desc())
        ).all()
    ]

    income_rows = s.execute(
        select(BankTxn.amount_paise, BankTxn.counterparty).where(
            BankTxn.user_id == user_id,
            BankTxn.direction == "credit",
            BankTxn.status == "income",
            BankTxn.occurred_at >= lo,
            BankTxn.occurred_at < hi,
        )
    ).all()
    income = sum(r.amount_paise for r in income_rows)
    paybacks = int(
        s.scalar(
            select(func.coalesce(func.sum(Settlement.amount_paise), 0))
            .join(Due, Settlement.due_id == Due.id)
            .join(Expense, Due.expense_id == Expense.id)
            .where(Expense.user_id == user_id, Settlement.settled_at >= lo, Settlement.settled_at < hi)
        )
        or 0
    )
    unexplained_credits = s.execute(
        select(func.count(), func.coalesce(func.sum(BankTxn.amount_paise), 0)).where(
            BankTxn.user_id == user_id,
            BankTxn.direction == "credit",
            BankTxn.status == "pending",
            BankTxn.occurred_at >= lo,
            BankTxn.occurred_at < hi,
        )
    ).one()
    unlogged = s.execute(
        select(func.count(), func.coalesce(func.sum(BankTxn.amount_paise), 0)).where(
            BankTxn.user_id == user_id,
            BankTxn.direction == "debit",
            BankTxn.status == "pending",
            BankTxn.occurred_at >= lo,
            BankTxn.occurred_at < hi,
        )
    ).one()

    biggest = [
        {
            "expense_id": r.id,
            "description": r.description,
            "day": r.occurred_at.astimezone(IST).date().isoformat(),
            "category": names.get(r.category_id, "Uncategorised"),
            "my_share_paise": r.my_share_paise,
        }
        for r in sorted(rows, key=lambda r: -r.my_share_paise)[:5]
    ]

    balances = debts.balances(s, user_id)
    owed_to_me = sum(p["amount_paise"] for p in balances["owed_to_me"])
    i_owe = sum(p["amount_paise"] for p in balances["i_owe"])

    budget = s.scalar(select(Budget).where(Budget.user_id == user_id, Budget.month == first))
    plan = None
    days_over = None
    if current:
        n = planning.load_month(s, user_id, today)
        current_plan = n.plan_on(today)
        if current_plan is not None:
            plan = planning.plan_json(current_plan)
            limits, _ = n.day_limits()
            days_over = sum(
                1 for day, limit in limits.items() if first <= day <= today and n.flexible_by_day.get(day, 0) > limit.limit
            )

    salary = memory.income(s, user_id)
    # Income for the month: bank credits marked as income, or else the salary Finlyt remembers.
    month_income = income or salary or 0
    committed = sum(c.monthly_paise for c in memory.active_commitments(s, user_id))
    report: dict[str, Any] = {
        "month": first.isoformat()[:7],
        "label": first.strftime("%B %Y"),
        "first_day": first.isoformat(),
        "last_day": end.isoformat(),
        "current": current,
        "days_counted": days_counted,
        "days_in_month": days_in_month,
        "spent_paise": spent,
        "entries": len(rows),
        "per_day_paise": whole(spent // days_counted) if days_counted else 0,
        "everyday_paise": everyday_total,
        "one_off_paise": spent - everyday_total,
        "pace_paise": pace(spent, everyday_total),
        "last_month": {
            "label": prev.strftime("%B"),
            "total_paise": prev_total,
            "same_point_paise": prev_same_point,
        },
        "usual": {"total_paise": usual_total, "months": usual_months},
        "categories": categories,
        "by_day": [{"day": d.isoformat(), "spent_paise": p} for d, p in by_day.items()],
        "paid_from": paid_from,
        "money_in": {
            "income_paise": income,
            "income_count": len(income_rows),
            "paybacks_paise": paybacks,
            "unexplained_credits": {"count": unexplained_credits[0], "paise": int(unexplained_credits[1])},
            "salary_paise": salary,
            "income_source": "bank" if income else ("memory" if salary else None),
            "commitments_paise": committed,
            # What's left of the month's income after spending (on pace, for the current month).
            "left_paise": month_income - pace(spent, everyday_total) if month_income else None,
            "saved_share": round((month_income - pace(spent, everyday_total)) / month_income, 4) if month_income else None,
            "spent_share": round(spent / month_income, 4) if month_income else None,
        },
        "biggest": biggest,
        "regular": _regular(s, user_id, end, names),
        "owed": {"to_me_paise": owed_to_me, "i_owe_paise": i_owe},
        "budget": {
            "budget_paise": budget.amount_paise if budget else None,
            "plan": plan,
            "days_over_limit": days_over,
        },
        "unlogged": {"count": unlogged[0], "paise": int(unlogged[1])},
    }
    report["notes"] = _notes(report)
    return report


def _notes(r: dict[str, Any]) -> list[str]:
    """A few things worth noticing, in plain words (the app lists them; the AI can use them)."""
    notes: list[str] = []
    spent = r["spent_paise"]
    if r["categories"] and spent:
        top = r["categories"][0]
        notes.append(f"{top['name']} was {round(top['share'] * 100)}% of your spending ({rupees(top['spent_paise'])}).")
    for c in r["categories"]:
        usual = c["usual_paise"]
        if usual and c["pace_paise"] > usual * 1.25 and c["pace_paise"] - usual >= 50000:
            verb = "is heading for" if r["current"] else "came to"
            notes.append(f"{c['name']} {verb} {rupees(c['pace_paise'])}, more than your usual {rupees(usual)}.")
            break
    if r["unlogged"]["count"]:
        n = r["unlogged"]["count"]
        notes.append(
            f"{n} bank {'payment' if n == 1 else 'payments'} from SMS ({rupees(r['unlogged']['paise'])}) "
            "aren't logged yet, so the real total is higher."
        )
    if r["owed"]["to_me_paise"]:
        notes.append(f"People owe you {rupees(r['owed']['to_me_paise'])}.")
    if r["budget"]["days_over_limit"]:
        d = r["budget"]["days_over_limit"]
        notes.append(f"You went over the day's limit on {d} {'day' if d == 1 else 'days'}.")
    budget = r["budget"]["budget_paise"]
    if budget and r["current"] and r["pace_paise"] > budget:
        notes.append(f"At this rate the month comes to {rupees(r['pace_paise'])}, over your {rupees(budget)} budget.")
    return notes[:5]


def for_model(value: Any) -> Any:
    """Paise → rupees, recursively, with the keys renamed, for an AI to read."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k.endswith("_paise") and isinstance(v, int):
                out[k[: -len("_paise")] + "_rupees"] = round(v / 100, 2)
            else:
                out[k] = for_model(v)
        return out
    if isinstance(value, list):
        return [for_model(v) for v in value]
    return value


def money_in_and_out(s: Session, user_id: int, first: date, last: date) -> dict[str, Any]:
    """Income (bank credits I marked as income), spending (my share) and what's left, by month."""
    months = []
    m = month_start(first)
    while m <= last:
        end = min(month_end(m), last)
        lo, hi = ist_day_bounds(max(m, first), end)
        spent = int(
            s.scalar(
                select(func.coalesce(func.sum(Expense.my_share_paise), 0)).where(
                    Expense.user_id == user_id, Expense.occurred_at >= lo, Expense.occurred_at < hi
                )
            )
            or 0
        )
        income = int(
            s.scalar(
                select(func.coalesce(func.sum(BankTxn.amount_paise), 0)).where(
                    BankTxn.user_id == user_id,
                    BankTxn.direction == "credit",
                    BankTxn.status == "income",
                    BankTxn.occurred_at >= lo,
                    BankTxn.occurred_at < hi,
                )
            )
            or 0
        )
        months.append(
            {
                "month": m.isoformat()[:7],
                "income_paise": income,
                "spent_paise": spent,
                "left_paise": income - spent,
                "saved_share": round((income - spent) / income, 4) if income else None,
            }
        )
        m = month_start(month_end(m) + timedelta(days=1))
    income = sum(x["income_paise"] for x in months)
    spent = sum(x["spent_paise"] for x in months)
    return {
        "from": first.isoformat(),
        "to": last.isoformat(),
        "income_known": income > 0,
        "income_paise": income,
        "spent_paise": spent,
        "left_paise": income - spent,
        "saved_share": round((income - spent) / income, 4) if income else None,
        "months": months,
        "note": (
            "Income is only bank credits marked as income in Finlyt."
            if income
            else "No income is recorded in Finlyt: bank credits haven't been marked as income."
        ),
    }
