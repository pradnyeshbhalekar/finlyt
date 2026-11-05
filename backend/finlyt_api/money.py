"""Rupee/paise helpers. Money is stored as integer paise everywhere."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation


def to_paise(rupees: float | int | str) -> int:
    """₹12.345 → 1235. Goes through Decimal so 0.1 + 0.2 style float noise can't leak in."""
    try:
        value = Decimal(str(rupees))
    except InvalidOperation as e:
        raise ValueError(f"not an amount: {rupees!r}") from e
    return int((value * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rupees(paise: int) -> str:
    """Indian-style grouping: 123456789 → ₹12,34,567.89; whole rupees drop the decimals."""
    sign = "-" if paise < 0 else ""
    whole, fraction = divmod(abs(paise), 100)
    digits = str(whole)
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        digits = ",".join([*groups, tail])
    return f"{sign}₹{digits}" + (f".{fraction:02d}" if fraction else "")
