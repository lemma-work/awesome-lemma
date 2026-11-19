"""Baseline: the Inbox's original triage agent on Mail's sample mailbox.

Builds the agent's packets the way the Inbox's triage_packets did (newest
words of each conversation, sender history, the person's categories as
splits, sorting rules), from the same fixture mail_sample_data loads, then
runs the agent in a scratch Lemma holding `bench/old-triage` (LEMMA_BENCH_POD_ID):
conversations eight to a batch, bulk mail forty, four batches at once, as
the Inbox's onboarding did. LEMMA_BENCH_OWNER is the mailbox's own address
(default: the sample's you@yourcompany.example).

    uv run --no-project python bench/old_triage.py      # from mail/

Writes local/bench/old.json: per sample key, the agent's split, state,
priority and promises, and per batch the agent's wall time.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import types
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "local" / "bench"  # run output with ids: gitignored, never committed
RESULTS.mkdir(parents=True, exist_ok=True)
MAIL = HERE.parent
BENCH_POD = os.environ.get("LEMMA_BENCH_POD_ID") or sys.exit("Set LEMMA_BENCH_POD_ID to a scratch Lemma with bench/old-triage imported.")
OWNER = os.environ.get("LEMMA_BENCH_OWNER", "you@yourcompany.example")
ZONE = "Asia/Kolkata"

# The fixture, without the platform SDK the function imports.
sys.modules.setdefault("lemma_sdk", types.SimpleNamespace(FunctionContext=object))
sys.modules.setdefault("pydantic", types.SimpleNamespace(BaseModel=object))
source = (MAIL / "functions" / "mail_sample_data" / "code.py").read_text()
fixture: dict = {}
exec(compile(source, "mail_sample_data", "exec"), fixture)  # noqa: S102 — our own file
CONVERSATIONS = fixture["CONVERSATIONS"]
CATEGORIES = json.loads((HERE / "categories.json").read_text())
RULES = [r for r in json.loads((HERE / "rules.json").read_text()) if r["scope"] in ("general", "sorting")]


def doc(subject: str, notes: list, name: str, email: str, now: datetime) -> str:
    lines = [f"# {subject}", ""]
    for index, (days, hour, mine, text) in enumerate(notes):
        stamp = datetime.combine((now - timedelta(days=days)).date(), datetime.min.time(), timezone.utc) + timedelta(hours=hour, minutes=(index * 7) % 60)
        who = "You" if mine else f"{name} <{email}>"
        lines += [f"## {who} — {stamp.strftime('%Y-%m-%d %H:%M UTC')}", f"*To: {email if mine else OWNER}*", "", text, ""]
    return "\n".join(lines)


def packets(now: datetime) -> list[dict]:
    history: dict[str, dict] = {}
    for key, subject, (name, email), category, cc, notes in CONVERSATIONS:
        h = history.setdefault(email, {"threads": 0, "they_wrote": 0, "you_wrote": 0})
        h["threads"] += 1
        h["they_wrote"] += sum(1 for n in notes if not n[2])
        h["you_wrote"] += sum(1 for n in notes if n[2])
    out = []
    for key, subject, (name, email), category, cc, notes in CONVERSATIONS:
        person = any(n[2] for n in notes) or category == "personal"
        text = doc(subject, notes, name, email, now)
        last = notes[-1]
        packet = {
            "thread_id": key, "mailbox": OWNER, "kind": "conversation" if person else "bulk", "subject": subject,
            "from": {"email": email, "name": name}, "provider_says": category, "messages": len(notes),
            "last_from": "you" if last[2] else "them",
            "last_at": (now - timedelta(days=last[0])).isoformat(), "you_have_written_here": any(n[2] for n in notes),
            "attachments": False,
            "text": text[-2200:] if person else " ".join(last[3].split())[:300],
        }
        if person:
            h = history[email]
            packet["sender_history"] = {"vip": email in {"mira@northgate-vc.example", "eleanor@parkhill.example", "aisha@quill-partners.example"},
                                        "threads": h["threads"], "they_wrote": h["they_wrote"], "you_wrote": h["you_wrote"],
                                        "org": None, "title": None}
        out.append(packet)
    return out


def run_batch(batch: list[dict], now: datetime) -> dict:
    payload = {
        "me": {"name": None, "addresses": [OWNER], "own_domains": [], "timezone": ZONE, "default_follow_up_days": 3},
        "now_local": (now + timedelta(hours=5, minutes=30)).strftime("%A %Y-%m-%d %H:%M IST"),
        "splits": [{"key": c["key"], "name": c["name"], "rule": c["sentence"], "kind": c["kind"]} for c in CATEGORIES],
        "rules": [{"id": f"r{i}", "scope": "triage", "text": r["text"]} for i, r in enumerate(RULES)],
        "threads": batch,
    }
    path = RESULTS / f"batch-{batch[0]['thread_id']}.json"
    path.write_text(json.dumps(payload))
    began = time.monotonic()
    done = subprocess.run(
        [str(MAIL / "bin" / "lemma"), "--output", "json", "workflows", "run", "bench-triage", "--pod", BENCH_POD,
         "--file", str(path), "--wait-timeout", "600"],
        capture_output=True, text=True, check=False)
    wall = time.monotonic() - began
    run = json.loads(done.stdout[done.stdout.index("{"):])
    judge = next((s for s in run.get("step_history") or [] if s.get("node_id") == "judge"), {})
    started, ended = judge.get("started_at"), judge.get("completed_at")
    agent_seconds = None
    if started and ended:
        agent_seconds = (datetime.fromisoformat(ended) - datetime.fromisoformat(started)).total_seconds()
    results = ((run.get("execution_context") or {}).get("judge") or {}).get("results") or []
    return {"keys": [t["thread_id"] for t in batch], "kind": batch[0]["kind"], "status": run.get("status"),
            "agent_seconds": agent_seconds, "wall_seconds": round(wall, 1), "results": results, "run_id": run.get("id")}


def main() -> None:
    now = datetime.now(timezone.utc)
    all_packets = packets(now)
    people = [p for p in all_packets if p["kind"] == "conversation"]
    bulk = [p for p in all_packets if p["kind"] == "bulk"]
    batches = [people[i : i + 8] for i in range(0, len(people), 8)] + [bulk[i : i + 40] for i in range(0, len(bulk), 40)]
    began = time.monotonic()
    with ThreadPoolExecutor(max_workers=4) as pool:
        runs = list(pool.map(lambda b: run_batch(b, now), batches))
    total = time.monotonic() - began
    by_key = {}
    for run in runs:
        for result in run["results"]:
            by_key[result.get("thread_id")] = result
    out = {"measured_at": now.isoformat(), "conversations": len(all_packets), "batches": len(batches),
           "agent_runs": len(batches), "total_wall_seconds": round(total, 1), "runs": runs, "by_key": by_key}
    (RESULTS / "old.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k not in ("runs", "by_key")}),
          [(r["kind"], len(r["keys"]), r["status"], r["agent_seconds"]) for r in runs], "answered", len(by_key))


if __name__ == "__main__":
    main()
