#input_type_name: DealsReviewInput
#output_type_name: DealsReviewResult
#function_name: deals_review

"""The weekly review, counted with no model:

    moved    every deal that changed in the seven days, from its history: new,
             a stage move, won, lost, an amount, a close date, a next step, who
    quiet    open deals whose people have gone quiet: the warmest anyone on the
             team is with any of them (People map's `people_link`, team-wide)
             is cooling or cold, with the days since the team's last contact
    stages   the open pipeline by stage, in order: how many and their total
    totals   open deals and their total, new, won and lost in the seven days
    closing  open deals whose close date is in the next fourteen days

Money is totalled in the team's currency; deals in another are counted apart.

    count    the last seven days, as of now, written nowhere (the app's live view)
    week     the same, kept as this week's review (`deals_review`), for the
             writer; `write` says whether there is anything to write about
    save     the writer's summary onto that review
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

REVIEW_NS = uuid.UUID("5e2b9c71-3d84-4a0f-b6e2-9a1c7d3f8e40")
RANK = {"warm": 3, "new": 2, "cooling": 1, "cold": 0}


class DealsReviewInput(BaseModel):
    mode: str = "count"
    review_id: str | None = None
    result: dict | None = None
    days: int = 7


class DealsReviewResult(BaseModel):
    review_id: str | None = None
    write: bool = False
    counts: dict = {}
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _zone(name: str | None) -> ZoneInfo:
    aliases = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv"}
    try:
        return ZoneInfo(aliases.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def _money(amount: float, currency: str) -> str:
    if amount >= 1_000_000:
        return f"{currency} {amount / 1_000_000:.1f}M"
    if amount >= 10_000:
        return f"{currency} {amount / 1000:.0f}k"
    return f"{currency} {amount:,.0f}"


def _un(value: Any) -> Any:
    """History keeps a scalar as {"v": value}; the counts say it plainly."""
    return value["v"] if isinstance(value, dict) and set(value) == {"v"} else value


def deals_review(ctx: FunctionContext, data: DealsReviewInput) -> DealsReviewResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)

    if data.mode == "save":
        if not data.review_id:
            raise ValueError("Which review?")
        summary = " ".join(str((data.result or {}).get("summary") or "").split())[:2000]
        pod.table("deals_review").update(data.review_id, {
            "summary": summary or None, "summary_at": now.isoformat(), "summary_state": "ready" if summary else "failed"})
        return DealsReviewResult(review_id=data.review_id, write=False, message="Summary kept." if summary else "No summary came back.")

    team = (_rows(pod.query("SELECT currency, timezone, review_day FROM deals_settings LIMIT 1")) or [{}])[0]
    currency = team.get("currency") or "USD"
    zone = _zone(team.get("timezone"))
    today = now.astimezone(zone).date()
    days = max(1, min(data.days, 31))
    start_day = today - timedelta(days=days - 1)
    start = datetime.combine(start_day, datetime.min.time(), zone).astimezone(timezone.utc)

    stages = _rows(pod.query("SELECT name, kind FROM deals_stage ORDER BY position, name"))
    deals = _rows(pod.query(
        "SELECT id, name, company_id, company_name, company_domain, people, owner_name, stage, status, amount, currency, "
        "close_date, next_step, closed_at, last_activity_at FROM deal LIMIT 20000"))
    by_id = {d["id"]: d for d in deals}
    hist = _rows(pod.query(
        "SELECT deal_id, field, from_value, to_value, by_name, how, source, with_name, at FROM deals_history "
        f"WHERE at >= {_sql(start.isoformat())} ORDER BY at LIMIT 5000"))

    def label(d: dict) -> dict:
        return {"id": d["id"], "name": d.get("name"), "company": d.get("company_name") or d.get("company_domain"),
                "stage": d.get("stage"), "amount": d.get("amount"), "currency": d.get("currency") or currency}

    moved_map: dict[str, dict] = {}
    for h in hist:
        d = by_id.get(h["deal_id"])
        if not d:
            continue
        entry = moved_map.setdefault(d["id"], {**label(d), "changes": []})
        entry["changes"].append({"field": h["field"], "from": _un(h.get("from_value")), "to": _un(h.get("to_value")),
                                 "by": h.get("by_name"), "how": h.get("how"), "with": h.get("with_name"),
                                 "at": h.get("at")})
    moved = sorted(moved_map.values(), key=lambda m: max(c["at"] or "" for c in m["changes"]), reverse=True)

    def count(field: str) -> int:
        return sum(1 for m in moved for c in m["changes"] if c["field"] == field)

    open_deals = [d for d in deals if d.get("status") == "open"]
    def closed_as(d: dict, field: str) -> bool:
        """Won (or lost) in the window: moved there, or made there."""
        if d.get("status") != field or d["id"] not in moved_map:
            return False
        return any(c["field"] == field or c["field"] == "created" for c in moved_map[d["id"]]["changes"])

    won = [d for d in deals if closed_as(d, "won")]
    lost = [d for d in deals if closed_as(d, "lost")]

    def total(rows: list[dict]) -> tuple[float, int]:
        same = [float(d["amount"]) for d in rows if d.get("amount") is not None and (d.get("currency") or currency) == currency]
        other = sum(1 for d in rows if d.get("amount") is not None and (d.get("currency") or currency) != currency)
        return sum(same), other

    stage_rows = []
    for s in stages:
        if s["kind"] != "open":
            continue
        here = [d for d in open_deals if d.get("stage") == s["name"]]
        amount, other = total(here)
        stage_rows.append({"stage": s["name"], "deals": len(here), "amount": round(amount, 2),
                           "amount_text": _money(amount, currency), "other_currency": other})

    # Quiet: the warmest anyone on the team is with the deal's people.
    handles = sorted({str(p.get("handle")).lower() for d in open_deals for p in (d.get("people") or [])
                      if isinstance(p, dict) and p.get("handle")})
    company_ids = sorted({d["company_id"] for d in open_deals if d.get("company_id")})
    links: list[dict] = []
    try:
        if handles or company_ids:
            links = _rows(pod.query(
                "SELECT handle, name, company_id, member_name, last_contact_at, warmth FROM people_link "
                f"WHERE handle IN ({_in(handles)}) OR company_id IN ({_in(company_ids)}) LIMIT 20000"))
    except Exception:  # noqa: BLE001 - People map not in this Lemma
        links = []
    quiet = []
    for d in open_deals:
        mine = {str(p.get("handle")).lower() for p in (d.get("people") or []) if isinstance(p, dict) and p.get("handle")}
        rows = [l for l in links if l["handle"].lower() in mine] if mine else \
               [l for l in links if d.get("company_id") and l.get("company_id") == d["company_id"]]
        rows = [l for l in rows if l.get("warmth")]
        if not rows:
            continue
        best = max(rows, key=lambda l: RANK.get(l["warmth"], -1))
        if best["warmth"] not in ("cooling", "cold"):
            continue
        newest = max(rows, key=lambda l: l.get("last_contact_at") or "")
        last = _parse(newest.get("last_contact_at"))
        quiet.append({**label(d), "warmth": best["warmth"], "people": sorted({l.get("name") or l["handle"] for l in rows})[:4],
                      "last_contact_at": newest.get("last_contact_at"), "last_contact_by": newest.get("member_name"),
                      "days": (now - last).days if last else None})
    quiet.sort(key=lambda q: -(q["days"] or 0))

    soon = sorted(
        [{**label(d), "close_date": d["close_date"]} for d in open_deals if d.get("close_date")
         and today <= date.fromisoformat(str(d["close_date"])[:10]) <= today + timedelta(days=14)],
        key=lambda d: d["close_date"])
    open_amount, open_other = total(open_deals)
    won_amount, _ = total(won)
    counts = {
        "window": {"from": start_day.isoformat(), "to": today.isoformat(), "days": days},
        "currency": currency,
        "moved": moved[:40],
        "quiet": quiet[:20],
        "stages": stage_rows,
        "closing_soon": soon[:20],
        "totals": {
            "open": len(open_deals), "open_amount": round(open_amount, 2), "open_amount_text": _money(open_amount, currency),
            "open_other_currency": open_other, "new": count("created"), "stage_moves": count("stage"),
            "won": len(won), "won_amount": round(won_amount, 2), "won_amount_text": _money(won_amount, currency),
            "lost": len(lost), "quiet": len(quiet), "moved": len(moved),
        },
    }
    message = (f"{len(moved)} moved, {len(quiet)} quiet, {len(open_deals)} open worth {_money(open_amount, currency)}")
    if data.mode != "week":
        return DealsReviewResult(review_id=None, write=False, counts=counts, message=message)

    review_id = str(uuid.uuid5(REVIEW_NS, f"week:{today.isoformat()}"))
    row = {"week_start": start_day.isoformat(), "week_end": today.isoformat(), "counts": counts,
           "counted_at": now.isoformat(), "summary_state": "writing" if deals else "none"}
    existing = _rows(pod.query(f"SELECT id FROM deals_review WHERE id = {_sql(review_id)}"))
    if existing:
        pod.table("deals_review").update(review_id, row)
    else:
        pod.records.create("deals_review", {"id": review_id, **row})
    return DealsReviewResult(review_id=review_id, write=bool(deals), counts=counts, message=message)
