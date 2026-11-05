"""Who a bank payment was with, from the UPI ID or name the bank shows."""

from __future__ import annotations

import re

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


def match_person(s: Session, user_id: int, counterparty: str | None) -> Person | None:
    """A known UPI ID, else a first name inside the bank's name or UPI ID. Only a single, unambiguous
    match counts: "aaditya.s@okhdfcbank" or "AADITYA SHARMA" → Aaditya."""
    if not counterparty:
        return None
    raw = counterparty.strip().lower()
    people = list(s.scalars(select(Person).where(Person.user_id == user_id)))
    by_alias = [p for p in people if raw in (a.lower() for a in (p.aliases or []))]
    if len(by_alias) == 1:
        return by_alias[0]
    local = raw.split("@", 1)[0]
    words = {w for w in re.split(r"[^a-z]+", local) if w}
    by_name = []
    for p in people:
        first = p.name.split()[0].lower() if p.name.split() else ""
        if len(first) >= 3 and (first in words or local.startswith(first)):
            by_name.append(p)
    return by_name[0] if len(by_name) == 1 else None


def learn_alias(person: Person, counterparty: str | None) -> None:
    """Remember the UPI ID or bank name a person was matched by, for next time."""
    if not counterparty:
        return
    alias = counterparty.strip().lower()[:128]
    if alias and alias not in (person.aliases or []):
        person.aliases = [*(person.aliases or []), alias]  # reassign so SQLAlchemy sees the change
