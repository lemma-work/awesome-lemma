#!/usr/bin/env python3
"""Filing accuracy on the sample, against the hosted Lemma `bin/lemma` is bound to.

    uv run --no-project python bin/bench-filing.py [--n 30] [--keep]

With the sample loaded: copies `--n` of the sample's quotes (the team's,
filed, about the team's product; their filed feature is the answer) into new
`feedback` rows with no feature (source `bench`), lets the bundled trigger
file them (`user-feedback-file`, a Decisions call each), and counts how many
land under the right feature first time. Then it moves up to five it got wrong
to the right feature as a person would (`user_feedback_keep`, `move`: a
correction), copies the rest again, and counts again with those corrections
as worked examples. Deletes every bench row at the end unless `--keep`.
Python's standard library only.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FEEDBACK_NS = uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")


def lemma(*args: str) -> str:
    out = subprocess.run([str(HERE / "bin" / "lemma"), *args], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f"lemma {' '.join(args[:3])}: {out.stderr[-600:]}")
    return out.stdout


def query(sql: str) -> list[dict]:
    return json.loads(lemma("--json", "query", "run", sql)).get("items", [])


def fid(source: str, source_id: str, quote: str) -> str:
    key = hashlib.sha1(re.sub(r"\s+", " ", quote.strip().lower()).encode()).hexdigest()[:16]
    return str(uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{key}"))


def insert(rows: list[dict]) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
    lemma("records", "import", "feedback", f.name)


def wait_filed(ids: list[str], seconds: int = 420) -> dict:
    deadline = time.time() + seconds
    got: dict = {}
    while time.time() < deadline:
        got = {r["id"]: r for r in query("SELECT f.id, f.feature_id, g.confidence, g.calls FROM feedback f "
                                         "JOIN user_feedback_filing g ON g.id = f.id WHERE f.id IN ("
                                         + ", ".join(f"'{i}'" for i in ids) + ")")}
        if len(got) == len(ids):
            break
        time.sleep(8)
    return got


def round_of(sample: list[dict], tag: str) -> tuple[list[dict], dict]:
    rows = []
    for i, s in enumerate(sample):
        sid = f"{tag}-{i}"
        rows.append({"id": fid("bench", sid, s["quote"]), "quote": s["quote"], "product_id": s["product_id"],
                     "kind": s["kind"], "importance": s["importance"], "source": "bench", "source_id": sid,
                     "said_at": s["said_at"], "state": "new", "plugin": "user-feedback", "_truth": s["feature_id"]})
    truth = {r["id"]: r.pop("_truth") for r in rows}
    insert(rows)
    got = wait_filed(list(truth))
    return rows, {i: (truth[i], (got.get(i) or {}).get("feature_id"), (got.get(i) or {}).get("confidence")) for i in truth}


def main() -> int:
    n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 30
    names = {f["id"]: f["name"] for f in query("SELECT id, name FROM feature LIMIT 500")}
    ours = [p["id"] for p in query("SELECT id FROM product WHERE role = 'ours'")]
    sample = query("SELECT id, quote, feature_id, product_id, kind, importance, said_at FROM feedback "
                   "WHERE source_account = 'sample' AND feature_id IS NOT NULL AND is_public = FALSE "
                   f"AND product_id IN ({', '.join(repr(p) for p in ours)}) ORDER BY said_at DESC LIMIT 200")
    sample = [s for s in sample if names.get(s["feature_id"])]
    # Spread over features: round-robin.
    by_f: dict = {}
    for s in sample:
        by_f.setdefault(s["feature_id"], []).append(s)
    picked = []
    while len(picked) < n and any(by_f.values()):
        for k in list(by_f):
            if by_f[k] and len(picked) < n:
                picked.append(by_f[k].pop(0))
    t0 = time.time()
    rows1, r1 = round_of(picked, f"b1-{int(t0)}")
    right1 = sum(1 for t, g, _ in r1.values() if t == g)
    wrong = [(i, t) for i, (t, g, _) in r1.items() if t != g]
    print(f"round 1: {right1}/{len(r1)} under the right feature first time ({time.time() - t0:.0f}s)")
    for i, (t, g, c) in r1.items():
        if t != g:
            quote = next(r["quote"] for r in rows1 if r["id"] == i)
            print(f"  wrong: “{quote[:70]}” → {names.get(g, 'none')} (should be {names.get(t)}; confidence {c})")
    corrected = wrong[:5]
    for i, t in corrected:
        lemma("functions", "run", "user_feedback_keep", "-d", json.dumps({"id": i, "action": "move", "feature_id": t}))
    rest = [p for p, r in zip(picked, rows1) if r["id"] not in {i for i, _ in corrected}]
    rows2, r2 = round_of(rest, f"b2-{int(time.time())}")
    right2 = sum(1 for t, g, _ in r2.values() if t == g)
    print(f"round 2, after {len(corrected)} corrections as examples: {right2}/{len(r2)}")
    calls = query("SELECT SUM(calls) AS n, COUNT(*) AS c FROM user_feedback_filing WHERE id IN ("
                  + ", ".join(f"'{i}'" for i in [*r1, *r2]) + ")")
    print(f"Decisions calls: {calls[0]['n']} for {calls[0]['c']} filings")
    if "--keep" not in sys.argv:
        for i in [*r1, *r2]:
            for table in ("user_feedback_filing", "feedback"):
                subprocess.run([str(HERE / "bin" / "lemma"), "records", "delete", table, i, "--yes"], capture_output=True)
        print("bench rows deleted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
