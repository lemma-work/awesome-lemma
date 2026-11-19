#!/usr/bin/env python3
"""Fixtures for the site pictures: the Decks app's own reads, answered from the
Deck maker Lemma's rows, so the pictures show the app on real decks.

    uv run --no-project python bin/shot-fixtures.py [--pod <id>] [--deck <id> ...]     # from decks/

Writes .lemma/shots/fixtures/: every query the app makes (matched by a piece of
its SQL, read from src/data.tsx so the two cannot drift), limited to the
--deck decks when given (all of them otherwise). The person's own id, name and
address become the preview's sample person, shown as "you"; the Lemma is
named "Studio". The sample banner is off and there is no brand row, so the
decks show their themes. Times are kept, so take the pictures the same day.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SAMPLE_ID = "user-sample"
LEMMA_NAME = "Studio"
POD: list[str] = []


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *POD, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def loaders() -> dict[str, str]:
    """name -> SQL, as data.tsx writes each loader."""
    source = (HERE / "apps" / "decks" / "source" / "src" / "data.tsx").read_text()
    block = source[source.index("export const LOADERS"): source.index("};", source.index("export const LOADERS"))]
    out = {}
    for name, body in re.findall(r"^  (\w+): \{(.*?)tables:", block, re.S | re.M):
        pieces = re.findall(r'"((?:[^"\\]|\\.)*)"', body[body.index("sql:"):])
        out[name] = "".join(pieces)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod")
    parser.add_argument("--deck", action="append", default=[])
    args = parser.parse_args()
    if args.pod:
        POD.extend(["--pod", args.pod])
    me = lemma("auth", "status")
    email = me.get("email") or ""
    user_id = me.get("id") or me.get("user_id") or ""

    def scrub(text: str) -> str:
        if user_id:
            text = text.replace(user_id, SAMPLE_ID)
        if email:
            text = text.replace(email, "sam@example.com")
            prefix = email.split("@")[0]
            if len(prefix) > 3:
                text = text.replace(prefix, "Sam")
        return text

    def rows(sql: str) -> list[dict]:
        items = lemma("query", "run", sql)["items"]
        items = [r.get("data", r) if isinstance(r, dict) and isinstance(r.get("data"), dict) else r for r in items]
        return json.loads(scrub(json.dumps(items)))

    keep = set(args.deck)
    entries = []
    for name, sql in loaders().items():
        if name == "brand":
            got: list[dict] = []
        elif name == "sample":
            got = []  # a site picture shows the product, not the sample banner
        else:
            got = rows(sql)
        if keep and name == "decks":
            got = [r for r in got if r["id"] in keep]
        if keep and name in ("cards", "jobs"):
            got = [r for r in got if r.get("deck_id") in keep]
        if name == "settings":
            for r in got:
                r.update(display_name="You", look_source="theme")
        marker = sql.lower()[:48]
        entries.append({"match": marker, "response": {"items": got, "total": len(got)}})
        print(f"{name:10} {len(got)} rows")
    base = OUT / "pods" / "pod"
    (base / "datastore").mkdir(parents=True, exist_ok=True)
    (base / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))
    (base.parent / "pod.json").write_text(json.dumps({"id": "pod", "name": LEMMA_NAME, "organization_id": "org"}))
    (base / "members.json").write_text(json.dumps({"items": [{"pod_member_id": "member-sample", "user_id": SAMPLE_ID, "user_name": "You",
                                                                "user_email": "sam@example.com", "email": "sam@example.com", "roles": ["POD_ADMIN"]}]}))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
