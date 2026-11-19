"""Drive a person's whole set-up on the samples from the CLI, as the apps do:
Mail's set-up on the sample mailbox, Meetings' on the sample calendar (each
plugin's own set-up workflow, its forms answered with what it proposed), then
Today's one question and its first check. From today/:

    uv run --no-project python bin/sample_day.py [--pod <id>] [--tz Asia/Kolkata] [--at 08:00] [--skip-mail] [--skip-meetings]

The Lemma is the one bin/lemma is bound to (LEMMA_POD_ID) unless --pod is given. Nothing real is
connected and nothing is sent: both samples have no account. Today's morning
schedule is made by the app, as the person; this makes the same schedule.
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = str(HERE / "lemma")
POD: list[str] = []


def cli(*args: str, check: bool = True) -> dict:
    proc = subprocess.run([LEMMA, "--output", "json", *POD, *args], capture_output=True, text=True, check=False)
    out = proc.stdout
    if "{" not in out:
        if check:
            raise SystemExit(f"lemma {' '.join(args)} failed: {proc.stderr[-1500:] or out[-1500:]}")
        return {}
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def wait(run_id: str, until: set[str], timeout: float = 1200) -> dict:
    began = time.monotonic()
    while time.monotonic() - began < timeout:
        run = cli("workflows", "runs", "get", run_id)
        node = (run.get("active_wait") or {}).get("node_id")
        if run.get("status") in ("COMPLETED", "FAILED", "CANCELLED") or (run.get("status") == "WAITING" and node in until):
            return run
        time.sleep(5)
    raise TimeoutError(run_id)


def answer(run_id: str, node: str, data: dict) -> None:
    cli("workflows", "runs", "submit-form", run_id, "--node", node, "--data", json.dumps(data))


def mail(tz: str) -> None:
    t0 = time.monotonic()
    cli("functions", "run", "mail_settings_ensure", "--data", "{}")
    print("mail: sample loaded", cli("functions", "run", "mail_sample_data", "--data", json.dumps({"mode": "load"})).get("output_data", {}).get("message"))
    run = cli("workflows", "run", "mail-setup", "--no-wait", "--data", json.dumps({"provider": "sample", "timezone": tz}))
    run = wait(run["id"], {"categories"})
    proposals = run["execution_context"]["proposals"]
    answer(run["id"], "categories", {"categories": proposals["categories"], "voice": proposals.get("voice") or "",
                                     "rules": proposals.get("rules") or [], "vips": proposals.get("vips") or []})
    run = wait(run["id"], {"drafts"})
    answer(run["id"], "drafts", {"draft_categories": run["execution_context"]["apply"].get("draft_default") or []})
    run = wait(run["id"], set())
    print(f"mail: set-up {run['status']} in {round(time.monotonic() - t0)} s", json.dumps((run.get("execution_context") or {}).get("done"))[:400])


def meetings(tz: str) -> None:
    t0 = time.monotonic()
    print("meetings: sample loaded", cli("functions", "run", "meetings_sample_data", "--data", json.dumps({"mode": "load", "timezone": tz})).get("output_data", {}).get("message"))
    run = cli("workflows", "run", "meetings-setup", "--no-wait", "--data", json.dumps({"provider": "sample", "timezone": tz}))
    run = wait(run["id"], {"kinds"})
    answer(run["id"], "kinds", {"kinds_on": run["execution_context"]["hold"].get("kinds_on") or ["customer", "investor", "candidate", "partner"]})
    run = wait(run["id"], {"timing"})
    answer(run["id"], "timing", {"brief_when": "evening_before"})
    run = wait(run["id"], {"after"})
    answer(run["id"], "after", {"notes_from": "notes"})
    run = wait(run["id"], set())
    print(f"meetings: set-up {run['status']} in {round(time.monotonic() - t0)} s")


def today(tz: str, at: str) -> None:
    rows = cli("query", "run", "select id from today_settings limit 1").get("items") or []
    me = cli("auth", "status", check=False)
    name = me.get("name") or " ".join(x for x in (me.get("first_name"), me.get("last_name")) if x) or None
    data = {"timezone": tz, "morning_at": at, "setup_step": "done", "display_name": name}
    if rows:
        cli("records", "update", "today_settings", rows[0]["id"], "--data", json.dumps(data))
    else:
        cli("records", "create", "today_settings", "--data", json.dumps(data))
    run = cli("workflows", "run", "today-sweep", "--no-wait")
    run = wait(run["id"], set(), 900)
    ctx = run.get("execution_context") or {}
    print(f"today: first check {run['status']}:", (ctx.get("kept") or {}).get("message"), "|", (ctx.get("sweep") or {}).get("message"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod")
    parser.add_argument("--tz", default="Asia/Kolkata")
    parser.add_argument("--at", default="08:00")
    parser.add_argument("--skip-mail", action="store_true")
    parser.add_argument("--skip-meetings", action="store_true")
    parser.add_argument("--skip-today", action="store_true")
    args = parser.parse_args()
    if args.pod:
        POD.extend(["--pod", args.pod])
    if not args.skip_mail:
        mail(args.tz)
    if not args.skip_meetings:
        meetings(args.tz)
    if not args.skip_today:
        today(args.tz, args.at)


if __name__ == "__main__":
    main()
