#!/usr/bin/env python3
"""Fixtures for the site pictures: the Leads app's own reads, answered from
this Lemma's sample leads, so the pictures show the app on sample rows
(served by ../_kit/bin/shots_serve.py, which never reaches real data).

    uv run --no-project python bin/shot-fixtures.py "<person name>"   # from leads/

Run after the samples are loaded and the sample leads scored. Only people at
made-up `.example` addresses are kept: a real person looked up in a test
never reaches a picture. The sample marks are answered as off (the pictures
show the product; every name, address and source in them is made up), and
the signed-in person's own address becomes the shot server's sample one.
Writes .lemma/shots/fixtures/pods/pod/datastore/query.json: each query the
app makes, matched by a piece of its SQL, the most specific first.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"

LEAD_SQL = (
    "select lp.id, lp.state, lp.company_id, lp.kind, lp.worth, lp.worth_by, lp.worth_confidence, lp.worth_reason, "
    "lp.wanted_at, lp.forced, lp.looked_up_at, lp.lookup_seconds, lp.lookup_error, lp.found, lp.facts, lp.not_found, "
    "lp.role, lp.location, lp.profile_url, lp.summary, lc.fit, lc.fit_sure, lc.fit_why, lp.review, lp.reviewed_at, "
    "lp.sample, lp.created_at, p.name, p.title as mail_title, pp.handle, pp.last_inbound_at, pp.last_contact_at, "
    "pp.next_meeting_at, c.name as company_name, c.domain as company_domain "
    "from leads_person lp join person p on p.id = lp.id left join people_person pp on pp.id = lp.id "
    "left join company c on c.id = lp.company_id left join leads_company lc on lc.id = lp.company_id "
    "order by lc.fit desc nulls last, lp.looked_up_at desc nulls last limit 3000")


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def rows(sql: str) -> list[dict]:
    return [{k: v for k, v in (r.get("data", r)).items() if k != "user_id"} for r in lemma("query", "run", sql)["items"]]


def sql(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def main() -> None:
    person = sys.argv[1]
    leads = [dict(r, sample=False, forced=False) for r in rows(LEAD_SQL) if (r.get("handle") or "").endswith(".example")]
    # Today's count as a normal day shows it: the four newest look-ups today.
    newest = sorted((r for r in leads if r.get("looked_up_at")), key=lambda r: r["looked_up_at"], reverse=True)[:4]
    for r in leads:
        r["wanted_at"] = r["looked_up_at"] if r in newest else None
    lead = next(r for r in leads if r["name"] == person)
    cid = lead["company_id"]
    companies = [dict(r, sample=False) for r in rows("select id, looked_up_at, found, facts, news, sample from leads_company limit 5000")
                 if r["id"] in {x["company_id"] for x in leads}]
    settings = [dict(r, schedules={"leads-daily-sample": "schedule-sample"}, daily_limit=10)
                for r in rows("select * from leads_settings order by created_at limit 1")]
    entries: list[tuple[str, list[dict]]] = [
        # a lead's page
        (f"from company where id = {sql(cid)}", rows(
            f"select name, domain, description, industry, size, location, website from company where id = {sql(cid)}")),
        (f"from people_company where id = {sql(cid)}", rows(
            f"select research, research_sources, research_state, researched_at from people_company where id = {sql(cid)}")),
        (f"from leads_company where id = {sql(cid)}", rows(
            f"select fit, fit_sure, fit_confidence, fit_why, fit_by, fit_by_name, fit_at from leads_company where id = {sql(cid)}")),
        # the lists
        ("from leads_settings", settings),
        ("from leads_profile", rows("select * from leads_profile limit 1")),
        ("from leads_person lp join person p on p.id = lp.id left join people_person", leads),
        ("from leads_company limit", companies),
        ("from people_settings", [{"setup_step": "done"}]),
    ]
    text = json.dumps([{"match": m, "response": {"items": r, "total": len(r)}} for m, r in entries], indent=1)
    # The sample's own labels off: a picture shows a lead as a look-up leaves it.
    text = text.replace(" (sample)", "").replace("Sample: made up to show a looked-up lead", "New: you started talking recently")
    text = text.replace('"lookup_seconds": 0.0', '"lookup_seconds": 58.0')
    # Whoever corrected a fit in the test is the shot server's sample person.
    text = re.sub(r'"fit_why": "[^"]*? said (\d) of 5"', r'"fit_why": "Sam said \1 of 5"', text)
    text = re.sub(r'"fit_by_name": "[^"]*"', '"fit_by_name": "Sam Rivera"', text)
    for r in rows("select email from mail_mailbox"):
        text = text.replace(r["email"], "sam@yourcompany.example")
    target = OUT / "pods" / "pod" / "datastore"
    target.mkdir(parents=True, exist_ok=True)
    (target / "query.json").write_text(text)
    for m, r in entries:
        print(f"{m[:70]:70} {len(r)}")
    print(f"lead {lead['id']}\nwrote {target / 'query.json'}")


if __name__ == "__main__":
    main()
