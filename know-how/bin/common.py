#!/usr/bin/env python3
"""Copy Know-how's shared helpers into every function, word for word.

    uv run --no-project python bin/common.py          # write them in
    uv run --no-project python bin/common.py --check  # fail if any differs

A Lemma function is one file: it cannot import a neighbour. So what several
Know-how functions need lives once in bin/shared/<name>.py and sits in each
functions/<name>/code.py that asks for it between `# knowhow:<name>` and
`# end knowhow:<name>`:

  common    ids, SQL helpers, the set-up row, pages, steps, the source line,
            Activity, Decisions, publishing to `article`, sheets as pages
  answer    search, which page answers, logging a question, routing a miss,
            writing a draft

Edit them there, never in a function. It also fills each `# contract:<name>`
... `# end contract` with `_contract/snippets/<name>.py` word for word (the
lint checks those). As Triage's.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def blocks() -> dict:
    out = {}
    for path in sorted((ROOT / "bin" / "shared").glob("*.py")):
        text = path.read_text()
        name = path.stem
        if not text.startswith(f"# knowhow:{name}\n") or not text.endswith(f"# end knowhow:{name}\n"):
            sys.exit(f"{path}: must start with '# knowhow:{name}' and end with '# end knowhow:{name}'")
        out[name] = text
    return out


def contract_snippets() -> dict:
    out = {}
    for path in sorted((ROOT.parent / "_contract" / "snippets").glob("*.py")):
        found = re.search(r"^# contract:[a-z0-9-]+\n.*?^# end contract\n", path.read_text(), re.S | re.M)
        if found:
            out[path.stem] = found.group(0)
    return out


def main() -> int:
    check = "--check" in sys.argv[1:]
    shared = blocks()
    snippets = contract_snippets()
    bad = 0
    for code in sorted(ROOT.glob("functions/*/code.py")):
        text = code.read_text()
        fresh = text
        for name, body in shared.items():
            fresh = re.sub(rf"^# knowhow:{name}\n.*?^# end knowhow:{name}\n", lambda _m: body, fresh, count=1, flags=re.S | re.M)
        for name, body in snippets.items():
            fresh = re.sub(rf"^# contract:{name}\n.*?^# end contract\n", lambda _m: body, fresh, count=1, flags=re.S | re.M)
        if fresh != text:
            if check:
                print(f"differs: {code.relative_to(ROOT)}")
                bad += 1
            else:
                code.write_text(fresh)
                print(f"wrote {code.relative_to(ROOT)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
