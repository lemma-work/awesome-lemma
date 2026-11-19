#input_type_name: LeadsSampleDataInput
#output_type_name: LeadsSampleDataResult
#function_name: leads_sample_data

"""What a looked-up lead looks like, on People map's sample people, made up
and labelled.

People map's, Mail's and Meetings' samples are people at made-up `.example`
companies, which no web page can confirm: a real look-up of them is "not
found". `load` gives the ones Lead research would look up (someone you deal
with, of a kind you chose, at one of the sample companies below) the facts a
look-up would have found, each with a made-up `.example` source, and their
companies' facts and news. Then each goes through the look-up's last steps
for real: the fit is a real Decisions call against the team's description of
a good fit (or, before anyone has written one, the sample's), and the day's
list gets the ones worth a look.

`clear` removes exactly what `load` made: the sample leads (a lead the sample
wrote over is put back as it was), the sample companies' rows with their facts
and fits, any correction made on a sample lead, and closes their items on the
day. A description of a good fit the sample started stays: someone may have
kept it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

PROFILE_NS = uuid.UUID("7d2f4b1c-9a3e-4c58-8e61-2b0f5d9c4a17")
SAMPLE_SENTENCE = "B2B software companies of 20 to 200 people in Europe"
SAMPLE_EXAMPLES = ["Lumen Labs", "Brightwave Health"]
KINDS = ["customer", "investor", "partner"]

# domain: (what they do, size, head office, founded, funding, [(news, date)])
COMPANIES: dict[str, tuple] = {
    "lumen-labs.example": ("Warehouse analytics software for third-party logistics firms", "about 60 people",
                           "Lisbon, Portugal", "2019", "Seed, €4M (2025)", [("Signed its fiftieth warehouse customer", "2026-09")]),
    "brightwave-health.example": ("Appointment and waiting-list software for private clinics", "about 120 people",
                                  "Manchester, UK", "2017", "Series B, £18M (2025)",
                                  [("Opened an office in Berlin", "2026-08"), ("Launched an API for patient-record vendors", "2026-05")]),
    "northgate-vc.example": ("Seed and Series A fund investing in European B2B software", "12 people",
                             "Amsterdam, Netherlands", "2016", None, [("Closed a €120M third fund", "2026-09")]),
    "kestrel-capital.example": ("Pre-seed fund for first-time founders in Europe", "5 partners",
                                "London, UK", "2020", None, []),
    "velo-cycles.example": ("Makes and sells city bicycles direct to riders", "about 45 people",
                            "Lyon, France", "2014", None, [("Opened a second showroom, in Paris", "2026-06")]),
    "orchard-dental.example": ("A group of fourteen dental practices", "about 300 staff",
                               "Bristol, UK", "2009", None, []),
    "ferro-logistics.example": ("Freight forwarding for mid-size manufacturers", "about 800 people",
                                "Hamburg, Germany", "1998", None, [("Rolled out a new customer portal", "2026-07")]),
    "corbel-studio.example": ("Product design studio working with SaaS companies", "18 people",
                              "Copenhagen, Denmark", "2018", None, []),
    "harborview-hotels.example": ("Boutique hotel group with nine properties", "about 650 staff",
                                  "Porto, Portugal", "2011", None, [("Opening a hotel in Lisbon next spring", "2026-10")]),
    "quill-partners.example": ("Fractional finance and fundraising support for startups", "about 25 people",
                               "Dublin, Ireland", "2019", None, []),
    "parkhill.example": ("Early-stage fund backing B2B software founders in Europe", "9 people",
                         "London, UK", "2018", None, [("Led a seed round in a Dutch payroll start-up", "2026-10")]),
    "talentbridge.example": ("Recruits engineers for European software start-ups", "about 30 people",
                             "Berlin, Germany", "2016", None, []),
    "volkov-advisory.example": ("Go-to-market advisory for B2B software companies", "6 people",
                                "Vienna, Austria", "2021", None, []),
    "harborlane.example": ("Growth equity fund for profitable software companies", "about 20 people",
                           "Madrid, Spain", "2015", None, [("Raised a €300M second fund", "2026-07")]),
}
# address: (role, based in, before this)
PEOPLE: dict[str, tuple] = {
    "mira@northgate-vc.example": ("Partner, leads B2B software investments", "Amsterdam", "Product lead at a payments company"),
    "jonah@northgate-vc.example": ("Principal", "Amsterdam", None),
    "ivo@kestrel-capital.example": ("Partner", "London", "Founded and sold a scheduling start-up"),
    "ana@lumen-labs.example": ("Head of Operations", "Lisbon", "Operations at a freight marketplace"),
    "daniel@brightwave-health.example": ("Head of Operations", "Manchester", None),
    "paul@velo-cycles.example": ("Founder and CEO", "Lyon", None),
    "ines@velo-cycles.example": ("Operations Manager", "Lyon", None),
    "sana@orchard-dental.example": ("Practice Manager", "Bristol", None),
    "priya@orchard-dental.example": ("Clinical lead", "Bristol", None),
    "kofi@ferro-logistics.example": ("Head of Operations", "Hamburg", None),
    "lena.fischer@ferro-logistics.example": ("Procurement lead", "Hamburg", None),
    "olivia.grant@brightwave-health.example": ("Chief Technology Officer", "Manchester", "Engineering lead at a health-records company"),
    "eleanor@parkhill.example": ("General Partner", "London", "Operator at two B2B software start-ups"),
    "bea@talentbridge.example": ("Founder, engineering recruitment", "Berlin", None),
    "hannah@volkov-advisory.example": ("Principal advisor, go-to-market", "Vienna", None),
    "tomas@harborlane.example": ("Partner", "Madrid", None),
    "maya@corbel-studio.example": ("Founder and design director", "Copenhagen", None),
    "sofia@harborview-hotels.example": ("IT lead", "Porto", None),
    "aisha@quill-partners.example": ("Managing Partner", "Dublin", None),
}


class LeadsSampleDataInput(BaseModel):
    mode: str = "load"


class LeadsSampleDataResult(BaseModel):
    mode: str
    leads: int
    companies: int
    removed: int
    restored: int = 0
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


def _fact(key: str, label: str, value: str, url: str, found: str, date: str | None = None) -> dict:
    item = {"key": key, "label": label, "value": value, "url": url, "source": url.split("/")[2] + " (sample)", "found_at": found}
    if date:
        item["date"] = date
    return item


def _clear(pod: Any, me: str) -> LeadsSampleDataResult:
    removed = restored = 0
    sample = _rows(pod.query("SELECT id, sample_prev FROM leads_person WHERE sample IS TRUE LIMIT 5000"))
    ids = [r["id"] for r in sample]
    back = [r for r in sample if isinstance(r.get("sample_prev"), dict)]
    for r in back:
        prev = dict(r["sample_prev"])
        prev.update({"sample": False, "sample_prev": None})
        pod.table("leads_person").update(r["id"], prev)
        restored += 1
    removed += _delete(pod, "leads_person", [r["id"] for r in sample if not isinstance(r.get("sample_prev"), dict)])
    # A sample company's row holds its facts and its fit: both go with it.
    companies = [r["id"] for r in _rows(pod.query("SELECT id FROM leads_company WHERE sample IS TRUE LIMIT 5000"))]
    removed += _delete(pod, "leads_company", companies)
    removed += _delete(pod, "leads_correction", [r["id"] for r in _rows(pod.query(
        "SELECT id FROM leads_correction WHERE sample IS TRUE LIMIT 5000"))])
    # Their items on the day: done, closed by the source.
    if ids:
        open_items = [r["id"] for r in _rows(pod.query(
            f"SELECT id FROM needs_you WHERE source_plugin = 'leads' AND source_id IN ({_in(ids)}) "
            "AND state IN ('open', 'snoozed') LIMIT 5000"))]
        for i in range(0, len(open_items), 100):
            pod.records.bulk_update("needs_you", [{"id": x, "state": "done", "closed_by": "source"} for x in open_items[i : i + 100]])
    return LeadsSampleDataResult(mode="clear", leads=len(ids), companies=len(companies), removed=removed, restored=restored,
                                 message=f"Cleared the sample: {len(ids) - restored} sample leads removed, {restored} put back as they were, "
                                         f"{len(companies)} sample companies.")


def leads_sample_data(ctx: FunctionContext, data: LeadsSampleDataInput) -> LeadsSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    if data.mode == "clear":
        return _clear(pod, me)

    now = datetime.now(timezone.utc)
    settings = (_rows(pod.query("SELECT id, kinds FROM leads_settings ORDER BY created_at LIMIT 1")) or [None])[0]
    team = (_rows(pod.query("SELECT id FROM leads_profile WHERE fit_sentence IS NOT NULL LIMIT 1")) or [None])[0]
    if not team:
        # Nobody has said who fits the team yet: the sample's description, as a start.
        pod.records.bulk_create("leads_profile", [{
            "id": str(uuid.uuid5(PROFILE_NS, "profile")), "fit_sentence": SAMPLE_SENTENCE, "fit_examples": SAMPLE_EXAMPLES,
            "fit_version": "sample", "set_at": now.isoformat()}], upsert=True)
    kinds = [k for k in ((settings or {}).get("kinds") or KINDS)]
    people = _rows(pod.query(
        "SELECT pp.id, pp.handle, pp.kind, pp.company_id, c.domain FROM people_person pp JOIN company c ON c.id = pp.company_id "
        f"WHERE pp.in_scope IS TRUE AND pp.deal_with IS TRUE AND pp.kind IN ({_in(kinds)}) "
        f"AND lower(pp.handle) IN ({_in(PEOPLE)}) LIMIT 200"))
    if not people:
        return LeadsSampleDataResult(mode="load", leads=0, companies=0, removed=0,
                                     message="None of People map's sample people are here yet: load People map's sample (or Mail's and Meetings') first.")
    old = {r["id"]: r for r in _rows(pod.query(f"SELECT * FROM leads_person WHERE id IN ({_in([p['id'] for p in people])})"))}

    companies: dict[str, dict] = {}
    leads: list[dict] = []
    for i, p in enumerate(people):
        before = old.get(p["id"])
        if before and (before.get("sample") or (before.get("state") == "ready" and before.get("found"))
                       or before.get("state") in ("wanted", "looking", "skipped", "unsure")):
            continue  # a sample lead already, a real look-up, or someone it (or you) said to skip
        domain = (p.get("domain") or "").lower()
        if domain not in COMPANIES:
            continue
        role, based, earlier = PEOPLE[(p.get("handle") or "").lower()]
        found = (now - timedelta(hours=3 + 5 * i)).isoformat()
        slug = (p.get("handle") or "").split("@")[0]
        facts = [_fact("role", "Role", role, f"https://{domain}/team", found),
                 _fact("location", "Based in", based, f"https://{domain}/team", found),
                 _fact("profile", "Public profile", f"https://{domain}/team/{slug}", f"https://{domain}/team/{slug}", found)]
        if earlier:
            facts.append(_fact("background", "Before this", earlier, f"https://{domain}/team/{slug}", found))
        what, size, office, founded, funding, news = COMPANIES[domain]
        row = {"id": p["id"], "state": "wanted", "kind": p.get("kind"), "company_id": p["company_id"],
               "worth": True, "worth_by": "rule", "worth_reason": "Sample: made up to show a looked-up lead",
               "worth_at": found, "found": True, "facts": facts, "not_found": [], "role": role, "location": based,
               "profile_url": f"https://{domain}/team/{slug}", "summary": f"{role} at {what[0].lower() + what[1:]}"[:400],
               "looked_up_at": found, "lookup_seconds": 0.0, "review": "new", "sample": True,
               "sample_prev": {k: before.get(k) for k in (
                   "state", "kind", "company_id", "worth", "worth_by", "worth_confidence", "worth_reason", "worth_answers",
                   "worth_at", "evidence", "wanted_at", "forced", "looked_up_at", "lookup_seconds", "lookup_error", "found",
                   "facts", "not_found", "role", "location", "profile_url", "summary", "fit", "fit_sure", "fit_why",
                   "review", "reviewed_at")} if before else None}
        leads.append(row)
        if p["company_id"] not in companies:
            cfacts = [_fact("what_they_do", "What they do", what, f"https://{domain}/about", found),
                      _fact("size", "Size", size, f"https://{domain}/about", found),
                      _fact("head_office", "Head office", office, f"https://{domain}/contact", found),
                      _fact("founded", "Founded", founded, f"https://{domain}/about", found)]
            if funding:
                cfacts.append(_fact("funding", "Funding", funding, f"https://{domain}/news", found))
            companies[p["company_id"]] = {
                "id": p["company_id"], "looked_up_at": found, "found": True, "facts": cfacts, "not_found": [], "sample": True,
                "news": [_fact("news", "News", text, f"https://{domain}/news/{n + 1}", found, date) for n, (text, date) in enumerate(news)],
            }
    if not leads:
        return LeadsSampleDataResult(mode="load", leads=0, companies=0, removed=0,
                                     message="The sample is here already.")
    # Companies first: the fit reads them when each lead runs its last steps.
    pod.records.bulk_create("leads_company", list(companies.values()), upsert=True)
    for lead in leads:
        if lead["id"] in old:
            pod.table("leads_person").update(lead["id"], {k: v for k, v in lead.items() if k != "id"})
        else:
            pod.records.bulk_create("leads_person", [lead], upsert=True)
    return LeadsSampleDataResult(mode="load", leads=len(leads), companies=len(companies), removed=0,
                                 message=f"Loaded {len(leads)} sample leads at {len(companies)} sample companies; "
                                         "each one's fit is being scored now.")
