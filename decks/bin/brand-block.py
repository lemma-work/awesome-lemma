#!/usr/bin/env python3
"""Put bin/brand_block.py, word for word, into every function that reads the
brand (between `# decks:brand` and `# end decks:brand`), or with --check fail
on any difference. Run with `uv run --no-project python bin/brand-block.py`."""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
BLOCK = (HERE / "bin" / "brand_block.py").read_text().strip() + "\n"
READERS = ["decks_make", "decks_plan"]
check = "--check" in sys.argv
bad = []
for name in READERS:
    path = HERE / "functions" / name / "code.py"
    text = path.read_text()
    pattern = re.compile(r"^# decks:brand\n.*?^# end decks:brand\n", re.S | re.M)
    if not pattern.search(text):
        bad.append(f"{name}: no `# decks:brand` block")
        continue
    if pattern.search(text).group(0) == BLOCK:
        continue
    if check:
        bad.append(f"{name}: its brand block differs from bin/brand_block.py")
    else:
        path.write_text(pattern.sub(lambda _: BLOCK, text, count=1))
        print(f"wrote the brand block into {name}")
if bad:
    sys.exit("\n".join(bad))
print("brand block: " + ("matches" if check else "in place") + " in " + ", ".join(READERS))
