#!/usr/bin/env python3
"""Fixtures for the site pictures: the People and Companies apps' own reads,
answered from this Lemma's samples, so the pictures show the apps on sample
rows (served by ../_kit/bin/shots_serve.py, which never reaches real data).

    uv run --no-project python bin/shot-fixtures.py <person name> <company name>   # from people/

Run after the samples are loaded and People map is set up on them, with a
summary written for the person and the company looked up. Writes
.lemma/shots/fixtures/pods/pod/datastore/query.json: each query the apps make,
matched by a piece of its SQL, the most specific first. The signed-in
account's id, address and name become the shot server's sample person
(Sam Rivera), so "You" reads right and no real address is in a picture. The
sample banners are answered as off: the pictures show the product, and every
name and address in them is a made-up .example one.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SHOT_USER = "user-sample"


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def rows(sql: str) -> list[dict]:
    return [{k: v for k, v in (r.get("data", r)).items() if k != "user_id"} for r in lemma("query", "run", sql)["items"]]


def sql(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def main() -> None:
    person_name, company_name = sys.argv[1:3]
    pid = rows(f"select pp.id from people_person pp join person p on p.id = pp.id where p.name = {sql(person_name)}")[0]["id"]
    cid = rows(f"select id from company where name = {sql(company_name)}")[0]["id"]
    member = rows("select member_id, member_name from people_link where member_id <> '288188c9-7991-4da2-9318-b3254d59480e' limit 1")[0]
    handles = sorted({r["handle"].lower() for r in rows(f"select handle from person_handle where person_id = {sql(pid)}")})
    hl = ", ".join(sql(h) for h in handles)
    contains = " or ".join(f"attendees::jsonb @> {sql(json.dumps([{'handle': h}]))}" for h in handles)
    domains = [r["domain"] for r in rows(f"select domain from company_domain where company_id = {sql(cid)}")]
    like = " or ".join(f"lower(counterpart_handle) like {sql('%@' + d)}" for d in domains)
    people_sql = (
        "select pp.id, pp.handle, pp.domain, pp.in_scope, pp.deal_with, pp.kind, pp.sorted_by, pp.sorted_at, pp.unsure, pp.reason, "
        "pp.answers, pp.company_id, pp.first_contact_at, pp.last_contact_at, pp.last_contact_dir, pp.conversation_count, "
        "pp.meeting_count, pp.episodes, pp.usual_gap_days, pp.warmth, pp.quiet, pp.quiet_days, pp.waiting_on_me, "
        "pp.next_meeting_at, pp.next_meeting_id, pp.summary_state, "
        "p.name, p.org, p.title, p.is_vip, c.name as company_name, c.domain as company_domain "
        "from people_person pp join person p on p.id = pp.id left join company c on c.id = pp.company_id "
        "where pp.in_scope is true order by pp.last_contact_at desc nulls last limit 3000")
    zero = [{"n": 0}]
    entries: list[tuple[str, list[dict]]] = [
        # a person's page
        (f"where pp.id = {sql(pid)}", rows(
            "select pp.*, p.name, p.org, p.title, p.is_vip, c.name as company_name, c.domain as company_domain "
            f"from people_person pp join person p on p.id = pp.id left join company c on c.id = pp.company_id where pp.id = {sql(pid)}")),
        ("from person_handle where person_id", rows(f"select handle from person_handle where person_id = {sql(pid)}")),
        ("jsonb_array_elements_text(coalesce(c.participants", rows(
            "select distinct c.id, c.subject, c.state, c.ask, c.snippet, c.last_message_at, c.last_direction, c.message_count "
            "from conversation c, jsonb_array_elements_text(coalesce(c.participants, '[]')::jsonb) as h(v) "
            f"where c.kind = 'people' and lower(h.v) in ({hl}) order by c.last_message_at desc nulls last limit 60")),
        ("from meeting where status <> 'cancelled' and (attendees", rows(
            f"select id, title, start_at, kind, headline, summary from meeting where status <> 'cancelled' and ({contains}) order by start_at desc limit 40")),
        ("from people_fact where person_id", rows(
            f"select * from people_fact where person_id = {sql(pid)} and state = 'active' order by created_at desc limit 30")),
        ("from people_sample_contact where person_id", rows(
            f"select id, at, direction, label from people_sample_contact where person_id = {sql(pid)} order by at desc limit 40")),
        # a company's page
        (f"from people_company where id = {sql(cid)}", rows(f"select * from people_company where id = {sql(cid)}")),
        ("from conversation where kind = 'people' and (lower(counterpart_handle) like", rows(
            "select id, subject, state, last_message_at, last_direction, counterpart_handle, counterpart_name from conversation "
            f"where kind = 'people' and ({like}) order by last_message_at desc nulls last limit 60")),
        ("from meeting where status <> 'cancelled' and outside is true order by start_at desc limit 400", rows(
            "select id, title, start_at, kind, headline, summary, attendees from meeting where status <> 'cancelled' and outside is true order by start_at desc limit 400")),
        # the Companies app's lists
        ("left join people_company pc on pc.id = c.id", rows(
            "select c.*, pc.research_state, pc.researched_at from company c left join people_company pc on pc.id = c.id order by c.name limit 5000")),
        ("from company_domain order by domain", rows("select company_id, domain from company_domain order by domain limit 20000")),
        ("pp.company_id is not null limit", rows(
            "select pp.id, pp.company_id, pp.handle, pp.kind, pp.last_contact_at, pp.warmth, pp.quiet, p.name, p.title "
            "from people_person pp join person p on p.id = pp.id "
            "where pp.in_scope is true and pp.deal_with is true and pp.company_id is not null limit 5000")),
        ("from people_link where company_id is not null", rows("select * from people_link where company_id is not null limit 8000")),
        # the People app's lists
        ("from people_sample_contact", zero),
        ("from mail_mailbox where account_id", zero),
        ("from meetings_calendar where provider", zero),
        ("from people_settings", [dict(r, schedules=None) for r in rows("select * from people_settings order by created_at limit 1")]),
        ("where pp.in_scope is true order by pp.last_contact_at", rows(people_sql)),
        ("from person_handle where kind = 'email'", rows("select person_id, handle from person_handle where kind = 'email' limit 20000")),
        ("from promise where state = 'open'", rows(
            "select id, person_handle, person_name, direction, text, quote, due_at, conversation_id, source, source_id from promise "
            "where state = 'open' order by due_at nulls last limit 2000")),
        ("select id, name, domain from company order by name", rows("select id, name, domain from company order by name limit 10000")),
        ("from people_link order by", rows("select * from people_link order by last_contact_at desc nulls last limit 8000")),
        ("from mail_category", rows("select key, name, sentence, kind from mail_category where state = 'active' order by position, name")),
        ("from mail_settings", [{"setup_step": "done"}]),
        ("from meetings_settings", [{"setup_step": "done"}]),
    ]
    text = json.dumps([{"match": m, "response": {"items": r, "total": len(r)}} for m, r in entries], indent=1)
    who = member["member_name"] or ""
    text = text.replace(member["member_id"], SHOT_USER)
    if who:
        text = text.replace(who, "Sam Rivera")
    # The made-up colleague as a colleague, not a sample, in the pictures.
    text = text.replace("288188c9-7991-4da2-9318-b3254d59480e", "member-noor").replace("Noor Haddad (sample)", "Noor Haddad")
    for r in rows("select email from mail_mailbox"):
        text = text.replace(r["email"], "sam@yourcompany.example")
    target = OUT / "pods" / "pod" / "datastore"
    target.mkdir(parents=True, exist_ok=True)
    (target / "query.json").write_text(text)
    for m, r in entries:
        print(f"{m[:60]:60} {len(r)}")
    print(f"person {pid}\ncompany {cid}\nwrote {target / 'query.json'}")


if __name__ == "__main__":
    main()
