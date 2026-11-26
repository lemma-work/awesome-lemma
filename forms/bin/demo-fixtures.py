#!/usr/bin/env python3
"""Write the "Try it" demo's sample (.lemma/shots/fixtures/) from Forms' own
sample week, offline: the rows `forms_sample_data` loads into a Lemma (its
`build`), at 10:42 UTC on Tuesday 25 November, with Priya Raman
(`user-sample`) signed in. The sample's other members get made-up user ids
here so the demo can name them, re-route to them and say who hasn't opened
Forms. Nothing here talks to a Lemma. Python's standard library only.

    uv run --no-project python bin/demo-fixtures.py
"""

from __future__ import annotations

import json
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
FIX = HERE / ".lemma" / "shots" / "fixtures"
T0 = datetime(2026, 11, 25, 10, 42, tzinfo=timezone.utc)
ME = {"user_id": "user-sample", "name": "Priya Raman", "email": "priya@halvard.example"}

LOADERS = {
    "from forms_settings order by": "settings",
    "from form order by": "form",
    "from form_answer order by": "form_answer",
    "from forms_event order by": "forms_event",
    "from forms_rule order by": "forms_rule",
    "from away order by": "away",
    "from draft where source = 'mail'": "draft",
    "from mail_mailbox order by": "mail_mailbox",
}


def sample_module() -> dict:
    sdk = types.ModuleType("lemma_sdk")
    sdk.FunctionContext = object
    pyd = types.ModuleType("pydantic")
    pyd.BaseModel = object
    sys.modules.setdefault("lemma_sdk", sdk)
    sys.modules.setdefault("pydantic", pyd)
    scope: dict = {"__name__": "forms_sample_data"}
    exec(compile((HERE / "functions" / "forms_sample_data" / "code.py").read_text(), "sample", "exec"), scope)
    return scope


def main() -> int:
    mod = sample_module()
    built = mod["build"](T0, ME["user_id"], ME["name"])
    team = mod["TEAM"]
    ids = {name: ("user-sample" if key == "priya" else f"user-{key}") for key, name in team.items()}
    ids[ME["name"]] = "user-sample"

    def uid(name):
        return ids.get(name) if name else None

    forms = []
    for f in built["form"]:
        f = dict(f)
        f["held_by_user_id"] = f.get("held_by_user_id") or uid(f.pop("_held_name", None))
        f["default_owner_user_id"] = f.get("default_owner_user_id") or uid(f.pop("_default_name", None))
        f = {k: v for k, v in f.items() if not k.startswith("_")}
        f.setdefault("created_at", (T0 - timedelta(days=40)).isoformat())
        forms.append(f)
    answers = []
    for a in built["form_answer"]:
        a = dict(a)
        if not a.get("owner_user_id") and a.get("owner_name") in ids:
            a["owner_user_id"] = ids[a["owner_name"]]
        if a.get("replied_by") is None and a.get("first_reply_at"):
            a["replied_by"] = a.get("owner_user_id")
        a.setdefault("created_at", a.get("received_at"))
        if a.get("source_id") in ("sample-mara", "sample-ama"):
            a["taken_at"] = a["received_at"]
        answers.append(a)
    # Each door's last seven days and last answer, as forms_on_web keeps them.
    for f in forms:
        mine = [a for a in answers if a["form_id"] == f["id"]]
        days: dict = {}
        for a in mine:
            when = datetime.fromisoformat(a["received_at"])
            if T0 - when < timedelta(days=7):
                days[when.date().isoformat()] = days.get(when.date().isoformat(), 0) + 1
        f["week"] = [{"day": d, "n": n} for d, n in sorted(days.items())]
        f["last_answer_at"] = max((a["received_at"] for a in mine), default=None)
        if f["source"] == "plugin":  # Triage keeps its own count here
            f["week"] = [{"day": (T0 - timedelta(days=d)).date().isoformat(), "n": n} for d, n in ((0, 1), (1, 2), (3, 1), (5, 1))]
            f["last_answer_at"] = (T0 - timedelta(minutes=50)).isoformat()
    rules = []
    for r in built["forms_rule"]:
        r = dict(r)
        r["members"] = [ids[n] for n in r.pop("_members", []) if n in ids]
        r.setdefault("created_at", (T0 - timedelta(days=30)).isoformat())
        rules.append({k: v for k, v in r.items() if not k.startswith("_")})
    events = [dict(e, created_at=e["at"]) for e in built["forms_event"]]
    mara = next(a for a in answers if a["source_id"] == "sample-mara")
    box = {"id": "mailbox-priya", "provider": "gmail", "account_id": "gmail-priya", "email": "priya@halvard.example",
           "owner_name": ME["name"], "state": "live", "connected_at": "2026-09-01T09:00:00+00:00"}
    draft = {"id": mod["draft_id_for"](ME["user_id"], mara["id"]), "conversation_id": None, "source": "mail", "source_account": box["id"],
             "kind": "new", "to_handles": [mara["handle"]], "subject": "Re: Arc on DALI-2 and 2700K samples", "body": mod["MARA_DRAFT"],
             "original_body": mod["MARA_DRAFT"], "state": "proposed",
             "rationale": "Used the open deal (proposal stage), her drawings and your voice. Assumed the samples can ship this week.",
             "created_at": (T0 - timedelta(seconds=30)).isoformat(), "updated_at": (T0 - timedelta(seconds=30)).isoformat()}
    mara["draft_id"] = draft["id"]
    members = [{"user_id": ids[n], "name": n, "schedules": {} if k == "noor" else {"take": f"s-{k}", "let_go": f"s-{k}-2", "write": f"s-{k}-3"},
                "at": "2026-10-02T09:00:00+00:00"} for k, n in team.items()]
    settings = {
        "id": mod["SETTINGS_ID"], "steward_user_id": "user-ellis", "members": members,
        "plugins": {"triage": True, "deals": True, "leads": True, "people": True}, "goal_minutes": 60, "unsure_after_minutes": 60,
        "widget_id": "w-sample", "widget_key": "pk_7Hq2sample", "schedules": {"forms-web-contact": "s1", "forms-web-demo": "s2", "forms-web-careers": "s3"},
        "doors_wanted": ["website", "google", "meta", "plugin"], "setup_done_at": "2026-10-01T09:00:00+00:00",
        "quiet": True, "sample": False, "created_at": "2026-10-01T09:00:00+00:00",
    }
    away = [{"id": "away-1", "member_id": "user-tomas", "name": team["tomas"], "day": (T0 + timedelta(days=2)).date().isoformat(), "part": "full",
             "created_at": T0.isoformat()},
            {"id": "away-2", "member_id": "user-noor", "name": team["noor"], "day": T0.date().isoformat(), "part": "half", "created_at": T0.isoformat()}]
    rows = {"settings": [settings], "form": forms, "form_answer": answers, "forms_event": events, "forms_rule": rules, "away": away,
            "draft": [draft], "mail_mailbox": [box]}
    deal = dict(built["deal"][0])
    deal.update({"owner_name": ME["name"]})
    mara_person = {"id": "person-mara", "name": mara["name"], "org": "OKL Architects", "title": "Principal", "conversation_count": 3,
                   "last_inbound_at": mara["received_at"]}
    ama = next(a for a in answers if a["source_id"] == "sample-ama")
    ama_person = {"id": "person-ama", "name": ama["name"], "org": "Stoneyard", "title": None, "conversation_count": 1, "last_inbound_at": ama["received_at"]}

    def items(r):
        return {"items": r, "total": len(r)}

    entries = [
        {"match": f"join person p on p.id = h.person_id where lower(h.handle) = '{mara['handle']}'", "response": items([mara_person])},
        {"match": f"join person p on p.id = h.person_id where lower(h.handle) = '{ama['handle']}'", "response": items([ama_person])},
        {"match": "from person_handle h join person p", "response": items([])},
        {"match": f"on h.person_id = l.id where lower(h.handle) = '{mara['handle']}'", "response": items([{
            "summary": "A 24-person practice doing public libraries and schools. Mara is a named principal on two tenders this year. Worth a same-day reply.",
            "fit_why": "Specifies architectural lighting for public buildings", "role": "Principal", "state": "found"}])},
        {"match": "from leads_person l", "response": items([])},
        {"match": "lower(company_domain) = 'okl-architects.example'", "response": items([{k: deal.get(k) for k in
            ("id", "name", "stage", "amount", "currency", "owner_user_id", "owner_name")}])},
        {"match": "from deal where status = 'open'", "response": items([])},
    ]
    entries += [{"match": match, "response": items(rows[key])} for match, key in LOADERS.items()]
    entries.append({"match": "from forms_sample_row", "response": items([{"n": 0}])})
    (FIX / "pods" / "pod" / "datastore").mkdir(parents=True, exist_ok=True)
    (FIX / "pods" / "pod" / "datastore" / "query.json").write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n")
    (FIX / "pods" / "pod.json").write_text(json.dumps({"id": "pod", "name": "Halvard Lighting", "organization_id": "org"}) + "\n")
    people = [{"user_id": ids[n], "name": n, "email": f"{k}@halvard.example"} for k, n in team.items()]
    (FIX / "pods" / "pod" / "members.json").write_text(json.dumps({"items": [{
        "pod_member_id": f"member-{p['user_id']}", "user_id": p["user_id"], "user_name": p["name"], "user_email": p["email"],
        "email": p["email"], "roles": ["POD_ADMIN" if p["user_id"] in ("user-sample", "user-ellis") else "POD_MEMBER"]} for p in people]}, ensure_ascii=False) + "\n")
    print(f"wrote {FIX.relative_to(HERE)}: " + ", ".join(f"{len(v)} {k}" for k, v in rows.items()) + f"; mara {mara['id']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
