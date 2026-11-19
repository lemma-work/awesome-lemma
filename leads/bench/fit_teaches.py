"""Does a fit correction teach the next score? Scores every company the
person has leads at again (fresh Decisions calls), corrects one, scores the
rest again, and prints before and after. From leads/, with leads in
the Lemma (sample or real):

    uv run --no-project python bench/fit_teaches.py "<company to correct>" <score>
"""
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = str(HERE.parent / "bin" / "lemma")
sys.path.insert(0, str(HERE))
from q import query  # noqa: E402


def run(name: str, data: dict) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", "functions", "run", name, "--data", json.dumps(data)],
                         capture_output=True, text=True)
    text = out.stdout
    if "{" not in text:
        raise SystemExit(out.stderr[-1500:] or text[-1500:])
    body = json.loads(text[text.index("{"):])
    return body.get("output_data") or body


def scores() -> dict[str, tuple]:
    rows = query("select c.name as company, f.id as company_id, f.fit, f.fit_confidence, f.fit_by, f.fit_why "
                 "from leads_company f join company c on c.id = f.id where f.fit_by is not null order by c.name")
    return {r["company"]: (r["fit"], r["fit_confidence"], r["fit_by"], r["fit_why"], r["company_id"]) for r in rows}


def rescore_all(skip: str | None = None) -> None:
    for name, (_, _, by, _, cid) in scores().items():
        if name != skip and by != "person":
            run("leads_fit", {"company_id": cid, "again": True, "wait_seconds": 0, "last": True})


def show(title: str, s: dict) -> None:
    print(f"\n{title}")
    for name, (score, conf, by, why, _) in s.items():
        print(f"  {name:24} {score} {'' if conf is None else f'{conf:.2f}':5} {by:8} {why}")


if __name__ == "__main__":
    target, to = sys.argv[1], int(sys.argv[2])
    t0 = time.monotonic()
    rescore_all()
    before = scores()
    show("before", before)
    cid = before[target][4]
    person = query(f"select id from leads_person where company_id = '{cid}' limit 1")[0]["id"]
    print("\ncorrect:", run("leads_correct", {"person_id": person, "fit": to}).get("message"))
    rescore_all(skip=target)
    after = scores()
    show("after", after)
    print("\nmoved:")
    for name, (score, conf, by, _, _) in after.items():
        b = before.get(name)
        if b and (b[0], round(b[1] or 0, 2)) != (score, round(conf or 0, 2)):
            print(f"  {name:24} {b[0]} ({(b[1] or 0):.2f}) -> {score} ({(conf or 0):.2f})")
    print(f"\n{time.monotonic() - t0:.0f}s")
