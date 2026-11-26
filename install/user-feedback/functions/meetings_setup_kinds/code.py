#input_type_name: MeetingsSetupKindsInput
#output_type_name: MeetingsSetupKindsResult
#function_name: meetings_setup_kinds

"""Keep which kinds of meeting get a brief, and re-decide every meeting the
person has not settled from the answers the read already gave, so changing a
switch never asks the Decisions API again.

A kind switched off means no brief. A kind switched on takes the read's own
answer to "does it need a brief?"; when that answer was not sure, the meeting
waits for the person. Internal meetings (read from domains) get a brief
exactly when internal is switched on.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KINDS = ["customer", "investor", "candidate", "partner", "internal", "other"]
KIND_NAMES = {"customer": "customers", "investor": "investors", "candidate": "candidates", "partner": "partners",
              "internal": "internal meetings", "other": "anything else"}
SURE = {"kind": 0.5, "needs_brief": 0.55}


class MeetingsSetupKindsInput(BaseModel):
    kinds_on: list[str]
    # From set-up: move the person's set-up on to the next step.
    setup: bool = False


class MeetingsSetupKindsResult(BaseModel):
    kinds_on: list[str]
    changed: int
    briefs_ahead: int
    unsure: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def meetings_setup_kinds(ctx: FunctionContext, data: MeetingsSetupKindsInput) -> MeetingsSetupKindsResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    kinds_on = [k for k in KINDS if k in set(data.kinds_on)]
    settings = (_rows(pod.query("SELECT id FROM meetings_settings LIMIT 1")) or [None])[0]
    if settings is None:
        raise ValueError("No Meetings settings yet: start the set-up first.")
    patch: dict[str, Any] = {"kinds_on": kinds_on}
    if data.setup:
        patch["setup_step"] = "timing"
    pod.table("meetings_settings").update(settings["id"], patch)

    rows = _rows(pod.query(
        "SELECT m.id, m.kind, m.wants_brief, m.start_at, w.answers, w.sorted_by, w.unsure, w.reason "
        "FROM meeting m JOIN meetings_work w ON w.id = m.id "
        "WHERE w.sorted_by IN ('decision', 'domains') AND m.status <> 'cancelled' LIMIT 5000"))
    meeting_rows, work_rows = [], []
    for r in rows:
        answers = r.get("answers") or {}
        kind = (answers.get("kind") or {}).get("value")
        k_conf = (answers.get("kind") or {}).get("confidence")
        brief = (answers.get("needs_brief") or {}).get("value")
        b_conf = (answers.get("needs_brief") or {}).get("confidence")
        if r.get("sorted_by") == "domains":
            kind, k_conf, brief, b_conf = "internal", None, True, None
        kind_sure = kind in KINDS and (k_conf is None or k_conf >= SURE["kind"])
        brief_sure = isinstance(brief, bool) and (b_conf is None or b_conf >= SURE["needs_brief"])
        if not kind_sure:
            wants, unsure, reason = None, True, r.get("reason") or "Not sure what kind of meeting"
            kind = None
        elif kind not in kinds_on:
            wants, unsure, reason = False, False, f"{kind.capitalize()}: you don't brief {KIND_NAMES[kind]}"
        elif not brief_sure:
            wants, unsure, reason = None, True, f"{kind.capitalize()}, not sure it needs a brief"
        else:
            wants, unsure = brief, False
            reason = "Only your own people are on it." if r.get("sorted_by") == "domains" else \
                f"{kind.capitalize()}, " + ("worth a brief" if brief else "no brief needed")
        if wants != r.get("wants_brief") or kind != r.get("kind") or unsure != bool(r.get("unsure")):
            meeting_rows.append({"id": r["id"], "kind": kind, "wants_brief": wants})
            work_rows.append({"id": r["id"], "unsure": unsure, "reason": reason[:300]})
    for i in range(0, len(meeting_rows), 100):
        pod.records.bulk_update("meeting", meeting_rows[i : i + 100])
    for i in range(0, len(work_rows), 100):
        pod.records.bulk_update("meetings_work", work_rows[i : i + 100])

    counts = (_rows(pod.query(
        f"SELECT SUM(CASE WHEN m.wants_brief IS TRUE AND m.status <> 'cancelled' AND m.start_at > '{now}' THEN 1 ELSE 0 END) AS ahead, "
        "SUM(CASE WHEN w.unsure IS TRUE AND m.status <> 'cancelled' THEN 1 ELSE 0 END) AS unsure "
        "FROM meeting m JOIN meetings_work w ON w.id = m.id")) or [{}])[0]
    ahead, unsure = int(counts.get("ahead") or 0), int(counts.get("unsure") or 0)
    return MeetingsSetupKindsResult(
        kinds_on=kinds_on, changed=len(meeting_rows), briefs_ahead=ahead, unsure=unsure,
        message=f"{ahead} meeting{'s' if ahead != 1 else ''} ahead will get a brief" + (f", {unsure} not sure" if unsure else ""),
    )
