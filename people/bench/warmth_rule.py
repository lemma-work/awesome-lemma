"""The warmth rule, checked without a Lemma: people_refresh's own functions on
made-up contact days. From people/:
    uv run --no-project --with pydantic python bench/warmth_rule.py
"""
import importlib.util
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.modules["lemma_sdk"] = types.SimpleNamespace(FunctionContext=object)
spec = importlib.util.spec_from_file_location("refresh", Path(__file__).resolve().parent.parent / "functions/people_refresh/code.py")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)

now = datetime(2026, 11, 18, tzinfo=timezone.utc)
d = lambda n: now - timedelta(days=n)  # noqa: E731
cases = [
    ("burst of 3 days, 5 days ago (one episode)", [d(7), d(6), d(5)], False),
    ("every 14 days, last 10 days ago", [d(66), d(52), d(38), d(24), d(10)], False),
    ("every 14 days, last 30 days ago", [d(86), d(72), d(58), d(44), d(30)], False),
    ("every 14 days, last 49 days ago", [d(105), d(91), d(77), d(63), d(49)], False),
    ("monthly, last 40 days ago", [d(160), d(130), d(100), d(70), d(40)], False),
    ("monthly, last 100 days ago", [d(220), d(190), d(160), d(130), d(100)], False),
    ("one contact 25 days ago (gap unknown: two weeks)", [d(25)], False),
    ("no contact, a meeting ahead", [], True),
]
for name, days, ahead in cases:
    episodes, gap = r.episodes_of(days)
    last = max(days) if days else None
    print(f"{name:<50} episodes {episodes}  usual gap {gap!s:>5}  -> {r.warmth_of(last, gap, now, ahead)}")
