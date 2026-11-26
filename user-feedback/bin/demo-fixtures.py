#!/usr/bin/env python3
"""Write the "Try it" demo's sample from the same rows `user_feedback_sample_data`
loads into a Lemma, so the demo and a Lemma's sample can't drift.

    uv run --no-project python bin/demo-fixtures.py

It runs the sample function's pure `build()` (no Lemma) for the day in
.lemma/demo.json's `anchor`, and writes .lemma/shots/fixtures/: what the app
reads, matched by a piece of each loader's SQL (read from src/data.tsx, so the
two can't drift), the settings and the person's own row as loading the sample
leaves them, and the Lemma's members. The person who loaded it is the demo's
`user-sample`. Python's standard library only.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
ME = "user-sample"


def sample_module():
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")

    class BaseModel:  # noqa: D401 — enough for the module to import
        pass

    pyd.BaseModel = BaseModel
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    path = HERE / "functions" / "user_feedback_sample_data" / "code.py"
    spec = importlib.util.spec_from_file_location("uf_sample", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def loaders() -> dict[str, str]:
    """name -> SQL, as data.tsx writes each loader."""
    source = (HERE / "apps" / "feedback" / "source" / "src" / "data.tsx").read_text()
    block = source[source.index("export const LOADERS"): source.index("};", source.index("export const LOADERS"))]
    return {m.group(1): m.group(2) for m in re.finditer(r'^  (\w+): \{ sql: "([^"]+)"', block, re.M)}


def match_of(sql: str) -> str:
    low = sql.lower()
    return low[low.index("from "):] if "from " in low else low


def columns_of(sql: str):
    cols = sql[len("SELECT "): sql.upper().index(" FROM ")].strip()
    return None if cols == "*" else [c.strip() for c in cols.split(",")]


def main() -> int:
    demo = json.loads((HERE / ".lemma" / "demo.json").read_text())
    anchor = datetime.fromisoformat(demo["anchor"].replace("Z", "+00:00")).astimezone(timezone.utc)
    mod = sample_module()
    rows = mod.build(anchor, ME, "user-two")
    settings = {
        "id": mod.SETTINGS_ID, "products_done": True, "features_done": True, "team_name": "Ledgerline",
        "filers": [{"user_id": ME, "name": None}], "hn": True, "hn_keywords": [], "brightdata_account_id": None,
        "brightdata_sources": [], "brightdata_posts": 10, "brightdata_accounts": {}, "slack_channel": None, "schedules": {},
        "schedule_user_id": None, "duplicates": [{"a": mod._sid("feature", "excel"), "b": mod._sid("feature", "csv"), "confidence": 0.82,
                                                  "at": anchor.isoformat()}],
        "kept_apart": [], "setup_done_at": anchor.isoformat(), "sample": True, "created_at": anchor.isoformat(),
    }
    member = {"id": mod.member_row_id(ME), "member_id": ME, "read_mail": True, "read_meetings": True, "auto_share": False,
              "setup_done_at": anchor.isoformat()}
    table_of = {"settings": [settings], "member": [member], "products": rows["product"], "features": rows["feature"],
                "feedback": rows["feedback"], "filing": rows["user_feedback_filing"], "heard": rows["user_feedback_heard"],
                "deals": rows["deal"], "asks": rows["ask"], "listens": rows["user_feedback_listen"]}
    entries = []
    for name, sql in loaders().items():
        items = table_of.get(name, [])
        cols = columns_of(sql)
        if cols:
            items = [{k: r.get(k) for k in dict.fromkeys(["id", *cols])} for r in items]
        entries.append({"match": match_of(sql), "response": {"items": items, "total": len(items)}})
    pod = FIX / "pods" / "pod"
    (pod / "datastore").mkdir(parents=True, exist_ok=True)
    (pod / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Ledgerline product", "organization_id": "org"}) + "\n")
    (pod / "members.json").write_text(json.dumps({"items": [
        {"pod_member_id": "member-sample", "user_id": ME, "user_name": "Product lead", "user_email": "product.lead@ledgerline.example",
         "email": "product.lead@ledgerline.example", "roles": ["POD_ADMIN"]},
        {"pod_member_id": "member-two", "user_id": "user-two", "user_name": "Account manager", "user_email": "accounts@ledgerline.example",
         "email": "accounts@ledgerline.example", "roles": ["POD_USER"]},
    ]}, indent=1) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: {len(entries)} queries, {len(rows['feedback'])} quotes, {len(rows['user_feedback_heard'])} of your own")
    return 0


if __name__ == "__main__":
    sys.exit(main())
