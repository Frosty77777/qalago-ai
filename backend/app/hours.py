"""Evaluate a 2GIS weekly `schedule` at a given moment.

2GIS omits days on which a place is closed, so a schedule with some days present and the
current day missing means "closed". A missing schedule or timezone is "unknown"; it is
never treated as open.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

from .providers.twogis import DAYS

Status = Literal["open", "closed", "unknown"]


def _minutes(value: str) -> int | None:
    try:
        hours, minutes = value.split(":")
        return int(hours) * 60 + int(minutes)
    except (AttributeError, ValueError):
        return None


def _intervals(schedule: dict, day: str) -> list[tuple[int, int]]:
    out = []
    for item in (schedule.get(day) or {}).get("working_hours") or []:
        start, end = _minutes(item.get("from")), _minutes(item.get("to"))
        if start is not None and end is not None:
            out.append((start, end))
    return out


def status_at(schedule: dict | None, tz_offset_min: int | None, when_utc: datetime) -> tuple[Status, str | None]:
    """Return (status, local closing time "HH:MM" when open)."""
    if not schedule or tz_offset_min is None:
        return "unknown", None
    if schedule.get("is_24x7"):
        return "open", None
    if not any(day in schedule for day in DAYS):
        return "unknown", None
    local = when_utc + timedelta(minutes=tz_offset_min)
    now = local.hour * 60 + local.minute
    today, yesterday = DAYS[local.weekday()], DAYS[(local.weekday() - 1) % 7]
    for start, end in _intervals(schedule, today):
        if start == end or (end == 1440 and start == 0):
            return "open", None
        if start < end and start <= now < end:
            return "open", f"{end // 60 % 24:02d}:{end % 60:02d}"
        if end < start and now >= start:  # Overnight interval that started today.
            return "open", f"{end // 60:02d}:{end % 60:02d}"
    for start, end in _intervals(schedule, yesterday):
        if end < start and now < end:  # Overnight interval that started yesterday.
            return "open", f"{end // 60:02d}:{end % 60:02d}"
    return "closed", None
