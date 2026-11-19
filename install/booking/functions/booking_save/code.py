#input_type_name: BookingSaveInput
#output_type_name: BookingSaveResult
#function_name: booking_save

"""Keep the person's booking settings and their page: from the set-up's
forms, and from the settings screen (only what it sends changes).

The page's address is checked here: lowercase letters, digits and dashes, two
to forty long, not a word the app uses for itself, and nobody else's. In the
set-up a taken address gets the next free one (and says so); from settings it
is refused with the reason, and nothing is changed.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

HANDLE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")
CLOCK = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
RESERVED = {"setup", "settings", "upcoming", "about", "api", "app", "admin", "help", "new", "b", "s", "page", "pages"}
VIDEO = {"google_meet", "teams", "none"}
MAIL = {"gmail", "outlook", "none"}


# What tells the Lemma's agents Booking page is here (_contract/README.md,
# "Memory block"): its block in /memory/AGENTS.md and its guide, written at
# the end of each person's set-up. Equal to .lemma/agents-block.md and
# .lemma/guide.md (the lint checks; --fix copies them in).
AGENTS_BLOCK = """\
Booking page: each member's own link for booking their time is page_url in their booking_settings row. Sharing it, hours: /memory/plugins/booking.md
"""
AGENTS_GUIDE = """\
# Booking page

Each member who turns it on has a public page where people outside book their time. Open times come from the calendars they connected in Meetings, read live; a booking becomes one of their Meetings meetings, with Meetings' brief on who's coming.

## Sharing a link
- A member's own link is `page_url` in their `booking_settings` row (one row each; you see the asking member's). Give it as it is: it ends in `?k=` and a code the page needs, and the page drops it from the address once opened.
- Someone else's page: `booking_page` has every page (`handle`, `name`, `state`), but not its link. Ask them to copy theirs in the Booking app.
- `booking_page.state` `off`: the page says it isn't taking bookings. Turning it on or off is done in the Booking app (it also pauses their schedules).
- Never book for a visitor, and never add a calendar event for one yourself: send the link. A person outside confirms their email with a code on the page.

## Changing hours from chat
Run `booking_save` as the person with only what changes, then `booking_slots` with `{"force": true}` so the page follows at once:
- `days` (Monday = 0), `day_starts`, `day_ends` (HH:MM, their time), `minutes` (call length), `buffer_minutes`, `notice_hours`, `days_ahead`, `max_per_day`;
- the page: `name`, `about` (one line), `more` (what calls are for; the chat beside the page answers from it), `chat` (true or false);
- `video`: `google_meet` (Google calendars), `teams` (Outlook, work or school accounts) or `none`.
It answers `ok: false` with the reason when something doesn't fit (an end before the start, a taken address). Say what changed and how many open times the page has now.

## Where bookings are
- `booking_request`: every request to a page, with `state` requested, confirmed or declined, `reason`, the visitor's `zone`, and `meeting_id`.
- A confirmed booking is a `meeting` row (source `calendar`, the event on their calendar) with `kind` from one Decisions read, and Meetings writes its brief at once (`meeting.headline`, `meeting.brief`). Open it in the Meetings app at `/<meeting id>`.
- A declined one says why in `reason`; `told` holds the email sent to the visitor from the member's own mailbox (or why none was).
- Upcoming bookings are also in the person's `needs_you` (verb `attend`), and one the read wasn't sure of (verb `decide`).
- Never share a visitor's email or what they wrote with anyone but the page's owner.

## The Booking app
`booking`: the member's bookings at `/`, one booking at `/b/<request id>`, settings at `/settings`. A person's page is `/<handle>`.
"""

# contract:agents-md
# The one way a plugin tells this Lemma's agents it is installed (see
# _contract/README.md, "Memory block"). Copied verbatim into the plugin's
# memory function between these markers; _contract/lint.py fails on any
# difference. Needs a folder grant on /memory (read, write), which resolves
# because the bundle carries the contract's files/memory/. /me/AGENTS.md needs
# no grant: it is the person's own, written when the function runs as them.
import re as _am_re

AGENTS_MD_POD = "/memory/AGENTS.md"
AGENTS_MD_ME = "/me/AGENTS.md"
AGENTS_MD_GUIDES = "/memory/plugins"
# A block's whole text, markers included. Every index reaches every run's
# brief cut to 2,000 characters, and to about 1,365 when all four of an
# agent's indexes are full; six plugins at 200 fit under that, at the top,
# and leave the team most of the usual room for its own notes.
AGENTS_MD_BLOCK_BUDGET = 200
AGENTS_MD_INDEX_ROOM = 2000
# A guide is read only when needed. The platform asks for a memory file past
# 8,000 characters to be condensed, and the team may add notes below the block.
AGENTS_MD_GUIDE_BUDGET = 4000


def _am_marks(slug: str):
    if not _am_re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug or ""):
        raise ValueError(f"not a plugin slug: {slug!r}")
    s = _am_re.escape(slug)
    return (f"<!-- plugin:{slug} -->", f"<!-- /plugin:{slug} -->",
            _am_re.compile(r"<!--\s*plugin:" + s + r"\s*-->"),
            _am_re.compile(r"<!--\s*/plugin:" + s + r"\s*-->"))


def agents_md_block(slug: str, body: str) -> str:
    """The block as written: markers on their own lines around the body."""
    if _am_re.search(r"<!--\s*/?plugin:", body or ""):
        raise ValueError("a block cannot hold plugin markers")
    opening, closing, _, _ = _am_marks(slug)
    return f"{opening}\n{(body or '').strip()}\n{closing}\n"


def agents_md_spans(text: str, slug: str) -> list:
    """(start, end) of each whole block of `slug`; the end takes the newline
    closing its last line. An opening marker with no closing one before the
    next opening one is not a block, and is left alone."""
    _, _, opening, closing = _am_marks(slug)
    starts = [m.start() for m in opening.finditer(text)]
    spans = []
    for i, start in enumerate(starts):
        found = closing.search(text, start, starts[i + 1] if i + 1 < len(starts) else len(text))
        if found:
            end = found.end() + (1 if text[found.end():found.end() + 1] == "\n" else 0)
            spans.append((start, end))
    return spans


def agents_md_put(text: str, slug: str, body) -> str:
    """`text` with `slug`'s block set to `body` (None removes it); nothing
    outside that plugin's markers changes. The first block is replaced in place
    and any copies of it removed. A new block goes after the last plugin block,
    else at the top, below a leading `# ` title: an index cut to fit the brief
    loses its last lines, and a block is short and changes only on set-up."""
    block = None if body is None else agents_md_block(slug, body)
    spans = agents_md_spans(text, slug)
    if spans:
        out, cursor = [], 0
        for i, (start, end) in enumerate(spans):
            out.append(text[cursor:start])
            if i == 0 and block is not None:
                out.append(block)
            cursor = end
        out.append(text[cursor:])
        return "".join(out)
    if block is None:
        return text
    ends = [m.end() for m in _am_re.finditer(r"<!--\s*/plugin:[a-z0-9-]+\s*-->[^\n]*\n?", text)]
    if ends:
        at = ends[-1]
    elif text.startswith("# "):
        at = text.find("\n") + 1 or len(text)
    else:
        at = 0
    before = text[:at]
    if before and not before.endswith("\n"):
        before += "\n"
    return before + block + text[at:]


def agents_md_write(pod, slug: str, block, guide=None, index: str = AGENTS_MD_POD) -> dict:
    """Write `slug`'s block into `index` and, given `guide`, the guide at
    /memory/plugins/<slug>.md, between the same markers, so notes the team adds
    to either outside them stay. None removes the block (an uninstall). Safe to
    run again: an unchanged file is not written. A file that cannot be read for
    any reason but being absent is never written over (that raises).

    Returns {"index": ..., "guide": ..., "warnings": [...]}."""
    warnings = []

    def read(path):
        try:
            data = pod.files.download(path)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "status_code", None)
            if code == 404 or (code is None and "not found" in str(exc).lower()):
                return None
            raise
        return data.decode("utf-8") if isinstance(data, (bytes, bytearray)) else str(data)

    def put(path, body):
        before = read(path)
        text = agents_md_put(before or "", slug, body)
        if text == (before or ""):
            return {"path": path, "changed": False, "chars": len(text)}
        if before is None and path.startswith(AGENTS_MD_GUIDES + "/"):
            try:
                pod.files.create_folder(AGENTS_MD_GUIDES)
            except Exception:  # noqa: BLE001 — there already, the usual case
                pass
        wanted = None if body is None else agents_md_block(slug, body)
        for _ in range(3):
            pod.files.write_text(path, text)
            after = read(path) or ""
            if (wanted in after) if wanted is not None else not agents_md_spans(after, slug):
                return {"path": path, "changed": True, "chars": len(after)}
            text = agents_md_put(after, slug, body)  # written over meanwhile: again, on theirs
        warnings.append(f"{path}: another write kept replacing it; the block may be missing")
        return {"path": path, "changed": True, "chars": len(text)}

    guide_path = f"{AGENTS_MD_GUIDES}/{slug}.md"
    if block is not None:
        size = len(agents_md_block(slug, block))
        if size > AGENTS_MD_BLOCK_BUDGET:
            warnings.append(f"the {slug} block is {size} characters, over the {AGENTS_MD_BLOCK_BUDGET} budget")
    if guide is not None and len(agents_md_block(slug, guide)) > AGENTS_MD_GUIDE_BUDGET:
        warnings.append(f"the {slug} guide is over the {AGENTS_MD_GUIDE_BUDGET}-character budget")
    result = {"index": put(index, block), "guide": None, "warnings": warnings}
    if guide is not None or (block is None and index == AGENTS_MD_POD):
        result["guide"] = put(guide_path, guide)
    if result["index"]["chars"] > AGENTS_MD_INDEX_ROOM:
        warnings.append(f"{index} is {result['index']['chars']} characters; agents see about "
                        f"{AGENTS_MD_INDEX_ROOM}, and lose its last lines")
    return result
# end contract


class BookingSaveInput(BaseModel):
    calendars: list[str] | None = None
    event_calendar: str | None = None
    days: list[int] | None = None
    day_starts: str | None = None
    day_ends: str | None = None
    minutes: int | None = None
    buffer_minutes: int | None = None
    notice_hours: int | None = None
    days_ahead: int | None = None
    max_per_day: int | None = None
    handle: str | None = None
    name: str | None = None
    about: str | None = None
    more: str | None = None
    video: str | None = None
    mail_connector: str | None = None
    mail_account_id: str | None = None
    mail_address: str | None = None
    chat: bool | None = None
    timezone: str | None = None
    # True from the set-up's last step: a taken address gets the next free one.
    setup: bool = False


class BookingSaveResult(BaseModel):
    ok: bool
    problem: str | None = None
    page_id: str | None = None
    handle: str | None = None
    changed: list[str] = []
    # What writing the memory block did (set-up only).
    memory: dict | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _id_of(response: Any) -> str:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return str((payload or {}).get("id") or ((payload or {}).get("data") or {}).get("id"))


def _refuse(problem: str) -> BookingSaveResult:
    return BookingSaveResult(ok=False, problem=problem, message=problem)


def booking_save(ctx: FunctionContext, data: BookingSaveInput) -> BookingSaveResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    mine = (_rows(pod.query("SELECT * FROM booking_settings LIMIT 1")) or [None])[0]
    if mine is None:
        mine = {"id": _id_of(pod.records.create("booking_settings", {"setup_step": "calendars"}))}
    page = None
    if mine.get("page_id"):
        page = (_rows(pod.query(f"SELECT * FROM booking_page WHERE id = {_sql(mine['page_id'])}")) or [None])[0]

    settings: dict[str, Any] = {}
    page_patch: dict[str, Any] = {}

    if data.calendars is not None:
        known = {r["id"] for r in _rows(pod.query("SELECT id FROM meetings_calendar"))}
        picked = [c for c in data.calendars if c in known]
        if not picked:
            return _refuse("Choose at least one of your calendars.")
        settings["calendars"] = picked
        if (data.event_calendar or mine.get("event_calendar")) not in picked:
            settings["event_calendar"] = data.event_calendar if data.event_calendar in picked else picked[0]
    if data.event_calendar is not None and "event_calendar" not in settings:
        if data.event_calendar not in (mine.get("calendars") or settings.get("calendars") or []):
            return _refuse("The event goes on one of the calendars the page checks.")
        settings["event_calendar"] = data.event_calendar
    if data.days is not None:
        days = sorted({int(d) for d in data.days if 0 <= int(d) <= 6})
        if not days:
            return _refuse("Choose at least one day.")
        settings["days"] = days
    for field in ("day_starts", "day_ends"):
        value = getattr(data, field)
        if value is not None:
            if not CLOCK.match(value):
                return _refuse("Times are HH:MM, like 09:30.")
            settings[field] = value
    starts = settings.get("day_starts") or mine.get("day_starts") or "09:30"
    ends = settings.get("day_ends") or mine.get("day_ends") or "17:30"
    if starts >= ends:
        return _refuse("The day has to end after it starts.")
    bounds = {"minutes": (10, 240), "buffer_minutes": (0, 120), "notice_hours": (0, 336),
              "days_ahead": (1, 90), "max_per_day": (1, 24)}
    for field, (low, high) in bounds.items():
        value = getattr(data, field)
        if value is not None:
            if not low <= int(value) <= high:
                return _refuse(f"{field.replace('_', ' ').capitalize()} should be between {low} and {high}.")
            settings[field] = int(value)
    if data.video is not None:
        if data.video not in VIDEO:
            return _refuse("Video is Google Meet, Teams or none.")
        settings["video"] = data.video
        page_patch["video"] = data.video
    if data.mail_connector is not None:
        if data.mail_connector not in MAIL:
            return _refuse("Declines are emailed from Gmail, Outlook, or not at all.")
        settings["mail_connector"] = data.mail_connector
        sends = data.mail_connector != "none"
        settings["mail_account_id"] = data.mail_account_id if sends else None
        settings["mail_address"] = ((data.mail_address or "").lower() or None) if sends else None
    if data.timezone:
        try:
            ZoneInfo(data.timezone)
        except Exception:  # noqa: BLE001
            return _refuse(f"{data.timezone} is not a time zone this knows.")
        settings["timezone"] = data.timezone
        page_patch["timezone"] = data.timezone
    for field in ("minutes", "notice_hours"):
        if field in settings:
            page_patch[field] = settings[field]

    note = ""
    if data.handle is not None:
        handle = data.handle.strip().lower()
        if not HANDLE.match(handle) or len(handle) < 2:
            return _refuse("The address is two to forty lowercase letters, digits or dashes.")
        if handle in RESERVED:
            return _refuse(f"“{handle}” is a word the page uses for itself. Try another.")
        others = {r["handle"] for r in _rows(pod.query(
            f"SELECT handle FROM booking_page WHERE handle LIKE {_sql(handle + '%')} "
            f"AND id <> {_sql((page or {}).get('id') or '00000000-0000-0000-0000-000000000000')} LIMIT 500"))}
        if handle in others:
            if not data.setup:
                return _refuse(f"Someone in this Lemma already has /{handle}. Try another.")
            base, n = handle, 2
            while handle in others:
                handle, n = f"{base}-{n}", n + 1
            note = f" /{base} was taken, so the page is /{handle}."
        page_patch["handle"] = handle
    if data.name is not None:
        if not data.name.strip():
            return _refuse("The page needs a name.")
        page_patch["name"] = data.name.strip()[:120]
        settings["display_name"] = data.name.strip()[:200]
    if data.about is not None:
        page_patch["about"] = data.about.strip()[:200] or None
    if data.more is not None:
        page_patch["more"] = data.more.strip()[:1500] or None
    if data.chat is not None:
        page_patch["chat"] = bool(data.chat)

    if page is None:
        if "handle" not in page_patch or "name" not in page_patch:
            if not data.setup:
                return _refuse("The page needs its address and a name first.")
        if "handle" in page_patch and "name" in page_patch:
            row = {"state": "off", "minutes": settings.get("minutes") or mine.get("minutes") or 30,
                   "notice_hours": settings.get("notice_hours") or mine.get("notice_hours") or 12,
                   "video": settings.get("video") or mine.get("video") or "none",
                   "timezone": settings.get("timezone") or mine.get("timezone") or "UTC", "chat": True, **page_patch}
            page = {"id": _id_of(pod.records.create("booking_page", row)), **row}
            settings["page_id"] = page["id"]
    elif page_patch:
        pod.table("booking_page").update(page["id"], page_patch)

    memory = None
    if data.setup:
        settings["setup_step"] = "done"
        settings["setup_done_at"] = now.isoformat()
        # The Lemma's agents learn the page is here; safe to write again.
        try:
            memory = agents_md_write(pod, "booking", AGENTS_BLOCK, AGENTS_GUIDE)
        except Exception as exc:  # noqa: BLE001 — the page works without it; said back
            memory = {"error": str(exc)[:300]}
    if settings:
        pod.table("booking_settings").update(mine["id"], settings)
    changed = sorted(set(settings) | set(page_patch))
    handle = page_patch.get("handle") or (page or {}).get("handle")
    return BookingSaveResult(ok=True, page_id=(page or {}).get("id"), handle=handle, changed=changed, memory=memory,
                             message=("Saved." if changed else "Nothing to change.") + note)
