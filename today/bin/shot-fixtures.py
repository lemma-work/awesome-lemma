#!/usr/bin/env python3
"""Fixtures for the site pictures: the Today app's own reads, answered from a
Lemma whose plugins ran on their samples, so the pictures show the app on
sample rows.

    uv run --no-project python bin/shot-fixtures.py [--pod <id>]     # from today/

Writes .lemma/shots/fixtures/: datastore/query.json (each of the app's
queries, matched by a piece of its SQL, read from src/data.ts so the two
cannot drift) and inbox.json (the platform's Needs you, as the Lemma
answers it). The person's own name and address are replaced with sample ones;
times are kept as they are, so take the pictures the same day.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SAMPLE_ME = "you@yourcompany.example"
POD: list[str] = []


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *POD, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def loaders() -> dict[str, str]:
    """name -> SQL, as data.ts builds each SQL loader (string pieces joined)."""
    source = (HERE / "apps" / "today" / "source" / "src" / "data.ts").read_text()
    block = source[source.index("export const LOADERS"):]
    starts = list(re.finditer(r"^  (\w+): \{", block, re.M))
    out = {}
    for i, start in enumerate(starts):
        body = block[start.end(): starts[i + 1].start() if i + 1 < len(starts) else len(block)]
        if "sql:" not in body or "tables:" not in body:
            continue
        body = body[body.index("sql:"): body.index("tables:")]
        out[start.group(1)] = "".join(re.findall(r'"((?:[^"\\]|\\.)*)"', body))
    return out


def scrub(value, email: str, name: str):
    text = json.dumps(value)
    if email:
        text = text.replace(email, SAMPLE_ME)
    if name:
        text = text.replace(name, "You")
        first = name.split()[0]
        if len(first) > 2:
            text = re.sub(rf"\b{re.escape(first)}\b", "the owner", text)
    return json.loads(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod")
    args = parser.parse_args()
    if args.pod:
        POD.extend(["--pod", args.pod])
    me = lemma("auth", "status")
    email = me.get("email") or ""
    name = me.get("name") or " ".join(x for x in (me.get("first_name"), me.get("last_name")) if x) or ""
    sql = loaders()
    marks = {"settings": "from today_settings order by created_at limit 1", "items": "from needs_you n where"}
    entries = []
    for key, marker in marks.items():
        rows = lemma("query", "run", sql[key])["items"]
        rows = [r.get("data", r) if isinstance(r, dict) and isinstance(r.get("data"), dict) else r for r in rows]
        rows = [{k: v for k, v in r.items() if k != "user_id"} for r in rows]
        if key == "settings":
            for r in rows:
                r["display_name"] = None
        entries.append({"match": marker, "response": {"items": scrub(rows, email, name), "total": len(rows)}})
        print(f"{key:10} {len(rows)} rows")
    (OUT / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (OUT / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))
    inbox = lemma("channels", "inbox")
    (OUT / "pods" / "pod" / "inbox.json").write_text(json.dumps(scrub(inbox, email, name), indent=1))
    print(f"inbox      {len(inbox.get('waiting') or [])} waiting")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
