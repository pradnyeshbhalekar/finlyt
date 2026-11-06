"""Database tables. Money is integer paise; times are timestamptz; data is scoped per user."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

TXN_STATUSES = ("pending", "logged", "transfer", "payback", "income", "refund", "ignored")
SMS_STATUSES = ("pending", "parsed", "duplicate", "not_txn", "failed")


# Defined out here: inside AskMessage, `text` is a column and hides SQLAlchemy's text().
EMPTY_JSON = text("'{}'::jsonb")


def one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def _created():
    return mapped_column(DateTime(timezone=True), server_default=func.now())


def _updated():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def _owner():
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"))


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    google_sub: Mapped[str] = mapped_column(String(128), unique=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str | None] = mapped_column(String(120))
    picture_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The weekly planning check-in's day, Monday 0 to Sunday 6 (the time lives on the phone,
    # which sends the reminder). Weeks for "bigger days" start on this day.
    check_in_weekday: Mapped[int] = mapped_column(SmallInteger, server_default=text("6"))


class AuthSession(Base):
    """An app session. Only the SHA-256 of the token is stored."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = _created()
    last_used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "name"),
        CheckConstraint(one_of("kind", ("bank", "cash")), name="kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(64))
    kind: Mapped[str] = mapped_column(String(8))
    # Which SMS parser handles this account (see banks.py); null for cash.
    bank_code: Mapped[str | None] = mapped_column(String(16))
    last4: Mapped[str | None] = mapped_column(String(4))
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[datetime] = _created()


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(48))
    emoji: Mapped[str] = mapped_column(String(16), server_default=text("''"))
    color: Mapped[str] = mapped_column(String(16), server_default=text("'#64748b'"))
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class ImportBatch(Base):
    """One import from an AI chat (Claude, ChatGPT, Gemini…). Deleting it undoes the import."""

    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(32), server_default=text("'claude_chat'"))
    raw_text: Mapped[str] = mapped_column(Text)
    entry_count: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    created_at: Mapped[datetime] = _created()


class SmsMessage(Base):
    __tablename__ = "sms_messages"
    __table_args__ = (
        UniqueConstraint("user_id", "body_hash"),
        CheckConstraint(one_of("parse_status", SMS_STATUSES), name="parse_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    account_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"))
    sender: Mapped[str] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    device_msg_id: Mapped[str | None] = mapped_column(String(64))
    body_hash: Mapped[str] = mapped_column(String(64))
    parse_status: Mapped[str] = mapped_column(String(16), server_default=text("'pending'"))
    parser: Mapped[str | None] = mapped_column(String(32))
    parse_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()


class BankTxn(Base):
    __tablename__ = "bank_txns"
    __table_args__ = (
        CheckConstraint(one_of("direction", ("debit", "credit")), name="direction"),
        CheckConstraint(one_of("channel", ("upi", "card", "atm", "neft", "imps", "other")), name="channel"),
        CheckConstraint(one_of("status", TXN_STATUSES), name="status"),
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        Index(
            "uq_bank_txns_account_reference",
            "account_id",
            "reference",
            unique=True,
            postgresql_where=text("reference IS NOT NULL"),
        ),
        Index("ix_bank_txns_user_status_occurred", "user_id", "status", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    sms_id: Mapped[int | None] = mapped_column(
        ForeignKey("sms_messages.id", ondelete="SET NULL"), unique=True
    )
    direction: Mapped[str] = mapped_column(String(8))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    channel: Mapped[str] = mapped_column(String(8), server_default=text("'other'"))
    # UPI ID or the name the bank shows, as written in the SMS.
    counterparty: Mapped[str | None] = mapped_column(String(128))
    reference: Mapped[str | None] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), server_default=text("'pending'"))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("total_paise > 0", name="total_positive"),
        CheckConstraint(
            "my_share_paise >= 0 AND my_share_paise <= total_paise", name="share_within_total"
        ),
        CheckConstraint(one_of("source", ("log", "manual", "import")), name="source"),
        Index("ix_expenses_user_occurred", "user_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    description: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    # Everything I paid, across all payment legs.
    total_paise: Mapped[int] = mapped_column(BigInteger)
    # What counts as my spending: total minus what others owe me.
    my_share_paise: Mapped[int] = mapped_column(BigInteger)
    # What I said or typed when logging it.
    note_raw: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(16))
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    payments: Mapped[list[ExpensePayment]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="ExpensePayment.id"
    )
    dues: Mapped[list[Due]] = relationship(
        back_populates="expense", cascade="all, delete-orphan", order_by="Due.id"
    )


class ExpensePayment(Base):
    """One leg of how an expense was paid, e.g. ₹120 from Kotak + ₹30 cash."""

    __tablename__ = "expense_payments"
    __table_args__ = (CheckConstraint("amount_paise > 0", name="amount_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    bank_txn_id: Mapped[int | None] = mapped_column(
        ForeignKey("bank_txns.id", ondelete="SET NULL"), index=True
    )

    expense: Mapped[Expense] = relationship(back_populates="payments")


class Person(Base):
    __tablename__ = "people"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(64))
    # Lower-cased UPI IDs and bank display names this person pays from.
    aliases: Mapped[list[str]] = mapped_column(ARRAY(String(128)), server_default=text("'{}'"))
    created_at: Mapped[datetime] = _created()


Index("uq_people_user_lower_name", Person.user_id, func.lower(Person.name), unique=True)


class Due(Base):
    """Money someone owes me for an expense I paid."""

    __tablename__ = "dues"
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        CheckConstraint(one_of("status", ("open", "settled", "written_off")), name="status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    expense_id: Mapped[int] = mapped_column(ForeignKey("expenses.id", ondelete="CASCADE"), index=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), index=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), server_default=text("'open'"))
    created_at: Mapped[datetime] = _created()

    expense: Mapped[Expense] = relationship(back_populates="dues")
    person: Mapped[Person] = relationship()
    settlements: Mapped[list[Settlement]] = relationship(
        back_populates="due", cascade="all, delete-orphan", order_by="Settlement.id"
    )


class Settlement(Base):
    """A payback against a due, by a credit txn, cash, or from an import."""

    __tablename__ = "settlements"
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        CheckConstraint(one_of("method", ("txn", "cash", "import")), name="method"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    due_id: Mapped[int] = mapped_column(ForeignKey("dues.id", ondelete="CASCADE"), index=True)
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    method: Mapped[str] = mapped_column(String(8))
    bank_txn_id: Mapped[int | None] = mapped_column(
        ForeignKey("bank_txns.id", ondelete="SET NULL"), index=True
    )
    settled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = _created()

    due: Mapped[Due] = relationship(back_populates="settlements")


class Budget(Base):
    """My spending budget for a calendar month (IST). `month` is the 1st of that month."""

    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_budgets_user_month"),
        CheckConstraint("amount_paise > 0", name="amount_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    month: Mapped[date] = mapped_column(Date)
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class SpendingPlan(Base):
    """What a check-in with Finlyt agreed: limits for everyday spending from `starts_on`.

    `daily_limit_paise` is the usual day. Optionally a few bigger days a week get a higher limit
    (`big_day_limit_paise`, `big_days_per_week`): a day that goes past the usual limit uses one up,
    while that week has some left. The plan in effect on a day is the latest one that started on
    or before it. Money not spent under a day's limit is kept aside for unplanned things (the
    buffer), not added to later days.
    """

    __tablename__ = "plans"
    __table_args__ = (
        UniqueConstraint("user_id", "starts_on", name="uq_plans_user_starts_on"),
        CheckConstraint("daily_limit_paise > 0", name="daily_limit_positive"),
        CheckConstraint("big_days_per_week BETWEEN 0 AND 6", name="big_days_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    starts_on: Mapped[date] = mapped_column(Date)
    daily_limit_paise: Mapped[int] = mapped_column(BigInteger)
    big_day_limit_paise: Mapped[int | None] = mapped_column(BigInteger)
    big_days_per_week: Mapped[int] = mapped_column(SmallInteger, server_default=text("0"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class PlannedItem(Base):
    """A bigger expense set aside before the daily limit: rent, a trip, a bill.

    Spending in its category during its month counts against it, not against the daily limit.
    """

    __tablename__ = "planned_items"
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        Index("ix_planned_items_user_month", "user_id", "month"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    month: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(String(200))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created()


class Debt(Base):
    """Money I owe someone, e.g. they paid for my movie ticket.

    It isn't spending yet: when I pay it back (a UPI debit matched from bank SMS, or cash), the
    repayment becomes an expense, so the money is counted once, when it actually leaves.
    """

    __tablename__ = "debts"
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="amount_positive"),
        CheckConstraint(one_of("status", ("open", "settled")), name="status"),
        Index("ix_debts_user_status", "user_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), index=True)
    description: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), server_default=text("'open'"))
    note_raw: Mapped[str | None] = mapped_column(Text)
    # The expense created when it was paid back.
    expense_id: Mapped[int | None] = mapped_column(ForeignKey("expenses.id", ondelete="SET NULL"))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = _created()

    person: Mapped[Person] = relationship()


class AskThread(Base):
    """An Ask Finlyt chat. Chats not touched for ASK_KEEP_DAYS are deleted."""

    __tablename__ = "ask_threads"
    __table_args__ = (Index("ix_ask_threads_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    title: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()

    messages: Mapped[list[AskMessage]] = relationship(
        order_by="AskMessage.id", cascade="all, delete-orphan", passive_deletes=True
    )


class AskMessage(Base):
    __tablename__ = "ask_messages"
    __table_args__ = (CheckConstraint(one_of("role", ("user", "finlyt")), name="role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    thread_id: Mapped[int] = mapped_column(ForeignKey("ask_threads.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(8))
    text: Mapped[str] = mapped_column(Text)
    # Which model answered and which data tools it looked at (Finlyt's turns only).
    model: Mapped[str | None] = mapped_column(String(64))
    tools_used: Mapped[list[str]] = mapped_column(ARRAY(String(64)), server_default="{}")
    # Answers to tap when Finlyt asked a question back (the user can also type their own).
    options: Mapped[list[str]] = mapped_column(ARRAY(String(120)), server_default="{}")
    # What came with the answer: a month report to show, follow-up questions, memory it saved.
    extras: Mapped[dict] = mapped_column(JSONB, server_default=EMPTY_JSON)
    created_at: Mapped[datetime] = _created()


class MoneyProfile(Base):
    """What Finlyt remembers about my money in general: my monthly income (take-home)."""

    __tablename__ = "money_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    monthly_income_paise: Mapped[int | None] = mapped_column(BigInteger)
    income_note: Mapped[str | None] = mapped_column(String(200))
    updated_at: Mapped[datetime] = _updated()


class Commitment(Base):
    """Money I've promised every month, like ₹3,000 to my sister for a ₹24,000 laptop.

    `rules` change the amount with my income: [{"min_income_paise": 5500000, "monthly_paise":
    600000}] means ₹6,000 a month once I earn ₹55,000. `match_words` are words in a logged
    expense that mean a payment towards it, so progress towards `total_paise` can be counted.
    """

    __tablename__ = "commitments"
    __table_args__ = (CheckConstraint("monthly_paise > 0", name="monthly_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    title: Mapped[str] = mapped_column(String(120))
    monthly_paise: Mapped[int] = mapped_column(BigInteger)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    total_paise: Mapped[int | None] = mapped_column(BigInteger)
    paid_before_paise: Mapped[int] = mapped_column(BigInteger, server_default=text("0"))
    match_words: Mapped[list[str]] = mapped_column(ARRAY(String(40)), server_default="{}")
    rules: Mapped[list] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    starts_on: Mapped[date] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class MoneyNote(Base):
    """Anything else worth remembering about my money ("salary comes on the 1st")."""

    __tablename__ = "money_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = _owner()
    text: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = _created()
