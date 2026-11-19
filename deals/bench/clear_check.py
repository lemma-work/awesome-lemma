"""Count every table Deal tracker and its bases write, run deals_sample_data
clear, and count again: only Deal tracker's sample rows (and its own rows read
from the sample mailbox and calendar, and its needs_you items about them) may
go. From deals/:

    uv run --no-project python bench/clear_check.py
"""
import json
import subprocess
from pathlib import Path

LEMMA = str(Path(__file__).resolve().parent.parent / "bin" / "lemma")
TABLES = ["deal", "deals_history", "deals_note", "deals_change", "deals_read", "deals_correction", "deals_sample_row",
          "deals_stage", "deals_settings", "deals_member", "deals_review", "conversation", "message", "meeting", "person",
          "person_handle", "promise", "company", "company_domain", "people_person", "people_link", "mail_thread"]


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def counts() -> dict:
    sql = " UNION ALL ".join(f"SELECT '{t}' AS t, COUNT(*) AS n FROM {t}" for t in TABLES)
    sql += " UNION ALL SELECT 'needs_you (deals)', COUNT(*) FROM needs_you WHERE source_plugin = 'deals'"
    sql += " UNION ALL SELECT 'deal (sample)', COUNT(*) FROM deal WHERE source = 'sample'"
    return {r["t"]: r["n"] for r in cli("query", "run", sql)["items"]}


before = counts()
out = cli("functions", "run", "deals_sample_data", "--data", '{"mode":"clear"}')
after = counts()
print("clear:", out.get("status"), (out.get("output_data") or {}).get("message"))
for t in before:
    mark = "" if before[t] == after[t] else "  <- changed"
    print(f"  {t:20} {before[t]:5} -> {after[t]:5}{mark}")
