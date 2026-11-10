"""Who a bank payment was with, from the UPI ID or name the bank shows."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Person


def find_or_create_person(s: Session, user_id: int, name: str) -> Person:
    clean = " ".join(name.split())
    person = s.scalar(select(Person).where(Person.user_id == user_id, func.lower(Person.name) == clean.lower()))
    if person is None:
        person = Person(user_id=user_id, name=clean.title() if clean.islower() else clean)
        s.add(person)
        s.flush()
    return person


def learn_alias(person: Person, counterparty: str | None) -> None:
    """Remember the UPI ID or bank name a person was matched by, for next time."""
    if not counterparty:
        return
    alias = counterparty.strip().lower()[:128]
    if alias and alias not in (person.aliases or []):
        person.aliases = [*(person.aliases or []), alias]  # reassign so SQLAlchemy sees the change
