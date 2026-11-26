#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from Early access's
own sample beta, offline: the rows `early_access_sample_data` loads into a
Lemma (bin/shared/sample.py), at 10:30 UTC on Wednesday 26 November, with a
made-up member (`user-sample`) signed in. The sample's draft is given a sample
mailbox so its Send reads as it would in a Lemma. Nothing here talks to a
Lemma. Python's standard library only.

    uv run --no-project python bin/demo-fixtures.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
T0 = datetime(2026, 11, 26, 10, 30, tzinfo=timezone.utc)
ME = {"user_id": "user-sample", "name": "Jordan Ellis", "email": "jordan@ledgerline.example"}
MAILBOX = {"id": "mailbox-sample", "provider": "gmail", "email": ME["email"], "account_id": "account-sample", "state": "connected"}

# The app's loaders (members/data.tsx), each matched by a piece of its SQL.
LOADERS = {
    "from early_access_beta order by": "early_access_beta",
    "from early_access_tester order by": "early_access_tester",
    "from early_access_batch order by": "early_access_batch",
    "from draft where kind = 'new'": "draft",
    "from feedback where plugin = 'early-access'": "feedback",
    "from early_access_settings limit": "early_access_settings",
    "from mail_mailbox order by": "mail_mailbox",
}


def shared() -> dict:
    scope: dict = {"__name__": "early_access_demo"}
    for name in ("common", "sample"):
        exec(compile((HERE / "bin" / "shared" / f"{name}.py").read_text(), name, "exec"), scope)
    return scope


def main() -> int:
    mod = shared()
    built = mod["sample_rows"](T0, ME["user_id"])
    stamp = T0.isoformat().replace("+00:00", "Z")
    for table, rows in built.items():
        for r in rows:
            r.setdefault("created_at", r.get("signed_up_at") or r.get("picked_at") or stamp)
            r.setdefault("updated_at", stamp)
    # The demo's beta is the team's own: its page takes sign-ups, and its Send reads as sending.
    for b in built["early_access_beta"]:
        b["sample"] = False
        b["page_url"] = "https://early-access.sample.example/sample-csv-export?k=pk_sample_demo"
    for p in built["early_access_page"]:
        p["state"] = "open"
    for t in built["early_access_tester"]:
        t["sample"] = False
    for d in built["draft"]:
        d["source_account"] = MAILBOX["id"]
        d["sent_at"] = None
        d["error"] = None
    tables = {
        "early_access_beta": built["early_access_beta"],
        "early_access_tester": built["early_access_tester"],
        "early_access_batch": built["early_access_batch"],
        "draft": built["draft"],
        "feedback": built["feedback"],
        "early_access_settings": [{"id": "settings-sample", "mailbox": MAILBOX["id"], "schedules": {}}],
        "mail_mailbox": [MAILBOX],
        # Read by the demo's stand-in for the web widget (demo.js), not by a loader.
        "early_access_page": built["early_access_page"],
        "early_access_status": built["early_access_status"],
    }
    query = [{"match": match, "response": {"items": tables[name], "limit": 500, "total": len(tables[name])}}
             for match, name in LOADERS.items()]
    query += [{"match": f"from {name} ", "response": {"items": tables[name], "limit": 500, "total": len(tables[name])}}
              for name in ("early_access_page", "early_access_status")]
    query.append({"match": "from needs_you", "response": {"items": [], "limit": 500, "total": 0}})
    out = FIX / "pods" / "pod"
    (out / "datastore").mkdir(parents=True, exist_ok=True)
    (out / "datastore" / "query.json").write_text(json.dumps(query, indent=1) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Ledgerline", "organization_id": "org"}) + "\n")
    (out / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": "member-user-sample", "user_id": ME["user_id"], "user_name": ME["name"],
        "user_email": ME["email"], "email": ME["email"], "roles": ["POD_ADMIN"]}]}, indent=1) + "\n")
    print(f"wrote {out.relative_to(HERE)}: " + ", ".join(f"{k} {len(v)}" for k, v in tables.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
