"""Does a correction teach the read? Re-read a few people, correct two others
(Lucia Romano, who introduced an investor, to partner; Grace Tan, who quotes
the owner for design work, to vendor), and re-read the same people again.
From people/:  uv run --no-project python bench/correction_teaches.py
"""
import json
import subprocess
from pathlib import Path

LEMMA = str(Path(__file__).resolve().parent.parent / "bin" / "lemma")


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def run(fn: str, data: dict) -> dict:
    d = cli("functions", "run", fn, "--data", json.dumps(data))
    return d.get("output_data") or d


ids = {r["name"]: r["id"] for r in cli("query", "run",
       "select pp.id, p.name from people_person pp join person p on p.id = pp.id")["items"]}
probe = [n for n in ("Rafael Costa", "Ruth Adeyemi", "Inès Moreau", "Jonas Weber", "Hannah Volkov", "Bea Novak") if n in ids]


def show(label: str, out: dict) -> None:
    print(label, f"({out.get('calls')} calls, {out.get('call_seconds')}s)")
    for x in out["detail"]:
        print(f"  {x['name']:<16} {x['kind'] or '-':<10} {x['kind_confidence'] or 0:.2f}   deal_with {x['deal_with']} {x['deal_with_confidence'] or 0:.2f}")


show("before", run("people_sort", {"person_ids": [ids[n] for n in probe], "detail": True}))
print(run("people_correct", {"person_id": ids["Lucia Romano"], "kind": "partner"})["message"])
print(run("people_correct", {"person_id": ids["Grace Tan"], "kind": "vendor"})["message"])
show("after", run("people_sort", {"person_ids": [ids[n] for n in probe], "detail": True}))
