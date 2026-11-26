#input_type_name: PeopleSaveCompanyInput
#output_type_name: PeopleSaveCompanyResult
#function_name: people_save_company

"""Keep what the look-up found on the company: the write-up and its sources on
People map's own row, and the facts (what they do, industry, size, where,
website) on the shared company where they are still empty, and only when a
page confirmed the company at its domain. A name is replaced only while it is
still the guess made from the domain."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class PeopleSaveCompanyInput(BaseModel):
    company_id: str
    result: dict = {}


class PeopleSaveCompanyResult(BaseModel):
    ok: bool
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _clip(value: Any, size: int) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:size] or None


def people_save_company(ctx: FunctionContext, data: PeopleSaveCompanyInput) -> PeopleSaveCompanyResult:
    pod = ctx.pod
    cid = data.company_id
    company = (_rows(pod.query(f"SELECT * FROM company WHERE id = {_sql(cid)}")) or [{}])[0]
    result = data.result or {}
    research = str(result.get("research") or "").strip()
    if not research and not result.get("description"):
        pod.table("people_company").update(cid, {"research_state": "failed", "research_error": "The look-up found nothing."})
        return PeopleSaveCompanyResult(ok=False, message="The look-up found nothing.")
    now = datetime.now(timezone.utc).isoformat()
    pod.table("people_company").update(cid, {
        "research": research[:4000] or None, "research_state": "ready", "researched_at": now, "research_error": None,
        "research_sources": [
            {"title": _clip(s.get("title"), 160), "url": str(s.get("url") or "")[:500]}
            for s in (result.get("sources") or [])[:6]
            if isinstance(s, dict) and str(s.get("url") or "").startswith(("http://", "https://"))
        ],
    })
    patch: dict[str, Any] = {}
    if result.get("found") is not True:
        return PeopleSaveCompanyResult(ok=True, message="Looked up; no company confirmed at that domain, so nothing about it was changed.")
    for field, size in (("description", 400), ("industry", 120), ("size", 60), ("location", 160)):
        value = _clip(result.get(field), size)
        if value and not company.get(field):
            patch[field] = value
    website = str(result.get("website") or "").strip()
    if website.startswith(("http://", "https://")) and not company.get("website"):
        patch["website"] = website[:300]
    name = _clip(result.get("name"), 200)
    if name and company.get("name_from", "domain") == "domain":
        patch["name"] = name
        patch["name_from"] = "looked_up"
    if patch:
        pod.table("company").update(cid, patch)
    return PeopleSaveCompanyResult(ok=True, message=f"Looked up {patch.get('name') or company.get('name') or 'the company'}.")
