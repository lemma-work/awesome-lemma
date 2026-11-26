#input_type_name: PeopleSetupPrepareInput
#output_type_name: PeopleSetupPrepareResult
#function_name: people_setup_prepare

"""Set-up, first step: what the two questions offer.

Which of Mail's categories count as people the owner deals with: every active
category, with VIP, People and the owner's own ones on, and Newsletters,
Updates and Cold off (they are never people). And the owner's own email
domains, proposed from their own addresses (the mailboxes Mail reads, the
calendars Meetings reads, the domains either already knows), never free
webmail: colleagues at those domains are not contacts.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

FREEMAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "yahoo.com", "yahoo.co.in",
    "ymail.com", "icloud.com", "live.com", "msn.com", "me.com", "mac.com", "proton.me", "protonmail.com",
    "aol.com", "gmx.com", "gmx.de", "mail.com", "yandex.com", "rediffmail.com", "outlook.in", "zohomail.com",
    "fastmail.com", "hey.com", "mailbox.example",
}
NEVER_COUNTED = {"updates", "newsletters", "cold"}


class PeopleSetupPrepareInput(BaseModel):
    pass


class PeopleSetupPrepareResult(BaseModel):
    categories: list[dict]
    categories_on: list[str]
    own_domains: list[str]
    addresses: list[str]
    mail: bool
    meetings: bool


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _domain(handle: str) -> str:
    return handle.rsplit("@", 1)[-1].lower().removeprefix("www.") if "@" in handle else ""


def people_setup_prepare(ctx: FunctionContext, data: PeopleSetupPrepareInput) -> PeopleSetupPrepareResult:
    pod = ctx.pod
    cats = _rows(pod.query(
        "SELECT key, name, sentence, kind FROM mail_category WHERE state = 'active' ORDER BY position, name"))
    categories = [{"key": c["key"], "name": c["name"], "sentence": c.get("sentence"), "kind": c.get("kind"),
                   "never": c["key"] in NEVER_COUNTED} for c in cats]
    on = [c["key"] for c in categories if not c["never"]]

    addresses = {(r.get("email") or "").lower() for r in _rows(pod.query("SELECT email FROM mail_mailbox"))}
    calendars = _rows(pod.query("SELECT email, own_domains FROM meetings_calendar"))
    addresses |= {(r.get("email") or "").lower() for r in calendars}
    addresses |= {(ctx.user_email or "").lower()}
    addresses.discard("")
    domains = {_domain(a) for a in addresses}
    for r in calendars:
        domains |= {str(d).lower() for d in (r.get("own_domains") or [])}
    for table in ("mail_settings", "meetings_settings"):
        for r in _rows(pod.query(f"SELECT my_domains FROM {table} LIMIT 1")):
            domains |= {str(d).lower() for d in (r.get("my_domains") or [])}
    settings = (_rows(pod.query(
        "SELECT id, own_domains, categories, timezone, display_name FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    # The person's zone and name as Mail or Meetings already know them, when
    # the app did not say (a set-up started from the CLI).
    base: dict[str, str] = {}
    for table in ("meetings_settings", "mail_settings"):
        for r in _rows(pod.query(f"SELECT timezone, display_name FROM {table} LIMIT 1")):
            if not base.get("timezone") and r.get("timezone") not in (None, "", "UTC"):
                base["timezone"] = r["timezone"]
            if not base.get("display_name") and r.get("display_name"):
                base["display_name"] = r["display_name"]
    fill = {}
    if base.get("timezone") and settings.get("timezone") in (None, "", "UTC"):
        fill["timezone"] = base["timezone"]
    if base.get("display_name") and not settings.get("display_name"):
        fill["display_name"] = base["display_name"]
    if not settings.get("id"):
        pod.records.bulk_create("people_settings", [{**fill, "setup_step": "categories"}])
        settings = (_rows(pod.query("SELECT id, own_domains, categories FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    elif fill:
        pod.table("people_settings").update(settings["id"], fill)
    if settings.get("own_domains"):
        domains = {str(d).lower() for d in settings["own_domains"]}
    if settings.get("categories") is not None:
        on = [k for k in settings["categories"] if any(c["key"] == k for c in categories)]
    if settings.get("id"):
        pod.table("people_settings").update(settings["id"], {"setup_step": "categories"})
    mail = bool(_rows(pod.query("SELECT id FROM mail_mailbox LIMIT 1")))
    return PeopleSetupPrepareResult(
        categories=categories, categories_on=on,
        own_domains=sorted(d for d in domains if d and d not in FREEMAIL),
        addresses=sorted(addresses), mail=mail, meetings=bool(calendars))
