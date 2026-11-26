#!/usr/bin/env python3
"""Unit checks for Know-how's functions that need no Lemma: step parsing, the
source line, the late and in-date rules, a customer answer leaving `article`
on its due day, repeats, the sensitive asker split, Today's items and their
versions, sheets as table pages, `article` ids, the sample's own consistency,
and the shared code word for word.

    uv run --no-project python bin/check.py

Each function file is loaded with stand-ins for `lemma_sdk` and `pydantic`,
and a small stand-in Lemma answers the reads the checked parts make.
Python's standard library only.
"""

from __future__ import annotations

import io
import re
import subprocess
import sys
import types
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FAILED: list[str] = []


def load(name: str) -> dict:
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": name}
    exec(compile((HERE / "functions" / name / "code.py").read_text(), name, "exec"), scope)
    return scope


def check(what: str, ok: bool) -> None:
    print(("ok    " if ok else "FAIL  ") + what)
    if not ok:
        FAILED.append(what)


class Pod:
    """Answers `SELECT ... FROM <table> [WHERE id = '...' | same_as = '...']` from the rows given; records writes."""

    def __init__(self, tables: dict):
        self.tables = {k: ([dict(r) for r in v] if isinstance(v, list) else v) for k, v in tables.items()}
        self.writes: list = []
        self.deleted: list = []

    def query(self, sql: str):
        table = re.search(r"\bFROM\s+(\w+)", sql, re.I).group(1)
        got = list(self.tables.get(table, []))
        for col in ("id", "same_as"):
            m = re.search(rf"\b{col}\s*=\s*'([^']+)'", sql)
            if m and "OR" not in sql.upper().split("WHERE", 1)[-1]:
                got = [r for r in got if str(r.get(col)) == m.group(1)]
        return {"items": got}

    class _T:
        def __init__(self, pod, name):
            self.pod, self.name = pod, name

        def update(self, rid, data):
            self.pod.writes.append(("update", self.name, rid, data))
            for r in self.pod.tables.get(self.name, []):
                if str(r.get("id")) == str(rid):
                    r.update(data)

    def table(self, name):
        return Pod._T(self, name)

    class _R:
        def __init__(self, pod):
            self.pod = pod

        def bulk_create(self, table, rows, upsert=False):
            for r in rows:
                self.pod.writes.append(("create", table, r.get("id"), r))
                have = self.pod.tables.setdefault(table, [])
                have[:] = [x for x in have if str(x.get("id")) != str(r.get("id"))] + [dict(r)]

        def delete(self, table, rid):
            self.pod.deleted.append((table, rid))
            self.pod.tables[table] = [x for x in self.pod.tables.get(table, []) if str(x.get("id")) != str(rid)]

    @property
    def records(self):
        return Pod._R(self)

    class _F:
        def __init__(self, pod):
            self.pod = pod

        def download(self, path):
            return self.pod.tables.get("_files", {}).get(path, "").encode()

    @property
    def files(self):
        return Pod._F(self)


class Ctx:
    def __init__(self, pod, user_id=None, name="Ada Example", contact_id=None):
        self.pod, self.user_id, self.user_name, self.user_email, self.contact_id = pod, user_id, name, None, contact_id


def main() -> int:
    c = load("knowhow_check")
    today = date(2026, 11, 25)

    # Steps: `### n. Title`, an optional `Who:` line, the text under it.
    text = "# Issue a return\n\nIntro.\n\n### 1. Find the order\nWho: Customer service\nLook it up.\n\n### 2. Check it\nUnused and boxed.\n\n## Notes\nnot a step\n"
    steps = c["parse_steps"](text)
    check("steps: two steps parsed from ### headings", [s["title"] for s in steps] == ["Find the order", "Check it"])
    check("steps: Who: line read as who does it", steps[0]["who"] == "Customer service" and steps[1]["who"] is None)
    check("steps: a ## heading ends the last step", steps[1]["body"] == "Unused and boxed.")
    cache = c["steps_cache"](text, [{"anchor": "1-find-the-order", "n": 1, "reached": 9, "asked": 2}])
    check("steps: counts kept across a re-read, matched by anchor", cache[0]["reached"] == 9 and cache[0]["asked"] == 2 and cache[1]["reached"] == 0)
    check("steps: the Made-from note is not part of the page", c["strip_mark"]("> Made from *x.csv* (/a/x.csv). …\n\n# X\n").startswith("# X"))

    # The source line, and the late rule.
    a = {"title": "Lead times", "checked_by_name": "Priya Raman", "checked_at": "2026-11-03T11:00:00+00:00", "owner_name": "Priya Raman",
         "due_on": "2026-11-17", "state": "live", "audience": "team"}
    check("source line names the page, who checked it and when", c["source_line"](a) == "From *Lead times*, checked by Priya Raman on 3 Nov.")
    check("late: on and after its due day", c["is_late"](a, date(2026, 11, 17)) and c["is_late"](a, today) and not c["is_late"](a, date(2026, 11, 16)))
    check("late line warns and names the owner", c["late_line"](a) == "Past its check date (due 17 Nov). I've asked Priya to look.")
    sheet = {"kind": "sheet", "title": "Price list", "source_path": "/know-how/_inbox/price-list.xlsx", "checked_at": "2026-11-20"}
    check("a sheet's source line says it was made from its file", c["source_line"](sheet) == "From the sheet *Price list*, made from price-list.xlsx on 20 Nov.")

    # Customers: only live, checked, in date, meant for customers.
    cust = {**a, "audience": "customers", "due_on": "2026-12-20"}
    check("customer_ok: live, checked, in date, for customers", c["customer_ok"](cust, today))
    check("customer_ok: never on its due day", not c["customer_ok"]({**cust, "due_on": "2026-11-25"}, today))
    check("customer_ok: never for a team page", not c["customer_ok"]({**cust, "audience": "team"}, today))
    check("customer_ok: never a draft or unchecked page", not c["customer_ok"]({**cust, "state": "draft"}, today) and not c["customer_ok"]({**cust, "checked_at": None}, today))

    # `article`: id from the namespace, good_until the day before the due day; out on the due day.
    aid = "11111111-2222-3333-4444-555555555555"
    check("article id is uuid5(ARTICLE_NS, 'know-how:<id>')", c["article_row_id"](aid) == str(uuid.uuid5(uuid.UUID("60a094a9-68d4-4995-8508-e9a616fcd38c"), f"know-how:{aid}")))
    pub = {**a, "id": aid, "audience": "public", "due_on": "2026-11-29", "path": "/know-how/orders/warranty.md", "topic_id": None, "kind": "policy"}
    row = c["article_public_row"](pub, "# Warranty\n\nTen years on profiles.\n", "Orders")
    check("article row: good_until is the day before its check date", row["good_until"] == "2026-11-28" and row["source_plugin"] == "know-how")
    check("article row: summary is the first paragraph", row["summary"] == "Ten years on profiles.")
    pod = Pod({"article": [{"id": c["article_row_id"](aid)}], "knowhow_article": [dict(pub)], "knowhow_topic": [],
               "_files": {pub["path"]: "# Warranty\n\nTen years on profiles.\n"}})
    c["publish_one"](pod, pub, date(2026, 11, 28))
    check("publish: still in `article` the day before its due day", any(t == "article" for _, t, *_ in pod.writes) and not pod.deleted)
    c["publish_one"](pod, pub, date(2026, 11, 29))
    check("publish: taken out of `article` on its due day", ("article", c["article_row_id"](aid)) in pod.deleted)

    # Repeats and the sensitive asker.
    ans = load("knowhow_answer")
    first = {"id": "q-first", "times": 1, "same_as": None}
    pod = Pod({"knowhow_question": [first], "knowhow_my_question": [], "knowhow_article": [], "knowhow_event": []})
    ctx = Ctx(pod, user_id="u-1")
    row = ans["log_question"](pod, ctx, "Can I get RAL 7016?", {"source": "slack", "place": "#installers"}, "missed", same_as="q-first",
                              topic={"id": "t1", "sensitive": False})
    check("repeat: joined to the first asking", row["same_as"] == "q-first")
    check("repeat: the first one's count goes up", any(w[1] == "knowhow_question" and w[2] == "q-first" and w[3].get("times") == 2 for w in pod.writes))
    pod = Pod({"knowhow_question": [], "knowhow_my_question": [], "knowhow_article": [], "knowhow_event": []})
    row = ans["log_question"](pod, Ctx(pod, user_id="u-2", name="Sam Example"), "Eye test paid back?", {"source": "teams", "channel_id": "ch-9"}, "missed",
                              topic={"id": "hr", "sensitive": True})
    mine = [w for w in pod.writes if w[1] == "knowhow_my_question"]
    check("sensitive: no asker on the team's row", row["asked_by_member"] is None and row["asked_by_name"] is None and row["channel_id"] is None)
    check("sensitive: the asker's own row keeps the link", len(mine) == 1 and mine[0][3]["question_id"] == row["id"] and mine[0][3]["channel_id"] == "ch-9")
    events = [w for w in pod.writes if w[1] == "knowhow_event"]
    check("sensitive: Activity says 'Someone', never the name", events and events[0][3]["text"].startswith("Someone asked") and "Sam" not in events[0][3]["text"])
    q1 = ans["question_id"]("u-1", {"channel_id": "c"}, "same words")
    check("one row per asking: a retried call writes the same id", q1 == ans["question_id"]("u-1", {"channel_id": "c"}, "same words"))

    # Today's items and their versions.
    mine_ = load("knowhow_mine")
    s = {"audiences": {"customers": True}, "customer_lead_days": 14}
    me = "u-me"
    late1 = {"id": "a1", "title": "VPN access", "owner_member_id": me, "kind": "answer", "state": "due", "due_on": "2026-11-01", "audience": "team", "steps": []}
    late2 = {"id": "a2", "title": "Payslips", "owner_member_id": me, "kind": "answer", "state": "live", "due_on": "2026-11-20", "audience": "team", "steps": []}
    leaving = {"id": "a3", "title": "Warranty", "owner_member_id": me, "kind": "policy", "state": "live", "due_on": "2026-11-29", "audience": "public", "steps": []}
    draft = {"id": "d1", "title": "Custom RAL colours", "owner_member_id": me, "kind": "answer", "state": "draft", "source": "reply", "steps": [],
             "_question": {"id": "q9", "times": 4}}
    miss = {"id": "q5", "text": "Do we ship to Norway?", "owner_member_id": me, "topic_id": "t1", "state": "asked", "outcome": "missed", "times": 1}
    arts = [late1, late2, leaving, draft]
    items = mine_["items_for"](me, s, today, {"check_rhythm": "daily"}, [{"id": "t1"}], [miss], [draft], [], arts, [], {a["id"]: a for a in arts})
    verbs = sorted(i["verb"] for i in items)
    check("today: answer, decide and do items written", verbs == ["answer", "decide", "do", "do"])
    due_item = next(i for i in items if i["source_id"] == f"due:{me}")
    check("today: one item for every page past its check date", due_item["title"].startswith("2 answers of yours are past"))
    again = mine_["items_for"](me, s, today, {"check_rhythm": "daily"}, [], [], [], [], [late1, late2], [], {})
    check("today: its version is the set of pages (same set, same version)", next(i for i in again if i["source_id"] == f"due:{me}")["source_version"] == due_item["source_version"])
    fewer = mine_["items_for"](me, s, today, {"check_rhythm": "daily"}, [], [], [], [], [late1], [], {})
    check("today: a new set is a new version (a dismissal opens again)", next(i for i in fewer if i["source_id"] == f"due:{me}")["source_version"] != due_item["source_version"])
    check("today: a customer answer about to leave is a do item", any("leaves the customer answers on 29 Nov" in i["title"] for i in items))
    check("today: the draft opens on its question", next(i for i in items if i["verb"] == "decide")["path"] == "/q/q9")
    weekly = mine_["items_for"](me, s, today, {"check_rhythm": "weekly", "check_day": (today.weekday() + 1) % 7}, [], [], [], [], [late1], [], {})
    check("today: weekly checks wait for their day", not any(i["source_id"] == f"due:{me}" for i in weekly))

    # A change written into its step.
    dec = load("knowhow_decide")
    page = "# R\n\n### 1. Find\nA.\n\n### 2. Check\nB.\n\n### 3. Raise\nC.\n"
    added = dec["apply_change"](page, {"kind": "add_to_step", "step": 2, "text": "If the box is gone, any sturdy box."})
    check("change: added under its step, before the next", added.index("any sturdy box") < added.index("### 3.") and added.index("any sturdy box") > added.index("B."))
    new = dec["apply_change"](page, {"kind": "new_step", "step": 1, "text": "Ask why\nNote the reason."})
    check("change: a new step is numbered in, and the rest renumbered", [s["title"] for s in c["parse_steps"](new)] == ["Find", "Ask why", "Check", "Raise"])

    # Sheets as table pages (standard library only).
    csv_page = c["sheet_page"]("prices.csv", "/know-how/_inbox/prices.csv", b"Code,Price\nPSU-60,24\nPSU-150,48\n")
    check("sheet: a CSV becomes a Markdown table marked made from its file", "> Made from *prices.csv*" in csv_page and "| PSU-150 | 48 |" in csv_page)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Drivers" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Code</t></si><si><t>Watts</t></si><si><t>PSU-150</t></si></sst>')
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>150.0</v></c></row></sheetData></worksheet>')
    xlsx_page = c["sheet_page"]("drivers.xlsx", "/know-how/_inbox/drivers.xlsx", buf.getvalue())
    check("sheet: an xlsx becomes one table per sheet", "## Drivers" in xlsx_page and "| PSU-150 | 150 |" in xlsx_page)
    check("unsearchable: an IES file is named, with why", c["unsearchable_why"]("linea-35.ies") == "an IES light file: the Lemma can't search it")

    # The sample, as specified.
    smp = load("knowhow_sample_data")
    built = smp["build"](datetime(2026, 11, 25, 14, 0, tzinfo=timezone.utc), "u-me", "You")
    arts = built["rows"]["knowhow_article"]
    pages = [a for a in arts if a["state"] != "draft" and a["kind"] != "sheet"]
    kinds = {k: sum(1 for a in pages if a["kind"] == k) for k in ("answer", "procedure", "policy")}
    check("sample: 20 pages, 13 answers, 4 procedures, 3 policies", len(pages) == 20 and kinds == {"answer": 13, "procedure": 4, "policy": 3})
    check("sample: every page is a real file", all(a["path"] in built["files"] for a in arts))
    check("sample: two public, one for customers, one restricted", [sum(1 for a in pages if a["audience"] == x) for x in ("public", "customers", "restricted")] == [2, 1, 1])
    qs = [q for q in built["rows"]["knowhow_question"] if not q.get("walk_step") and not q.get("same_as")]
    out = {k: sum(1 for q in qs if q["outcome"] in v) for k, v in {"answered": ("answered",), "late": ("late",), "missed": ("missed", "partly")}.items()}
    check("sample: 48 questions, 37 answered, 6 late, 5 missed", len(qs) == 48 and out == {"answered": 37, "late": 6, "missed": 5})
    ral = [q for q in built["rows"]["knowhow_question"] if q["id"] == smp["kid"]("sample", "question", "ral:0") or q.get("same_as") == smp["kid"]("sample", "question", "ral:0")]
    check("sample: custom RAL asked 4 times, with a draft", len(ral) == 4 and all(q.get("draft_article_id") for q in ral))
    check("sample: the eye-test question keeps no name", any(q["sensitive"] and q["asked_by_name"] is None for q in qs))
    check("sample: 3 drafts, 1 may-disagree, 1 proposed step", sum(1 for a in arts if a["state"] == "draft") == 3
          and [c_["kind"] for c_ in built["rows"]["knowhow_change"]] == ["add_to_step", "may_disagree"])
    ret = next(a for a in arts if a["title"] == "Issue a return")
    check("sample: Issue a return has 7 steps", len(ret["steps"]) == 7)
    check("sample: a walk at step 3 of 7, and 3 assignments on it", any(w["step"] == 3 and w["steps_total"] == 7 and w["state"] == "walking" for w in built["rows"]["knowhow_walk"])
          and sum(1 for g in built["rows"]["knowhow_assignment"] if g["article_id"] == ret["id"]) == 3)
    check("sample: only .example addresses", all(v.endswith(".example") for v in smp["CONTACTS"].values()))
    check("sample: Priya's topic is the loader's, for Today", next(t for t in built["rows"]["knowhow_topic"] if t["slug"] == "products")["owner_member_id"] == "u-me")
    ids = [r["id"] for rows in built["rows"].values() for r in rows]
    check("sample: every row id is unique", len(ids) == len(set(ids)))

    # Shared code, word for word.
    res = subprocess.run([sys.executable, str(HERE / "bin" / "common.py"), "--check"], capture_output=True, text=True)
    check("shared code is word for word in every function", res.returncode == 0)

    print(f"\n{len(FAILED)} failed" if FAILED else "\nall checks pass")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
