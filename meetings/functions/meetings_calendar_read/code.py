#input_type_name: MeetingsCalendarReadInput
#output_type_name: MeetingsCalendarReadResult
#function_name: meetings_calendar_read

"""The person's meetings from every calendar they connected: the last month
and the next two weeks, as shared `meeting` rows with a `meetings_work` row
beside each.

A calendar entry is a meeting when someone besides the owner is on it and the
owner has not declined; all-day entries and focus blocks are not. Whether
anyone on it is from outside is read from email domains (the owner's own,
their calendar's, and any their settings name), never by a model. A meeting
with only the owner's own people is internal at once; one with outside people
is left for the sort (`meetings_sort`), which asks what kind it is.

Google and Outlook land in the same shape; the sample calendar is a fixture in
Google's event shape and goes through the same Google reader. Re-reading
changes only what changed. A meeting that moved, or whose people changed,
goes back to be sorted unless the person settled it. One gone from the
calendar inside the window is marked cancelled, never deleted.
"""

from __future__ import annotations

import html
import json
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NS = uuid.UUID("0b7e5f3a-2c19-4d8e-a6f1-93c4d2e8b507")
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com",
            "me.com", "proton.me", "protonmail.com", "aol.com"}
NOT_PEOPLE = ("resource.calendar.google.com", "group.calendar.google.com", "group.v.calendar.google.com")
SAMPLE_ROOT = "/meetings-sample"
# People are made exactly as Mail's mail_people makes them: the same id from
# the same handle (Mail's namespace), so a person met in a meeting and written
# to in mail is one row whichever plugin saw them first.
PERSON_NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")
AUTOMATED = ("noreply", "no-reply", "donotreply", "do-not-reply", "notifications", "notification",
             "mailer-daemon", "bounce", "alerts", "newsletter", "digest", "billing@", "invoice",
             "receipts", "calendar-notification")
JOINING = re.compile(
    r"(meet\.google\.com|zoom\.us|teams\.microsoft|teams\.live|webex|join with google meet|join by phone|"
    r"dial[- ]?in|meeting id|passcode|\bpin\b|-::~|────|microsoft teams meeting|click here to join|"
    r"learn more about meet|more phone numbers|invitation from google calendar|forwarding this invitation)",
    re.I,
)


class MeetingsCalendarReadInput(BaseModel):
    calendar_id: str | None = None
    past_days: int = 30
    ahead_days: int = 14


class MeetingsCalendarReadResult(BaseModel):
    calendars: int
    meetings: int
    outside: int
    ahead: int
    behind: int
    new: int
    changed: int
    cancelled: int
    to_sort: int
    errors: list[str]
    message: str
    # People on these meetings now in `person` / `person_handle`.
    people_added: int = 0
    people_known: int = 0


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _result(response: Any) -> dict:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    result = (payload or {}).get("result", payload) or {}
    if isinstance(result, dict) and isinstance(result.get("data"), dict) and not (
        "items" in result or "value" in result
    ):
        return result["data"]
    return result if isinstance(result, dict) else {}


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any, zone_name: str | None = None) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    if "." in text:
        head, _, tail = text.partition(".")
        digits = "".join(ch for ch in tail if ch.isdigit())
        text = f"{head}.{digits[:6]}{tail[len(digits):]}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        try:
            parsed = parsed.replace(tzinfo=ZoneInfo(zone_name or "UTC"))
        except Exception:  # noqa: BLE001 — Windows zone names and the like
            parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _agenda(text: str | None) -> str:
    """The invitation's own words: no markup, no joining instructions."""
    if not text:
        return ""
    plain = re.sub(r"<br\s*/?>|</p>|</div>|</li>", "\n", text, flags=re.I)
    plain = html.unescape(re.sub(r"<[^>]+>", "", plain))
    keep = []
    for line in plain.splitlines():
        line = line.strip()
        bare_link = line.startswith("http") and " " not in line
        if not line or bare_link or JOINING.search(line) or re.fullmatch(r"[\W_]+", line):
            continue
        keep.append(line)
    return "\n".join(keep)[:4000]


NAMES = {"google": "Google Calendar", "outlook": "Outlook"}


def _why(cal: dict, exc: Exception) -> str:
    """What stopped a calendar's read, said so the person can act on it.

    A calendar connected after Meetings was added to the Lemma, in an
    organization that had no such connector then, is the usual one: the
    import left the optional connector out and dropped this function's grant
    on it, and connecting declares the connector but grants nothing, so the
    read is refused `connector.use` (or finds no connector).
    """
    text = str(exc)
    name = NAMES.get(str(cal.get("provider") or ""), "This calendar")
    if "connector.use" in text or "POD_CONNECTOR_NOT_FOUND" in text:
        return (f"Meetings isn't allowed to read {name} in this Lemma yet, probably because it was added before "
                f"{name} was set up here. Ask whoever runs this Lemma to add Meetings again, which gives it access.")
    if "REAUTH_REQUIRED" in text or "CONNECTION_REQUIRED" in text:
        return f"{name} needs connecting again: its sign-in has expired or was removed."
    return text


RESPONSE = {"accepted": "accepted", "declined": "declined", "tentative": "tentative", "needsAction": "needs_action",
            "tentativelyAccepted": "tentative", "none": "needs_action", "notResponded": "needs_action",
            "organizer": "accepted"}


def _google_events(pod: Any, cal: dict, start: datetime, end: datetime) -> list[dict]:
    if cal.get("provider") == "sample":
        fixture = json.loads(pod.files.download(f"{SAMPLE_ROOT}/{cal['id']}.json").decode("utf-8"))
        items = [e for e in fixture.get("events") or []
                 if start <= (_parse((e.get("start") or {}).get("dateTime")) or start) <= end]
    else:
        items, token = [], None
        for _ in range(6):
            payload = {"calendarId": "primary", "timeMin": start.isoformat(), "timeMax": end.isoformat(),
                       "singleEvents": True, "orderBy": "startTime", "maxResults": 250}
            if token:
                payload["pageToken"] = token
            result = _result(pod.connectors.execute("google_calendar", "GOOGLECALENDAR_EVENTS_LIST", payload,
                                                    account_id=cal.get("account_id")))
            items += [e for e in result.get("items") or [] if isinstance(e, dict)]
            token = result.get("nextPageToken")
            if not token:
                break
    out = []
    for e in items:
        s = (e.get("start") or {}).get("dateTime")
        if not s:
            continue  # all-day: not a meeting
        join = e.get("hangoutLink") or next(
            (p.get("uri") for p in ((e.get("conferenceData") or {}).get("entryPoints") or []) if p.get("entryPointType") == "video"), None)
        out.append({
            "source_id": e.get("id"), "series_id": e.get("recurringEventId"),
            "title": e.get("summary") or "(no title)",
            "start_at": _parse(s), "end_at": _parse((e.get("end") or {}).get("dateTime")),
            "attendees": [{"handle": (a.get("email") or "").lower(), "name": a.get("displayName"),
                           "response": RESPONSE.get(a.get("responseStatus") or "", "needs_action"),
                           "organizer": bool(a.get("organizer")), "you": bool(a.get("self")),
                           "resource": bool(a.get("resource"))}
                          for a in e.get("attendees") or []],
            "organizer_handle": ((e.get("organizer") or {}).get("email") or "").lower() or None,
            "agenda": _agenda(e.get("description")),
            "join_url": join, "location": e.get("location") or None,
            "status": "cancelled" if e.get("status") == "cancelled" else ("tentative" if e.get("status") == "tentative" else "confirmed"),
        })
    return out


def _outlook_events(pod: Any, cal: dict, start: datetime, end: datetime) -> list[dict]:
    out, token = [], None
    for _ in range(6):
        payload = {"user_id": "me", "start_datetime": start.isoformat(), "end_datetime": end.isoformat(), "top": 250}
        if token:
            payload["page_token"] = token
        result = _result(pod.connectors.execute("outlook", "OUTLOOK_GET_CALENDAR_VIEW", payload,
                                                account_id=cal.get("account_id")))
        for e in result.get("value") or []:
            if e.get("isAllDay"):
                continue
            s = _parse((e.get("start") or {}).get("dateTime"), (e.get("start") or {}).get("timeZone"))
            if not s:
                continue
            location = (e.get("location") or {}).get("displayName")
            join = (e.get("onlineMeeting") or {}).get("joinUrl") or (location if (location or "").startswith("http") else None)
            organizer = (((e.get("organizer") or {}).get("emailAddress") or {}).get("address") or "").lower() or None
            mine = cal.get("email")
            attendees = [{"handle": ((a.get("emailAddress") or {}).get("address") or "").lower(),
                          "name": (a.get("emailAddress") or {}).get("name"),
                          "response": RESPONSE.get((a.get("status") or {}).get("response") or "", "needs_action"),
                          "organizer": False, "you": False, "resource": a.get("type") == "resource"}
                         for a in e.get("attendees") or []]
            # Outlook lists the organizer apart from the attendees.
            if organizer and not any(a["handle"] == organizer for a in attendees):
                attendees.insert(0, {"handle": organizer,
                                     "name": ((e.get("organizer") or {}).get("emailAddress") or {}).get("name"),
                                     "response": "accepted", "organizer": True, "you": False, "resource": False})
            for a in attendees:
                a["organizer"] = a["organizer"] or a["handle"] == organizer
                a["you"] = a["handle"] == mine
                if a["you"]:
                    own = (e.get("responseStatus") or {}).get("response")
                    a["response"] = "accepted" if e.get("isOrganizer") else RESPONSE.get(own or "", a["response"])
            out.append({
                "source_id": e.get("id"), "series_id": e.get("seriesMasterId"),
                "title": e.get("subject") or "(no title)",
                "start_at": s,
                "end_at": _parse((e.get("end") or {}).get("dateTime"), (e.get("end") or {}).get("timeZone")),
                "attendees": attendees, "organizer_handle": organizer,
                "agenda": _agenda((e.get("body") or {}).get("content") or e.get("bodyPreview")),
                "join_url": join, "location": location if location and not location.startswith("http") else None,
                "status": "cancelled" if e.get("isCancelled") else "confirmed",
            })
        token = result.get("next_page_token") or result.get("@odata.nextLink")
        if not token:
            break
    return out


def meetings_calendar_read(ctx: FunctionContext, data: MeetingsCalendarReadInput) -> MeetingsCalendarReadResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    settings = (_rows(pod.query("SELECT my_domains, kinds_on, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    kinds_on = set(settings.get("kinds_on") or [])
    where = f"WHERE id = {_sql(data.calendar_id)}" if data.calendar_id else "WHERE state <> 'stopped'"
    calendars = _rows(pod.query(f"SELECT id, provider, account_id, email, own_domains FROM meetings_calendar {where}"))
    if not calendars:
        return MeetingsCalendarReadResult(calendars=0, meetings=0, outside=0, ahead=0, behind=0, new=0, changed=0,
                                          cancelled=0, to_sort=0, errors=[], message="No calendar connected yet.")
    start = now - timedelta(days=max(1, min(data.past_days, 60)))
    end = now + timedelta(days=max(1, min(data.ahead_days, 31)))
    me = (ctx.user_email or "").lower()

    fetched: dict[str, list[dict]] = {}
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = {pool.submit(_outlook_events if c["provider"] == "outlook" else _google_events, pod, c, start, end): c
                for c in calendars}
        for job, cal in jobs.items():
            try:
                fetched[cal["id"]] = job.result()
            except Exception as exc:  # noqa: BLE001 — one calendar failing must not hide the others
                why = _why(cal, exc)
                errors.append(f"{cal.get('email')}: {why}"[:400])
                pod.table("meetings_calendar").update(cal["id"], {"last_error": why[:600]})

    totals = {"meetings": 0, "outside": 0, "ahead": 0, "behind": 0, "new": 0, "changed": 0, "cancelled": 0, "to_sort": 0}
    met: dict[str, str | None] = {}  # handle -> name, everyone but the owner
    for cal in calendars:
        if cal["id"] not in fetched:
            continue
        mine = {me, (cal.get("email") or "").lower()} - {""}
        own = {d.lower() for d in (settings.get("my_domains") or [])} | {d.lower() for d in (cal.get("own_domains") or [])}
        for address in mine:
            domain = address.rsplit("@", 1)[-1]
            if domain not in FREEMAIL:
                own.add(domain)

        existing = {r["source_id"]: r for r in _rows(pod.query(
            "SELECT m.id, m.source_id, m.series_id, m.title, m.start_at, m.end_at, m.attendees, m.organizer_handle, "
            "m.status, m.agenda, m.join_url, m.location, m.outside, m.kind, w.sorted_by FROM meeting m LEFT JOIN meetings_work w ON w.id = m.id "
            f"WHERE m.source = 'calendar' AND m.source_account = {_sql(cal['id'])} "
            f"AND m.start_at >= {_sql(start.isoformat())} LIMIT 5000"))}
        create, work, update = [], [], []
        seen: set[str] = set()
        for e in fetched[cal["id"]]:
            if not e.get("source_id") or not e.get("start_at"):
                continue
            people = []
            for a in e["attendees"]:
                if not a["handle"] or a.get("resource") or a["handle"].endswith(NOT_PEOPLE):
                    continue
                you = a["you"] or a["handle"] in mine
                people.append({"handle": a["handle"], "name": a.get("name") or None, "response": a["response"],
                               "organizer": a["organizer"], "you": you,
                               "outside": (not you) and a["handle"].rsplit("@", 1)[-1] not in own})
            others = [p for p in people if not p["you"]]
            owner_row = next((p for p in people if p["you"]), None)
            if not others or (owner_row and owner_row["response"] == "declined"):
                continue  # a focus block, or a meeting the owner is not going to
            seen.add(e["source_id"])
            for p in others:
                if not met.get(p["handle"]):
                    met[p["handle"]] = p.get("name")
            outside = any(p["outside"] for p in others)
            row = {
                "source": "calendar", "source_account": cal["id"], "source_id": e["source_id"][:400],
                "series_id": (e.get("series_id") or None) and e["series_id"][:400],
                "title": e["title"][:500], "start_at": e["start_at"].isoformat(),
                "end_at": e["end_at"].isoformat() if e.get("end_at") else None,
                "attendees": people[:60], "organizer_handle": e.get("organizer_handle"),
                "agenda": e.get("agenda") or None, "join_url": (e.get("join_url") or "")[:800] or None,
                "location": (e.get("location") or "")[:400] or None, "status": e["status"], "outside": outside,
            }
            totals["meetings"] += 1
            totals["outside"] += int(outside)
            totals["ahead" if e["start_at"] > now else "behind"] += 1
            found = existing.get(e["source_id"])
            if found is None:
                mid = str(uuid.uuid5(NS, f"{cal['id']}:{e['source_id']}"))
                row.update({"id": mid, "kind": None if outside else "internal",
                            "wants_brief": None if outside else ("internal" in kinds_on)})
                create.append(row)
                work.append({"id": mid, "sorted_by": None if outside else "domains",
                             "sorted_at": None if outside else now.isoformat(), "unsure": False,
                             "answers": None if outside else {"kind": {"value": "internal", "confidence": None},
                                                              "needs_brief": {"value": True, "confidence": None}},
                             "reason": None if outside else "Only your own people are on it.",
                             "brief_state": "none", "notes_state": "none"})
                totals["new"] += 1
                totals["to_sort"] += int(outside)
                continue
            changed = {k: v for k, v in row.items()
                       if k not in ("source", "source_account", "source_id") and _differs(found.get(k), v)}
            if not changed:
                continue
            people_changed = "attendees" in changed and _handles(found.get("attendees")) != _handles(row["attendees"])
            if found.get("sorted_by") != "person" and ("outside" in changed or people_changed or "title" in changed):
                # Who it is with, or what it is, changed: read it again.
                changed.update({"kind": None if outside else "internal",
                                "wants_brief": None if outside else ("internal" in kinds_on)})
                totals["to_sort"] += int(outside)
                pod.table("meetings_work").update(found["id"], {
                    "sorted_by": None if outside else "domains", "sorted_at": None if outside else now.isoformat(),
                    "unsure": False, "reason": None if outside else "Only your own people are on it."})
            changed["id"] = found["id"]
            update.append(changed)
            totals["changed"] += 1

        for i in range(0, len(create), 100):
            pod.records.bulk_create("meeting", create[i : i + 100])
        for i in range(0, len(work), 100):
            pod.records.bulk_create("meetings_work", work[i : i + 100])
        for row in update:
            pod.table("meeting").update(row.pop("id"), row)
        # Gone from the calendar inside the window, still ahead: cancelled.
        gone = [r["id"] for sid, r in existing.items()
                if sid not in seen and r.get("status") != "cancelled"
                and (_parse(r.get("start_at")) or now) > now]
        if gone:
            pod.records.bulk_update("meeting", [{"id": i, "status": "cancelled"} for i in gone])
            totals["cancelled"] += len(gone)
        pod.table("meetings_calendar").update(cal["id"], {"last_read_at": now.isoformat(), "state": "live",
                                                          "last_error": None})

    added, known = _people(ctx, met)
    parts = [f"Read {totals['meetings']} meetings", f"{totals['outside']} with people from outside"]
    if totals["to_sort"]:
        parts.append(f"{totals['to_sort']} to sort")
    if errors and not fetched:
        parts = ["Couldn't read your calendar" if len(calendars) == 1 else "Couldn't read your calendars"]
    return MeetingsCalendarReadResult(calendars=len(calendars), errors=errors, message=", ".join(parts),
                                      people_added=added, people_known=known, **totals)


def _org(email: str) -> str | None:
    """As Mail's: the domain's name, none for a personal address."""
    domain = email.rsplit("@", 1)[-1]
    if domain in FREEMAIL:
        return None
    label = domain.split(".")[-2] if domain.count(".") >= 1 else domain
    return " ".join(part.capitalize() for part in label.replace("_", "-").split("-"))


def _people(ctx: FunctionContext, met: dict[str, str | None]) -> tuple[int, int]:
    """Everyone on the meetings, as shared people: found by handle in
    `person_handle` (kind "email"), never by a column on the person.

    Mail's rules: the owner's own addresses are never a person (the read
    already left them out), nor automated senders; colleagues are. A handle
    already there keeps its person, whoever made it, and only an empty name or
    org is filled in; counts are Mail's and are never touched. A new handle
    gets a new person with Mail's id for it, unless that person row already
    exists, which then only gains the handle.

    A meeting reaches its people through its attendees' handles:
    meeting.attendees[].handle = person_handle.handle (kind 'email') ->
    person_handle.person_id.
    """
    pod = ctx.pod
    wanted = {h: n for h, n in met.items()
              if h and "@" in h and not any(t in h for t in AUTOMATED) and len(h) <= 320}
    if not wanted:
        return 0, 0
    handles = sorted(wanted)
    found: dict[str, dict] = {}
    for i in range(0, len(handles), 200):
        for r in _rows(pod.query(
                "SELECT h.handle, h.person_id, p.name, p.org FROM person_handle h JOIN person p ON p.id = h.person_id "
                f"WHERE h.kind = 'email' AND h.handle IN ({_in(handles[i : i + 200])})")):
            found.setdefault(r["handle"], r)
    missing = [h for h in handles if h not in found]
    ids = {h: str(uuid.uuid5(PERSON_NS, f"{ctx.user_id}:email:{h}")) for h in missing}
    existing_people = {}
    id_list = sorted(set(ids.values()))
    for i in range(0, len(id_list), 200):
        for r in _rows(pod.query(f"SELECT id, name, org FROM person WHERE id IN ({_in(id_list[i : i + 200])})")):
            existing_people[r["id"]] = r
    new_people, new_handles, fills = [], [], {}
    for h in missing:
        pid = ids[h]
        name = (wanted[h] or "")[:200] or None
        if pid in existing_people:
            row = existing_people[pid]
            patch = {}
            if not row.get("name") and name:
                patch["name"] = name
            if not row.get("org") and _org(h):
                patch["org"] = _org(h)
            if patch:
                fills[pid] = {**fills.get(pid, {}), **patch}
        else:
            new_people.append({"id": pid, "name": name, "org": _org(h), "title": None, "is_vip": False})
            existing_people[pid] = new_people[-1]
        new_handles.append({"id": str(uuid.uuid5(PERSON_NS, f"{pid}:email:{h}")), "person_id": pid, "kind": "email",
                            "handle": h, "display_name": name})
    for h, r in found.items():
        patch = {}
        if not r.get("name") and wanted.get(h):
            patch["name"] = wanted[h][:200]
        if not r.get("org") and _org(h):
            patch["org"] = _org(h)
        if patch:
            fills[r["person_id"]] = {**fills.get(r["person_id"], {}), **patch}
    for i in range(0, len(new_people), 100):
        pod.records.bulk_create("person", new_people[i : i + 100])
    for i in range(0, len(new_handles), 100):
        pod.records.bulk_create("person_handle", new_handles[i : i + 100], upsert=True)
    for pid, patch in fills.items():
        pod.table("person").update(pid, patch)
    return len(new_people), len(found)


def _handles(attendees: Any) -> set[str]:
    return {a.get("handle") for a in (attendees or []) if isinstance(a, dict)}


def _differs(old: Any, new: Any) -> bool:
    if isinstance(new, str) and isinstance(old, str) and ("T" in new and ":" in new):
        a, b = _parse(old), _parse(new)
        if a and b:
            return a != b
    if isinstance(new, (list, dict)) or isinstance(old, (list, dict)):
        return json.dumps(old, sort_keys=True, default=str) != json.dumps(new, sort_keys=True, default=str)
    return (old or None) != (new or None)
