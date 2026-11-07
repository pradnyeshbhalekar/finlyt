"""What Finlyt remembers about my money: monthly income, standing commitments, and notes.

The AI saves these when I mention them (in Ask or a check-in), and they're shown on the "What
Finlyt remembers" screen where I can change or delete them. Commitments with income rules move
by themselves: "₹3,000 a month to my sister for the laptop while I earn ₹45,000, ₹6,000 once I
earn ₹55,000" becomes a commitment whose amount follows my income, so telling Finlyt about a
raise updates it. Every check-in sets each active commitment aside as a planned item.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..models import Category, Commitment, Expense, MoneyNote, MoneyProfile
from ..money import rupees, to_paise
from ..timeutil import IST, ist_day_bounds, today_ist


@dataclass
class Update:
    """One thing the AI changed, shown under its answer ("Remembered: …")."""

    kind: str  # income, commitment, note
    text: str

    def json(self) -> dict[str, str]:
        return {"kind": self.kind, "text": self.text}


def get_profile(s: Session, user_id: int) -> MoneyProfile | None:
    return s.get(MoneyProfile, user_id)


def income(s: Session, user_id: int) -> int | None:
    p = get_profile(s, user_id)
    return p.monthly_income_paise if p else None


def amount_for(c: Commitment, income_paise: int | None) -> int:
    """A commitment's monthly amount at an income: the rule with the highest threshold it reaches."""
    if income_paise is None or not c.rules:
        return c.monthly_paise
    best = None
    for rule in sorted(c.rules, key=lambda r: int(r.get("min_income_paise", 0))):
        if income_paise >= int(rule.get("min_income_paise", 0)):
            best = int(rule["monthly_paise"])
    return best if best else c.monthly_paise


def paid_so_far(s: Session, user_id: int, c: Commitment) -> int:
    """Paid towards it: what was paid before Finlyt, plus logged expenses since it started whose
    description or my words mention one of its match words."""
    paid = c.paid_before_paise
    if not c.match_words:
        return paid
    lo, _ = ist_day_bounds(c.starts_on, c.starts_on)
    _, hi = ist_day_bounds(today_ist(), today_ist())
    words = [w for w in c.match_words if w.strip()]
    if not words:
        return paid
    shares = s.scalars(
        select(Expense.my_share_paise).where(
            Expense.user_id == user_id,
            Expense.occurred_at >= lo,
            Expense.occurred_at < hi,
            or_(*[Expense.description.ilike(f"%{w}%") for w in words], *[Expense.note_raw.ilike(f"%{w}%") for w in words]),
        )
    ).all()
    return paid + sum(shares)


def commitment_json(s: Session, user_id: int, c: Commitment, names: dict[int, str]) -> dict[str, Any]:
    paid = paid_so_far(s, user_id, c)
    left = max(c.total_paise - paid, 0) if c.total_paise else None
    months_left = -(-left // c.monthly_paise) if left else (0 if left == 0 else None)
    return {
        "id": c.id,
        "title": c.title,
        "monthly_paise": c.monthly_paise,
        "category_id": c.category_id,
        "category": names.get(c.category_id) if c.category_id else None,
        "total_paise": c.total_paise,
        "paid_paise": paid,
        "left_paise": left,
        "months_left": months_left,
        "done": left == 0 if c.total_paise else False,
        "rules": [
            {"min_income_paise": int(r["min_income_paise"]), "monthly_paise": int(r["monthly_paise"])}
            for r in sorted(c.rules or [], key=lambda r: int(r.get("min_income_paise", 0)))
        ],
        "match_words": list(c.match_words or []),
        "starts_on": c.starts_on.isoformat(),
        "active": c.active,
        "notes": c.notes,
    }


def active_commitments(s: Session, user_id: int) -> list[Commitment]:
    return list(
        s.scalars(select(Commitment).where(Commitment.user_id == user_id, Commitment.active.is_(True)).order_by(Commitment.id))
    )


def profile_json(s: Session, user_id: int) -> dict[str, Any]:
    p = get_profile(s, user_id)
    names = dict(s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all())
    commitments = [
        commitment_json(s, user_id, c, names)
        for c in s.scalars(select(Commitment).where(Commitment.user_id == user_id).order_by(Commitment.active.desc(), Commitment.id))
    ]
    notes = [
        {"id": n.id, "text": n.text, "created_at": n.created_at.astimezone(IST).isoformat()}
        for n in s.scalars(select(MoneyNote).where(MoneyNote.user_id == user_id).order_by(MoneyNote.id))
    ]
    committed = sum(c["monthly_paise"] for c in commitments if c["active"] and not c["done"])
    monthly_income = p.monthly_income_paise if p else None
    return {
        "monthly_income_paise": monthly_income,
        "income_note": p.income_note if p else None,
        "committed_paise": committed,
        "after_commitments_paise": monthly_income - committed if monthly_income else None,
        "commitments": commitments,
        "notes": notes,
    }


def context(s: Session, user_id: int) -> str:
    """The memory as lines for an AI's instructions (Ask and the check-in)."""
    data = profile_json(s, user_id)
    lines = []
    if data["monthly_income_paise"]:
        note = f" ({data['income_note']})" if data["income_note"] else ""
        lines.append(f"- Monthly income: {rupees(data['monthly_income_paise'])}{note}.")
    else:
        lines.append("- Monthly income: not known yet.")
    for c in data["commitments"]:
        if not c["active"]:
            continue
        parts = [f"- Commitment: {c['title']}, {rupees(c['monthly_paise'])} a month"]
        if c["rules"]:
            parts.append(
                "; rules: "
                + ", ".join(f"{rupees(r['monthly_paise'])} once income is {rupees(r['min_income_paise'])}+" for r in c["rules"])
            )
        if c["total_paise"]:
            parts.append(
                f"; {rupees(c['paid_paise'])} of {rupees(c['total_paise'])} paid"
                + (", paid off" if c["done"] else f", about {c['months_left']} months left")
            )
        if c["notes"]:
            parts.append(f" ({c['notes']})")
        lines.append("".join(parts) + ".")
    for n in data["notes"]:
        lines.append(f"- Note: {n['text']}")
    from . import goals

    lines.extend(goals.context_lines(s, user_id))
    if data["after_commitments_paise"] is not None:
        left = data["after_commitments_paise"]
        save = left // 5 // 1000 * 1000
        lines.append(f"- Income left after commitments: {rupees(left)} a month.")
        lines.append(
            f"- Saving 20% of that is {rupees(save)} a month, which leaves {rupees(left - save)} a month "
            "for everyday spending and planned items."
        )
    return "What Finlyt remembers about my money:\n" + "\n".join(lines)


# ── Changes (from the AI's tools, the check-in, or the memory screen) ─────────


def set_income(s: Session, user_id: int, monthly_paise: int, note: str | None = None) -> list[Update]:
    if monthly_paise <= 0:
        raise ApiError(422, "bad_income", "Income has to be more than zero")
    p = get_profile(s, user_id)
    if p is None:
        p = MoneyProfile(user_id=user_id)
        s.add(p)
    before, before_note = p.monthly_income_paise, p.income_note
    p.monthly_income_paise = monthly_paise
    if note is not None:
        p.income_note = note.strip()[:200] or None
    updates: list[Update] = []
    if before != monthly_paise or before_note != p.income_note:
        was = f" (was {rupees(before)})" if before and before != monthly_paise else ""
        updates.append(Update("income", f"Monthly income {rupees(monthly_paise)}{was}"))
    for c in active_commitments(s, user_id):
        new = amount_for(c, monthly_paise)
        if new != c.monthly_paise:
            updates.append(Update("commitment", f"{c.title}: {rupees(c.monthly_paise)} → {rupees(new)} a month, from your income rule"))
            c.monthly_paise = new
    s.flush()
    return updates


_SMALL = {"the", "a", "an", "for", "of", "to", "my", "and", "monthly", "every", "month"}


def title_key(title: str) -> str:
    words = "".join(ch.lower() if ch.isalnum() else " " for ch in title).split()
    return " ".join(sorted(w for w in words if w not in _SMALL))


def find_commitment(s: Session, user_id: int, title: str) -> Commitment | None:
    key = title_key(title)
    for c in s.scalars(select(Commitment).where(Commitment.user_id == user_id)):
        if title_key(c.title) == key or c.title.lower() == title.lower():
            return c
    return None


def _category_id(s: Session, user_id: int, name: str | None) -> int | None:
    if not name:
        return None
    cats = {n.lower(): cid for cid, n in s.execute(select(Category.id, Category.name).where(Category.user_id == user_id)).all()}
    return cats.get(name.strip().lower())


def save_commitment(
    s: Session,
    user_id: int,
    *,
    title: str,
    monthly_paise: int,
    category: str | None = None,
    category_id: int | None = None,
    total_paise: int | None = None,
    paid_before_paise: int | None = None,
    rules: list[dict] | None = None,
    match_words: list[str] | None = None,
    notes: str | None = None,
    starts_on: date | None = None,
) -> tuple[Commitment, Update | None]:
    """Add a commitment, or change the one with the same title. No update if nothing changed."""
    title = title.strip()[:120]
    if not title or monthly_paise <= 0:
        raise ApiError(422, "bad_commitment", "A commitment needs a name and a monthly amount")
    c = find_commitment(s, user_id, title)
    is_new = c is None
    fields = ("monthly_paise", "category_id", "total_paise", "paid_before_paise", "rules", "match_words", "notes", "active")
    before = None if c is None else tuple(getattr(c, f) for f in fields)
    if c is None:
        c = Commitment(user_id=user_id, title=title, monthly_paise=monthly_paise, starts_on=(starts_on or today_ist()).replace(day=1))
        s.add(c)
    c.monthly_paise = monthly_paise
    if category_id is not None or category:
        c.category_id = category_id if category_id is not None else _category_id(s, user_id, category)
    if total_paise is not None:
        c.total_paise = total_paise if total_paise > 0 else None
    if paid_before_paise is not None:
        c.paid_before_paise = max(paid_before_paise, 0)
    if rules is not None:
        tiers = [
            {"min_income_paise": int(r["min_income_paise"]), "monthly_paise": int(r["monthly_paise"])}
            for r in rules
            if int(r.get("monthly_paise", 0)) > 0 and int(r.get("min_income_paise", -1)) >= 0
        ]
        # "₹6,000 once I earn ₹55,000" also means the amount I give now applies below that.
        if tiers and min(t["min_income_paise"] for t in tiers) > 0:
            tiers.append({"min_income_paise": 0, "monthly_paise": monthly_paise})
        c.rules = sorted(tiers, key=lambda t: t["min_income_paise"])
    if match_words is not None:
        c.match_words = sorted({w.strip().lower()[:40] for w in match_words if w.strip()})
    elif is_new:
        c.match_words = sorted({w for w in title.lower().replace(",", " ").split() if len(w) > 3})[:4]
    if notes is not None:
        c.notes = notes.strip() or None
    if starts_on is not None:
        c.starts_on = starts_on.replace(day=1)
    c.active = True
    # The income rule wins over a stated amount when income is known.
    current = amount_for(c, income(s, user_id))
    c.monthly_paise = current
    s.flush()
    if before is not None and before == tuple(getattr(c, f) for f in fields):
        return c, None
    what = f"{c.title}: {rupees(c.monthly_paise)} a month"
    if c.total_paise:
        what += f", {rupees(c.total_paise)} in all"
    return c, Update("commitment", ("Remembered " if is_new else "Updated ") + what)


def add_note(s: Session, user_id: int, text: str) -> Update:
    text = text.strip()[:300]
    if not text:
        raise ApiError(422, "empty_note", "Nothing to remember")
    s.add(MoneyNote(user_id=user_id, text=text))
    s.flush()
    return Update("note", f"Remembered: {text}")


def get_commitment(s: Session, user_id: int, commitment_id: int) -> Commitment:
    c = s.get(Commitment, commitment_id)
    if c is None or c.user_id != user_id:
        raise ApiError(404, "not_found", "That commitment isn't there any more.")
    return c


def get_note(s: Session, user_id: int, note_id: int) -> MoneyNote:
    n = s.get(MoneyNote, note_id)
    if n is None or n.user_id != user_id:
        raise ApiError(404, "not_found", "That note isn't there any more.")
    return n


def apply_rupees_commitment(s: Session, user_id: int, args: dict) -> Update | None:
    """A commitment as an AI states it (rupees, category name, income rules)."""
    rules = [
        {"min_income_paise": to_paise(r.get("when_income_at_least_rupees", 0)), "monthly_paise": to_paise(r.get("monthly_rupees", 0))}
        for r in args.get("rules") or []
        if isinstance(r, dict)
    ]
    _, update = save_commitment(
        s,
        user_id,
        title=str(args.get("title") or ""),
        monthly_paise=to_paise(args.get("monthly_rupees") or 0),
        category=args.get("category"),
        total_paise=to_paise(args["total_rupees"]) if args.get("total_rupees") else None,
        paid_before_paise=to_paise(args["already_paid_rupees"]) if args.get("already_paid_rupees") else None,
        rules=rules or None,
        match_words=args.get("match_words"),
        notes=args.get("notes"),
    )
    return update
