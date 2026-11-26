#input_type_name: MailSettingsEnsureInput
#output_type_name: MailSettingsEnsureResult
#function_name: mail_settings_ensure

"""Make sure the caller has Mail settings and the five starting categories.

Safe to call on every visit: it only fills what is missing. Categories are
per person, so each person's People, VIP, Updates, Newsletters and Cold are
theirs to rename, rewrite or retire.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com"}
# key, name, sentence, position, hidden, drafts
DEFAULT_CATEGORIES = [
    ("vip", "VIP", "People I have marked VIP: the few who matter most to me.", 10, False, True),
    ("people", "People", "Real people writing to me who do not fit a more specific category.", 20, False, True),
    ("updates", "Updates", "Receipts, notifications, alerts, calendar and account mail from services.", 80, False, False),
    ("newsletters", "Newsletters", "Newsletters, digests and product marketing I signed up for.", 90, True, False),
    ("cold", "Cold", "Strangers selling something, recruiters, and pitches asking for my time.", 95, True, False),
]


class MailSettingsEnsureInput(BaseModel):
    display_name: str | None = None
    timezone: str | None = None
    my_domains: list[str] | None = None


class MailSettingsEnsureResult(BaseModel):
    settings: dict
    created: bool
    categories_created: int


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def mail_settings_ensure(ctx: FunctionContext, data: MailSettingsEnsureInput) -> MailSettingsEnsureResult:
    pod = ctx.pod
    found = _rows(pod.query("SELECT * FROM mail_settings ORDER BY created_at LIMIT 1"))
    created = False
    if found:
        settings = found[0]
        patch: dict[str, Any] = {}
        if data.timezone and (not settings.get("timezone") or settings.get("timezone") == "UTC"):
            patch["timezone"] = data.timezone
        if data.display_name and not settings.get("display_name"):
            patch["display_name"] = data.display_name
        if data.my_domains and not settings.get("my_domains"):
            patch["my_domains"] = data.my_domains
        if patch:
            settings = pod.table("mail_settings").update(settings["id"], patch)
    else:
        email = (ctx.user_email or "").lower()
        domains = data.my_domains or ([email.split("@", 1)[1]] if "@" in email else [])
        # Personal webmail is not "your company": mail from other gmail.com
        # addresses is not internal mail.
        domains = [d for d in domains if d not in FREEMAIL]
        settings = pod.table("mail_settings").create({
            "display_name": data.display_name,
            "timezone": data.timezone or "UTC",
            "my_domains": domains,
            "setup_step": "start",
        })
        created = True

    have = {r["key"] for r in _rows(pod.query("SELECT key FROM mail_category"))}
    missing = [
        {"key": key, "name": name, "sentence": sentence, "kind": "system", "state": "active",
         "position": position, "hidden": hidden, "drafts": drafts}
        for key, name, sentence, position, hidden, drafts in DEFAULT_CATEGORIES
        if key not in have
    ]
    if missing:
        pod.records.bulk_create("mail_category", missing)
    return MailSettingsEnsureResult(settings=settings, created=created, categories_created=len(missing))
