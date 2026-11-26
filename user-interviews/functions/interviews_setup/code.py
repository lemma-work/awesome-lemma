#input_type_name: InterviewsSetupInput
#output_type_name: InterviewsSetupResult
#function_name: interviews_setup

"""User interviews' set-up, run as the person in the app.

`check`: where this member stands, for the set-up page and a study's side
panel: the team's product (and every product of ours to pick from), the
contact rules, whether their Mail is set up (a mailbox to send invites
from), whether Meetings reads their calls and from what (`notes_from`:
Meet's transcript or their notes), and whether their booking page is on with
a link to put in invites. Says what is missing in plain words.

`save`: the team's product (picked, or made from a name when the team has
none, role ours), the contact rules, set-up done; then the memory block. The
app makes the member's own triggers and daily run afterwards, as them. Safe
to run again.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# interviews:common
# Shared by every User interviews function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

INTERVIEWS_NS = _uuid.UUID("119b800c-47d6-43fe-9576-6e281b149300")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
SETTINGS_ID = str(_uuid.uuid5(INTERVIEWS_NS, "settings"))
PLUGIN = "user-interviews"
APP = "interviews"
# A person who asked never to hear from us again rests until then.
NEVER = "2100-01-01T00:00:00+00:00"
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com",
            "proton.me", "protonmail.com", "aol.com"}
# Stages before an invite went out: the contact rules can still hold them back.
NOT_SENT = ("fits", "drafted")


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(INTERVIEWS_NS, ":".join(str(p) for p in parts)))


def person_row_id(study_id, handle_kind, handle) -> str:
    return str(_uuid.uuid5(INTERVIEWS_NS, f"{study_id}:{handle_kind}:{str(handle).strip().lower()}"))


def quote_key(quote) -> str:
    """The contract's quote key: sha1 of the quote lowercased, whitespace collapsed, first 16 hex."""
    return _hashlib.sha1(" ".join(str(quote or "").lower().split()).encode("utf-8")).hexdigest()[:16]


def feedback_row_id(source, source_id, quote) -> str:
    """The contract's id for a `feedback` row (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time (a read answers at most 1000)."""
    out: list = []
    while len(out) < most:
        got = q(pod, f"{sql} LIMIT {page} OFFSET {len(out)}")
        out += got
        if len(got) < page:
            break
    return out


def lit(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def lits(values) -> str:
    return ", ".join(lit(v) for v in values) or "NULL"


def as_dict(obj) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()
    return obj if isinstance(obj, dict) else {}


def jl(value, default=None):
    """A JSON column as Python, whether the API handed back text or JSON."""
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return _json.loads(value)
    except (TypeError, ValueError):
        return default


def now_utc() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(str(name or ""), str(name or "UTC")))
    except Exception:  # noqa: BLE001 - an unknown zone reads as UTC
        return _Zone("UTC")


def day_said(value, tz="UTC") -> str:
    """26 Nov (and the year when it isn't this one)."""
    moment = stamp(value)
    if not moment:
        return ""
    local = moment.astimezone(zone(tz))
    text = f"{local.day} {local.strftime('%b')}"
    return text if local.year == now_utc().astimezone(zone(tz)).year else f"{text} {local.year}"


def clip(value, n: int):
    text = " ".join(str(value if value is not None else "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def first_name(name, handle=None) -> str:
    text = str(name or "").strip()
    if text:
        return text.split()[0]
    return str(handle or "someone").split("@")[0]


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM interviews_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["invite_gap_days"] = int(s.get("invite_gap_days") or 30)
    s["no_show_days"] = int(s.get("no_show_days") or 90)
    s["nudge_days"] = int(s.get("nudge_days") or 4)
    return s


def fn(pod, name: str, payload: dict) -> dict:
    """Run another function of this Lemma (as the same person); its output."""
    return as_dict(as_dict(pod.functions.run(name, payload)).get("output_data"))


def start_read(pod, person_id: str) -> None:
    """Read one call for findings: the interviews-read workflow, as the person running this."""
    pod.workflows.run("interviews-read", about=("interviews_person", person_id))


def rest_for(row: dict, others: list, s: dict, now=None):
    """Whether the contact rules hold this person back in this study, and why.

    `others` are every study's rows for the same handle. Never after they
    opted out (anywhere); not for no_show_days after a no-show; not within
    invite_gap_days of an invite sent from another study. A person's
    override lets them through the last two, never the first."""
    now = now or now_utc()
    if row.get("stage") not in NOT_SENT:
        return None, None
    out = [o for o in others if o.get("stage") == "opted_out"]
    if out:
        return NEVER, "Asked not to be invited again"
    override = stamp(row.get("override_at"))
    found = []
    for o in others:
        if o.get("id") == row.get("id"):
            continue
        missed = stamp(o.get("no_show_at"))
        if missed and (not override or override < missed):
            until = missed + _timedelta(days=s["no_show_days"])
            if until > now:
                found.append((until, f"Missed a call on {day_said(missed)}"))
        sent = stamp(o.get("invited_at"))
        if sent and (not override or override < sent):
            until = sent + _timedelta(days=s["invite_gap_days"])
            if until > now:
                found.append((until, f"Invited {day_said(sent)} to another study"))
    if not found:
        return None, None
    until, rule = max(found, key=lambda f: f[0])
    return until.isoformat(), rule


def rest_refresh(pod, s: dict, handles) -> int:
    """Work the contact rules out again for every row of these handles; the rows that changed."""
    handles = sorted({str(h).lower() for h in handles if h})
    changed = 0
    for start in range(0, len(handles), 100):
        got = q_all(pod, "SELECT id, handle, stage, invited_at, no_show_at, override_at, rests_until, rest_rule "
                         f"FROM interviews_person WHERE handle IN ({lits(handles[start:start + 100])}) ORDER BY id")
        by: dict = {}
        for r in got:
            by.setdefault(str(r.get("handle") or "").lower(), []).append(r)
        updates = []
        for group in by.values():
            for r in group:
                until, rule = rest_for(r, group, s)
                if (stamp(until) != stamp(r.get("rests_until"))) or (rule or None) != (r.get("rest_rule") or None):
                    updates.append({"id": r["id"], "rests_until": until, "rest_rule": rule})
        for i in range(0, len(updates), 100):
            pod.records.bulk_update("interviews_person", updates[i:i + 100])
        changed += len(updates)
    return changed


def is_resting(row: dict, now=None) -> bool:
    until = stamp(row.get("rests_until"))
    return bool(until and until > (now or now_utc()) and row.get("stage") in NOT_SENT)


def norm_text(text) -> str:
    """For checking a quote against a document word for word (Meetings' rule):
    spacing, case and quote marks aside."""
    text = str(text or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    return " ".join(text.split()).lower().strip(" .\"'")


TIME_LINE = _re.compile(r"^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(?:([^:\n]{1,60}):\s*)?(.*)$")


def line_time(line: str):
    """Seconds into the call of a '[m:ss] Speaker: words' line (h:mm:ss past an hour), its speaker and words."""
    m = TIME_LINE.match(line or "")
    if not m:
        return None, None, line
    a, b, c, who, words = m.groups()
    secs = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
    return secs, (who or "").strip() or None, words


def mm_ss(secs) -> str:
    if secs is None:
        return ""
    secs = int(secs)
    h, rest = divmod(secs, 3600)
    m, s_ = divmod(rest, 60)
    return f"{h}:{m:02d}:{s_:02d}" if h else f"{m}:{s_:02d}"
# end interviews:common


class InterviewsSetupInput(BaseModel):
    mode: str = "check"
    product_id: str | None = None
    product_name: str | None = None
    invite_gap_days: int | None = None
    no_show_days: int | None = None
    nudge_days: int | None = None


class InterviewsSetupResult(BaseModel):
    settings: dict = {}
    products: list = []
    mail: dict = {}
    meetings: dict = {}
    booking: dict = {}
    missing: list = []
    memory: str | None = None
    message: str


def _safe(pod, sql: str) -> list:
    """A read of another plugin's table that may not be set up for this person yet."""
    try:
        return q(pod, sql)
    except Exception:  # noqa: BLE001 - the table or the person's row isn't there
        return []


def _where(pod) -> dict:
    mail = _safe(pod, "SELECT id, provider, account_id, email, state FROM mail_mailbox ORDER BY connected_at LIMIT 5")
    real = [m for m in mail if m.get("account_id") != "sample"]
    box = (real or mail or [None])[0]
    msets = (_safe(pod, "SELECT setup_step, notes_from, display_name, timezone FROM meetings_settings LIMIT 1") or [{}])[0]
    cals = _safe(pod, "SELECT id, provider FROM meetings_calendar LIMIT 20")
    bsets = (_safe(pod, "SELECT page_id, page_url, minutes, video, setup_done_at FROM booking_settings LIMIT 1") or [{}])[0]
    page = (_safe(pod, f"SELECT state, handle FROM booking_page WHERE id = {lit(bsets.get('page_id'))}") if bsets.get("page_id") else [{}]) or [{}]
    return {
        "mail": {"ok": bool(box), "email": (box or {}).get("email"), "provider": (box or {}).get("provider"),
                 "sample": bool(box and box.get("account_id") == "sample"), "mailbox_id": (box or {}).get("id")},
        "meetings": {"ok": msets.get("setup_step") == "done", "notes_from": msets.get("notes_from"),
                     "calendar": bool([c for c in cals if c.get("provider") != "sample"]),
                     "sample": bool(cals) and all(c.get("provider") == "sample" for c in cals),
                     "display_name": msets.get("display_name"), "timezone": msets.get("timezone")},
        "booking": {"ok": bool(bsets.get("page_url")), "page_url": bsets.get("page_url"), "minutes": bsets.get("minutes"),
                    "video": bsets.get("video"), "on": (page[0] or {}).get("state") == "on"},
    }


def _missing(w: dict, s: dict) -> list:
    out = []
    if not s.get("product_id"):
        out.append({"step": "product", "text": "Name the product findings are filed under."})
    if not w["mail"]["ok"]:
        out.append({"step": "mail", "text": "Set up Mail, so invites go from your own mailbox."})
    if not w["meetings"]["ok"]:
        out.append({"step": "meetings", "text": "Set up Meetings, so your calls are on the calendar and read afterwards."})
    elif w["meetings"]["notes_from"] == "skip":
        out.append({"step": "after", "text": "Meetings reads nothing after your calls: choose the Meet transcript or your notes."})
    if not w["booking"]["ok"]:
        out.append({"step": "booking", "text": "Turn on your booking page, so each invite carries a link to book."})
    return out


def interviews_setup(ctx: FunctionContext, data: InterviewsSetupInput) -> InterviewsSetupResult:
    pod = ctx.pod
    s = settings_of(pod)
    products = q(pod, "SELECT id, name FROM product WHERE role = 'ours' AND (active IS NULL OR active = TRUE) ORDER BY created_at LIMIT 50")
    memory = None
    if data.mode == "save":
        pid = data.product_id
        if not pid and (data.product_name or "").strip():
            name = clip(data.product_name, 160)
            same = [p for p in products if str(p.get("name") or "").strip().lower() == name.lower()]
            if same:
                pid = same[0]["id"]
            else:
                pid = rid("product", name.lower())
                pod.records.bulk_create("product", [{"id": pid, "name": name, "role": "ours", "active": True,
                                                     "source": "setup", "source_id": PLUGIN}], upsert=True)
                products.append({"id": pid, "name": name})
        if not pid and products:
            pid = products[0]["id"]
        if not pid:
            raise ValueError("Name your product first: findings are filed under its features.")
        label = next((p["name"] for p in products if p["id"] == pid), None)
        row = {"product_id": pid, "product_label": label, "setup_by": str(ctx.user_id),
               "invite_gap_days": max(1, int(data.invite_gap_days or s["invite_gap_days"])),
               "no_show_days": max(1, int(data.no_show_days or s["no_show_days"])),
               "nudge_days": max(1, int(data.nudge_days or s["nudge_days"])),
               "setup_done_at": s.get("setup_done_at") or now_iso()}
        if s.get("id"):
            pod.records.update("interviews_settings", s["id"], row)
        else:
            pod.records.bulk_create("interviews_settings", [dict(row, id=SETTINGS_ID)], upsert=True)
        try:
            memory = fn(pod, "interviews_memory", {}).get("message")
        except Exception as exc:  # noqa: BLE001 - set-up stands without it
            memory = f"Couldn't write the memory block: {clip(exc, 200)}"
        s = settings_of(pod)
    w = _where(pod)
    missing = _missing(w, s)
    if data.mode == "save":
        message = "Saved." + (f" Still to do: {len(missing)}." if missing else " Everything is ready.")
    else:
        message = "Ready." if not missing else f"{plural(len(missing), 'step')} to go."
    keep = ("id", "product_id", "product_label", "invite_gap_days", "no_show_days", "nudge_days", "setup_done_at", "sample")
    return InterviewsSetupResult(settings={k: s.get(k) for k in keep}, products=products, mail=w["mail"],
                                 meetings=w["meetings"], booking=w["booking"], missing=missing, memory=memory, message=message)
