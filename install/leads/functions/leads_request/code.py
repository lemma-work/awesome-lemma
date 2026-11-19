#input_type_name: LeadsRequestInput
#output_type_name: LeadsRequestResult
#function_name: leads_request

"""Ask for a look-up: from the app's "Look up" or from chat ("look up Mira").

Finds the person among the asker's own people (People map) by `person_id`,
their email address (`handle`), or `name`. They join the queue and take one
of today's look-ups if any are left (leads_claim, best first), or wait for
tomorrow's. `force` looks them up now, past the daily limit, or again when
they were looked up already: only when the person asked for that.

Asking for someone "worth looking up?" had skipped is kept as a correction,
so the next answer learns from it. Colleagues and people marked "other" are
never looked up, nor anyone with no company (a personal address).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NEVER = {"colleague", "other"}


class LeadsRequestInput(BaseModel):
    person_id: str | None = None
    handle: str | None = None
    name: str | None = None
    force: bool = False


class LeadsRequestResult(BaseModel):
    ok: bool
    person_id: str | None = None
    state: str | None = None
    message: str
    matches: list[dict] = []


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def leads_request(ctx: FunctionContext, data: LeadsRequestInput) -> LeadsRequestResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    settings = (_rows(pod.query(
        "SELECT setup_step, timezone, daily_limit FROM leads_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if not settings or settings.get("setup_step") != "done":
        return LeadsRequestResult(ok=False, message="Lead research isn't set up for you yet: open Leads to set it up.")
    cols = ("SELECT pp.id, p.name, pp.handle, pp.kind, pp.deal_with, pp.company_id, c.name AS company FROM people_person pp "
            "JOIN person p ON p.id = pp.id LEFT JOIN company c ON c.id = pp.company_id ")
    if data.person_id:
        found = _rows(pod.query(cols + f"WHERE pp.id = {_sql(data.person_id)}"))
    elif data.handle:
        h = data.handle.strip().lower()
        found = _rows(pod.query(cols + f"WHERE lower(pp.handle) = {_sql(h)} OR pp.id IN "
                                       f"(SELECT person_id FROM person_handle WHERE lower(handle) = {_sql(h)}) LIMIT 5"))
    elif data.name and data.name.strip():
        like = "%" + data.name.strip().lower().replace("%", "").replace("_", "") + "%"
        found = _rows(pod.query(cols + f"WHERE lower(p.name) LIKE {_sql(like)} AND pp.in_scope IS TRUE "
                                       "ORDER BY pp.last_contact_at DESC NULLS LAST LIMIT 6"))
    else:
        return LeadsRequestResult(ok=False, message="Say who: a person's id, their email address or their name.")
    if not found:
        return LeadsRequestResult(ok=False, message="No one like that among your people in People map.")
    if len(found) > 1:
        return LeadsRequestResult(ok=False, message=f"{len(found)} people match; say which.",
                                  matches=[{"person_id": r["id"], "name": r.get("name"), "handle": r.get("handle"),
                                            "company": r.get("company")} for r in found])
    p = found[0]
    pid, name = p["id"], p.get("name") or p.get("handle") or "them"
    if p.get("kind") in NEVER:
        return LeadsRequestResult(ok=False, person_id=pid, message=f"{name} is marked {p['kind']} in People map; Lead research doesn't look them up.")
    if not p.get("company_id"):
        return LeadsRequestResult(ok=False, person_id=pid, message=f"{name} writes from a personal address, so there's no company to look up.")

    lead = (_rows(pod.query(f"SELECT * FROM leads_person WHERE id = {_sql(pid)}")) or [None])[0]
    state = (lead or {}).get("state")
    if state in ("wanted", "looking"):
        return LeadsRequestResult(ok=True, person_id=pid, state=state, message=f"{name} is being looked up now.")
    if state == "ready" and not data.force:
        return LeadsRequestResult(ok=True, person_id=pid, state=state,
                                  message=f"{name} was looked up on {str(lead.get('looked_up_at') or '')[:10]}. Ask again to look again.")
    if lead and lead.get("worth") is False and lead.get("worth_by") == "decision" and lead.get("evidence"):
        pod.table("leads_correction").create({"field": "worth", "subject_id": pid, "from_value": "skip",
                                              "to_value": "look_up", "evidence": lead["evidence"]})
    patch: dict[str, Any] = {"worth": True, "worth_by": "person", "worth_at": now, "kind": p.get("kind"),
                             "company_id": p.get("company_id")}
    if not lead or lead.get("worth_by") != "decision":
        patch["worth_reason"] = "You asked for it"
    if data.force:
        patch.update({"state": "wanted", "wanted_at": now, "forced": True})
    else:
        patch["state"] = "queued"
    if lead:
        pod.table("leads_person").update(pid, patch)
    else:
        pod.records.bulk_create("leads_person", [dict(patch, id=pid)], upsert=True)
    if data.force:
        return LeadsRequestResult(ok=True, person_id=pid, state="wanted", message=f"Looking {name} up now, past today's limit.")
    limit = max(1, int(settings.get("daily_limit") or 10))
    try:
        zone = ZoneInfo(settings.get("timezone") or "UTC")
    except Exception:  # noqa: BLE001
        zone = ZoneInfo("UTC")
    local = datetime.now(timezone.utc).astimezone(zone)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    used = int((_rows(pod.query(
        f"SELECT COUNT(*) AS n FROM leads_person WHERE wanted_at >= '{day_start}' AND sample IS NOT TRUE AND forced IS NOT TRUE")) or [{}])[0].get("n") or 0)
    if used < limit:
        return LeadsRequestResult(ok=True, person_id=pid, state="queued",
                                  message=f"Looking {name} up now ({used + 1} of today's {limit}).")
    return LeadsRequestResult(ok=True, person_id=pid, state="queued",
                              message=f"Today's {limit} look-ups are used, so {name} waits for tomorrow's. "
                                      "Ask to look them up anyway to go past the limit.")
