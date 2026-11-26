#input_type_name: KnowhowSampleDataInput
#output_type_name: KnowhowSampleDataResult
#function_name: knowhow_sample_data

"""load: a sample Wednesday to look around. Fernlow Lighting (fernlow.example),
a small maker of LED profiles and drivers, and its Lemma, Wren: six topics,
twenty real pages under /know-how/ (thirteen answers, four procedures, three
policies; two public, one for customers only, one HR-only), 48 questions
this month (37 answered, 6 from a page past its check date, 5 missed), three
drafts, a page that may disagree with a new datasheet, a proposed step, a
walk at step 3 of 7 and three assignments. The person who loads it gets Today
items as if they owned Priya's topic, since the sample people aren't members.
Made-up people at .example addresses; nothing is posted outside the Lemma.

clear: removes only what the sample made (every file and row it recorded in
knowhow_sample_row) and closes its Today items.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# knowhow:common
# Shared by every Know-how function, word for word: bin/common.py copies it in
# from bin/shared/common.py. Edit it there, never here.
import csv as _csv
import hashlib as _hashlib
import io as _io
import json as _json
import re as _re
import time as _time
import uuid as _uuid
import zipfile as _zipfile
from datetime import date as _date, datetime as _datetime, timedelta as _timedelta, timezone as _tz
from xml.etree import ElementTree as _ET

KNOWHOW_NS = _uuid.UUID("7ecbf850-1d71-4231-bbc3-ad76ff568d1e")
ARTICLE_NS = _uuid.UUID("60a094a9-68d4-4995-8508-e9a616fcd38c")
SETTINGS_ID = str(_uuid.uuid5(KNOWHOW_NS, "settings"))
APP = "know-how"
ROOT = "/know-how"
INBOX = "/know-how/_inbox"
DRAFTS = "/know-how/_drafts"
LIVE_STATES = ("live", "due", "may_disagree")
OPEN_QUESTION_STATES = ("new", "asked", "drafted")
WHERE_WORDS = {"teams": "Teams", "slack": "Slack", "email": "Email", "web": "Web chat", "app": "the app"}
# Files the platform stores but never indexes (its file search reads document
# formats only): named per file, and sheets get a table page beside them.
UNSEARCHABLE = {".csv": "a spreadsheet", ".xlsx": "a spreadsheet", ".xls": "an old Excel sheet", ".ods": "a spreadsheet",
                ".pptx": "slides", ".ppt": "slides", ".key": "slides", ".png": "an image", ".jpg": "an image",
                ".jpeg": "an image", ".gif": "an image", ".webp": "an image", ".heic": "an image", ".ies": "an IES light file",
                ".ldt": "a light file", ".dwg": "a drawing", ".dxf": "a drawing", ".zip": "an archive", ".json": "data"}
SHEETS = (".csv", ".xlsx")


def kid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(KNOWHOW_NS, ":".join(str(p) for p in parts)))


def article_row_id(source_id) -> str:
    """The shared `article` row's id for one Know-how page."""
    return str(_uuid.uuid5(ARTICLE_NS, f"know-how:{source_id}"))


def rows(response) -> list:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def q(pod, sql: str) -> list:
    return rows(pod.query(sql))


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


def now() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now().isoformat()


def stamp(value):
    """A datetime (UTC) from an ISO string, a Slack ts, epoch seconds or a datetime."""
    if not value:
        return None
    if isinstance(value, _datetime):
        return value if value.tzinfo else value.replace(tzinfo=_tz.utc)
    if isinstance(value, _date):
        return _datetime(value.year, value.month, value.day, tzinfo=_tz.utc)
    if isinstance(value, (int, float)):
        return _datetime.fromtimestamp(float(value), _tz.utc)
    text = str(value)
    if _re.fullmatch(r"\d{9,11}(\.\d+)?", text):
        return _datetime.fromtimestamp(float(text), _tz.utc)
    try:
        moment = _datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def iso(value):
    moment = stamp(value)
    return moment.isoformat() if moment else None


def day_of(value):
    """A date from a DATE column, an ISO string or a datetime; None when empty."""
    if not value:
        return None
    if isinstance(value, _datetime):
        return value.date()
    if isinstance(value, _date):
        return value
    try:
        return _date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def json_list(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def json_obj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def clip(text, n: int) -> str:
    t = " ".join(str(text or "").split())
    return t if len(t) <= n else t[: n - 1].rstrip() + "…"


def plural(n, one: str, many: str = "") -> str:
    n = int(n or 0)
    return f"{n} {one if n == 1 else (many or one + 's')}"


def sha(text) -> str:
    data = text if isinstance(text, bytes) else str(text or "").encode("utf-8")
    return _hashlib.sha256(data).hexdigest()


def slugify(text, n: int = 60) -> str:
    s = _re.sub(r"[^a-z0-9]+", "-", str(text or "").lower()).strip("-")
    return (s[:n].rstrip("-") or "page")


def first_name(name) -> str:
    return (str(name or "").split() or ["the owner"])[0]


def fmt_day(value) -> str:
    """3 Nov: how a date is said on a source line."""
    d = day_of(value)
    return f"{d.day} {d.strftime('%b')}" if d else ""


def settings_of(pod) -> dict:
    """The set-up row, with its JSON read and its defaults filled in."""
    found = q(pod, f"SELECT * FROM knowhow_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM knowhow_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["places"] = json_obj(s.get("places"))
    s["audiences"] = json_obj(s.get("audiences"))
    s["schedules"] = json_obj(s.get("schedules"))
    s["made"] = json_obj(s.get("made"))
    s["proposals"] = json_obj(s.get("proposals"))
    s["default_check_days"] = int(s.get("default_check_days") or 90)
    s["customer_lead_days"] = int(s.get("customer_lead_days") or 14)
    s["quiet"] = bool(s.get("quiet")) or bool(s.get("sample"))
    return s


def save_settings(pod, s: dict, fields: dict) -> None:
    """Write some set-up fields, making the row when there is none."""
    if s.get("id"):
        pod.table("knowhow_settings").update(s["id"], fields)
    else:
        pod.records.bulk_create("knowhow_settings", [{"id": SETTINGS_ID, **fields}], upsert=True)
        s["id"] = SETTINGS_ID
    s.update(fields)


def today_of(s: dict) -> _date:
    """Today in the Lemma's time zone (set-up's), else UTC."""
    zone = s.get("timezone") if isinstance(s, dict) else None
    if zone:
        try:
            from zoneinfo import ZoneInfo
            return _datetime.now(ZoneInfo(str(zone))).date()
        except Exception:  # noqa: BLE001
            pass
    return now().date()


# ---------- pages ----------

def article_of(row: dict) -> dict:
    a = dict(row or {})
    a["asks"] = [str(x) for x in json_list(a.get("asks")) if x]
    a["steps"] = [x for x in json_list(a.get("steps")) if isinstance(x, dict)]
    a["missing"] = [str(x) for x in json_list(a.get("missing")) if x]
    return a


def find_article(pod, ref) -> dict | None:
    text = str(ref or "").strip()
    if not text:
        return None
    if _re.fullmatch(r"[0-9a-fA-F-]{36}", text):
        found = q(pod, f"SELECT * FROM knowhow_article WHERE id = {lit(text)} LIMIT 1")
    else:
        found = q(pod, f"SELECT * FROM knowhow_article WHERE path = {lit(text)} LIMIT 1")
    return article_of(found[0]) if found else None


def topics_of(pod) -> list:
    return q(pod, "SELECT * FROM knowhow_topic ORDER BY position, name LIMIT 500")


def topic_of(pod, topic_id) -> dict:
    if not topic_id:
        return {}
    found = q(pod, f"SELECT * FROM knowhow_topic WHERE id = {lit(topic_id)} LIMIT 1")
    return dict(found[0]) if found else {}


def is_late(a: dict, today: _date) -> bool:
    """Past its check date: from the start of its due day."""
    if a.get("state") == "due":
        return True
    due = day_of(a.get("due_on"))
    return bool(due and due <= today)


def customer_ok(a: dict, today: _date) -> bool:
    """A customer may be given it: live, checked, in date, meant for customers."""
    due = day_of(a.get("due_on"))
    return (a.get("state") == "live" and a.get("audience") in ("customers", "public")
            and bool(a.get("checked_at")) and bool(due and due > today))


def source_line(a: dict) -> str:
    """The one line every answer carries: which page, who checked it, when."""
    title = a.get("title") or "a Know-how page"
    if a.get("kind") == "sheet":
        made = str(a.get("source_path") or "").rsplit("/", 1)[-1] or "a spreadsheet"
        return f"From the sheet *{title}*, made from {made} on {fmt_day(a.get('checked_at'))}."
    who = a.get("checked_by_name") or a.get("owner_name")
    when = fmt_day(a.get("checked_at"))
    if who and when:
        return f"From *{title}*, checked by {who} on {when}."
    if who:
        return f"From *{title}*, owned by {who}."
    return f"From *{title}*."


def late_line(a: dict) -> str:
    due = fmt_day(a.get("due_on"))
    owner = first_name(a.get("owner_name"))
    return f"Past its check date (due {due}). I've asked {owner} to look." if due else f"Past its check date. I've asked {owner} to look."


def due_after(days, start: _date | None = None) -> str:
    return ((start or now().date()) + _timedelta(days=int(days or 90))).isoformat()


def read_page(pod, path: str) -> str:
    """A page's text; '' when it can't be read."""
    try:
        raw = pod.files.download(path)
        return raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    except Exception:  # noqa: BLE001
        return ""


def ensure_folder(pod, folder: str) -> None:
    """Make a folder and its parents under /know-how when missing."""
    parts = [p for p in folder.strip("/").split("/") if p]
    path = ""
    for p in parts:
        path += "/" + p
        try:
            pod.files.get(path)
        except Exception:  # noqa: BLE001
            try:
                pod.files.create_folder(path)
            except Exception:  # noqa: BLE001
                pass


def write_page(pod, path: str, text: str, restricted: bool = False) -> None:
    """Write a page. A restricted topic's page is made RESTRICTED too: a file
    keeps its own visibility (POD by default) inside a RESTRICTED folder, and
    the topic's role reads it through its grant on the folder."""
    ensure_folder(pod, path.rsplit("/", 1)[0])
    pod.files.write_text(path, text)
    if restricted:
        try:
            from lemma_sdk.openapi_client.models.update import Update
            pod.files.update(path, Update(path=path, visibility="RESTRICTED"))
        except Exception:  # noqa: BLE001
            pass


def strip_mark(text: str) -> str:
    """The page without Know-how's first-line note ("> Made from …")."""
    lines = str(text or "").split("\n")
    while lines and lines[0].startswith("> Made from "):
        lines.pop(0)
    return "\n".join(lines).lstrip("\n")


STEP_RE = _re.compile(r"^###\s+(\d+)[.)]\s*(.+?)\s*$")


def parse_steps(text: str) -> list:
    """A procedure's steps: each `### n. Title` heading, with an optional first
    line `Who: Customer service`, and the text under it up to the next heading."""
    steps = []
    cur = None
    for line in strip_mark(text).split("\n"):
        m = STEP_RE.match(line)
        if m:
            if cur:
                steps.append(cur)
            title = m.group(2).strip()
            cur = {"n": len(steps) + 1, "anchor": slugify(f"{m.group(1)}-{title}", 80), "title": title, "who": None, "body": []}
            continue
        if cur is None:
            continue
        if line.startswith("#") and not line.startswith("###"):
            steps.append(cur)
            cur = None
            continue
        who = _re.match(r"^\s*Who:\s*(.+?)\s*$", line)
        if who and cur["who"] is None and not any(b.strip() for b in cur["body"]):
            cur["who"] = who.group(1)
            continue
        cur["body"].append(line)
    if cur:
        steps.append(cur)
    for s in steps:
        s["body"] = "\n".join(s["body"]).strip()
    return steps


def steps_cache(text: str, old: list | None = None) -> list:
    """Parsed steps with the counts kept from the old cache, matched by anchor then number."""
    by_anchor = {str(o.get("anchor")): o for o in (old or []) if isinstance(o, dict)}
    by_n = {int(o.get("n") or 0): o for o in (old or []) if isinstance(o, dict)}
    out = []
    for s in parse_steps(text):
        prev = by_anchor.get(s["anchor"]) or by_n.get(s["n"]) or {}
        out.append({"n": s["n"], "anchor": s["anchor"], "title": s["title"], "who": s["who"], "body": clip(s["body"], 1500),
                    "reached": int(prev.get("reached") or 0), "asked": int(prev.get("asked") or 0)})
    return out


def first_lines(text: str, n: int = 300) -> str:
    """A summary: the first paragraph that isn't a heading."""
    for block in _re.split(r"\n\s*\n", strip_mark(text)):
        b = block.strip()
        if b and not b.startswith("#") and not b.startswith("|"):
            return clip(_re.sub(r"[*_`>]", "", b), n)
    return ""


def add_events(pod, subject_kind: str, subject_id: str, events: list) -> int:
    """Upsert Activity lines; each {kind, key?, text, actor?, actor_name?, at?}."""
    batch = []
    for e in events:
        at = iso(e.get("at")) or now_iso()
        batch.append({
            "id": kid("event", subject_kind, subject_id, e["kind"], e.get("key") or at),
            "subject_kind": subject_kind, "subject_id": str(subject_id), "kind": e["kind"], "at": at,
            "actor": str(e.get("actor") or "lemma")[:64],
            "actor_name": e.get("actor_name") or ("Lemma" if not e.get("actor") or e.get("actor") == "lemma" else None),
            "text": clip(e.get("text"), 2000), "sample": bool(e.get("sample")),
        })
    for start in range(0, len(batch), 100):
        pod.records.bulk_create("knowhow_event", batch[start: start + 100], upsert=True)
    return len(batch)


def caller(ctx) -> dict:
    uid = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    name = getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0] or None
    return {"user_id": uid, "name": name, "email": getattr(ctx, "user_email", None),
            "contact_id": str(ctx.contact_id) if getattr(ctx, "contact_id", None) else None}


def run_function(pod, name: str, data: dict) -> dict:
    """Another Know-how function's output; {} when it could not run."""
    try:
        return as_dict(as_dict(pod.functions.run(name, data)).get("output_data"))
    except Exception:  # noqa: BLE001
        return {}


def decide_call(pod, instruction: str, schema: dict, evidence: str, examples=None) -> dict:
    """One Decisions call: {"answers": {...}} or {"error": why}. Retries a busy or unavailable service."""
    for attempt in range(4):
        try:
            got = as_dict(pod.decisions.make(instruction=instruction, schema=schema, evidence=evidence,
                                             examples=examples or None, priority="interactive"))
            return {"answers": as_dict(got.get("answers"))}
        except Exception as exc:  # noqa: BLE001
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status == 429 or "RATE_LIMITED" in str(exc):
                _time.sleep(float(getattr(exc, "retry_after", None) or 6))
                continue
            if status in (502, 503, 504) or "UNAVAILABLE" in str(exc):
                _time.sleep(1.5 * (attempt + 1))
                continue
            return {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return {"error": "the Decisions API was unavailable"}


def answer_of(got: dict, key: str):
    """(value, confidence) of one answered question."""
    a = as_dict((got.get("answers") or {}).get(key))
    return a.get("value"), a.get("confidence")


def corrections(pod, what: str, allowed: set | None = None, limit: int = 8) -> list:
    """People's corrections of one kind, as Decisions examples (newest first)."""
    out = []
    try:
        for r in q(pod, f"SELECT from_value, to_value, evidence FROM knowhow_correction WHERE what = {lit(what)} "
                        f"ORDER BY at DESC LIMIT {int(limit) * 2}"):
            if not r.get("evidence") or (allowed is not None and r.get("to_value") not in allowed):
                continue
            out.append({"evidence": clip(r["evidence"], 1500), "answers": {what: r.get("to_value")}})
            if len(out) >= limit:
                break
    except Exception:  # noqa: BLE001
        pass
    return out


# ---------- publishing to the shared `article` ----------

def article_public_row(a: dict, text: str, topic_name: str | None) -> dict:
    body = strip_mark(text)
    return {
        "id": article_row_id(a["id"]), "title": clip(a.get("title"), 300), "slug": slugify(a.get("title"), 80) + "-" + str(a["id"])[:6],
        "summary": first_lines(body, 300) or None, "body_md": body[:20000], "topic": topic_name or None,
        "kind": a.get("kind") if a.get("kind") in ("answer", "procedure", "policy") else "answer", "language": None,
        "checked_at": iso(a.get("checked_at")), "checked_by_name": a.get("checked_by_name") or None,
        "good_until": (day_of(a.get("due_on")) - _timedelta(days=1)).isoformat() if day_of(a.get("due_on")) else None,
        "updated_at": now_iso(), "related": [], "help_path": None, "source_plugin": "know-how", "source_id": str(a["id"]),
    }


def publish_one(pod, a: dict, today: _date) -> dict:
    """Copy a live public page into `article`, or take it out when it may not be there."""
    rid = article_row_id(a["id"])
    if a.get("audience") == "public" and customer_ok(a, today):
        text = read_page(pod, a["path"])
        if not text:
            return {"ok": False, "why": f"couldn't read {a['path']}"}
        topic = topic_of(pod, a.get("topic_id"))
        row = article_public_row(a, text, topic.get("name"))
        pod.records.bulk_create("article", [row], upsert=True)
        pod.table("knowhow_article").update(a["id"], {"article_id": rid, "published_at": now_iso()})
        return {"ok": True, "published": True, "article_id": rid}
    return unpublish_one(pod, a)


def unpublish_one(pod, a: dict) -> dict:
    rid = article_row_id(a["id"])
    gone = False
    try:
        if q(pod, f"SELECT id FROM article WHERE id = {lit(rid)} LIMIT 1"):
            pod.records.delete("article", rid)
            gone = True
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "why": f"{type(exc).__name__}: {exc}"[:300]}
    if a.get("article_id") or a.get("published_at"):
        pod.table("knowhow_article").update(a["id"], {"article_id": None, "published_at": None})
    return {"ok": True, "published": False, "removed": gone}


# ---------- spreadsheets as table pages ----------

def _md_cell(v) -> str:
    return str(v if v is not None else "").replace("|", "\\|").replace("\n", " ").strip()


def table_md(grid: list, max_rows: int = 400) -> str:
    """A Markdown table from rows of cells; the first non-empty row is the header."""
    grid = [[_md_cell(c) for c in r] for r in grid if any(str(c or "").strip() for c in r)]
    if not grid:
        return "_This sheet is empty._"
    width = max(len(r) for r in grid)
    grid = [r + [""] * (width - len(r)) for r in grid]
    head, body = grid[0], grid[1: max_rows + 1]
    lines = ["| " + " | ".join(h or " " for h in head) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(c for c in r) + " |" for r in body]
    if len(grid) - 1 > max_rows:
        lines.append(f"\n_{len(grid) - 1 - max_rows} more rows are in the original._")
    return "\n".join(lines)


def csv_grid(data: bytes) -> list:
    text = data.decode("utf-8-sig", errors="replace")
    try:
        dialect = _csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except _csv.Error:
        dialect = _csv.excel
    return [r for r in _csv.reader(_io.StringIO(text), dialect)]


def xlsx_sheets(data: bytes) -> list:
    """[(sheet name, rows of cells)] from an xlsx file, with the standard library only."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
          "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
    out = []
    with _zipfile.ZipFile(_io.BytesIO(data)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in _ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
        rels = {}
        if "xl/_rels/workbook.xml.rels" in z.namelist():
            for rel in _ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
                rels[rel.get("Id")] = rel.get("Target")
        book = _ET.fromstring(z.read("xl/workbook.xml"))
        for sheet in book.findall("m:sheets/m:sheet", ns):
            target = rels.get(sheet.get(f"{{{ns['r']}}}id"), "")
            path = "xl/" + target.lstrip("/").replace("xl/", "", 1) if target else ""
            if path not in z.namelist():
                continue
            grid = []
            for row in _ET.fromstring(z.read(path)).iter(f"{{{ns['m']}}}row"):
                cells = {}
                for c in row.findall("m:c", ns):
                    ref = c.get("r") or ""
                    col = 0
                    for ch in _re.match(r"[A-Z]*", ref).group(0):
                        col = col * 26 + (ord(ch) - 64)
                    kind = c.get("t")
                    v = c.find("m:v", ns)
                    if kind == "s" and v is not None:
                        val = shared[int(v.text)] if v.text and int(v.text) < len(shared) else ""
                    elif kind == "inlineStr":
                        val = "".join(t.text or "" for t in c.iter(f"{{{ns['m']}}}t"))
                    elif kind == "b" and v is not None:
                        val = "TRUE" if v.text == "1" else "FALSE"
                    else:
                        val = v.text if v is not None else ""
                        if val and _re.fullmatch(r"-?\d+\.0", val):
                            val = val[:-2]
                    cells[max(col, len(cells) + 1)] = val
                if cells:
                    width = max(cells)
                    grid.append([cells.get(i, "") for i in range(1, width + 1)])
            out.append((sheet.get("name") or f"Sheet {len(out) + 1}", grid))
    return out


def sheet_page(name: str, path: str, data: bytes) -> str:
    """A spreadsheet as a Markdown page, marked as made from its file."""
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    head = f"> Made from *{name}* ({path}). Know-how makes this page again when the file changes; edit the file, not this page.\n\n# {name.rsplit('.', 1)[0]}\n"
    if ext == ".csv":
        return head + "\n" + table_md(csv_grid(data)) + "\n"
    parts = [head]
    for sheet, grid in xlsx_sheets(data):
        parts.append(f"\n## {sheet}\n\n{table_md(grid)}\n")
    return "".join(parts)


def unsearchable_why(name: str) -> str | None:
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    kind = UNSEARCHABLE.get(ext)
    if not kind:
        return None
    if ext in SHEETS:
        return f"{kind}: the Lemma can't search it, so Know-how made a table page from it"
    return f"{kind}: the Lemma can't search it"
# end knowhow:common

# contract:needs-you
# The one way to write `needs_you` (see _contract/README.md). Copied verbatim
# into every writer between these markers; _contract/lint.py fails on any
# difference. Needs a grant on needs_you (read and write).
import uuid as _ny_uuid
from datetime import datetime as _ny_datetime, timezone as _ny_timezone

NEEDS_YOU_NS = _ny_uuid.UUID("6b1d9a2e-4c37-4f0a-9e58-2d7c1b3f8a65")


def needs_you_id(plugin: str, table: str, source_id: str, verb: str, member: str) -> str:
    """The item's id: one per (plugin, source table, source row, verb, member)."""
    return str(_ny_uuid.uuid5(NEEDS_YOU_NS, f"{plugin}/{table}/{source_id}/{verb}/{member}"))


def needs_you_write(pod, plugin: str, member: str, items: list, scope_where: str | None = None) -> dict:
    """Write what needs the member now, from one plugin, and resolve the rest.

    `items` are the plugin's current items within the scope, each with verb,
    title, source_table, source_id and source_version, and any other column.
    `scope_where` is a SQL condition on needs_you naming what this pass looked
    at (e.g. "conversation_id IN (...)"); None means everything of this plugin.

    - new: created open.
    - open or snoozed: updated in place (a snooze holds until it ends).
    - dismissed, or done by the person: left alone, unless source_version
      changed, when it opens again.
    - done by the source (resolved before): opens again.
    - open or snoozed items in scope that are no longer current: done, closed
      by the source.
    """
    def rows(response):
        payload = response.to_dict() if hasattr(response, "to_dict") else response
        return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]

    def quoted(value):
        return "'" + str(value).replace("'", "''") + "'"

    now = _ny_datetime.now(_ny_timezone.utc).isoformat()
    current = {}
    for item in items:
        row = dict(item, source_plugin=plugin)
        row["id"] = needs_you_id(plugin, row["source_table"], str(row["source_id"]), row["verb"], member)
        current[row["id"]] = row
    where = f"source_plugin = {quoted(plugin)}" + (f" AND ({scope_where})" if scope_where else "")
    seen = {r["id"]: r for r in rows(pod.query(
        f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE {where} LIMIT 5000"))}
    missing = [i for i in current if i not in seen]
    for start in range(0, len(missing), 200):
        ids = ", ".join(quoted(i) for i in missing[start : start + 200])
        seen.update({r["id"]: r for r in rows(pod.query(
            f"SELECT id, state, closed_by, source_version, snoozed_until FROM needs_you WHERE id IN ({ids})"))})
    creates, updates, counts = [], [], {"created": 0, "updated": 0, "kept_closed": 0, "resolved": 0}
    for item_id, row in current.items():
        old = seen.get(item_id)
        if old is None:
            creates.append(dict(row, state="open"))
            continue
        changed = (old.get("source_version") or "") != (row.get("source_version") or "")
        state = old.get("state")
        if state in ("dismissed", "done") and old.get("closed_by") != "source" and not changed:
            counts["kept_closed"] += 1
            continue
        if state == "snoozed" and not changed and (old.get("snoozed_until") or "") > now:
            updates.append(row)
            continue
        updates.append(dict(row, state="open", closed_by=None, snoozed_until=None))
    for item_id, old in seen.items():
        if item_id not in current and old.get("state") in ("open", "snoozed"):
            updates.append({"id": item_id, "state": "done", "closed_by": "source"})
            counts["resolved"] += 1
    for start in range(0, len(creates), 100):
        pod.records.bulk_create("needs_you", creates[start : start + 100], upsert=True)
    for start in range(0, len(updates), 100):
        pod.records.bulk_update("needs_you", updates[start : start + 100])
    counts["created"], counts["updated"] = len(creates), len(updates) - counts["resolved"]
    return counts
# end contract

TOPICS = [
    ("products", "Products and lead times", "Priya Raman", "Marco Bellini", 90, "team", None, False),
    ("drivers", "Drivers and wiring", "Ines Moreau", "Priya Raman", 90, "customers", None, False),
    ("orders", "Orders and returns", "Tomás Ortega", "Joy Lam", 90, "team", None, False),
    ("people", "Leave and pay", "Hannah Webb", None, 180, "restricted", "HR", True),
    ("it", "Laptops and access", "Dev Chauhan", None, 120, "team", None, False),
    ("showroom", "Showroom and samples", "Sam Okafor", "Marco Bellini", 90, "team", None, False),
]

# key, topic, kind, title, audience, checked days ago, check days, state, asks, body
PAGES = [
    ("lead", "products", "answer", "Lead times", "team", 22, 90, "live", ["how long for an order of profiles", "when will my order ship"],
     "Standard profiles in 2 m and 3 m lengths ship in **3 working days** from Leeds.\n\n- Cut-to-length profiles: **5 working days**.\n- Orders over 200 m: **8 working days**; ask for a date before you promise one.\n- Drivers and accessories ship the next working day when ordered by 2 pm.\n\nBank holidays add a day. If a customer needs it sooner, ask the warehouse before you say yes."),
    ("cut", "products", "answer", "Custom profile lengths", "team", 98, 90, "due", ["can you cut profiles to length", "shortest profile you can cut"],
     "We cut any profile to length, from **150 mm to 3,000 mm**, in 1 mm steps.\n\n- Cutting is free on orders of 10 lengths or more; under that it's £2.50 a cut.\n- Tolerance is ±1 mm.\n- End caps are fitted on request; say \"capped\" on the order.\n\nCut lengths can't be returned unless they're faulty."),
    ("finish", "products", "answer", "Finishes and colours", "team", 40, 90, "live", ["what colours do profiles come in", "black anodised profile"],
     "Every profile comes in **natural anodised** and **black anodised**. The 20 mm and 35 mm profiles also come in **white powder-coat**.\n\nDiffusers: opal (the default), frosted and clear. Opal hides the dots on strips of 120 LEDs per metre or more."),
    ("wet", "products", "answer", "Profiles for wet rooms", "team", 30, 90, "live", ["can I use a profile in a bathroom", "IP rating of profiles"],
     "Use the **Linea 20 IP65** with its sealed end caps in bathrooms and outside under cover. It's rated IP65 once both end caps are sealed with the silicone in the box.\n\nNo other profile is rated for wet rooms. Drivers must sit outside zones 0, 1 and 2."),
    ("driver", "drivers", "answer", "Choosing a driver", "public", 23, 90, "live", ["what driver do I need", "how many metres per driver"],
     "Add up the watts of every strip on the driver, then add 20 % headroom.\n\n- **PSU-60**: up to 48 W of strip.\n- **PSU-150**: up to 120 W.\n- **PSU-300**: up to 240 W.\n\nFor a 10 W/m strip, a PSU-150 runs 12 m. Over 5 m in one run, feed the strip from both ends to avoid a dimmer far end."),
    ("dim", "drivers", "answer", "PSU-150 dimming", "customers", 20, 90, "live", ["can the PSU-150 dim", "which dimmer for PSU-150"],
     "The **PSU-150-D** dims on a trailing-edge (phase) dimmer down to 5 %. The plain PSU-150 doesn't dim.\n\nTested dimmers: Varilight V-Pro, Hamilton Hartland. Leading-edge dimmers make it hum; don't use them."),
    ("wire", "drivers", "procedure", "Wiring a PSU-150", "team", 35, 90, "may_disagree", ["how do I wire the psu-150", "psu-150 wiring"],
     "Wire it with the power off at the board.\n\n### 1. Isolate the circuit\nWho: Installer\nTurn off the circuit at the board and check it's dead with a tester.\n\n### 2. Connect the mains side\nWho: Installer\nLive to L, neutral to N. The PSU-150 has no earth terminal; it's double insulated.\n\n### 3. Connect the strip\nWho: Installer\nRed to V+, black to V−. Keep the run under 5 m from one end.\n\n### 4. Fit the cover\nWho: Installer\nClip the terminal cover on until both sides click.\n\n### 5. Test\nWho: Installer\nPower on. The strip should reach full brightness within a second."),
    ("drop", "drivers", "answer", "Voltage drop on long runs", "team", 50, 90, "live", ["why is the end of my strip dimmer", "voltage drop"],
     "On a 24 V strip, runs over **5 m** get dimmer at the far end. Feed power to both ends, or add a second feed in the middle. On 12 V strips the limit is 3 m."),
    ("return", "orders", "procedure", "Issue a return", "team", 44, 90, "live", ["how do I issue a return", "customer wants to send it back"],
     "Returns are accepted within **30 days** of delivery, unused and in the box.\n\n### 1. Find the order\nWho: Customer service\nLook up the order by number or the customer's email. Check it was delivered less than 30 days ago.\n\n### 2. Check the item is returnable\nWho: Customer service\nUnused and in its box. Cut lengths come back only if they're faulty.\n\n### 3. Raise the return\nWho: Customer service\nIn the order, choose Return, pick the lines and the reason.\n\n### 4. Send the label\nWho: Customer service\nThe return label is emailed to the customer from the order. Tell them to drop it at any parcel shop.\n\n### 5. Receive it\nWho: Warehouse\nWhen it arrives, check it against the return and mark it received.\n\n### 6. Inspect it\nWho: Warehouse\nUnused and complete: mark it restockable. Damaged: photograph it and flag it to customer service.\n\n### 7. Refund\nWho: Customer service\nRefund to the original payment within 5 working days of receiving it. Tell the customer it's done."),
    ("warranty", "orders", "policy", "Warranty", "public", 86, 90, "live", ["how long is the warranty", "is it under warranty"],
     "Every Fernlow profile carries a **10-year** warranty; drivers and LED strip carry **5 years** from delivery.\n\nThe warranty covers faults in manufacture. It doesn't cover damage from fitting, water outside an IP65 product, or a driver loaded past its rating. To claim, send the order number and a photo of the fault."),
    ("eu", "orders", "answer", "Delivery to the EU", "team", 15, 90, "live", ["do you ship to France", "EU delivery cost"],
     "We ship to every EU country by DPD in **3 to 5 working days**. Delivery is £18 per order, free over £400. The customer pays import VAT on delivery; say so before they order."),
    ("change", "orders", "answer", "Changing an order after it ships", "team", 104, 90, "due", ["can I change an order that's shipped", "add to a shipped order"],
     "Once an order has shipped it can't be changed. Raise a new order for anything extra, and a return for anything not wanted. The warehouse can hold a parcel at the depot if you call before 10 am the next day."),
    ("holiday", "people", "policy", "Holiday allowance", "restricted", 60, 180, "live", ["how much holiday do I get", "carry over holiday"],
     "Everyone gets **25 days** a year plus bank holidays, rising by a day for each full year of service up to 30.\n\nUp to 5 unused days carry into the next year; use them by the end of March. Book holiday in the HR system at least two weeks ahead."),
    ("pay", "people", "answer", "Payday and payslips", "team", 70, 180, "live", ["when is payday", "where is my payslip"],
     "Payday is the **last working day** of the month. Payslips are in the HR system under Documents from the day before."),
    ("laptop", "it", "procedure", "Set up a new laptop", "team", 25, 120, "live", ["new laptop setup", "set up my laptop"],
     "### 1. Sign in\nWho: New starter\nSign in with the email and the one-time password from your welcome email.\n\n### 2. Set your password\nWho: New starter\nAt least 14 characters. You'll be asked to set up the authenticator app.\n\n### 3. Install updates\nWho: New starter\nLet the updates finish before anything else; it can take 20 minutes.\n\n### 4. Open the shared drive\nWho: New starter\nIt appears in the sidebar once updates finish.\n\n### 5. Add the printer\nWho: New starter\nSettings, Printers, Add: choose Fernlow-Office.\n\n### 6. Tell Dev\nWho: New starter\nMessage Dev Chauhan that you're set up, so your old temporary account is closed."),
    ("use", "it", "policy", "Laptop use", "team", 80, 120, "live", ["can I use my laptop at home", "personal use of work laptop"],
     "Work laptops may go home and abroad. Lock the screen when you step away, keep it updated, and report a lost laptop to Dev the same day. Personal use is fine; don't install software that isn't on the approved list."),
    ("vpn", "it", "answer", "VPN access", "team", 130, 120, "due", ["how do I get on the vpn", "vpn not connecting"],
     "Open the VPN app, choose **Fernlow-Leeds**, and sign in with your work email. If it won't connect, restart the laptop and try again before asking Dev."),
    ("book", "showroom", "procedure", "Booking the showroom", "team", 33, 90, "live", ["book the showroom", "customer visit to the showroom"],
     "### 1. Check the calendar\nWho: Sales\nOpen the Showroom calendar and pick a free slot. Visits are an hour.\n\n### 2. Book it\nWho: Sales\nAdd the visit with the customer's name and company.\n\n### 3. Tell Sam\nWho: Sales\nSam sets the demo wall for what the customer is looking at.\n\n### 4. Send directions\nWho: Sales\nSend the customer the address and parking note from the showroom page."),
    ("samples", "showroom", "answer", "Sample boxes for installers", "team", 12, 90, "live", ["can installers get samples", "sample box"],
     "Installers can have one **free sample box** a year: three profiles, two diffusers and a 1 m strip. Order it as SAMPLE-BOX on a zero-price order. More than one a year costs £35."),
    ("hours", "showroom", "answer", "Showroom opening hours", "team", 18, 90, "live", ["when is the showroom open", "showroom hours"],
     "The Leeds showroom is open **Monday to Friday, 9 am to 5 pm**, by appointment. It's closed on bank holidays."),
]

# Questions answered from a page this month: (page key, words, who, where source, place, days ago).
ASKED = [
    ("lead", "How long does a 3 m profile order take to ship?", "Marco Bellini", "teams", "#sales-desk", 1),
    ("lead", "If I order drivers today will they go out tomorrow?", "Joy Lam", "teams", "chat", 3),
    ("lead", "Lead time for 250 m of Linea 20?", "Marco Bellini", "slack", "#sales", 6),
    ("lead", "When would a cut-to-length order leave?", "Lena Fischer", "teams", "#installer-support", 9),
    ("lead", "What's the usual lead time on profiles?", "Ben Carter", "web", "chat with Wren", 13),
    ("finish", "Do the profiles come in black?", "Marco Bellini", "teams", "#sales-desk", 2),
    ("finish", "Which diffuser hides the dots best?", "Lena Fischer", "slack", "#installers", 8),
    ("finish", "Is there a white 35 mm profile?", "Aisha Khan", "teams", "chat", 15),
    ("wet", "Can the Linea 20 go in a shower room?", "Lena Fischer", "teams", "#installer-support", 4),
    ("wet", "What IP rating are the profiles?", "Marco Bellini", "email", "sales mailbox", 11),
    ("driver", "What driver for 8 m of 10 W strip?", "Lena Fischer", "teams", "#installer-support", 1),
    ("driver", "How many metres can a PSU-60 run?", "Owen Price", "slack", "Slack Connect · brightfit", 2),
    ("driver", "Which PSU do I need for 18 m?", "Joy Lam", "teams", "chat", 5),
    ("driver", "Do I need headroom on the driver?", "Nadia Ortiz", "email", "support mailbox", 7),
    ("driver", "PSU-150 or PSU-300 for a 14 m run?", "Marco Bellini", "teams", "#sales-desk", 10),
    ("dim", "Can I dim the PSU-150?", "Nadia Ortiz", "email", "support mailbox", 3),
    ("dim", "Which dimmers work with the PSU-150-D?", "Lena Fischer", "teams", "#installer-support", 12),
    ("wire", "Does the PSU-150 need an earth?", "Lena Fischer", "teams", "#installer-support", 6),
    ("drop", "Why is the far end of my strip dimmer?", "Owen Price", "slack", "Slack Connect · brightfit", 4),
    ("drop", "How long can a 24 V run be from one end?", "Lena Fischer", "teams", "#installer-support", 14),
    ("return", "How do I issue a return for an unused driver?", "Joy Lam", "teams", "chat", 0),
    ("return", "Customer wants to send back two profiles, what do I do?", "Aisha Khan", "teams", "#customer-service", 2),
    ("return", "Can cut lengths be returned?", "Joy Lam", "teams", "#customer-service", 8),
    ("warranty", "How long is the warranty on drivers?", "Nadia Ortiz", "email", "support mailbox", 1),
    ("warranty", "Is water damage covered by the warranty?", "Owen Price", "slack", "Slack Connect · brightfit", 5),
    ("warranty", "Warranty on profiles?", "Marco Bellini", "teams", "#sales-desk", 16),
    ("eu", "Do we ship to France?", "Joy Lam", "teams", "#customer-service", 3),
    ("eu", "What does EU delivery cost?", "Ben Carter", "web", "chat with Wren", 9),
    ("eu", "Who pays import VAT on an EU order?", "Aisha Khan", "teams", "chat", 17),
    ("holiday", "Can I carry holiday over into next year?", "Kofi Mensah", "teams", "chat", 6),
    ("pay", "When is payday this month?", "Kofi Mensah", "teams", "chat", 4),
    ("laptop", "How do I set up my new laptop?", "Aisha Khan", "teams", "chat", 10),
    ("use", "Can I take my laptop abroad?", "Ben Carter", "teams", "chat", 12),
    ("book", "How do I book the showroom for a customer?", "Marco Bellini", "teams", "#sales-desk", 5),
    ("samples", "Can an installer get a free sample box?", "Lena Fischer", "teams", "#installer-support", 2),
    ("samples", "How do I order a sample box?", "Joy Lam", "slack", "#sales", 11),
    ("hours", "Is the showroom open on Saturdays?", "Owen Price", "slack", "Slack Connect · brightfit", 7),
]
# From a page past its check date (6).
LATE = [
    ("cut", "What's the shortest profile you can cut?", "Marco Bellini", "teams", "#sales-desk", 1),
    ("cut", "Do you charge for cutting?", "Joy Lam", "teams", "chat", 4),
    ("cut", "Can end caps be fitted on cut lengths?", "Lena Fischer", "teams", "#installer-support", 7),
    ("change", "Can I add a driver to an order that's shipped?", "Aisha Khan", "teams", "#customer-service", 2),
    ("change", "Customer wants to change the address on a shipped order", "Joy Lam", "teams", "chat", 9),
    ("vpn", "VPN won't connect, what do I do?", "Ben Carter", "teams", "chat", 3),
]

CONTACTS = {"Nadia Ortiz": "nadia@northlight-studio.example", "Owen Price": "owen@brightfit-installs.example"}


class KnowhowSampleDataInput(BaseModel):
    mode: str = "load"


class KnowhowSampleDataResult(BaseModel):
    pages: int = 0
    questions: int = 0
    today_items: int = 0
    message: str


def build(t0, me: str | None, me_name: str | None = None) -> dict:
    """Every sample row and file, as of `t0` (a datetime): {"files": {path: text}, "rows": {table: [rows]}}."""
    day0 = t0.date()
    at = lambda days, hour=10, minute=0: (t0 - _timedelta(days=days)).replace(hour=hour, minute=minute, second=0, microsecond=0).isoformat()
    topics, tby = [], {}
    for i, (slug, name, owner, backup, days, aud, role, sens) in enumerate(TOPICS):
        t = {"id": kid("sample", "topic", slug), "name": name, "slug": slug, "folder_path": f"{ROOT}/{slug}/",
             "owner_member_id": me if slug == "products" else None, "owner_name": owner, "backup_member_id": None,
             "backup_name": backup, "check_days": days, "audience_default": aud, "restricted_role": role, "sensitive": sens,
             "position": i, "sample": True}
        topics.append(t)
        tby[slug] = t
    files, arts, aby = {}, [], {}
    for key, slug, kind, title, aud, ago, days, state, asks, body in PAGES:
        t = tby[slug]
        path = f"{ROOT}/{slug}/{slugify(title)}.md"
        text = f"# {title}\n\n{body}\n"
        files[path] = text
        checked = day0 - _timedelta(days=ago)
        if key == "warranty":
            due = day0 + _timedelta(days=4)  # leaves the customer answers soon unless checked
        else:
            due = checked + _timedelta(days=days)
        a = {"id": kid("sample", "page", key), "kind": kind, "title": title, "asks": asks, "path": path, "topic_id": t["id"],
             "owner_member_id": t["owner_member_id"], "owner_name": t["owner_name"], "audience": aud, "state": state,
             "checked_at": at(ago, 11), "checked_by": None, "checked_by_name": t["owner_name"], "due_on": due.isoformat(),
             "checked_hash": sha(text), "checked_text": text, "seen_hash": sha(text),
             "steps": steps_cache(text) if kind == "procedure" else [], "source": "sample", "uses_30d": 0, "misses_30d": 0,
             "walks_30d": 0, "finished_30d": 0, "last_used_at": None, "sample": True}
        if key in ("driver", "warranty"):
            a.update({"approved_at": at(ago, 12), "approved_by_name": t["owner_name"], "published_at": at(ago, 12), "article_id": article_row_id(a["id"])})
        if key == "dim":
            a.update({"approved_at": at(ago, 12), "approved_by_name": t["owner_name"]})
        if key == "wire":
            a.update({"source_path": f"{INBOX}/psu-150-datasheet.pdf", "quote": "PSU-150 datasheet, rev C", "quote_where": "psu-150-datasheet.pdf"})
        if key == "return":
            a.update({"source": "thread", "quote": "Joy: what's the actual process for a return now we've moved to the new system?\nTomás: find the order, check it's in date and unused, raise it in the order, the label goes from there…",
                      "quote_who": "Tomás Ortega", "quote_where": "Teams #customer-service, 3 Sep"})
        arts.append(a)
        aby[key] = a
    # Walk counts and where people stop, on the return procedure.
    ret = aby["return"]
    reached = [23, 23, 20, 19, 19, 19, 19]
    asked = [0, 2, 1, 0, 0, 0, 0]
    for st, r_, q_ in zip(ret["steps"], reached, asked):
        st["reached"], st["asked"] = r_, q_
    ret.update({"walks_30d": 23, "finished_30d": 19})
    aby["laptop"].update({"walks_30d": 3, "finished_30d": 2})
    for i, st in enumerate(aby["laptop"]["steps"]):
        st["reached"] = 3 if i < 4 else 2
    questions, events = [], []

    def ev(kind, sid, key, text, days, hour=10, minute=0, actor="lemma", actor_name=None):
        events.append({"id": kid("sample", "event", kind, sid, key), "subject_kind": kind, "subject_id": sid, "kind": key.split(":")[0],
                       "actor": actor, "actor_name": actor_name or ("Lemma" if actor == "lemma" else None), "text": text,
                       "at": at(days, hour, minute), "sample": True})

    def question(key, text, who, src, place, days, outcome, page=None, **f):
        qid = kid("sample", "question", key)
        contact = who in CONTACTS
        row = {"id": qid, "text": text, "asked_by_kind": "contact" if contact else "member", "asked_by_member": None,
               "asked_by_contact": None, "asked_by_name": who, "where_source": src, "where_place": place,
               "conversation_id": None, "channel_id": None, "topic_id": (page or {}).get("topic_id") or f.pop("topic_id", None),
               "article_id": (page or {}).get("id"), "outcome": outcome, "confidence": 0.9, "owner_member_id": (page or {}).get("owner_member_id"),
               "state": "saved" if outcome in ("answered", "late") else "new", "same_as": None, "times": 1, "found": None,
               "next_note": None, "sensitive": False, "walk_id": None, "walk_step": None,
               "asked_at": at(days, 9 + (len(questions) % 8), (len(questions) * 7) % 60),
               "answered_at": at(days, 9 + (len(questions) % 8), (len(questions) * 7) % 60 + 0) if outcome in ("answered", "late") else None,
               "told_at": None, "sample": True}
        row.update(f)
        questions.append(row)
        if page and outcome in ("answered", "late"):
            page["uses_30d"] = int(page.get("uses_30d") or 0) + 1
            page["last_used_at"] = max(page.get("last_used_at") or "", row["asked_at"])
        return row

    for i, (key, text, who, src, place, days) in enumerate(ASKED):
        r = question(f"asked:{i}", text, who, src, place, days, "answered", aby[key])
        ev("question", r["id"], "asked", f"{who} asked in {WHERE_WORDS[src]} {place}.", days, 9, 0, actor_name=who)
        ev("question", r["id"], "saved:answer", f"Answered from *{aby[key]['title']}*. {source_line(aby[key])}", days, 9, 1)
    for i, (key, text, who, src, place, days) in enumerate(LATE):
        r = question(f"late:{i}", text, who, src, place, days, "late", aby[key])
        ev("question", r["id"], "asked", f"{who} asked in {WHERE_WORDS[src]} {place}.", days, 9, 0, actor_name=who)
        ev("question", r["id"], "saved:answer", f"Answered from *{aby[key]['title']}*, with a warning: {late_line(aby[key])}", days, 9, 1)
    # The misses (5).
    prod, drv, ordr, hr = tby["products"], tby["drivers"], tby["orders"], tby["people"]
    ral = question("ral:0", "Can we do custom RAL colours on the 20 mm profile?", "Marco Bellini", "teams", "#sales-desk", 6, "missed",
                   topic_id=prod["id"], owner_member_id=me, state="drafted", times=4)
    for j, (who, src, place, days) in enumerate([("Nadia Ortiz", "email", "support mailbox", 4), ("Lena Fischer", "slack", "#installers", 2),
                                                 ("Ben Carter", "web", "chat with Wren", 1)]):
        words = ["Do you powder-coat profiles in a RAL colour?", "can I get the linea 20 in RAL 7016?", "custom colour profiles possible?"][j]
        question(f"ral:{j + 1}", words, who, src, place, days, "missed", topic_id=prod["id"], owner_member_id=me, state="drafted", same_as=ral["id"])
    flick = question("flicker", "Why does the PSU-150 flicker on a phase dimmer at low levels?", "Lena Fischer", "teams", "#installer-support", 2, "partly",
                     topic_id=drv["id"], state="new", next_note="Partly in a datasheet",
                     found=[{"path": f"{INBOX}/psu-150-datasheet.pdf", "page": 4,
                             "text": "Below 10 % on leading-edge dimmers the PSU-150-D may flicker. Use a trailing-edge dimmer and set its minimum to 10 %."}])
    ies = question("ies", "Is there an IES file for the Linea 35?", "Marco Bellini", "teams", "#sales-desk", 3, "missed",
                   topic_id=prod["id"], owner_member_id=me, state="asked", next_note="Files can't be read",
                   found=[{"path": f"{INBOX}/linea-35.ies", "page": None, "text": "An IES light file: the Lemma can't search it."}])
    eye = question("eye", "Do I get paid back for an eye test for screen work?", None, "teams", "chat", 1, "missed",
                   topic_id=hr["id"], state="asked", sensitive=True, asked_by_name=None, next_note="Asked Hannah in Teams")
    norway = question("norway", "Do we ship to Norway?", "Joy Lam", "teams", "#customer-service", 0, "missed",
                      topic_id=ordr["id"], state="asked", next_note="Asked Tomás in Teams")
    # A question asked twice mid-walk on step 2 of the return procedure.
    walk_id = kid("sample", "walk", "joy")
    gone = [question(f"gone:{j}", w, who, "teams", "chat", d, "missed", ret, state="drafted", walk_id=walk_id if j == 0 else None, walk_step=2,
                     next_note="Proposed for step 2")
            for j, (w, who, d) in enumerate([("What if the box is gone?", "Joy Lam", 0), ("customer threw the box away, can they still return it?", "Aisha Khan", 5)])]
    for r in gone:
        r["outcome"] = "missed"
    ev("question", ral["id"], "asked", "Marco Bellini asked in Teams #sales-desk.", 6, 9, 12, actor_name="Marco Bellini")
    ev("question", ral["id"], "routed", "Topic Products and lead times; owner Priya Raman, asked 4 times.", 1, 9, 20)
    ev("question", ral["id"], "routed:teams", "Asked Priya Raman in Teams, with the three earlier askings.", 1, 9, 21)
    ev("question", ral["id"], "replied", "Priya replied in Teams.", 0, 8, 40, actor_name="Priya Raman")
    ev("question", ral["id"], "drafted", "Drafted *Custom RAL colours* from Priya's reply for her to save.", 0, 8, 41)
    ev("question", flick["id"], "asked", "Lena Fischer asked in Teams #installer-support.", 2, 14, 5, actor_name="Lena Fischer")
    ev("question", flick["id"], "found", "Found a passage in psu-150-datasheet.pdf, page 4. No page answers it.", 2, 14, 6)
    ev("question", ies["id"], "asked", "Marco Bellini asked in Teams #sales-desk.", 3, 11, 30, actor_name="Marco Bellini")
    ev("question", ies["id"], "routed", "linea-35.ies is an IES light file: the Lemma can't search it. Asked Priya.", 3, 11, 31)
    ev("question", eye["id"], "asked", "Someone asked in Teams. Their name isn't kept: Leave and pay is sensitive.", 1, 16, 2)
    ev("question", eye["id"], "routed", "Asked Hannah Webb in Teams.", 1, 16, 3)
    ev("question", norway["id"], "asked", "Joy Lam asked in Teams #customer-service.", 0, 9, 50, actor_name="Joy Lam")
    ev("question", norway["id"], "routed", "Asked Tomás Ortega in Teams.", 0, 9, 51)
    # Drafts (3).
    drafts = []

    def draft(key, slug, title, body, who, where, quote, ago, qids=(), asks=()):
        t = tby[slug]
        aid = kid("sample", "draft", key)
        path = f"{DRAFTS}/{slugify(title)}-{aid[:6]}.md"
        text = f"# {title}\n\n{body}\n"
        files[path] = text
        a = {"id": aid, "kind": "answer", "title": title, "asks": list(asks), "path": path, "topic_id": t["id"],
             "owner_member_id": t["owner_member_id"], "owner_name": t["owner_name"], "audience": t["audience_default"] if t["audience_default"] != "customers" else "team",
             "state": "draft", "steps": [], "source": "reply" if key != "wifi" else "thread", "quote": quote, "quote_who": who,
             "quote_where": where, "missing": [], "sample": True, "uses_30d": 0, "misses_30d": 0}
        drafts.append(a)
        for qid in qids:
            for r in questions:
                if r["id"] == qid:
                    r["draft_article_id"] = aid
                    r["next_note"] = f"Draft ready for {first_name(t['owner_name'])}"
        ev("article", aid, "drafted", f"Drafted from {who}'s reply in {where}.", ago, 8, 41)
        return a

    draft("ral", "products", "Custom RAL colours",
          "Yes, on the **Linea 20 and Linea 35** only, in any RAL colour.\n\n- Minimum order: **20 lengths** of one colour.\n- Adds **10 working days** to the lead time.\n- Powder-coated profiles can't be returned unless faulty.",
          "Priya Raman", "Teams", "yes on Linea 20 and 35, any RAL, min 20 lengths, adds about 10 working days. Can't take them back unless faulty.",
          0, [r["id"] for r in questions if r["id"] == ral["id"] or r.get("same_as") == ral["id"]],
          ["custom RAL colours", "powder-coat in a RAL colour"])
    draft("courier", "showroom", "Sample boxes by courier",
          "Sample boxes go by next-day courier when ordered by 2 pm. Outside the UK they go by DPD in 3 to 5 working days.",
          "Sam Okafor", "Slack #sales", "next day if before 2, abroad DPD 3-5 days", 3, (), ["send a sample box abroad"])
    draft("wifi", "it", "Guest Wi-Fi in the office",
          "The guest network is **Fernlow-Guest**. The password is on the card at reception and changes every Monday.",
          "Dev Chauhan", "Teams #general", "Fernlow-Guest, password on the reception card, changes Mondays", 5, (), ["guest wifi password"])
    for d in drafts:
        missing = ["What colours count as standard RAL?"] if d["title"] == "Custom RAL colours" else []
        d["missing"] = missing
    # Changes: a proposed step, and a may-disagree.
    changes = [
        {"id": kid("sample", "change", "box"), "article_id": ret["id"], "kind": "add_to_step", "step": 2,
         "text": "If the box is gone, accept it in any sturdy box, but only if the item is unused. Note \"no original box\" on the return.",
         "evidence": {"quote": "if the box is gone take it back in any decent box as long as it's unused, just note it on the return",
                      "who": "Tomás Ortega", "where": "Teams, to Joy Lam", "when": at(0, 10, 5)},
         "question_ids": [g["id"] for g in gone], "source_path": None, "state": "proposed", "sample": True},
        {"id": kid("sample", "change", "psu"), "article_id": aby["wire"]["id"], "kind": "may_disagree", "step": 2,
         "text": "Live to L, neutral to N, earth to the earth terminal (rev D adds an earth terminal).",
         "evidence": {"page_text": "Live to L, neutral to N. The PSU-150 has no earth terminal; it's double insulated.",
                      "source_text": "Rev D: an earth terminal is added. Connect the earth conductor to ⏚ on all installations.",
                      "changed_at": at(7, 8, 0), "why": "psu-150-datasheet.pdf changed and may disagree with step 2."},
         "question_ids": [], "source_path": f"{INBOX}/psu-150-datasheet.pdf", "state": "proposed", "sample": True},
    ]
    ev("article", ret["id"], "changed:box", "Proposed change to step 2, from Tomás's reply to Joy.", 0, 10, 6)
    ev("article", aby["wire"]["id"], "changed:psu", "May disagree: psu-150-datasheet.pdf changed.", 7, 0, 15)
    # Walks and assignments.
    walks = [{"id": walk_id, "article_id": ret["id"], "who_kind": "member", "who_member": None, "who_name": "Joy Lam", "where_source": "teams",
              "channel_id": None, "step": 3, "steps_total": 7, "state": "walking", "started_at": at(0, 10, 0), "done_at": None,
              "assignment_id": kid("sample", "assign", "joy"), "sample": True},
             {"id": kid("sample", "walk", "aisha"), "article_id": ret["id"], "who_kind": "member", "who_member": None, "who_name": "Aisha Khan",
              "where_source": "teams", "channel_id": None, "step": 7, "steps_total": 7, "state": "done", "started_at": at(22, 14, 0),
              "done_at": at(22, 14, 25), "assignment_id": kid("sample", "assign", "aisha"), "sample": True}]
    assigns = [
        {"id": kid("sample", "assign", "joy"), "article_id": ret["id"], "member_id": None, "member_name": "Joy Lam", "role": "Customer service",
         "assigned_by": None, "assigned_by_name": "Tomás Ortega", "assigned_at": at(4, 9), "due_on": (day0 + _timedelta(days=5)).isoformat(),
         "walk_id": walk_id, "state": "walking", "sample": True},
        {"id": kid("sample", "assign", "kofi"), "article_id": ret["id"], "member_id": None, "member_name": "Kofi Mensah", "role": "Warehouse",
         "assigned_by": None, "assigned_by_name": "Tomás Ortega", "assigned_at": at(1, 9), "due_on": None, "walk_id": None, "state": "assigned", "sample": True},
        {"id": kid("sample", "assign", "aisha"), "article_id": ret["id"], "member_id": None, "member_name": "Aisha Khan", "role": "Customer service",
         "assigned_by": None, "assigned_by_name": "Tomás Ortega", "assigned_at": at(25, 9), "due_on": None,
         "walk_id": kid("sample", "walk", "aisha"), "state": "done", "sample": True},
    ]
    if me:
        assigns.append({"id": kid("sample", "assign", "me"), "article_id": aby["book"]["id"], "member_id": me, "member_name": me_name or "You",
                        "role": None, "assigned_by": None, "assigned_by_name": "Sam Okafor", "assigned_at": at(1, 9), "due_on": None,
                        "walk_id": None, "state": "assigned", "sample": True})
    ev("article", ret["id"], "walk_started:joy", "Joy Lam started a walk in Teams.", 0, 10, 0, actor_name="Joy Lam")
    ev("article", ret["id"], "assigned", "Assigned to Joy Lam, Kofi Mensah and Aisha Khan by Tomás Ortega.", 4, 9, 0, actor_name="Tomás Ortega")
    ev("article", ret["id"], "checked", "Checked by Tomás Ortega.", 44, 11, 0, actor_name="Tomás Ortega")
    for a in arts:
        if a["state"] == "due":
            ev("article", a["id"], "checked:due", f"Past its check date (due {fmt_day(a['due_on'])}). The team gets it with a warning; customers don't.", (day0 - day_of(a["due_on"])).days, 0, 15)
        if a.get("article_id"):
            ev("article", a["id"], "published", "Approved for the public; copied to the customer answers.", 20, 12, 0, actor_name=a["owner_name"])
    # Sources.
    sources = [
        {"id": kid("sample", "source", "upload"), "kind": "upload", "name": "Uploaded files", "path": INBOX, "last_read_at": at(0, 0, 15),
         "files_seen": 14, "drafted": 9, "unreadable": [
             {"name": "linea-35.ies", "path": f"{INBOX}/linea-35.ies", "why": "an IES light file: the Lemma can't search it"},
             {"name": "showroom-plan.png", "path": f"{INBOX}/showroom-plan.png", "why": "an image: the Lemma can't search it"},
             {"name": "returns-log.xlsx", "path": f"{INBOX}/returns-log.xlsx", "why": "a spreadsheet: the Lemma can't search it, so Know-how made a table page from it", "sheet_page": f"{INBOX}/returns-log.xlsx.md"}],
         "sample": True},
        {"id": kid("sample", "source", "web"), "kind": "website", "name": "fernlow.example", "url": "https://fernlow.example", "last_read_at": at(2, 0, 15),
         "files_seen": 7, "drafted": 4, "unreadable": [], "sample": True},
        {"id": kid("sample", "source", "drive"), "kind": "drive_folder", "name": "Drive · Installer guides", "drive_id": "sample-drive", "last_read_at": at(2, 0, 15),
         "files_seen": 11, "drafted": 5, "unreadable": [{"name": "spec-matrix.xlsx", "why": "a spreadsheet: the Lemma can't search it, so Know-how made a table page from it"}], "sample": True},
        {"id": kid("sample", "source", "teams"), "kind": "teams_file", "name": "Shared in Teams", "path": f"{INBOX}/teams", "last_read_at": at(1, 15, 0),
         "files_seen": 3, "drafted": 1, "unreadable": [{"name": "Install photos.pptx", "why": "slides: the Lemma can't search them"}], "sample": True},
    ]
    # The returns log as a table page beside its (made-up) sheet.
    sheet_text = sheet_page("returns-log.csv", f"{INBOX}/returns-log.xlsx",
                            b"Month,Returns,Unused,Faulty,Top reason\nAugust,41,33,8,Wrong length\nSeptember,37,30,7,Changed mind\nOctober,44,35,9,Wrong length\n")
    sheet_text = sheet_text.replace("returns-log.csv", "returns-log.xlsx").replace("# returns-log", "# Returns log")
    files[f"{INBOX}/returns-log.xlsx.md"] = sheet_text
    arts.append({"id": kid("sample", "sheet", "returns"), "kind": "sheet", "title": "Returns log", "asks": [], "path": f"{INBOX}/returns-log.xlsx.md",
                 "topic_id": tby["orders"]["id"], "owner_member_id": None, "owner_name": "Tomás Ortega", "audience": "team", "state": "live",
                 "checked_at": at(0, 0, 15), "checked_by_name": None, "due_on": None, "checked_hash": sha(sheet_text), "seen_hash": sha(sheet_text),
                 "source": "file", "source_path": f"{INBOX}/returns-log.xlsx", "source_hash": sha(sheet_text), "steps": [], "sample": True,
                 "uses_30d": 0, "misses_30d": 0})
    return {"files": files, "rows": {
        "knowhow_topic": topics, "knowhow_article": arts + drafts, "knowhow_question": questions, "knowhow_change": changes,
        "knowhow_walk": walks, "knowhow_assignment": assigns, "knowhow_source": sources, "knowhow_event": events,
        "article": []}}


def knowhow_sample_data(ctx: FunctionContext, data: KnowhowSampleDataInput) -> KnowhowSampleDataResult:
    pod = ctx.pod
    s = settings_of(pod)
    who = caller(ctx)
    me = who["user_id"]
    if data.mode == "clear":
        marks = q(pod, "SELECT * FROM knowhow_sample_row LIMIT 5000")
        # A sample page may have moved since it was loaded (a draft saved under its topic).
        page_ids = [str(m["row_id"]) for m in marks if m.get("table_name") == "knowhow_article"]
        for start in range(0, len(page_ids), 100):
            for r in q(pod, f"SELECT path FROM knowhow_article WHERE id IN ({lits(page_ids[start: start + 100])})"):
                marks.append({"id": None, "path": r["path"], "table_name": "file"})
        for m in marks:
            if m.get("path"):
                try:
                    pod.files.delete(m["path"])
                except Exception:  # noqa: BLE001
                    pass
        by_table = {}
        for m in marks:
            if m.get("table_name") and m["table_name"] != "file":
                by_table.setdefault(m["table_name"], []).append(str(m["row_id"]))
        for table in ("knowhow_event", "knowhow_change", "knowhow_assignment", "knowhow_walk", "knowhow_question", "article",
                      "knowhow_article", "knowhow_source", "knowhow_topic"):
            ids = by_table.get(table, [])
            for start in range(0, len(ids), 100):
                try:
                    pod.records.bulk_delete(table, ids[start: start + 100])
                except Exception:  # noqa: BLE001
                    for rid in ids[start: start + 100]:
                        try:
                            pod.records.delete(table, rid)
                        except Exception:  # noqa: BLE001
                            pass
        # Anything made while the sample was loaded (a saved draft, a walk, a
        # question asked to try it) goes too, with its file wherever it moved.
        for r in q(pod, "SELECT id, path FROM knowhow_article WHERE sample = true LIMIT 2000"):
            try:
                pod.files.delete(r["path"])
            except Exception:  # noqa: BLE001
                pass
            try:
                pod.records.delete("knowhow_article", r["id"])
            except Exception:  # noqa: BLE001
                pass
        left_pages = {str(r["id"]) for r in q(pod, "SELECT id FROM knowhow_article LIMIT 5000")}
        for table in ("knowhow_change", "knowhow_walk", "knowhow_assignment"):
            orphans = [str(r["id"]) for r in q(pod, f"SELECT id, article_id FROM {table} LIMIT 5000") if str(r.get("article_id")) not in left_pages]
            for start in range(0, len(orphans), 100):
                try:
                    pod.records.bulk_delete(table, orphans[start: start + 100])
                except Exception:  # noqa: BLE001
                    pass
        for table in ("knowhow_question", "knowhow_walk", "knowhow_change", "knowhow_event", "knowhow_assignment"):
            left = [str(r["id"]) for r in q(pod, f"SELECT id FROM {table} WHERE sample = true LIMIT 5000")]
            for start in range(0, len(left), 100):
                try:
                    pod.records.bulk_delete(table, left[start: start + 100])
                except Exception:  # noqa: BLE001
                    pass
        closed = {}
        if me:
            ids = list({str(m["row_id"]) for m in marks if m.get("table_name") in ("knowhow_article", "knowhow_question", "knowhow_change", "knowhow_assignment")})
            scope = f"source_id IN ({lits(ids + [f'approve:{i}' for i in ids])}) OR source_id = {lit('due:' + me)}" if ids else f"source_id = {lit('due:' + me)}"
            closed = needs_you_write(pod, "know-how", me, [], scope)
        mark_ids = [str(m["id"]) for m in marks if m.get("id")]
        for start in range(0, len(mark_ids), 100):
            try:
                pod.records.bulk_delete("knowhow_sample_row", mark_ids[start: start + 100])
            except Exception:  # noqa: BLE001
                pass
        if me:  # Today: the person's items as they are now; everything the sample needed closes
            run_function(pod, "knowhow_mine", {"tell": False})
        prev = s["made"].get("sample_prev") or {}
        fields = {"sample": False, "made": {k: v for k, v in s["made"].items() if k != "sample_prev"}}
        if prev:
            fields.update({"setup_done_at": prev.get("setup_done_at"), "audiences": prev.get("audiences") or {}})
        save_settings(pod, s, fields)
        return KnowhowSampleDataResult(pages=len({m["path"] for m in marks if m.get("path")}), message="Cleared the sample: its pages, questions and Today items are gone.")

    if s.get("sample"):
        return KnowhowSampleDataResult(message="The sample is already loaded.")
    built = build(now(), me, who["name"])
    marks = []
    restricted = {a["path"] for a in built["rows"]["knowhow_article"] if a.get("audience") == "restricted"}
    for path, text in built["files"].items():
        write_page(pod, path, text, restricted=path in restricted)
        marks.append({"id": kid("sample", "mark", "file", path), "table_name": "file", "row_id": sha(path)[:40], "path": path})
    for table, rows_ in built["rows"].items():
        for start in range(0, len(rows_), 100):
            pod.records.bulk_create(table, rows_[start: start + 100], upsert=True)
        marks += [{"id": kid("sample", "mark", table, r["id"]), "table_name": table, "row_id": str(r["id"])} for r in rows_]
    # The two public pages, copied to the shared `article` as Know-how does.
    today = now().date()
    for a in built["rows"]["knowhow_article"]:
        if a.get("audience") == "public" and a.get("state") == "live":
            row = article_public_row(a, built["files"][a["path"]], next((t["name"] for t in built["rows"]["knowhow_topic"] if t["id"] == a["topic_id"]), None))
            pod.records.bulk_create("article", [row], upsert=True)
            marks.append({"id": kid("sample", "mark", "article", row["id"]), "table_name": "article", "row_id": row["id"]})
    for start in range(0, len(marks), 100):
        pod.records.bulk_create("knowhow_sample_row", marks[start: start + 100], upsert=True)
    prev = {"setup_done_at": s.get("setup_done_at"), "audiences": s.get("audiences") or {}}
    fields = {"sample": True, "quiet": True, "made": {**s["made"], "sample_prev": prev}}
    if not s.get("setup_done_at"):
        fields.update({"setup_done_at": now_iso(), "audiences": {"customers": True, "public": True},
                       "places": {"teams": True, "slack_channels": [{"id": "C0SAMPLE", "name": "installers"}], "mailbox": True, "web_chat": True}})
    save_settings(pod, s, fields)
    items = 0
    if me:
        items = int(run_function(pod, "knowhow_mine", {"tell": False}).get("count") or 0)
    rows_ = built["rows"]
    return KnowhowSampleDataResult(pages=sum(1 for a in rows_["knowhow_article"] if a["state"] != "draft" and a["kind"] != "sheet"),
                                   questions=len([r for r in rows_["knowhow_question"] if not r.get("walk_step") and not r.get("same_as")]), today_items=items,
                                   message=f"Loaded the sample Wednesday at Fernlow: 20 pages, 48 questions this month, {plural(items, 'Today item')} for you. Nothing is posted outside the Lemma.")
