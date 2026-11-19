#!/usr/bin/env python3
"""Fixtures for the site pictures: the Meetings app's own reads, answered from
this Lemma's sample calendar, so the pictures show the app on sample rows.

    uv run --no-project python bin/shot-fixtures.py      # from meetings/

Load the sample and run set-up on it first (and let a brief or two and the
transcript be read). Writes .lemma/shots/fixtures/: query.json (each of the
app's queries, matched by a piece of its SQL) and the meetings' documents.
The account's own address is replaced with a sample one.
"""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SAMPLE_ME = "you@yourcompany.example"


def app_sql() -> dict[str, str]:
    """Every query exactly as the app's data.tsx builds it, keyed by a piece of it."""
    source = (HERE / "apps" / "meetings" / "source" / "src" / "data.tsx").read_text()
    fields = "".join(re.findall(r'"([^"]*)"', re.search(r"const MEETING_FIELDS =\s*((?:\"[^\"]*\"\s*\+?\s*)+);", source).group(1)))
    out = {}
    for block in re.findall(r"sql:\s*((?:`[^`]*`|\"[^\"]*\")(?:\s*\+\s*(?:`[^`]*`|\"[^\"]*\"))*)", source):
        sql = "".join(re.findall(r"`([^`]*)`|\"([^\"]*)\"", block) and [a or b for a, b in re.findall(r"`([^`]*)`|\"([^\"]*)\"", block)])
        sql = sql.replace("${MEETING_FIELDS}", fields)
        key = re.search(r"from (\w+(?: m join meetings_work)?)", sql).group(0)
        out[key] = sql
    return out


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    me = (lemma("query", "run", "select email from meetings_calendar limit 1")["items"][0])
    me = (me.get("data") or me)["email"]
    entries = []
    for key, sql in app_sql().items():
        rows = lemma("query", "run", sql)["items"]
        rows = [{k: v for k, v in (r.get("data", r)).items() if k != "user_id"} for r in rows]
        if key == "from meetings_settings":
            for r in rows:
                r["display_name"] = r.get("display_name") or "Sam Rivera"
        text = json.dumps(rows).replace(me, SAMPLE_ME)
        # A person's sweep schedule is named after their user id; keep the
        # preview's sample person's name instead.
        text = re.sub(r"meetings-sweep-[0-9a-f]{8}", "meetings-sweep-user-sam", text)
        entries.append({"match": key, "response": {"items": json.loads(text), "total": len(rows)}})
        print(f"{key[:48]:48} {len(rows)} rows")
    entries.append({"match": "from conversation", "response": {"items": [], "total": 0}})
    (OUT / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (OUT / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))
    docs = OUT / "documents"
    docs.mkdir(exist_ok=True)
    for row in lemma("query", "run", "select document_path from meeting where document_path is not null")["items"]:
        path = (row.get("data") or row)["document_path"]
        local = docs / Path(path).name
        subprocess.run([str(HERE / "bin" / "lemma"), "files", "download", path, str(local)], capture_output=True, check=True)
        local.write_text(local.read_text().replace(me, SAMPLE_ME))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
