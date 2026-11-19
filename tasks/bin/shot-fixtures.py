#!/usr/bin/env python3
"""Fixtures for the site pictures: the Tasks app's own reads, answered from the
`Tasks` Lemma after its sample and the agent-worked tasks, so the pictures show
the app on real rows.

    uv run --no-project python bin/shot-fixtures.py [--pod <id>] [--task <id> ...]     # from tasks/

Writes .lemma/shots/fixtures/: every query the app makes (matched by a piece of
its SQL, read from src/data.tsx so the two cannot drift), the timeline of each
--task, the agent conversation's steps for each, the Lemma (named "Ops" here,
as a person's own Lemma would be, so its assistant is not called "Tasks" inside
the Tasks app), its members and agents. The person's own id, name and address
are replaced with the preview's sample person, shown as "You". Times are kept
as they are, so take the pictures the same day.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
OUT = HERE / ".lemma" / "shots" / "fixtures"
SAMPLE_ID = "user-sample"
LEMMA_NAME = "Ops"
POD: list[str] = []


def lemma(*args: str) -> dict:
    out = subprocess.run([str(HERE / "bin" / "lemma"), "--output", "json", *POD, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def loaders() -> dict[str, str]:
    """name -> SQL, as data.tsx writes each loader (string pieces joined)."""
    source = (HERE / "apps" / "tasks" / "source" / "src" / "data.tsx").read_text()
    block = source[source.index("export const LOADERS"): source.index("};", source.index("export const LOADERS"))]
    out = {}
    for name, body in re.findall(r"^  (\w+): \{(.*?)tables:", block, re.S | re.M):
        pieces = re.findall(r'"((?:[^"\\]|\\.)*)"', body[body.index("sql:"):])
        out[name] = "".join(pieces)
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod")
    parser.add_argument("--task", action="append", default=[])
    args = parser.parse_args()
    if args.pod:
        POD.extend(["--pod", args.pod])
    me = lemma("auth", "status")
    email = me.get("email") or ""
    user_id = me.get("id") or me.get("user_id") or ""
    names = [n for n in {me.get("name"), me.get("first_name"), " ".join(x for x in (me.get("first_name"), me.get("last_name")) if x)} if n]

    workdirs: dict[str, str] = {}

    def workdir(match: re.Match) -> str:
        # The agent's scratch folder is named after its conversation: keep the
        # date, never the id.
        name = workdirs.setdefault(match.group(2), f"sample{len(workdirs):02d}")
        return match.group(1) + name

    def scrub(text: str) -> str:
        text = re.sub(r"(/home/user/lemma/c/\d{4}-\d{2}-\d{2}/)([^/\s\"'\\]+)", workdir, text)
        if user_id:
            text = text.replace(user_id, SAMPLE_ID)
        if email:
            text = text.replace(email, "sam@example.com")
        for name in sorted({n for n in names if " " in n}, key=len, reverse=True):
            text = text.replace(name, "You")
        for first in {n.split()[0] for n in names if n}:
            if len(first) > 2:
                # Plain replace: in JSON text a name after "\n" has no word boundary.
                text = text.replace(first, "Sam")
        return text

    def rows(sql: str) -> list[dict]:
        items = lemma("query", "run", sql)["items"]
        items = [r.get("data", r) if isinstance(r, dict) and isinstance(r.get("data"), dict) else r for r in items]
        return json.loads(scrub(json.dumps(items)))

    entries = []
    # The person's own name as Tasks keeps it (from the members list, sometimes cut short).
    for r in lemma("query", "run", "SELECT DISTINCT owner_name FROM personal_task")["items"]:
        n = (r.get("data", r) or {}).get("owner_name")
        if n:
            names.append(n)
    for r in lemma("query", "run", "SELECT DISTINCT actor_name FROM tasks_personal_activity WHERE actor_kind = 'person' UNION SELECT DISTINCT actor_name FROM tasks_activity WHERE actor_kind = 'person'")["items"]:
        n = (r.get("data", r) or {}).get("actor_name")
        if n:
            names.append(n)
    for r in lemma("query", "run", "SELECT DISTINCT display_name FROM tasks_settings")["items"]:
        n = (r.get("data", r) or {}).get("display_name")
        if n:
            names.append(n)

    for task in args.task:
        for table in ("tasks_personal_activity", "tasks_activity"):
            got = rows(f"SELECT * FROM {table} WHERE task_id = '{task}' ORDER BY created_at LIMIT 500")
            if got:
                entries.append({"match": f"from {table} where task_id = '{task}'", "response": {"items": got, "total": len(got)}})
                print(f"timeline {task[:8]} {len(got)} rows")
    for name, sql in loaders().items():
        got = rows(sql)
        if name == "settings":
            for r in got:
                r["display_name"] = "You"
        if name == "sample":
            got = [{"n": 0}]  # a site picture shows the product, not the sample banner
        marker = sql.lower()[:60] if name != "promises" else "from promise p left join conversation c"
        entries.append({"match": marker, "response": {"items": got, "total": len(got)}})
        print(f"{name:10} {len(got)} rows")
    base = OUT / "pods" / "pod"
    (base / "datastore").mkdir(parents=True, exist_ok=True)
    (base / "datastore" / "query.json").write_text(json.dumps(entries, indent=1))

    # The agents' conversations: only their steps (tool names and arguments).
    for task in args.task:
        run = lemma("query", "run", f"SELECT conversation_id FROM tasks_run WHERE id = '{task}'")["items"]
        cid = ((run[0].get("data", run[0]) if run else {}) or {}).get("conversation_id")
        if not cid:
            continue
        msgs = lemma("conversations", "messages", cid).get("items", [])
        steps = [{k: m.get(k) for k in ("id", "kind", "tool_name", "tool_args", "created_at", "agent_run_id", "role")} for m in msgs if m.get("kind") == "TOOL_CALL"]
        folder = base / "conversations" / cid
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "messages.json").write_text(scrub(json.dumps({"items": steps, "limit": 300, "next_page_token": None})))
        print(f"steps {task[:8]} {len(steps)}")

    (base.parent / "pod.json").write_text(json.dumps({"id": "pod", "name": LEMMA_NAME, "organization_id": "org"}))
    (base / "members.json").write_text(json.dumps({"items": [{"pod_member_id": "member-sample", "user_id": SAMPLE_ID, "user_name": "You",
                                                                "user_email": "sam@example.com", "email": "sam@example.com", "roles": ["POD_ADMIN"]}]}))
    (base / "agents.json").write_text(json.dumps({"items": []}))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
