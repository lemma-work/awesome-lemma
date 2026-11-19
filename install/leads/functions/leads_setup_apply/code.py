#input_type_name: LeadsSetupApplyInput
#output_type_name: LeadsSetupApplyResult
#function_name: leads_setup_apply

"""Set-up: keep who fits the team (a sentence and a few example companies,
one per Lemma: whoever sets up writes it, anyone may change it), and the
person's own kinds of people to look up and how many look-ups a day.
Returns the passes for reading everyone once: `leads_consider` reads forty at
a time."""

from __future__ import annotations

import hashlib
import math
import uuid
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

ALLOWED = {"customer", "investor", "partner", "candidate", "vendor"}
PROFILE_NS = uuid.UUID("7d2f4b1c-9a3e-4c58-8e61-2b0f5d9c4a17")
PASS = 40


class LeadsSetupApplyInput(BaseModel):
    fit_sentence: str = ""
    fit_examples: list[str] = []
    kinds: list[str] = ["customer", "investor", "partner"]
    daily_limit: int = 10


class LeadsSetupApplyResult(BaseModel):
    pending: int
    passes: list[int]
    kinds: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def fit_version(sentence: str | None, examples: list[str] | None) -> str:
    text = " ".join((sentence or "").split()).lower() + "|" + "|".join(sorted(" ".join(e.split()).lower() for e in examples or []))
    return hashlib.sha1(text.encode()).hexdigest()[:16]


def leads_setup_apply(ctx: FunctionContext, data: LeadsSetupApplyInput) -> LeadsSetupApplyResult:
    pod = ctx.pod
    sentence = " ".join((data.fit_sentence or "").split())[:400] or None
    examples = []
    for e in data.fit_examples or []:
        e = " ".join(str(e).split())[:120]
        if e and e.lower() not in {x.lower() for x in examples}:
            examples.append(e)
    kinds = [k for k in data.kinds if k in ALLOWED] or ["customer", "investor", "partner"]
    limit = max(1, min(int(data.daily_limit or 10), 100))
    settings = (_rows(pod.query("SELECT id, display_name FROM leads_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if sentence:
        pod.records.bulk_create("leads_profile", [{
            "id": str(uuid.uuid5(PROFILE_NS, "profile")), "fit_sentence": sentence, "fit_examples": examples[:12],
            "fit_version": fit_version(sentence, examples), "set_by": str(ctx.user_id),
            "set_by_name": (settings or {}).get("display_name"), "set_at": datetime.now(timezone.utc).isoformat(),
        }], upsert=True)
    patch = {"kinds": kinds, "daily_limit": limit, "setup_step": "reading"}
    if settings:
        pod.table("leads_settings").update(settings["id"], patch)
    else:
        pod.table("leads_settings").create(patch)
    pending = int((_rows(pod.query(
        "SELECT COUNT(*) AS n FROM people_person pp LEFT JOIN leads_person lp ON lp.id = pp.id "
        "WHERE pp.in_scope IS TRUE AND pp.deal_with IS TRUE AND lp.id IS NULL "
        f"AND pp.kind IN ({', '.join(_sql(k) for k in kinds)})")) or [{}])[0].get("n") or 0)
    passes = list(range(1, max(1, math.ceil(pending / PASS)) + 1))
    return LeadsSetupApplyResult(pending=pending, passes=passes, kinds=kinds,
                                 message=f"{pending} to read, {len(passes)} pass(es).")
