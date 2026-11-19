"""Clear every sample and count what is left: Meetings' clear, Mail's clear,
then People map's (which also tidies what their clears left in People map's
tables). Run in a Lemma with all three samples loaded. Pass --mail-first to
clear Mail before Meetings. From people/:
    uv run --no-project python bench/clear_leaves_nothing.py [--mail-first]
"""
import sys
import json
import subprocess
from pathlib import Path

LEMMA = str(Path(__file__).resolve().parent.parent / "bin" / "lemma")
TABLES = ["people_person", "people_fact", "people_correction", "people_link", "people_company", "people_sample_contact",
          "company", "company_domain", "person", "person_handle", "conversation", "message", "meeting", "promise"]


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def counts() -> dict:
    sql = "select " + ", ".join(f"(select count(*) from {t}) as {t}" for t in TABLES)
    return cli("query", "run", sql)["items"][0]


def run(fn: str, data: dict) -> str:
    d = cli("functions", "run", fn, "--data", json.dumps(data))
    return str((d.get("output_data") or d).get("message"))


print("before ", counts())
order = ["mail", "meetings"] if "--mail-first" in sys.argv else ["meetings", "mail"]
for base in order:
    print(f"{base}:", run(f"{base}_sample_data", {"mode": "clear"}))
print("after bases", counts())
print("people:  ", run("people_sample_data", {"mode": "clear"}))
print("after all  ", counts())
