#input_type_name: PeopleSaveSummaryInput
#output_type_name: PeopleSaveSummaryResult
#function_name: people_save_summary

"""Keep "where things stand" on the person, with the sources it cites, and
the durable facts the writer noticed, each with the source it came from.

A [n] that points at no source is dropped rather than shown as a dead link,
and a sentence without one is kept but counted: the page shows the sources,
never their words, which stay in the conversations they came from. A fact
already kept (or one the owner forgot) is not added again.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MARK = re.compile(r"\[(\d{1,2})\]")
FACT_NS = uuid.UUID("19be5534-c524-4291-b840-73c812092f39")


class PeopleSaveSummaryInput(BaseModel):
    person_id: str
    result: dict = {}
    sources: list[dict] = []


class PeopleSaveSummaryResult(BaseModel):
    ok: bool
    cited: int
    uncited_sentences: int
    facts_added: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def people_save_summary(ctx: FunctionContext, data: PeopleSaveSummaryInput) -> PeopleSaveSummaryResult:
    pod = ctx.pod
    people = pod.table("people_person")
    text = " ".join(str(data.result.get("summary") or "").split())
    if not text:
        people.update(data.person_id, {"summary_state": "failed", "summary_error": "The writer returned nothing."})
        return PeopleSaveSummaryResult(ok=False, cited=0, uncited_sentences=0, facts_added=0,
                                       message="The writer returned nothing.")
    known = {int(s["n"]): s for s in data.sources if isinstance(s, dict) and s.get("n") is not None}
    text = MARK.sub(lambda m: m.group(0) if int(m.group(1)) in known else "", text).strip()
    cited = sorted({int(n) for n in MARK.findall(text)})
    sentences = [s for s in re.split(r"(?<=[.!?\]])\s+(?=[A-Z])", text) if s.strip()]
    uncited = sum(1 for s in sentences if not MARK.search(s))
    sources = [{k: known[n].get(k) for k in ("n", "kind", "id", "label", "at")} for n in cited]
    now = datetime.now(timezone.utc).isoformat()
    people.update(data.person_id, {
        "summary": text[:2000], "summary_sources": sources, "summary_state": "ready", "summary_at": now,
        "summary_error": None,
    })

    have = {r["id"] for r in _rows(pod.query(f"SELECT id FROM people_fact WHERE person_id = {_sql(data.person_id)}"))}
    new_facts = []
    for item in (data.result.get("facts") or [])[:6]:
        if not isinstance(item, dict):
            continue
        fact = " ".join(str(item.get("fact") or "").split())[:300]
        if len(fact) < 4:
            continue
        fid = str(uuid.uuid5(FACT_NS, f"{data.person_id}:{fact.lower().rstrip('.')}"))
        if fid in have:
            continue
        have.add(fid)
        try:
            src = known.get(int(item.get("source_n")))
        except (TypeError, ValueError):
            src = None
        if not src:
            continue  # a fact without its source is not kept
        new_facts.append({"id": fid, "person_id": data.person_id, "fact": fact,
                          "source_kind": "meeting" if src.get("kind") == "meeting" else "conversation",
                          "source_id": str(src.get("id"))[:64], "source_label": str(src.get("label") or "")[:300],
                          "state": "active"})
    if new_facts:
        pod.records.bulk_create("people_fact", new_facts)
    return PeopleSaveSummaryResult(ok=True, cited=len(sources), uncited_sentences=uncited, facts_added=len(new_facts),
                                   message=f"Wrote where things stand, citing {len(sources)} source(s); "
                                           f"{len(new_facts)} fact(s) remembered.")
