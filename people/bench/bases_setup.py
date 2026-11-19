"""Set up Mail and Meetings on their samples in the Lemma this plugin's
bin/lemma is bound to, from the CLI, the way their apps do: load each sample,
start each set-up, answer its forms. People map's own set-up comes after.

Uses people/bin/lemma, never mail/bin/lemma or meetings/bin/lemma, which are
pinned to their own Lemmas. Mail's category set and rules are its bench's
(read from ../mail/bench, never written). From people/:

    uv run --no-project python bench/bases_setup.py [mail|meetings]
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
MAIL_BENCH = HERE.parent.parent / "mail" / "bench"
ZONE = "Asia/Kolkata"


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
        time.sleep(5)
    raise TimeoutError(run_id)


def mail() -> None:
    t0 = time.monotonic()
    print("mail sample:", cli("functions", "run", "mail_sample_data", "--data", '{"mode":"load"}').get("output_data", {}).get("message"))
    run = cli("workflows", "run", "mail-setup", "--no-wait", "--data", json.dumps({"provider": "sample", "timezone": ZONE}))
    run_id = run["id"]
    run = wait(run_id, {"categories"})
    proposals = run["execution_context"]["proposals"]
    wanted = json.loads((MAIL_BENCH / "categories.json").read_text())
    cats = [{"key": c["key"], "name": c["name"], "sentence": c["sentence"], "keep": True} for c in wanted]
    cats += [{**c, "keep": False} for c in proposals["categories"] if c["key"] not in {w["key"] for w in wanted}]
    vips = [dict(v, keep=v["email"] in ("mira@northgate-vc.example", "eleanor@parkhill.example", "aisha@quill-partners.example"))
            for v in proposals["vips"]]
    rules = [{"text": r["text"], "scope": r["scope"], "keep": True} for r in json.loads((MAIL_BENCH / "rules.json").read_text())]
    rules += [dict(r, keep=False) for r in proposals["rules"]]
    form = RESULTS / "mail_categories_form.json"
    form.parent.mkdir(exist_ok=True)
    form.write_text(json.dumps({"categories": cats, "voice": proposals["voice"], "rules": rules, "vips": vips}, indent=1))
    cli("workflows", "runs", "submit-form", run_id, "--node", "categories", "--file", str(form))
    run = wait(run_id, {"drafts"})
    cli("workflows", "runs", "submit-form", run_id, "--node", "drafts",
        "--data", json.dumps({"draft_categories": ["vip", "people", "fundraising", "customers", "hiring"]}))
    run = wait(run_id, set())
    print("mail set-up:", run["status"], f"{time.monotonic() - t0:.0f}s", json.dumps(run["execution_context"].get("done"))[:300])


def meetings() -> None:
    t0 = time.monotonic()
    out = cli("functions", "run", "meetings_sample_data", "--data", json.dumps({"mode": "load", "timezone": ZONE, "display_name": "Sam"}))
    print("meetings sample:", out.get("output_data", {}).get("message"))
    run = cli("workflows", "run", "meetings-setup", "--no-wait", "--data", json.dumps({"provider": "sample", "timezone": ZONE}))
    run_id = run["id"]
    run = wait(run_id, {"kinds"})
    cli("workflows", "runs", "submit-form", run_id, "--node", "kinds",
        "--data", json.dumps({"kinds_on": ["customer", "investor", "candidate", "partner"]}))
    run = wait(run_id, {"timing"})
    cli("workflows", "runs", "submit-form", run_id, "--node", "timing", "--data", json.dumps({"brief_when": "evening_before"}))
    run = wait(run_id, {"after"})
    cli("workflows", "runs", "submit-form", run_id, "--node", "after", "--data", json.dumps({"notes_from": "notes"}))
    run = wait(run_id, set())
    print("meetings set-up:", run["status"], f"{time.monotonic() - t0:.0f}s")


if __name__ == "__main__":
    which = sys.argv[1:] or ["mail", "meetings"]
    if "mail" in which:
        mail()
    if "meetings" in which:
        meetings()
