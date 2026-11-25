#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from a Lemma
holding Sprints' sample, so the demo shows exactly what Sprints' own functions
made: every number, risk, suggestion and summary sentence.

    LEMMA_POD_ID=<a Lemma with the sample loaded> uv run --no-project python bin/demo-fixtures.py

Reads the rows the app reads (the same SQL as src/data.tsx's loaders) through
bin/lemma, then makes them the demo's:

- task numbers become the ones the sample was written with (#398, #412, ...;
  older work #301 on), here and in every sentence that names a task, by the
  task's sample key (`build` in functions/sprints_sample_data/code.py);
- the person who loaded it becomes the sample lead, Maya Wong
  (`user-sample`, as the demo signs in);
- the sample banner is off (the demo's own bar says the data is made up).

Python's standard library only; run with `uv run --no-project python`.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import types
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
LEAD = {"id": "user-sample", "name": "Maya Wong", "email": "maya@example.com"}

LOADERS = {
    "from sprints_settings": "SELECT * FROM sprints_settings ORDER BY created_at LIMIT 1",
    "from sprints_sprint order by": "SELECT * FROM sprints_sprint ORDER BY number",
    "from sprints_item limit": "SELECT * FROM sprints_item LIMIT 5000",
    "from sprints_event order by": "SELECT * FROM sprints_event ORDER BY at LIMIT 5000",
    "from sprints_estimate limit": "SELECT id, points FROM sprints_estimate LIMIT 5000",
    "from sprints_away order by": "SELECT * FROM sprints_away ORDER BY day LIMIT 2000",
    "from sprints_suggestion where state": "SELECT * FROM sprints_suggestion WHERE state = 'open' OR kind = 'close' ORDER BY created_at LIMIT 2000",
    "from task where parent_id is null": (
        "SELECT id, number, title, status, priority, source, source_id, source_url, assignee_kind, assignee_user_id, assignee_name, "
        "assignee_agent, project_id, parent_id, created_at, updated_at, done_at FROM task WHERE parent_id IS NULL ORDER BY number DESC LIMIT 3000"),
}


def query(sql: str) -> list[dict]:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--json", "query", "run", sql], capture_output=True, text=True, check=True)
    return json.loads(out.stdout).get("items", [])


def sample_module():
    """functions/sprints_sample_data/code.py, with stand-ins for what it imports."""
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "sprints_sample_data"}
    exec(compile((HERE / "functions" / "sprints_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    settings = query(LOADERS["from sprints_settings"])
    if not settings:
        sys.exit("This Lemma has no Sprints set-up; load the sample first.")
    me = settings[0].get("lead_user_id")
    my_name = settings[0].get("lead_name") or ""
    sample = sample_module()
    # The task ids are the sample's keys made with the loader's id: the same rows, numbered the demo's way.
    built = sample["build"](me, my_name, date.today(), settings[0].get("timezone") or "UTC", numbers=True)
    demo_number = {t["id"]: t["number"] for t in built["task"]}
    rows = {match: query(sql) for match, sql in LOADERS.items()}
    live_to_demo = {}
    for t in rows["from task where parent_id is null"]:
        if t["id"] in demo_number:
            live_to_demo[int(t["number"])] = demo_number[t["id"]]
            t["number"] = demo_number[t["id"]]
    text = json.dumps(rows, ensure_ascii=False)
    text = re.sub(r"#(\d+)\b", lambda m: f"#{live_to_demo.get(int(m.group(1)), m.group(1))}", text)
    text = text.replace(str(me), LEAD["id"])
    if my_name:
        text = text.replace(my_name, LEAD["name"])
    rows = json.loads(text)
    rows["from task where parent_id is null"].sort(key=lambda t: -int(t["number"]))
    for s in rows["from sprints_settings"]:
        s["sample"] = False
        for key in ("schedule_id", "lead_schedule_id", "schedule_user_id"):
            s[key] = None
    entries = [{"match": match, "response": {"items": items, "total": len(items)}} for match, items in rows.items()]
    entries.append({"match": "from sprints_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Engineering", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": "member-sample", "user_id": LEAD["id"], "user_name": LEAD["name"], "user_email": LEAD["email"],
        "email": LEAD["email"], "roles": ["POD_ADMIN"]}]}) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k.split()[1]}" for k, v in rows.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
