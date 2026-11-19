"""Run a read-only SQL query in this Lemma (bin/lemma) and print rows, one per line.
    uv run --no-project python bench/q.py "select ..."
"""
import json
import subprocess
import sys
from pathlib import Path

LEMMA = str(Path(__file__).resolve().parent.parent / "bin" / "lemma")


def query(sql: str) -> list[dict]:
    out = subprocess.run([LEMMA, "--output", "json", "query", "run", sql], capture_output=True, text=True)
    text = out.stdout
    if "{" not in text and "[" not in text:
        raise SystemExit(out.stderr[-2000:] or text[-2000:])
    data = json.loads(text[min(i for i in (text.find("{"), text.find("[")) if i >= 0):])
    return data.get("items", data) if isinstance(data, dict) else data


if __name__ == "__main__":
    for row in query(sys.argv[1]):
        print(" | ".join("" if v is None else str(v) for v in row.values()))
