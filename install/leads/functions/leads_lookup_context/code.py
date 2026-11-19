#input_type_name: LeadsLookupContextInput
#output_type_name: LeadsLookupContextResult
#function_name: leads_lookup_context

"""What the look-up needs about one person, and People map's company look-up
asked for.

Marks the person `looking` (a second fire finds it taken and stops). Then:

- People map already looks companies up on request: its trigger
  (people-lookup-wanted) fires when `people_company.research_state` becomes
  `wanted`, and writes what the company does, its size, head office and
  website onto the shared `company`, with a write-up and its sources. Lead
  research asks for it the same way the Look-them-up button does, when the
  company has none yet, it failed, or it is older than 180 days, and reads
  what it found when scoring the fit (leads_fit waits for it).
- `search` says whether the web is worth searching. A person with no company
  (a personal address) or at a reserved test domain (`.example`, `.test`,
  `.invalid`, `.localhost`, example.com) is "not found" at once, with no
  search: no page can confirm them. A sample lead already carries its facts.

Only what the whole team may see about the company goes to the agent, and
about the person only their name, the title their own mail shows, and their
address's domain: never a word of anyone's mail.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

STALE_DAYS = 180
RESERVED = (".example", ".test", ".invalid", ".localhost")
RESERVED_EXACT = {"example.com", "example.org", "example.net"}


class LeadsLookupContextInput(BaseModel):
    person_id: str


class LeadsLookupContextResult(BaseModel):
    go: bool
    search: bool
    reason: str
    started_at: str
    person: dict = {}
    company: dict = {}
    kind: str | None = None
    today: str = ""


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


def reserved(domain: str | None) -> bool:
    d = (domain or "").lower().strip(".")
    return bool(d) and (d.endswith(RESERVED) or d in RESERVED_EXACT or any(d.endswith("." + x) for x in RESERVED_EXACT))


def leads_lookup_context(ctx: FunctionContext, data: LeadsLookupContextInput) -> LeadsLookupContextResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    pid = data.person_id
    lead = (_rows(pod.query(f"SELECT * FROM leads_person WHERE id = {_sql(pid)}")) or [None])[0]
    if not lead or lead.get("state") != "wanted":
        return LeadsLookupContextResult(go=False, search=False, started_at=now.isoformat(),
                                        reason=f"Not wanted ({(lead or {}).get('state') or 'no row'}); nothing to do.")
    pod.table("leads_person").update(pid, {"state": "looking", "lookup_error": None})

    person = (_rows(pod.query(
        "SELECT p.name, p.title, p.org, pp.handle, pp.domain, pp.kind, pp.company_id FROM person p "
        f"LEFT JOIN people_person pp ON pp.id = p.id WHERE p.id = {_sql(pid)}")) or [{}])[0]
    cid = lead.get("company_id") or person.get("company_id")
    company = (_rows(pod.query(
        f"SELECT id, name, domain, website, description FROM company WHERE id = {_sql(cid)}")) or [{}])[0] if cid else {}
    domain = (company.get("domain") or person.get("domain") or "").lower()
    base = dict(started_at=now.isoformat(), kind=person.get("kind") or lead.get("kind"), today=now.strftime("%d %B %Y"))

    def nothing(summary: str, why: str) -> LeadsLookupContextResult:
        pod.table("leads_person").update(pid, {
            "state": "ready", "found": False, "facts": [], "not_found": ["role", "company"],
            "summary": summary, "looked_up_at": now.isoformat(), "lookup_seconds": 0.0,
        })
        return LeadsLookupContextResult(go=True, search=False, reason=why, **base)

    if lead.get("sample"):
        pod.table("leads_person").update(pid, {"state": "ready"})
        return LeadsLookupContextResult(go=True, search=False, reason="A sample lead carries its own facts.", **base)
    if not company:
        return nothing("Writes from a personal address, so there was no company to look them up at.", "No company.")
    if reserved(domain):
        return nothing(f"{domain} is a reserved test domain: no web page can confirm it, so nothing was searched.",
                       "Reserved test domain.")

    # Ask People map's look-up for the company, the way its button does.
    pc = (_rows(pod.query(
        f"SELECT id, research_state, researched_at FROM people_company WHERE id = {_sql(cid)}")) or [None])[0]
    old = now - timedelta(days=STALE_DAYS)
    if pc is None:
        pod.records.bulk_create("people_company", [{"id": cid, "research_state": "wanted"}], upsert=True)
    elif pc.get("research_state") in ("none", "failed", None) or (
            pc.get("research_state") == "ready" and (_parse(pc.get("researched_at")) or old) <= old):
        pod.table("people_company").update(cid, {"research_state": "wanted", "research_error": None})

    return LeadsLookupContextResult(
        go=True, search=True, reason="Looking up.",
        person={"name": person.get("name"), "title_in_their_mail": person.get("title"),
                "email_domain": domain},
        company={"name": company.get("name"), "domain": company.get("domain"), "website": company.get("website"),
                 "known": company.get("description")},
        **base)
