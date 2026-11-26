#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from a Lemma
holding Roadmap's sample, so the demo shows exactly what Roadmap's own
functions made: every number, the drafted spec and the outside page.

    LEMMA_POD_ID=<a Lemma with the sample loaded> uv run --no-project python bin/demo-fixtures.py

Reads the rows the app reads (the same SQL as src/data.tsx's loaders, plus
each feature's quotes and spec, and each quote by id) through bin/lemma, then
makes them the demo's:

- the person who loaded it becomes the sample lead (`user-sample`, as the demo
  signs in), with a role for a name;
- the sample banner is off (the demo's own bar says the data is made up);
- each project's last movement is the sample's own (`PROJECTS` in
  functions/roadmap_sample_data/code.py): the platform stamps `updated_at` when
  a row is written, so in a Lemma the sample's tasks have all just moved, and
  Faster search's stale flag shows only here;
- the outside page's rows, read as anyone would, become the public fixture.

Python's standard library only; run with `uv run --no-project python`.
"""

from __future__ import annotations

import json
import subprocess
import sys
import types
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
LEAD = {"id": "user-sample", "name": "Product lead", "email": "lead@fernway.example"}

APP = (HERE / "apps" / "roadmap" / "source" / "src" / "data.tsx").read_text()


def query(sql: str) -> list[dict]:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--json", "query", "run", sql], capture_output=True, text=True, check=True)
    return json.loads(out.stdout).get("items", [])


LOADERS = {
    "from roadmap_settings": "SELECT * FROM roadmap_settings ORDER BY created_at LIMIT 1",
    "from feature order by": "SELECT id, name, description, parent_id, state, stage, stage_at, owner_user_id, product_id, work_source, work_id FROM feature ORDER BY name LIMIT 1000 OFFSET 0",
    "from product order by": "SELECT id, name, role FROM product ORDER BY name LIMIT 1000",
    "from feedback where feature_id is not null": "SELECT id, feature_id, product_id, handle_kind, handle, name, company_id, company_name, importance, said_at, source, state FROM feedback WHERE feature_id IS NOT NULL AND state <> 'set_aside' ORDER BY said_at DESC LIMIT 1000 OFFSET 0",
    "from ask where state in": "SELECT id, work_source, work_id, handle_kind, handle, name, company_id, company_name, asked_at, state, source FROM ask WHERE state IN ('open', 'declined', 'shipped', 'told') ORDER BY asked_at DESC LIMIT 1000 OFFSET 0",
    "from deal where status in": "SELECT id, name, company_id, status, stage, amount, currency FROM deal WHERE status IN ('open', 'won') ORDER BY amount DESC LIMIT 1000 OFFSET 0",
    "from company order by": "SELECT id, name, domain FROM company ORDER BY name LIMIT 1000 OFFSET 0",
    "from roadmap_item limit": "SELECT * FROM roadmap_item LIMIT 1000",
    "from roadmap_spec limit": "SELECT id, path, version, state, drafted_at, updated_at, error, quotes_used, quotes_total, unsourced, edited FROM roadmap_spec LIMIT 1000",
    "from task where project_id is not null": "SELECT project_id, COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done, MAX(updated_at) AS moved FROM task WHERE project_id IS NOT NULL AND status <> 'canceled' GROUP BY project_id LIMIT 1000",
    "from project order by": "SELECT id, name, state FROM project ORDER BY name LIMIT 1000",
    "from feedback where state = 'new'": "SELECT COUNT(*) AS n FROM feedback WHERE state = 'new'",
}
QUOTE_FIELDS = "id, feature_id, product_id, quote, point, kind, importance, handle_kind, handle, name, company_id, company_name, source, source_url, said_at, state"


def sample_module():
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "roadmap_sample_data"}
    exec(compile((HERE / "functions" / "roadmap_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    for match in LOADERS:  # the app's reads must still be these
        table = match.split()[1]
        if f"FROM {table}" not in APP:
            sys.exit(f"src/data.tsx no longer reads {table}; update LOADERS here")
    settings = query(LOADERS["from roadmap_settings"])
    if not settings:
        sys.exit("This Lemma has no Roadmap set-up; load the sample first.")
    me = settings[0].get("lead_user_id")
    my_name = settings[0].get("lead_name") or ""
    rows = {match: query(sql) for match, sql in LOADERS.items()}
    # Each project's last movement, as the sample means it.
    sample = sample_module()
    names = {p["id"]: p["name"] for p in rows["from project order by"]}
    now = datetime.now(timezone.utc)
    for p in rows["from task where project_id is not null"]:
        title = names.get(p["project_id"])
        for _key, (ptitle, tasks) in sample["PROJECTS"].items():
            if ptitle == title:
                days = min(d for _t, status, d in tasks if status != "canceled")
                p["moved"] = (now - timedelta(days=days)).isoformat()
    entries = []
    features = [f["id"] for f in rows["from feature order by"]]
    for fid in features:
        quotes = query(f"SELECT {QUOTE_FIELDS} FROM feedback WHERE feature_id = '{fid}' AND state <> 'set_aside' ORDER BY said_at DESC LIMIT 500")
        if quotes:
            entries.append({"match": f"from feedback where feature_id = '{fid}'", "response": {"items": quotes, "total": len(quotes)}})
        for q in quotes:
            entries.append({"match": f"from feedback where id = '{q['id']}'", "response": {"items": [q], "total": 1}})
    for sp in query("SELECT * FROM roadmap_spec LIMIT 1000"):
        entries.append({"match": f"from roadmap_spec where id = '{sp['id']}'", "response": {"items": [sp], "total": 1}})
    entries += [{"match": match, "response": {"items": items, "total": len(items)}} for match, items in rows.items()]
    entries.append({"match": "from roadmap_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    text = json.dumps(entries, ensure_ascii=False)
    if me:
        text = text.replace(str(me), LEAD["id"])
    if my_name:
        text = text.replace(my_name, LEAD["name"])
    entries = json.loads(text)
    for e in entries:
        if e["match"] == "from roadmap_settings":
            for s in e["response"]["items"]:
                s.update(sample=False, schedule_id=None, schedule_user_id=None, widget_id=None,
                         page_url="https://fernway-roadmap.apps.lemma.work", lead_name=LEAD["name"])
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Fernway product", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": "member-sample", "user_id": LEAD["id"], "user_name": LEAD["name"], "user_email": LEAD["email"],
        "email": LEAD["email"], "roles": ["POD_ADMIN"]}]}) + "\n")
    # The outside page, read the way anyone reads it: rows of the Public table.
    public = query("SELECT id, lane, title, blurb, shipped_on, position, created_at, updated_at FROM roadmap_public ORDER BY position LIMIT 500")
    out = FIX / "public" / "web" / "pk_sample_demo"
    out.mkdir(parents=True, exist_ok=True)
    (out / "rows.json").write_text(json.dumps({"table": "roadmap_public", "columns": [], "rows": public, "truncated": False},
                                              indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: {len(entries)} reads, {len(features)} features, {len(public)} public lines")
    return 0


if __name__ == "__main__":
    sys.exit(main())
