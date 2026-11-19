#input_type_name: BrandReadInput
#output_type_name: BrandReadResult
#function_name: brand_read

"""Read the team's brand from its website, or from files a person uploaded.

The one door: the Brand app's first step and its "Read again" call this, and
so does the Lemma's assistant when someone gives it a website in chat. It
makes the brand (the first one in a Lemma is the default) or marks an
existing one as being read, and adds a `brand_job` row wanted for the
assistant; the `brand-job-wanted` schedule starts the brand-job workflow, whose
AGENT step reads it as the person who asked. A brand being read keeps its
last values until the new ones are saved.

Reading again changes the brand for the whole team: confirm with the person
before calling it on a brand that is already there.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class BrandReadInput(BaseModel):
    # The team's website, or the pod folder their logo and guide were uploaded to.
    url: str = ""
    folder: str = ""
    # The brand's name, when the person said it.
    name: str = ""
    # Read this brand again; without it, the default brand is read again, or
    # the first brand is made.
    brand_id: str = ""
    # Make a second brand (a product line, a client) instead of reading the default again.
    new_brand: bool = False
    # Who asked, as the app knows them.
    by_name: str = ""


class BrandReadResult(BaseModel):
    brand_id: str
    job_id: str
    slug: str
    created: bool
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


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower().replace("&", " and ")).strip("-")[:48] or "brand"


def _from_url(url: str) -> tuple[str, str]:
    host = urlparse(url if "://" in url else f"https://{url}").netloc.lower().removeprefix("www.")
    stem = host.split(".")[0] if "." in host else host
    return (stem.replace("-", " ").title() or "Brand"), _slug(stem)


def brand_read(ctx: FunctionContext, data: BrandReadInput) -> BrandReadResult:
    pod = ctx.pod
    url = data.url.strip()
    folder = data.folder.strip().rstrip("/")
    if not url and not folder:
        raise ValueError("Give the team's website (url) or the folder their files were uploaded to (folder).")
    if url and "://" not in url:
        url = f"https://{url}"
    source = "website" if url else "files"
    ref = url or folder
    by = (data.by_name or "").strip() or ((ctx.user_email or "").split("@")[0].replace(".", " ").title() or None)

    brands = _rows(pod.query("SELECT id, name, state, is_default, source, root_path FROM brand WHERE state <> 'archived' "
                        "ORDER BY is_default DESC, created_at LIMIT 50"))
    target = None
    if data.brand_id:
        target = next((b for b in brands if b["id"] == data.brand_id), None)
        if target is None:
            raise ValueError(f"No brand {data.brand_id}.")
    elif not data.new_brand:
        target = next((b for b in brands if b.get("is_default") and b.get("source") != "sample"), None)

    created = False
    if target is None:
        name, slug = _from_url(url) if url else ("Our brand", "brand")
        if data.name.strip():
            name, slug = data.name.strip()[:120], _slug(data.name)
        roots = {(b.get("root_path") or "").rstrip("/") for b in brands}
        base, n = slug, 2
        while f"/brand/{slug}" in roots or slug in ("uploads", "designs"):
            slug, n = f"{base}-{n}", n + 1
        real = [b for b in brands if b.get("source") != "sample"]
        make_default = not real
        if make_default:
            # The team's own brand takes over from the sample as the default.
            for b in brands:
                if b.get("is_default"):
                    pod.records.update("brand", b["id"], {"is_default": False})
        target = _dict(pod.records.create("brand", {
            "name": name, "is_default": make_default, "state": "new", "source": source, "source_id": ref[:500],
            "site_url": url[:500] or None, "root_path": f"/brand/{slug}"}))
        created = True
    slug = (target.get("root_path") or "/brand/brand").rstrip("/").rsplit("/", 1)[-1]

    live = _rows(pod.query(f"SELECT id, state FROM brand_job WHERE brand_id = {_sql(target['id'])} AND kind = 'read' "
                           "AND state IN ('wanted', 'working') ORDER BY created_at DESC LIMIT 1"))
    if live:
        return BrandReadResult(brand_id=target["id"], job_id=live[0]["id"], slug=slug, created=created,
                               message="Already reading this brand; the Brand app shows how far it has got.")

    before = target.get("state") or "new"
    patch = {"state": "reading", "source": source, "source_id": ref[:500]}
    if url:
        patch["site_url"] = url[:500]
    if data.name.strip() and not created:
        patch["name"] = data.name.strip()[:120]
    pod.records.update("brand", target["id"], patch)
    job = _dict(pod.records.create("brand_job", {
        "kind": "read", "state": "wanted", "brand_id": target["id"], "source": source, "source_ref": ref[:1000],
        "activity": "Waiting for the assistant", "brand_state_before": before,
        "requested_by": str(ctx.user_id) if ctx.user_id else None, "requested_name": by}))
    what = f"the website {url}" if url else f"the files in {folder}"
    return BrandReadResult(brand_id=target["id"], job_id=job["id"], slug=slug, created=created,
                           message=f"Reading {what}. It takes a few minutes; the Brand app shows it as it goes, "
                                   "and asks a person to check what it found.")
