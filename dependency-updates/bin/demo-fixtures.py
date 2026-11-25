#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from the sample
week itself: `build` in functions/deps_sample_data/code.py, the same rows
`deps_sample_data` loads into a Lemma. No Lemma is needed.

    uv run --no-project python bin/demo-fixtures.py

The sample is built for Wednesday 25 Nov 2026 at 10:00 in Europe/Berlin (the
demo's `anchor` and `zone` in .lemma/demo.json move it to the viewer's today
and clock), owned by the demo's signed-in person, Priya Shah (`user-sample`).
Rows get the created_at the app sorts and labels by (an ignore from 3 Nov, a
rule from 12 Oct), which a live load stamps as now.

Python's standard library only; run with `uv run --no-project python`.
"""

from __future__ import annotations

import json
import sys
import types
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
OWNER = {"id": "user-sample", "name": "Priya Shah", "email": "priya@northwind.example"}
TODAY = date(2026, 11, 25)
ZONE = "Europe/Berlin"

# The app's loaders (src/data.tsx), by the part of their SQL a fixture matches.
MATCH = {
    "deps_settings": "from deps_settings",
    "deps_repo": "from deps_repo order by",
    "deps_update": "from deps_update where state",
    "deps_batch": "from deps_batch order by",
    "deps_ignore": "from deps_ignore order by",
    "deps_rule": "from deps_rule order by",
}


def sample_module() -> dict:
    """functions/deps_sample_data/code.py, with stand-ins for what it imports."""
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "deps_sample_data"}
    exec(compile((HERE / "functions" / "deps_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def main() -> int:
    built = sample_module()["build"](OWNER["id"], OWNER["name"], TODAY, ZONE)
    monday = datetime(2026, 11, 23, 5, 0, tzinfo=timezone.utc)
    stamps = {
        "deps_settings": lambda r: monday - timedelta(days=60),
        "deps_repo": lambda r: monday - timedelta(days=60),
        "deps_batch": lambda r: datetime.fromisoformat(r.get("opened_at") or iso(monday)),
        "deps_update": lambda r: max(datetime.fromisoformat(r["released_at"]), monday - timedelta(days=14)) + timedelta(hours=8),
        "deps_ignore": lambda r: datetime(2026, 11, 3, 9, 12, tzinfo=timezone.utc) if r["package"] == "@types/react"
        else datetime(2026, 10, 12, 8, 40, tzinfo=timezone.utc),
        "deps_rule": lambda r: datetime(2026, 10, 12, 8, 40, tzinfo=timezone.utc),
    }
    entries = []
    for table, match in MATCH.items():
        rows = []
        for r in built[table]:
            at = stamps[table](r)
            rows.append(dict(r, created_at=iso(at), updated_at=iso(at)))
        if table == "deps_update":
            rows.sort(key=lambda r: r["created_at"], reverse=True)
        if table == "deps_batch":
            rows.sort(key=lambda r: r["created_at"], reverse=True)
        if table == "deps_settings":
            rows = [dict(rows[0], sample=False)]  # the demo's own bar says it is made up
        entries.append({"match": match, "response": {"items": rows, "total": len(rows)}})
    entries.append({"match": "from deps_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Engineering", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": "member-sample", "user_id": OWNER["id"], "user_name": OWNER["name"], "user_email": OWNER["email"],
        "email": OWNER["email"], "roles": ["POD_ADMIN"]}]}) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(e['response']['items'])} {e['match'].split()[1]}" for e in entries[:-1]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
