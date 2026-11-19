#input_type_name: MeetingsSampleDataInput
#output_type_name: MeetingsSampleDataResult
#function_name: meetings_sample_data

"""A made-up calendar, so Meetings can be seen working, and tested, without
anyone's real calendar.

`load` adds a calendar whose provider is `sample` and writes its meetings
(a small company founder's month behind and two weeks ahead: investors,
customers, candidates, partners, a lunch, the weekly team sync) as a fixture
beside it, in Google Calendar's own event shape, plus one meeting's transcript.
Nothing is read yet: the first read (`meetings_calendar_read`) reads the
fixture exactly as it reads Google, and the sort and the writers then run on
it as on a real calendar. The people are the ones in Mail's sample mailbox, so
the two line up in one Lemma; every address is at a reserved `.example`
domain, and the owner's own team is at yourcompany.example.

`clear` removes every row the sample made and its files: its meetings, their
working rows, corrections, decisions, the promises read from its transcript,
and the people its meetings brought in. A person stays when anything else
knows them: another handle, mail (a conversation, a message, a promise from
mail, Mail's counts), a VIP mark, or a meeting not from the sample. When the
sample is the person's only calendar it also removes their Meetings settings,
since those were chosen on made-up meetings.

Ids come from the caller, so two people can each load their own sample, and
loading twice changes nothing.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NS = uuid.UUID("5d0c2b8e-7a41-4f6b-9e37-1c2a8f4d6b13")
SAMPLE_ROOT = "/meetings-sample"
TEAM_DOMAIN = "yourcompany.example"
# Browsers still report some zones by their old names (Chrome says
# Asia/Calcutta); the functions' time zone database knows only the current
# ones, so an old name would quietly become UTC.
ZONE_ALIASES = {
    "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
    "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
    "Atlantic/Faeroe": "Atlantic/Faroe", "US/Eastern": "America/New_York", "US/Central": "America/Chicago",
    "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", "GMT": "UTC", "Etc/UTC": "UTC",
}


def _zone_name(name: str | None) -> str | None:
    return ZONE_ALIASES.get(name or "", name) if name else None


class MeetingsSampleDataInput(BaseModel):
    mode: str = "load"
    # The person's time zone, so made-up meetings fall in their working day,
    # and their name, as the transcript's speaker.
    timezone: str | None = None
    display_name: str | None = None


class MeetingsSampleDataResult(BaseModel):
    mode: str
    calendar_id: str | None = None
    meetings: int
    removed: int
    removed_files: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


# The people, as in Mail's sample mailbox.
MIRA = ("Mira Okafor", "mira@northgate-vc.example")
JONAH = ("Jonah Price", "jonah@northgate-vc.example")
TOMAS = ("Tomás Reyes", "tomas@harborlane.example")
AISHA = ("Aisha Bello", "aisha@quill-partners.example")
ELEANOR = ("Eleanor Park", "eleanor@parkhill.example")
DANIEL = ("Daniel Kowalski", "daniel@brightwave-health.example")
OLIVIA = ("Olivia Grant", "olivia.grant@brightwave-health.example")
LENA = ("Lena Fischer", "lena.fischer@ferro-logistics.example")
SANA = ("Sana Iqbal", "sana@orchard-dental.example")
MARTA = ("Marta Silva", "marta@orchard-dental.example")
KEN = ("Ken Ito", "ken@orchard-dental.example")
LEAH = ("Leah Brooks", "leah@orchard-dental.example")
INES = ("Inès Moreau", "ines@velo-cycles.example")
PAUL = ("Paul Girard", "paul@velo-cycles.example")
FELIX = ("Felix Brandt", "felix@brandt-family.example")
HANNAH = ("Hannah Volkov", "hannah@volkov-advisory.example")
JONAS = ("Jonas Weber", "jonas@buildnotes.example")
GRACE = ("Grace Tan", "grace@studio-tan.example")
YUSUF = ("Yusuf Demir", "yusuf.demir@mailbox.example")
CHLOE = ("Chloé Martin", "chloe.martin@mailbox.example")
BEA = ("Bea Novak", "bea@talentbridge.example")
NOOR = ("Noor Haddad", f"noor@{TEAM_DOMAIN}")
THEO = ("Theo Lindqvist", f"theo@{TEAM_DOMAIN}")

ME = "me"

# key, business days from today, hour, minute, minutes, title, organizer,
# [(person, response)], agenda, location, series.
MEETINGS: list[tuple] = [
    # Ahead
    ("northgate-dataroom", 1, 10, 0, 45, "Northgate Ventures: data room walkthrough", MIRA,
     [(MIRA, "accepted"), (JONAH, "needsAction")],
     "Go through the data room and the last three months of revenue before Monday's partner meeting.", None, None),
    ("yusuf-interview", 1, 14, 0, 45, "Interview: Yusuf Demir (Senior Backend Engineer)", ME,
     [(YUSUF, "accepted"), (THEO, "accepted")],
     "Technical interview. Theo leads the systems design part.", None, None),
    ("harbor-intro", 2, 11, 0, 30, "Harbor Lane Capital <> intro", TOMAS,
     [(TOMAS, "accepted")],
     "Intro call, suggested by Lucia Romano.", None, None),
    ("felix-lunch", 2, 12, 30, 60, "Lunch with Felix", FELIX,
     [(FELIX, "accepted")], "", "Ramen place on Elm Street", None),
    ("orchard-onboarding", 3, 15, 0, 60, "Orchard Dental onboarding", ME,
     [(SANA, "accepted"), (MARTA, "needsAction"), (KEN, "needsAction"), (LEAH, "accepted"), (NOOR, "accepted")],
     "Set up the practice's accounts, bring in the patient reminders, and train the front desk.", None, None),
    ("podcast", 3, 17, 0, 45, "Build Notes recording", JONAS,
     [(JONAS, "accepted")],
     "Recording for Build Notes, on pricing for small software companies. Remote, about 45 minutes.", None, None),
    ("brightwave-renewal", 4, 9, 30, 30, "Brightwave Health: renewal", DANIEL,
     [(DANIEL, "accepted"), (OLIVIA, "tentative")],
     "Renewal from 32 to 40 seats, and the two-year term Finance asked about.", None, None),
    ("focus-board-pack", 5, 13, 0, 120, "Focus: board pack", ME, [], "", None, None),
    ("board", 6, 10, 0, 90, "Board meeting", ME,
     [(ELEANOR, "accepted"), (MIRA, "accepted"), (NOOR, "accepted")],
     "Q4 numbers, the round, and the hiring plan for the two senior roles.", "Parkhill offices, 4th floor", None),
    ("hannah-pricing", 7, 15, 0, 30, "Pricing page v2", ME,
     [(HANNAH, "accepted")],
     "Walk through v2: the middle tier dropped, the annual price first.", None, None),
    ("quill-terms", 8, 11, 0, 30, "Quill Partners: cap table and option pool", AISHA,
     [(AISHA, "accepted")],
     "Before the term sheet: the cap table and the size of the option pool.", None, None),
    ("studio-tan-kickoff", 9, 14, 0, 45, "Brand refresh kick-off", GRACE,
     [(GRACE, "accepted")],
     "Logo and website colours, first phase.", None, None),
    ("talentbridge-shortlist", 10, 10, 0, 30, "Product designer shortlist", BEA,
     [(BEA, "accepted")],
     "Three product-focused profiles.", None, None),
    # Behind
    ("velo-review", -2, 15, 0, 45, "Velo Cycles: rollout review", INES,
     [(INES, "accepted"), (PAUL, "accepted")],
     "How the rollout is going, single sign-on, and next year's plan.", None, None),
    ("ferro-checkin", -4, 14, 0, 30, "Ferro Logistics: export bug follow-up", ME,
     [(LENA, "accepted")],
     "The CSV export dropping its last row: what we found and when the fix ships.", None, None),
    ("northgate-pitch", -7, 10, 0, 60, "Northgate Ventures: first pitch", ME,
     [(MIRA, "accepted")], "Seed round: 1.5M to get to 40 paying teams.", None, None),
    ("quill-intro", -7, 15, 0, 45, "Quill Partners intro", AISHA,
     [(AISHA, "accepted")], "", None, None),
    ("chloe-interview", -8, 11, 0, 60, "Interview: Chloé Martin (Product Designer)", ME,
     [(CHLOE, "accepted"), (THEO, "accepted")], "Portfolio review and a design exercise.", None, None),
    ("studio-tan-intro", -14, 10, 0, 30, "Studio Tan intro", ME,
     [(GRACE, "accepted")], "", None, None),
]
# The weekly team sync, a repeating series: one week apart, five business days.
SYNC_DAYS = [-20, -15, -10, -5, 0, 5, 10]

# What was said in the rollout review, as Google Meet writes a transcript:
# one speaker per line. {owner} is the person's own name.
TRANSCRIPTS = {
    "velo-review": """Inès Moreau: Thanks for making the time. Since the export fix went live the warehouse team has used it every day.
{owner}: Good to hear. How far has the rollout got beyond the warehouse?
Paul Girard: We're at fourteen users now. The two other sites start in January.
Inès Moreau: The main thing for us is single sign-on. Our IT team won't open it to the other sites without it.
{owner}: We can turn on single sign-on for your account next week. I'll send you the setup guide by Friday.
Inès Moreau: Perfect. On pricing, we'd like to move to the annual plan from January.
{owner}: That works for us. So we agree the annual plan starts in January, at the current price per seat.
Inès Moreau: Agreed.
Paul Girard: I'll send you the list of warehouse users who need accounts by Wednesday.
{owner}: Thanks, Paul. Has the export problem come back at all?
Paul Girard: Not once since the fix.
Inès Moreau: One more thing. Could you join our ops review on the 3rd and show the new reports?
{owner}: Yes, I'll be there, and I'll bring the reports demo.
Inès Moreau: Great. I'll have the purchase order for the annual plan raised before the end of the month.
{owner}: Then we're decided: annual from January, single sign-on next week, and the reports at your ops review.
Paul Girard: One question on exports. Can we schedule them weekly?
{owner}: Not yet. It's on the list for the new year, but I can't promise a date.
Inès Moreau: Fair enough. Thanks, both.
""",
}


def _business_day(today: date, offset: int) -> date:
    day = today
    while day.weekday() >= 5:
        day += timedelta(days=1)
    step = 1 if offset >= 0 else -1
    left = abs(offset)
    while left:
        day += timedelta(days=step)
        if day.weekday() < 5:
            left -= 1
    return day


def _ids(ctx: FunctionContext):
    who = str(ctx.user_id or ctx.user_email or "someone")
    return lambda key: str(uuid.uuid5(NS, f"{who}:{key}"))


def _event(key: str, day: date, hour: int, minute: int, minutes: int, title: str, organizer, people, agenda: str,
           location: str | None, series: str | None, me: str, owner: str, zone: ZoneInfo) -> dict:
    start = datetime.combine(day, time(hour, minute), zone)
    end = start + timedelta(minutes=minutes)
    organizer_email = me if organizer == ME else organizer[1]
    attendees = [{"email": me, "displayName": owner, "responseStatus": "accepted", "self": True,
                  "organizer": organizer == ME}] if people else []
    for (name, email), response in people:
        attendees.append({"email": email, "displayName": name, "responseStatus": response,
                          "organizer": organizer != ME and email == organizer_email})
    event = {
        "id": f"sample-{key}",
        "status": "confirmed",
        "summary": title,
        "description": agenda,
        "start": {"dateTime": start.isoformat()},
        "end": {"dateTime": end.isoformat()},
        "organizer": {"email": organizer_email, "self": organizer == ME},
        "attendees": attendees,
        "location": location or "",
    }
    if people and not location:
        # A made-up joining link at a reserved domain: it can never open a
        # real call.
        event["hangoutLink"] = f"https://meet.example/{key}"
    if series:
        event["recurringEventId"] = series
    return event


def _load(ctx: FunctionContext, data: MeetingsSampleDataInput) -> MeetingsSampleDataResult:
    _id = _ids(ctx)
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    me = (ctx.user_email or f"you@{TEAM_DOMAIN}").lower()
    settings = (_rows(pod.query("SELECT display_name, timezone FROM meetings_settings LIMIT 1")) or [{}])[0]
    try:
        zone = ZoneInfo(_zone_name(data.timezone or settings.get("timezone")) or "UTC")
    except Exception:  # noqa: BLE001 — an unknown zone falls back to UTC
        zone = ZoneInfo("UTC")
    # The owner speaks as themselves in the transcript; "You" when no name is known.
    owner = data.display_name or settings.get("display_name") or "You"
    today = now.astimezone(zone).date()

    calendar_id = _id("calendar")
    if not _rows(pod.query(f"SELECT id FROM meetings_calendar WHERE id = {_sql(calendar_id)}")):
        pod.records.bulk_create("meetings_calendar", [{
            "id": calendar_id, "provider": "sample", "account_id": None, "email": me,
            "own_domains": [TEAM_DOMAIN], "state": "reading", "connected_at": now.isoformat(),
        }])
    events = []
    for key, offset, hour, minute, minutes, title, organizer, people, agenda, location, series in MEETINGS:
        events.append(_event(key, _business_day(today, offset), hour, minute, minutes, title, organizer, people,
                             agenda, location, series, me, owner, zone))
    for offset in SYNC_DAYS:
        day = _business_day(today, offset)
        events.append(_event(f"weekly-sync-{day.isoformat()}", day, 16, 30, 30, "Weekly sync", ME,
                             [(NOOR, "accepted"), (THEO, "accepted")],
                             "Pipeline, hiring, anything blocked.", None, "sample-weekly-sync", me, owner, zone))
    transcripts = {f"sample-{k}": v.replace("{owner}", owner) for k, v in TRANSCRIPTS.items()}
    try:
        pod.files.create_folder(SAMPLE_ROOT)
    except Exception:  # noqa: BLE001 — the bundle made it; already there is the usual case
        pass
    pod.files.write_text(f"{SAMPLE_ROOT}/{calendar_id}.json",
                         json.dumps({"owner": owner, "events": events, "transcripts": transcripts}))
    return MeetingsSampleDataResult(
        mode="load", calendar_id=calendar_id, meetings=len(events), removed=0, removed_files=0,
        message=f"Sample calendar ready: {len(events)} meetings and one transcript, waiting for the first read.",
    )


def _clear(ctx: FunctionContext) -> MeetingsSampleDataResult:
    pod = ctx.pod
    calendars = _rows(pod.query("SELECT id, provider FROM meetings_calendar"))
    sample = [c["id"] for c in calendars if c.get("provider") == "sample"]
    full = not any(c.get("provider") != "sample" for c in calendars)
    removed = 0

    def drop(table: str, where: str) -> int:
        count = 0
        while True:
            ids = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {table} WHERE {where} LIMIT 500"))]
            for start in range(0, len(ids), 100):
                pod.records.bulk_delete(table, ids[start : start + 100])
            count += len(ids)
            if len(ids) < 500:
                return count

    paths: list[str] = []
    if sample:
        rows = _rows(pod.query(
            f"SELECT id, source_id, document_path FROM meeting WHERE source = 'calendar' AND source_account IN ({_in(sample)}) LIMIT 5000"))
        meeting_ids = [r["id"] for r in rows]
        source_ids = [r["source_id"] for r in rows]
        met = _met(pod, sample)
        paths = [r["document_path"] for r in rows if (r.get("document_path") or "").startswith(SAMPLE_ROOT + "/")]
        paths += [f"{SAMPLE_ROOT}/{c}.json" for c in sample]
        # The person's day: Meetings' items for these meetings and their
        # promises leave it (closed by the source; nothing is deleted there).
        promise_ids = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM promise WHERE source = 'meeting' AND source_id IN ({_in(source_ids)}) LIMIT 5000"))]
        items = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM needs_you WHERE source_plugin = 'meetings' AND state <> 'done' "
            f"AND source_id IN ({_in(meeting_ids + promise_ids)}) LIMIT 5000"))]
        for start in range(0, len(items), 100):
            pod.records.bulk_update("needs_you", [{"id": i, "state": "done", "closed_by": "source"} for i in items[start : start + 100]])
        removed += drop("promise", f"source = 'meeting' AND source_id IN ({_in(source_ids)})")
        removed += drop("meetings_decision", f"meeting_id IN ({_in(meeting_ids)})")
        removed += drop("meetings_correction", f"meeting_id IN ({_in(meeting_ids)})")
        removed += drop("meetings_work", f"id IN ({_in(meeting_ids)})")
        removed += drop("meeting", f"source = 'calendar' AND source_account IN ({_in(sample)})")
        removed += drop("meetings_calendar", f"id IN ({_in(sample)})")
        # Last: by now the sample's own promises and meetings are gone, so
        # whatever still names one of these people is someone else's.
        removed += _forget(pod, met, drop)
    if full:
        # Everything left was chosen on made-up meetings.
        removed += drop("meetings_correction", "TRUE")
        removed += drop("meetings_settings", "TRUE")

    removed_files = 0
    for path in sorted(set(paths)):
        try:
            pod.files.delete(path)
            removed_files += 1
        except Exception:  # noqa: BLE001 — never written, or already gone
            pass
    return MeetingsSampleDataResult(
        mode="clear", meetings=0, removed=removed, removed_files=removed_files,
        message=f"Removed {removed} sample rows and {removed_files} files"
        + ("; Meetings is back to its first screen." if full else "; your own calendar and settings are untouched."),
    )


def _met(pod, calendars: list[str]) -> set[str]:
    """Everyone but the owner on the sample's meetings, by handle."""
    out: set[str] = set()
    for r in _rows(pod.query(
            f"SELECT attendees FROM meeting WHERE source = 'calendar' AND source_account IN ({_in(calendars)}) LIMIT 5000")):
        for a in r.get("attendees") or []:
            if isinstance(a, dict) and a.get("handle") and not a.get("you"):
                out.add(str(a["handle"]).lower())
    return out


def _forget(pod, met: set[str], drop) -> int:
    """Remove the people only the sample's meetings brought in.

    A person goes only when every handle they have is one of the sample's
    attendees and nothing else refers to them: no conversation, message or
    promise from another source names a handle of theirs, no meeting left (one
    from another calendar) has them on it, Mail has counted nothing for them,
    and nobody marked them VIP. Everyone else stays as they are."""
    if not met:
        return 0
    handles = sorted(met)
    rows = []
    for i in range(0, len(handles), 200):
        rows += _rows(pod.query(
            f"SELECT person_id FROM person_handle WHERE kind = 'email' AND handle IN ({_in(handles[i : i + 200])})"))
    people = sorted({r["person_id"] for r in rows})
    if not people:
        return 0
    their: dict[str, set[str]] = {}
    for i in range(0, len(people), 200):
        for r in _rows(pod.query(
                f"SELECT person_id, kind, handle FROM person_handle WHERE person_id IN ({_in(people[i : i + 200])})")):
            their.setdefault(r["person_id"], set()).add(f"{r['kind']}:{str(r['handle']).lower()}")
    facts = {}
    for i in range(0, len(people), 200):
        for r in _rows(pod.query(
                "SELECT id, is_vip, conversation_count, inbound_count, outbound_count FROM person "
                f"WHERE id IN ({_in(people[i : i + 200])})")):
            facts[r["id"]] = r
    named: set[str] = set()
    for i in range(0, len(handles), 200):
        chunk = _in(handles[i : i + 200])
        for sql in (
            f"SELECT LOWER(counterpart_handle) AS h FROM conversation WHERE LOWER(counterpart_handle) IN ({chunk})",
            f"SELECT LOWER(from_handle) AS h FROM message WHERE LOWER(from_handle) IN ({chunk})",
            "SELECT DISTINCT LOWER(r.value) AS h FROM message m, jsonb_array_elements_text(m.to_handles::jsonb) AS r(value) "
            f"WHERE LOWER(r.value) IN ({chunk})",
            "SELECT DISTINCT LOWER(r.value) AS h FROM conversation c, jsonb_array_elements_text(c.participants::jsonb) AS r(value) "
            f"WHERE LOWER(r.value) IN ({chunk})",
            f"SELECT LOWER(person_handle) AS h FROM promise WHERE LOWER(person_handle) IN ({chunk})",
            "SELECT DISTINCT LOWER(a.value->>'handle') AS h FROM meeting m, jsonb_array_elements(m.attendees::jsonb) AS a(value) "
            f"WHERE LOWER(a.value->>'handle') IN ({chunk})",
        ):
            named |= {r["h"] for r in _rows(pod.query(sql)) if r.get("h")}
    sample = {f"email:{h}" for h in met}
    gone = []
    for pid in people:
        f = facts.get(pid) or {}
        own = their.get(pid, set())
        if not own or not own <= sample:
            continue  # another handle: someone else knows them
        if any(h.split(":", 1)[1] in named for h in own):
            continue
        if f.get("is_vip") or any(int(f.get(k) or 0) for k in ("conversation_count", "inbound_count", "outbound_count")):
            continue
        gone.append(pid)
    removed = 0
    for i in range(0, len(gone), 200):
        chunk = _in(gone[i : i + 200])
        removed += drop("person_handle", f"person_id IN ({chunk})")
        removed += drop("person", f"id IN ({chunk})")
    return removed


def meetings_sample_data(ctx: FunctionContext, data: MeetingsSampleDataInput) -> MeetingsSampleDataResult:
    if data.mode == "load":
        return _load(ctx, data)
    if data.mode == "clear":
        return _clear(ctx)
    raise ValueError("mode is load or clear")
