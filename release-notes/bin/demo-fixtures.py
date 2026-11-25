#!/usr/bin/env python3
"""Write the "Try it" demo's sample from a Lemma holding Release notes' sample,
so the demo shows exactly what Release notes' own functions and agents made.

    uv run --no-project python bin/demo-fixtures.py after    # once the sample was published and the replies drafted
    uv run --no-project python bin/demo-fixtures.py before   # with the sample freshly loaded (v2.14 ready)

`before` writes .lemma/shots/fixtures/ (what the app reads, matched by a
piece of each loader's SQL, read from src/data.tsx so the two can't drift),
the public page's rows for the changelog app, and the members. `after` writes
.lemma/demo-after.json: the rows publishing made (asks shipped, the public
replies proposed, the Mail drafts the replier agent wrote in each thread),
which .lemma/demo.js plays back when someone presses Publish in the demo.

The person who loaded it becomes the sample's Maya Wong (`user-sample`), and a
second member, Priya Shah, is added with one ask she heard, so "told by
others" has someone in it. Python's standard library only.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
AFTER = HERE / ".lemma" / "demo-after.json"
ME = {"id": "user-sample", "name": "Maya Wong", "first": "Maya", "email": "maya@example.com"}
PRIYA = {"id": "user-priya", "name": "Priya Shah", "email": "priya@example.com"}


def query(sql: str) -> list[dict]:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--json", "query", "run", sql], capture_output=True, text=True, check=True)
    return json.loads(out.stdout).get("items", [])


def loaders() -> dict[str, str]:
    """name -> SQL, as data.tsx builds each loader (string pieces joined)."""
    source = (HERE / "apps" / "release-notes" / "source" / "src" / "data.tsx").read_text()
    block = source[source.index("export const LOADERS"): source.index("};", source.index("export const LOADERS"))]
    starts = list(re.finditer(r"^  (\w+): \{", block, re.M))
    out = {}
    for i, start in enumerate(starts):
        body = block[start.start(): starts[i + 1].start() if i + 1 < len(starts) else len(block)]
        body = body[body.index("sql:"): body.index("tables:")]
        out[start.group(1)] = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', body))
    return out


def match_of(sql: str) -> str:
    """The SQL from its FROM on, lowercased: "from release_note" alone would match release_note_line too."""
    low = sql.lower()
    return low[low.index("from "):] if "from " in low else low


def who() -> tuple[str, str]:
    s = query("SELECT publishers FROM release_note_settings LIMIT 1")
    pubs = s[0]["publishers"] if s else []
    pubs = json.loads(pubs) if isinstance(pubs, str) else pubs
    return str(pubs[0]["user_id"]), str(pubs[0].get("name") or "")


def scrub(value, me: str, name: str):
    text = json.dumps(value, ensure_ascii=False)
    text = text.replace(me, ME["id"])
    if name and name != "You":
        text = text.replace(name, ME["name"]).replace(name.split(" ")[0], ME["first"])
    return json.loads(text)


# The demo adds one ask the hosted Lemma never had (Ana, heard by the demo's second
# member, on the CSV export line), so the recorded page row has to count her too, or
# the app says 6 asked while the public page says five.
DEMO_MEMBER_ASK_LINE = "Export any report to CSV"


def count_demo_member_ask(page: dict) -> dict:
    lines = page.get("lines")
    lines = json.loads(lines) if isinstance(lines, str) else lines
    if not lines or not any(x.get("title") == DEMO_MEMBER_ASK_LINE and x.get("asked") for x in lines):
        return page
    lines = [dict(x, asked=x["asked"] + 1) if x.get("title") == DEMO_MEMBER_ASK_LINE else x for x in lines]
    return dict(page, lines=lines, asked_total=(page.get("asked_total") or 0) + 1)


def main() -> int:
    mode = (sys.argv[1:] or ["before"])[0]
    me, name = who()
    if mode == "after":
        rows = {
            "asks": query("SELECT * FROM ask ORDER BY asked_at LIMIT 5000"),
            "replies": query("SELECT * FROM release_note_reply LIMIT 3000"),
            "drafts": query("SELECT id, conversation_id, source_account, to_handles, subject, body, state, rationale, built_from, "
                            "sent_at, updated_at FROM draft WHERE built_from IS NOT NULL ORDER BY updated_at DESC LIMIT 1000"),
            "pages": query("SELECT * FROM release_note_page ORDER BY published_on DESC LIMIT 50"),
        }
        for d in rows["drafts"]:
            d["state"], d["sent_at"] = "proposed", None
        for a in rows["asks"]:
            if a["state"] == "told":
                a["state"], a["told_at"] = "shipped", None
        for r in rows["replies"]:
            r.update({"state": "proposed", "sent_at": None, "sent_by": None})
        rows = scrub(rows, me, name)
        AFTER.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + "\n")
        handlers = HERE / ".lemma" / "demo.js"
        blob = json.dumps({k: rows[k] for k in ("asks", "replies", "drafts")}, ensure_ascii=False, separators=(",", ":"))
        handlers.write_text(re.sub(r"/\* AFTER \*/.*?/\* END AFTER \*/",
                                   lambda _m: "/* AFTER */ const AFTER = " + blob + "; /* END AFTER */", handlers.read_text(), flags=re.S))
        print(f"wrote {AFTER.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k}" for k, v in rows.items()))
        return 0

    entries = []
    for key, sql in loaders().items():
        items = scrub(query(sql), me, name)
        if key == "settings":
            for s in items:
                s.update({"sample": False, "schedules": {}, "schedule_user_id": None,
                          "page_url": "https://fernway-changelog.apps.lemma.work"})
                pubs = s["publishers"] if isinstance(s["publishers"], list) else json.loads(s["publishers"])
                s["publishers"] = [{"user_id": ME["id"], "name": ME["name"]} for _ in pubs[:1]]
        if key == "asks":
            ana = next((a for a in items if a["name"] == "Tomas Berg"), None)
            if ana:
                items.append(dict(ana, id="ask-sample-ana", name="Ana Ruiz", company_name="Brightmoor", handle_kind="email",
                                  handle="ana@brightmoor.example", source="mail", source_account=None, source_id="hidden",
                                  heard_by=PRIYA["id"], conversation_id=None))
        entries.append({"match": match_of(sql), "response": {"items": items, "total": len(items)}})
    for conv in scrub(query("SELECT id, subject, source_account, counterpart_handle FROM conversation LIMIT 50"), me, name):
        entries.insert(0, {"match": f"from conversation where id = '{conv['id']}'", "response": {"items": [conv], "total": 1}})
        msgs = scrub(query("SELECT id, direction, from_name, from_handle, sent_at, snippet FROM message "
                           f"WHERE conversation_id = '{conv['id']}' ORDER BY sent_at LIMIT 20"), me, name)
        entries.insert(0, {"match": f"from message where conversation_id = '{conv['id']}'", "response": {"items": msgs, "total": len(msgs)}})
    pod = FIX / "pods" / "pod"
    (pod / "datastore").mkdir(parents=True, exist_ok=True)
    (pod / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Fernway product", "organization_id": "org"}) + "\n")
    (pod / "members.json").write_text(json.dumps({"items": [
        {"pod_member_id": "member-sample", "user_id": ME["id"], "user_name": ME["name"], "user_email": ME["email"], "email": ME["email"], "roles": ["POD_ADMIN"]},
        {"pod_member_id": "member-priya", "user_id": PRIYA["id"], "user_name": PRIYA["name"], "user_email": PRIYA["email"], "email": PRIYA["email"], "roles": ["POD_USER"]},
    ]}, indent=1) + "\n")
    pages = scrub(query("SELECT * FROM release_note_page ORDER BY published_on DESC LIMIT 500"), me, name)
    if AFTER.is_file():  # the changelog shows the page as it is once v2.14 is published
        later = json.loads(AFTER.read_text()).get("pages") or []
        have = {p["id"] for p in pages}
        pages = sorted([p for p in later if p["id"] not in have] + pages, key=lambda p: str(p["published_on"]), reverse=True)
    pages = [count_demo_member_ask(p) for p in pages]
    public = FIX / "public" / "web" / "pk_sample_demo"
    public.mkdir(parents=True, exist_ok=True)
    (public / "rows.json").write_text(json.dumps({"table": "release_note_page", "columns": [], "rows": pages, "truncated": False},
                                                 indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: {len(entries)} queries, {len(pages)} public page rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
