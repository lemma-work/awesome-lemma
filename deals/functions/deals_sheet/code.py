#input_type_name: DealsSheetInput
#output_type_name: DealsSheetResult
#function_name: deals_sheet

"""Bring in deals pasted from a spreadsheet: rows copied from Google Sheets,
Excel or Numbers (tab-separated) or a CSV export.

`preview` reads the paste and says what it would add, row by row, with
anything it couldn't read; nothing is written. `import` adds them: each a
team deal from `spreadsheet`, owned by the person (or by whoever the owner
column names, as a name), with one history line. A row the team already has
(the same name at the same company) is left alone.

The first row names the columns; the usual words for each are understood
(Deal, Name, Opportunity; Company, Account, Client; Contact, Email; Stage,
Status; Amount, Value; Currency; Close date, Expected close; Next step;
Owner). A stage that isn't one of the team's goes in the first open stage,
and says so.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

MAX_ROWS = 500
COLUMNS = {
    "name": ["deal", "deal name", "name", "opportunity", "opportunity name", "title", "what", "product", "deal title"],
    "company": ["company", "company name", "account", "account name", "organisation", "organization", "client", "customer", "org"],
    "contact": ["contact", "contact email", "email", "main contact", "person", "contact name", "primary contact"],
    "stage": ["stage", "deal stage", "pipeline stage", "status", "phase"],
    "amount": ["amount", "value", "deal value", "size", "deal size", "price", "total", "revenue", "arr", "acv"],
    "currency": ["currency", "cur", "ccy"],
    "close_date": ["close date", "close", "expected close", "expected close date", "closing date", "close by", "due", "due date", "closes"],
    "next_step": ["next step", "next", "next action", "next steps", "action"],
    "owner": ["owner", "deal owner", "rep", "sales rep", "assigned to", "owner name"],
}
SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP", "₹": "INR", "¥": "JPY"}
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


class DealsSheetInput(BaseModel):
    text: str = ""
    mode: str = "preview"
    display_name: str | None = None


class DealsSheetResult(BaseModel):
    columns: dict
    rows: list[dict]
    ready: int
    problems: int
    added: int = 0
    already: int = 0
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _key(header: str) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", header.lower()).split("(")[0].strip().replace("  ", " ")


def _amount(text: str) -> tuple[float | None, str | None]:
    raw = (text or "").strip()
    if not raw:
        return None, None
    currency = next((code for sym, code in SYMBOLS.items() if sym in raw), None)
    code = re.search(r"\b([A-Z]{3})\b", raw)
    if code:
        currency = code.group(1)
    t = raw.lower().replace(" ", "")
    t = re.sub(r"[^0-9.,km]", "", t)
    mult = 1_000 if t.endswith("k") else 1_000_000 if t.endswith("m") else 1
    t = t.rstrip("km")
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", t):
        t = t.replace(".", "")  # 1.200 or 12.500.000: dots between thousands
    elif re.fullmatch(r"\d{1,3}(,\d{3})+", t):
        t = t.replace(",", "")
    elif t.count(",") and t.count("."):
        t = t.replace(",", "") if t.rfind(".") > t.rfind(",") else t.replace(".", "").replace(",", ".")
    elif t.count(",") == 1 and len(t.split(",")[1]) != 3:
        t = t.replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        return float(t) * mult, currency
    except ValueError:
        return None, currency


def _date(text: str) -> date | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", raw)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y += 2000 if y < 100 else 0
        day, month = (a, b) if a > 12 or b <= 12 else (b, a)
        if b > 12:
            day, month = b, a
        try:
            return date(y, month, day)
        except ValueError:
            return None
    words = re.findall(r"[a-z]+|\d+", raw.lower())
    month = next((MONTHS[w[:3]] for w in words if w[:3] in MONTHS), None)
    nums = [int(w) for w in words if w.isdigit()]
    year = next((n for n in nums if n > 1900), None)
    day = next((n for n in nums if 1 <= n <= 31), None)
    if month and year and day:
        try:
            return date(year, month, day)
        except ValueError:
            return None
    return None


def deals_sheet(ctx: FunctionContext, data: DealsSheetInput) -> DealsSheetResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    text = (data.text or "").strip("\n\r ")
    if not text:
        return DealsSheetResult(columns={}, rows=[], ready=0, problems=0, message="Nothing pasted.")
    lines = [line for line in text.splitlines() if line.strip()]
    sample = "\n".join(lines[:5])
    delim = "\t" if "\t" in sample else ";" if sample.count(";") > sample.count(",") else ","
    table = [row for row in csv.reader(io.StringIO("\n".join(lines)), delimiter=delim)]
    header = [h.strip() for h in table[0]]
    columns: dict[str, int] = {}
    for i, h in enumerate(header):
        k = _key(h)
        for field, words in COLUMNS.items():
            if field not in columns and k in words:
                columns[field] = i
                break
    if "name" not in columns and "company" not in columns:
        return DealsSheetResult(columns={}, rows=[], ready=0, problems=1,
                                message="Couldn't tell which column is what. Paste the header row too: Deal, Company, Stage, Amount…")

    stages = _rows(pod.query("SELECT name, kind FROM deals_stage ORDER BY position, name"))
    stage_by = {s["name"].lower(): s for s in stages}
    first_open = next((s["name"] for s in stages if s["kind"] == "open"), None)
    won = next((s["name"] for s in stages if s["kind"] == "won"), None)
    lost = next((s["name"] for s in stages if s["kind"] == "lost"), None)
    team = (_rows(pod.query("SELECT currency FROM deals_settings LIMIT 1")) or [{}])[0]
    currency = team.get("currency") or "USD"
    member = (_rows(pod.query("SELECT display_name FROM deals_member ORDER BY created_at LIMIT 1")) or [{}])[0]
    my_name = data.display_name or member.get("display_name") or ctx.user_email

    def cell(row: list[str], field: str) -> str:
        i = columns.get(field)
        return row[i].strip() if i is not None and i < len(row) else ""

    out: list[dict] = []
    for n, row in enumerate(table[1:MAX_ROWS + 1], start=2):
        if not any(c.strip() for c in row):
            continue
        problems: list[str] = []
        company = cell(row, "company")
        name = cell(row, "name") or (f"{company} deal" if company else "")
        if not name:
            problems.append("no deal name or company")
        contact = cell(row, "contact")
        handle = contact.lower() if "@" in contact else None
        stage_text = cell(row, "stage")
        stage = stage_by.get(stage_text.lower())
        if not stage and stage_text:
            low = stage_text.lower()
            if "won" in low or low in ("closed", "signed", "done"):
                stage = stage_by.get((won or "").lower())
            elif "lost" in low or "dead" in low:
                stage = stage_by.get((lost or "").lower())
        if not stage:
            if stage_text:
                problems.append(f"\"{stage_text}\" isn't one of your stages: put in {first_open}")
            stage = stage_by.get((first_open or "").lower())
        amount, cur = _amount(cell(row, "amount"))
        if cell(row, "amount") and amount is None:
            problems.append(f"couldn't read the amount \"{cell(row, 'amount')}\"")
        cur = (cell(row, "currency").upper()[:3] or cur or currency)
        close = _date(cell(row, "close_date"))
        if cell(row, "close_date") and not close:
            problems.append(f"couldn't read the date \"{cell(row, 'close_date')}\"")
        out.append({
            "row": n, "name": name[:200], "company_name": company[:200] or None,
            "people": [{"handle": handle, "name": None}] if handle else [],
            "contact_name": None if handle else (contact[:200] or None),
            "stage": stage["name"] if stage else None, "status": stage["kind"] if stage else "open",
            "amount": amount, "currency": cur if re.fullmatch(r"[A-Z]{3}", cur or "") else currency,
            "close_date": close.isoformat() if close else None, "next_step": cell(row, "next_step")[:300] or None,
            "owner": cell(row, "owner")[:200] or None, "problems": problems,
            "ok": bool(name) and bool(stage),
        })

    ready = sum(1 for r in out if r["ok"])
    named = {field: header[i] for field, i in columns.items()}
    if data.mode != "import":
        flagged = sum(1 for r in out if r["problems"])
        return DealsSheetResult(columns=named, rows=out, ready=ready, problems=flagged,
                                message=f"{ready} of {len(out)} rows ready to add" + (f"; {flagged} with something to check" if flagged else "") + ".")

    existing = {(str(r.get("name") or "").lower(), str(r.get("company_name") or "").lower())
                for r in _rows(pod.query("SELECT name, company_name FROM deal LIMIT 20000"))}
    companies = {str(r["name"]).lower(): r for r in _rows(pod.query("SELECT id, name, domain FROM company LIMIT 20000"))}
    domains = {r["domain"]: r for r in _rows(pod.query(
        "SELECT d.domain, c.id, c.name, c.domain AS main FROM company_domain d JOIN company c ON c.id = d.company_id LIMIT 20000"))}
    added = already = 0
    for r in out:
        if not r["ok"]:
            continue
        if (r["name"].lower(), (r["company_name"] or "").lower()) in existing:
            already += 1
            r["added"] = False
            continue
        found = companies.get((r["company_name"] or "").lower())
        if not found and r["people"]:
            d = domains.get(r["people"][0]["handle"].split("@", 1)[1])
            found = {"id": d["id"], "name": d["name"], "domain": d["main"]} if d else None
        mine = not r["owner"] or r["owner"].lower() in {(my_name or "").lower(), (ctx.user_email or "").lower()}
        digest = hashlib.sha1("|".join(str(r.get(k)) for k in ("name", "company_name", "row")).encode()).hexdigest()[:16]
        created = pod.records.create("deal", {
            "name": r["name"], "company_id": (found or {}).get("id"), "company_name": (found or {}).get("name") or r["company_name"],
            "company_domain": (found or {}).get("domain") or (r["people"][0]["handle"].split("@", 1)[1] if r["people"] else None),
            "people": r["people"] or ([{"handle": None, "name": r["contact_name"]}] if r["contact_name"] else []),
            "owner_user_id": ctx.user_id if mine else None, "owner_name": my_name if mine else r["owner"],
            "stage": r["stage"], "status": r["status"], "amount": r["amount"], "currency": r["currency"],
            "close_date": r["close_date"], "next_step": r["next_step"],
            "closed_at": now if r["status"] != "open" else None, "source": "spreadsheet", "source_id": f"sheet:{digest}",
            "last_activity_at": now,
        })
        payload = created.to_dict() if hasattr(created, "to_dict") else created
        pod.records.create("deals_history", {
            "deal_id": payload["id"], "field": "created", "to_value": {"name": r["name"], "stage": r["stage"], "amount": r["amount"]},
            "by_user_id": ctx.user_id, "by_name": my_name, "how": "spreadsheet", "at": now})
        existing.add((r["name"].lower(), (r["company_name"] or "").lower()))
        r["added"] = True
        added += 1
    return DealsSheetResult(columns=named, rows=out, ready=ready, problems=sum(1 for r in out if r["problems"]),
                            added=added, already=already,
                            message=f"Added {added} deal{'s' if added != 1 else ''}" + (f"; {already} the team already had" if already else "") + ".")
