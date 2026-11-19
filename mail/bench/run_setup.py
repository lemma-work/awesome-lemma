"""Drive one person's set-up end to end from the CLI, as the app does: start
the mail-setup run on the sample mailbox, answer its three forms (the
categories form edited to the bench's category set), wait for the sort, and
save the run. From mail/:

    uv run --no-project python bench/run_setup.py
"""
import json
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "local" / "bench"  # run output with ids: gitignored, never committed
RESULTS.mkdir(parents=True, exist_ok=True)
LEMMA = str(HERE.parent / "bin" / "lemma")


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True, check=False).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def wait(run_id: str, until: set[str], timeout: float = 900) -> dict:
    began = time.monotonic()
    while time.monotonic() - began < timeout:
        run = cli("workflows", "runs", "get", run_id)
        node = (run.get("active_wait") or {}).get("node_id")
        if run.get("status") in ("COMPLETED", "FAILED", "CANCELLED") or (run.get("status") == "WAITING" and node in until):
            return run
        time.sleep(5)
    raise TimeoutError(run_id)


def main() -> None:
    timings = {}
    t0 = time.monotonic()
    run = cli("workflows", "run", "mail-setup", "--no-wait", "--data", json.dumps({"provider": "sample", "timezone": "Asia/Kolkata"}))
    run_id = run["id"]
    run = wait(run_id, {"categories"})
    timings["to_categories_form"] = round(time.monotonic() - t0, 1)
    proposals = run["execution_context"]["proposals"]
    wanted = json.loads((HERE / "categories.json").read_text())
    cats = [{"key": c["key"], "name": c["name"], "sentence": c["sentence"], "keep": True} for c in wanted]
    for c in proposals["categories"]:
        if c["key"] not in {w["key"] for w in wanted}:
            cats.append({**c, "keep": False})
    vips = [dict(v, keep=v["email"] in ("mira@northgate-vc.example", "eleanor@parkhill.example", "aisha@quill-partners.example")) for v in proposals["vips"]]
    rules = [{"text": r["text"], "scope": r["scope"], "keep": True} for r in json.loads((HERE / "rules.json").read_text())]
    rules += [dict(r, keep=False) for r in proposals["rules"]]
    form = {"categories": cats, "voice": proposals["voice"], "rules": rules, "vips": vips}
    (RESULTS / "categories_form.json").write_text(json.dumps(form, indent=1))
    cli("workflows", "runs", "submit-form", run_id, "--node", "categories", "--file", str(RESULTS / "categories_form.json"))
    run = wait(run_id, {"drafts"})
    t1 = time.monotonic()
    cli("workflows", "runs", "submit-form", run_id, "--node", "drafts",
        "--data", json.dumps({"draft_categories": ["vip", "people", "fundraising", "customers", "hiring"]}))
    run = wait(run_id, set())
    timings["drafts_form_to_done"] = round(time.monotonic() - t1, 1)
    run["bench_timings"] = timings
    (RESULTS / "setup_run.json").write_text(json.dumps(run, indent=1))
    steps = [(s["node_id"], s["status"], s.get("started_at", "")[11:19], (s.get("completed_at") or "")[11:19]) for s in run["step_history"]]
    print(run["status"], timings, json.dumps(run["execution_context"].get("done")))
    for step in steps:
        print(*step)


if __name__ == "__main__":
    main()
