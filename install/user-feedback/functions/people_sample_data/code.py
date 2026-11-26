#input_type_name: PeopleSampleDataInput
#output_type_name: PeopleSampleDataResult
#function_name: people_sample_data

"""What Mail's and Meetings' samples cannot show alone, made up and labelled.

Their samples cover the last month: nobody has had time to go quiet, and
the Lemma has one person in it. `load` adds:

- four made-up people at made-up `.example` companies, with months of earlier
  contact (`people_sample_contact`): three who have gone quiet against their
  own usual gap, one still warm. Each is a shared `person` with an email
  handle, as Mail would make them; the next refresh reads them like anyone.
- a made-up colleague, "Noor Haddad (sample)", in the team view
  (`people_link`): some people the samples also know, so the team's last
  contact can be hers, and two only she knows.

`clear` removes exactly what `load` made: those people (unless something
shared now names them), their contacts and People map's rows about them, the
colleague's rows. Then it tidies People map's own rows left for people or
companies that no longer exist (clearing Mail's or Meetings' sample removes
the people they made, and they cannot see People map's tables), this
person's team rows for people they no longer have, and companies nobody's
people point to any more.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PERSON_NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")   # Mail's, so ids match
LINK_NS = uuid.UUID("eb4518c8-84e0-4a47-94f1-4b999aa61771")
SAMPLE_NS = uuid.UUID("ff1c030c-90f8-4c88-aa43-0d8c78ced4d0")
SAMPLE_MEMBER = "288188c9-7991-4da2-9318-b3254d59480e"
SAMPLE_NAME = "Noor Haddad (sample)"

# name, address, "title, company", every n days, from days ago, to days ago, labels
QUIET = [
    ("Ana Ruiz", "ana@lumen-labs.example", "Head of Operations, Lumen Labs", 14, 120, 49,
     ["Pilot kick-off", "Re: pilot week two", "Pilot check-in", "Re: usage numbers", "Pilot review call",
      "Re: rollout to the second site", "Re: invoice for the pilot", "Re: what's next after the pilot"]),
    ("Ivo Petrov", "ivo@kestrel-capital.example", "Partner, Kestrel Capital", 30, 210, 63,
     ["Coffee after the demo day", "Re: our seed thesis", "Monthly update: June", "Re: monthly update",
      "Monthly update: August", "Re: intro to two founders"]),
    ("Maya Chen", "maya@corbel-studio.example", "Founder, Corbel Studio", 10, 95, 35,
     ["Re: co-marketing idea", "Webinar planning call", "Re: webinar slides", "Re: joint case study",
      "Re: case study draft", "Partner call", "Re: next quarter"]),
    ("Sofia Marin", "sofia@harborview-hotels.example", "IT lead, Harborview Hotels", 21, 150, 10,
     ["Re: rollout to the front desk", "Quarterly review", "Re: two more properties", "Re: training session",
      "Quarterly review", "Re: renewal terms", "Re: support hours", "Re: new property in Lisbon"]),
]
DIRS = ["outbound", "inbound", "meeting", "inbound", "outbound"]

# address, name, title, days since Noor's last contact, warmth
TEAM = [
    ("mira@northgate-vc.example", "Mira Okafor", "Partner", 1, "warm"),
    ("jonah@northgate-vc.example", "Jonah Price", "Principal", 6, "warm"),
    ("paul@velo-cycles.example", "Paul Girard", None, 26, "cooling"),
    ("daniel@brightwave-health.example", "Daniel Kowalski", None, 3, "warm"),
    ("priya@orchard-dental.example", "Priya Nair", "Clinical lead", 52, "cold"),
    ("kofi@ferro-logistics.example", "Kofi Mensah", "Operations", 2, "warm"),
]


class PeopleSampleDataInput(BaseModel):
    mode: str = "load"


class PeopleSampleDataResult(BaseModel):
    mode: str
    people: int
    contacts: int
    team_rows: int
    removed: int
    tidied: int = 0
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


def _delete(pod: Any, table: str, ids: list[str]) -> int:
    n = 0
    for i in range(0, len(ids), 200):
        n += pod.records.bulk_delete(table, ids[i : i + 200]) or 0
    return n


def _ids(pod: Any, sql: str) -> list[str]:
    return [r["id"] for r in _rows(pod.query(sql))]


def _tidy(pod: Any, me: str) -> int:
    removed = 0
    for table, sql in (
        ("people_person", "SELECT pp.id FROM people_person pp LEFT JOIN person p ON p.id = pp.id WHERE p.id IS NULL"),
        ("people_fact", "SELECT f.id FROM people_fact f LEFT JOIN person p ON p.id = f.person_id WHERE p.id IS NULL"),
        ("people_correction", "SELECT c.id FROM people_correction c LEFT JOIN person p ON p.id = c.person_id WHERE p.id IS NULL"),
        ("people_sample_contact", "SELECT s.id FROM people_sample_contact s LEFT JOIN person p ON p.id = s.person_id WHERE p.id IS NULL"),
        ("people_company", "SELECT pc.id FROM people_company pc LEFT JOIN company c ON c.id = pc.id WHERE c.id IS NULL"),
    ):
        removed += _delete(pod, table, _ids(pod, sql + " LIMIT 5000"))
    # This person's own team rows for anyone no longer in their people.
    have = {(r.get("handle") or "").lower() for r in _rows(pod.query(
        "SELECT handle FROM people_person WHERE in_scope IS TRUE AND deal_with IS TRUE LIMIT 20000"))}
    removed += _delete(pod, "people_link", [r["id"] for r in _rows(pod.query(
        f"SELECT id, handle FROM people_link WHERE member_id = {_sql(me)} LIMIT 20000")) if r["handle"].lower() not in have])
    companies = _ids(pod,
        "SELECT c.id FROM company c LEFT JOIN people_company pc ON pc.id = c.id "
        "WHERE NOT EXISTS (SELECT 1 FROM people_link l WHERE l.company_id = c.id) "
        "AND NOT EXISTS (SELECT 1 FROM people_person pp WHERE pp.company_id = c.id AND pp.in_scope IS TRUE) "
        "AND (pc.notes IS NULL OR pc.notes = '') LIMIT 2000")
    if companies:
        removed += _delete(pod, "company_domain", _ids(pod, f"SELECT id FROM company_domain WHERE company_id IN ({_in(companies)})"))
        removed += _delete(pod, "people_company", _ids(pod, f"SELECT id FROM people_company WHERE id IN ({_in(companies)})"))
        removed += _delete(pod, "company", companies)
    return removed


def people_sample_data(ctx: FunctionContext, data: PeopleSampleDataInput) -> PeopleSampleDataResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    me = str(ctx.user_id)
    pid_of = {q[1]: str(uuid.uuid5(PERSON_NS, f"{me}:email:{q[1]}")) for q in QUIET}

    if data.mode == "clear":
        removed = _delete(pod, "people_link", _ids(pod, f"SELECT id FROM people_link WHERE member_id = {_sql(SAMPLE_MEMBER)}"))
        removed += _delete(pod, "people_sample_contact", _ids(pod, "SELECT id FROM people_sample_contact LIMIT 5000"))
        handles = list(pid_of)
        # The made-up people, unless something shared now names them.
        named = {(r.get("h") or "").lower() for r in _rows(pod.query(
            f"SELECT counterpart_handle AS h FROM conversation WHERE counterpart_handle IN ({_in(handles)}) LIMIT 100"))}
        named |= {(r.get("h") or "").lower() for r in _rows(pod.query(
            f"SELECT person_handle AS h FROM promise WHERE person_handle IN ({_in(handles)}) LIMIT 100"))}
        for h in handles:
            if _rows(pod.query(f"SELECT id FROM meeting WHERE attendees::jsonb @> {_sql(json.dumps([{'handle': h}]))} LIMIT 1")):
                named.add(h)
        ids = [pid_of[h] for h in handles if h not in named]
        for table in ("people_fact", "people_correction"):
            removed += _delete(pod, table, _ids(pod, f"SELECT id FROM {table} WHERE person_id IN ({_in(ids)})"))
        removed += _delete(pod, "people_person", _ids(pod, f"SELECT id FROM people_person WHERE id IN ({_in(ids)})"))
        # The person's day: those people leave it (closed by the source).
        gone = _ids(pod, f"SELECT id FROM needs_you WHERE source_plugin = 'people' AND state <> 'done' AND source_id IN ({_in(ids)}) LIMIT 5000")
        for i in range(0, len(gone), 100):
            pod.records.bulk_update("needs_you", [{"id": g, "state": "done", "closed_by": "source"} for g in gone[i : i + 100]])
        removed += _delete(pod, "person_handle", _ids(pod, f"SELECT id FROM person_handle WHERE person_id IN ({_in(ids)})"))
        removed += _delete(pod, "person", _ids(pod, f"SELECT id FROM person WHERE id IN ({_in(ids)})"))
        tidied = _tidy(pod, me)
        return PeopleSampleDataResult(mode="clear", people=0, contacts=0, team_rows=0, removed=removed, tidied=tidied,
                                      message=f"Removed the sample's {removed} rows"
                                              + (f", and tidied {tidied} left for people or companies that are gone." if tidied else "."))
    if data.mode != "load":
        return PeopleSampleDataResult(mode=data.mode, people=0, contacts=0, team_rows=0, removed=0, message="Use load or clear.")

    have = {r["handle"] for r in _rows(pod.query(f"SELECT handle FROM person_handle WHERE handle IN ({_in(list(pid_of))})"))}
    people, handles, contacts = [], [], []
    for name, handle, title, every, start, end, labels in QUIET:
        pid = pid_of[handle]
        role, _, org = title.partition(", ")
        if handle not in have:
            people.append({"id": pid, "name": name, "org": org or None, "title": role, "is_vip": False})
            handles.append({"id": str(uuid.uuid5(PERSON_NS, f"{pid}:email:{handle}")), "person_id": pid, "kind": "email",
                            "handle": handle, "display_name": name})
        mine: list[dict] = []
        days, i = start, 0
        while days >= end:
            at = (now - timedelta(days=days)).replace(hour=9 + i % 7, minute=(i * 17) % 60, second=0, microsecond=0)
            mine.append({"id": str(uuid.uuid5(SAMPLE_NS, f"{me}:{handle}:{i}")), "person_id": pid, "handle": handle,
                         "at": at.isoformat(), "direction": DIRS[i % len(DIRS)], "label": labels[i % len(labels)]})
            i += 1
            days -= every + (i % 3) - 1
        if mine:
            mine[-1]["direction"] = "outbound"  # the owner wrote last: they went quiet on the owner
        contacts += mine
    if people:
        pod.records.bulk_create("person", people, upsert=True)
        pod.records.bulk_create("person_handle", handles, upsert=True)
    for i in range(0, len(contacts), 100):
        pod.records.bulk_create("people_sample_contact", contacts[i : i + 100], upsert=True)

    domains = sorted({t[0].rsplit("@", 1)[-1] for t in TEAM})
    company_of = {r["domain"]: r["company_id"] for r in _rows(pod.query(
        f"SELECT domain, company_id FROM company_domain WHERE domain IN ({_in(domains)})"))}
    rows = [{
        "id": str(uuid.uuid5(LINK_NS, f"{SAMPLE_MEMBER}:{handle}")), "member_id": SAMPLE_MEMBER, "member_name": SAMPLE_NAME,
        "handle": handle, "name": name, "title": title, "company_id": company_of.get(handle.rsplit("@", 1)[-1]),
        "last_contact_at": (now - timedelta(days=days, hours=3)).isoformat(), "warmth": warmth, "refreshed_at": now.isoformat(),
    } for handle, name, title, days, warmth in TEAM]
    pod.records.bulk_create("people_link", rows, upsert=True)
    return PeopleSampleDataResult(
        mode="load", people=len(QUIET), contacts=len(contacts), team_rows=len(rows), removed=0,
        message=f"Added {len(QUIET)} made-up people with months of earlier contact, and a made-up colleague's "
                f"{len(rows)} people in the team view. Count again to see them.")
