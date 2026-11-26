#input_type_name: MailSetupProposalsInput
#output_type_name: MailSetupProposalsResult
#function_name: mail_setup_proposals

"""Shape what the set-up agent proposed into the form the person edits.

Nothing proposed is in force yet: the categories form shows the five starting
categories and up to four found ones, each as one editable sentence, with the
voice and a few rules and VIPs beside them, all to keep, change or drop. The
person's answers are applied by mail_setup_apply.
"""

from __future__ import annotations

import re
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

RESERVED = {"vip", "people", "updates", "newsletters", "cold", "unsure"}
VOICE_FALLBACK = "Write plainly and briefly: short sentences, no filler, a friendly first line, and the sign-off the person uses."


class MailSetupProposalsInput(BaseModel):
    setup: dict = {}


class MailSetupProposalsResult(BaseModel):
    categories: list[dict]
    voice: str
    traits: list[str]
    rules: list[dict]
    vips: list[dict]
    found: int


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "category"


def _plain(text: Any, size: int) -> str:
    # Shown to the person as is: no em or en dashes.
    return " ".join(str(text or "").replace("—", ",").replace("–", "-").split())[:size]


def mail_setup_proposals(ctx: FunctionContext, data: MailSetupProposalsInput) -> MailSetupProposalsResult:
    pod = ctx.pod
    setup = data.setup or {}
    existing = _rows(pod.query(
        "SELECT key, name, sentence, kind FROM mail_category WHERE state = 'active' ORDER BY position, name"))
    have = {c["key"] for c in existing}
    categories = [{"key": c["key"], "name": c["name"], "sentence": c["sentence"], "keep": True,
                   "found": False, "why": ""} for c in existing]
    found = 0
    for item in (setup.get("categories") or [])[:6]:
        name = _plain(item.get("name"), 80)
        sentence = _plain(item.get("sentence") or item.get("rule"), 600)
        key = _key(item.get("key") or name)
        if not name or not sentence or key in RESERVED or key in have or found >= 4:
            continue
        have.add(key)
        found += 1
        categories.append({"key": key, "name": name, "sentence": sentence, "keep": True, "found": True,
                           "why": _plain(item.get("why"), 300)})

    names = {r["handle"]: r.get("name") for r in _rows(pod.query(
        "SELECT h.handle, p.name FROM person_handle h JOIN person p ON p.id = h.person_id WHERE h.kind = 'email' LIMIT 4000"))}
    vips = []
    for item in (setup.get("vips") or [])[:6]:
        email = (item.get("email") or "").strip().lower()
        if email in names:
            vips.append({"email": email, "name": names[email] or email, "reason": _plain(item.get("reason"), 200), "keep": True})

    rules = []
    for item in (setup.get("rules") or [])[:3]:
        text = _plain(item.get("text"), 500)
        scope = item.get("scope") if item.get("scope") in ("general", "sorting", "writing") else "general"
        if text:
            rules.append({"text": text, "scope": scope, "why": _plain(item.get("why"), 300), "keep": True})

    settings = (_rows(pod.query("SELECT id FROM mail_settings LIMIT 1")) or [None])[0]
    if settings:
        pod.table("mail_settings").update(settings["id"], {"setup_step": "categories"})
    voice = (setup.get("voice_md") or "").replace("—", ",").strip()[:7900] or VOICE_FALLBACK
    traits = [_plain(t, 120) for t in (setup.get("traits") or [])][:5]
    return MailSetupProposalsResult(categories=categories, voice=voice, traits=traits, rules=rules, vips=vips, found=found)
