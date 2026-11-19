#!/usr/bin/env python3
"""Fixtures for the site pictures: the Inbox app's own reads, answered from
this Lemma's sample mailbox, so the pictures show the app on sample rows.

    uv run --no-project python bin/shot-fixtures.py      # from mail/

Load the sample and run set-up on it first. Writes .lemma/shots/fixtures/:
query.json (each of the app's queries, matched by a piece of its SQL) and the
conversation documents. The account's own address is replaced with a sample one.
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SAMPLE_ME = "you@northwind-tools.example"
# match (a piece of the app's SQL, lowercased) -> the SQL to answer it with
QUERIES = {
    "from mail_settings order by created_at limit 1": "select * from mail_settings order by created_at limit 1",
    "from mail_mailbox order by created_at limit 20": "select * from mail_mailbox order by created_at limit 20",
    "from mail_category where state <> 'retired'": "select * from mail_category where state <> 'retired' order by position, name limit 100",
    "from mail_rule where state <> 'retired'": "select * from mail_rule where state <> 'retired' order by created_at limit 200",
    "(c.state <> 'done' or c.last_message_at": None,  # filled from the app's own source below
    "from draft where source = 'mail'": "select * from draft where source = 'mail' and state in ('proposed','approved','sending','failed') order by updated_at desc limit 300",
    "from promise where state = 'open'": "select * from promise where state = 'open' order by due_at nulls last, created_at desc limit 300",
    "from mail_activity order by": "select * from mail_activity order by created_at desc limit 60",
    "coalesce(t.unsure, false) as unsure": None,
}


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def app_sql(marker: str) -> str:
    """The query exactly as the app's data.tsx builds it."""
    source = (HERE / "apps" / "inbox" / "source" / "src" / "data.tsx").read_text()
    fields = re.search(r'const FIELDS =\s*((?:"[^"]*"\s*\+?\s*)+);', source).group(1)
    fields = "".join(re.findall(r'"([^"]*)"', fields))
    if marker.startswith("(c.state"):
        return (f"select {fields} from conversation c join mail_thread t on t.id = c.id where c.source = 'mail' and "
                "(c.state <> 'done' or c.last_message_at > now() - interval '21 days') order by c.last_message_at desc nulls last limit 600")
    block = re.search(r'"select c\.state, c\.category, coalesce.*?group by 1, 2, 3, 4, 5, 6",', source, re.S).group(0)
    return "".join(re.findall(r'"([^"]*)"', block))


def scrub(value, me: str):
    text = json.dumps(value)
    return json.loads(text.replace(me, SAMPLE_ME))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    me = lemma("query", "run", "select email from mail_mailbox limit 1")["items"][0]
    me = (me.get("data") or me)["email"]
    entries = []
    for marker, sql in QUERIES.items():
        rows = lemma("query", "run", sql or app_sql(marker))["items"]
        rows = [r.get("data", r) if isinstance(r, dict) else r for r in rows]
        rows = [{k: v for k, v in r.items() if k != "user_id"} if isinstance(r, dict) else r for r in rows]
        entries.append({"match": marker, "response": {"items": scrub(rows, me), "total": len(rows)}})
        print(f"{marker[:48]:48} {len(rows)} rows")
    (OUT / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (OUT / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))
    docs = OUT / "documents"
    docs.mkdir(exist_ok=True)
    for row in lemma("query", "run", "select document_path from conversation where document_path is not null")["items"]:
        path = (row.get("data") or row)["document_path"]
        text = subprocess.run([str(HERE / "bin" / "lemma"), "files", "cat", path], capture_output=True, text=True, check=True).stdout
        # `files cat` puts a one-line header above the content.
        text = text[text.index("# "):] if "# " in text else text
        (docs / Path(path).name).write_text(text.replace(me, SAMPLE_ME))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
