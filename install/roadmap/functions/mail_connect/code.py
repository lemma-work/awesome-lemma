#input_type_name: MailConnectInput
#output_type_name: MailConnectResult
#function_name: mail_connect

"""Set-up step one, after the person connected in the app: hold the mailbox.

The app does the connecting (the provider's own sign-in) and submits the set-up
form with the provider, the connected account and its address; this records
the mailbox, or, for the sample, finds the one mail_sample_data made. Settings
and the five starting categories are made here too, so a set-up started from
anywhere has them.

`passes` is the list the first read loops over: each pass reads for up to a
minute and a half and returns at once when there is nothing left.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com"}
DEFAULT_CATEGORIES = [
    ("vip", "VIP", "People I have marked VIP: the few who matter most to me.", 10, False, True),
    ("people", "People", "Real people writing to me who do not fit a more specific category.", 20, False, True),
    ("updates", "Updates", "Receipts, notifications, alerts, calendar and account mail from services.", 80, False, False),
    ("newsletters", "Newsletters", "Newsletters, digests and product marketing I signed up for.", 90, True, False),
    ("cold", "Cold", "Strangers selling something, recruiters, and pitches asking for my time.", 95, True, False),
]
PASSES = 8


class MailConnectInput(BaseModel):
    provider: str
    account_id: str | None = None
    email: str | None = None
    display_name: str | None = None
    timezone: str | None = None


class MailConnectResult(BaseModel):
    mailbox_id: str
    provider: str
    email: str
    sample: bool
    passes: list[int]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def mail_connect(ctx: FunctionContext, data: MailConnectInput) -> MailConnectResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    me = (ctx.user_email or "").lower()

    settings = (_rows(pod.query("SELECT * FROM mail_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    if settings is None:
        domain = me.split("@", 1)[1] if "@" in me else ""
        settings = pod.table("mail_settings").create({
            "display_name": data.display_name, "timezone": data.timezone or "UTC",
            "my_domains": [domain] if domain and domain not in FREEMAIL else [], "setup_step": "reading",
        })
    else:
        patch: dict[str, Any] = {"setup_step": "reading"}
        if data.timezone and (settings.get("timezone") in (None, "", "UTC")):
            patch["timezone"] = data.timezone
        if data.display_name and not settings.get("display_name"):
            patch["display_name"] = data.display_name
        pod.table("mail_settings").update(settings["id"], patch)
    have = {r["key"] for r in _rows(pod.query("SELECT key FROM mail_category"))}
    missing = [{"key": k, "name": n, "sentence": s, "kind": "system", "state": "active", "position": p,
                "hidden": h, "drafts": d} for k, n, s, p, h, d in DEFAULT_CATEGORIES if k not in have]
    if missing:
        pod.records.bulk_create("mail_category", missing)

    if data.provider == "sample":
        found = _rows(pod.query("SELECT id, email FROM mail_mailbox WHERE account_id = 'sample' LIMIT 1"))
        if not found:
            raise ValueError("No sample mailbox: run mail_sample_data with mode load first.")
        box = found[0]
        provider, email, sample = "gmail", box["email"], True
    else:
        if data.provider not in ("gmail", "outlook"):
            raise ValueError("provider is gmail, outlook or sample")
        if not data.account_id or not data.email or "@" not in data.email:
            raise ValueError("Connect the account first: the form needs its account id and address.")
        email = data.email.strip().lower()
        found = _rows(pod.query(
            f"SELECT id FROM mail_mailbox WHERE account_id = {_sql(data.account_id)} AND email = {_sql(email)} LIMIT 1"))
        box = found[0] if found else pod.table("mail_mailbox").create({
            "provider": data.provider, "account_id": data.account_id, "email": email,
            "owner_name": data.display_name or settings.get("display_name"), "state": "backfilling",
            "connected_at": now,
        })
        provider, sample = data.provider, False
    pod.table("mail_activity").create({
        "kind": "setup", "text": f"Connected {email}" + (" (sample)" if sample else ""), "ref_id": box["id"],
    })
    return MailConnectResult(mailbox_id=box["id"], provider=provider, email=email, sample=sample,
                             passes=list(range(1, PASSES + 1)))
