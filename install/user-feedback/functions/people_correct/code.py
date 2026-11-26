#input_type_name: PeopleCorrectInput
#output_type_name: PeopleCorrectResult
#function_name: people_correct

"""The owner says who someone is: someone they deal with after all, or not
(remove them), or what they are to them. Or adds someone missing, by address.

Each change is kept as a correction with the evidence the read saw, so the
newest twenty go with every read as examples, and the person's own answer
stands: the read never asks over it. Removing someone also takes them out of
the team view (the owner's own row only).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PERSON_NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")   # Mail's, so ids match
LINK_NS = uuid.UUID("eb4518c8-84e0-4a47-94f1-4b999aa61771")
KINDS = ["customer", "investor", "partner", "candidate", "vendor", "colleague", "other"]
KIND_NAMES = {"customer": "a customer", "investor": "an investor", "partner": "a partner", "candidate": "a candidate",
              "vendor": "a vendor", "colleague": "a colleague", "other": "other"}


class PeopleCorrectInput(BaseModel):
    person_id: str | None = None
    # Add someone missing: their address (and name, if known).
    handle: str | None = None
    name: str | None = None
    deal_with: bool | None = None
    kind: str | None = None


class PeopleCorrectResult(BaseModel):
    ok: bool
    person_id: str | None = None
    corrections: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def people_correct(ctx: FunctionContext, data: PeopleCorrectInput) -> PeopleCorrectResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    if data.kind is not None and data.kind not in KINDS:
        return PeopleCorrectResult(ok=False, corrections=0, message=f"'{data.kind}' isn't one of {', '.join(KINDS)}.")
    pid = data.person_id
    handle = (data.handle or "").strip().lower()
    if not pid and handle:
        if "@" not in handle or len(handle) > 320:
            return PeopleCorrectResult(ok=False, corrections=0, message="That isn't an email address.")
        found = _rows(pod.query(
            f"SELECT person_id FROM person_handle WHERE kind = 'email' AND handle = {_sql(handle)} LIMIT 1"))
        if found:
            pid = found[0]["person_id"]
        else:
            pid = str(uuid.uuid5(PERSON_NS, f"{ctx.user_id}:email:{handle}"))
            name = (data.name or "").strip()[:200] or None
            pod.records.bulk_create("person", [{"id": pid, "name": name, "org": None, "title": None, "is_vip": False}], upsert=True)
            pod.records.bulk_create("person_handle", [{"id": str(uuid.uuid5(PERSON_NS, f"{pid}:email:{handle}")),
                                                      "person_id": pid, "kind": "email", "handle": handle,
                                                      "display_name": name}], upsert=True)
        if data.deal_with is None:
            data.deal_with = True
    if not pid:
        return PeopleCorrectResult(ok=False, corrections=0, message="Say who: a person or an address.")

    person = (_rows(pod.query(f"SELECT name FROM person WHERE id = {_sql(pid)}")) or [{}])[0]
    old = (_rows(pod.query(f"SELECT * FROM people_person WHERE id = {_sql(pid)}")) or [None])[0]
    if old is None:
        if not handle:
            handle = ((_rows(pod.query(
                f"SELECT handle FROM person_handle WHERE person_id = {_sql(pid)} AND kind = 'email' LIMIT 1")) or [{}])[0]
                .get("handle") or "")
        pod.records.bulk_create("people_person", [{
            "id": pid, "handle": handle or None, "domain": handle.rsplit("@", 1)[-1] if "@" in handle else None,
            "in_scope": True, "summary_state": "none",
            "evidence": f"Name: {person.get('name') or '(no name)'}\nAddress: {handle}\nAdded by the owner; "
                        "nothing in their conversations or meetings yet.",
        }], upsert=True)
        old = {"id": pid, "deal_with": None, "kind": None, "evidence": None}

    patch: dict[str, Any] = {"sorted_by": "person", "sorted_at": now, "unsure": False}
    corrections = []
    evidence = old.get("evidence")
    if data.deal_with is not None:
        patch["deal_with"] = data.deal_with
        patch["in_scope"] = True if data.deal_with else old.get("in_scope", True)
        if data.deal_with is False:
            patch["kind"] = None
            patch["quiet"] = False
        before = {True: "someone", False: "noise"}.get(old.get("deal_with"))
        after = "someone" if data.deal_with else "noise"
        if before != after or old.get("sorted_by") != "person":
            corrections.append({"field": "deal_with", "from_value": before, "to_value": after})
    if data.deal_with is True and data.kind is None and not old.get("kind"):
        # Kept or added without saying what they are: ask the owner, not a model.
        patch["unsure"] = True
        patch["reason"] = "You keep them; what are they to you?"
    if data.kind is not None:
        patch["kind"] = data.kind
        patch["deal_with"] = True
        if old.get("kind") != data.kind or old.get("sorted_by") != "person":
            corrections.append({"field": "kind", "from_value": old.get("kind"), "to_value": data.kind})
    pod.table("people_person").update(pid, patch)
    if corrections:
        pod.records.bulk_create("people_correction", [
            {"id": str(uuid.uuid4()), "person_id": pid, **c, "evidence": evidence} for c in corrections])
    if data.deal_with is False:
        h = handle or (old.get("handle") or "")
        if h:
            lid = str(uuid.uuid5(LINK_NS, f"{ctx.user_id}:{h}"))
            if _rows(pod.query(f"SELECT id FROM people_link WHERE id = {_sql(lid)}")):
                pod.table("people_link").delete(lid)

    who = person.get("name") or handle or "They"
    if data.deal_with is False:
        message = f"Removed {who}. Reads learn from it."
    elif data.kind is not None:
        message = f"{who} is {KIND_NAMES[data.kind]}. Reads learn from it."
    elif data.deal_with:
        message = f"Added {who}." if data.handle else f"Kept {who}. Reads learn from it."
    else:
        message = "Nothing changed."
    return PeopleCorrectResult(ok=True, person_id=pid, corrections=len(corrections), message=message)
