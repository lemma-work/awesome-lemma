#input_type_name: LeadsSaveInput
#output_type_name: LeadsSaveResult
#function_name: leads_save

"""Keep what the look-up confirmed, and nothing it could not.

A fact is kept only with an http(s) link that is not at a reserved test
domain, stamped with when it was found. The person's facts go on their own
`leads_person` row (the owner's alone), with the role, location and public
profile copied out for the list. The company's go on the team-wide
`leads_company` row, merged with what anyone on the team found before (a key
found again is replaced; news is kept by link, newest first, at most six).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PERSON_KEYS = {"role": "Role", "location": "Based in", "profile": "Public profile", "background": "Before this"}
COMPANY_KEYS = {"what_they_do": "What they do", "size": "Size", "head_office": "Head office", "founded": "Founded",
                "funding": "Funding", "customers": "Customers", "news": "News"}
RESERVED = (".example", ".test", ".invalid", ".localhost", "example.com", "example.org", "example.net")


class LeadsSaveInput(BaseModel):
    person_id: str
    result: dict | None = None
    started_at: str | None = None


class LeadsSaveResult(BaseModel):
    ok: bool
    person_facts: int
    company_facts: int
    news: int
    dropped: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _clip(value: Any, size: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= size else text[: size - 1] + "…"


def _url(value: Any) -> str | None:
    text = str(value or "").strip()
    try:
        parsed = urlparse(text)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or not host or "." not in host:
        return None
    if host.endswith(RESERVED):
        return None
    return text[:500]


def _site(url: str, given: Any) -> str:
    name = _clip(given, 80)
    if name:
        return name
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def leads_save(ctx: FunctionContext, data: LeadsSaveInput) -> LeadsSaveResult:
    pod = ctx.pod
    pid = data.person_id
    now = datetime.now(timezone.utc)
    lead = (_rows(pod.query(f"SELECT id, company_id FROM leads_person WHERE id = {_sql(pid)}")) or [None])[0]
    if not lead:
        return LeadsSaveResult(ok=False, person_facts=0, company_facts=0, news=0, dropped=0, message="No such lead.")
    began = None
    try:
        began = datetime.fromisoformat(str(data.started_at).replace("Z", "+00:00")) if data.started_at else None
    except ValueError:
        began = None
    seconds = round((now - began).total_seconds(), 1) if began else None

    result = data.result or {}
    if not isinstance(result, dict) or "facts" not in result:
        pod.table("leads_person").update(pid, {"state": "failed", "lookup_error": "The look-up returned nothing.",
                                               "lookup_seconds": seconds})
        return LeadsSaveResult(ok=False, person_facts=0, company_facts=0, news=0, dropped=0, message="The look-up returned nothing.")

    person_facts: list[dict] = []
    company_facts: list[dict] = []
    news: list[dict] = []
    dropped = 0
    seen: set[tuple] = set()
    for f in result.get("facts") or []:
        if not isinstance(f, dict):
            dropped += 1
            continue
        about, key = f.get("about"), f.get("key")
        url = _url(f.get("url"))
        value = _clip(f.get("value"), 300)
        keys = PERSON_KEYS if about == "person" else COMPANY_KEYS if about == "company" else {}
        if key not in keys or not url or not value:
            dropped += 1
            continue
        if key == "profile":
            value = _url(value) or url
        sig = (about, key, value.lower())
        if sig in seen:
            continue
        seen.add(sig)
        item = {"key": key, "label": keys[key], "value": value, "url": url, "source": _site(url, f.get("source")),
                "found_at": now.isoformat()}
        if f.get("date"):
            item["date"] = _clip(f.get("date"), 20)
        if about == "person":
            person_facts.append(item)
        elif key == "news":
            news.append(item)
        else:
            company_facts.append(item)
    if result.get("person_found") is not True:
        dropped += len(person_facts)
        person_facts = []
    if result.get("company_found") is not True:
        dropped += len(company_facts) + len(news)
        company_facts, news = [], []

    def first(key: str) -> str | None:
        return next((f["value"] for f in person_facts if f["key"] == key), None)

    not_found = [str(k)[:40] for k in (result.get("not_found") or []) if isinstance(k, str)][:12]
    if not person_facts and "role" not in not_found:
        not_found.insert(0, "role")
    summary = _clip(result.get("summary"), 400) if person_facts else ""
    pod.table("leads_person").update(pid, {
        "state": "ready", "found": bool(person_facts), "facts": person_facts[:12], "not_found": not_found,
        "role": first("role"), "location": first("location"), "profile_url": first("profile"),
        "summary": summary or None, "looked_up_at": now.isoformat(), "lookup_seconds": seconds, "lookup_error": None,
    })

    cid = lead.get("company_id")
    if cid:
        old = (_rows(pod.query(f"SELECT facts, news FROM leads_company WHERE id = {_sql(cid)}")) or [None])[0]
        merged = {f["key"]: f for f in ((old or {}).get("facts") or []) if isinstance(f, dict)}
        for f in company_facts:
            merged[f["key"]] = f
        by_url = {n["url"]: n for n in ((old or {}).get("news") or []) if isinstance(n, dict) and n.get("url")}
        for n in news:
            by_url[n["url"]] = n
        kept_news = sorted(by_url.values(), key=lambda n: str(n.get("date") or n.get("found_at") or ""), reverse=True)[:6]
        row = {"id": cid, "looked_up_at": now.isoformat(), "found": bool(company_facts or news) or bool((old or {}).get("facts")),
               "facts": list(merged.values()), "news": kept_news,
               "not_found": [k for k in not_found if k in COMPANY_KEYS]}
        pod.records.bulk_create("leads_company", [row], upsert=True)

    return LeadsSaveResult(ok=True, person_facts=len(person_facts), company_facts=len(company_facts), news=len(news),
                           dropped=dropped,
                           message=f"Kept {len(person_facts)} about the person, {len(company_facts)} about the company, "
                                   f"{len(news)} news; dropped {dropped} without a usable link.")
