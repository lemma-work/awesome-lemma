#input_type_name: PeopleCompanyEditInput
#output_type_name: PeopleCompanyEditResult
#function_name: people_company_edit

"""A person changes a company: renames it, merges it into another (acme.co.uk
into acme.com: its domains, people and notes move, and it goes), or moves one
domain out into a company of its own. Companies are team-wide, so this
changes them for everyone; each member's people follow on their next refresh,
and this person's straight away.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

COMPANY_NS = uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")


class PeopleCompanyEditInput(BaseModel):
    action: str  # rename | merge | split
    company_id: str
    name: str | None = None
    into_id: str | None = None
    domain: str | None = None


class PeopleCompanyEditResult(BaseModel):
    ok: bool
    company_id: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _label(domain: str) -> str:
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "net", "ac", "gov", "or", "ne"}:
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else domain


def _repoint(pod: Any, domains: list[str], into: str) -> None:
    """This person's people and every member's team rows at these domains."""
    if not domains:
        return
    mine = _rows(pod.query(f"SELECT id FROM people_person WHERE domain IN ({_in(domains)}) AND kind IS DISTINCT FROM 'colleague' AND kind IS DISTINCT FROM 'other'"))
    for i in range(0, len(mine), 100):
        pod.records.bulk_update("people_person", [{"id": r["id"], "company_id": into} for r in mine[i : i + 100]])
    likes = " OR ".join(f"LOWER(handle) LIKE {_sql('%@' + d)}" for d in domains)
    links = _rows(pod.query(f"SELECT id FROM people_link WHERE {likes}"))
    for i in range(0, len(links), 100):
        pod.records.bulk_update("people_link", [{"id": r["id"], "company_id": into} for r in links[i : i + 100]])


def people_company_edit(ctx: FunctionContext, data: PeopleCompanyEditInput) -> PeopleCompanyEditResult:
    pod = ctx.pod
    company = (_rows(pod.query(f"SELECT * FROM company WHERE id = {_sql(data.company_id)}")) or [None])[0]
    if not company:
        return PeopleCompanyEditResult(ok=False, message="That company isn't here any more.")
    domains = [r["domain"] for r in _rows(pod.query(
        f"SELECT domain FROM company_domain WHERE company_id = {_sql(data.company_id)} ORDER BY domain"))]

    if data.action == "rename":
        name = " ".join((data.name or "").split())[:200]
        if not name:
            return PeopleCompanyEditResult(ok=False, message="Give it a name.")
        pod.table("company").update(data.company_id, {"name": name, "name_from": "person"})
        return PeopleCompanyEditResult(ok=True, company_id=data.company_id, message=f"Renamed to {name}.")

    if data.action == "merge":
        into = (_rows(pod.query(f"SELECT * FROM company WHERE id = {_sql(data.into_id or '')}")) or [None])[0]
        if not into or into["id"] == company["id"]:
            return PeopleCompanyEditResult(ok=False, message="Pick another company to merge into.")
        rows = _rows(pod.query(f"SELECT id FROM company_domain WHERE company_id = {_sql(company['id'])}"))
        for i in range(0, len(rows), 100):
            pod.records.bulk_update("company_domain", [{"id": r["id"], "company_id": into["id"]} for r in rows[i : i + 100]])
        _repoint(pod, domains, into["id"])
        patch = {k: company[k] for k in ("description", "industry", "size", "location", "website")
                 if company.get(k) and not into.get(k)}
        if patch:
            pod.table("company").update(into["id"], patch)
        old = (_rows(pod.query(f"SELECT * FROM people_company WHERE id = {_sql(company['id'])}")) or [None])[0]
        if old:
            if old.get("notes"):
                kept = (_rows(pod.query(f"SELECT notes FROM people_company WHERE id = {_sql(into['id'])}")) or [{}])[0]
                notes = "\n\n".join(x for x in (kept.get("notes"), f"From {company['name']}:\n{old['notes']}") if x)[:8000]
                pod.records.bulk_create("people_company", [{"id": into["id"], "notes": notes,
                                                           "notes_at": datetime.now(timezone.utc).isoformat()}], upsert=True)
            pod.table("people_company").delete(company["id"])
        pod.table("company").delete(company["id"])
        return PeopleCompanyEditResult(ok=True, company_id=into["id"],
                                       message=f"Merged {company['name']} into {into['name']}: {', '.join(domains)} now "
                                               f"belong{'s' if len(domains) == 1 else ''} to it.")

    if data.action == "split":
        domain = (data.domain or "").strip().lower()
        if domain not in domains:
            return PeopleCompanyEditResult(ok=False, message=f"{domain or 'That domain'} isn't one of {company['name']}'s.")
        if len(domains) == 1:
            return PeopleCompanyEditResult(ok=False, message="It's the company's only domain.")
        new_id = str(uuid.uuid5(COMPANY_NS, f"company:{domain}"))
        if new_id == company["id"]:
            new_id = str(uuid.uuid4())
        words = _label(domain).replace("-", " ").split()
        pod.records.bulk_create("company", [{"id": new_id, "name": " ".join(w[:1].upper() + w[1:] for w in words) or domain,
                                             "domain": domain, "name_from": "domain"}], upsert=True)
        pod.table("company_domain").update(str(uuid.uuid5(COMPANY_NS, domain)), {"company_id": new_id})
        if company.get("domain") == domain:
            pod.table("company").update(company["id"], {"domain": next(d for d in domains if d != domain)})
        _repoint(pod, [domain], new_id)
        return PeopleCompanyEditResult(ok=True, company_id=new_id, message=f"{domain} is a company of its own now.")

    return PeopleCompanyEditResult(ok=False, message=f"Unknown action '{data.action}'.")
