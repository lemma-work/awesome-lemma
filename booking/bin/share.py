#!/usr/bin/env python3
"""Copy bin/shared/<name>.py into every function that marks it.

A function deploys alone, from its own code.py, so code two functions share is
written once in bin/shared/ and copied between `# shared:<name>` and
`# end shared` in each code.py that carries those markers.

    uv run --no-project python bin/share.py [--check]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
check = "--check" in sys.argv[1:]
stale = []
for code in sorted(ROOT.glob("functions/*/code.py")):
    text = code.read_text()

    def swap(match: re.Match) -> str:
        source = (ROOT / "bin" / "shared" / f"{match.group(1)}.py").read_text().strip("\n")
        return source

    new = re.sub(r"^# shared:([a-z_]+)\n.*?^# end shared$", swap, text, flags=re.S | re.M)
    if new != text:
        stale.append(code.relative_to(ROOT))
        if not check:
            code.write_text(new)
for path in stale:
    print(("stale  " if check else "shared ") + str(path))
sys.exit(1 if check and stale else 0)
