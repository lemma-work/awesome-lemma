#input_type_name: RoadmapSampleDataInput
#output_type_name: RoadmapSampleDataResult
#function_name: roadmap_sample_data

"""A sample roadmap to look around in, and taking it away again.

`load` writes a made-up product (Fernway) with its features, what people at
fourteen made-up companies said about them (quotes, by role, at `.example`
addresses), who asked (`ask`), the companies' deals, three Tasks projects and
the team's plan for thirteen features, into the shared tables, dated around
today. Every row it makes is noted in `roadmap_sample_row`.

`clear` removes only those rows (and the specs, Pages, outside-page lines and
Tasks projects made for the sample's features since), and closes the sample's
items in the person's Today. A company that was already in the Lemma is left
alone. The team's own features, quotes and deals stay.
"""

from __future__ import annotations

import hashlib

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# roadmap:common
# Shared by every Roadmap function, word for word: bin/common.py copies it in.
# Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

ROADMAP_NS = _uuid.UUID("5c0e7a3d-2b91-4f6e-8d14-9a7b3e6c1f28")
SETTINGS_ID = str(_uuid.uuid5(ROADMAP_NS, "settings"))
HORIZONS = ("none", "now", "next", "later", "shipped")
# feature.stage moves forward only: idea, planned, building, beta, live. declined is its own end.
STAGE_ORDER = {"idea": 0, "planned": 1, "building": 2, "beta": 3, "live": 4}
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
# User feedback's app, opened for its own work (links to check, a suggested
# feature). Its slug isn't settled until User feedback is built.
FEEDBACK_APP = "feedback"


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(ROADMAP_NS, ":".join(str(p) for p in parts)))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time: one read returns at most 1,000.
    `sql` has an ORDER BY and no LIMIT."""
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


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(name or "", name or "UTC"))
    except Exception:  # noqa: BLE001
        return _Zone("UTC")


def today_in(name) -> _date:
    return _datetime.now(_tz.utc).astimezone(zone(name)).date()


def day(value):
    if not value:
        return None
    if isinstance(value, _date) and not isinstance(value, _datetime):
        return value
    try:
        return _date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def stamp(value):
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def days_since(value) -> int | None:
    moment = stamp(value)
    return None if moment is None else max(0, (_datetime.now(_tz.utc) - moment).days)


def json_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def json_obj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def clip(value, n: int):
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def slug(text) -> str:
    out = _re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return out[:60].strip("-") or "feature"


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM roadmap_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM roadmap_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["timezone"] = s.get("timezone") or "UTC"
    s["stale_days"] = 14 if s.get("stale_days") is None else int(s["stale_days"])
    if not s.get("currency"):
        try:
            deals = q(pod, "SELECT currency FROM deals_settings ORDER BY created_at LIMIT 1")
        except Exception:  # noqa: BLE001 — Deal tracker isn't here
            deals = []
        s["currency"] = (deals[0].get("currency") if deals else None) or "USD"
    s["currency"] = str(s["currency"]).upper()[:3]
    return s


def money_short(amount, currency: str) -> str:
    """"$62k", "€1.2M", "$900": a column's figure, never rounded up past what it is."""
    a = float(amount or 0)
    sign = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "JPY": "¥", "AUD": "A$", "CAD": "C$"}.get(currency, "")
    unit = "" if sign else f" {currency}"
    if a >= 1_000_000:
        text = f"{int(a / 100_000) / 10:g}M"
    elif a >= 1000:
        text = f"{int(a / 1000)}k"
    else:
        text = f"{int(a)}"
    return f"{sign}{text}{unit}"


def money_said(by_currency: dict, main: str) -> str:
    """{"USD": 62000, "EUR": 12000} -> "$62k + €12k": the main currency first, never converted."""
    parts = [money_short(by_currency[c], c) for c in sorted(by_currency, key=lambda c: (c != main, c)) if by_currency[c]]
    return " + ".join(parts) or "none"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"
# end roadmap:common

# roadmap:publish
# The outside page's rewrite, shared word for word by roadmap_publish (where it
# is edited), roadmap_set, roadmap_ship and roadmap_setup_save: bin/common.py
# copies it.
PUBLIC_LANES = ("now", "next", "later", "shipped")
SHIPPED_KEPT_DAYS = 90


def publish(pod, s: dict) -> dict:
    """roadmap_public, made to match the public items: rows added, changed and taken away."""
    want: dict = {}
    if s.get("public_on"):
        items = q_all(pod, "SELECT id, horizon, horizon_at, public, public_title, public_blurb, shipped_on FROM roadmap_item "
                           "WHERE public = true ORDER BY horizon_at, id")
        ids = [i["id"] for i in items]
        names = {}
        for start in range(0, len(ids), 300):
            for f in q(pod, f"SELECT id, name, state FROM feature WHERE id IN ({lits(ids[start:start + 300])})"):
                if f.get("state") in ("active", "suggested"):
                    names[f["id"]] = f["name"]
        cutoff = today_in(s.get("timezone")) - _timedelta(days=SHIPPED_KEPT_DAYS)
        lanes: dict = {lane: [] for lane in PUBLIC_LANES}
        for it in items:
            lane = it.get("horizon")
            if lane not in PUBLIC_LANES or it["id"] not in names:
                continue
            shipped = day(it.get("shipped_on"))
            if lane == "shipped" and (not shipped or shipped < cutoff):
                continue
            title = clip(it.get("public_title") or names[it["id"]], 120)
            lanes[lane].append({"id": it["id"], "lane": lane, "title": title, "blurb": clip(it.get("public_blurb"), 300) or None,
                                "shipped_on": shipped.isoformat() if lane == "shipped" and shipped else None})
        lanes["shipped"].sort(key=lambda r: r["shipped_on"] or "", reverse=True)
        for lane, group in lanes.items():
            for n, row in enumerate(group):
                want[row["id"]] = dict(row, position=n)
    have = {r["id"]: r for r in q_all(pod, "SELECT id, lane, title, blurb, shipped_on, position FROM roadmap_public ORDER BY id")}
    gone = [i for i in have if i not in want]

    def same(old, new):
        return old and all(str(old.get(k) or "")[:10 if k == "shipped_on" else None] == str(new.get(k) or "")
                           for k in ("lane", "title", "blurb", "shipped_on", "position"))
    changed = [row for row in want.values() if not same(have.get(row["id"]), row)]
    for start in range(0, len(gone), 100):
        pod.records.bulk_delete("roadmap_public", gone[start:start + 100])
    for start in range(0, len(changed), 100):
        pod.records.bulk_create("roadmap_public", changed[start:start + 100], upsert=True)
    return {"shown": len(want), "written": len(changed), "removed": len(gone), "on": bool(s.get("public_on"))}
# end roadmap:publish

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

COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
ASK_NS = _uuid.UUID("9972cf8e-4f42-4b98-86fc-fa5697c1f089")
TEAM = "T0SAMPLE"

COMPANIES = {
    "nf": ("Northwind Freight", "northwind-freight.example"), "tc": ("Tallis & Co", "tallis.example"),
    "oh": ("Orchard Health", "orchard-health.example"), "hc": ("Harbor Clinics", "harbor-clinics.example"),
    "kl": ("Kestrel Logistics", "kestrel.example"), "mb": ("Meridian Bank", "meridian-bank.example"),
    "oe": ("Ostara Energy", "ostara.example"), "ps": ("Pinecrest Schools", "pinecrest.example"),
    "bl": ("Brightline Labs", "brightline.example"), "af": ("Alder & Finch", "alderfinch.example"),
    "qr": ("Quayside Retail", "quayside.example"), "cs": ("Copperleaf Studio", "copperleaf.example"),
    "ld": ("Lumen Dental", "lumen-dental.example"), "rl": ("Redwood Legal", "redwood-legal.example"),
}
# company: status, amount, currency, stage, name. Kestrel's lost deal counts for nothing.
DEALS = [
    ("nf", "open", 36000, "USD", "Proposal", "Northwind Freight, ops team"),
    ("tc", "open", 26000, "USD", "Trial", "Tallis & Co, all teams"),
    ("mb", "open", 60000, "USD", "Security review", "Meridian Bank, operations"),
    ("oe", "open", 18000, "USD", "Proposal", "Ostara Energy, field teams"),
    ("cs", "open", 24000, "USD", "Demo", "Copperleaf Studio"),
    ("af", "open", 12000, "EUR", "Proposal", "Alder & Finch"),
    ("bl", "open", 9000, "USD", "Trial", "Brightline Labs"),
    ("hc", "won", 18000, "USD", "Won", "Harbor Clinics, two sites"),
    ("qr", "won", 37000, "USD", "Won", "Quayside Retail"),
    ("ps", "won", 22000, "USD", "Won", "Pinecrest Schools"),
    ("kl", "lost", 15000, "USD", "Lost", "Kestrel Logistics"),
]
# person: company, role (what the sample says instead of a name), handle kind, handle.
PEOPLE = {
    "nf.ops": ("nf", "Head of ops", "email", "head.ops@northwind-freight.example"),
    "nf.admin": ("nf", "Admin", "email", "admin@northwind-freight.example"),
    "nf.dispatch": ("nf", "Dispatch lead", "email", "dispatch@northwind-freight.example"),
    "nf.it": ("nf", "IT manager", "email", "it@northwind-freight.example"),
    "nf.drivers": ("nf", "Driver lead", "email", "drivers@northwind-freight.example"),
    "tc.po": ("tc", "Product owner", "slack", f"{TEAM}:U0TALLIS01"),
    "tc.ops": ("tc", "Operations lead", "slack", f"{TEAM}:U0TALLIS02"),
    "tc.fin": ("tc", "Finance manager", "email", "finance@tallis.example"),
    "tc.it": ("tc", "IT admin", "email", "it@tallis.example"),
    "oh.cm": ("oh", "Clinic manager", "email", "clinic.manager@orchard-health.example"),
    "oh.desk": ("oh", "Front desk lead", "email", "front.desk@orchard-health.example"),
    "hc.fin": ("hc", "Finance lead", "email", "finance.lead@harbor-clinics.example"),
    "hc.office": ("hc", "Office manager", "email", "office@harbor-clinics.example"),
    "kl.ops": ("kl", "Ops manager", "email", "ops.manager@kestrel.example"),
    "kl.plan": ("kl", "Planner", "email", "planner@kestrel.example"),
    "kl.drivers": ("kl", "Driver lead", "email", "drivers@kestrel.example"),
    "mb.sec": ("mb", "Security lead", "email", "security@meridian-bank.example"),
    "mb.itd": ("mb", "IT director", "email", "it.director@meridian-bank.example"),
    "mb.comp": ("mb", "Compliance officer", "email", "compliance@meridian-bank.example"),
    "mb.gh": ("mb", "Security engineer", "github", "mb-secops"),
    "oe.proc": ("oe", "Procurement lead", "email", "procurement@ostara.example"),
    "ps.it": ("ps", "IT manager", "email", "it@pinecrest.example"),
    "ps.admin": ("ps", "School admin", "email", "admin@pinecrest.example"),
    "bl.data": ("bl", "Data lead", "email", "data@brightline.example"),
    "bl.founder": ("bl", "Founder", "email", "founder@brightline.example"),
    "af.partner": ("af", "Partner", "email", "partner@alderfinch.example"),
    "qr.analyst": ("qr", "Analyst", "email", "analyst@quayside.example"),
    "qr.ops": ("qr", "Store operations", "slack", f"{TEAM}:U0QUAYS001"),
    "cs.producer": ("cs", "Producer", "email", "producer@copperleaf.example"),
    "cs.fin": ("cs", "Finance", "email", "finance@copperleaf.example"),
    "cs.design": ("cs", "Design lead", "email", "design@copperleaf.example"),
    "ld.office": ("ld", "Practice manager", "email", "practice@lumen-dental.example"),
    "rl.it": ("rl", "IT lead", "email", "it@redwood-legal.example"),
    "rl.para": ("rl", "Paralegal", "email", "paralegal@redwood-legal.example"),
    "rl.gh": ("rl", "Systems engineer", "github", "redwood-sysops"),
    "x.books": (None, "Freelance bookkeeper", "email", "bookkeeper@mail.example"),
    "x.consult": (None, "Consultant", "email", "consultant@mail.example"),
    "x.dev": (None, "Developer", "email", "dev@mail.example"),
}
AREAS = ["Records", "Admin", "Reporting", "Notifications", "Mobile", "Platform", "Search", "Integrations", "Billing"]
# key: name, area (a parent feature; "CSV export" sits under Reporting), stage, description.
FEATURES = {
    "bulk": ("Bulk edit on records", "Records", "planned", "Change one field on many records at once, from a filtered list."),
    "sso": ("SSO with Okta", "Admin", "building", "Members sign in through the company's Okta."),
    "csv": ("CSV export keeps filters", "CSV export", "idea", "An export holds exactly the rows and columns on screen."),
    "audit": ("Audit log", "Admin", "planned", "Who changed what, and when, for every record."),
    "slack": ("Slack alerts per project", "Notifications", "planned", "Each project posts to the Slack channel it picks."),
    "fields": ("Custom fields on deals", "Records", "beta", "Fields a team adds to deals, filterable and exported."),
    "offline": ("Offline mode on the phone", "Mobile", "planned", "Read and edit records on the phone with no signal."),
    "rate": ("Higher API rate limits", "Platform", "declined", "More API calls per minute per key."),
    "search": ("Faster search", "Search", "building", "Search answers in under a second on large workspaces."),
    "calendar": ("Calendar sync for bookings", "Integrations", "planned", "Bookings show in Google and Outlook calendars."),
    "roles": ("Custom roles", "Admin", "planned", "Roles a workspace defines, beyond admin and member."),
    "webhooks": ("Retry failed webhooks", "Platform", "idea", "A webhook that fails is sent again, with a log."),
    "twostep": ("Two-step sign-in for members", "Admin", "idea", "Members can turn on a second step at sign-in."),
    "dark": ("Dark mode in reports", "Reporting", "live", "Reports follow the app's dark mode."),
}
# The team's plan: horizon, days since it was set, owner, project, public title, public blurb.
PLAN = {
    "sso": ("now", 30, "Admin team", "sso", "Sign in with Okta", "Single sign-on for teams on Okta."),
    "fields": ("now", 45, "Records team", "fields", "Custom fields on deals", "In beta with a few teams now."),
    "search": ("now", 40, "Search team", "search", None, None),
    "bulk": ("next", 12, "Records team", None, "Edit many records at once", "Change one field across a filtered list, see it first, undo it."),
    "audit": ("next", 20, "Admin team", "audit", "Audit log", "Who changed what, and when."),
    "calendar": ("next", 25, "Integrations", None, None, None),
    "slack": ("later", 50, "Notifications", None, "Slack alerts per project", "Pick which projects post where."),
    "offline": ("later", 60, "Mobile", None, "Offline on the phone", "Read and edit with no signal."),
    "roles": ("later", 35, "Admin team", None, None, None),
    "dark": ("shipped", 7, "Reporting", None, "Dark mode in reports", None),
    "rate": ("none", 22, None, None, None, None),
}
# feature: [(person, source, days ago, importance, kind, quote)]
QUOTES = {
    "bulk": [
        ("nf.ops", "mail", 13, "blocker", "request", "We re-tag 300 shipments every Friday, one at a time."),
        ("nf.ops", "meeting", 8, "important", "problem", "Until we can edit in bulk, the Friday re-tag stays a spreadsheet job."),
        ("nf.admin", "form", 11, "nice", "request", "Our statuses are custom fields, so it has to work on those."),
        ("nf.dispatch", "mail", 9, "important", "problem", "Changing the carrier on a whole lane takes my afternoon."),
        ("tc.po", "slack", 2, "blocker", "request", "We can’t roll this out to the other teams without it."),
        ("tc.po", "slack", 2.1, "important", "request", "It’s the first thing the other team leads ask about."),
        ("tc.ops", "slack", 4, "important", "request", "If I could select everything in a saved view and change the owner, we’d be done."),
        ("tc.fin", "mail", 20, "nice", "problem", "Month end is a lot of clicking the same dropdown."),
        ("oh.cm", "meeting", 6, "blocker", "problem", "Moving a clinic means editing every patient record by hand."),
        ("hc.fin", "meeting", 5, "important", "request", "If I change 200 rows I need to see the list first. One mistake and it’s a day of cleanup."),
        ("hc.office", "meeting", 5.1, "important", "request", "Let me change the owner on everything in a filter."),
        ("kl.ops", "mail", 17, "important", "request", "And please let me undo it. I will get it wrong at least once."),
        ("kl.plan", "mail", 17.2, "important", "request", "Select all, change status, done. That’s all I want."),
        ("kl.plan", "mail", 16, "nice", "request", "On the phone too, please. I do this from the warehouse floor."),
        ("x.books", "form", 23, "nice", "request", "Would save me ten minutes a day."),
        ("x.consult", "form", 30, "nice", "request", "Two of my clients asked me if this exists. On the phone would be nice too."),
    ],
    "sso": [
        ("mb.sec", "meeting", 0.21, "blocker", "request", "Security won’t sign off without SSO through Okta."),
        ("mb.itd", "mail", 3, "blocker", "request", "Every new vendor goes through Okta. No exceptions."),
        ("tc.it", "slack", 6, "blocker", "request", "We can’t add another password for 80 people."),
        ("oe.proc", "mail", 9, "blocker", "request", "SSO is a hard requirement on our vendor checklist."),
        ("ps.it", "mail", 12, "blocker", "problem", "Teachers already have too many logins."),
        ("nf.it", "mail", 14, "important", "request", "Okta first, Azure AD after, if you can."),
        ("oh.cm", "meeting", 6.2, "nice", "request", "Single sign-on would help the front desk."),
        ("ld.office", "form", 20, "important", "question", "Is SSO on the roadmap? We’d move the whole practice over."),
        ("rl.it", "mail", 25, "important", "request", "We need people removed the same day they leave."),
    ],
    "csv": [
        ("cs.producer", "mail", 1, "important", "problem", "Every export loses my filters, so I rebuild them in a spreadsheet."),
        ("cs.fin", "mail", 3, "important", "problem", "I filter to one client, export, and get everyone."),
        ("hc.fin", "meeting", 5.3, "important", "request", "The export should be what’s on my screen."),
        ("hc.office", "meeting", 5.4, "nice", "request", "Keep the column order I set, too."),
        ("qr.analyst", "mail", 8, "important", "request", "We send a filtered export to each store manager every Monday."),
        ("qr.ops", "slack", 9, "nice", "problem", "The Monday export takes longer than it should."),
        ("kl.plan", "mail", 10, "nice", "request", "Export just this week’s loads."),
        ("af.partner", "mail", 12, "important", "request", "My accountant wants last quarter, not five years."),
        ("bl.data", "form", 15, "nice", "request", "Filters and sort order both, please."),
        ("ps.admin", "mail", 18, "nice", "request", "I only need one school’s rows."),
    ],
    "audit": [
        ("mb.sec", "meeting", 3, "blocker", "request", "Auditors ask who changed what. Today we can’t answer."),
        ("mb.comp", "mail", 4, "blocker", "request", "We need a change history we can export for the regulator."),
        ("rl.it", "mail", 7, "blocker", "request", "Client matters need a record of every change."),
        ("ld.office", "form", 11, "important", "request", "When a record changes I want to see who did it."),
        ("oe.proc", "mail", 13, "important", "request", "Our security review asks for an audit trail."),
        ("ps.it", "mail", 16, "nice", "question", "Do you keep a log of admin changes?"),
        ("tc.po", "slack", 19, "nice", "request", "A history tab on each record would do."),
        ("hc.office", "meeting", 21, "nice", "request", "Who deleted that row? We never know."),
        ("nf.admin", "form", 26, "important", "request", "We need to know who changed a shipment’s status."),
    ],
    "slack": [
        ("tc.ops", "slack", 6, "important", "request", "Each project should post to its own channel."),
        ("tc.po", "slack", 8, "nice", "request", "Right now everything lands in one channel and nobody reads it."),
        ("cs.producer", "mail", 10, "important", "request", "Clients want updates in their Slack, not ours."),
        ("cs.design", "mail", 12, "nice", "request", "Only the projects I follow, please."),
        ("bl.founder", "mail", 14, "nice", "request", "Mute a project’s alerts for a week."),
        ("qr.ops", "slack", 18, "nice", "request", "One channel per store would be ideal."),
    ],
    "fields": [
        ("nf.admin", "form", 9, "blocker", "request", "Our deal stages hang on a custom field. We can’t move without it."),
        ("nf.dispatch", "mail", 15, "important", "request", "Add a lane field to deals."),
        ("hc.fin", "meeting", 22, "important", "request", "We track contract type on every deal."),
        ("af.partner", "mail", 24, "nice", "request", "A field for the referring partner."),
        ("qr.analyst", "mail", 26, "important", "request", "Custom fields need to show up in the export."),
        ("kl.plan", "mail", 28, "nice", "request", "Region as a field, please."),
    ],
    "offline": [
        ("kl.drivers", "mail", 15, "important", "request", "Drivers lose signal on half the routes."),
        ("kl.plan", "mail", 16.5, "nice", "request", "Let the app save my changes until I’m back online."),
        ("nf.drivers", "mail", 18, "important", "problem", "Proof of delivery fails in the yard: no signal."),
        ("nf.dispatch", "mail", 21, "nice", "request", "Read-only offline would already help."),
        ("x.consult", "form", 33, "nice", "request", "I work on trains a lot."),
    ],
    "rate": [
        ("bl.data", "mail", 22, "important", "request", "We hit the limit during the nightly sync."),
        ("bl.founder", "mail", 24, "nice", "request", "Can we pay for a higher limit?"),
        ("qr.analyst", "mail", 27, "nice", "problem", "The report script gets throttled."),
        ("x.dev", "form", 30, "nice", "request", "600 a minute would be enough."),
    ],
    "search": [
        ("oh.cm", "meeting", 18, "important", "problem", "Search takes five seconds on our patient list."),
        ("oh.desk", "mail", 20, "important", "problem", "The front desk gives up and scrolls."),
        ("ld.office", "form", 24, "nice", "problem", "Searching by phone number is slow."),
        ("rl.it", "mail", 26, "important", "problem", "Search times out on matters older than a year."),
        ("rl.para", "mail", 27, "nice", "request", "Search inside attachments, someday."),
    ],
    "calendar": [
        ("ld.office", "form", 10, "important", "request", "Bookings should land in our Google calendar."),
        ("oh.desk", "mail", 13, "nice", "request", "Outlook, for us."),
        ("bl.founder", "mail", 17, "nice", "request", "Two-way sync would be great."),
        ("af.partner", "mail", 25, "nice", "request", "Our team lives in Outlook."),
    ],
    "roles": [
        ("mb.itd", "mail", 15, "important", "request", "We need a read-only role for auditors."),
        ("tc.it", "slack", 19, "nice", "request", "A role that can invite but not delete."),
        ("ps.it", "mail", 23, "nice", "request", "Teachers shouldn’t see billing."),
    ],
    "webhooks": [
        ("bl.data", "mail", 11, "important", "problem", "A webhook failed overnight and we never knew."),
        ("cs.producer", "mail", 14, "nice", "request", "Retry it a few times before giving up."),
        ("qr.analyst", "mail", 19, "important", "request", "Show me which deliveries failed."),
        ("mb.gh", "github", 21, "important", "request", "Webhook deliveries need retries with backoff."),
        ("x.dev", "form", 29, "nice", "request", "A replay button for failed events."),
    ],
    "twostep": [
        ("mb.itd", "mail", 9, "important", "request", "Members who aren’t on SSO need a second step."),
        ("oe.proc", "mail", 16, "important", "request", "Two-step sign-in is on our checklist too."),
        ("ps.it", "mail", 20, "nice", "request", "An authenticator app is fine."),
        ("rl.it", "mail", 28, "important", "request", "Make it something an admin can require."),
    ],
    "dark": [
        ("cs.design", "mail", 40, "nice", "request", "Reports are blinding at night."),
        ("bl.data", "mail", 44, "nice", "request", "Dark mode doesn’t reach the reports."),
        ("qr.analyst", "mail", 47, "nice", "request", "Charts in dark mode, please."),
        ("hc.fin", "meeting", 52, "nice", "request", "The report page ignores dark mode."),
    ],
}
# People who asked with no quote filed (a ticket, a form with no words): feature -> [(person, source, days ago)].
ASK_ONLY = {"bulk": [("tc.it", "mail", 3)], "sso": [("kl.ops", "mail", 4)], "csv": [("bl.founder", "mail", 6)],
            "slack": [("tc.fin", "mail", 9), ("bl.data", "mail", 15)], "fields": [("kl.ops", "mail", 30)],
            "offline": [("kl.ops", "mail", 19)], "calendar": [], "webhooks": []}
# Quotes that come in through no person: a review on a public site.
ANONYMOUS = {"csv": [("review", 7, "Exports ignore my filters. Annoying.")]}
# Asks on the feature's own linked work (a GitHub issue), from Triage.
LINKED = {"sso": ("github", "fernway/app#412", [("mb.gh", 2), ("rl.gh", 10)])}
# Who of those who asked has an ask to be told on (everyone with a handle, except these).
NO_ASK = {"bulk": {"nf.admin", "tc.fin", "x.consult"}}
# The suggested feature: quotes that fit nothing yet.
SUGGESTED = ("Recurring invoices", "Billing", [
    ("af.partner", "mail", 2, "important", "Every month I copy last month’s invoice by hand."),
    ("qr.analyst", "mail", 4, "important", "Can invoices repeat on a schedule?"),
    ("qr.ops", "slack", 5, "nice", "Stores get the same invoice every month."),
    ("hc.fin", "meeting", 5.5, "important", "We bill the same retainer to forty clinics."),
    ("hc.office", "meeting", 5.6, "nice", "Recurring invoices, please."),
    ("cs.fin", "mail", 7, "important", "Our retainers are the same amount every month."),
    ("cs.producer", "mail", 8, "nice", "Set it and forget it, for monthly clients."),
    ("kl.ops", "mail", 11, "nice", "A monthly invoice that sends itself."),
    ("kl.plan", "mail", 12, "nice", "Same invoice each month for the depot rent."),
])
# Quotes filed by the Lemma that no person has looked at yet (state new).
UNCHECKED = {("bulk", 4), ("bulk", 5), ("sso", 0), ("csv", 0)}
# Tasks in each project: (title, status, days since it last changed). The
# platform stamps a row's updated_at when it is written, so in a Lemma every
# sample task has just moved: Faster search's "no task moved in 16 days"
# shows only in the demo, whose fixtures carry these days.
PROJECTS = {
    "sso": ("SSO with Okta", [("SAML metadata endpoint", "done", 20), ("Okta app in the integration network", "done", 18),
                              ("Map Okta groups to roles", "done", 12), ("Just-in-time sign-up", "done", 9),
                              ("Sign-in page: Continue with Okta", "done", 6), ("Session length setting", "done", 3),
                              ("SCIM: create and deactivate members", "in_progress", 1), ("SCIM: group sync", "todo", 1),
                              ("Admin page: require SSO", "in_progress", 2), ("Recovery codes for admins", "todo", 5),
                              ("Docs: set up Okta", "todo", 5), ("Test with a customer's tenant", "todo", 4),
                              ("Audit events for SSO sign-ins", "todo", 4), ("Azure AD after Okta", "canceled", 8)]),
    "fields": ("Custom fields on deals", [("Field types: text, number, date, choice", "done", 30), ("Fields on the deal page", "done", 26),
                                          ("Filter by a custom field", "done", 22), ("Sort by a custom field", "done", 20),
                                          ("Custom fields in the export", "done", 17), ("Import custom fields from CSV", "done", 14),
                                          ("Required fields", "done", 12), ("Field permissions", "done", 10),
                                          ("API: read and write fields", "done", 8), ("Beta flag for five teams", "done", 6),
                                          ("Docs: custom fields", "done", 4), ("Migration for old tags", "done", 3)]),
    "search": ("Faster search", [("Index records on write", "done", 34), ("Search by phone number", "done", 28),
                                 ("Move search to the new index", "in_progress", 16), ("Typo tolerance", "todo", 16),
                                 ("Search attachments", "todo", 17), ("Rank exact matches first", "todo", 16),
                                 ("Load test on a large workspace", "todo", 18), ("Remove the old search path", "todo", 19)]),
    "audit": ("Audit log", [("Event schema", "todo", 3), ("Record changes on every write", "todo", 3), ("History tab on a record", "todo", 2),
                            ("Workspace-wide log for admins", "todo", 2), ("Export the log", "todo", 2), ("Keep 1 year", "todo", 2),
                            ("Docs: audit log", "todo", 1)]),
}
RIVAL = ("Ledgerly", "Ledgerly’s export keeps my filters. Yours should too.")


class RoadmapSampleDataInput(BaseModel):
    mode: str = "load"


class RoadmapSampleDataResult(BaseModel):
    mode: str
    features: int
    quotes: int
    asks: int
    removed: int = 0
    message: str


def _company_id(domain: str) -> str:
    return str(_uuid.uuid5(COMPANY_NS, "company:" + domain))


def _quote_key(text: str) -> str:
    return hashlib.sha1(" ".join(text.lower().split()).encode()).hexdigest()[:16]


def _at(days: float) -> str:
    return (_datetime.now(_tz.utc) - _timedelta(days=days)).replace(microsecond=0).isoformat()


def build(me: str | None, today, product_id: str | None = None) -> dict:
    """Every row of the sample, by table. The features hang on the team's own
    product when it has one, else on a made-up one (Fernway)."""
    out: dict = {t: [] for t in ("product", "company", "company_domain", "deal", "feature", "feedback", "ask",
                                 "project", "task", "roadmap_item")}
    if not product_id:
        product_id = rid("sample", "product")
        out["product"].append({"id": product_id, "name": "Fernway", "role": "ours", "active": True, "source": "roadmap-sample"})
    rival_id = rid("sample", "rival")
    out["product"].append({"id": rival_id, "name": RIVAL[0], "role": "rival", "active": True, "source": "roadmap-sample"})
    cid = {k: _company_id(d) for k, (_n, d) in COMPANIES.items()}
    for k, (name, domain) in COMPANIES.items():
        out["company"].append({"id": cid[k], "name": name, "domain": domain, "name_from": "person",
                               "description": "A made-up company in Roadmap's sample."})
        out["company_domain"].append({"id": str(_uuid.uuid5(COMPANY_NS, domain)), "company_id": cid[k], "domain": domain})
    for n, (k, status, amount, cur, stage, name) in enumerate(DEALS):
        out["deal"].append({"id": rid("sample", "deal", n), "name": name, "company_id": cid[k], "company_name": COMPANIES[k][0],
                            "company_domain": COMPANIES[k][1], "people": [], "owner_user_id": me, "stage": stage,
                            "status": status, "amount": float(amount), "currency": cur, "source": "roadmap-sample",
                            "close_date": (today + _timedelta(days=30 + 7 * n)).isoformat() if status == "open" else
                            (today - _timedelta(days=40 + 9 * n)).isoformat(),
                            "closed_at": _at(40 + 9 * n) if status != "open" else None})
    fid = {k: rid("sample", "feature", k) for k in list(FEATURES) + ["suggested"]}
    area_id = {a: rid("sample", "area", a) for a in AREAS + ["CSV export"]}
    for a in AREAS:
        out["feature"].append({"id": area_id[a], "product_id": product_id, "name": a, "state": "active", "origin": "team",
                               "stage": "live", "source": "roadmap-sample"})
    out["feature"].append({"id": area_id["CSV export"], "product_id": product_id, "name": "CSV export", "parent_id": area_id["Reporting"],
                           "state": "active", "origin": "team", "stage": "live", "source": "roadmap-sample"})
    for k, (name, area, stage, desc) in FEATURES.items():
        row = {"id": fid[k], "product_id": product_id, "name": name, "description": desc, "parent_id": area_id[area],
               "state": "active", "origin": "team", "stage": stage, "stage_at": _at((PLAN.get(k) or (None, 40))[1]),
               "source": "roadmap-sample"}
        if k in LINKED:
            row.update(work_source=LINKED[k][0], work_id=LINKED[k][1], work_url=f"https://github.com/{LINKED[k][1].replace('#', '/issues/')}")
        out["feature"].append(row)
    sname, sarea, squotes = SUGGESTED
    out["feature"].append({"id": fid["suggested"], "product_id": product_id, "name": sname, "parent_id": area_id[sarea],
                           "state": "suggested", "origin": "lemma", "stage": "idea", "source": "roadmap-sample"})

    def heard(feature_key, n, person, source, days, importance, kind, text, state="processed", product=None, public=False):
        company, role, hkind, handle = PEOPLE[person] if person else (None, None, None, None)
        thread = f"sample-{source}-{feature_key}-{n}"
        return {"id": str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{thread}|{_quote_key(text)}")), "quote": text,
                "product_id": product or product_id, "feature_id": fid[feature_key], "filed_by": "lemma", "kind": kind,
                "sentiment": "negative" if kind == "problem" else "neutral", "importance": importance,
                "handle_kind": hkind, "handle": handle, "name": role, "company_id": cid.get(company) if company else None,
                "company_name": COMPANIES[company][0] if company else None, "source": source, "source_id": thread,
                "heard_by": me if source in ("mail", "meeting", "slack") else None, "is_public": public,
                "authenticity": "organic" if public else "unknown", "said_at": _at(days), "state": state, "plugin": "roadmap"}

    def ask(feature_key, person, source, days, work=None, state=None):
        company, role, hkind, handle = PEOPLE[person]
        ws, wid = work or ("feature", fid[feature_key])
        thread = f"sample-{source}-{feature_key}-{person}"
        st = state or ("shipped" if feature_key == "dark" else "declined" if feature_key == "rate" else "open")
        return {"id": str(_uuid.uuid5(ASK_NS, f"{hkind}:{handle}|{source}:{thread}|{ws}:{wid}")), "work_source": ws,
                "work_id": wid, "work_title": FEATURES[feature_key][0], "handle_kind": hkind, "handle": handle, "name": role,
                "company_id": cid.get(company) if company else None, "company_name": COMPANIES[company][0] if company else None,
                "source": source, "source_id": thread, "heard_by": me if source in ("mail", "meeting", "slack") else None,
                "asked_at": _at(days), "state": st, "plugin": "roadmap",
                "shipped_at": _at(7) if st == "shipped" else None, "shipped_in": "v3.4" if st == "shipped" else None}

    for k, quotes in QUOTES.items():
        asked: dict = {}
        for n, (person, source, days, importance, kind, text) in enumerate(quotes):
            out["feedback"].append(heard(k, n, person, source, days, importance, kind, text,
                                         state="new" if (k, n) in UNCHECKED else "processed"))
            if kind in ("request", "problem", "question") and person not in (NO_ASK.get(k) or set()) and person not in asked:
                asked[person] = (source, days)
        for person, (source, days) in asked.items():
            out["ask"].append(ask(k, person, source, days))
        for person, source, days in ASK_ONLY.get(k, []):
            out["ask"].append(ask(k, person, source, days))
    for k, extra in ANONYMOUS.items():
        for n, (source, days, text) in enumerate(extra):
            out["feedback"].append(heard(k, 100 + n, None, source, days, "nice", "problem", text, public=True))
    out["feedback"].append(heard("csv", 200, "bl.data", "web", 9, "unknown", "praise", RIVAL[1], product=rival_id, public=True))
    for k, (ws, wid, who) in LINKED.items():
        for person, days in who:
            out["ask"].append(ask(k, person, "github", days, work=(ws, wid)))
    for n, (person, source, days, importance, text) in enumerate(squotes):
        out["feedback"].append(heard("suggested", n, person, source, days, importance, "request", text, state="new"))
    for k, (title, tasks) in PROJECTS.items():
        pid = rid("project", fid[k])
        out["project"].append({"id": pid, "name": title, "state": "active", "source": "roadmap", "source_id": fid[k],
                               "description": f"From the roadmap. {FEATURES[k][3]}", "lead_user_id": me})
        for n, (t, status, days) in enumerate(tasks):
            out["task"].append({"id": rid("sample", "task", k, n), "title": t, "status": status, "project_id": pid,
                                "priority": "medium", "source": "tasks", "owner_user_id": me,
                                "done_at": _at(days) if status == "done" else None})
    for k, (horizon, days, owner, project, ptitle, pblurb) in PLAN.items():
        out["roadmap_item"].append({"id": fid[k], "horizon": horizon, "horizon_at": _at(days), "horizon_by": me,
                                    "owner_label": owner, "project_id": rid("project", fid[k]) if project else None,
                                    "public": bool(ptitle), "public_title": ptitle, "public_blurb": pblurb,
                                    "shipped_on": (today - _timedelta(days=days)).isoformat() if horizon == "shipped" else None})
    return out


def roadmap_sample_data(ctx: FunctionContext, data: RoadmapSampleDataInput) -> RoadmapSampleDataResult:
    if data.mode == "clear":
        return _clear(ctx)
    pod = ctx.pod
    if q(pod, "SELECT id FROM roadmap_sample_row LIMIT 1"):
        return RoadmapSampleDataResult(mode="load", features=0, quotes=0, asks=0, message="The sample is already here.")
    s = settings_of(pod)
    me = str(ctx.user_id) if ctx.user_id else None
    ours = s.get("product_id") or (q(pod, "SELECT id FROM product WHERE role = 'ours' ORDER BY created_at LIMIT 1") or [{}])[0].get("id")
    built = build(me, today_in(s["timezone"]), ours)
    have_company = {r["id"] for r in q(pod, f"SELECT id FROM company WHERE id IN ({lits([c['id'] for c in built['company']])})")}
    have_domain = {r["id"] for r in q(pod, f"SELECT id FROM company_domain WHERE id IN ({lits([c['id'] for c in built['company_domain']])})")}
    built["company"] = [c for c in built["company"] if c["id"] not in have_company]
    built["company_domain"] = [c for c in built["company_domain"] if c["id"] not in have_domain]
    marks = []
    for table in ("product", "company", "company_domain", "deal", "feature", "feedback", "ask", "project", "task", "roadmap_item"):
        got = built[table]
        for start in range(0, len(got), 100):
            chunk = got[start:start + 100]
            pod.records.bulk_create(table, chunk, upsert=True)
        marks += [{"id": rid("mark", table, r["id"]), "table_name": table, "row_id": r["id"]} for r in got]
    for start in range(0, len(marks), 200):
        pod.records.bulk_create("roadmap_sample_row", marks[start:start + 200], upsert=True)
    old = settings_of(pod)
    if old.get("id"):
        made = next((p for p in built["product"] if p["role"] == "ours"), None)
        pod.records.update("roadmap_settings", old["id"], dict(
            {"sample": True}, **({"product_id": made["id"], "product_label": made["name"]} if made else {})))
    publish(pod, settings_of(pod))  # the sample's public items, when the outside page is on
    n_features = len(FEATURES)
    return RoadmapSampleDataResult(mode="load", features=n_features, quotes=len(built["feedback"]), asks=len(built["ask"]),
                                   message=f"Loaded a sample roadmap: {n_features} features, {len(built['feedback'])} quotes from "
                                           f"{len(COMPANIES)} made-up companies, {len(built['ask'])} asks and {len(PROJECTS)} projects.")


def _clear(ctx) -> RoadmapSampleDataResult:
    pod = ctx.pod
    marks = q_all(pod, "SELECT id, table_name, row_id FROM roadmap_sample_row ORDER BY id")
    if not marks:
        return RoadmapSampleDataResult(mode="clear", features=0, quotes=0, asks=0, message="No sample to clear.")
    by: dict = {}
    for m in marks:
        by.setdefault(m["table_name"], []).append(m["row_id"])
    features = by.get("feature") or []
    removed = 0

    def gone(table, ids):
        """Delete these rows of a table, the ones still there: a bulk delete
        is all or nothing, and refuses an id that matches no row."""
        nonlocal removed
        ids = list(dict.fromkeys(i for i in ids if i))
        for start in range(0, len(ids), 100):
            here = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE id IN ({lits(ids[start:start + 100])})")]
            if here:
                pod.records.bulk_delete(table, here)
                removed += len(here)

    # What was made for the sample's features since: specs and their Pages, outside-page lines, projects and their tasks.
    specs = q_all(pod, f"SELECT id, path FROM roadmap_spec WHERE id IN ({lits(features)}) ORDER BY id") if features else []
    for sp in specs:
        if sp.get("path"):
            try:
                pod.files.delete(sp["path"])
            except Exception:  # noqa: BLE001 — already gone
                pass
    gone("roadmap_spec", [sp["id"] for sp in specs])
    gone("roadmap_public", [r["id"] for r in q_all(pod, f"SELECT id FROM roadmap_public WHERE id IN ({lits(features)}) ORDER BY id")]
         if features else [])
    projects = set(by.get("project") or []) | {r["id"] for r in q_all(
        pod, f"SELECT id FROM project WHERE source = 'roadmap' AND source_id IN ({lits(features)}) ORDER BY id")} if features else set()
    if projects:
        gone("task", (by.get("task") or []) + [r["id"] for r in q_all(
            pod, f"SELECT id FROM task WHERE project_id IN ({lits(sorted(projects))}) ORDER BY id")])
    gone("roadmap_item", (by.get("roadmap_item") or []) + features)
    for table in ("ask", "feedback", "project", "deal", "feature", "company_domain", "company", "product"):
        gone(table, sorted(projects) if table == "project" else by.get(table) or [])
    gone("roadmap_sample_row", [m["id"] for m in marks])
    s = settings_of(pod)
    if s.get("id"):
        mine = s.get("product_id") in set(by.get("product") or [])
        pod.records.update("roadmap_settings", s["id"], dict(
            {"sample": False}, **({"product_id": None, "product_label": None} if mine else {})))
    if ctx.user_id and features:
        needs_you_write(pod, "roadmap", str(ctx.user_id), [], f"source_id IN ({lits(features)})")
    return RoadmapSampleDataResult(mode="clear", features=len(features), quotes=len(by.get("feedback") or []),
                                   asks=len(by.get("ask") or []), removed=removed,
                                   message="Cleared the sample. Your own features, quotes and deals are as they were.")
