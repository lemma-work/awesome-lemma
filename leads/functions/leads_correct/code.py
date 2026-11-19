#input_type_name: LeadsCorrectInput
#output_type_name: LeadsCorrectResult
#function_name: leads_correct

"""The person corrects an answer, or makes their call on a lead.

- `worth`: this person was worth looking up after all (true), or not (false).
  Kept as a correction with the evidence the question saw, so it is an
  example for the next "worth looking up?". True queues them (a place in
  today's look-ups, or tomorrow's past the limit); false takes them out of
  the queue. A look-up already done stays.
- `fit`: this company fits the team 1 to 5. The fit is the team's (on the
  company's team-wide `leads_company` row), so the score is the team's from
  now on: not asked again until someone changes it, and the next scores of
  other companies see it in their question ("fits like" / "doesn't fit
  like"). Also kept in the person's own corrections with the evidence the fit
  question saw.
- `review`: kept (worth their time) or passed (not for them); either takes it
  off their day.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class LeadsCorrectInput(BaseModel):
    person_id: str
    worth: bool | None = None
    fit: int | None = None
    review: str | None = None


class LeadsCorrectResult(BaseModel):
    ok: bool
    state: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def leads_correct(ctx: FunctionContext, data: LeadsCorrectInput) -> LeadsCorrectResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    pid = data.person_id
    lead = (_rows(pod.query(
        f"SELECT lp.*, p.name FROM leads_person lp JOIN person p ON p.id = lp.id WHERE lp.id = {_sql(pid)}")) or [None])[0]
    if not lead:
        return LeadsCorrectResult(ok=False, message="No such lead.")
    name = lead.get("name") or "them"
    settings = (_rows(pod.query("SELECT setup_step FROM leads_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    said: list[str] = []
    state = lead.get("state")

    if data.worth is not None:
        before = None if lead.get("worth") is None else ("look_up" if lead["worth"] else "skip")
        after = "look_up" if data.worth else "skip"
        if lead.get("evidence") and lead.get("worth_by") != "rule":
            pod.table("leads_correction").create({"field": "worth", "subject_id": pid, "from_value": before,
                                                  "to_value": after, "evidence": lead["evidence"],
                                                  "sample": bool(lead.get("sample"))})
        patch: dict[str, Any] = {"worth": data.worth, "worth_by": "person", "worth_at": now,
                                 "worth_reason": "You said to look them up" if data.worth else "You said to skip them"}
        if data.worth and state in ("skipped", "unsure", "failed"):
            state = "proposed" if settings.get("setup_step") != "done" else "queued"
            patch["state"] = state
        elif not data.worth and state in ("unsure", "proposed", "queued", "wanted"):
            state = "skipped"
            patch["state"] = state
        pod.table("leads_person").update(pid, patch)
        said.append(f"{name}: look up" if data.worth else f"{name}: skip")

    if data.fit is not None:
        score = max(1, min(int(data.fit), 5))
        cid = lead.get("company_id")
        if not cid:
            return LeadsCorrectResult(ok=False, state=state, message="They have no company to score.")
        old = (_rows(pod.query(f"SELECT id, fit, fit_evidence FROM leads_company WHERE id = {_sql(cid)}")) or [{}])[0]
        if old.get("fit_evidence"):
            pod.table("leads_correction").create({"field": "fit", "subject_id": cid,
                                                  "from_value": None if old.get("fit") is None else str(old["fit"]),
                                                  "to_value": str(score), "evidence": old["fit_evidence"],
                                                  "sample": bool(lead.get("sample"))})
        who = (_rows(pod.query("SELECT display_name FROM leads_settings ORDER BY created_at LIMIT 1")) or [{}])[0].get("display_name") \
            or (str(getattr(ctx, "user_email", "") or "").split("@")[0].replace(".", " ").title() or None)
        why = f"{who or 'Someone on the team'} said {score} of 5"
        row = {"fit": score, "fit_sure": True, "fit_confidence": None, "fit_why": why, "fit_by": "person",
               "fit_by_name": who, "fit_at": now}
        if old.get("id"):
            pod.table("leads_company").update(cid, row)
        else:
            pod.records.bulk_create("leads_company", [dict(row, id=cid, sample=bool(lead.get("sample")))], upsert=True)
        leads = [r["id"] for r in _rows(pod.query(f"SELECT id FROM leads_person WHERE company_id = {_sql(cid)} LIMIT 500"))]
        for i in range(0, len(leads), 100):
            pod.records.bulk_update("leads_person", [{"id": x, "fit": score, "fit_sure": True, "fit_why": why}
                                                     for x in leads[i : i + 100]])
        said.append(f"fit {score} of 5, for the team")

    if data.review in ("new", "kept", "passed"):
        pod.table("leads_person").update(pid, {"review": data.review, "reviewed_at": now})
        said.append({"kept": "kept", "passed": "passed", "new": "back to new"}[data.review])

    if not said:
        return LeadsCorrectResult(ok=False, state=state, message="Nothing to change.")
    return LeadsCorrectResult(ok=True, state=state, message="Noted: " + ", ".join(said) + ".")
