"""Drive Deal tracker's own set-up from the CLI, the way the app does: make
the person's deals_member row, start `deals-setup`, answer the stages and
currency forms with what it proposes, bring in existing deals both ways (a
pasted spreadsheet and the last 30 days of conversations and meeting notes),
wait for the read, print what it found, and (with --finish) answer the review
and the weekly review's day. From deals/, after bench/bases_setup.py
and bench/people_setup.py --finish:

    uv run --no-project python bench/deals_setup.py [--finish] [--no-sheet] [--no-find]
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
ZONE = "Asia/Kolkata"

# Rows as a spreadsheet copies them (tab-separated), with the header row. One
# stage that isn't the team's ("Qualified") and European number formats, on
# purpose.
SHEET = "\n".join([
    "Deal\tCompany\tContact\tStage\tAmount\tClose date\tNext step",
    "Shipments dashboard, 25 seats\tFerro Logistics\tlena.fischer@ferro-logistics.example\tTalking\t€7,500\t15/12/2026\tDemo the new reports to Kofi",
    "Pilot for two depots\tKestrel Freight\t\tQualified\t12k\tJan 20, 2027\tSend the pilot terms",
    "Front desk add-on\tOrchard Dental\tsana@orchard-dental.example\tClosed lost\t1.200\t2026-11-02\t",
])


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True, check=False)
    text = out.stdout
    if "{" not in text:
        raise SystemExit(f"lemma {' '.join(args)} failed: {out.stderr[-1500:] or text[-1500:]}")
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def query(sql: str) -> list[dict]:
    return cli("query", "run", sql).get("items") or []


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
    run = cli("workflows", "run", "deals-setup", "--no-wait")
    run_id = run["id"]
    member = query("SELECT id FROM deals_member LIMIT 1")
    if member:
        cli("records", "update", "deals_member", member[0]["id"], "--data", json.dumps({"setup_run_id": run_id, "timezone": ZONE}))
    else:
        cli("records", "create", "deals_member", "--data", json.dumps({"display_name": "Sam", "timezone": ZONE, "setup_run_id": run_id}))
    print("run", run_id)
    run = wait(run_id, {"stages", "existing"})
    prepared = out_of(run, "prepare")[0]
    print("prepared:", json.dumps({k: v for k, v in prepared.items() if k != "stages"}))
    if (run.get("active_wait") or {}).get("node_id") == "stages":
        print("stages:", [s["name"] for s in prepared["stages"]])
        cli("workflows", "runs", "submit-form", run_id, "--node", "stages", "--data", json.dumps({"stages": prepared["stages"]}))
        run = wait(run_id, {"currency"})
        cli("workflows", "runs", "submit-form", run_id, "--node", "currency", "--data", json.dumps({"currency": "EUR"}))
        run = wait(run_id, {"existing"})
    sheet = "" if "--no-sheet" in sys.argv else SHEET
    preview = cli("functions", "run", "deals_sheet", "--data", json.dumps({"text": sheet, "mode": "preview"})).get("output_data") or {}
    print("sheet preview:", preview.get("message"), json.dumps([(r["name"], r["stage"], r["amount"], r["close_date"], r["problems"]) for r in preview.get("rows", [])]))
    t1 = time.monotonic()
    cli("workflows", "runs", "submit-form", run_id, "--node", "existing", "--data", json.dumps({"sheet": sheet, "find": "--no-find" not in sys.argv}))
    run = wait(run_id, {"review", "day"})
    print(f"to review: {time.monotonic() - t1:.0f}s after the existing form")
    for node in ("sheet", "find", "find_pass", "propose"):
        for o in out_of(run, node):
            print(node, json.dumps({k: v for k, v in o.items() if k not in ("detail", "items", "stages", "rows", "corrections")})[:700])
    for c in query("SELECT kind, deal_name, company_name, value, quote, speaker, source, confidence FROM deals_change WHERE state = 'proposed' ORDER BY created_at"):
        print(f"  {c['kind']:10} {c.get('deal_name') or ''} @ {c.get('company_name')} {json.dumps(c.get('value'))} ({c.get('confidence')})\n             “{c['quote']}” — {c.get('speaker')} [{c['source']}]")
    if "--finish" in sys.argv:
        if (run.get("active_wait") or {}).get("node_id") == "review":
            cli("workflows", "runs", "submit-form", run_id, "--node", "review", "--data", json.dumps({"looked": True}))
            run = wait(run_id, {"day"})
        if (run.get("active_wait") or {}).get("node_id") == "day":
            cli("workflows", "runs", "submit-form", run_id, "--node", "day", "--data", json.dumps({"review_day": "monday", "review_time": "08:00"}))
            run = wait(run_id, set())
        print("done:", run["status"], json.dumps(out_of(run, "done")[0] if out_of(run, "done") else {})[:600],
              json.dumps(out_of(run, "needs")[0] if out_of(run, "needs") else {})[:400])
    (RESULTS / "deals_setup_run.json").write_text(json.dumps(run, indent=1))
    print(f"total {time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    main()
