#!/usr/bin/env python3
"""Copy User interviews' shared helpers into every function, word for word.

    uv run --no-project python bin/common.py          # write them in
    uv run --no-project python bin/common.py --check  # fail if any differs

A Lemma function is one file: it cannot import a neighbour. So the helpers
every User interviews function needs (ids, SQL quoting, dates, the settings
row, the contact rules) live here once, as COMMON, and sit in each
functions/<name>/code.py between `# interviews:common` and
`# end interviews:common`. Edit them here, never there.

Larger shared parts live in the one function that owns them and are copied
from there into the others that need them (BLOCKS below): what needs the
member in Today (owned by interviews_daily) and the booking match (owned by
interviews_on_meeting). It also fills each `# contract:<name>` ...
`# end contract` with `_contract/snippets/<name>.py` word for word (the lint
checks those).
"""
import re
import sys
from pathlib import Path

COMMON = '''# interviews:common
# Shared by every User interviews function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from zoneinfo import ZoneInfo as _Zone

INTERVIEWS_NS = _uuid.UUID("119b800c-47d6-43fe-9576-6e281b149300")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
SETTINGS_ID = str(_uuid.uuid5(INTERVIEWS_NS, "settings"))
PLUGIN = "user-interviews"
APP = "interviews"
# A person who asked never to hear from us again rests until then.
NEVER = "2100-01-01T00:00:00+00:00"
ZONE_ALIASES = {"Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Europe/Kiev": "Europe/Kyiv",
                "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"}
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com",
            "proton.me", "protonmail.com", "aol.com"}
# Stages before an invite went out: the contact rules can still hold them back.
NOT_SENT = ("fits", "drafted")


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(INTERVIEWS_NS, ":".join(str(p) for p in parts)))


def person_row_id(study_id, handle_kind, handle) -> str:
    return str(_uuid.uuid5(INTERVIEWS_NS, f"{study_id}:{handle_kind}:{str(handle).strip().lower()}"))


def quote_key(quote) -> str:
    """The contract's quote key: sha1 of the quote lowercased, whitespace collapsed, first 16 hex."""
    return _hashlib.sha1(" ".join(str(quote or "").lower().split()).encode("utf-8")).hexdigest()[:16]


def feedback_row_id(source, source_id, quote) -> str:
    """The contract's id for a `feedback` row (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


def q_all(pod, sql: str, page: int = 1000, most: int = 20000) -> list:
    """Every row of a read, a page at a time (a read answers at most 1000)."""
    out: list = []
    while len(out) < most:
        got = q(pod, f"{sql} LIMIT {page} OFFSET {len(out)}")
        out += got
        if len(got) < page:
            break
    return out


def lit(value) -> str:
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def lits(values) -> str:
    return ", ".join(lit(v) for v in values) or "NULL"


def as_dict(obj) -> dict:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        obj = obj.to_dict()
    return obj if isinstance(obj, dict) else {}


def jl(value, default=None):
    """A JSON column as Python, whether the API handed back text or JSON."""
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return _json.loads(value)
    except (TypeError, ValueError):
        return default


def now_utc() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now_utc().isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def zone(name) -> _Zone:
    try:
        return _Zone(ZONE_ALIASES.get(str(name or ""), str(name or "UTC")))
    except Exception:  # noqa: BLE001 - an unknown zone reads as UTC
        return _Zone("UTC")


def day_said(value, tz="UTC") -> str:
    """26 Nov (and the year when it isn't this one)."""
    moment = stamp(value)
    if not moment:
        return ""
    local = moment.astimezone(zone(tz))
    text = f"{local.day} {local.strftime('%b')}"
    return text if local.year == now_utc().astimezone(zone(tz)).year else f"{text} {local.year}"


def clip(value, n: int):
    text = " ".join(str(value if value is not None else "").split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "\\u2026"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def first_name(name, handle=None) -> str:
    text = str(name or "").strip()
    if text:
        return text.split()[0]
    return str(handle or "someone").split("@")[0]


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM interviews_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM interviews_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["invite_gap_days"] = int(s.get("invite_gap_days") or 30)
    s["no_show_days"] = int(s.get("no_show_days") or 90)
    s["nudge_days"] = int(s.get("nudge_days") or 4)
    return s


def fn(pod, name: str, payload: dict) -> dict:
    """Run another function of this Lemma (as the same person); its output."""
    return as_dict(as_dict(pod.functions.run(name, payload)).get("output_data"))


def start_read(pod, person_id: str) -> None:
    """Read one call for findings: the interviews-read workflow, as the person running this."""
    pod.workflows.run("interviews-read", about=("interviews_person", person_id))


def rest_for(row: dict, others: list, s: dict, now=None):
    """Whether the contact rules hold this person back in this study, and why.

    `others` are every study's rows for the same handle. Never after they
    opted out (anywhere); not for no_show_days after a no-show; not within
    invite_gap_days of an invite sent from another study. A person's
    override lets them through the last two, never the first."""
    now = now or now_utc()
    if row.get("stage") not in NOT_SENT:
        return None, None
    out = [o for o in others if o.get("stage") == "opted_out"]
    if out:
        return NEVER, "Asked not to be invited again"
    override = stamp(row.get("override_at"))
    found = []
    for o in others:
        if o.get("id") == row.get("id"):
            continue
        missed = stamp(o.get("no_show_at"))
        if missed and (not override or override < missed):
            until = missed + _timedelta(days=s["no_show_days"])
            if until > now:
                found.append((until, f"Missed a call on {day_said(missed)}"))
        sent = stamp(o.get("invited_at"))
        if sent and (not override or override < sent):
            until = sent + _timedelta(days=s["invite_gap_days"])
            if until > now:
                found.append((until, f"Invited {day_said(sent)} to another study"))
    if not found:
        return None, None
    until, rule = max(found, key=lambda f: f[0])
    return until.isoformat(), rule


def rest_refresh(pod, s: dict, handles) -> int:
    """Work the contact rules out again for every row of these handles; the rows that changed."""
    handles = sorted({str(h).lower() for h in handles if h})
    changed = 0
    for start in range(0, len(handles), 100):
        got = q_all(pod, "SELECT id, handle, stage, invited_at, no_show_at, override_at, rests_until, rest_rule "
                         f"FROM interviews_person WHERE handle IN ({lits(handles[start:start + 100])}) ORDER BY id")
        by: dict = {}
        for r in got:
            by.setdefault(str(r.get("handle") or "").lower(), []).append(r)
        updates = []
        for group in by.values():
            for r in group:
                until, rule = rest_for(r, group, s)
                if (stamp(until) != stamp(r.get("rests_until"))) or (rule or None) != (r.get("rest_rule") or None):
                    updates.append({"id": r["id"], "rests_until": until, "rest_rule": rule})
        for i in range(0, len(updates), 100):
            pod.records.bulk_update("interviews_person", updates[i:i + 100])
        changed += len(updates)
    return changed


def is_resting(row: dict, now=None) -> bool:
    until = stamp(row.get("rests_until"))
    return bool(until and until > (now or now_utc()) and row.get("stage") in NOT_SENT)


def norm_text(text) -> str:
    """For checking a quote against a document word for word (Meetings' rule):
    spacing, case and quote marks aside."""
    text = str(text or "").replace("\\u2019", "'").replace("\\u2018", "'").replace("\\u201c", '"').replace("\\u201d", '"')
    text = text.replace("\\u2014", "-").replace("\\u2013", "-")
    return " ".join(text.split()).lower().strip(" .\\"'")


TIME_LINE = _re.compile(r"^\\s*\\[(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\]\\s*(?:([^:\\n]{1,60}):\\s*)?(.*)$")


def line_time(line: str):
    """Seconds into the call of a '[m:ss] Speaker: words' line (h:mm:ss past an hour), its speaker and words."""
    m = TIME_LINE.match(line or "")
    if not m:
        return None, None, line
    a, b, c, who, words = m.groups()
    secs = int(a) * 3600 + int(b) * 60 + int(c) if c is not None else int(a) * 60 + int(b)
    return secs, (who or "").strip() or None, words


def mm_ss(secs) -> str:
    if secs is None:
        return ""
    secs = int(secs)
    h, rest = divmod(secs, 3600)
    m, s_ = divmod(rest, 60)
    return f"{h}:{m:02d}:{s_:02d}" if h else f"{m}:{s_:02d}"
# end interviews:common
'''

PATTERN = re.compile(r"^# interviews:common\n.*?^# end interviews:common\n", re.S | re.M)

# Larger shared parts: name -> the function that owns (and edits) it.
BLOCKS = {"needs": "interviews_daily", "booking": "interviews_on_meeting"}


def block_pattern(name: str):
    return re.compile(rf"^# interviews:{name}\n.*?^# end interviews:{name}\n", re.S | re.M)


def contract_snippets(root: Path) -> dict:
    out = {}
    for path in sorted((root.parent / "_contract" / "snippets").glob("*.py")):
        found = re.search(r"^# contract:[a-z0-9-]+\n.*?^# end contract\n", path.read_text(), re.S | re.M)
        if found:
            out[path.stem] = found.group(0)
    return out


def _py_text(text: str) -> str:
    """As _contract/lint.py writes it with --fix."""
    if '"""' in text or "\\" in text or text.endswith('"'):
        return repr(text)
    return '"""\\\n' + text + '\n"""'


def memory_texts(root: Path, text: str) -> str:
    """AGENTS_BLOCK and AGENTS_GUIDE in the memory function, from .lemma/ (the
    lint's --fix does the same, but across every plugin)."""
    import ast
    wanted = {"AGENTS_BLOCK": (root / ".lemma" / "agents-block.md").read_text().strip(),
              "AGENTS_GUIDE": (root / ".lemma" / "guide.md").read_text().strip()}
    tree = ast.parse(text)
    lines = text.splitlines(keepends=True)
    edits = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in wanted and ast.literal_eval(node.value) != wanted[name]:
                edits.append((node.lineno, node.end_lineno, f"{name} = {_py_text(wanted[name])}\n"))
    for start, end, new in sorted(edits, reverse=True):
        lines[start - 1:end] = [new]
    return "".join(lines)


def main() -> int:
    check = "--check" in sys.argv[1:]
    root = Path(__file__).resolve().parent.parent
    snippets = contract_snippets(root)
    blocks = {}
    for name, owner in BLOCKS.items():
        found = block_pattern(name).search((root / "functions" / owner / "code.py").read_text())
        if not found:
            sys.exit(f"functions/{owner}/code.py has no '# interviews:{name}' block")
        blocks[name] = found.group(0)
    bad = 0
    for code in sorted(root.glob("functions/*/code.py")):
        text = code.read_text()
        fresh = PATTERN.sub(lambda _m: COMMON, text, count=1) if "# interviews:common" in text else text
        for name, body in blocks.items():
            if f"# interviews:{name}\n" in fresh:
                fresh = block_pattern(name).sub(lambda _m: body, fresh, count=1)
        for name, body in snippets.items():
            fresh = re.sub(rf"^# contract:{name}\n.*?^# end contract\n", lambda _m: body, fresh, count=1, flags=re.S | re.M)
        if code.parent.name == "interviews_memory":
            fresh = memory_texts(root, fresh)
        if fresh != text:
            if check:
                print(f"differs: {code.relative_to(root)}")
                bad += 1
            else:
                code.write_text(fresh)
                print(f"wrote {code.relative_to(root)}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
