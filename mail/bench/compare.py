"""Agreement between the Inbox's triage agent (local/bench/old.json) and
Mail's Decisions sort (local/bench/new_rows.json, the conversation and
mail_thread rows after the set-up's sort), per sample conversation."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "local" / "bench"  # run output with ids: gitignored, never committed
old = json.loads((RESULTS / "old.json").read_text())["by_key"]
rows = json.loads((RESULTS / "new_rows.json").read_text())["items"]
new = {r.get("data", r)["source_id"].removeprefix("sample-"): r.get("data", r) for r in rows}

keys = sorted(set(old) & set(new))
stats = {"n": len(keys), "category": 0, "category_sure": 0, "sure": 0, "state": 0, "priority": 0, "priority_1": 0,
         "i_owe": 0, "owed_to_me": 0, "promise_any": 0, "draft": 0}
diff = []
for k in keys:
    o, n = old[k], new[k]
    o_dirs = {c.get("direction") for c in o.get("commitments") or []}
    n_dirs = set(n.get("promise_directions") or [])
    same_cat = o.get("split") == n.get("category")
    stats["category"] += same_cat
    if not n.get("unsure"):
        stats["sure"] += 1
        stats["category_sure"] += same_cat
    stats["state"] += o.get("state") == n.get("state")
    stats["priority"] += int(o.get("priority") or 0) == int(n.get("priority") or 0)
    stats["priority_1"] += abs(int(o.get("priority") or 0) - int(n.get("priority") or 0)) <= 1
    stats["i_owe"] += ("i_owe" in o_dirs) == ("i_owe" in n_dirs)
    stats["owed_to_me"] += ("owed_to_me" in o_dirs) == ("owed_to_me" in n_dirs)
    stats["promise_any"] += bool(o_dirs) == bool(n_dirs)
    stats["draft"] += bool(o.get("draft")) == (n.get("draft_state") in ("wanted", "writing", "ready"))
    if not same_cat or o.get("state") != n.get("state"):
        diff.append(f"{k:16} old {o.get('split'):12} {o.get('state'):11} p{o.get('priority')} | new {str(n.get('category')):12} {n.get('state'):11} p{n.get('priority')}{' (not sure)' if n.get('unsure') else ''}")
n = stats["n"]
print({k: (f"{v}/{n} = {v / n:.0%}" if k not in ("category_sure",) else f"{v}/{stats['sure']} = {v / max(1, stats['sure']):.0%}") for k, v in stats.items() if k not in ("n", "sure")})
print("old drafts asked:", sum(1 for k in keys if old[k].get("draft")), " new drafts:", sum(1 for k in keys if new[k].get("draft_state") in ("wanted", "writing", "ready")))
print("old promise conversations:", sum(1 for k in keys if old[k].get("commitments")), " new:", sum(1 for k in keys if new[k].get("promise_directions")))
print("not sure:", sum(1 for k in keys if new[k].get("unsure")))
print("\n".join(diff))
