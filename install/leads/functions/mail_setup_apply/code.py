#input_type_name: MailSetupApplyInput
#output_type_name: MailSetupApplyResult
#function_name: mail_setup_apply

"""Apply the categories form: what the person kept, renamed, dropped or added,
their voice, the rules and VIPs they kept.

A category they dropped is retired, never deleted, so a conversation that
still points at it can be found. One they added gets a key from its name. At
least one category stays: the sort needs somewhere to put things.

It returns the categories for the next question (which ones get replies
drafted) with a suggestion: the ones that hold real people's mail.
"""

from __future__ import annotations

import re
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

HIDDEN_BY_DEFAULT = {"newsletters", "cold"}
# Categories whose mail usually goes out on the team's behalf: set-up suggests
# writing them in the team's brand voice.
TEAM_VOICE = re.compile(r"customer|client|support|help|sales|partner|order|booking", re.I)
NO_DRAFTS = {"updates", "newsletters", "cold"}


class MailSetupApplyInput(BaseModel):
    categories: list[dict] = []
    voice: str | None = None
    traits: list[str] = []
    rules: list[dict] = []
    vips: list[dict] = []


class MailSetupApplyResult(BaseModel):
    category_keys: list[str]
    category_names: list[str]
    draft_default: list[str]
    # Suggested for "Write in the team's brand voice"; the team's brand, if any.
    brand_default: list[str] = []
    brand_name: str | None = None
    kept: int
    added: int
    retired: int


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "category"


def _plain(text: Any, size: int) -> str:
    return " ".join(str(text or "").replace("—", ",").replace("–", "-").split())[:size]


def mail_setup_apply(ctx: FunctionContext, data: MailSetupApplyInput) -> MailSetupApplyResult:
    pod = ctx.pod
    rows = {r["key"]: r for r in _rows(pod.query("SELECT id, key, state, kind, position FROM mail_category"))}
    kept = added = retired = 0
    seen: set[str] = set()
    creates: list[dict] = []
    updates: list[dict] = []
    keep_any = any(item.get("keep", True) for item in data.categories)
    for index, item in enumerate(data.categories[:20]):
        name = _plain(item.get("name"), 80)
        sentence = _plain(item.get("sentence"), 600)
        key = (item.get("key") or "").strip() or _key(name)
        if key in seen:
            key = f"{key}-{index}"
        seen.add(key)
        keep = bool(item.get("keep", True)) or not keep_any and index == 0
        row = rows.get(key)
        if not keep:
            if row and row.get("state") != "retired":
                updates.append({"id": row["id"], "state": "retired"})
                retired += 1
            continue
        if not name or not sentence:
            continue
        if row:
            updates.append({"id": row["id"], "name": name, "sentence": sentence, "state": "active"})
            kept += 1
        else:
            creates.append({"key": key, "name": name, "sentence": sentence, "kind": "custom", "state": "active",
                            "position": 30 + index, "hidden": key in HIDDEN_BY_DEFAULT, "drafts": False,
                            "provenance": _plain(item.get("why"), 400) or None, "examples": [], "estimate": None})
            added += 1
    # A category not in the form at all was removed from the list by the person.
    for key, row in rows.items():
        if key not in seen and row.get("state") == "active" and data.categories:
            updates.append({"id": row["id"], "state": "retired"})
            retired += 1
    if creates:
        pod.records.bulk_create("mail_category", creates)
    if updates:
        pod.records.bulk_update("mail_category", updates)

    settings = (_rows(pod.query("SELECT id FROM mail_settings LIMIT 1")) or [None])[0]
    if settings:
        patch: dict[str, Any] = {"setup_step": "drafts"}
        if data.voice is not None and data.voice.strip():
            patch["voice"] = data.voice.strip()[:7900]
            patch["voice_traits"] = [_plain(t, 120) for t in data.traits][:5]
        pod.table("mail_settings").update(settings["id"], patch)

    have_rules = {r["text"].lower() for r in _rows(pod.query("SELECT text FROM mail_rule"))}
    new_rules = []
    for rule in data.rules[:6]:
        text = _plain(rule.get("text"), 500)
        if rule.get("keep", True) and text and text.lower() not in have_rules:
            scope = rule.get("scope") if rule.get("scope") in ("general", "sorting", "writing") else "general"
            new_rules.append({"scope": scope, "text": text, "state": "active", "provenance": _plain(rule.get("why"), 400) or None})
    if new_rules:
        pod.records.bulk_create("mail_rule", new_rules)

    vips = [(v.get("email") or "").strip().lower() for v in data.vips if v.get("keep", True)]
    vips = [v for v in vips if "@" in v]
    if vips:
        people = {r["handle"]: r["person_id"] for r in _rows(pod.query(
            "SELECT handle, person_id FROM person_handle WHERE kind = 'email' "
            f"AND handle IN ({', '.join(_sql(v) for v in vips)})"))}
        if people:
            pod.records.bulk_update("person", [{"id": pid, "is_vip": True} for pid in people.values()])

    active = _rows(pod.query(
        "SELECT key, name, kind, hidden FROM mail_category WHERE state = 'active' ORDER BY position, name"))
    pod.table("mail_activity").create({
        "kind": "category",
        "text": f"Set up {len(active)} categories ({added} new, {retired} dropped), {len(new_rules)} rule(s), {len(vips)} VIP(s)",
        "count": len(active),
    })
    brand = None
    try:
        brand = (_rows(pod.query(
            "SELECT name FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC, updated_at DESC LIMIT 1")) or [None])[0]
    except Exception:  # noqa: BLE001 — no brand table readable: nothing to suggest it for
        brand = None
    return MailSetupApplyResult(
        brand_default=[c["key"] for c in active if TEAM_VOICE.search(f"{c['key']} {c['name']}")],
        brand_name=(brand or {}).get("name"),
        category_keys=[c["key"] for c in active],
        category_names=[c["name"] for c in active],
        draft_default=[c["key"] for c in active if c["key"] not in NO_DRAFTS and not c.get("hidden")],
        kept=kept, added=added, retired=retired,
    )
