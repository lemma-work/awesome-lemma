"""Score every company again (fresh Decisions calls) and print the scores.
    uv run --no-project python bench/fit_rescore.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fit_teaches import rescore_all, scores, show  # noqa: E402

rescore_all()
show("now", scores())
