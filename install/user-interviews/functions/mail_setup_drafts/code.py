#input_type_name: MailSetupDraftsInput
#output_type_name: MailSetupDraftsResult
#function_name: mail_setup_drafts

"""Apply the drafting answer: replies owed in these categories are drafted
without being asked; in the rest, a draft is one press away. Then plan the
first sort: one pass per forty conversations waiting, plus two spare.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PER_PASS = 40


class MailSetupDraftsInput(BaseModel):
    draft_categories: list[str] = []
    # Categories whose drafts take the team's brand voice; None leaves them as they are.
    brand_categories: list[str] | None = None


class MailSetupDraftsResult(BaseModel):
    drafting: list[str]
    waiting: int
    passes: list[int]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def mail_setup_drafts(ctx: FunctionContext, data: MailSetupDraftsInput) -> MailSetupDraftsResult:
    pod = ctx.pod
    wanted = {str(k) for k in data.draft_categories}
    rows = _rows(pod.query("SELECT id, key, drafts, brand_voice FROM mail_category WHERE state = 'active'"))
    team = {str(k) for k in data.brand_categories} if data.brand_categories is not None else None
    updates = []
    for r in rows:
        change = {}
        if bool(r.get("drafts")) != (r["key"] in wanted):
            change["drafts"] = r["key"] in wanted
        if team is not None and bool(r.get("brand_voice")) != (r["key"] in team):
            change["brand_voice"] = r["key"] in team
        if change:
            updates.append({"id": r["id"], **change})
    if updates:
        pod.records.bulk_update("mail_category", updates)
    settings = (_rows(pod.query("SELECT id FROM mail_settings LIMIT 1")) or [None])[0]
    if settings:
        pod.table("mail_settings").update(settings["id"], {"setup_step": "sorting"})
    waiting = int((_rows(pod.query(
        "SELECT COUNT(*) AS n FROM conversation c JOIN mail_thread t ON t.id = c.id "
        "WHERE c.source = 'mail' AND c.state = 'new' AND (c.kind = 'broadcast' OR t.document_filled IS TRUE)")) or [{}])[0].get("n") or 0)
    passes = min(40, -(-waiting // PER_PASS) + 2)
    drafting = sorted(r["key"] for r in rows if r["key"] in wanted)
    return MailSetupDraftsResult(drafting=drafting, waiting=waiting, passes=list(range(1, passes + 1)))
