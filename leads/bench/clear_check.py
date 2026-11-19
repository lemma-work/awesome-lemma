"""Does clearing the sample remove only what it made? Snapshots every table
Lead research touches, clears the sample (leads_sample_data, then
leads_needs_you as the app does), snapshots again and compares. From
leads/, with the sample loaded:

    uv run --no-project python bench/clear_check.py
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = str(HERE.parent / "bin" / "lemma")
sys.path.insert(0, str(HERE))
from q import query  # noqa: E402

KEEP = ["person", "person_handle", "people_person", "company", "company_domain", "people_company", "conversation",
        "message", "meeting", "leads_settings", "leads_profile"]


def run(name: str, data: dict) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", "functions", "run", name, "--data", json.dumps(data)],
                         capture_output=True, text=True)
    body = json.loads(out.stdout[out.stdout.index("{"):])
    return body.get("output_data") or body


def snapshot() -> dict:
    snap = {t: query(f"select count(*) as n from {t}")[0]["n"] for t in KEEP}
    snap["leads"] = {r["id"]: (r["state"], r["sample"], r["found"]) for r in query(
        "select id, state, sample, found from leads_person")}
    snap["companies"] = {r["id"]: r["sample"] for r in query("select id, sample from leads_company")}
    snap["fits"] = {r["id"]: r["fit"] for r in query("select id, fit from leads_company where fit is not null")}
    snap["corrections"] = {r["id"]: r["sample"] for r in query("select id, sample from leads_correction")}
    snap["needs"] = {r["source_id"]: r["state"] for r in query(
        "select source_id, state from needs_you where source_plugin = 'leads'")}
    return snap


before = snapshot()
print("clear:", run("leads_sample_data", {"mode": "clear"}).get("message"))
print("needs_you:", run("leads_needs_you", {}).get("message"))
after = snapshot()

ok = True
for t in KEEP:
    same = before[t] == after[t]
    ok &= same
    print(f"{t:16} {before[t]:5} -> {after[t]:5} {'same' if same else 'CHANGED'}")
sample_leads = {i for i, (_, s, _) in before["leads"].items() if s}
real_leads = {i: v for i, v in before["leads"].items() if not v[1]}
gone = sample_leads - set(after["leads"])
restored = {i: after["leads"][i] for i in sample_leads & set(after["leads"])}
kept_real = all(after["leads"].get(i) == v for i, v in real_leads.items())
ok &= kept_real and all(not v[1] for v in after["leads"].values())
print(f"leads: {len(before['leads'])} -> {len(after['leads'])}; sample {len(sample_leads)}: {len(gone)} removed, "
      f"{len(restored)} put back as before ({sorted({v[0] for v in restored.values()})}); "
      f"every other lead unchanged: {kept_real}")
sample_cos = {i for i, s in before["companies"].items() if s}
real_cos = {i for i, s in before["companies"].items() if not s}
ok &= not (sample_cos & set(after["companies"])) and real_cos <= set(after["companies"])
print(f"company facts: {len(before['companies'])} -> {len(after['companies'])}; sample {len(sample_cos)} removed, "
      f"real {len(real_cos)} kept: {real_cos <= set(after['companies'])}")
fits_gone = set(before["fits"]) - set(after["fits"])
ok &= fits_gone <= sample_cos and all(after["fits"].get(c) == before["fits"][c] for c in before["fits"] if c not in sample_cos)
print(f"fits: {len(before['fits'])} -> {len(after['fits'])}; removed only sample companies' fits: {fits_gone <= sample_cos}")
print(f"corrections: {len(before['corrections'])} -> {len(after['corrections'])}; "
      f"sample ones removed: {not any(after['corrections'].values())}")
opened = {i for i, s in before["needs"].items() if s == "open" and i in sample_leads}
ok &= all(after["needs"].get(i) == "done" for i in opened)
print(f"needs_you: {len(opened)} sample items open -> done: {all(after['needs'].get(i) == 'done' for i in opened)}")
print("OK" if ok else "PROBLEM")
