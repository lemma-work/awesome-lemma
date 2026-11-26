#input_type_name: MailNeedsYouInput
#output_type_name: MailNeedsYouResult
#function_name: mail_needs_you

"""Mail's part of the person's day: what in their mail needs them, written to
the shared `needs_you` list that Today reads (see _contract/README.md).

  answer   a conversation where someone is waiting on their reply
           (needs_reply, people, not muted, not snoozed), with Mail's
           drafted reply when there is one
  do       a promise they made in a mail conversation, still open
  waiting  a promise someone made them in one, still open, with Mail's
           drafted nudge when there is one, or why there is none yet
           (`mail_nudge_check`'s answer: "No nudge yet: it looks done another
           way")

Run as the person, from Mail's own triggers: a conversation's state changes
(the sort, a new message, the person in the Inbox), a mail promise or a mail
draft is written, and the hourly sweep (everything). Each pass writes the items
current in the conversations it looked at and resolves the rest there.

`settle_item_id`: the person closed one of Mail's items outside Mail (Today's
Done). A promise they marked done is done here too; nothing else is touched
(a reply owed is not archived in the mailbox from another app).
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PLUGIN = "mail"
SCOPE_VERBS = "('answer', 'do', 'waiting')"


class MailNeedsYouInput(BaseModel):
    conversation_ids: list[str] = []
    conversation_id: str | None = None
    all: bool = False
    settle_item_id: str | None = None


class MailNeedsYouResult(BaseModel):
    items: int
    counts: dict
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _clip(text: Any, size: int) -> str | None:
    text = " ".join(str(text or "").split())
    if not text:
        return None
    return text if len(text) <= size else text[: size - 1] + "…"


def _view(state: str | None) -> str:
    return "needs" if state == "needs_reply" else "waiting" if state == "waiting" else "inbox"


# contract:needs-you
# The one way to write `needs_you` (see _contract/README.md). Copied verbatim
# into every writer between these markers; _contract/lint.py fails on any
# difference. Needs a grant on needs_you (read and write).
import uuid as _ny_uuid
from datetime import datetime as _ny_datetime, timezone as _ny_timezone

NEEDS_YOU_NS = _ny_uuid.UUID("6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65")


def needs_you_id(plugin: str, table: str, source_id: str, verb: str, member: str) -> str:
    """The item's id: one per (plugin, source table, source row, verb, member)."""
    return str(_ny_uuid.uuid5(NEEDS_YOU_NS, f"{plugin}/{table}/{source_id}/{verb}/{member}"))


def needs_you_write(pod, plugin: str, member: str, items: list, scope_where: str | None = None) -> dict:
    """Write what needs the member now, from one plugin, and resolve the rest.

    `items` are the plugin's current items within the scope, each with verb,
    title, source_table, source_id and source_version, and any other column.
    `scope_where` is a SQL condition on needs_you naming what this pass looked
    at (e.g. "conversation_id IN (...)"); None means everything of this plugin.

    - new: created open.
    - open or snoozed: updated in place (a snooze holds until it ends).
    - dismissed, or done by the person: left alone, unless source_version
      changed, when it opens again.
    - done by the source (resolved before): opens again.
    - open or snoozed items in scope that are no longer current: done, closed
      by the source.
    """
    def rows(response):
        payload = response.to_dict() if hasattr(response, "to_dict") else response
        return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]

    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"

    now = _ny_datetime.now(_ny_timezone.utc).isoformat()
    current = {}
    for item in items:
        row = dict(item, source_plugin=plugin)
        row["id"] = needs_you_id(plugin, row["source_table"], str(row["source_id"]), row["verb"], member)
        current[row["id"]] = row
    where = f"source_plugin = {quoted(plugin)}" + (f" AND ({scope_where})" if scope_where else "")
    seen = {r["id"]: r for r in rows(pod.query(
        f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE {where} LIMIT 5000"))}
    missing = [i for i in current if i not in seen]
    for start in range(0, len(missing), 200):
        ids = ", ".join(quoted(i) for i in missing[start : start + 200])
        seen.update({r["id"]: r for r in rows(pod.query(
            f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE id IN ({ids})"))})
    creates, updates, counts = [], [], {"created": 0, "updated": 0, "kept_closed": 0, "resolved": 0}
    for item_id, row in current.items():
        old = seen.get(item_id)
        if old is None:
            creates.append(dict(row, state="open"))
            continue
        changed = (old.get("source_version") or "") != (row.get("source_version") or "")
        state = old.get("state")
        if state in ("dismissed", "done") and old.get("closed_by") != "source" and not changed:
            counts["kept_closed"] += 1
            continue
        if state == "snoozed" and not changed and (old.get("snoozed_until") or "") > now:
            updates.append(row)
            continue
        updates.append(dict(row, state="open", closed_by=None, snoozed_until=None))
    for item_id, old in seen.items():
        if item_id not in current and old.get("state") in ("open", "snoozed"):
            updates.append({"id": item_id, "state": "done", "closed_by": "source"})
            counts["resolved"] += 1
    for start in range(0, len(creates), 100):
        pod.records.bulk_create("needs_you", creates[start : start + 100], upsert=True)
    for start in range(0, len(updates), 100):
        pod.records.bulk_update("needs_you", updates[start : start + 100])
    counts["created"], counts["updated"] = len(creates), len(updates) - counts["resolved"]
    return counts
# end contract


def _settle(pod: Any, item_id: str) -> str:
    item = (_rows(pod.query(
        f"SELECT verb, source_table, source_id, state, closed_by FROM needs_you WHERE id = {_sql(item_id)} AND source_plugin = 'mail'"))
        or [None])[0]
    if not item or item.get("state") != "done" or item.get("closed_by") != "person":
        return "Nothing to settle."
    if item.get("source_table") == "promise" and item.get("verb") in ("do", "waiting", "decide"):
        promise = (_rows(pod.query(f"SELECT id, state FROM promise WHERE id = {_sql(item['source_id'])}")) or [None])[0]
        if promise and promise.get("state") == "open":
            pod.table("promise").update(promise["id"], {"state": "done"})
            return "The promise is done."
    return "Nothing to change in Mail."


def mail_needs_you(ctx: FunctionContext, data: MailNeedsYouInput) -> MailNeedsYouResult:
    pod = ctx.pod
    member = str(ctx.user_id)
    if data.settle_item_id:
        said = _settle(pod, data.settle_item_id)
        return MailNeedsYouResult(items=0, counts={}, message=said)
    ids = [i for i in ([data.conversation_id] if data.conversation_id else []) + list(data.conversation_ids) if i]
    if not ids and not data.all:
        return MailNeedsYouResult(items=0, counts={}, message="No conversation named.")
    only = "" if data.all else f" AND c.id IN ({_in(ids)})"

    convs = {r["id"]: r for r in _rows(pod.query(
        "SELECT c.id, c.subject, c.ask, c.snippet, c.counterpart_name, c.counterpart_handle, c.last_inbound_at, "
        "c.last_message_at, c.priority, c.state, c.kind, t.muted, t.snoozed_until, t.draft_state, t.draft_kind "
        "FROM conversation c JOIN mail_thread t ON t.id = c.id "
        f"WHERE c.source = 'mail'{only} LIMIT 3000"))}
    promises = _rows(pod.query(
        "SELECT p.id, p.conversation_id, p.direction, p.text, p.quote, p.due_at, p.person_name, p.person_handle, p.state, "
        # When it was said: the message the promise reader heard it in.
        "(SELECT max(m.sent_at) FROM message m WHERE m.conversation_id = p.conversation_id AND m.source_id = p.source_id) AS said_at "
        "FROM promise p JOIN conversation c ON c.id = p.conversation_id "
        f"WHERE p.source = 'mail' AND p.state = 'open'{only} LIMIT 3000"))
    drafts: dict[tuple[str, str], dict] = {}
    for d in _rows(pod.query(
            "SELECT d.conversation_id, d.kind, d.body, d.updated_at FROM draft d JOIN conversation c ON c.id = d.conversation_id "
            f"WHERE d.source = 'mail' AND d.state = 'proposed'{only} ORDER BY d.updated_at LIMIT 3000")):
        drafts[(d["conversation_id"], "nudge" if d.get("kind") == "follow_up" else "reply")] = d
    nudges = {r["id"]: r for r in _rows(pod.query(
        f"SELECT n.id, n.answer, n.reason FROM mail_nudge n JOIN conversation c ON c.id = n.id WHERE TRUE{only} LIMIT 3000"))}
    vips = {r["handle"] for r in _rows(pod.query(
        "SELECT h.handle FROM person_handle h JOIN person p ON p.id = h.person_id WHERE p.is_vip IS TRUE LIMIT 500"))}

    items: list[dict] = []
    for c in convs.values():
        if c.get("state") != "needs_reply" or c.get("kind") != "people" or c.get("muted"):
            continue
        if c.get("snoozed_until") and str(c["snoozed_until"]) > _now():
            continue
        who = c.get("counterpart_name") or c.get("counterpart_handle") or "Someone"
        reply = drafts.get((c["id"], "reply"))
        items.append({
            "verb": "answer", "source_table": "conversation", "source_id": c["id"], "conversation_id": c["id"],
            "source_version": f"{c.get('state')}|{c.get('last_message_at')}",
            "title": _clip(c.get("ask") or c.get("subject") or "A reply", 300),
            "why": _clip(f"{who} is waiting on your reply" + (f": {c['subject']}" if c.get("ask") and c.get("subject") else ""), 300),
            "quote": _clip(c.get("snippet"), 600),
            "person_name": c.get("counterpart_name"), "person_handle": (c.get("counterpart_handle") or "").lower() or None,
            "since_at": c.get("last_inbound_at") or c.get("last_message_at"), "due_at": None,
            "weight": float(int(c.get("priority") or 0) * 10 + (5 if (c.get("counterpart_handle") or "").lower() in vips else 0)),
            "app": "inbox", "path": f"/needs/{c['id']}",
            "prepared": "Reply drafted in your voice" if reply else None,
            "prepared_text": _clip(reply.get("body"), 2000) if reply else None,
        })
    for p in promises:
        c = convs.get(p["conversation_id"]) or {}
        who = p.get("person_name") or p.get("person_handle") or c.get("counterpart_name") or "them"
        mine = p.get("direction") == "i_owe"
        nudge = None if mine else drafts.get((p["conversation_id"], "nudge"))
        decided = None if mine else nudges.get(p["conversation_id"])
        writing = not mine and not nudge and c.get("draft_state") in ("wanted", "writing") and c.get("draft_kind") == "follow_up"
        held = not mine and not nudge and not writing and decided and decided.get("answer") != "yes"
        item = {
            "verb": "do" if mine else "waiting", "source_table": "promise", "source_id": p["id"],
            "conversation_id": p["conversation_id"],
            "source_version": f"{p.get('text')}|{p.get('due_at')}|{p.get('state')}",
            "title": _clip(p.get("text"), 300),
            "why": _clip((f"You told {who}" if mine else f"{who} said they would") + (f", in “{c['subject']}”" if c.get("subject") else ""), 300),
            "quote": _clip(p.get("quote"), 600),
            "person_name": p.get("person_name"), "person_handle": (p.get("person_handle") or "").lower() or None,
            "due_at": p.get("due_at"), "since_at": p.get("said_at"), "weight": 0.0,
            "app": "inbox", "path": f"/{_view(c.get('state'))}/{p['conversation_id']}",
            "prepared": ("Nudge drafted in your voice" if nudge else "Nudge being written" if writing
                         else _clip(f"No nudge yet: {decided.get('reason')}", 120) if held else None),
            "prepared_text": _clip(nudge.get("body"), 2000) if nudge else None,
        }
        if nudge:
            item["request"] = None
        items.append(item)

    scope = f"verb IN {SCOPE_VERBS}" + ("" if data.all else f" AND conversation_id IN ({_in(ids)})")
    counts = needs_you_write(pod, PLUGIN, member, items, scope)
    return MailNeedsYouResult(items=len(items), counts=counts,
                              message=f"{len(items)} item(s) from mail: {counts}")


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
