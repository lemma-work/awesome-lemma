#input_type_name: BrandDesignActionInput
#output_type_name: BrandDesignActionResult
#function_name: brand_design_action

"""What a person does with designs in the Brand app.

  new      ask for a new design: the design, and a job wanted for the
           assistant (the brand-job workflow makes it, as this person)
  change   ask for a change: the next version, by the same path
  approve  approve the current version
  archive  put it away; restore brings it back

In chat the assistant makes designs itself (`brand_start_design`,
`brand_save_design`); both paths follow /brand/making-a-design.md and pass
the same brand check.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KINDS = ("social_post", "social_card", "story", "banner", "poster", "one_pager", "other")


class BrandDesignActionInput(BaseModel):
    action: str
    design_id: str = ""
    title: str = ""
    kind: str = "social_post"
    prompt: str = ""
    by_name: str = ""


class BrandDesignActionResult(BaseModel):
    design_id: str = ""
    job_id: str = ""
    state: str = ""
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _dict(obj: Any) -> dict:
    if obj is None:
        return {}
    return obj.to_dict() if hasattr(obj, "to_dict") else (dict(obj) if isinstance(obj, dict) else {})


def _title(prompt: str) -> str:
    """The prompt's first sentence, cut at a word near 70 characters."""
    first = re.split(r"(?<=[.!?])\s|\n", prompt.strip(), maxsplit=1)[0].strip().rstrip(".")
    if len(first) <= 72:
        return first
    return first[:72].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def brand_design_action(ctx: FunctionContext, data: BrandDesignActionInput) -> BrandDesignActionResult:
    pod = ctx.pod
    by = (data.by_name or "").strip() or ((ctx.user_email or "").split("@")[0].replace(".", " ").title() or None)
    me = str(ctx.user_id) if ctx.user_id else None
    action = data.action.strip().lower()
    result: BrandDesignActionResult

    if action == "new":
        prompt = data.prompt.strip()
        if not prompt:
            raise ValueError("Say what the design is for.")
        brands = _rows(pod.query("SELECT * FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, synced_at DESC NULLS LAST LIMIT 1"))
        if not brands:
            raise ValueError("There is no brand to make it in yet.")
        brand = brands[0]
        title = data.title.strip() or _title(prompt)
        kind = data.kind if data.kind in KINDS else "social_post"
        design = _dict(pod.records.create("brand_design", {
            "brand_id": brand["id"], "title": title, "kind": kind, "state": "making", "prompt": prompt[:4000], "version": 0,
            "made_from": "app", "requested_by": me, "requested_name": by, "activity": "Waiting for the assistant"}))
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "design"
        pod.records.update("brand_design", design["id"], {"folder": f"{(brand.get('root_path') or '').rstrip('/')}/designs/{slug}-{str(design['id'])[:6]}/"})
        job = _dict(pod.records.create("brand_job", {
            "kind": "make", "state": "wanted", "brand_id": brand["id"], "design_id": design["id"], "prompt": prompt[:4000],
            "activity": "Waiting for the assistant", "requested_by": me, "requested_name": by}))
        result = BrandDesignActionResult(design_id=design["id"], job_id=job["id"], state="making",
                                         message="Asked for it. The Lemma is making it in the brand; it is checked before you see it.")
    else:
        found = _rows(pod.query(f"SELECT * FROM brand_design WHERE id = {_sql(data.design_id)}"))
        if not found:
            raise ValueError(f"No design {data.design_id}.")
        design = found[0]
        if action == "change":
            change = data.prompt.strip()
            if not change:
                raise ValueError("Say what to change.")
            live = _rows(pod.query(f"SELECT id FROM brand_job WHERE design_id = {_sql(design['id'])} AND state IN ('wanted', 'working') LIMIT 1"))
            if live:
                return BrandDesignActionResult(design_id=design["id"], job_id=live[0]["id"], state="making",
                                               message="It is being worked on already; ask again when this version lands.")
            pod.records.update("brand_design", design["id"], {"state": "making", "activity": "Waiting for the assistant"})
            job = _dict(pod.records.create("brand_job", {
                "kind": "revise", "state": "wanted", "brand_id": design["brand_id"], "design_id": design["id"], "prompt": change[:4000],
                "activity": "Waiting for the assistant", "requested_by": me, "requested_name": by}))
            if me and design.get("requested_by") != me:
                pod.records.update("brand_design", design["id"], {"requested_by": me, "requested_name": by})
            result = BrandDesignActionResult(design_id=design["id"], job_id=job["id"], state="making",
                                             message="Asked for the change. The next version is checked against the brand before you see it.")
        elif action == "approve":
            pod.records.update("brand_design", design["id"], {"state": "approved", "approved_at": _now(), "approved_by": by})
            result = BrandDesignActionResult(design_id=design["id"], state="approved", message="Approved.")
        elif action == "archive":
            pod.records.update("brand_design", design["id"], {"state": "archived"})
            result = BrandDesignActionResult(design_id=design["id"], state="archived", message="Put away.")
        elif action == "restore":
            last = _rows(pod.query(f"SELECT verdict FROM brand_version WHERE design_id = {_sql(design['id'])} AND version = {int(design.get('version') or 0)}"))
            state = "failed" if not last else ("off_brand" if last[0].get("verdict") == "breaks" else "review")
            pod.records.update("brand_design", design["id"], {"state": state})
            result = BrandDesignActionResult(design_id=design["id"], state=state, message="Brought back.")
        else:
            raise ValueError("action is new, change, approve, archive or restore.")
    try:
        pod.functions.run("brand_needs_you", {})
    except Exception:  # noqa: BLE001
        pass
    return result
