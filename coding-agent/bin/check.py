#!/usr/bin/env python3
"""Checks on Coding agent's bundle that need no Lemma:

- every function's shared block is the current bin/common.py (and its
  contract snippets are current);
- every function that writes to Today (calls `needs_you_pass` or
  `needs_you_write`) embeds the needs-you snippet and has a grant on needs_you;
- every function parses, and every function, agent and workflow a grant or a
  node names is in the bundle;
- bin/app-schedules.json names workflows that exist, each a start the app can
  make a schedule for.

    uv run --no-project python bin/check.py

Python's standard library only.
"""

from __future__ import annotations

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FAILED: list[str] = []


def jsonc(path: Path):
    text = re.sub(r'("(?:\\.|[^"\\])*")|//[^\n]*', lambda m: m.group(1) or "", path.read_text())
    return json.loads(text)


def check(what: str, ok: bool) -> None:
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        FAILED.append(what)


def main() -> int:
    got = subprocess.run([sys.executable, str(HERE / "bin" / "common.py"), "--check"], capture_output=True, text=True)
    check("every function's shared block is bin/common.py's", got.returncode == 0)

    functions = {p.parent.name: p for p in sorted(HERE.glob("functions/*/code.py"))}
    agents = {p.name for p in (HERE / "agents").iterdir() if p.is_dir()}
    workflows = {p.name: jsonc(p / f"{p.name}.json") for p in (HERE / "workflows").iterdir() if p.is_dir()}
    for name, path in functions.items():
        text = path.read_text()
        try:
            ast.parse(text)
            parsed = True
        except SyntaxError:
            parsed = False
        check(f"{name} parses", parsed)
        outside = re.sub(r"^# coding:common\n.*?^# end coding:common\n", "", text, flags=re.S | re.M)
        writes = "needs_you_pass(" in outside or "needs_you_write(" in outside.split("# end contract")[-1]
        if writes:
            spec = json.loads((path.parent / f"{name}.json").read_text())
            grants = {(g["resource_type"], g["resource_name"]): g["permission_ids"] for g in spec["permissions"]["grants"]}
            check(f"{name} writes to Today: embeds the needs-you snippet", "# contract:needs-you\n" in text)
            check(f"{name} writes to Today: may write needs_you",
                  "datastore.record.write" in grants.get(("datastore_table", "needs_you"), []))
        spec = json.loads((path.parent / f"{name}.json").read_text())
        for g in spec["permissions"]["grants"]:
            if g["resource_type"] == "function":
                check(f"{name}'s grant on function {g['resource_name']} names a function here", g["resource_name"] in functions)
            if g["resource_type"] == "agent":
                check(f"{name}'s grant on agent {g['resource_name']} names an agent here", g["resource_name"] in agents)
    for name, wf in workflows.items():
        for node in wf.get("nodes") or []:
            fn = (node.get("config") or {}).get("function_name")
            if fn:
                check(f"workflow {name} runs {fn}, a function here", fn in functions)
    plan = json.loads((HERE / "bin" / "app-schedules.json").read_text())
    for s in plan["schedules"]:
        wf = workflows.get(s["workflow_name"]) or {}
        start = (wf.get("start") or {})
        if s["schedule_type"] == "WEBHOOK":
            ok = start.get("type") == "EVENT" and (start.get("config") or {}).get("connector_trigger_id") == s["connector_trigger_id"]
        else:
            ok = start.get("type") == "SCHEDULED"
        check(f"app schedule {s['name_prefix']} starts workflow {s['workflow_name']} the way it expects", ok)
    events = sorted(n for n, wf in workflows.items() if (wf.get("start") or {}).get("type") in ("EVENT", "SCHEDULED"))
    made = sorted(s["workflow_name"] for s in plan["schedules"])
    check("the app makes a schedule for every webhook and timed workflow", events == made)

    print(f"\n{len(FAILED)} failed" if FAILED else "\nall checks pass")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
