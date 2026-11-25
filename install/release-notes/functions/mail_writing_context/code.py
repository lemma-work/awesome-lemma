#input_type_name: MailWritingContextInput
#output_type_name: MailWritingContextResult
#function_name: mail_writing_context

"""Everything the writer needs for one draft, gathered in one call.

The writer gets no tools: a draft is only as good as what the writer read, so
the reading is done here, the same way every time, and the margin note can
say exactly what the draft was built from. It also marks the conversation
`writing`, so the app can show the draft is on its way.

  voice       how the owner writes, learned from their sent mail at set-up
  rules       their standing instructions for writing
  thread      the conversation, newest last
  reply_to    who the reply goes to by default (reply-all minus the owner)
  person      what Mail knows about the other side
  past_lines  a few of the owner's own earlier lines to this person, because
              people write differently to an investor and to a friend
  promises    open promises on the conversation, so a reply can keep them
  brand       the team's brand voice and guide, only when the conversation's
              category is switched to "Write in the team's brand voice" and the
              Lemma has a brand (Brand kit's shared `brand` table): mail sent
              on the team's behalf. A person's own replies stay in their voice.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

TAIL_CHARS = 6000
VOICE_FALLBACK = (
    "No voice learned yet. Write plainly and briefly, the way a busy person writes "
    "to someone they respect: short sentences, no filler, sign off with the first name."
)


class MailWritingContextInput(BaseModel):
    conversation_id: str
    # Overrides the conversation's own draft_kind (reply | follow_up | schedule).
    kind: str | None = None


class MailWritingContextResult(BaseModel):
    conversation_id: str
    kind: str
    hint: str | None = None
    me: dict
    voice: str
    rules: list[str]
    thread: dict
    reply_to: dict
    person: dict
    past_lines: list[str]
    promises: list[dict]
    brand: dict | None = None


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


GUIDE_CHARS = 5000


def _brand(pod, category: str | None) -> dict | None:
    """The team's brand voice, when this category writes for the team."""
    if not category:
        return None
    try:
        on = _rows(pod.query(
            f"SELECT brand_voice FROM mail_category WHERE key = {_sql(category)} AND state = 'active' LIMIT 1"))
        if not on or not on[0].get("brand_voice"):
            return None
        row = (_rows(pod.query(
            "SELECT name, voice, guide_path FROM brand WHERE state IN ('check', 'ready') "
            "ORDER BY is_default DESC, updated_at DESC LIMIT 1")) or [None])[0]
    except Exception:  # noqa: BLE001 — no brand to read: the person's own voice
        return None
    if not row or not (row.get("voice") or row.get("guide_path")):
        return None
    guide = ""
    if row.get("guide_path"):
        try:
            guide = pod.files.download(row["guide_path"]).decode("utf-8", "replace")[:GUIDE_CHARS]
        except Exception:  # noqa: BLE001 — the one-line voice still stands
            guide = ""
    return {"name": row.get("name"), "voice": row.get("voice"), "guide": guide}


def mail_writing_context(ctx: FunctionContext, data: MailWritingContextInput) -> MailWritingContextResult:
    pod = ctx.pod
    cid = data.conversation_id
    conv = pod.table("conversation").get(cid)
    thread = pod.table("mail_thread").get(cid)
    kind = data.kind or thread.get("draft_kind") or "reply"
    if conv.get("state") == "waiting" and not data.kind and thread.get("draft_kind") != "schedule":
        kind = "follow_up"
    pod.table("mail_thread").update(cid, {"draft_state": "writing"})
    counterpart = (conv.get("counterpart_handle") or "").lower()

    def doc() -> str:
        if not conv.get("document_path"):
            return conv.get("snippet") or ""
        try:
            text = pod.files.download(conv["document_path"]).decode("utf-8", "replace")
        except Exception:  # noqa: BLE001
            return conv.get("snippet") or ""
        if len(text) <= TAIL_CHARS:
            return text
        cut = text[-TAIL_CHARS:]
        boundary = cut.find("\n## ")
        return "…\n" + cut[boundary + 1 :] if 0 <= boundary < TAIL_CHARS // 2 else "…" + cut

    with ThreadPoolExecutor(max_workers=8) as pool:
        doc_job = pool.submit(doc)
        mailbox_job = pool.submit(lambda: pod.table("mail_mailbox").get(conv["source_account"]))
        settings_job = pool.submit(lambda: _rows(pod.query("SELECT * FROM mail_settings LIMIT 1")))
        rules_job = pool.submit(lambda: _rows(pod.query(
            "SELECT text FROM mail_rule WHERE state = 'active' AND scope IN ('general', 'writing') ORDER BY created_at")))
        person_job = pool.submit(lambda: _rows(pod.query(
            "SELECT p.name, p.org, p.title, p.is_vip FROM person_handle h JOIN person p ON p.id = h.person_id "
            f"WHERE h.kind = 'email' AND h.handle = {_sql(counterpart)} LIMIT 1")))
        promises_job = pool.submit(lambda: _rows(pod.query(
            f"SELECT direction, text, due_at FROM promise WHERE state = 'open' AND conversation_id = {_sql(cid)}")))
        lines_job = pool.submit(lambda: _rows(pod.query(
            "SELECT snippet FROM message WHERE direction = 'outbound' AND snippet IS NOT NULL "
            f"AND to_handles::text ILIKE {_sql('%' + counterpart + '%')} "
            f"AND conversation_id <> {_sql(cid)} ORDER BY sent_at DESC LIMIT 3")))
        mine_job = pool.submit(lambda: _rows(pod.query("SELECT email FROM mail_mailbox")))
        last_job = pool.submit(lambda: _rows(pod.query(
            "SELECT from_handle, to_handles, cc_handles FROM message "
            f"WHERE conversation_id = {_sql(cid)} ORDER BY sent_at DESC LIMIT 1")))
        mailbox = mailbox_job.result()
        settings = (settings_job.result() or [{}])[0]
        text = doc_job.result()
        rules = [r["text"] for r in rules_job.result()]
        person_row = (person_job.result() or [{}])[0]
        promises = promises_job.result()
        past_lines = [r["snippet"][:400] for r in lines_job.result() if counterpart]
        last = (last_job.result() or [{}])[0]
        mine = {(r.get("email") or "").lower() for r in mine_job.result()}

    zone_name = settings.get("timezone") or "UTC"
    try:
        zone = ZoneInfo(zone_name)
    except Exception:  # noqa: BLE001
        zone, zone_name = ZoneInfo("UTC"), "UTC"
    own = {(mailbox.get("email") or "").lower()} | mine
    # Reply-all, minus the owner: whoever wrote last goes on To, everyone else
    # who was on that message stays on Cc.
    if conv.get("last_direction") == "outbound":
        to = [a for a in (last.get("to_handles") or []) if a.lower() not in own] or ([counterpart] if counterpart else [])
        cc = [a for a in (last.get("cc_handles") or []) if a.lower() not in own]
    else:
        sender = (last.get("from_handle") or counterpart or "").lower()
        to = [sender] if sender else []
        cc = [a for a in (last.get("to_handles") or []) + (last.get("cc_handles") or [])
              if a.lower() not in own and a.lower() != sender]

    brand = _brand(pod, conv.get("category"))
    return MailWritingContextResult(
        brand=brand,
        conversation_id=cid,
        kind=kind,
        hint=thread.get("draft_hint"),
        me={"name": settings.get("display_name") or mailbox.get("owner_name"), "from": (mailbox.get("email") or "").lower(),
            "timezone": zone_name, "now_local": datetime.now(zone).strftime("%A %Y-%m-%d %H:%M %Z")},
        voice=(settings.get("voice") or VOICE_FALLBACK)[:6000],
        rules=rules,
        thread={"subject": conv.get("subject"), "ask": conv.get("ask"),
                "last_from": "you" if conv.get("last_direction") == "outbound" else "them",
                "waiting_since": thread.get("waiting_since"), "text": text},
        reply_to={"to": to[:5], "cc": cc[:8]},
        person={"email": counterpart, "name": person_row.get("name") or conv.get("counterpart_name"),
                "org": person_row.get("org"), "title": person_row.get("title"), "vip": bool(person_row.get("is_vip"))},
        past_lines=past_lines,
        promises=promises,
    )
