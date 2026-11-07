"""Request bodies and query strings. Amounts are integer paise."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class GoogleLoginIn(_In):
    id_token: str = Field(min_length=20, max_length=4096)
    device: str | None = Field(default=None, max_length=120)


class PaymentIn(_In):
    account_id: int
    amount_paise: int = Field(gt=0)
    bank_txn_id: int | None = None


class DueIn(_In):
    """Someone owes me part of this expense. Give an existing person_id or a name."""

    person_id: int | None = None
    person_name: str | None = Field(default=None, min_length=1, max_length=64)
    amount_paise: int = Field(gt=0)

    @model_validator(mode="after")
    def _exactly_one_person(self) -> DueIn:
        if (self.person_id is None) == (self.person_name is None):
            raise ValueError("give exactly one of person_id or person_name")
        return self


class ExpenseIn(_In):
    occurred_at: datetime
    description: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    payments: list[PaymentIn] = Field(min_length=1)
    dues: list[DueIn] = Field(default_factory=list)
    # Defaults to total paid minus dues.
    my_share_paise: int | None = Field(default=None, ge=0)
    note_raw: str | None = Field(default=None, max_length=4000)

    @property
    def total_paise(self) -> int:
        return sum(p.amount_paise for p in self.payments)

    @model_validator(mode="after")
    def _balanced(self) -> ExpenseIn:
        dues = sum(d.amount_paise for d in self.dues)
        if dues > self.total_paise:
            raise ValueError("dues add up to more than the total paid")
        if self.my_share_paise is None:
            self.my_share_paise = self.total_paise - dues
        elif self.my_share_paise + dues != self.total_paise:
            raise ValueError("my_share_paise plus dues must equal the total paid")
        return self


class ExpensePatch(_In):
    """Only the fields you send change. Sending payments or dues replaces them."""

    occurred_at: datetime | None = None
    description: str | None = Field(default=None, min_length=1, max_length=200)
    category_id: int | None = None
    payments: list[PaymentIn] | None = Field(default=None, min_length=1)
    dues: list[DueIn] | None = None
    my_share_paise: int | None = Field(default=None, ge=0)
    note_raw: str | None = Field(default=None, max_length=4000)


class DateRangeQuery(BaseModel):
    """IST dates, both inclusive."""

    model_config = ConfigDict(extra="ignore")
    from_: date | None = Field(default=None, alias="from")
    to: date | None = None


class ExpenseListQuery(DateRangeQuery):
    category_id: int | None = None
    account_id: int | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class SettlementIn(_In):
    """Someone paying me back. It settles their open dues, oldest first."""

    person_id: int | None = None
    person_name: str | None = Field(default=None, min_length=1, max_length=64)
    amount_paise: int = Field(gt=0)
    # The UPI/bank credit it arrived as; none means cash.
    bank_txn_id: int | None = None
    settled_at: datetime | None = None

    @model_validator(mode="after")
    def _exactly_one_person(self) -> SettlementIn:
        if (self.person_id is None) == (self.person_name is None):
            raise ValueError("give exactly one of person_id or person_name")
        return self


class DebtIn(_In):
    """Money I owe someone (they paid for me). Give an existing person_id or a name."""

    person_id: int | None = None
    person_name: str | None = Field(default=None, min_length=1, max_length=64)
    amount_paise: int = Field(gt=0)
    description: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    occurred_at: datetime | None = None
    note_raw: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _exactly_one_person(self) -> DebtIn:
        if (self.person_id is None) == (self.person_name is None):
            raise ValueError("give exactly one of person_id or person_name")
        return self


class RepayIn(_In):
    """Me paying back what I owed: by a UPI debit (bank_txn_id) or cash/another account."""

    person_id: int | None = None
    person_name: str | None = Field(default=None, min_length=1, max_length=64)
    amount_paise: int = Field(gt=0)
    bank_txn_id: int | None = None
    account_id: int | None = None
    paid_at: datetime | None = None

    @model_validator(mode="after")
    def _exactly_one_person(self) -> RepayIn:
        if (self.person_id is None) == (self.person_name is None):
            raise ValueError("give exactly one of person_id or person_name")
        return self


class ProposeIn(_In):
    """JSON form of POST /api/log/propose (text only). Voice notes come as multipart."""

    text: str | None = Field(default=None, max_length=4000)
    txn_ids: list[int] | None = Field(default=None, max_length=60)


class LogCommitIn(_In):
    """A reviewed proposal, saved in one database transaction."""

    expenses: list[ExpenseIn] = Field(default_factory=list, max_length=50)
    settlements: list[SettlementIn] = Field(default_factory=list, max_length=20)
    transfers: list[int] = Field(default_factory=list, max_length=60)
    ignored: list[int] = Field(default_factory=list, max_length=60)
    debts: list[DebtIn] = Field(default_factory=list, max_length=20)
    repayments: list[RepayIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _something_to_save(self) -> LogCommitIn:
        if not (
            self.expenses or self.settlements or self.transfers or self.ignored or self.debts or self.repayments
        ):
            raise ValueError("nothing to save")
        if set(self.transfers) & set(self.ignored):
            raise ValueError("a transaction can't be both a transfer and ignored")
        resolved = set(self.transfers) | set(self.ignored)
        paid = {p.bank_txn_id for e in self.expenses for p in e.payments if p.bank_txn_id}
        paid |= {st.bank_txn_id for st in self.settlements if st.bank_txn_id}
        paid |= {r.bank_txn_id for r in self.repayments if r.bank_txn_id}
        if resolved & paid:
            raise ValueError("a transaction marked as transfer or ignored is also used for a payment")
        return self


class ChatMessageIn(_In):
    role: Literal["user", "finlyt"]
    text: str = Field(min_length=1, max_length=2000)


class PlanChatIn(_In):
    """The check-in conversation so far (empty to start it)."""

    messages: list[ChatMessageIn] = Field(default_factory=list, max_length=40)


class PlannedItemIn(_In):
    description: str = Field(min_length=1, max_length=200)
    amount_paise: int = Field(gt=0)
    due_on: date | None = None
    category_id: int | None = None


class PlanIn(_In):
    """A plan the user confirmed: this month's budget, limits from today, planned items.

    `daily_limit_paise` is the usual day; `big_day_limit_paise` and `big_days_per_week` are the
    optional bigger days (leave them out, or 0, for one flat limit).
    """

    monthly_budget_paise: int = Field(gt=0)
    daily_limit_paise: int = Field(gt=0)
    big_day_limit_paise: int | None = Field(default=None, gt=0)
    big_days_per_week: int = Field(default=0, ge=0, le=6)
    planned_items: list[PlannedItemIn] = Field(default_factory=list, max_length=40)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _bigger_days(self) -> PlanIn:
        if self.big_days_per_week and (self.big_day_limit_paise or 0) <= self.daily_limit_paise:
            raise ValueError("A bigger day's limit has to be more than the usual day's")
        return self


class CheckInIn(_In):
    """The weekly check-in day, Monday 0 to Sunday 6."""

    weekday: int = Field(ge=0, le=6)


class SmsIn(_In):
    """One bank SMS from the phone. Non-bank messages never get uploaded."""

    device_id: str | None = Field(default=None, max_length=64)
    sender: str = Field(min_length=1, max_length=64)
    body: str = Field(min_length=1, max_length=2000)
    received_at: datetime


class SmsSyncIn(_In):
    messages: list[SmsIn] = Field(default_factory=list, max_length=500)


class TxnResolveIn(_In):
    status: Literal["transfer", "ignored", "income", "pending"]


# ── Import from an AI chat ───────────────────────────────────────────────────

ImportSource = Literal["claude", "chatgpt", "gemini", "other"]


class ImportPreviewIn(_In):
    """The AI chat's reply, pasted in."""

    text: str = Field(min_length=2, max_length=1_000_000)
    source: ImportSource = "other"


class ImportDueIn(_In):
    person_name: str = Field(min_length=1, max_length=64)
    amount_paise: int = Field(gt=0)


class ImportEntryIn(_In):
    """One entry from the preview, as the user kept it."""

    kind: Literal["expense", "payback", "owe", "repay"]
    occurred_at: datetime
    description: str = Field(min_length=1, max_length=200)
    category_id: int | None = None
    amount_paise: int = Field(gt=0)
    my_share_paise: int | None = Field(default=None, ge=0)
    payments: list[PaymentIn] = Field(default_factory=list, max_length=6)
    dues: list[ImportDueIn] = Field(default_factory=list, max_length=12)
    person_name: str | None = Field(default=None, min_length=1, max_length=64)
    note_raw: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _complete(self) -> ImportEntryIn:
        if self.kind == "expense" and not self.payments:
            raise ValueError("an expense needs how it was paid")
        if self.kind != "expense" and not self.person_name:
            raise ValueError(f"a {self.kind} needs a person")
        return self


class ImportCommitIn(_In):
    source: ImportSource = "other"
    raw_text: str | None = Field(default=None, max_length=1_000_000)
    entries: list[ImportEntryIn] = Field(min_length=1, max_length=3000)


# ── What Finlyt remembers ────────────────────────────────────────────────────


class IncomeIn(_In):
    monthly_income_paise: int = Field(gt=0)
    note: str | None = Field(default=None, max_length=200)


class IncomeRuleIn(_In):
    min_income_paise: int = Field(ge=0)
    monthly_paise: int = Field(gt=0)


class CommitmentIn(_In):
    title: str = Field(min_length=1, max_length=120)
    monthly_paise: int = Field(gt=0)
    category_id: int | None = None
    total_paise: int | None = Field(default=None, gt=0)
    paid_before_paise: int | None = Field(default=None, ge=0)
    rules: list[IncomeRuleIn] | None = Field(default=None, max_length=6)
    match_words: list[str] | None = Field(default=None, max_length=8)
    notes: str | None = Field(default=None, max_length=1000)


class CommitmentPatch(_In):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    monthly_paise: int | None = Field(default=None, gt=0)
    total_paise: int | None = Field(default=None, ge=0)
    paid_before_paise: int | None = Field(default=None, ge=0)
    rules: list[IncomeRuleIn] | None = Field(default=None, max_length=6)
    active: bool | None = None


# ── Savings goals ────────────────────────────────────────────────────────────


class GoalIn(_In):
    name: str = Field(min_length=1, max_length=80)
    target_paise: int = Field(gt=0)
    due_on: date | None = None


class GoalPatch(_In):
    """Only the fields sent change. Send due_on: null to clear the date."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    target_paise: int | None = Field(default=None, gt=0)
    due_on: date | None = None
    archived: bool | None = None


class DepositIn(_In):
    """Money put towards a goal (positive) or taken back out (negative)."""

    amount_paise: int
    note: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _not_zero(self) -> DepositIn:
        if self.amount_paise == 0:
            raise ValueError("An amount of zero doesn't change anything")
        return self
