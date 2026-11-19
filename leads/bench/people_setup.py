"""Drive People map's own set-up from the CLI, the way the app does: start
`people-setup`, answer the categories and domains forms with what it proposes,
wait for the read, print what it found, and (with --finish) answer the review.
From people/, after bench/bases_setup.py:

    uv run --no-project python bench/people_setup.py [--finish]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "local" / "bench"  # run output with ids: gitignored, never committed
RESULTS.mkdir(parents=True, exist_ok=True)
LEMMA = str(HERE.parent / "bin" / "lemma")


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True, check=False)
    text = out.stdout
    if "{" not in text:
        raise SystemExit(f"lemma {' '.join(args)} failed: {out.stderr[-1500:] or text[-1500:]}")
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def wait(run_id: str, until: set[str], timeout: float = 900) -> dict:
    began = time.monotonic()
    while time.monotonic() - began < timeout:
        run = cli("workflows", "runs", "get", run_id)
        node = (run.get("active_wait") or {}).get("node_id")
        if run.get("status") in ("COMPLETED", "FAILED", "CANCELLED") or (run.get("status") == "WAITING" and node in until):
            return run
        time.sleep(4)
    raise TimeoutError(run_id)


def out_of(run: dict, node: str) -> list[dict]:
    return [s.get("output_data") or {} for s in run.get("step_history") or [] if s["node_id"] == node]


def main() -> None:
    t0 = time.monotonic()
    run = cli("workflows", "run", "people-setup", "--no-wait")
    run_id = run["id"]
    print("run", run_id)
    run = wait(run_id, {"categories"})
    prepared = out_of(run, "prepare")[0]
    print("categories offered:", [(c["key"], "never" if c["never"] else "") for c in prepared["categories"]])
    print("on by default:", prepared["categories_on"], "| domains proposed:", prepared["own_domains"])
    cli("workflows", "runs", "submit-form", run_id, "--node", "categories", "--data", json.dumps({"categories": prepared["categories_on"]}))
    run = wait(run_id, {"domains"})
    cli("workflows", "runs", "submit-form", run_id, "--node", "domains", "--data", json.dumps({"own_domains": prepared["own_domains"]}))
    t1 = time.monotonic()
    run = wait(run_id, {"review"})
    print(f"to review: {time.monotonic() - t1:.0f}s after the domains form")
    for node in ("find", "sort_pass", "share"):
        for o in out_of(run, node):
            print(node, json.dumps({k: v for k, v in o.items() if k != "detail"})[:600])
    if "--finish" in sys.argv:
        cli("workflows", "runs", "submit-form", run_id, "--node", "review", "--data", json.dumps({"looked": True}))
        run = wait(run_id, set())
        print("done:", run["status"], json.dumps(out_of(run, "done")[0] if out_of(run, "done") else {})[:600])
    (RESULTS / "people_setup_run.json").write_text(json.dumps(run, indent=1))
    print(f"total {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
