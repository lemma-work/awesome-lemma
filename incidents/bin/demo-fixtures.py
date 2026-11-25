#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from Incidents'
own sample, offline: the rows `incidents_sample_data` loads into a Lemma
(its `build`), with INC-14's first error at 14:02 UTC on the demo's day and
the person signed in to the demo (Mara Lind, `user-sample`) leading it.

    uv run --no-project python bin/demo-fixtures.py

Also writes what Resolve on INC-14 drafts in the demo (`demo_writeup`), which
.lemma/demo.js reads. Nothing here talks to a Lemma. Python's standard
library only.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
LEAD = {"user_id": "user-sample", "name": "Mara Lind", "email": "mara@company.example"}
T0 = datetime(2026, 11, 25, 14, 2, tzinfo=timezone.utc)

LOADERS = {
    "from incidents_settings": "settings",
    "from incidents_incident order by": "incidents_incident",
    "from incidents_event order by": "incidents_event",
    "from incidents_hypothesis order by": "incidents_hypothesis",
    "from incidents_update order by": "incidents_update",
    "from incidents_flag order by": "incidents_flag",
    "from incidents_change order by": "incidents_change",
    "from task where source = 'incidents'": "task",
}


def sample_module() -> dict:
    """functions/incidents_sample_data/code.py, with stand-ins for what it imports."""
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "incidents_sample_data"}
    exec(compile((HERE / "functions" / "incidents_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    mod = sample_module()
    built = mod["build"](T0, LEAD, numbers=True)
    stamp = T0.isoformat()
    for table in ("incidents_hypothesis", "incidents_flag", "incidents_update", "incidents_incident", "incidents_change"):
        for r in built[table]:
            r.setdefault("created_at", r.get("posted_at") or r.get("drafted_at") or r.get("declared_at") or r.get("at") or stamp)
    for r in built["incidents_incident"]:
        r.setdefault("channel_schedule_id", "demo")
        r["channel_connected"] = True
    settings = {
        "id": mod["SETTINGS_ID"], "slack_account": "slack", "slack_team_id": "T0SAMPLE", "announce_channel_id": "C0INCIDENTS",
        "announce_channel_name": "incidents", "channel_prefix": "inc-",
        "repos": [{"repo": "shop/checkout-api", "service": "checkout-api", "deploy_workflow": "Deploy"},
                  {"repo": "shop/search-api", "service": "search-api", "deploy_workflow": "Deploy"}],
        "email_to": ["support@company.example", "cx@company.example", "finance@company.example"],
        "severities": mod["DEFAULT_SEVERITIES"], "setup_done_at": "2026-10-01T09:00:00+00:00", "setup_by": LEAD["user_id"],
        "sample": False, "schedules": {}, "created_at": "2026-10-01T09:00:00+00:00",
    }
    rows = {"settings": [settings], **{t: built[t] for t in LOADERS.values() if t != "settings"}}
    entries = [{"match": match, "response": {"items": rows[key], "total": len(rows[key])}} for match, key in LOADERS.items()]
    entries.append({"match": "from incidents_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Engineering", "organization_id": "org"}) + "\n")
    people = [LEAD] + [{"user_id": f"user-{k}", **v} for k, v in mod["PEOPLE"].items() if k != "mara"]
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": f"member-{p['user_id']}", "user_id": p["user_id"], "user_name": p["name"], "user_email": p["email"],
        "email": p["email"], "roles": ["POD_ADMIN" if p is LEAD else "POD_MEMBER"]} for p in people]}) + "\n")
    resolve = mod["demo_writeup"](T0, LEAD)
    (FIX / "demo").mkdir(parents=True, exist_ok=True)
    (FIX / "demo" / "incidents-resolve.json").write_text(json.dumps(resolve, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k}" for k, v in rows.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
