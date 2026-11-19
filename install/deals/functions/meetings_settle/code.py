#input_type_name: MeetingsSettleInput
#output_type_name: MeetingsSettleResult
#function_name: meetings_settle

"""The person settles how a meeting was sorted, or changes it: its kind, and
whether it gets a brief.

What they chose is kept as a correction with what the read saw, so the next
twenty reads carry it as a worked example; the rest of a repeating series takes
the same answer and is never asked again. A meeting that now gets a brief is
planned (or asked for, when it is due); one that no longer does drops its plan.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KINDS = ["customer", "investor", "candidate", "partner", "internal", "other"]


class MeetingsSettleInput(BaseModel):
    meeting_id: str
    kind: str | None = None
    # Left out: a brief exactly when the kind is switched on.
    wants_brief: bool | None = None


class MeetingsSettleResult(BaseModel):
    kind: str | None
    wants_brief: bool | None
    series: int
    brief_state: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _due(start: datetime, brief_when: str, zone: ZoneInfo) -> datetime:
    if brief_when == "hour_before":
        return start - timedelta(hours=1)
    local = start.astimezone(zone)
    return datetime.combine(local.date() - timedelta(days=1), time(18, 0), zone).astimezone(timezone.utc)


def meetings_settle(ctx: FunctionContext, data: MeetingsSettleInput) -> MeetingsSettleResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    if data.kind is not None and data.kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    meeting = pod.table("meeting").get(data.meeting_id)
    work = pod.table("meetings_work").get(data.meeting_id)
    settings = (_rows(pod.query("SELECT kinds_on, brief_when, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    kinds_on = set(settings.get("kinds_on") or [])
    kind = data.kind or meeting.get("kind")
    if kind not in KINDS:
        raise ValueError("Say what kind of meeting it is.")
    wants = data.wants_brief if data.wants_brief is not None else (kind in kinds_on)

    pod.table("meetings_correction").create({
        "meeting_id": data.meeting_id, "from_kind": meeting.get("kind"), "to_kind": kind,
        "from_brief": meeting.get("wants_brief"), "to_brief": wants,
        "evidence": (work.get("evidence") or f"Title: {meeting.get('title')}")[:1600],
    })

    targets = [meeting]
    if meeting.get("series_id"):
        targets += [r for r in _rows(pod.query(
            "SELECT m.id, m.start_at, m.status FROM meeting m JOIN meetings_work w ON w.id = m.id "
            f"WHERE m.series_id = {_sql(meeting['series_id'])} AND m.source_account = {_sql(meeting['source_account'])} "
            f"AND m.id <> {_sql(data.meeting_id)} AND (w.sorted_by IS NULL OR w.sorted_by <> 'person')"))]
    when = (_parse(meeting.get("start_at")) or now).astimezone(zone).strftime("%d %b")
    brief_state = work.get("brief_state") or "none"
    for target in targets:
        own = target["id"] == data.meeting_id
        pod.table("meeting").update(target["id"], {"kind": kind, "wants_brief": wants})
        patch: dict[str, Any] = {"sorted_by": "person", "sorted_at": now.isoformat(), "unsure": False,
                                 "reason": "You set this" if own else f"As you set it for the one on {when}"}
        start = _parse(target.get("start_at"))
        state = work.get("brief_state") if own else None
        if state is None:
            state = pod.table("meetings_work").get(target["id"]).get("brief_state")
        if start and start > now and target.get("status") != "cancelled":
            if wants and state in ("none", "planned", "failed"):
                due = _due(start, settings.get("brief_when") or "evening_before", zone)
                patch.update({"brief_state": "wanted" if due <= now else "planned", "brief_due_at": due.isoformat(),
                              "brief_error": None})
            elif not wants and state == "planned":
                patch.update({"brief_state": "none", "brief_due_at": None})
        pod.table("meetings_work").update(target["id"], patch)
        if own:
            brief_state = patch.get("brief_state", state)
    return MeetingsSettleResult(
        kind=kind, wants_brief=wants, series=len(targets) - 1, brief_state=brief_state,
        message=f"Kept as {kind}, " + ("with a brief" if wants else "no brief")
        + (f", and {len(targets) - 1} more in the series" if len(targets) > 1 else ""),
    )
