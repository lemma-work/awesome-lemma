#input_type_name: DealsProposeInput
#output_type_name: DealsProposeResult
#function_name: deals_propose

"""Keep what the extractor found as proposals, never as changes.

Each change must carry its sentence, word for word (spacing and quote marks
aside), from the text it was read in; one that doesn't is dropped and counted.
A change is checked against the deal as it is now: a stage the team has, a
value that differs from what the deal says, a deal that is still open. A
proposal the person already saw (the same deal, kind and value in the last
thirty days, kept or dismissed) is not proposed again; one still waiting for
the same deal and kind is replaced by the newer one (expired).

Nothing here touches the shared `deal`: a person keeps or dismisses each
proposal in the app (`deals_save`).
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KINDS = {"new_deal", "stage", "amount", "close_date", "next_step", "lost"}
HEADER = re.compile(r"^## (?P<who>.+?) — (?P<at>\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC", re.M)


class DealsProposeInput(BaseModel):
    items: list[dict] = []
    result: dict | None = None
    stages: list[dict] = []
    currency: str = "USD"


class DealsProposeResult(BaseModel):
    proposed: int
    dropped: int
    repeated: int
    expired: int
    message: str
    detail: list[dict] = []


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFKC", text or "")
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = re.sub(r"[*_>`]", "", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    text = str(value).lower().replace(",", "").strip()
    match = re.search(r"(\d+(?:\.\d+)?)\s*(k|m)?", text)
    if not match:
        return None
    n = float(match.group(1)) * {"k": 1_000, "m": 1_000_000}.get(match.group(2) or "", 1)
    return n if n > 0 else None


def _currency(value: Any, fallback: str) -> str:
    text = str(value or "").strip().upper()
    symbols = {"€": "EUR", "$": "USD", "£": "GBP", "₹": "INR", "¥": "JPY"}
    text = symbols.get(text, text)
    return text if re.fullmatch(r"[A-Z]{3}", text) else fallback


def _day(value: Any) -> str | None:
    text = str(value or "").strip()[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _clip(value: Any, n: int) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:n] if text else None


def _where_said(item: dict, quote: str) -> tuple[str | None, str | None]:
    """Who said the sentence and when, from the message header above it (mail)
    or the speaker's name at the start of its line (a transcript)."""
    text = item.get("text") or ""
    nq = _norm(quote)
    marks = list(HEADER.finditer(text))
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        if nq and nq in _norm(text[m.start():end]):
            who = m.group("who")
            who = re.sub(r"\s*<[^>]+>$", "", who).strip()
            at = m.group("at").replace(" ", "T") + ":00+00:00"
            return who, at
    for line in text.splitlines():
        if nq and nq in _norm(line):
            match = re.match(r"^\s*([^:]{2,60}):\s", line)
            return (match.group(1).strip() if match else None), item.get("said_at")
    return None, item.get("said_at")


def deals_propose(ctx: FunctionContext, data: DealsProposeInput) -> DealsProposeResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    changes = [c for c in ((data.result or {}).get("changes") or []) if isinstance(c, dict)]
    items = {i["ref"]: i for i in data.items if isinstance(i, dict) and i.get("ref")}
    stages = data.stages or _rows(pod.query("SELECT name, kind FROM deals_stage ORDER BY position, name"))
    stage_by = {str(s["name"]).lower(): s for s in stages}
    first_open = next((s["name"] for s in stages if s.get("kind") == "open"), None)
    lost_stage = next((s["name"] for s in stages if s.get("kind") == "lost"), None)

    deal_ids = sorted({str(c.get("deal_id")) for c in changes if c.get("deal_id")})
    deals = {d["id"]: d for d in _rows(pod.query(
        "SELECT id, name, stage, status, amount, currency, close_date, next_step, company_id, company_name, company_domain, people "
        f"FROM deal WHERE id IN ({_in(deal_ids)})"))} if deal_ids else {}
    recent = _rows(pod.query(
        "SELECT id, kind, deal_id, company_domain, company_id, value, state FROM deals_change "
        "WHERE state = 'proposed' OR created_at > now() - interval '30 days' LIMIT 3000"))
    seen = {(str(r.get("deal_id") or r.get("company_id") or r.get("company_domain")), r["kind"],
             json.dumps(r.get("value"), sort_keys=True)) for r in recent}
    waiting = {(str(r.get("deal_id")), r["kind"]): r["id"] for r in recent if r.get("state") == "proposed" and r.get("deal_id")}
    new_waiting = {str(r.get("company_id") or r.get("company_domain")) for r in recent
                   if r.get("state") == "proposed" and r["kind"] == "new_deal"}

    out: list[dict] = []
    expire: list[str] = []
    dropped = repeated = 0
    detail: list[dict] = []
    per_read: dict[str, int] = {}
    for c in changes:
        item = items.get(str(c.get("ref") or ""))
        kind = str(c.get("kind") or "")
        quote = _clip(c.get("quote"), 600)
        why = None
        if not item:
            why = "no such read"
        elif kind not in KINDS or kind not in (item.get("kinds") or KINDS):
            why = f"kind {kind} wasn't asked"
        elif not quote:
            why = "no sentence"
        else:
            # A speaker's name the extractor left on the front is not the sentence.
            bare = re.sub(r"^[A-Z][\w .'-]{1,40}:\s+", "", quote)
            if _norm(bare) in _norm(item.get("text") or ""):
                quote = bare
            elif _norm(quote) not in _norm(item.get("text") or ""):
                why = "sentence not in the text"
        if why:
            dropped += 1
            detail.append({"kind": kind, "dropped": why, "quote": quote})
            continue
        company = item.get("company") or {}
        speaker, said_at = _where_said(item, quote)
        base = {
            "kind": kind, "company_id": company.get("id"), "company_name": company.get("name"),
            "company_domain": company.get("domain"), "people": item.get("people") or [],
            "quote": quote, "speaker": _clip(c.get("speaker"), 200) or speaker, "said_at": said_at,
            "source": item.get("source") or "mail", "source_row": item.get("row_id"),
            "source_label": _clip(item.get("label"), 300), "read_id": item["ref"],
            "confidence": item.get("confidence"), "state": "proposed", "sample": bool(item.get("sample")),
        }
        key_target = str(company.get("id") or company.get("domain"))
        if kind == "new_deal":
            name = _clip(c.get("name"), 200)
            stage = stage_by.get(str(c.get("stage") or "").lower())
            stage_name = stage["name"] if stage and stage.get("kind") != "lost" else first_open
            if not name or not stage_name:
                dropped += 1
                detail.append({"kind": kind, "dropped": "no name or stage", "quote": quote})
                continue
            value = {"name": name, "stage": stage_name, "amount": _num(c.get("amount")),
                     "currency": _currency(c.get("currency"), data.currency) if _num(c.get("amount")) else None,
                     "close_date": _day(c.get("close_date")), "next_step": _clip(c.get("next_step"), 300)}
            key = (key_target, kind, json.dumps(value, sort_keys=True))
            if key in seen or key_target in new_waiting:
                repeated += 1
                detail.append({"kind": kind, "repeated": name})
                continue
            seen.add(key)
            new_waiting.add(key_target)
            row = {**base, "deal_name": name, "value": value, "previous": None}
        else:
            deal = deals.get(str(c.get("deal_id") or ""))
            if not deal or deal.get("status") != "open":
                dropped += 1
                detail.append({"kind": kind, "dropped": "no such open deal", "quote": quote})
                continue
            value: dict | None = None
            previous: dict | None = None
            if kind == "stage":
                stage = stage_by.get(str(c.get("stage") or "").lower())
                if stage and stage["name"] != deal.get("stage") and stage.get("kind") != "lost":
                    value, previous = {"stage": stage["name"]}, {"stage": deal.get("stage")}
            elif kind == "amount":
                amount = _num(c.get("amount"))
                cur = _currency(c.get("currency"), deal.get("currency") or data.currency)
                if amount and (deal.get("amount") is None or abs(float(deal["amount"]) - amount) > 0.005 or cur != deal.get("currency")):
                    value, previous = {"amount": amount, "currency": cur}, {"amount": deal.get("amount"), "currency": deal.get("currency")}
            elif kind == "close_date":
                day = _day(c.get("close_date"))
                if day and day != str(deal.get("close_date") or "")[:10]:
                    value, previous = {"close_date": day}, {"close_date": deal.get("close_date")}
            elif kind == "next_step":
                step = _clip(c.get("next_step"), 300)
                if step and step.lower() != (deal.get("next_step") or "").strip().lower():
                    value, previous = {"next_step": step}, {"next_step": deal.get("next_step")}
            elif kind == "lost" and lost_stage:
                value = {"stage": lost_stage, "lost_reason": _clip(c.get("lost_reason"), 300)}
                previous = {"stage": deal.get("stage")}
            if value is None:
                repeated += 1
                detail.append({"kind": kind, "repeated": "the deal already says so"})
                continue
            key = (deal["id"], kind, json.dumps(value, sort_keys=True))
            if key in seen:
                repeated += 1
                detail.append({"kind": kind, "repeated": deal.get("name")})
                continue
            seen.add(key)
            older = waiting.get((deal["id"], kind))
            if older:
                expire.append(older)
            row = {**base, "deal_id": deal["id"], "deal_name": deal.get("name"),
                   "company_id": deal.get("company_id") or base["company_id"],
                   "company_name": deal.get("company_name") or base["company_name"],
                   "company_domain": deal.get("company_domain") or base["company_domain"],
                   "value": value, "previous": previous}
        out.append(row)
        per_read[item["ref"]] = per_read.get(item["ref"], 0) + 1
        detail.append({"kind": kind, "proposed": row.get("deal_name"), "value": row["value"], "quote": quote})

    if expire:
        pod.records.bulk_update("deals_change", [{"id": i, "state": "expired", "decided_at": now} for i in set(expire)])
    for start in range(0, len(out), 50):
        pod.records.bulk_create("deals_change", out[start:start + 50])
    reads = []
    for ref in items:
        n = per_read.get(ref, 0)
        reads.append({"id": ref, "outcome": "proposed" if n else "nothing", "proposals": n})
    if reads:
        pod.records.bulk_update("deals_read", reads)

    parts = [f"{len(out)} proposed"]
    if repeated:
        parts.append(f"{repeated} already known")
    if dropped:
        parts.append(f"{dropped} dropped")
    return DealsProposeResult(proposed=len(out), dropped=dropped, repeated=repeated, expired=len(set(expire)),
                              message=", ".join(parts), detail=detail)
