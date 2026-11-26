#!/usr/bin/env python3
"""Copy User feedback's shared code into every function that uses it.

A function is one file on the server, so helpers cannot be imported from a
sibling. Each function's code.py carries

  - the common block (bin/blocks/common.py) between `# user-feedback:common`
    and `# end user-feedback:common`, and
  - where it writes `needs_you`, the contract's snippet
    (_contract/snippets/needs-you.py) between `# contract:needs-you` and
    `# end contract`, word for word;
  - where it reads a passage, the reader block (bin/blocks/reader*.py, with the
    contract's feedback-read questions embedded word for word between
    `# contract:feedback-read` and `# end contract`) between
    `# user-feedback:reader` and `# end user-feedback:reader`.

This script writes them there (run it after editing a block or the contract),
and `--check` fails when a copy differs.

    uv run --no-project python bin/common.py [--check]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
BLOCKS = HERE / "bin" / "blocks"
CONTRACT = HERE.parent / "_contract" / "questions" / "feedback-read.json"

COMMON_MARK = re.compile(r"^# user-feedback:common\n.*?^# end user-feedback:common\n", re.S | re.M)
READER_MARK = re.compile(r"^# user-feedback:reader\n.*?^# end user-feedback:reader\n", re.S | re.M)
NEEDS_MARK = re.compile(r"^# contract:needs-you\n.*?^# end contract\n", re.S | re.M)
NEEDS = HERE.parent / "_contract" / "snippets" / "needs-you.py"


def reader_block() -> str:
    spec = json.loads(CONTRACT.read_text())
    embed = ("# contract:feedback-read\nREAD = _json.loads(r'''\n" + json.dumps(spec, indent=1, ensure_ascii=False)
             + "\n''')\n# end contract\n")
    return (BLOCKS / "reader_head.py").read_text() + embed + (BLOCKS / "reader.py").read_text()


def main() -> int:
    check = "--check" in sys.argv[1:]
    common = (BLOCKS / "common.py").read_text()
    reader = reader_block()
    needs = NEEDS.read_text()
    stale = []
    for code in sorted((HERE / "functions").glob("*/code.py")):
        text = code.read_text()
        new = COMMON_MARK.sub(lambda _m: common, text)
        new = READER_MARK.sub(lambda _m: reader, new)
        new = NEEDS_MARK.sub(lambda _m: needs, new)
        if new != text:
            stale.append(code.parent.name)
            if not check:
                code.write_text(new)
    if check and stale:
        print("stale shared code in: " + ", ".join(stale))
        return 1
    print(("current" if check else f"wrote {len(stale)} function(s)") if not check or not stale else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
