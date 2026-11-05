"""Banks whose SMS Finlyt can read. The phone uses these filters before uploading anything."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bank:
    code: str
    name: str
    # Case-insensitive substrings of the SMS sender id, e.g. "KOTAKB" in "AX-KOTAKB-S".
    sender_patterns: tuple[str, ...]
    # Case-insensitive substrings of the SMS body that identify the bank.
    body_markers: tuple[str, ...]


BANKS: dict[str, Bank] = {
    "kotak": Bank(
        code="kotak",
        name="Kotak Mahindra Bank",
        sender_patterns=("KOTAKB",),
        body_markers=("Kotak Bank",),
    ),
    "dns": Bank(
        code="dns",
        name="DNS Bank (Dombivli Nagari Sahakari Bank)",
        sender_patterns=(),
        body_markers=("-DNS Bank",),
    ),
}
