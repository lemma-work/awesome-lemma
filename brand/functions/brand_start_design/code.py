#input_type_name: BrandStartDesignInput
#output_type_name: BrandStartDesignResult
#function_name: brand_start_design

"""Start a design in the team's brand, or the next version of one.

Called by whoever makes it: the Lemma's assistant in chat, and in a brand job
(the Brand app's "New design" and "Ask for a change"). Returns where to put
the files and what to build them from: the size, the brand's theme.css, its
logo files and its guide. Then build `index.html` (linking a copy of
theme.css beside it), render `preview.png`, upload both with the logo file to
the folder, and call `brand_save_design`, which checks the version against the
brand before anyone sees it. See /brand/making-a-design.md.
"""

from __future__ import annotations

import re
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

SIZES = {"social_post": (1080, 1080), "social_card": (1200, 630), "story": (1080, 1920), "banner": (1500, 500),
         "poster": (1080, 1350), "one_pager": (816, 1056), "other": (1200, 1200)}


class BrandStartDesignInput(BaseModel):
    # A short name: "Autumn menu launch post".
    title: str = ""
    # social_post 1080×1080, social_card 1200×630, story 1080×1920, banner 1500×500,
    # poster 1080×1350, one_pager 816×1056, other
    kind: str = "social_post"
    # What was asked for, in the person's words.
    prompt: str = ""
    # The next version of this design (a change, or a fix after the brand check).
    design_id: str = ""
    # Width and height for "other".
    width: int | None = None
    height: int | None = None
    # chat (the assistant, asked in a conversation), app, sample
    made_from: str = "chat"
    by_name: str = ""
    job_id: str = ""


class BrandStartDesignResult(BaseModel):
    design_id: str
    version: int
    folder: str
    width: int
    height: int
    brand_id: str
    brand_name: str
    theme_css_path: str = ""
    logos: list[dict] = []
    guide_path: str = ""
    previous_artifact_path: str = ""
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
    first = re.split(r"(?<=[.!?])\s|\n", (prompt or "").strip(), maxsplit=1)[0].strip().rstrip(".")
    if len(first) <= 72:
        return first
    return first[:72].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def brand_start_design(ctx: FunctionContext, data: BrandStartDesignInput) -> BrandStartDesignResult:
    pod = ctx.pod
    design: dict | None = None
    if data.design_id:
        found = _rows(pod.query(f"SELECT * FROM brand_design WHERE id = {_sql(data.design_id)}"))
        if not found:
            raise ValueError(f"No design {data.design_id}.")
        design = found[0]
        brands = _rows(pod.query(f"SELECT * FROM brand WHERE id = {_sql(design['brand_id'])}"))
    else:
        brands = _rows(pod.query("SELECT * FROM brand WHERE state IN ('check', 'ready') "
                                 "ORDER BY is_default DESC, synced_at DESC NULLS LAST LIMIT 1"))
    if not brands or not (brands[0].get("tokens") or {}):
        raise ValueError("No brand to make it in yet. Ask the person for their website and call brand_read; "
                         "never make up colours, type or a logo.")
    brand = brands[0]
    root = (brand.get("root_path") or "").rstrip("/")

    if design is None:
        kind = data.kind if data.kind in SIZES else "other"
        title = data.title.strip()[:120] or _title(data.prompt) or "Untitled design"
        by = (data.by_name or "").strip() or ((ctx.user_email or "").split("@")[0].replace(".", " ").title() or None)
        design = _dict(pod.records.create("brand_design", {
            "brand_id": brand["id"], "title": title, "kind": kind, "state": "making", "prompt": data.prompt[:4000] or None,
            "version": 0, "made_from": data.made_from if data.made_from in ("chat", "app", "sample") else "chat",
            "requested_by": str(ctx.user_id) if ctx.user_id else None, "requested_name": by,
            "activity": "Making the first version"}))
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "design"
        folder = f"{root}/designs/{slug}-{str(design['id'])[:6]}/"
        pod.records.update("brand_design", design["id"], {"folder": folder})
        design["folder"] = folder
    version = int(design.get("version") or 0) + 1
    if data.design_id:
        pod.records.update("brand_design", design["id"], {"state": "making", "activity": f"Making version {version}"})
    width, height = SIZES.get(design.get("kind") or "other", SIZES["other"])
    if design.get("kind") == "other" and data.width and data.height:
        width, height = int(data.width), int(data.height)
    folder = f"{(design.get('folder') or '').rstrip('/')}/v{version}/"
    if data.job_id:
        try:
            pod.records.update("brand_job", data.job_id, {"activity": f"Making version {version}", "design_id": design["id"]})
        except Exception:  # noqa: BLE001
            pass
    return BrandStartDesignResult(
        design_id=design["id"], version=version, folder=folder, width=width, height=height, brand_id=brand["id"],
        brand_name=brand.get("name") or "", theme_css_path=brand.get("theme_css_path") or "",
        logos=list(brand.get("logos") or []), guide_path=brand.get("guide_path") or "",
        previous_artifact_path=design.get("artifact_path") or "",
        message=(f"Build index.html at {width}×{height} in the brand ({brand.get('name')}): copy {brand.get('theme_css_path')} "
                 f"beside it and link it, copy the logo file you use beside it. Render preview.png, upload index.html, "
                 f"theme.css, the logo and preview.png to {folder}, then call brand_save_design with design_id "
                 f"{design['id']} and version {version}."))
