"""Searches, page reads and time of each look-up agent run in this Lemma.
    uv run --no-project python bench/lookup_cost.py
"""
import json
import subprocess
from collections import Counter
from datetime import datetime
from pathlib import Path

LEMMA = str(Path(__file__).resolve().parent.parent / "bin" / "lemma")


def cli(*args):
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True).stdout
    return json.loads(out[out.index("{"):]) if "{" in out else {}


convs = [c for c in cli("conversations", "list", "--limit", "60").get("items", [])
         if (c.get("metadata") or {}).get("workflow_name") == "leads-lookup"]
for c in convs:
    items = cli("conversations", "messages", c["id"]).get("items", [])
    if not items:
        continue
    tools = Counter(m.get("tool_name") for m in items if m.get("kind") == "TOOL_CALL")
    start = datetime.fromisoformat(items[0]["created_at"])
    end = datetime.fromisoformat(items[-1]["created_at"])
    who = next((m.get("text") for m in items if m.get("kind") == "TEXT" and m.get("role") == "user"), "") or ""
    name = json.loads(who).get("person", {}).get("name") if who.strip().startswith("{") else who[:40]
    print(f"{start:%H:%M:%S} {(end - start).total_seconds():5.0f}s searches={tools.get('web_search', 0):2} "
          f"reads={tools.get('web_fetch', 0):2} {name}")
