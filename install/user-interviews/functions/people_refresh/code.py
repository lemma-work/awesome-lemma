#input_type_name: PeopleRefreshInput
#output_type_name: PeopleRefreshResult
#function_name: people_refresh

"""Who the owner deals with, and where they stand with each, counted from
their own conversations and meetings. No model: the read of each new person
(someone or noise, and what they are) is `people_sort`.

Who is in it: anyone in a conversation with people (never a broadcast) whose
category the owner counted at set-up (or one Mail has not placed yet), or on a
meeting with someone from outside, minus the owner's own addresses and
domains. Each is the shared `person` found by handle, made the way Mail makes
one when it is missing, so a person in the mail and on a meeting is one row.

For each, from every message either way and every meeting held:

    last contact    the newest message in or out, or meeting held
    usual gap       contact days more than three days apart start a new
                    "episode"; the gap is the median between episodes
    warmth          the days since the last contact against that gap
                    (no gap yet counts as two weeks): warm within 1.5 gaps
                    (at least 7 days), cooling within 3 (at least 21), cold
                    beyond; new with no contact yet and a meeting ahead
    gone quiet      someone the owner deals with (not a colleague), cooling or
                    cold, both sides spoke (or met), no meeting ahead, no
                    reply owed by the owner
    next meeting    the next one they are on

Then companies: every domain of someone the owner deals with (never free
webmail, never the owner's own, never a colleague's or an "other": friends,
family and strangers stay the owner's own) is a shared `company_domain`, team-wide, found
by its id; a new domain whose name matches a company the team already has
(acme.com and acme.co.uk) joins it, otherwise it makes a company.

Then the team view (`people_link`): one row per person the owner deals with,
written as the owner and only ever the owner's own rows, holding only the
person, company, last contact and warmth; the owner's rows for anyone they no
longer deal with go, and so does a company nobody's people point to any more.

First it tidies: People map's own rows for a person or a company that no
longer exists (Mail's sample clear removes the people it made and cannot see
plugins' own tables) are removed, never the shared rows, and never in a way
that holds up whoever removed them.

Writes only what changed, so it can run every hour and on every open.
"""

from __future__ import annotations

import statistics
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PERSON_NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")   # Mail's, so ids match
COMPANY_NS = uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")  # the contract's
LINK_NS = uuid.UUID("eb4518c8-84e0-4a47-94f1-4b999aa61771")
FREEMAIL = {
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "yahoo.com", "yahoo.co.in",
    "ymail.com", "icloud.com", "live.com", "msn.com", "me.com", "mac.com", "proton.me", "protonmail.com",
    "aol.com", "gmx.com", "gmx.de", "mail.com", "yandex.com", "rediffmail.com", "outlook.in", "zohomail.com",
    "fastmail.com", "hey.com",
    # The samples' stand-in for webmail: Mail's and Meetings' made-up people
    # with personal addresses write from it.
    "mailbox.example",
}
NEVER_COUNTED = {"updates", "newsletters", "cold"}
EPISODE_DAYS = 3
DEFAULT_GAP = 14.0


class PeopleRefreshInput(BaseModel):
    # Ignored; lets a workflow LOOP or a second step call it.
    run_pass: int | None = None


class PeopleRefreshResult(BaseModel):
    people: int
    created: int
    updated: int
    out_of_scope: int
    unsorted: int
    passes: list[int]
    dealt_with: int
    quiet: int
    companies_created: int
    domains_added: int
    links_written: int
    tidied: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _parse(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _domain(handle: str) -> str:
    return handle.rsplit("@", 1)[-1].lower().removeprefix("www.") if "@" in handle else ""


def _label(domain: str) -> str:
    """The name part of a domain: northwind-foods.co.uk -> northwind-foods."""
    parts = domain.split(".")
    if len(parts) >= 3 and parts[-2] in {"co", "com", "org", "net", "ac", "gov", "or", "ne"}:
        return parts[-3]
    return parts[-2] if len(parts) >= 2 else domain


def _company_name(domain: str) -> str:
    words = _label(domain).replace("-", " ").replace("_", " ").split()
    return " ".join(w[:1].upper() + w[1:] for w in words) or domain


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, str) and isinstance(b, str) and ("T" in a or "T" in b):
        pa, pb = _parse(a), _parse(b)
        if pa and pb:
            return abs((pa - pb).total_seconds()) < 1
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool):
        return abs(float(a) - float(b)) < 1e-6
    return (a if a != "" else None) == (b if b != "" else None)


ORPHANS = (
    ("people_person", "SELECT pp.id FROM people_person pp LEFT JOIN person p ON p.id = pp.id WHERE p.id IS NULL"),
    ("people_fact", "SELECT f.id FROM people_fact f LEFT JOIN person p ON p.id = f.person_id WHERE p.id IS NULL"),
    ("people_correction", "SELECT c.id FROM people_correction c LEFT JOIN person p ON p.id = c.person_id WHERE p.id IS NULL"),
    ("people_sample_contact", "SELECT s.id FROM people_sample_contact s LEFT JOIN person p ON p.id = s.person_id WHERE p.id IS NULL"),
    ("people_company", "SELECT pc.id FROM people_company pc LEFT JOIN company c ON c.id = pc.id WHERE c.id IS NULL"),
)


def tidy(pod: Any) -> int:
    """Remove People map's own rows whose person or company is gone. Mail's
    sample clear removes the people it made and cannot see plugins' tables."""
    removed = 0
    for table, sql in ORPHANS:
        ids = [r["id"] for r in _rows(pod.query(sql + " LIMIT 5000"))]
        for i in range(0, len(ids), 200):
            removed += pod.records.bulk_delete(table, ids[i : i + 200]) or 0
    return removed


def tidy_companies(pod: Any) -> int:
    """Remove companies nobody's people point to any more: no member's team
    row and none of this person's people, and no notes anyone wrote (a company
    with notes stays). A member who does not share with the team keeps theirs
    by their own refresh, which makes it again."""
    rows = _rows(pod.query(
        "SELECT c.id FROM company c LEFT JOIN people_company pc ON pc.id = c.id "
        "WHERE NOT EXISTS (SELECT 1 FROM people_link l WHERE l.company_id = c.id) "
        "AND NOT EXISTS (SELECT 1 FROM people_person pp WHERE pp.company_id = c.id AND pp.in_scope IS TRUE) "
        "AND (pc.notes IS NULL OR pc.notes = '') LIMIT 2000"))
    ids = [r["id"] for r in rows]
    if not ids:
        return 0
    for i in range(0, len(ids), 200):
        chunk = ids[i : i + 200]
        domain_ids = [r["id"] for r in _rows(pod.query(f"SELECT id FROM company_domain WHERE company_id IN ({_in(chunk)})"))]
        for j in range(0, len(domain_ids), 200):
            pod.records.bulk_delete("company_domain", domain_ids[j : j + 200])
        held = [r["id"] for r in _rows(pod.query(f"SELECT id FROM people_company WHERE id IN ({_in(chunk)})"))]
        if held:
            pod.records.bulk_delete("people_company", held)
        pod.records.bulk_delete("company", chunk)
    return len(ids)


def warmth_of(last: datetime | None, gap: float | None, now: datetime, ahead: bool) -> str | None:
    if not last:
        return "new" if ahead else None
    days = (now - last).total_seconds() / 86400
    g = gap or DEFAULT_GAP
    if days <= max(7.0, 1.5 * g):
        return "warm"
    if days <= max(21.0, 3.0 * g):
        return "cooling"
    return "cold"


def episodes_of(days: list[datetime]) -> tuple[int, float | None]:
    """Contact days -> (episodes, the median gap between their starts)."""
    if not days:
        return 0, None
    days = sorted(days)
    starts = [days[0]]
    previous = days[0]
    for d in days[1:]:
        if (d - previous).days > EPISODE_DAYS:
            starts.append(d)
        previous = d
    if len(starts) < 2:
        return len(starts), None
    gaps = [(b - a).total_seconds() / 86400 for a, b in zip(starts, starts[1:])]
    return len(starts), round(max(1.0, statistics.median(gaps)), 1)


def people_refresh(ctx: FunctionContext, data: PeopleRefreshInput) -> PeopleRefreshResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    me_id = str(ctx.user_id)
    tidied = tidy(pod)

    settings = (_rows(pod.query(
        "SELECT id, display_name, categories, own_domains, share_with_team FROM people_settings "
        "ORDER BY created_at LIMIT 1")) or [{}])[0]
    mine = {(r.get("email") or "").lower() for r in _rows(pod.query("SELECT email FROM mail_mailbox"))}
    mine |= {(r.get("email") or "").lower() for r in _rows(pod.query("SELECT email FROM meetings_calendar"))}
    mine |= {(ctx.user_email or "").lower()}
    mine.discard("")
    own = {d.lower() for d in (settings.get("own_domains") or []) if isinstance(d, str)}
    if settings.get("own_domains") is None:
        own |= {_domain(h) for h in mine if _domain(h) not in FREEMAIL}
    if settings.get("categories") is None:
        counted = [r["key"] for r in _rows(pod.query("SELECT key FROM mail_category WHERE state = 'active'"))
                   if r["key"] not in NEVER_COUNTED]
    else:
        counted = [str(k) for k in settings.get("categories") or []]
    me_name = settings.get("display_name") or (_rows(pod.query(
        "SELECT display_name FROM mail_settings LIMIT 1")) or [{}])[0].get("display_name") or (ctx.user_email or "")

    def outside(handle: str) -> bool:
        return bool(handle) and "@" in handle and handle not in mine and _domain(handle) not in own

    # --- the owner's conversations with people, by handle and day ------------------------
    where = "c.kind = 'people' AND (c.category IS NULL" + (f" OR c.category IN ({_in(counted)}))" if counted else ")")
    inbound = _rows(pod.query(
        "SELECT LOWER(m.from_handle) AS handle, MAX(m.from_name) AS name, date_trunc('day', m.sent_at) AS day, "
        "COUNT(*) AS n, MAX(m.sent_at) AS last "
        f"FROM message m JOIN conversation c ON c.id = m.conversation_id WHERE m.direction = 'inbound' AND {where} "
        "AND m.from_handle IS NOT NULL GROUP BY 1, 3 LIMIT 20000"))
    outbound = _rows(pod.query(
        "SELECT LOWER(r.value) AS handle, date_trunc('day', m.sent_at) AS day, COUNT(*) AS n, MAX(m.sent_at) AS last "
        "FROM message m JOIN conversation c ON c.id = m.conversation_id, "
        "jsonb_array_elements_text(COALESCE(m.to_handles, '[]')::jsonb) AS r(value) "
        f"WHERE m.direction = 'outbound' AND {where} GROUP BY 1, 2 LIMIT 20000"))
    conversations = _rows(pod.query(
        "SELECT LOWER(h.value) AS handle, COUNT(DISTINCT c.id) AS n FROM conversation c, "
        "jsonb_array_elements_text(COALESCE(c.participants, '[]')::jsonb) AS h(value) "
        f"WHERE {where} GROUP BY 1 LIMIT 20000"))
    owed_reply = {(r.get("handle") or "").lower() for r in _rows(pod.query(
        "SELECT counterpart_handle AS handle FROM conversation "
        "WHERE kind = 'people' AND state = 'needs_reply' LIMIT 2000"))}
    # Meetings with someone from outside, a year back and two months ahead.
    meetings = _rows(pod.query(
        "SELECT id, start_at, attendees FROM meeting WHERE status <> 'cancelled' AND outside IS TRUE "
        f"AND start_at > {_sql((now - timedelta(days=400)).isoformat())} "
        f"AND start_at < {_sql((now + timedelta(days=62)).isoformat())} ORDER BY start_at LIMIT 3000"))

    stats: dict[str, dict] = {}

    def entry(handle: str) -> dict:
        return stats.setdefault(handle, {"days": set(), "in": None, "out": None, "met": None, "next": None,
                                         "next_id": None, "met_n": 0, "conv": 0, "name": None})

    for r in inbound:
        h = r.get("handle") or ""
        if not outside(h):
            continue
        e = entry(h)
        day, last = _parse(r.get("day")), _parse(r.get("last"))
        if day:
            e["days"].add(day)
        if last and (not e["in"] or last > e["in"]):
            e["in"] = last
        e["name"] = e["name"] or r.get("name")
    for r in outbound:
        h = r.get("handle") or ""
        if not outside(h):
            continue
        e = entry(h)
        day, last = _parse(r.get("day")), _parse(r.get("last"))
        if day:
            e["days"].add(day)
        if last and (not e["out"] or last > e["out"]):
            e["out"] = last
    for r in conversations:
        h = r.get("handle") or ""
        if h in stats:
            stats[h]["conv"] = int(r.get("n") or 0)
    for m in meetings:
        start = _parse(m.get("start_at"))
        if not start:
            continue
        for a in m.get("attendees") or []:
            if not isinstance(a, dict) or not a.get("outside"):
                continue
            h = (a.get("handle") or "").lower()
            if not outside(h):
                continue
            e = entry(h)
            e["name"] = e["name"] or a.get("name")
            if start <= now:
                e["met_n"] += 1
                e["days"].add(start.replace(hour=0, minute=0, second=0, microsecond=0))
                if not e["met"] or start > e["met"]:
                    e["met"] = start
            elif not e["next"] or start < e["next"]:
                e["next"], e["next_id"] = start, m["id"]

    # Made-up earlier contact (people_sample_data), counted like the real kind.
    for r in _rows(pod.query("SELECT handle, at, direction FROM people_sample_contact LIMIT 5000")):
        h, at = (r.get("handle") or "").lower(), _parse(r.get("at"))
        if not at or not outside(h):
            continue
        e = entry(h)
        e["days"].add(at.replace(hour=0, minute=0, second=0, microsecond=0))
        field = {"inbound": "in", "outbound": "out", "meeting": "met"}[r["direction"]]
        if not e[field] or at > e[field]:
            e[field] = at
        e["met_n"] += int(r["direction"] == "meeting")

    # --- handles -> shared people (made the way Mail makes them) --------------------------
    known: dict[str, dict] = {}
    handles = sorted(stats)
    for i in range(0, len(handles), 300):
        for r in _rows(pod.query(
                "SELECT h.handle, h.person_id, p.name, p.org, p.title FROM person_handle h JOIN person p ON p.id = h.person_id "
                f"WHERE h.kind = 'email' AND h.handle IN ({_in(handles[i : i + 300])})")):
            known.setdefault(r["handle"], r)
    existing_ids = set()
    missing = [h for h in handles if h not in known]
    ids = {h: str(uuid.uuid5(PERSON_NS, f"{ctx.user_id}:email:{h}")) for h in missing}
    for i in range(0, len(missing), 300):
        existing_ids |= {r["id"] for r in _rows(pod.query(
            f"SELECT id FROM person WHERE id IN ({_in([ids[h] for h in missing[i : i + 300]])})"))}
    new_people, new_handles = [], []
    for h in missing:
        pid, s = ids[h], stats[h]
        name = (str(s.get("name") or "").strip()[:200]) or None
        if pid not in existing_ids:
            org = None if _domain(h) in FREEMAIL else _company_name(_domain(h))
            new_people.append({"id": pid, "name": name, "org": org, "title": None, "is_vip": False})
            existing_ids.add(pid)
        new_handles.append({"id": str(uuid.uuid5(PERSON_NS, f"{pid}:email:{h}")), "person_id": pid, "kind": "email",
                            "handle": h, "display_name": name})
        known[h] = {"handle": h, "person_id": pid, "name": name, "org": None, "title": None}
    for i in range(0, len(new_people), 100):
        pod.records.bulk_create("person", new_people[i : i + 100], upsert=True)
    for i in range(0, len(new_handles), 100):
        pod.records.bulk_create("person_handle", new_handles[i : i + 100], upsert=True)

    # One person may have several addresses: their numbers are over all of them.
    per: dict[str, dict] = {}
    for h, s in stats.items():
        pid = known[h]["person_id"]
        p = per.setdefault(pid, {"handles": [], "days": set(), "in": None, "out": None, "met": None, "next": None,
                                 "next_id": None, "met_n": 0, "conv": 0, "person": known[h]})
        p["handles"].append(h)
        p["days"] |= s["days"]
        for field in ("in", "out", "met"):
            values = [v for v in (p[field], s[field]) if v]
            p[field] = max(values) if values else None
        if s["next"] and (not p["next"] or s["next"] < p["next"]):
            p["next"], p["next_id"] = s["next"], s["next_id"]
        p["met_n"] += s["met_n"]
        p["conv"] += s["conv"]

    # --- people_person: write what changed ------------------------------------------------------
    current = {r["id"]: r for r in _rows(pod.query("SELECT * FROM people_person LIMIT 20000"))}
    creates, updates = [], []
    quiet_count = 0
    for pid, p in per.items():
        touches = [(p["in"], "inbound"), (p["out"], "outbound"), (p["met"], "meeting")]
        touches = [(d, k) for d, k in touches if d]
        last, last_dir = max(touches, key=lambda t: t[0]) if touches else (None, None)
        episodes, gap = episodes_of(sorted(p["days"]))
        warmth = warmth_of(last, gap, now, bool(p["next"]))
        two_way = bool(p["met"]) or (bool(p["in"]) and bool(p["out"]))
        waiting = any(h in owed_reply for h in p["handles"])
        old = current.get(pid)
        # Only someone the owner deals with (not a colleague) can go quiet, so
        # Today and the list read `quiet` as it is.
        dealt_now = (old or {}).get("deal_with") is True and (old or {}).get("kind") != "colleague"
        quiet = warmth in ("cooling", "cold") and two_way and not p["next"] and not waiting and dealt_now
        handle = sorted(p["handles"], key=lambda h: (_domain(h) in FREEMAIL, h))[0]
        row = {
            "handle": handle, "domain": _domain(handle), "in_scope": True,
            "first_contact_at": _iso(min(p["days"])) if p["days"] else None,
            "last_contact_at": _iso(last), "last_contact_dir": last_dir,
            "last_inbound_at": _iso(p["in"]), "last_outbound_at": _iso(p["out"]), "last_met_at": _iso(p["met"]),
            "conversation_count": p["conv"], "meeting_count": p["met_n"], "episodes": episodes,
            "usual_gap_days": gap, "warmth": warmth, "quiet": quiet,
            "quiet_days": int((now - last).total_seconds() // 86400) if quiet and last else None,
            "waiting_on_me": waiting, "next_meeting_at": _iso(p["next"]), "next_meeting_id": p["next_id"],
        }
        if old is None:
            creates.append({"id": pid, **row, "summary_state": "none", "refreshed_at": now.isoformat()})
        else:
            patch = {k: v for k, v in row.items() if not _same(old.get(k), v)}
            if patch:
                updates.append({"id": pid, **patch, "refreshed_at": now.isoformat()})
        quiet_count += int(quiet)
    # Out of the counted categories and meetings now: leave the list, keep
    # what was read (a person the owner added stays).
    gone = 0
    for pid, old in current.items():
        if pid in per or not old.get("in_scope"):
            continue
        if old.get("sorted_by") == "person" and old.get("deal_with") is True:
            continue
        updates.append({"id": pid, "in_scope": False, "quiet": False, "refreshed_at": now.isoformat()})
        gone += 1
    for i in range(0, len(creates), 100):
        pod.records.bulk_create("people_person", creates[i : i + 100], upsert=True)
    for i in range(0, len(updates), 100):
        pod.records.bulk_update("people_person", updates[i : i + 100])

    # --- companies (team-wide) ----------------------------------------------------------------
    rows = _rows(pod.query(
        "SELECT pp.id, pp.handle, pp.domain, pp.company_id, pp.kind, pp.last_contact_at, pp.warmth, p.name, p.org, p.title "
        "FROM people_person pp JOIN person p ON p.id = pp.id "
        "WHERE pp.in_scope IS TRUE AND pp.deal_with IS TRUE LIMIT 20000"))
    # Colleagues are not contacts; "other" (friends and family, press, a
    # stranger) stays the owner's own: no company, not in the team's view.
    dealt = [r for r in rows if r.get("kind") not in ("colleague", "other")]
    domains = sorted({r["domain"] for r in dealt if r.get("domain") and r["domain"] not in FREEMAIL and r["domain"] not in own})
    company_of: dict[str, str] = {}
    for i in range(0, len(domains), 300):
        for r in _rows(pod.query(
                f"SELECT domain, company_id FROM company_domain WHERE domain IN ({_in(domains[i : i + 300])})")):
            company_of[r["domain"]] = r["company_id"]
    new_companies, new_domains = [], []
    if any(d not in company_of for d in domains):
        by_label: dict[str, str] = {}
        for r in _rows(pod.query("SELECT domain, company_id FROM company_domain LIMIT 50000")):
            by_label.setdefault(_label(r["domain"]), r["company_id"])
        org_for = {}
        for r in dealt:
            if r.get("domain") and r.get("org") and r["domain"] not in org_for:
                org_for[r["domain"]] = r["org"]
        for d in domains:
            if d in company_of:
                continue
            cid = by_label.get(_label(d))
            if not cid:
                cid = str(uuid.uuid5(COMPANY_NS, f"company:{d}"))
                guess = _company_name(d)
                org = (org_for.get(d) or "").strip()
                new_companies.append({"id": cid, "name": (org or guess)[:200], "domain": d,
                                      "name_from": "domain"})
                by_label[_label(d)] = cid
            new_domains.append({"id": str(uuid.uuid5(COMPANY_NS, d)), "company_id": cid, "domain": d})
            company_of[d] = cid
    for i in range(0, len(new_companies), 100):
        pod.records.bulk_create("company", new_companies[i : i + 100], upsert=True)
    for i in range(0, len(new_domains), 100):
        pod.records.bulk_create("company_domain", new_domains[i : i + 100], upsert=True)
    company_patches = []
    for r in rows:
        want = company_of.get(r.get("domain") or "") if r.get("kind") not in ("colleague", "other") else None
        if not _same(r.get("company_id"), want):
            company_patches.append({"id": r["id"], "company_id": want})
            r["company_id"] = want
    for i in range(0, len(company_patches), 100):
        pod.records.bulk_update("people_person", company_patches[i : i + 100])

    # --- the team view: this member's own rows only --------------------------------------------
    share = settings.get("share_with_team") is not False
    links = {r["id"]: r for r in _rows(pod.query(
        f"SELECT * FROM people_link WHERE member_id = {_sql(me_id)} LIMIT 20000"))}
    link_creates, link_updates, keep = [], [], set()
    if share:
        for r in dealt:
            lid = str(uuid.uuid5(LINK_NS, f"{me_id}:{r['handle']}"))
            keep.add(lid)
            values = {"member_id": me_id, "member_name": (me_name or "")[:200] or None, "handle": r["handle"],
                      "name": r.get("name"), "title": r.get("title"), "company_id": r.get("company_id"),
                      "last_contact_at": r.get("last_contact_at"), "warmth": r.get("warmth")}
            old = links.get(lid)
            if old is None:
                link_creates.append({"id": lid, **values, "refreshed_at": now.isoformat()})
            else:
                patch = {k: v for k, v in values.items() if not _same(old.get(k), v)}
                if patch:
                    link_updates.append({"id": lid, **patch, "refreshed_at": now.isoformat()})
    stale = [lid for lid in links if lid not in keep]
    for i in range(0, len(link_creates), 100):
        pod.records.bulk_create("people_link", link_creates[i : i + 100], upsert=True)
    for i in range(0, len(link_updates), 100):
        pod.records.bulk_update("people_link", link_updates[i : i + 100])
    for i in range(0, len(stale), 200):
        pod.records.bulk_delete("people_link", stale[i : i + 200])
    tidied += tidy_companies(pod)

    if settings.get("id"):
        pod.table("people_settings").update(settings["id"], {"refreshed_at": now.isoformat()})
    unsorted = int((_rows(pod.query(
        "SELECT COUNT(*) AS n FROM people_person WHERE in_scope IS TRUE AND sorted_at IS NULL")) or [{}])[0].get("n") or 0)
    passes = list(range(1, max(1, -(-unsorted // 60)) + 1))
    parts = [f"{len(per)} people in your conversations and meetings"]
    if creates:
        parts.append(f"{len(creates)} new")
    if unsorted:
        parts.append(f"{unsorted} to read")
    if quiet_count:
        parts.append(f"{quiet_count} gone quiet")
    return PeopleRefreshResult(
        people=len(per), created=len(creates), updated=len(updates), out_of_scope=gone, unsorted=unsorted,
        passes=passes, dealt_with=len(dealt), quiet=quiet_count, companies_created=len(new_companies),
        domains_added=len(new_domains), links_written=len(link_creates) + len(link_updates) + len(stale), tidied=tidied,
        message=", ".join(parts))
