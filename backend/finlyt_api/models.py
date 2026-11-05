"""Database tables. Money is integer paise; times are timestamptz; data is scoped per user."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

TXN_STATUSES = ("pending", "logged", "transfer", "payback", "income", "refund", "ignored")
SMS_STATUSES = ("pending", "parsed", "duplicate", "not_txn", "failed")


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
    created_at: Mapped[datetime] = _created()

    due: Mapped[Due] = relationship(back_populates="settlements")
