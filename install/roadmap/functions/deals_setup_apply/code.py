#input_type_name: DealsSetupApplyInput
#output_type_name: DealsSetupApplyResult
#function_name: deals_setup_apply

"""Keep the team's stages and currency (set-up, and Settings later). Only
during set-up does it move the person's set-up on; from Settings it changes
the team's stages and nothing about anyone's set-up.

Stages are matched by id, then by name: a renamed stage renames itself on
every deal, a new one is added, one left out is removed and its deals move to
the first open stage (each move in the deal's history). There must be at
least one open stage, one won and one lost, and no two with one name.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SETTINGS_ID = "7d6c2f1e-5a40-4b8e-9c13-2f0e8a6b4d51"


class DealsSetupApplyInput(BaseModel):
    stages: list[dict] | None = None
    currency: str | None = None
    timezone: str | None = None
    display_name: str | None = None


class DealsSetupApplyResult(BaseModel):
    stages: list[dict]
    currency: str
    renamed: int
    moved: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _j(value: Any) -> Any:
    """A JSON column takes an object or a list, never a bare number or string
    (the datastore passes a scalar to Postgres unencoded and refuses it), so a
    history value is kept as {"v": value}."""
    return value if value is None or isinstance(value, (dict, list)) else {"v": value}


def deals_setup_apply(ctx: FunctionContext, data: DealsSetupApplyInput) -> DealsSetupApplyResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    member = (_rows(pod.query("SELECT id, display_name, timezone, setup_step FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    my_name = data.display_name or member.get("display_name") or ctx.user_email
    existing = _rows(pod.query("SELECT id, name, kind, meaning, position FROM deals_stage ORDER BY position, name"))
    renamed = moved = 0

    if data.stages is not None:
        wanted = []
        for s in data.stages:
            if not isinstance(s, dict):
                continue
            name = " ".join(str(s.get("name") or "").split())[:80]
            if not name:
                continue
            kind = s.get("kind") if s.get("kind") in ("open", "won", "lost") else "open"
            wanted.append({"id": s.get("id"), "name": name, "kind": kind,
                           "meaning": " ".join(str(s.get("meaning") or "").split())[:300] or None})
        names = [w["name"].lower() for w in wanted]
        if len(set(names)) != len(names):
            raise ValueError("Two stages have the same name.")
        kinds = {w["kind"] for w in wanted}
        if not {"open", "won", "lost"} <= kinds:
            raise ValueError("Keep at least one open stage, one for won and one for lost.")
        # Open stages first, then won, then lost: the board reads left to right.
        order = {"open": 0, "won": 1, "lost": 2}
        wanted.sort(key=lambda w: order[w["kind"]])
        by_id = {s["id"]: s for s in existing}
        by_name = {s["name"].lower(): s for s in existing}
        kept_ids: set[str] = set()
        creates, updates = [], []
        for position, w in enumerate(wanted):
            old = by_id.get(w.get("id") or "") or by_name.get(w["name"].lower())
            row = {"name": w["name"], "kind": w["kind"], "meaning": w["meaning"], "position": position}
            if old and old["id"] not in kept_ids:
                kept_ids.add(old["id"])
                updates.append({"id": old["id"], **row})
                if old["name"] != w["name"]:
                    deals = _rows(pod.query(f"SELECT id FROM deal WHERE stage = {_sql(old['name'])} LIMIT 5000"))
                    if deals:
                        pod.records.bulk_update("deal", [{"id": d["id"], "stage": w["name"], "status": w["kind"]} for d in deals])
                        renamed += len(deals)
            else:
                creates.append(row)
        if updates:
            pod.records.bulk_update("deals_stage", updates)
        if creates:
            pod.records.bulk_create("deals_stage", creates)
        gone = [s for s in existing if s["id"] not in kept_ids]
        first_open = next(w["name"] for w in wanted if w["kind"] == "open")
        for s in gone:
            deals = _rows(pod.query(f"SELECT id, stage FROM deal WHERE stage = {_sql(s['name'])} LIMIT 5000"))
            for d in deals:
                pod.table("deal").update(d["id"], {"stage": first_open, "status": "open", "closed_at": None})
                pod.records.create("deals_history", {
                    "deal_id": d["id"], "field": "stage", "from_value": _j(s["name"]), "to_value": _j(first_open),
                    "by_user_id": ctx.user_id, "by_name": my_name, "how": "person", "at": now})
                moved += 1
            pod.table("deals_stage").delete(s["id"])

    settings = (_rows(pod.query("SELECT id, currency FROM deals_settings LIMIT 1")) or [None])[0]
    currency = (data.currency or (settings or {}).get("currency") or "USD").strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("A currency is three letters, like EUR or USD.")
    patch = {"currency": currency}
    if data.timezone:
        patch["timezone"] = data.timezone
    if settings:
        pod.table("deals_settings").update(settings["id"], patch)
    else:
        pod.records.create("deals_settings", {"id": SETTINGS_ID, **patch, "timezone": data.timezone or member.get("timezone") or "UTC",
                                              "set_up_by": ctx.user_id, "set_up_by_name": my_name, "set_up_at": now})
    # During set-up this moves the person on to bringing in deals; saving the
    # stages from Settings afterwards never sends anyone back into set-up.
    if member.get("id") and member.get("setup_step") in ("start", "stages", "currency"):
        pod.table("deals_member").update(member["id"], {"setup_step": "existing"})
    stages = _rows(pod.query("SELECT id, name, kind, meaning FROM deals_stage ORDER BY position, name"))
    parts = [f"{len(stages)} stages", currency]
    if renamed:
        parts.append(f"{renamed} deals renamed")
    if moved:
        parts.append(f"{moved} deals moved")
    return DealsSetupApplyResult(stages=stages, currency=currency, renamed=renamed, moved=moved, message=", ".join(parts))
