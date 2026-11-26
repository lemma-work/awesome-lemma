#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from Know-how's
own sample Wednesday, offline: the rows and pages `knowhow_sample_data`
loads into a Lemma (its `build`), at 13:30 UTC on the demo's day, with Priya
Raman (`user-sample`) signed in as the owner of Products and lead times.
Nothing here talks to a Lemma. Python's standard library only.

    uv run --no-project python bin/demo-fixtures.py
"""

from __future__ import annotations

import json
import shutil
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
T0 = datetime(2026, 11, 25, 13, 30, tzinfo=timezone.utc)
ME = {"user_id": "user-sample", "name": "Priya Raman", "email": "priya@fernlow.example"}
PEOPLE = [ME] + [{"user_id": f"user-{n.split()[0].lower()}", "name": n, "email": f"{n.split()[0].lower()}@fernlow.example"}
                 for n in ("Ines Moreau", "Tomás Ortega", "Hannah Webb", "Dev Chauhan", "Sam Okafor", "Marco Bellini", "Joy Lam", "Kofi Mensah", "Aisha Khan")]
ROLES = {"Hannah Webb": ["HR"], "Joy Lam": ["Customer service"], "Aisha Khan": ["Customer service"], "Kofi Mensah": ["Warehouse"]}

LOADERS = {
    "from knowhow_settings": "settings",
    "from knowhow_topic order by": "knowhow_topic",
    "from knowhow_article order by": "knowhow_article",
    "from knowhow_question order by": "knowhow_question",
    "from knowhow_change order by": "knowhow_change",
    "from knowhow_source order by": "knowhow_source",
    "from knowhow_walk order by": "knowhow_walk",
    "from knowhow_assignment order by": "knowhow_assignment",
    "from knowhow_event order by": "knowhow_event",
    "from knowhow_person": "knowhow_person",
}


def sample_module() -> dict:
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "knowhow_sample_data"}
    exec(compile((HERE / "functions" / "knowhow_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    mod = sample_module()
    built = mod["build"](T0, ME["user_id"], ME["name"])
    rows = dict(built["rows"])
    for table, list_ in rows.items():
        for r in list_:
            r.setdefault("created_at", r.get("asked_at") or r.get("at") or r.get("started_at") or r.get("assigned_at") or r.get("checked_at") or T0.isoformat())
            r.setdefault("updated_at", r["created_at"])
    for a in rows["knowhow_article"]:
        a.pop("checked_text", None)
    rows["knowhow_assignment"] = [g for g in rows["knowhow_assignment"] if g.get("member_id") != ME["user_id"]] + [
        {**g, "member_id": ME["user_id"]} for g in rows["knowhow_assignment"] if g.get("member_id") == ME["user_id"]]
    settings = {
        "id": mod["SETTINGS_ID"], "places": {"teams": True, "slack_channels": [{"id": "C0INSTALL", "name": "installers"}], "mailbox": True, "web_chat": True},
        "audiences": {"customers": True, "public": True}, "approver_rule": "owner", "default_check_days": 90, "customer_lead_days": 14,
        "sweep_member_id": ME["user_id"], "schedules": {"knowhow-sweep": "demo", "knowhow-mine-usersamp": "demo"},
        "made": {"finished": True, "article_public": True, "contact_functions": ["knowhow_answer_for_contact", "knowhow_missing"], "restricted:people": "HR"},
        "proposals": {"topics": [
            {"name": "Products and lead times", "why": "Lead times, lengths, finishes, from the price list and the website", "owner_hint": "Priya Raman", "sensitive": False},
            {"name": "Drivers and wiring", "why": "Choosing a driver, dimming, wiring, from the installer guides", "owner_hint": "Ines Moreau", "sensitive": False},
            {"name": "Orders and returns", "why": "Returns, delivery, changing an order, from the customer service handbook", "owner_hint": "Tomás Ortega", "sensitive": False},
            {"name": "Leave and pay", "why": "Holiday, payday, from the staff handbook", "owner_hint": "Hannah Webb", "sensitive": True},
            {"name": "Laptops and access", "why": "New laptops, VPN, laptop use, from the IT notes", "owner_hint": "Dev Chauhan", "sensitive": False},
            {"name": "Showroom and samples", "why": "Booking the showroom, sample boxes, from the website", "owner_hint": "Sam Okafor", "sensitive": False}],
            "drafts": [{"article_id": f"d{i}", "topic": t, "title": f"Draft {i}"} for i, t in enumerate(
                ["Products and lead times"] * 4 + ["Drivers and wiring"] * 4 + ["Orders and returns"] * 4 + ["Leave and pay"] * 2 + ["Laptops and access"] * 3 + ["Showroom and samples"] * 3)]},
        "setup_run_id": "demo", "setup_done_at": "2026-09-01T09:00:00+00:00", "timezone": "Europe/London",
        "quiet": True, "sample": False, "checked_at": T0.replace(hour=0, minute=15).isoformat(),
        "check_note": "3 past their check date, 0 left the customer answers, 1 may disagree, 0 sheet pages made again.",
        "created_at": "2026-09-01T09:00:00+00:00",
    }
    rows["settings"] = [settings]
    rows["knowhow_person"] = [{"id": "person-sample", "member_id": ME["user_id"], "name": ME["name"], "ask_by": "teams", "check_rhythm": "weekly",
                               "check_day": 0, "me_done_at": "2026-09-01T09:10:00+00:00", "schedule_name": "knowhow-mine-usersamp"}]
    entries = [{"match": match, "response": {"items": rows[key], "total": len(rows[key])}} for match, key in LOADERS.items()]
    entries.append({"match": "from knowhow_sample_row", "response": {"items": [{"n": 0}], "total": 1}})
    if FIX.exists():
        shutil.rmtree(FIX)
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Wren", "organization_id": "org"}) + "\n")
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": f"member-{p['user_id']}", "user_id": p["user_id"], "user_name": p["name"], "user_email": p["email"], "email": p["email"],
        "roles": (["POD_ADMIN"] if p["user_id"] == ME["user_id"] else ["POD_MEMBER"]) + ROLES.get(p["name"], [])} for p in PEOPLE]}, ensure_ascii=False) + "\n")
    for path, text in built["files"].items():
        target = FIX / "files" / path.lstrip("/")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k}" for k, v in rows.items()) + f", {len(built['files'])} pages")
    return 0


if __name__ == "__main__":
    sys.exit(main())
