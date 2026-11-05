from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

TZ_NAME = "Asia/Kolkata"
IST = ZoneInfo(TZ_NAME)


def now_utc() -> datetime:
    return datetime.now(UTC)


def today_ist() -> date:
    return datetime.now(IST).date()


def ensure_aware(dt: datetime) -> datetime:
    """Treat naive datetimes as IST."""
    return dt.replace(tzinfo=IST) if dt.tzinfo is None else dt


def to_ist_iso(dt: datetime | None) -> str | None:
    return dt.astimezone(IST).isoformat() if dt is not None else None


def ist_day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    """Inclusive IST date range -> half-open [start, end) aware datetimes."""
    return (
        datetime.combine(start, time.min, IST),
        datetime.combine(end + timedelta(days=1), time.min, IST),
    )
