#input_type_name: DealsSaveInput
#output_type_name: DealsSaveResult
#function_name: deals_save

"""Everything a person does to a deal, in one place, so every change leaves
the same history (`deals_history`, team-wide, without the sentence):

    keep      a proposal: writes the team's deal (a new one, or the field it
              changes) as the person, with what they changed first. A change
              they made to it before keeping is a correction.
    dismiss   a proposal: it doesn't change a deal (or not this way). Kept as a
              correction with what the read saw, so the next read learns.
    edit      a deal's fields by hand: stage (dragged on the board), amount,
              currency, close date, next step, name, owner, people, why lost.
    create    a deal by hand.
    note      a note on a deal, for the team.
    delete    a deal, its history and notes. Proposals about it expire.

A stage's kind sets the deal's status (open, won, lost) and when it closed.
"""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

COMPANY_NS = uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
EDITABLE = ("name", "stage", "amount", "currency", "close_date", "next_step", "lost_reason", "people",
            "owner_user_id", "owner_name", "company_name", "company_domain")


class DealsSaveInput(BaseModel):
    action: str
    change_id: str | None = None
    deal_id: str | None = None
    # keep: the proposal's value as the person changed it. edit/create: fields.
    fields: dict | None = None
    # dismiss: not_a_deal (it changes no deal) or wrong (a deal, not this way).
    reason: str | None = None
    # keep: the kinds the person says it really was, when different.
    kinds: list[str] | None = None
    note: str | None = None
    display_name: str | None = None


class DealsSaveResult(BaseModel):
    deal_id: str | None = None
    changed: list[str] = []
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _one(pod, sql: str) -> dict | None:
    rows = _rows(pod.query(sql))
    return rows[0] if rows else None


def _num(value: Any) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        n = float(str(value).replace(",", "").strip())
    except ValueError:
        return None
    return n if n >= 0 else None


def _day(value: Any) -> str | None:
    text = str(value or "").strip()[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _clip(value: Any, n: int) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:n] if text else None


def _j(value: Any) -> Any:
    """A JSON column takes an object or a list, never a bare number or string
    (the datastore passes a scalar to Postgres unencoded and refuses it), so a
    history value is kept as {"v": value}."""
    return value if value is None or isinstance(value, (dict, list)) else {"v": value}


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, (int, float)) or isinstance(b, (int, float)):
        try:
            return abs(float(a) - float(b)) < 0.005
        except (TypeError, ValueError):
            return False
    return (a or None) == (b or None)


def deals_save(ctx: FunctionContext, data: DealsSaveInput) -> DealsSaveResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    me = ctx.user_id
    member = _one(pod, "SELECT display_name FROM deals_member ORDER BY created_at LIMIT 1") or {}
    my_name = data.display_name or member.get("display_name") or ctx.user_email or "Someone on the team"
    stages = _rows(pod.query("SELECT name, kind FROM deals_stage ORDER BY position, name"))
    stage_by = {s["name"].lower(): s for s in stages}
    team = _one(pod, "SELECT currency FROM deals_settings LIMIT 1") or {}
    currency = team.get("currency") or "USD"

    def company_for(domain: str | None, name: str | None) -> dict:
        """The shared company for a domain (People map's), or by name."""
        if domain:
            row = _one(pod, "SELECT c.id, c.name, c.domain FROM company_domain d JOIN company c ON c.id = d.company_id "
                            f"WHERE d.domain = {_sql(domain.lower())} LIMIT 1")
            if row:
                return row
        if name:
            row = _one(pod, f"SELECT id, name, domain FROM company WHERE lower(name) = {_sql(name.lower())} LIMIT 1")
            if row:
                return row
        return {"id": None, "name": name, "domain": domain}

    def history(deal_id: str, field: str, before: Any, after: Any, how: str, at: str | None = None,
                source: str | None = None, with_name: str | None = None) -> str:
        row = pod.records.create("deals_history", {
            "deal_id": deal_id, "field": field, "from_value": _j(before), "to_value": _j(after), "by_user_id": me,
            "by_name": my_name, "how": how, "source": source, "with_name": with_name, "at": at or now})
        payload = row.to_dict() if hasattr(row, "to_dict") else row
        return str((payload or {}).get("id") or "")

    def remember_sample(table: str, row_id: str | None) -> None:
        if row_id:
            pod.records.create("deals_sample_row", {"table_name": table, "row_id": row_id})

    def apply(deal: dict, patch: dict, how: str, at: str | None = None, source: str | None = None,
              with_name: str | None = None, sample: bool = False) -> list[str]:
        """Write the changed fields and one history row each. Returns the fields changed."""
        clean: dict[str, Any] = {}
        for key, value in patch.items():
            if key not in EDITABLE:
                continue
            if key == "stage":
                stage = stage_by.get(str(value or "").lower())
                if not stage:
                    raise ValueError(f"There is no stage called {value}.")
                value = stage["name"]
            elif key == "amount":
                value = _num(value)
            elif key == "currency":
                value = (str(value or "").strip().upper()[:3]) or None
            elif key == "close_date":
                value = _day(value)
            elif key in ("name", "next_step", "lost_reason", "owner_name", "company_name"):
                value = _clip(value, 300 if key != "name" else 200)
                if key == "name" and not value:
                    raise ValueError("A deal needs a name: what they're buying.")
            if not _same(deal.get(key), value):
                clean[key] = value
        if "stage" in clean:
            kind = stage_by[clean["stage"].lower()]["kind"]
            clean["status"] = kind
            clean["closed_at"] = (at or now) if kind in ("won", "lost") else None
        if "company_domain" in clean or "company_name" in clean:
            found = company_for(clean.get("company_domain", deal.get("company_domain")), clean.get("company_name", deal.get("company_name")))
            clean["company_id"] = found.get("id")
        if not clean:
            return []
        last = deal.get("last_activity_at")
        clean["last_activity_at"] = max(filter(None, [str(last or ""), at or now]))
        pod.table("deal").update(deal["id"], clean)
        changed = []
        for key in clean:
            if key in ("status", "closed_at", "last_activity_at", "company_id", "owner_name"):
                continue
            field = key
            if key == "stage":
                kind = clean.get("status")
                field = "won" if kind == "won" else "lost" if kind == "lost" else "stage"
            if key == "owner_user_id":
                field = "owner"
                hid = history(deal["id"], "owner", deal.get("owner_name"), clean.get("owner_name") or patch.get("owner_name"),
                              how, at, source, with_name)
            else:
                hid = history(deal["id"], field, deal.get(key), clean[key], how, at, source, with_name)
            if sample:
                remember_sample("deals_history", hid)
            changed.append(field)
        return changed

    action = (data.action or "").strip()

    # ---------------------------------------------------------------- proposals
    if action in ("keep", "dismiss"):
        change = _one(pod, f"SELECT * FROM deals_change WHERE id = {_sql(data.change_id)}") if data.change_id else None
        if not change:
            raise ValueError("That proposal isn't yours or is gone.")
        if change.get("state") != "proposed":
            return DealsSaveResult(deal_id=change.get("deal_id"), message=f"Already {change.get('state')}.")
        read = _one(pod, f"SELECT id, evidence, kinds FROM deals_read WHERE id = {_sql(change.get('read_id'))}") \
            if change.get("read_id") else None
        evidence = (read or {}).get("evidence")
        sample = bool(change.get("sample"))
        if action == "dismiss":
            reason = data.reason or "not_a_deal"
            pod.table("deals_change").update(change["id"], {"state": "dismissed", "decided_at": now})
            pod.records.create("deals_correction", {
                "change_id": change["id"], "read_id": change.get("read_id"),
                "question": "changes_deal" if reason == "not_a_deal" else "value",
                "from_value": {"kind": change["kind"], "value": change.get("value")},
                "to_value": {"changes_deal": "no"} if reason == "not_a_deal" else None,
                "note": _clip(data.note, 300), "evidence": evidence, "sample": sample})
            return DealsSaveResult(deal_id=change.get("deal_id"), message="Dismissed. The next read learns from it.")

        value = dict(change.get("value") or {})
        edited = {k: v for k, v in (data.fields or {}).items() if k in value or k in EDITABLE}
        if edited and any(not _same(value.get(k), v) for k, v in edited.items()):
            pod.records.create("deals_correction", {
                "change_id": change["id"], "read_id": change.get("read_id"), "question": "value",
                "from_value": value, "to_value": {**value, **edited}, "evidence": evidence, "sample": sample})
            value.update(edited)
        if data.kinds and sorted(data.kinds) != sorted((read or {}).get("kinds") or []):
            pod.records.create("deals_correction", {
                "change_id": change["id"], "read_id": change.get("read_id"), "question": "kind",
                "from_value": (read or {}).get("kinds"), "to_value": data.kinds, "evidence": evidence, "sample": sample})
        with_name = ((change.get("people") or [{}])[0] or {}).get("name") or change.get("speaker")
        at = change.get("said_at") or now
        source_id = None
        if change.get("source_row"):
            table = "meeting" if change.get("source") == "meeting" else "conversation"
            src = _one(pod, f"SELECT source_id FROM {table} WHERE id = {_sql(change['source_row'])}")
            source_id = (src or {}).get("source_id")

        if change["kind"] == "new_deal":
            stage = stage_by.get(str(value.get("stage") or "").lower()) or next((s for s in stages if s["kind"] == "open"), None)
            if not stage:
                raise ValueError("The team has no stages yet.")
            name = _clip(value.get("name"), 200) or change.get("deal_name") or "New deal"
            found = company_for(change.get("company_domain"), change.get("company_name"))
            amount = _num(value.get("amount"))
            row = {
                "name": name, "company_id": found.get("id") or change.get("company_id"),
                "company_name": found.get("name") or change.get("company_name"),
                "company_domain": found.get("domain") or change.get("company_domain"),
                "people": change.get("people") or [], "owner_user_id": me, "owner_name": my_name,
                "stage": stage["name"], "status": stage["kind"], "amount": amount,
                "currency": (value.get("currency") or currency) if amount is not None else currency,
                "close_date": _day(value.get("close_date")), "next_step": _clip(value.get("next_step"), 300),
                "closed_at": at if stage["kind"] != "open" else None,
                "source": change.get("source") or "mail", "source_id": source_id, "last_activity_at": at,
            }
            created = pod.records.create("deal", row)
            payload = created.to_dict() if hasattr(created, "to_dict") else created
            deal_id = str(payload["id"])
            hid = history(deal_id, "created", None, {"name": name, "stage": stage["name"], "amount": amount}, "proposal",
                          at, change.get("source"), with_name)
            if sample:
                remember_sample("deal", deal_id)
                remember_sample("deals_history", hid)
            pod.table("deals_change").update(change["id"], {"state": "kept", "decided_at": now, "deal_id": deal_id,
                                                            "kept_value": value})
            return DealsSaveResult(deal_id=deal_id, changed=["created"], message=f"Added {name}.")

        deal = _one(pod, f"SELECT * FROM deal WHERE id = {_sql(change.get('deal_id'))}")
        if not deal:
            pod.table("deals_change").update(change["id"], {"state": "expired", "decided_at": now})
            raise ValueError("That deal is gone.")
        patch = {k: v for k, v in value.items() if k in EDITABLE}
        if change["kind"] == "lost" and "stage" not in patch:
            lost = next((s["name"] for s in stages if s["kind"] == "lost"), None)
            if lost:
                patch["stage"] = lost
        # A change kept onto a deal stays with it, history and all, when the
        # sample is cleared: only deals the sample made go (with their history).
        changed = apply(deal, patch, "proposal", at, change.get("source"), with_name, False)
        people = deal.get("people") or []
        known = {(p or {}).get("handle") for p in people if isinstance(p, dict)}
        extra = [p for p in (change.get("people") or []) if isinstance(p, dict) and p.get("handle") not in known]
        if extra:
            pod.table("deal").update(deal["id"], {"people": people + extra})
        pod.table("deals_change").update(change["id"], {"state": "kept", "decided_at": now, "kept_value": value})
        return DealsSaveResult(deal_id=deal["id"], changed=changed,
                               message="Kept." if changed else "Kept; the deal already said so.")

    # -------------------------------------------------------------------- deals
    if action == "create":
        f = dict(data.fields or {})
        name = _clip(f.get("name"), 200)
        if not name:
            raise ValueError("A deal needs a name: what they're buying.")
        stage = stage_by.get(str(f.get("stage") or "").lower()) or next((s for s in stages if s["kind"] == "open"), None)
        if not stage:
            raise ValueError("The team has no stages yet.")
        domain = (str(f.get("company_domain") or "").strip().lower() or None)
        people = [p for p in (f.get("people") or []) if isinstance(p, dict) and p.get("handle")]
        if not domain and people and "@" in people[0]["handle"]:
            domain = people[0]["handle"].split("@", 1)[1].lower()
        found = company_for(domain, _clip(f.get("company_name"), 200))
        amount = _num(f.get("amount"))
        created = pod.records.create("deal", {
            "name": name, "company_id": found.get("id"), "company_name": found.get("name") or _clip(f.get("company_name"), 200),
            "company_domain": found.get("domain") or domain, "people": people,
            "owner_user_id": me, "owner_name": my_name, "stage": stage["name"], "status": stage["kind"],
            "amount": amount, "currency": (str(f.get("currency") or currency).upper()[:3]),
            "close_date": _day(f.get("close_date")), "next_step": _clip(f.get("next_step"), 300),
            "closed_at": now if stage["kind"] != "open" else None, "source": "person", "last_activity_at": now})
        payload = created.to_dict() if hasattr(created, "to_dict") else created
        deal_id = str(payload["id"])
        history(deal_id, "created", None, {"name": name, "stage": stage["name"], "amount": amount}, "person")
        return DealsSaveResult(deal_id=deal_id, changed=["created"], message=f"Added {name}.")

    deal = _one(pod, f"SELECT * FROM deal WHERE id = {_sql(data.deal_id)}") if data.deal_id else None
    if not deal:
        raise ValueError("That deal is gone.")

    if action == "edit":
        fields = dict(data.fields or {})
        if "owner_user_id" in fields and not fields.get("owner_name"):
            fields["owner_name"] = my_name if fields["owner_user_id"] == me else None
        changed = apply(deal, fields, "person")
        return DealsSaveResult(deal_id=deal["id"], changed=changed, message="Saved." if changed else "Nothing changed.")

    if action == "note":
        body = (data.note or "").strip()[:4000]
        if not body:
            raise ValueError("The note is empty.")
        pod.records.create("deals_note", {"deal_id": deal["id"], "body": body, "by_user_id": me, "by_name": my_name})
        pod.table("deal").update(deal["id"], {"last_activity_at": now})
        return DealsSaveResult(deal_id=deal["id"], changed=["note"], message="Note added.")

    if action == "delete":
        for table in ("deals_history", "deals_note"):
            ids = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {table} WHERE deal_id = {_sql(deal['id'])} LIMIT 5000"))]
            for start in range(0, len(ids), 100):
                pod.records.bulk_delete(table, ids[start:start + 100])
        waiting = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM deals_change WHERE deal_id = {_sql(deal['id'])} AND state = 'proposed' LIMIT 500"))]
        if waiting:
            pod.records.bulk_update("deals_change", [{"id": i, "state": "expired", "decided_at": now} for i in waiting])
        pod.table("deal").delete(deal["id"])
        return DealsSaveResult(deal_id=None, changed=["deleted"], message=f"Deleted {deal.get('name')}.")

    raise ValueError(f"Unknown action {action}: keep, dismiss, edit, create, note or delete.")
