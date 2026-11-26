#input_type_name: KnowhowReadSourceInput
#output_type_name: KnowhowReadSourceResult
#function_name: knowhow_read_source

"""What's new or changed in Know-how's sources, ready for knowhow_reader.

- Uploads (/know-how/_inbox/, including files shared in Teams and filed
  there): each new or changed file. Documents are read as the platform
  converted them. A CSV or xlsx sheet becomes a Markdown table page beside it
  ("<file>.md", marked "made from <file>"), made again when the file changes
  (standard library only). Slides, images and IES files can't be searched:
  each is named, with why.
- A website: its address, for the reader to read with web_fetch.
- A Google Drive folder: its files through the googledrive connector, when
  connected (operation names from the live catalog; not verified).

Returns one reading brief (`context`, at most READ_BUDGET characters); files
past the budget are read on the next run (set-up's Read again, or the
nightly check).
"""

from __future__ import annotations

import uuid

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

READ_BUDGET = 18000
PER_FILE = 5000
DOCS = (".pdf", ".doc", ".docx", ".odt", ".rtf", ".md", ".markdown", ".txt", ".html", ".htm", ".epub")


class KnowhowReadSourceInput(BaseModel):
    source_ids: list[str] = []
    # Set-up's first form: what was given.
    website: str | None = None
    drive_folders: list[dict] = []
    note: str | None = None


class KnowhowReadSourceResult(BaseModel):
    context: str = ""
    source_ids: list[str] = []
    files: int = 0
    sheets: int = 0
    unreadable: list[dict] = []
    more: bool = False
    nothing: bool = False
    message: str


def entries(pod, folder: str, depth: int = 0) -> list:
    """Every file under a folder (three levels at most)."""
    out = []
    try:
        listed = pod.files.list_all(folder)
    except Exception:  # noqa: BLE001
        return out
    for e in listed:
        e = as_dict(e)
        path = str(e.get("path") or (folder.rstrip("/") + "/" + str(e.get("name") or "")))
        if str(e.get("type") or e.get("kind") or "").upper() in ("FOLDER", "DIRECTORY") or e.get("is_folder"):
            if depth < 3:
                out += entries(pod, path, depth + 1)
        else:
            out.append({"path": path, "name": str(e.get("name") or path.rsplit("/", 1)[-1]),
                        "version": f"{e.get('updated_at') or ''}|{e.get('size') or e.get('size_bytes') or ''}"})
    return out


def make_sheet_page(pod, f: dict, s: dict) -> dict | None:
    """The table page beside a sheet, and its row (kind sheet, live, made by Know-how)."""
    try:
        data = pod.files.download(f["path"])
        text = sheet_page(f["name"], f["path"], data)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"[:200]}
    page = f["path"] + ".md"
    write_page(pod, page, text)
    aid = kid("sheet", f["path"])
    existing = q(pod, f"SELECT id FROM knowhow_article WHERE id = {lit(aid)} LIMIT 1")
    row = {"id": aid, "kind": "sheet", "title": f["name"].rsplit(".", 1)[0], "path": page, "state": "live",
           "audience": "team", "source": "file", "source_path": f["path"], "source_hash": sha(text), "checked_at": now_iso(),
           "checked_hash": sha(text), "seen_hash": sha(text), "sample": bool(s.get("sample"))}
    if not existing:
        row["checked_by_name"] = None
    pod.records.bulk_create("knowhow_article", [row], upsert=True)
    add_events(pod, "article", aid, [{"kind": "edited", "key": f"made:{sha(text)[:12]}", "text": f"Made from {f['name']} (a spreadsheet)."}])
    return row


def knowhow_read_source(ctx: FunctionContext, data: KnowhowReadSourceInput) -> KnowhowReadSourceResult:
    pod = ctx.pod
    s = settings_of(pod)
    sample = bool(s.get("sample"))
    # Set-up's sources become knowhow_source rows.
    if data.website:
        url = data.website.strip()
        url = url if url.startswith("http") else "https://" + url
        pod.records.bulk_create("knowhow_source", [{"id": kid("source", "website", url), "kind": "website", "name": url.split("//", 1)[-1].rstrip("/"),
                                                   "url": url, "sample": sample}], upsert=True)
    for d in data.drive_folders or []:
        if d.get("id"):
            pod.records.bulk_create("knowhow_source", [{"id": kid("source", "drive", d["id"]), "kind": "drive_folder", "name": d.get("name") or "Drive folder",
                                                       "drive_id": d["id"], "account_id": d.get("account_id"), "sample": sample}], upsert=True)
    ensure_folder(pod, INBOX)
    pod.records.bulk_create("knowhow_source", [{"id": kid("source", "upload"), "kind": "upload", "name": "Uploaded files", "path": INBOX}], upsert=True)
    where = f"id IN ({lits(data.source_ids)})" if data.source_ids else "sample = false OR sample IS NULL"
    sources = q(pod, f"SELECT * FROM knowhow_source WHERE {where} LIMIT 50")
    parts, used, more, files, sheets, unreadable, read_ids = [], 0, False, 0, 0, [], []
    for src in sources:
        seen = json_obj(src.get("seen"))
        bad = [u for u in json_list(src.get("unreadable")) if isinstance(u, dict)]
        kind = src.get("kind")
        took = 0
        if kind in ("upload", "teams_file"):
            for f in entries(pod, src.get("path") or INBOX):
                if f["path"].endswith(".md") and any(f["path"] == x + ".md" for x in seen):
                    continue  # a sheet's own table page
                if seen.get(f["path"]) == f["version"]:
                    continue
                ext = ("." + f["name"].rsplit(".", 1)[-1].lower()) if "." in f["name"] else ""
                why = unsearchable_why(f["name"])
                if ext in SHEETS:
                    made = make_sheet_page(pod, f, s)
                    if made and not made.get("error"):
                        sheets += 1
                        bad = [u for u in bad if u.get("path") != f["path"]] + [{"name": f["name"], "path": f["path"], "why": why, "sheet_page": made["path"]}]
                        seen[f["path"]] = f["version"]
                        continue
                if why and ext not in SHEETS:
                    bad = [u for u in bad if u.get("path") != f["path"]] + [{"name": f["name"], "path": f["path"], "why": why}]
                    seen[f["path"]] = f["version"]
                    continue
                if ext and ext not in DOCS:
                    seen[f["path"]] = f["version"]
                    continue
                if used >= READ_BUDGET:
                    more = True
                    break
                text = ""
                try:
                    raw = pod.files.download_markdown(f["path"])
                    text = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
                except Exception:  # noqa: BLE001
                    text = read_page(pod, f["path"]) if ext in (".md", ".markdown", ".txt") else ""
                if not text.strip():
                    bad = [u for u in bad if u.get("path") != f["path"]] + [{"name": f["name"], "path": f["path"], "why": "nothing could be read from it yet (still being processed, or a scan with no text)"}]
                    continue
                chunk = text[:PER_FILE]
                parts.append(f"=== File: {f['path']} ===\n{chunk}" + ("\n[…the rest of the file is longer; read it with your file tools if you need it]" if len(text) > PER_FILE else ""))
                used += len(chunk)
                seen[f["path"]] = f["version"]
                files += 1
                took += 1
        elif kind == "website":
            parts.append(f"=== Website: {src.get('url')} ===\nRead this site with web_fetch: the home page and up to six pages that answer customers' questions (FAQ, delivery, returns, warranty, support). Quote what you use.")
            took += 1
        elif kind == "drive_folder":
            try:
                got = as_dict(pod.connectors.execute("googledrive", "GOOGLEDRIVE_FIND_FILE", {"q": f"'{src.get('drive_id')}' in parents and trashed = false", "page_size": 50},
                                                     account_id=src.get("account_id")))
                found = (as_dict(got.get("data")) or got).get("files") or []
                for f in found[:20]:
                    f = as_dict(f)
                    if seen.get(f.get("id")) == f.get("modifiedTime"):
                        continue
                    if used >= READ_BUDGET:
                        more = True
                        break
                    doc = as_dict(pod.connectors.execute("googledrive", "GOOGLEDRIVE_PARSE_FILE", {"file_id": f.get("id")}, account_id=src.get("account_id")))
                    text = str((as_dict(doc.get("data")) or doc).get("content") or "")[:PER_FILE]
                    if text:
                        parts.append(f"=== Drive file: {f.get('name')} (drive:{f.get('id')}) ===\n{text}")
                        used += len(text)
                        files += 1
                        took += 1
                    seen[str(f.get("id"))] = f.get("modifiedTime")
            except Exception as exc:  # noqa: BLE001
                pod.table("knowhow_source").update(src["id"], {"note": clip(f"Couldn't read the folder: {type(exc).__name__}: {exc}", 900)})
                continue
        pod.table("knowhow_source").update(src["id"], {"seen": seen, "unreadable": bad, "last_read_at": now_iso(),
                                                      "files_seen": len(seen), "note": None})
        unreadable += bad
        if took:
            read_ids.append(src["id"])
    if not parts:
        return KnowhowReadSourceResult(nothing=True, sheets=sheets, unreadable=unreadable, source_ids=read_ids,
                                       context="Nothing new to read.",
                                       message="Nothing new to read." + (f" Made {plural(sheets, 'table page')} from spreadsheets." if sheets else ""))
    topics = [t["name"] for t in topics_of(pod)]
    head = ("Sources to read for the team's know-how." + (f" The team's topics so far: {', '.join(topics)}." if topics else "")
            + (f"\nWhat they said about their sources: {clip(data.note or s.get('sources_note'), 600)}" if (data.note or s.get("sources_note")) else ""))
    context = head + "\n\n" + "\n\n".join(parts)
    return KnowhowReadSourceResult(context=context[: READ_BUDGET + 3000], source_ids=read_ids, files=files, sheets=sheets,
                                   unreadable=unreadable, more=more,
                                   message=f"Read {plural(files, 'file')}" + (f", made {plural(sheets, 'table page')}" if sheets else "")
                                           + (f"; {len(unreadable)} can't be searched" if unreadable else "") + (". More next time." if more else "."))
