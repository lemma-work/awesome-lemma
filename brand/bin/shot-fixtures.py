#!/usr/bin/env python3
"""Fixtures for the site pictures: the Brand app's own reads, answered from a
Lemma holding Brand kit's sample (the made-up bakery), so the pictures show
the app on rows a real read and a real brand check made, and on no real
company's brand.

    uv run --no-project python bin/shot-fixtures.py --pod <id>      # from brand/

Writes .lemma/shots/fixtures/: every query the app makes (matched by a piece
of its SQL, read from src/data.tsx so the two cannot drift), narrowed to the
sample brand and its rows, and every file those rows name (logos, assets, the
guide, the evidence, each design version's files) under files/<pod path>. The
sample banner is off (a site picture shows the product); the person who asked
for the designs is shown as "Sam".
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
POD: list[str] = []


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *POD, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def loaders() -> dict[str, str]:
    source = (HERE / "apps" / "brand" / "source" / "src" / "data.tsx").read_text()
    block = source[source.index("export const LOADERS"): source.index("};", source.index("export const LOADERS"))]
    out = {}
    for name, body in re.findall(r"^  (\w+): \{(.*?)tables:", block, re.S | re.M):
        pieces = re.findall(r'"((?:[^"\\]|\\.)*)"', body[body.index("sql:"):])
        out[name] = "".join(pieces)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod", required=True)
    args = parser.parse_args()
    POD.extend(["--pod", args.pod])

    def rows(sql: str) -> list[dict]:
        items = lemma("query", "run", sql)["items"]
        return [r.get("data", r) if isinstance(r, dict) and isinstance(r.get("data"), dict) else r for r in items]

    brand = rows("SELECT id FROM brand WHERE source = 'sample' LIMIT 1")
    if not brand:
        raise SystemExit("No sample brand in that Lemma: load it first (brand_sample_data).")
    bid = brand[0]["id"]
    designs = {r["id"] for r in rows(f"SELECT id FROM brand_design WHERE brand_id = '{bid}'")}
    narrow = {
        "brands": lambda r: r["id"] == bid,
        "assets": lambda r: r.get("brand_id") == bid, "evidence": lambda r: r.get("brand_id") == bid,
        "jobs": lambda r: r.get("brand_id") == bid, "designs": lambda r: r.get("id") in designs,
        "versions": lambda r: r.get("design_id") in designs,
    }
    entries, paths = [], set()
    for name, sql in loaders().items():
        got = rows(sql)
        if name in narrow:
            got = [r for r in got if narrow[name](r)]
        if name == "brands":
            for r in got:
                # Read from a site that cannot exist (.example), as a real read would be.
                r.update({"is_default": True, "source": "website", "site_url": "https://fennelandfig.example"})
        if name == "designs":
            for r in got:
                r["requested_name"] = "Sam"
                if r.get("approved_by"):
                    r["approved_by"] = "Sam"
        if name == "jobs":
            for r in got:
                r.update({"requested_name": "Sam", "note": None})
        if name == "versions":
            for r in got:
                if r.get("note") == "Brand kit's sample":
                    r["note"] = None
        if name == "sample":
            got = [{"n": 0}]
        text = json.dumps(got)
        paths |= set(re.findall(r'"(/brand/[^"]+\.(?:svg|png|jpe?g|webp|md|txt|css|html))"', text))
        entries.append({"match": sql.lower()[:60], "response": {"items": got, "total": len(got)}})
        print(f"{name:10} {len(got)} rows")
    for d in rows(f"SELECT folder FROM brand_design WHERE brand_id = '{bid}'"):
        for v in rows(f"SELECT v.version FROM brand_version v JOIN brand_design d ON d.id = v.design_id WHERE d.folder = '{d['folder']}'"):
            base = f"{d['folder'].rstrip('/')}/v{v['version']}/"
            paths |= {base + "index.html", base + "theme.css", base + "logo.svg", base + "mark.svg", base + "loaf.svg"}
    base = OUT / "pods" / "pod"
    (base / "datastore").mkdir(parents=True, exist_ok=True)
    (base / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))
    files = OUT / "files"
    for path in sorted(paths):
        target = files / path.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        done = subprocess.run([str(HERE / "bin" / "lemma"), *POD, "files", "download", path, str(target)], capture_output=True, text=True)
        print(("file   " if done.returncode == 0 and target.is_file() else "absent ") + path)
    (base.parent / "pod.json").write_text(json.dumps({"id": "pod", "name": "Studio", "organization_id": "org"}))
    (base / "members.json").write_text(json.dumps({"items": [{"pod_member_id": "member-sample", "user_id": "user-sample", "user_name": "Sam",
                                                                "user_email": "sam@example.com", "email": "sam@example.com", "roles": ["POD_ADMIN"]}]}))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
