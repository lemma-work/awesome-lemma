#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from a Lemma
holding User interviews' sample, so the demo shows exactly what its own
functions made: the study, its people, the call's proposals, the kept
findings and the documents.

    uv run --no-project python bin/demo-fixtures.py     # the Lemma bin/lemma is bound to

Reads the rows the app reads (the same SQL as src/data.tsx's loaders) through
bin/lemma, and each call's document, then makes them the demo's: the person
who loaded the sample becomes the sample person (`user-sample`, as the demo
signs in), and the sample banner is off (the demo's own bar says the data is
made up). Python's standard library only.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
LEAD = {"id": "user-sample", "name": "Product lead", "email": "lead@fernway.example"}
APP = (HERE / "apps" / "interviews" / "source" / "src" / "data.tsx").read_text()

LOADERS = {
    "from interviews_settings": "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1",
    "from interviews_study": "SELECT * FROM interviews_study ORDER BY created_at DESC LIMIT 300",
    "from interviews_person": "SELECT * FROM interviews_person ORDER BY rank DESC LIMIT 1000",
    "from interviews_finding": "SELECT * FROM interviews_finding LIMIT 1000",
    "from feedback where plugin": "SELECT id, quote, point, feature_id, importance, kind, source, at_seconds, said_at, state, handle, name, company_name "
                                  "FROM feedback WHERE plugin = 'user-interviews' AND state = 'processed' LIMIT 1000",
    "from feature where": "SELECT id, name, state, stage, product_id, description, merged_into FROM feature WHERE state <> 'archived' ORDER BY name LIMIT 1000",
    "from interviews_proposal": "SELECT * FROM interviews_proposal ORDER BY n LIMIT 1000",
    "from draft where built_from": "SELECT id, to_handles, subject, body, state, built_from, error, sent_at, source_account, rationale FROM draft "
                                   "WHERE built_from IS NOT NULL ORDER BY updated_at DESC LIMIT 500",
    "from interviews_member": "SELECT * FROM interviews_member LIMIT 1",
    "from interviews_pasted": "SELECT id, study_id, handle FROM interviews_pasted LIMIT 1000",
}


def lemma(*args: str) -> str:
    out = subprocess.run([str(HERE / "bin" / "lemma"), *args], capture_output=True, text=True, check=True)
    return out.stdout


def query(sql: str) -> list[dict]:
    return json.loads(lemma("--json", "query", "run", sql)).get("items", [])


def main() -> int:
    for match in LOADERS:  # the app's reads must still be these
        if match.split()[1] not in APP:
            sys.exit(f"src/data.tsx no longer reads {match.split()[1]}; update LOADERS here")
    settings = query(LOADERS["from interviews_settings"])
    if not settings or not settings[0].get("sample"):
        sys.exit("This Lemma has no User interviews sample; load it first (interviews_sample_data).")
    rows = {m: query(sql) for m, sql in LOADERS.items()}
    sample_studies = {s["id"] for s in rows["from interviews_study"] if s.get("sample")}
    rows["from interviews_study"] = [s for s in rows["from interviews_study"] if s["id"] in sample_studies]
    rows["from interviews_person"] = [p for p in rows["from interviews_person"] if p["study_id"] in sample_studies]
    rows["from interviews_finding"] = [f for f in rows["from interviews_finding"] if f["study_id"] in sample_studies]
    rows["from interviews_proposal"] = [p for p in rows["from interviews_proposal"] if p["study_id"] in sample_studies]
    # A handle also in a real study rests by that study's rules there, not in the sample.
    outside = {r["handle"] for r in query("SELECT handle FROM interviews_person WHERE sample IS NOT TRUE LIMIT 5000")}
    for p in rows["from interviews_person"]:
        if p["handle"] in outside and p.get("stage") in ("fits", "drafted"):
            p.update(rests_until=None, rest_rule=None)
    keep_fb = {f["id"] for f in rows["from interviews_finding"]}
    rows["from feedback where plugin"] = [f for f in rows["from feedback where plugin"] if f["id"] in keep_fb]
    sample_features = {r["id"] for r in query("SELECT id FROM feature WHERE source = 'sample' LIMIT 1000")}
    rows["from feature where"] = [f for f in rows["from feature where"] if f["id"] in sample_features]
    rows["from draft where built_from"] = [d for d in rows["from draft where built_from"]
                                          if (json.loads(d["built_from"]) if isinstance(d["built_from"], str) else d["built_from"] or {}).get("study_id") in sample_studies]
    rows["from interviews_pasted"] = [r for r in rows["from interviews_pasted"] if not r.get("study_id") or r["study_id"] in sample_studies]
    rows["from interviews_member"] = [{"id": "member-sample", "trigger": {}, "schedule": None, "ready_at": "2026-11-20T09:00:00Z"}]
    me = settings[0].get("setup_by") or next((s.get("owner_user_id") for s in rows["from interviews_study"] if s.get("owner_user_id")), None)
    for s in rows["from interviews_settings"]:
        s.update(sample=False, setup_done_at=s.get("setup_done_at") or "2026-11-18T09:00:00Z")
    for s in rows["from interviews_study"]:
        s["owner_name"] = LEAD["name"]
    entries = [{"match": m, "response": {"items": items, "total": len(items)}} for m, items in rows.items()]
    text = json.dumps(entries, ensure_ascii=False)
    if me:
        text = text.replace(str(me), LEAD["id"])
    entries = json.loads(text)
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Fernway product", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": "member-sample", "user_id": LEAD["id"], "user_name": LEAD["name"], "user_email": LEAD["email"],
        "email": LEAD["email"], "roles": ["POD_ADMIN"]}]}) + "\n")
    files = 0
    for p in rows["from interviews_person"]:
        path = p.get("doc_path")
        if not path:
            continue
        got = subprocess.run([str(HERE / "bin" / "lemma"), "--json", "files", "cat", "--text", path], capture_output=True, text=True)
        if got.returncode != 0:
            print(f"couldn't read {path}: {got.stderr.strip()[:200]}", file=sys.stderr)
            continue
        out = FIX / "files" / path.lstrip("/")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.loads(got.stdout)["content"])
        files += 1
    print(f"wrote {FIX.relative_to(HERE)}: {len(entries)} reads, {len(rows['from interviews_person'])} people, {files} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
