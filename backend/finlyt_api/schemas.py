"""Request bodies and query strings. Amounts are integer paise."""

from __future__ import annotations

from datetime import date, datetime

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

    @model_validator(mode="after")
    def _something_to_save(self) -> LogCommitIn:
        if not (self.expenses or self.settlements or self.transfers or self.ignored):
            raise ValueError("nothing to save")
        if set(self.transfers) & set(self.ignored):
            raise ValueError("a transaction can't be both a transfer and ignored")
        resolved = set(self.transfers) | set(self.ignored)
        paid = {p.bank_txn_id for e in self.expenses for p in e.payments if p.bank_txn_id}
        paid |= {st.bank_txn_id for st in self.settlements if st.bank_txn_id}
        if resolved & paid:
            raise ValueError("a transaction marked as transfer or ignored is also used for a payment")
        return self
