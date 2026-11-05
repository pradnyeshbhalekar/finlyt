"""What a new user starts with."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Account, Category, User

DEFAULT_CATEGORIES: list[tuple[str, str, str]] = [
    ("Food", "🍔", "#f97316"),
    ("Groceries", "🛒", "#22c55e"),
    ("Transport", "🛺", "#3b82f6"),
    ("Shopping", "🛍️", "#ec4899"),
    ("Bills", "🧾", "#eab308"),
    ("Rent", "🏠", "#a855f7"),
    ("Fitness", "🏋️", "#84cc16"),
    ("Entertainment", "🎬", "#ef4444"),
    ("Health", "💊", "#14b8a6"),
    ("Personal care", "💇", "#f472b6"),
    ("Education", "📚", "#6366f1"),
    ("Travel", "✈️", "#0ea5e9"),
    ("Gifts", "🎁", "#d946ef"),
    ("Investments", "📈", "#10b981"),
    ("Other", "📦", "#64748b"),
]

# (name, kind, bank_code, is_primary)
DEFAULT_ACCOUNTS: list[tuple[str, str, str | None, bool]] = [
    ("Kotak", "bank", "kotak", True),
    ("DNS Bank", "bank", "dns", False),
    ("Cash", "cash", None, False),
]


def seed_user_defaults(s: Session, user: User) -> None:
    for order, (name, emoji, color) in enumerate(DEFAULT_CATEGORIES):
        s.add(Category(user_id=user.id, name=name, emoji=emoji, color=color, sort_order=order))
    for order, (name, kind, bank_code, primary) in enumerate(DEFAULT_ACCOUNTS):
        s.add(
            Account(
                user_id=user.id,
                name=name,
                kind=kind,
                bank_code=bank_code,
                is_primary=primary,
                sort_order=order,
            )
        )
    s.flush()
