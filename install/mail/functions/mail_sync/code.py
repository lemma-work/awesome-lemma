#input_type_name: MailSyncInput
#output_type_name: MailSyncResult
#function_name: mail_sync

"""Read Gmail and Outlook into conversations, messages and one document per
conversation.

One code path for the first read, a push and the catch-up. Two paths drift,
and the drift shows up months later as a hole in search. The made-up sample
mailbox (account "sample") goes through this same path too, reading its
messages from a fixture instead of a provider, so the first read can be seen
and tested without anyone's mail.

The first read goes in the order that gets a person to useful work fastest:

    recent       the window (30 days by default), inbox and sent. Every
                 conversation here gets sorted, including the ones never
                 answered, which a sent-first read would miss.
    corpus_sent  sent mail across the window: every conversation the owner took
                 part in is one worth keeping as a document (and a voice sample).
    corpus_fill  the full text of those conversations, newest first, written as
                 one markdown document each so search can find it.
    index_only   what is still in the inbox across the window, headers only.

Live reading is `recent` since a watermark, then `corpus_fill` for whatever
changed. A mail_sync_state row per mailbox and kind holds the cursor and a
lease, so a push and the catch-up landing together do not both write.

Writes go to two tables with one id: the shared `conversation` (source
"mail", the mailbox as source_account, the provider's thread id as
source_id) and Mail's own `mail_thread` (read, labels, in the inbox, document
written, drafting). Every message goes to the shared `message`, addressed by
handles (email addresses), with nothing Gmail- or Outlook-specific.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses
from html import unescape
from html.parser import HTMLParser
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

WINDOW_DAYS = 30
# Conversation and message ids are derived from the mailbox and the provider's own id,
# so every sync that sees the same mail writes the same row. A push for "sent",
# a push for "received" and the catch-up can all land within seconds of each
# other; with random ids each created its own copy of a new thread (a tester
# saw one sent mail three times). Upserting on a derived key cannot duplicate.
ID_NAMESPACE = uuid.UUID("6b1c2b52-6a0e-4c8b-9a1e-1f1d6a0b7c31")


def _key_id(kind: str, mailbox_id: str, provider_id: str) -> str:
    return str(uuid.uuid5(ID_NAMESPACE, f"{kind}:{mailbox_id}:{provider_id}"))
PAGE_SIZE = 50
FILL_BATCH = 12
FILL_WORKERS = 4
LEASE_SECONDS = 150
DOCUMENTS_ROOT = "/me/mail/conversations"
SAMPLE_ROOT = "/mail-sample"
SAMPLE_ACCOUNT = "sample"

# Which fields of a conversation as sync sees it belong to the shared table,
# and which to Mail's own working row. Everything else is dropped.
CONVERSATION_FIELDS = {
    "id", "source", "source_account", "source_id", "place", "subject", "snippet", "participants",
    "counterpart_handle", "counterpart_name", "last_message_at", "last_inbound_at", "last_outbound_at",
    "last_direction", "message_count", "has_attachments", "kind", "document_path", "state",
    "priority", "category", "ask", "sorted_at",
}
THREAD_FIELDS = {
    "id", "unread", "in_inbox", "provider_category", "labels", "latest_message_id", "document_filled",
    "snoozed_until", "muted", "follow_up_at", "waiting_since", "claimed_at", "unsure", "sorted_by",
    "reason", "draft_state", "draft_kind", "draft_hint", "promise_state",
}

GMAIL_BULK = {"CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "CATEGORY_UPDATES"}
GMAIL_CATEGORY = {
    "CATEGORY_PERSONAL": "personal",
    "CATEGORY_PROMOTIONS": "promotions",
    "CATEGORY_SOCIAL": "social",
    "CATEGORY_FORUMS": "forums",
    "CATEGORY_UPDATES": "updates",
}
AUTOMATED = re.compile(
    r"^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer-daemon|bounce|news(letter)?|digest|updates?)[@+.-]",
    re.I,
)
OUTLOOK_FIELDS = [
    "id", "conversationId", "subject", "from", "toRecipients", "ccRecipients",
    "receivedDateTime", "sentDateTime", "bodyPreview", "inferenceClassification",
    "isRead", "hasAttachments", "categories", "isDraft",
]


class MailSyncInput(BaseModel):
    # None means every mailbox the caller has connected (RLS scopes it to theirs).
    mailbox_id: str | None = None
    # Restrict to one provider: the Gmail push workflow should not walk Outlook.
    provider: str | None = None
    # backfill: the first read. incremental: since the watermark.
    # auto: incremental, then any unfinished backfill with the time left.
    mode: str = "auto"
    budget_seconds: int = 60
    # Ignored; lets a workflow LOOP call this once per pass number.
    run_pass: int | None = None


class MailSyncResult(BaseModel):
    mailboxes: list[dict]
    new_conversations: int
    done: bool
    message: str


# --------------------------------------------------------------------------
# small helpers


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if text.isdigit():
        # Gmail sometimes hands back epoch milliseconds.
        number = int(text)
        return datetime.fromtimestamp(number / 1000 if number > 10**11 else number, timezone.utc)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    # Composio nests the body under `data` on some operations and not others.
    if isinstance(result, dict) and isinstance(result.get("data"), dict) and not (
        "messages" in result or "value" in result
    ):
        return result["data"]
    return result if isinstance(result, dict) else {}


def _addresses(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        raw = ", ".join(str(x) for x in raw if x)
    return [addr.lower() for _, addr in getaddresses([str(raw)]) if "@" in addr]


def _name(raw: Any) -> str | None:
    if not raw:
        return None
    parsed = getaddresses([str(raw)])
    if parsed and parsed[0][0]:
        return parsed[0][0].strip().strip('"')[:200]
    return None


class _Text(HTMLParser):
    """HTML mail to readable text: block tags become line breaks, links become
    [label](url) so the reader can still follow them, the rest is dropped."""

    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "table", "ul", "ol"}
    SKIP = {"style", "script", "head", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skipping = 0
        self.anchor: tuple[int, str] | None = None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skipping += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")
            if tag == "li":
                self.parts.append("• ")
        elif tag == "a" and not self.skipping:
            href = (dict(attrs).get("href") or "").strip()
            ok = href.lower().startswith(("http://", "https://")) and len(href) <= 600
            self.anchor = (len(self.parts), href) if ok else None

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skipping:
            self.skipping -= 1
        elif tag in self.BLOCK:
            self.parts.append("\n")
        elif tag == "a" and self.anchor:
            start, href = self.anchor
            self.anchor = None
            label = " ".join("".join(self.parts[start:]).split()).replace("[", "").replace("]", "")
            # A label that is itself an address reads fine as it is; an image
            # link (no label) is usually a tracker, so it is dropped.
            if label and label != href and not re.match(r"(https?://|www\.)", label, re.I):
                self.parts[start:] = [f"[{label}]({href})"]

    def handle_data(self, data):
        if not self.skipping:
            self.parts.append(data)


def _html_to_text(html: str) -> str:
    parser = _Text()
    try:
        parser.feed(html)
        text = "".join(parser.parts)
    except Exception:  # noqa: BLE001 — malformed HTML still has words in it
        text = re.sub(r"<[^>]+>", " ", html)
    text = unescape(text).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


LOOKS_HTML = re.compile(r"<(p|div|br|table|span|html|body)[\s>/]", re.I)

QUOTE_STARTS = [
    re.compile(r"^On .{4,200}wrote:\s*$", re.I),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}", re.I),
    re.compile(r"^_{8,}\s*$"),
    re.compile(r"^From: .+$", re.I),
]


def _strip_quoted(text: str) -> str:
    """Keep what this message added, drop the history it was written on top of.

    The document is the whole thread already; repeating every ancestor under
    every reply makes it ten times longer and buries the newest words.
    """
    kept: list[str] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(">"):
            continue
        # Gmail wraps a long attribution: "On Tue, Oct 6, 2026 at 4:34 PM Name <a@b>"
        # then "wrote:" on the next line.
        following = lines[index + 1].strip() if index + 1 < len(lines) else ""
        if stripped.startswith("On ") and following.endswith("wrote:") and len(stripped) < 200:
            break
        if any(p.match(stripped) for p in QUOTE_STARTS):
            # "From:" only counts as a quote header when "Sent:" or "Date:" follows.
            if stripped.lower().startswith("from:"):
                window = " ".join(lines[index + 1 : index + 4]).lower()
                if "sent:" not in window and "date:" not in window:
                    kept.append(line)
                    continue
            break
        kept.append(line)
    return "\n".join(kept).strip()


# --------------------------------------------------------------------------
# provider adapters: everything becomes one normalised message shape
#
#   id, thread, from_email, from_name, to, cc, subject, sent_at (datetime),
#   snippet, text, labels, category, has_attachments, unread, in_inbox, outbound


def _norm_gmail(message: dict, me: str) -> dict | None:
    if not message.get("messageId") or not message.get("threadId"):
        return None
    labels = list(message.get("labelIds") or [])
    sender = message.get("sender")
    from_email = (_addresses(sender) or [None])[0]
    preview = message.get("preview") if isinstance(message.get("preview"), dict) else {}
    text = (message.get("messageText") or "").strip()
    if LOOKS_HTML.search(text):
        # Some senders' "plain text" part is HTML (support desks, mostly).
        text = _html_to_text(text)
    category = next((GMAIL_CATEGORY[l] for l in labels if l in GMAIL_CATEGORY), None)
    return {
        "id": message["messageId"],
        "thread": message["threadId"],
        "from_email": from_email,
        "from_name": _name(sender),
        "to": _addresses(message.get("to")),
        "cc": _addresses(message.get("cc")),
        "subject": (message.get("subject") or "")[:500] or None,
        "sent_at": _parse_dt(message.get("messageTimestamp")),
        "snippet": ((preview or {}).get("body") or text)[:1000],
        "text": text,
        "labels": labels,
        "category": category,
        "bulk": bool(set(labels) & GMAIL_BULK) and "CATEGORY_PERSONAL" not in labels,
        "has_attachments": bool(message.get("attachmentList")),
        "unread": "UNREAD" in labels,
        "in_inbox": "INBOX" in labels,
        "outbound": "SENT" in labels or (from_email or "") == me,
    }


def _ol_address(entry: Any) -> tuple[str | None, str | None]:
    box = (entry or {}).get("emailAddress") or {}
    address = (box.get("address") or "").lower() or None
    return address, (box.get("name") or None)


def _norm_outlook(message: dict, me: str, folder_hint: str | None = None) -> dict | None:
    if not message.get("id") or not message.get("conversationId") or message.get("isDraft"):
        return None
    from_email, from_name = _ol_address(message.get("from"))
    body = message.get("body") or {}
    content = body.get("content") or ""
    text = _html_to_text(content) if (body.get("contentType") or "").lower() == "html" else content
    outbound = folder_hint == "sentitems" or (from_email or "") == me
    stamp = message.get("sentDateTime") if outbound else message.get("receivedDateTime")
    classification = (message.get("inferenceClassification") or "").lower() or None
    return {
        "id": message["id"],
        "thread": message["conversationId"],
        "from_email": from_email,
        "from_name": from_name,
        "to": [a for a in (_ol_address(r)[0] for r in message.get("toRecipients") or []) if a],
        "cc": [a for a in (_ol_address(r)[0] for r in message.get("ccRecipients") or []) if a],
        "subject": (message.get("subject") or "")[:500] or None,
        "sent_at": _parse_dt(stamp or message.get("receivedDateTime") or message.get("sentDateTime")),
        "snippet": (message.get("bodyPreview") or text)[:1000],
        "text": (text or "").strip(),
        "labels": list(message.get("categories") or []),
        "category": classification,
        "bulk": classification == "other",
        "has_attachments": bool(message.get("hasAttachments")),
        "unread": message.get("isRead") is False,
        "in_inbox": folder_hint == "inbox",
        "outbound": outbound,
    }


class Provider:
    """What sync needs from a mailbox, whichever company runs it."""

    def __init__(self, pod: Any, mailbox: dict):
        self.pod = pod
        self.mailbox = mailbox
        self.me = (mailbox.get("email") or "").lower()
        self.account = mailbox["account_id"]

    def call(self, operation: str, payload: dict) -> dict:
        auth = "gmail" if self.mailbox["provider"] == "gmail" else "outlook"
        return _result(self.pod.connectors.execute(auth, operation, payload, account_id=self.account))


class Gmail(Provider):
    def page(self, query: str, token: str | None) -> tuple[list[dict], str | None, int | None]:
        payload: dict[str, Any] = {
            "user_id": "me", "query": query, "max_results": PAGE_SIZE,
            "include_payload": False, "verbose": False,
        }
        if token:
            payload["page_token"] = token
        page = self.call("GMAIL_FETCH_EMAILS", payload)
        messages = [m for m in (_norm_gmail(x, self.me) for x in page.get("messages") or []) if m]
        return messages, page.get("nextPageToken"), page.get("resultSizeEstimate")

    def recent(self, since: datetime, cursor: dict) -> tuple[list[dict], bool]:
        messages, token, _ = self.page(f"after:{int(since.timestamp())}", cursor.get("page"))
        cursor["page"] = token
        return messages, not token

    def sent(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool, int | None]:
        messages, token, estimate = self.page(f"in:sent after:{int(cutoff.timestamp())}", cursor.get("page"))
        cursor["page"] = token
        return messages, not token, estimate

    def inbox(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool]:
        messages, token, _ = self.page(
            f"in:inbox -in:sent after:{int(cutoff.timestamp())}", cursor.get("page")
        )
        cursor["page"] = token
        return messages, not token

    def conversation(self, thread_id: str) -> list[dict]:
        result = self.call("GMAIL_FETCH_MESSAGE_BY_THREAD_ID", {"user_id": "me", "thread_id": thread_id})
        return [m for m in (_norm_gmail(x, self.me) for x in result.get("messages") or []) if m]


class Outlook(Provider):
    def page(self, folder: str, extra: dict, token: str | None, fields: list[str] | None = None):
        payload: dict[str, Any] = {
            "user_id": "me", "folder": folder, "top": PAGE_SIZE,
            "select": fields or OUTLOOK_FIELDS, **extra,
        }
        if token:
            payload["page_token"] = token
        page = self.call("OUTLOOK_LIST_MESSAGES", payload)
        hint = folder if folder in ("inbox", "sentitems") else None
        messages = [m for m in (_norm_outlook(x, self.me, hint) for x in page.get("value") or []) if m]
        return messages, page.get("next_page_token")

    def recent(self, since: datetime, cursor: dict) -> tuple[list[dict], bool]:
        # Two folders, two cursors: what arrived, and what you sent from anywhere.
        out: list[dict] = []
        if not cursor.get("inbox_done"):
            messages, token = self.page(
                "inbox", {"received_date_time_gt": _iso(since)}, cursor.get("page")
            )
            out += messages
            cursor["page"] = token
            cursor["inbox_done"] = not token
            if token:
                return out, False
        messages, token = self.page(
            "sentitems", {"sent_date_time_gt": _iso(since)}, cursor.get("sent_page")
        )
        out += messages
        cursor["sent_page"] = token
        done = not token
        if done:
            cursor.pop("inbox_done", None)
        return out, done

    def sent(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool, int | None]:
        messages, token = self.page("sentitems", {"sent_date_time_gt": _iso(cutoff)}, cursor.get("page"))
        cursor["page"] = token
        return messages, not token, None

    def inbox(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool]:
        messages, token = self.page("inbox", {"received_date_time_ge": _iso(cutoff)}, cursor.get("page"))
        cursor["page"] = token
        return messages, not token

    def conversation(self, thread_id: str) -> list[dict]:
        # `allfolders` + a conversation filter returns both sides of the exchange
        # in one call; the inbox alone would miss every reply you sent.
        messages, _ = self.page(
            "allfolders",
            {"filter": f"conversationId eq '{thread_id}'"},
            None,
            OUTLOOK_FIELDS + ["body", "parentFolderId"],
        )
        return messages


class Sample(Provider):
    """The made-up mailbox. mail_sample_data writes its messages, already in the
    normalised shape, to a fixture beside its documents; reading it here means
    the sample goes through exactly what real mail goes through."""

    def __init__(self, pod: Any, mailbox: dict):
        super().__init__(pod, mailbox)
        raw = pod.files.download(f"{SAMPLE_ROOT}/{mailbox['id']}.json").decode("utf-8")
        self.messages = []
        for item in json.loads(raw):
            message = dict(item)
            message["sent_at"] = _parse_dt(message.get("sent_at"))
            message.setdefault("text", message.get("snippet") or "")
            self.messages.append(message)

    def _window(self, since: datetime, *, sent: bool | None = None, inbox: bool | None = None) -> list[dict]:
        out = []
        for m in self.messages:
            if not m["sent_at"] or m["sent_at"] <= since:
                continue
            if sent is not None and bool(m["outbound"]) != sent:
                continue
            if inbox is not None and bool(m["in_inbox"]) != inbox:
                continue
            out.append(m)
        return out

    def recent(self, since: datetime, cursor: dict) -> tuple[list[dict], bool]:
        return self._window(since), True

    def sent(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool, int | None]:
        found = self._window(cutoff, sent=True)
        return found, True, len(found)

    def inbox(self, cutoff: datetime, cursor: dict) -> tuple[list[dict], bool]:
        return self._window(cutoff, sent=False, inbox=True), True

    def conversation(self, thread_id: str) -> list[dict]:
        return [m for m in self.messages if m["thread"] == thread_id]


def _provider(pod: Any, mailbox: dict) -> Provider:
    if mailbox.get("account_id") == SAMPLE_ACCOUNT:
        return Sample(pod, mailbox)
    return Gmail(pod, mailbox) if mailbox["provider"] == "gmail" else Outlook(pod, mailbox)


# --------------------------------------------------------------------------
# writing what was read


def _split(row: dict) -> tuple[dict, dict]:
    """One conversation as sync sees it, as the two rows that hold it."""
    return ({k: v for k, v in row.items() if k in CONVERSATION_FIELDS},
            {k: v for k, v in row.items() if k in THREAD_FIELDS})


def _is_correspondence(messages: list[dict]) -> bool:
    """A conversation with a person, or something addressed to a list?

    The owner having written in it outranks anything the provider decided:
    real conversations get filed under Updates. Then the provider's own
    classification, then the sender's address. Unclassified mail counts as a
    conversation, because wrongly hiding a real one costs far more than keeping
    one newsletter.
    """
    if any(m["outbound"] for m in messages):
        return True
    if any(m["category"] == "personal" or m["category"] == "focused" for m in messages):
        return True
    if any(m["bulk"] for m in messages):
        return False
    if all(AUTOMATED.match(m["from_email"] or "") for m in messages):
        return False
    return True


def _counterpart(messages: list[dict]) -> tuple[str | None, str | None]:
    for message in sorted(messages, key=lambda m: m["sent_at"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        if not message["outbound"] and message["from_email"]:
            return message["from_email"], message["from_name"]
    for message in messages:
        for address in message["to"]:
            return address, None
    return None, None


def _existing_ids(pod: Any, mailbox_id: str, ids: list[str]) -> set[str]:
    """Provider message ids already held. Message row ids derive from the
    mailbox and the provider id, so this is a lookup by id."""
    by_row = {_key_id("message", mailbox_id, i): i for i in ids}
    found: set[str] = set()
    keys = list(by_row)
    for start in range(0, len(keys), 60):
        chunk = keys[start : start + 60]
        rows = _rows(pod.query(f"SELECT id FROM message WHERE id IN ({', '.join(_sql(i) for i in chunk)})"))
        found |= {by_row[r["id"]] for r in rows if r["id"] in by_row}
    return found


def _known(pod: Any, mailbox_id: str, keys: list[str]) -> dict[str, dict]:
    """Conversations already held, by provider id, with Mail's state beside them."""
    out: dict[str, dict] = {}
    for start in range(0, len(keys), 40):
        chunk = keys[start : start + 40]
        rows = _rows(pod.query(
            "SELECT c.id, c.source_id, c.kind, c.state, c.last_message_at, c.document_path, "
            "c.subject, c.message_count, t.document_filled, t.draft_state, t.in_inbox, t.unread, t.muted, "
            "t.waiting_since FROM conversation c LEFT JOIN mail_thread t ON t.id = c.id "
            f"WHERE c.source = 'mail' AND c.source_account = {_sql(mailbox_id)} "
            f"AND c.source_id IN ({', '.join(_sql(k) for k in chunk)})"
        ))
        out.update({r["source_id"]: r for r in rows})
    return out


def _write(pod: Any, creates: list[dict], updates: list[dict]) -> None:
    """Both tables, conversation first: messages point at it."""
    if creates:
        pairs = [_split(r) for r in creates]
        for start in range(0, len(pairs), 100):
            pod.records.bulk_create("conversation", [c for c, _ in pairs[start : start + 100]], upsert=True)
        for start in range(0, len(pairs), 100):
            pod.records.bulk_create("mail_thread", [t for _, t in pairs[start : start + 100]], upsert=True)
    if updates:
        pairs = [_split(r) for r in updates]
        conversations = [c for c, _ in pairs if len(c) > 1]
        threads = [t for _, t in pairs if len(t) > 1]
        for start in range(0, len(conversations), 100):
            pod.records.bulk_update("conversation", conversations[start : start + 100])
        for start in range(0, len(threads), 100):
            pod.records.bulk_update("mail_thread", threads[start : start + 100])


class Writer:
    def __init__(self, pod: Any, mailbox: dict, follow_up_days: int, window_days: int):
        self.pod = pod
        self.mailbox = mailbox
        self.follow_up_days = follow_up_days
        self.window_days = window_days
        self.sample = mailbox.get("account_id") == SAMPLE_ACCOUNT
        self.new_conversations = 0
        self.processed = 0
        self.folder_ready = False

    def ingest(self, messages: list[dict], *, kind: str | None = None) -> dict[str, dict]:
        """Write new messages and move each touched conversation to its next state.

        Batched: one read of known messages, one of known conversations, bulk
        writes for both conversation tables, one bulk create for messages.
        """
        if not messages:
            return {}
        pod, mailbox_id = self.pod, self.mailbox["id"]
        by_thread: dict[str, list[dict]] = {}
        for message in messages:
            by_thread.setdefault(message["thread"], []).append(message)

        known_messages = _existing_ids(pod, mailbox_id, [m["id"] for m in messages])
        known = _known(pod, mailbox_id, list(by_thread))
        now = _now()
        window_cut = now - timedelta(days=self.window_days)
        to_create: list[dict] = []
        to_update: list[dict] = []
        discard_drafts: list[str] = []

        for key, bucket in by_thread.items():
            bucket.sort(key=lambda m: m["sent_at"] or now)
            fresh = [m for m in bucket if m["id"] not in known_messages]
            newest = bucket[-1]
            counterpart, counterpart_name = _counterpart(bucket)
            participants = sorted({a for m in bucket for a in ([m["from_email"]] + m["to"] + m["cc"]) if a})
            inbound = [m for m in bucket if not m["outbound"]]
            outbound = [m for m in bucket if m["outbound"]]
            fields: dict[str, Any] = {
                "subject": newest["subject"] or (bucket[0]["subject"]),
                "snippet": (newest["snippet"] or "")[:400] or None,
                "participants": participants,
                "counterpart_handle": counterpart,
                "counterpart_name": counterpart_name,
                "has_attachments": any(m["has_attachments"] for m in bucket),
            }
            category = next((m["category"] for m in reversed(inbound) if m["category"]), None)
            if category:
                fields["provider_category"] = category
            fields["labels"] = (newest.get("labels") or [])[:20]
            conversation_kind = kind or ("people" if _is_correspondence(bucket) else "broadcast")
            existing = known.get(key)
            existing_last = _parse_dt(existing.get("last_message_at")) if existing else None

            if existing is None:
                last = newest["sent_at"] or now
                in_window = last >= window_cut
                row = {
                    "id": _key_id("thread", mailbox_id, key),
                    "source": "mail",
                    "source_account": mailbox_id,
                    "source_id": key,
                    "place": self.mailbox.get("email"),
                    "kind": conversation_kind,
                    # Only the window is worth sorting; older mail is history,
                    # findable by search.
                    "state": "new" if in_window else "done",
                    "document_filled": False,
                    "draft_state": "none",
                    "message_count": len(bucket),
                    "last_message_at": _iso(last),
                    "last_direction": "outbound" if newest["outbound"] else "inbound",
                    "last_inbound_at": _iso(inbound[-1]["sent_at"]) if inbound and inbound[-1]["sent_at"] else None,
                    "last_outbound_at": _iso(outbound[-1]["sent_at"]) if outbound and outbound[-1]["sent_at"] else None,
                    "latest_message_id": newest["id"],
                    "unread": any(m["unread"] for m in bucket),
                    "in_inbox": any(m["in_inbox"] for m in bucket),
                    **fields,
                }
                if not in_window:
                    row.update({"sorted_by": "sync", "reason": "Older than the first read's window"})
                to_create.append(row)
                if in_window:
                    self.new_conversations += 1
                continue

            stale_page = bool(existing_last and newest["sent_at"] and newest["sent_at"] < existing_last)
            if stale_page and len(bucket) < int(existing.get("message_count") or 0):
                # An older, partial page of a conversation already known (the
                # sent pass after the recent pass): not the newest, so it must
                # not repaint the preview.
                fields = {"has_attachments": fields["has_attachments"]} if fields["has_attachments"] else {}
            change: dict[str, Any] = {"id": existing["id"], **fields}
            # Labels are only trusted upward here: one message still in the
            # inbox, or unread, is proof; not seeing one in this page is not.
            if any(m["in_inbox"] for m in bucket):
                change["in_inbox"] = True
            if any(m["unread"] for m in fresh):
                change["unread"] = True
            if conversation_kind == "people" and existing.get("kind") != "people":
                change["kind"] = "people"
                change["document_filled"] = False
            newer = [m for m in fresh if m["sent_at"] and (existing_last is None or m["sent_at"] > existing_last)]
            if newer:
                latest = newer[-1]
                change["last_message_at"] = _iso(latest["sent_at"])
                change["latest_message_id"] = latest["id"]
                change["last_direction"] = "outbound" if latest["outbound"] else "inbound"
                change["unread"] = any(m["unread"] for m in newer) or bool(existing.get("unread"))
                if any(m["in_inbox"] for m in newer):
                    change["in_inbox"] = True
                if existing.get("kind") == "people" or change.get("kind") == "people":
                    # The document is now one message behind; rebuild it.
                    change["document_filled"] = False
                # New words may hold a new promise: let the next sort ask again.
                change["promise_state"] = "none"
                if latest["outbound"]:
                    change["last_outbound_at"] = _iso(latest["sent_at"])
                    # Answered somewhere else (a phone, the web client). The
                    # ball is theirs now, and any draft held is stale.
                    if existing.get("state") in ("new", "needs_reply", "fyi"):
                        change["state"] = "waiting"
                        change["waiting_since"] = _iso(latest["sent_at"])
                        change["follow_up_at"] = _iso(latest["sent_at"] + timedelta(days=self.follow_up_days))
                    if existing.get("draft_state") in ("wanted", "ready", "writing"):
                        change["draft_state"] = "none"
                        discard_drafts.append(existing["id"])
                else:
                    change["last_inbound_at"] = _iso(latest["sent_at"])
                    # New words from them: read it again. Muted stays muted.
                    if not existing.get("muted"):
                        change.update({"state": "new", "snoozed_until": None, "claimed_at": None})
                        self.new_conversations += 1
            to_update.append(change)

        _write(pod, to_create, to_update)
        if discard_drafts:
            stale = _rows(pod.query(
                "SELECT id FROM draft WHERE state = 'proposed' AND conversation_id IN "
                f"({', '.join(_sql(t) for t in discard_drafts)})"
            ))
            if stale:
                pod.records.bulk_update("draft", [{"id": r["id"], "state": "discarded"} for r in stale])

        conversations = _known(pod, mailbox_id, list(by_thread))
        rows = []
        for message in messages:
            if message["id"] in known_messages:
                continue
            known_messages.add(message["id"])
            rows.append({
                "id": _key_id("message", mailbox_id, message["id"]),
                "conversation_id": _key_id("thread", mailbox_id, message["thread"]),
                "source": "mail",
                "source_id": message["id"],
                "direction": "outbound" if message["outbound"] else "inbound",
                "from_handle": message["from_email"],
                "from_name": message["from_name"],
                "to_handles": message["to"],
                "cc_handles": message["cc"],
                "subject": message["subject"],
                "sent_at": _iso(message["sent_at"]) if message["sent_at"] else None,
                "snippet": (message["snippet"] or "")[:1000] or None,
                "has_attachments": message["has_attachments"],
            })
        for start in range(0, len(rows), 100):
            pod.records.bulk_create("message", rows[start : start + 100], upsert=True)
        self.processed += len(rows)
        if rows:
            self._recount(conversations)
        return conversations

    def _recount(self, conversations: dict[str, dict]) -> None:
        by_id = {c["id"]: c for c in conversations.values()}
        keys = list(by_id)
        updates = []
        for start in range(0, len(keys), 40):
            chunk = keys[start : start + 40]
            counted = _rows(self.pod.query(
                "SELECT conversation_id, COUNT(*) AS n FROM message "
                f"WHERE conversation_id IN ({', '.join(_sql(k) for k in chunk)}) GROUP BY conversation_id"
            ))
            for row in counted:
                conversation = by_id.get(row["conversation_id"])
                if conversation and int(conversation.get("message_count") or 0) != int(row["n"] or 0):
                    updates.append({"id": conversation["id"], "message_count": int(row["n"] or 0)})
        if updates:
            self.pod.records.bulk_update("conversation", updates)

    def root(self) -> str:
        # The sample's documents live in the bundle's own folder, which the
        # sample's clear may delete in; a function can never delete in /me.
        return SAMPLE_ROOT if self.sample else DOCUMENTS_ROOT

    def ensure_folder(self) -> None:
        if self.folder_ready:
            return
        for path in ((SAMPLE_ROOT,) if self.sample else ("/me/mail", DOCUMENTS_ROOT)):
            try:
                self.pod.files.create_folder(path)
            except Exception:  # noqa: BLE001 — already there is the usual case
                pass
        self.folder_ready = True

    def document(self, conversation: dict, messages: list[dict]) -> str | None:
        """The conversation as one markdown file: what anyone retrieves ("what
        did we agree"), real context for search, and far fewer writes than one
        file per message."""
        lines = [f"# {conversation.get('subject') or messages[-1]['subject'] or '(no subject)'}", ""]
        for message in messages:
            who = message["from_name"] or message["from_email"] or "(unknown)"
            address = f" <{message['from_email']}>" if message["from_email"] and message["from_name"] else ""
            stamp = message["sent_at"].strftime("%Y-%m-%d %H:%M UTC") if message["sent_at"] else ""
            lines.append(f"## {'You' if message['outbound'] else who}{address} — {stamp}")
            if message["to"]:
                lines.append(f"*To: {', '.join(message['to'])}*")
            lines.append("")
            body = _strip_quoted(message["text"] or "") or message["snippet"] or "*(no text body)*"
            lines.append(body[:12000])
            lines.append("")
        path = f"{self.root()}/{conversation['id']}.md"
        self.pod.files.write_text(path, "\n".join(lines))
        return path


# --------------------------------------------------------------------------
# the state machine


def _state_row(pod: Any, mailbox: dict, kind: str, window_days: int) -> dict:
    rows = _rows(pod.query(
        f"SELECT * FROM mail_sync_state WHERE mailbox_id = {_sql(mailbox['id'])} AND kind = {_sql(kind)} LIMIT 1"
    ))
    if rows:
        return rows[0]
    now = _now()
    return pod.table("mail_sync_state").create({
        "mailbox_id": mailbox["id"],
        "kind": kind,
        "phase": "recent",
        "state": "idle",
        # The incremental watermark starts just before the first read began,
        # so nothing that arrives during set-up falls between the two.
        "cursor": json.dumps({"since": int((now - timedelta(days=window_days if kind == "backfill" else 1)).timestamp())}),
        "cutoff_at": _iso(now - timedelta(days=window_days)),
        "progress_done": 0,
    })


def _fill(provider: Provider, writer: Writer, deadline: float) -> bool:
    """Fetch whole conversations whose document is missing or stale, newest
    first, and write their documents. True once none are left.

    Four at a time: done one by one this ran ~15 a minute, which turns a first
    read into half an hour. The datastore writes stay one batched ingest.
    """
    pod = writer.pod
    writer.ensure_folder()
    with ThreadPoolExecutor(max_workers=FILL_WORKERS) as pool:
        # Leave room for one batch to finish inside the function's deadline.
        while time.monotonic() < deadline - 12:
            pending = _rows(pod.query(
                "SELECT c.id, c.source_id, c.subject FROM conversation c "
                "JOIN mail_thread t ON t.id = c.id "
                f"WHERE c.source = 'mail' AND c.source_account = {_sql(writer.mailbox['id'])} AND c.kind = 'people' "
                f"AND t.document_filled IS NOT TRUE ORDER BY c.last_message_at DESC LIMIT {FILL_BATCH}"
            ))
            if not pending:
                return True
            fetched: dict[str, list[dict]] = {}
            failed: dict[str, str] = {}
            jobs = {pool.submit(provider.conversation, c["source_id"]): c for c in pending}
            for job in as_completed(jobs):
                conversation = jobs[job]
                try:
                    fetched[conversation["id"]] = sorted(job.result(), key=lambda m: m["sent_at"] or _now())
                except Exception as exc:  # noqa: BLE001 — skip it, keep the read going
                    failed[conversation["id"]] = f"Could not fetch: {exc}"[:300]

            writer.ingest([m for messages in fetched.values() for m in messages], kind="people")

            marks: dict[str, dict] = {}
            uploads = {}
            for conversation in pending:
                mark: dict[str, Any] = {"id": conversation["id"], "document_filled": True}
                marks[conversation["id"]] = mark
                if conversation["id"] in failed:
                    mark["reason"] = failed[conversation["id"]]
                    continue
                messages = fetched.get(conversation["id"]) or []
                if not messages:
                    continue
                others = {a for m in messages for a in ([m["from_email"]] + m["to"] + m["cc"]) if a and a != provider.me}
                if not others:
                    # A note to self: no other human, nothing to sort, nothing
                    # that teaches the writer how the owner talks to people.
                    mark.update({"kind": "broadcast", "state": "done", "sorted_by": "sync", "reason": "Note to self"})
                    continue
                uploads[pool.submit(writer.document, conversation, messages)] = conversation["id"]
            for job in as_completed(uploads):
                try:
                    marks[uploads[job]]["document_path"] = job.result()
                except Exception as exc:  # noqa: BLE001 — a failed upload is retried next pass
                    marks[uploads[job]].update({"document_filled": False, "reason": f"Document failed: {exc}"[:300]})
            # Marked filled even when the fetch failed: one that cannot be
            # fetched must not be retried forever, or the read never finishes.
            _write(pod, [], list(marks.values()))
    return False


def _run(pod: Any, mailbox: dict, kind: str, writer: Writer, deadline: float) -> dict:
    provider = _provider(pod, mailbox)
    row = _state_row(pod, mailbox, kind, writer.window_days)
    now = _now()
    lease = _parse_dt(row.get("lease_until"))
    if row.get("state") == "running" and lease and lease > now:
        return {"mailbox_id": mailbox["id"], "kind": kind, "phase": row.get("phase"), "busy": True, "done": False}
    if kind == "backfill" and row.get("state") == "done":
        return {"mailbox_id": mailbox["id"], "kind": kind, "phase": "done", "done": True,
                "progress_done": row.get("progress_done"), "progress_total": row.get("progress_total")}

    states = pod.table("mail_sync_state")
    states.update(row["id"], {"state": "running", "lease_until": _iso(now + timedelta(seconds=LEASE_SECONDS))})
    try:
        cursor = json.loads(row.get("cursor") or "{}")
    except ValueError:
        cursor = {}
    phase = row.get("phase") or "recent"
    if kind == "incremental" and phase == "done":
        phase = "recent"
    cutoff = _parse_dt(row.get("cutoff_at")) or (now - timedelta(days=writer.window_days))
    estimate = row.get("progress_total")
    before = writer.processed

    try:
        while time.monotonic() < deadline and phase != "done":
            if phase == "recent":
                since = datetime.fromtimestamp(int(cursor.get("since") or now.timestamp()), timezone.utc)
                cursor.setdefault("started", int(now.timestamp()))
                messages, exhausted = provider.recent(since, cursor)
                writer.ingest(messages)
                if exhausted:
                    if kind == "incremental":
                        # The watermark is when this catch-up STARTED: anything
                        # that arrived while it ran is picked up next time.
                        cursor = {"since": cursor["started"] - 60}
                        phase = "corpus_fill"
                    else:
                        cursor = {}
                        phase = "corpus_sent"
            elif phase == "corpus_sent":
                messages, exhausted, estimate = provider.sent(cutoff, cursor)
                writer.ingest(messages, kind="people")
                if exhausted:
                    cursor = {}
                    phase = "corpus_fill"
            elif phase == "corpus_fill":
                if not _fill(provider, writer, deadline):
                    break
                # The inbox pass finds conversations never answered; they need
                # documents too, so a backfill fills once more after it.
                phase = "index_only" if kind == "backfill" and not cursor.get("indexed") else "done"
            elif phase == "index_only":
                messages, exhausted = provider.inbox(cutoff, cursor)
                writer.ingest(messages)
                if exhausted:
                    cursor = {"indexed": True}
                    phase = "corpus_fill"
        finished = phase == "done"
        update = {
            "phase": phase,
            "cursor": json.dumps(cursor),
            "state": "done" if (finished and kind == "backfill") else "idle",
            "lease_until": None,
            "progress_done": int(row.get("progress_done") or 0) + (writer.processed - before),
            "progress_total": estimate,
            "last_run_at": _iso(_now()),
            "last_error": None,
        }
        states.update(row["id"], update)
        return {"mailbox_id": mailbox["id"], "email": mailbox.get("email"), "kind": kind,
                "phase": phase, "done": finished, "progress_done": update["progress_done"],
                "progress_total": estimate}
    except Exception as exc:
        states.update(row["id"], {
            "state": "error", "phase": phase, "cursor": json.dumps(cursor), "lease_until": None,
            "last_error": str(exc)[:2000], "last_run_at": _iso(_now()),
        })
        raise


def mail_sync(ctx: FunctionContext, data: MailSyncInput) -> MailSyncResult:
    pod = ctx.pod
    started = time.monotonic()
    deadline = started + max(10, min(data.budget_seconds, 100))

    if data.mailbox_id:
        mailboxes = [pod.table("mail_mailbox").get(data.mailbox_id)]
    else:
        where = "state IN ('backfilling', 'live')"
        if data.provider:
            where += f" AND provider = {_sql(data.provider)}"
        mailboxes = _rows(pod.query(f"SELECT * FROM mail_mailbox WHERE {where} ORDER BY created_at"))

    settings = (_rows(pod.query("SELECT follow_up_days, backfill_days FROM mail_settings LIMIT 1")) or [{}])[0]
    follow_up_days = int(settings.get("follow_up_days") or 3)
    window_days = max(1, min(int(settings.get("backfill_days") or WINDOW_DAYS), 186))

    results: list[dict] = []
    new_conversations = 0
    all_done = True
    for index, mailbox in enumerate(mailboxes):
        # Share the time fairly; the last mailbox gets whatever is left.
        remaining = deadline - time.monotonic()
        share = remaining / (len(mailboxes) - index)
        mailbox_deadline = time.monotonic() + share
        writer = Writer(pod, mailbox, follow_up_days, window_days)
        kinds = {"backfill": ["backfill"], "incremental": ["incremental"]}.get(data.mode, ["incremental", "backfill"])
        try:
            for kind in kinds:
                if kind == "backfill" and data.mode == "auto" and mailbox.get("state") == "live":
                    continue
                if kind == "incremental" and data.mode == "auto":
                    # Live mail first and briefly, so a long first read never
                    # delays a reply that just arrived.
                    outcome = _run(pod, mailbox, kind, writer, min(mailbox_deadline, time.monotonic() + share * 0.5))
                else:
                    outcome = _run(pod, mailbox, kind, writer, mailbox_deadline)
                outcome["new_conversations"] = writer.new_conversations
                results.append(outcome)
                if kind == "backfill":
                    all_done = all_done and outcome.get("done", False)
                    if outcome.get("done") and mailbox.get("state") == "backfilling":
                        pod.table("mail_mailbox").update(mailbox["id"], {"state": "live", "last_synced_at": _iso(_now())})
                        pod.table("mail_activity").create({
                            "kind": "sync",
                            "text": f"Finished reading {mailbox.get('email')}",
                            "ref_id": mailbox["id"],
                            "count": outcome.get("progress_done"),
                        })
            pod.table("mail_mailbox").update(mailbox["id"], {"last_synced_at": _iso(_now()), "last_error": None})
        except Exception as exc:  # noqa: BLE001 — one broken mailbox must not stop the others
            pod.table("mail_mailbox").update(mailbox["id"], {"last_error": str(exc)[:2000]})
            results.append({"mailbox_id": mailbox["id"], "email": mailbox.get("email"), "error": str(exc)[:500]})
            all_done = False
        new_conversations += writer.new_conversations

    return MailSyncResult(
        mailboxes=results,
        new_conversations=new_conversations,
        done=all_done,
        message=f"{len(mailboxes)} mailbox(es), {new_conversations} conversation(s) to sort, "
        f"{time.monotonic() - started:.0f}s",
    )
