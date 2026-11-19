#!/usr/bin/env python3
"""Copy shared code into each function, between its markers, word for word.

  _shared/colour.py              between `# --- colour:` and `# --- end colour ---`
  _shared/theme.py               between `# --- theme:` and `# --- end theme ---`
  _shared/sample/*               as SAMPLE_FILES, between `# --- sample:` and `# --- end sample ---`
  _shared/*.md (the playbooks)   between `# --- playbooks:` and `# --- end playbooks ---`
  _contract/snippets/<name>.py   between `# contract:<name>` and `# end contract`
  .lemma/agents-block.md, .lemma/guide.md   as AGENTS_BLOCK and AGENTS_GUIDE

A function is one code.py, so code two of them use is copied, not imported;
this keeps the copies identical (the contract's lint checks the contract's).
Run with `uv run --no-project python bin/embed.py` from the plugin folder.
"""
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
COLOUR = (HERE / "_shared" / "colour.py").read_text().strip("\n")
THEME = (HERE / "_shared" / "theme.py").read_text().strip("\n")


def _literal(text: str) -> str:
    return '"""\\\n' + text.replace("\\", "\\\\").replace('"""', '\\"\\"\\"') + '"""'


PLAYBOOKS = ("# --- playbooks: (embedded by bin/embed.py from _shared/*.md) ---\n"
             f"READING = {_literal((HERE / '_shared' / 'reading-a-brand.md').read_text())}\n\n"
             f"MAKING = {_literal((HERE / '_shared' / 'making-a-design.md').read_text())}\n"
             "# --- end playbooks ---")
SNIPPETS = HERE.parent / "_contract" / "snippets"
SAMPLE = ("# --- sample: (embedded by bin/embed.py from _shared/sample/) ---\n"
          "SAMPLE_FILES = {\n" + "".join(f"    {p.name!r}: {_literal(p.read_text())},\n" for p in sorted((HERE / "_shared" / "sample").iterdir()) if p.is_file())
          + "}\n# --- end sample ---")
# The memory block and its guide (_contract/README.md, "Memory block"): the
# set-up function holds them as AGENTS_BLOCK and AGENTS_GUIDE.
MEMORY = {name: (HERE / ".lemma" / file).read_text().strip() for name, file in
          (("AGENTS_BLOCK", "agents-block.md"), ("AGENTS_GUIDE", "guide.md")) if (HERE / ".lemma" / file).is_file()}

for code in sorted(HERE.glob("functions/*/code.py")):
    text = code.read_text()
    before = text
    text = re.sub(r"^# --- colour:.*?^# --- end colour ---$", lambda _: COLOUR, text, flags=re.S | re.M)
    text = re.sub(r"^# --- theme:.*?^# --- end theme ---$", lambda _: THEME, text, flags=re.S | re.M)
    text = re.sub(r"^# --- sample:.*?^# --- end sample ---$", lambda _: SAMPLE, text, flags=re.S | re.M)
    text = re.sub(r"^# --- playbooks:.*?^# --- end playbooks ---$", lambda _: PLAYBOOKS, text, flags=re.S | re.M)
    for marker in re.findall(r"^# contract:([a-z0-9-]+)$", text, re.M):
        snippet = SNIPPETS / f"{marker}.py"
        if snippet.is_file():
            body = snippet.read_text().strip("\n")
            text = re.sub(rf"^# contract:{marker}$.*?^# end contract$", lambda _: body, text, flags=re.S | re.M)
    if "# contract:agents-md" in text or "agents_md_write(" in text:
        for name, value in MEMORY.items():
            text = re.sub(rf'^{name} = (?:""|"""\\\n.*?"""|\'.*?\')$', lambda _: f"{name} = {_literal(value + chr(10))}", text, flags=re.S | re.M)
    if text != before:
        code.write_text(text)
        print(f"embedded  {code.relative_to(HERE)}")
