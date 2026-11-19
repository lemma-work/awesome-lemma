#input_type_name: BrandJobEndInput
#output_type_name: BrandJobEndResult
#function_name: brand_job_end

"""The brand-job workflow's last step, after the Lemma's assistant has worked.

A read is done when the brand was saved during the job (`brand_save`); then
the brand waits for a person to check it. A design job is done when a version
was kept during it (`brand_save_design`). Otherwise the job failed: a read
puts the brand back as it was (its last values stand), and a design with no
version at all is marked failed. The assistant's last message is kept on the
job. Then what needs the person who asked is written (`brand_needs_you`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class BrandJobEndInput(BaseModel):
    job_id: str
    # The assistant's last message.
    answer: Any = None


class BrandJobEndResult(BaseModel):
    state: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _answer(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("text") or value.get("content") or value.get("answer") or value.get("message") or ""
    if isinstance(value, list):
        value = " ".join(str(v.get("text") if isinstance(v, dict) else v) for v in value)
    return " ".join(str(value or "").split())[:2000]


def brand_job_end(ctx: FunctionContext, data: BrandJobEndInput) -> BrandJobEndResult:
    pod = ctx.pod
    jobs = _rows(pod.query(f"SELECT * FROM brand_job WHERE id = {_sql(data.job_id)}"))
    if not jobs:
        return BrandJobEndResult(state="gone", message="The job is gone.")
    job = jobs[0]
    if job.get("state") in ("done", "failed"):
        return BrandJobEndResult(state=job["state"], message="Already closed.")
    note = _answer(data.answer) or None
    started = job.get("started_at") or job.get("created_at") or ""
    patch: dict = {"finished_at": _now(), "note": note}

    if job["kind"] == "read":
        brand = (_rows(pod.query(f"SELECT id, synced_at, state FROM brand WHERE id = {_sql(job.get('brand_id'))}")) or [{}])[0]
        saved = bool(brand.get("synced_at")) and str(brand["synced_at"]) >= str(started)
        if saved:
            patch.update({"state": "done", "activity": "Read. Waiting for a person to check it."})
        else:
            patch.update({"state": "failed", "activity": "Stopped before the brand was saved",
                          "error": ("The assistant stopped before saving the brand. " + (note or ""))[:2000]})
            if brand.get("id") and brand.get("state") == "reading":
                pod.records.update("brand", brand["id"], {"state": job.get("brand_state_before") or "new"})
    else:
        design = (_rows(pod.query(f"SELECT id, version, state FROM brand_design WHERE id = {_sql(job.get('design_id'))}")) or [{}])[0]
        kept = _rows(pod.query(f"SELECT version, verdict FROM brand_version WHERE design_id = {_sql(job.get('design_id'))} "
                               f"AND updated_at >= {_sql(started)} ORDER BY version DESC LIMIT 1")) if design.get("id") else []
        if kept:
            patch.update({"state": "done", "activity": f"Version {kept[0]['version']} kept"})
        else:
            patch.update({"state": "failed", "activity": "Stopped before a version was kept",
                          "error": ("The assistant stopped before keeping a version. " + (note or ""))[:2000]})
            if design.get("id") and design.get("state") == "making":
                last = _rows(pod.query(f"SELECT verdict FROM brand_version WHERE design_id = {_sql(design['id'])} "
                                       f"AND version = {int(design.get('version') or 0)}"))
                state = "failed" if not last else ("off_brand" if last[0].get("verdict") == "breaks" else "review")
                pod.records.update("brand_design", design["id"], {"state": state, "activity": None})
    pod.records.update("brand_job", job["id"], patch)
    try:
        pod.functions.run("brand_needs_you", {})
    except Exception:  # noqa: BLE001 — the next refresh catches up
        pass
    return BrandJobEndResult(state=patch["state"], message=f"The {job['kind']} job is {patch['state']}.")
