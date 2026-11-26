#input_type_name: KnowhowAssignInput
#output_type_name: KnowhowAssignResult
#function_name: knowhow_assign

"""Assign a procedure to people: members by id (the app resolves a role to its
members when it assigns by role). Each gets a `do` item in Today, "Walk
*Issue a return*", from their own knowhow_mine. unassign takes one off.
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


class KnowhowAssignInput(BaseModel):
    article_id: str
    members: list[dict] = []
    role: str | None = None
    due_on: str | None = None
    unassign_id: str | None = None


class KnowhowAssignResult(BaseModel):
    assigned: int = 0
    message: str


def knowhow_assign(ctx: FunctionContext, data: KnowhowAssignInput) -> KnowhowAssignResult:
    pod = ctx.pod
    who = caller(ctx)
    a = find_article(pod, data.article_id)
    if not a or a.get("kind") != "procedure":
        return KnowhowAssignResult(message="Only a procedure can be assigned.")
    if data.unassign_id:
        pod.records.delete("knowhow_assignment", data.unassign_id)
        return KnowhowAssignResult(message="Taken off.")
    rows_ = []
    for m in data.members:
        mid = str(m.get("member_id") or m.get("user_id") or "")
        if not mid:
            continue
        rows_.append({"id": kid("assignment", a["id"], mid), "article_id": a["id"], "member_id": mid, "member_name": m.get("name"),
                      "role": data.role, "assigned_by": who["user_id"], "assigned_by_name": who["name"], "assigned_at": now_iso(),
                      "due_on": data.due_on, "state": "assigned"})
    existing = {str(r["id"]) for r in q(pod, f"SELECT id FROM knowhow_assignment WHERE article_id = {lit(a['id'])} LIMIT 500")}
    fresh = [r for r in rows_ if r["id"] not in existing]
    if fresh:
        pod.records.bulk_create("knowhow_assignment", fresh, upsert=True)
        names = ", ".join(r["member_name"] or "a member" for r in fresh[:6])
        add_events(pod, "article", a["id"], [{"kind": "assigned", "key": f"assigned:{now_iso()}", "actor": who["user_id"] or "lemma",
                                              "actor_name": who["name"], "text": f"Assigned to {names}" + (f" (role {data.role})" if data.role else "") + "."}])
    return KnowhowAssignResult(assigned=len(fresh), message=f"Assigned to {plural(len(fresh), 'person', 'people')}" + (" (the rest already had it)." if len(fresh) < len(rows_) else "."))
