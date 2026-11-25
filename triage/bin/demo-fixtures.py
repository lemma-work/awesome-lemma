#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from Triage's
own sample morning, offline: the rows `triage_sample_data` loads into a
Lemma (its `build`), numbered T-36 to T-50 as on the canvas, at 10:26 UTC on
the demo's day, with Tom Okafor (`user-sample`) signed in and on triage this
week. Nothing here talks to a Lemma. Python's standard library only.

    uv run --no-project python bin/demo-fixtures.py
"""

from __future__ import annotations

import json
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
T0 = datetime(2026, 11, 25, 10, 26, tzinfo=timezone.utc)
ME = {"user_id": "user-sample", "name": "Tom Okafor", "email": "tom@acme.example"}

LOADERS = {
    "from triage_settings": "settings",
    "from triage_item order by": "triage_item",
    "from triage_report order by": "triage_report",
    "from triage_event order by": "triage_event",
    "from ask where work_source = 'triage'": "ask",
    "from triage_rule order by": "triage_rule",
    "from away order by": "away",
    "from triage_known order by": "triage_known",
    "from task where source = 'triage'": "task",
}


def sample_module() -> dict:
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "triage_sample_data"}
    exec(compile((HERE / "functions" / "triage_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    mod = sample_module()
    ids = {k: ("user-sample" if k == "tom" else f"user-{k}") for k in mod["PEOPLE"]}
    built = mod["build"](T0, ME, ids)
    numbers = mod["NUMBERS"]
    for it in built["triage_item"]:
        it["number"] = numbers[it["_key"]]
        it.setdefault("created_at", it.get("first_seen") or T0.isoformat())
    rows = mod["finish"](built, numbers)
    for n, t in zip((112, 118, 121), rows["task"]):
        t["number"] = n
    for table in ("triage_report", "triage_event", "ask", "triage_rule", "triage_known"):
        for r in rows[table]:
            r.setdefault("created_at", r.get("received_at") or r.get("at") or r.get("asked_at") or r.get("updated_at") or T0.isoformat())
    monday = (T0 - timedelta(days=T0.weekday())).date().isoformat()
    read = (T0 - timedelta(minutes=6)).isoformat()
    people = [{"user_id": ids[k], "name": v["name"], "email": v["email"], "github": v["github"], "slack": v["slack"]} for k, v in mod["PEOPLE"].items()]
    settings = {
        "id": mod["SETTINGS_ID"], "repos": [{"full_name": "acme/web"}, {"full_name": "acme/api"}],
        "slack": {"account": "slack", "team_id": "T0ACME", "channels": [{"id": "C0SUPPORT", "name": "support"}, {"id": "C0BUGS", "name": "bugs"}]},
        "sentry": {"account": "sentry", "org": "acme", "projects": ["web", "api"]},
        "posthog": {"account": "posthog", "project_id": "12"},
        "ack": {"app": "off", "assistant": "got_it_known", "slack": "off", "github": "got_it", "form": "got_it_known"},
        "urgent_people": 100, "read_from_people": 25, "close_github_on_done": False,
        "rotation": ["user-sample", "user-ravi", "user-mei"], "rotation_start": monday, "people": people,
        "form_on": True, "form_audience": "anyone", "widget_key": "pk_sample", "widget_id": "w-sample",
        "form_link": "https://api.lemma.example/public/web/pk_sample/page?table=triage_form", "form_columns": [], "known_public": True,
        "setup_done_at": "2026-10-01T09:00:00+00:00", "setup_by": "user-sample", "sample": False, "quiet": True,
        "status": {"sentry": {"state": "every_15", "read_at": read, "count": 31}, "posthog": {"state": "every_15", "read_at": read, "count": 8},
                   "slack": {"state": "every_15", "read_at": read}, "github": {"state": "live"}, "dependabot": {"state": "live"},
                   "code_scanning": {"state": "waiting", "note": "Your GitHub owner has to accept a new permission"},
                   "secret_scanning": {"state": "waiting", "note": "Your GitHub owner has to accept a new permission"}},
        "schedules": {"triage-github-issues": "demo", "triage-slack": "demo"},
        "plugins": {"incidents": True, "coding": True, "release_notes": False, "dependency_updates": True, "sprints": False},
        "sprints_away": {}, "created_at": "2026-10-01T09:00:00+00:00",
    }
    away = [{"id": f"away-{i}", "member_id": "user-mei", "name": "Mei Wong", "day": (T0 + timedelta(days=d)).date().isoformat(), "part": "full",
             "created_at": T0.isoformat()} for i, d in enumerate((9, 10, 11))]
    rows["settings"] = [settings]
    rows["away"] = away
    entries = [{"match": match, "response": {"items": rows[key], "total": len(rows[key])}} for match, key in LOADERS.items()]
    entries.append({"match": "from triage_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Acme engineering", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": f"member-{p['user_id']}", "user_id": p["user_id"], "user_name": p["name"], "user_email": p["email"],
        "email": p["email"], "roles": ["POD_ADMIN" if p["user_id"] == "user-sample" else "POD_MEMBER"]} for p in people]}) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k}" for k, v in rows.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
