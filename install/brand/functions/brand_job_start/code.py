#input_type_name: BrandJobStartInput
#output_type_name: BrandJobStartResult
#function_name: brand_job_start

"""The brand-job workflow's first step: take a wanted job and write the brief.

A `brand_job` row added with state "wanted" (by `brand_read`, or the Brand
app's "New design" and "Ask for a change") starts the workflow; a run takes
no input, so the row is the input. This marks the job working, makes sure the
playbooks are in place (`brand_setup`), and writes the brief the AGENT step
hands the Lemma's assistant: the job, its brand or design, and the whole
playbook to follow. A job that is not wanted any more is skipped.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLAYBOOK = {"read": "/brand/reading-a-brand.md", "make": "/brand/making-a-design.md", "revise": "/brand/making-a-design.md"}
SIZES = {"social_post": "1080×1080", "social_card": "1200×630", "story": "1080×1920", "banner": "1500×500",
         "poster": "1080×1350", "one_pager": "816×1056", "other": "1200×1200"}


class BrandJobStartInput(BaseModel):
    job_id: str


class BrandJobStartResult(BaseModel):
    skip: bool
    kind: str = ""
    brief: str = ""
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _text(blob: Any) -> str:
    return blob.decode("utf-8", "replace") if isinstance(blob, (bytes, bytearray)) else str(blob or "")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def brand_job_start(ctx: FunctionContext, data: BrandJobStartInput) -> BrandJobStartResult:
    pod = ctx.pod
    jobs = _rows(pod.query(f"SELECT * FROM brand_job WHERE id = {_sql(data.job_id)}"))
    if not jobs or jobs[0].get("state") != "wanted":
        return BrandJobStartResult(skip=True, message="Nothing wanted: the job is gone, or already taken.")
    job = jobs[0]
    pod.records.update("brand_job", job["id"], {"state": "working", "started_at": _now(),
                                                "activity": "The assistant is starting"})
    try:
        pod.functions.run("brand_setup", {})
    except Exception:  # noqa: BLE001 — the playbook may be there already; read it below
        pass
    path = PLAYBOOK[job["kind"]]
    try:
        playbook = _text(pod.files.download(path))
    except Exception:  # noqa: BLE001
        playbook = f"Read {path} in full before the first step."

    brand = _rows(pod.query(f"SELECT * FROM brand WHERE id = {_sql(job.get('brand_id'))}"))[0] if job.get("brand_id") else {}
    by = job.get("requested_name") or "a person in this Lemma"
    lines = [f"Brand kit job: {job['kind']}", f"job_id: {job['id']}"]
    if job["kind"] == "read":
        root = (brand.get("root_path") or "").rstrip("/")
        lines += [f"brand_id: {brand.get('id')} ({brand.get('name')})", f"folder: {root}/  (screenshots go in {root}/evidence/)"]
        if job.get("source") == "files":
            lines.append(f"Read the brand from the files uploaded to {job.get('source_ref')}.")
        else:
            lines.append(f"Read the brand from the website {job.get('source_ref')}.")
        if job.get("brand_state_before") in ("check", "ready"):
            fixed = _rows(pod.query(f"SELECT kind, subject, to_answer FROM brand_correction WHERE brand_id = {_sql(brand.get('id'))} "
                                    "AND kind IN ('color', 'font') ORDER BY created_at DESC LIMIT 20"))
            lines.append("This is a read again: the brand already has values, and keeps them until you save.")
            if fixed:
                lines.append("A person fixed these; brand_save keeps them: " + ", ".join(
                    f"{f['subject']} {(f.get('to_answer') or {}).get('value') or (f.get('to_answer') or {}).get('family')}" for f in fixed))
        lines.append(f"Asked by {by}.")
    else:
        design = _rows(pod.query(f"SELECT * FROM brand_design WHERE id = {_sql(job.get('design_id'))}"))
        design = design[0] if design else {}
        if not brand and design.get("brand_id"):
            brand = (_rows(pod.query(f"SELECT * FROM brand WHERE id = {_sql(design['brand_id'])}")) or [{}])[0]
        lines += [f"design_id: {design.get('id')} (\"{design.get('title')}\", {design.get('kind')}, {SIZES.get(design.get('kind') or 'other')})",
                  f"brand: {brand.get('name')} (theme {brand.get('theme_css_path')}, guide {brand.get('guide_path')})"]
        if job["kind"] == "make":
            lines.append(f"Make it: call brand_start_design with design_id {design.get('id')} for version 1's folder.")
            lines.append(f"What {by} asked for, in the Brand app: \"{job.get('prompt') or design.get('prompt') or design.get('title')}\"")
        else:
            lines.append(f"Make the next version of it: it is at version {design.get('version')} ({design.get('artifact_path')}); "
                         f"call brand_start_design with design_id {design.get('id')} for the next version's folder, and start from that one.")
            lines.append(f"The change {by} asked for, in the Brand app: \"{job.get('prompt')}\"")
            if design.get("prompt"):
                lines.append(f"What the design was first asked for: \"{design['prompt']}\"")
        lines.append("Nobody is in this conversation: decide, never ask.")
    lines += ["", f"Pass job_id {job['id']} to the Brand kit functions; they keep the job's activity line.",
              "Your last message is kept on the job: two or three lines.", "", "---", "", playbook]
    brief = "\n".join(lines)
    return BrandJobStartResult(skip=False, kind=job["kind"], brief=brief[:19000], message=f"Started the {job['kind']} job.")
