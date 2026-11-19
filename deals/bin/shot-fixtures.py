#!/usr/bin/env python3
"""Fixtures for the site pictures: the Deals app's own reads, answered from
this Lemma's samples, so the pictures show the app on sample rows (served by
../_kit/bin/shots_serve.py, which never reaches real data).

    uv run --no-project python bin/shot-fixtures.py "<deal name>"   # from deals/

Run after the samples are loaded and Deal tracker is set up on them, with
proposals waiting and the week's review written. Writes
.lemma/shots/fixtures/pods/pod/: each query the app makes, matched by a piece
of its SQL (the most specific first), and the weekly review's count. The
signed-in account's id, address and name become the shot server's sample
person (Sam Rivera), so "you" reads right and no real address or name is in a
picture. The sample banner is answered as off: every name and address in the
pictures is a made-up .example one.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SHOT_USER = "user-sample"


def lemma(*args: str) -> dict:
    # SHOT_LEMMA=<another CLI wrapper> takes them from another Lemma instead
    # (or set LEMMA_POD_ID for bin/lemma).
    cli = os.environ.get("SHOT_LEMMA") or str(HERE / "bin" / "lemma")
    out = subprocess.run([cli, "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def rows(sql: str) -> list[dict]:
    return [{k: v for k, v in (r.get("data", r)).items() if k != "user_id"} for r in lemma("query", "run", sql)["items"]]


def q(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def main() -> None:
    deal_name = sys.argv[1]
    deal = rows(f"select * from deal where name = {q(deal_name)} limit 1")[0]
    did = deal["id"]
    handles = [str(p.get("handle")).lower() for p in deal.get("people") or [] if p.get("handle")]
    domain = (deal.get("company_domain") or "").lower()
    conv_where = " or ".join(x for x in [
        f"lower(counterpart_handle) in ({', '.join(q(h) for h in handles)})" if handles else "",
        f"lower(counterpart_handle) like {q('%@' + domain)}" if domain else ""] if x)
    meet_where = " or ".join([f"attendees::text ilike {q('%' + h + '%')}" for h in handles]
                             + ([f"attendees::text ilike {q('%@' + domain + '%')}"] if domain else []))
    member = rows("select * from deals_member order by created_at limit 1")
    review = lemma("functions", "run", "deals_review", "--data", '{"mode":"count"}').get("output_data") or {}
    zero = [{"n": 0}]
    entries: list[tuple[str, list[dict]]] = [
        # a deal's page
        ("from deals_history where deal_id", rows(f"select * from deals_history where deal_id = {q(did)} order by at desc limit 200")),
        ("from deals_note where deal_id", rows(f"select * from deals_note where deal_id = {q(did)} order by created_at desc limit 100")),
        ("from deals_change where deal_id", rows(
            f"select * from deals_change where deal_id = {q(did)} and state <> 'proposed' order by decided_at desc nulls last limit 50")),
        ("from conversation where kind = 'people' and (", rows(
            "select id, subject, snippet, last_message_at, counterpart_name, counterpart_handle, last_direction from conversation "
            f"where kind = 'people' and ({conv_where}) order by last_message_at desc nulls last limit 20") if conv_where else []),
        ("from meeting where status <> 'cancelled' and (", rows(
            f"select id, title, start_at, summary from meeting where status <> 'cancelled' and ({meet_where}) order by start_at desc limit 20")
         if meet_where else []),
        ("from person_handle where kind = 'email' and handle in", rows(
            f"select person_id, handle from person_handle where kind = 'email' and handle in ({', '.join(q(h) for h in handles) or 'NULL'})")),
        ("from company_domain where domain", rows(f"select company_id as id from company_domain where domain = {q(domain)} limit 1")),
        ("from task where source = 'deals'", []),
        # the app's working set
        ("from deals_member", [dict(r, needs_at="2099-01-01T00:00:00+00:00") for r in member]),
        ("from deals_settings", rows("select * from deals_settings limit 1")),
        ("from deals_stage", rows("select * from deals_stage order by position, name")),
        ("from deal where source = 'sample'", zero),
        ("from deal order by last_activity_at", rows("select * from deal order by last_activity_at desc nulls last limit 3000")),
        ("from deals_change where state = 'proposed'", rows(
            "select * from deals_change where state = 'proposed' order by said_at desc nulls last, created_at desc limit 500")),
        ("from deals_review order by week_end", rows("select * from deals_review order by week_end desc limit 12")),
        ("from people_link limit", rows(
            "select handle, name, company_id, member_id, member_name, last_contact_at, warmth from people_link limit 10000")),
        ("from people_settings", [{"setup_step": "done"}]),
        ("from mail_mailbox where account_id", zero),
        ("from meetings_calendar where provider", zero),
    ]
    text = json.dumps([{"match": m, "response": {"items": r, "total": len(r)}} for m, r in entries], indent=1)
    review_text = json.dumps({"status": "COMPLETED", "output_data": review}, indent=1)
    names = {r.get("owner_name") for r in rows("select owner_name from deal where owner_user_id is not null")} - {None}
    ids = {r.get("owner_user_id") for r in rows("select owner_user_id from deal where owner_user_id is not null")} - {None}
    ids |= {r.get("by_user_id") for r in rows("select by_user_id from deals_history where by_user_id is not null")} - {None}
    for uid in ids:
        text = text.replace(uid, SHOT_USER)
    for name in names | {r.get("display_name") for r in member} - {None, "Sam"}:
        text = text.replace(name, "Sam Rivera")
        review_text = review_text.replace(name, "Sam Rivera")
    # The made-up colleague as a colleague, not a sample, in the pictures.
    text = text.replace("288188c9-7991-4da2-9318-b3254d59480e", "member-noor").replace("Noor Haddad (sample)", "Noor Haddad")
    review_text = review_text.replace("Noor Haddad (sample)", "Noor Haddad")
    for r in rows("select email from mail_mailbox"):
        text = text.replace(r["email"], "sam@yourcompany.example")
    target = OUT / "pods" / "pod"
    (target / "datastore").mkdir(parents=True, exist_ok=True)
    (target / "functions" / "deals_review").mkdir(parents=True, exist_ok=True)
    (target / "datastore" / "query.json").write_text(text)
    (target / "functions" / "deals_review" / "runs.json").write_text(review_text)
    for m, r in entries:
        print(f"{m[:60]:60} {len(r)}")
    print("deal", did)


if __name__ == "__main__":
    main()
