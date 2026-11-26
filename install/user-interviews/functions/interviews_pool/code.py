#input_type_name: InterviewsPoolInput
#output_type_name: InterviewsPoolResult
#function_name: interviews_pool

"""Build or refresh one study's people: everyone the team already knows who
fits the study's filters (`fit_read`), ranked, each with why they fit and the
best thing they said before.

Where people come from, all by handle:
- `feedback`: what they said, and about which feature;
- `ask`: work they asked for (a feature's own, or its work);
- `deal`: the people on a deal, with its status and stage;
- the member's own people (`person`, `person_handle`, People map's
  `people_person` where they are a customer or partner): run as the member,
  so only theirs;
- `interviews_pasted`: a list someone pasted for this study or for any.

It never reads mail or meeting text: only the shared tables and the member's
own people rows.

Ranked by: said something about the study's features, then a deal won or
open, then how recently. The contact rules (every study's rows for the
handle) mark a person resting, with the rule in words; they stay in the list,
under Resting. Rows already past `fits` are kept as they are; a `fits` row
that no longer fits leaves, unless it came from another member's people.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# interviews:common
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
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


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
    text = str(text or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2014", "-").replace("\u2013", "-")
    return " ".join(text.split()).lower().strip(" .\"'")


TIME_LINE = _re.compile(r"^\s*\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(?:([^:\n]{1,60}):\s*)?(.*)$")


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

DEAL_RANK = {"won": 2, "open": 1}
PEOPLE_KINDS = ("customer", "partner")
MOST = 400


class InterviewsPoolInput(BaseModel):
    study_id: str


class InterviewsPoolResult(BaseModel):
    people: int = 0
    resting: int = 0
    counts: dict = {}
    message: str


def _email(value) -> str | None:
    text = str(value or "").strip().lower()
    return text if "@" in text and " " not in text and len(text) <= 320 else None


def _deal_people(value) -> list:
    out = []
    for p in jl(value, []) or []:
        if isinstance(p, dict) and _email(p.get("handle")):
            out.append((_email(p["handle"]), p.get("name")))
        elif isinstance(p, str) and _email(p):
            out.append((_email(p), None))
    return out


def _safe(pod, sql: str) -> list:
    try:
        return q_all(pod, sql)
    except Exception:  # noqa: BLE001 - a plugin that isn't set up for this person
        return []


def _matches(c: dict, f: dict, names: dict) -> tuple:
    """(passes, unchecked): one filter against one candidate."""
    field, values = f.get("field"), [str(v).strip().lower() for v in (f.get("values") or []) if str(v).strip()]
    if not values:
        return True, False
    if field == "title_has":
        title = str(c.get("title") or "").lower()
        if not title:
            return True, True
        return any(_re.search(r"\b" + _re.escape(v), title) for v in values), False
    if field == "deal_status":
        return (c.get("deal_status") or "none") in values, False
    if field == "deal_stage":
        return str(c.get("deal_stage") or "").lower() in values, False
    if field == "said_about":
        said = {str(x).lower() for x in c["features"]}
        said |= {names.get(str(x).lower(), "").lower() for x in c["features"]}
        return bool(said & set(values)), False
    if field == "said_kind":
        return bool({k.lower() for k in c["kinds"]} & set(values)), False
    if field == "importance":
        return bool({k.lower() for k in c["importance"]} & set(values)), False
    if field == "company":
        name = str(c.get("company_name") or "").lower()
        return any(v in name for v in values) if name else False, False
    if field == "source":
        return bool({k for k, v in c["sources"].items() if v} & set(values)), False
    if field == "people_kind":
        return str(c.get("people_kind") or "").lower() in values, False
    if field == "pasted":
        column = str(f.get("column") or "").strip().lower()
        got = {str(k).strip().lower(): str(v).strip().lower() for k, v in (c.get("fields") or {}).items()}
        if column not in got:
            return False, False
        return any(v == got[column] or v in got[column] for v in values), False
    return True, False


def interviews_pool(ctx: FunctionContext, data: InterviewsPoolInput) -> InterviewsPoolResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    s = settings_of(pod)
    study = (q(pod, f"SELECT * FROM interviews_study WHERE id = {lit(data.study_id)}") or [None])[0]
    if not study:
        raise ValueError("No such study.")
    want_features = {str(x) for x in (jl(study.get("feature_ids"), []) or [])}
    read = jl(study.get("fit_read"), {}) or {}
    filters = [f for f in (read.get("filters") or []) if isinstance(f, dict)]
    features = {r["id"]: r for r in q_all(pod, "SELECT id, name FROM feature ORDER BY id")}
    names = {str(k).lower(): str(v.get("name") or "") for k, v in features.items()}
    tz = "UTC"
    own_domains = set()
    for m in _safe(pod, "SELECT email FROM mail_mailbox ORDER BY id"):
        dom = str(m.get("email") or "").split("@")[-1].lower()
        if dom and dom not in FREEMAIL:
            own_domains.add(dom)

    cands: dict = {}

    def cand(handle, **facts) -> dict:
        c = cands.get(handle)
        if c is None:
            c = cands[handle] = {"handle": handle, "name": None, "title": None, "company_id": None, "company_name": None,
                                 "sources": {"deal": [], "feedback": [], "ask": [], "mine": [], "pasted": []},
                                 "features": set(), "kinds": set(), "importance": set(), "said": 0, "said_about": 0,
                                 "last": None, "quote": None, "quote_from": None, "quote_score": -1,
                                 "deal_status": None, "deal_stage": None, "people_kind": None, "fields": {}}
        for k, v in facts.items():
            if v and not c.get(k):
                c[k] = v
        return c

    def seen(c, when):
        t = stamp(when)
        if t and (c["last"] is None or t > c["last"]):
            c["last"] = t

    # What they said.
    for f in _safe(pod, "SELECT id, quote, feature_id, kind, importance, handle, handle_kind, name, company_id, company_name, "
                        "source, said_at FROM feedback WHERE handle IS NOT NULL AND state <> 'set_aside' ORDER BY said_at DESC"):
        h = _email(f.get("handle")) if (f.get("handle_kind") or "email") == "email" else None
        if not h:
            continue
        c = cand(h, name=f.get("name"), company_id=f.get("company_id"), company_name=f.get("company_name"))
        c["sources"]["feedback"].append(f["id"])
        c["said"] += 1
        if f.get("feature_id"):
            c["features"].add(str(f["feature_id"]))
        c["kinds"].add(str(f.get("kind") or "other"))
        c["importance"].add(str(f.get("importance") or "unknown"))
        about = str(f.get("feature_id") or "") in want_features
        c["said_about"] += 1 if about else 0
        seen(c, f.get("said_at"))
        score = (4 if about else 0) + {"blocker": 3, "important": 2, "nice": 1}.get(f.get("importance"), 0)
        if f.get("quote") and score > c["quote_score"]:
            c["quote"], c["quote_score"] = clip(f["quote"], 600), score
            c["quote_from"] = clip(f"{f.get('source') or 'said'}, {day_said(f.get('said_at'), tz)}", 200)
    # Work they asked for.
    for a in _safe(pod, "SELECT id, work_source, work_id, handle, handle_kind, name, company_id, company_name, asked_at, state "
                        "FROM ask WHERE state <> 'dropped' ORDER BY asked_at DESC"):
        h = _email(a.get("handle")) if a.get("handle_kind") == "email" else None
        if not h:
            continue
        c = cand(h, name=a.get("name"), company_id=a.get("company_id"), company_name=a.get("company_name"))
        c["sources"]["ask"].append(a["id"])
        if a.get("work_source") == "feature" and a.get("work_id"):
            c["features"].add(str(a["work_id"]))
            if str(a["work_id"]) in want_features:
                c["said_about"] += 1
        c["kinds"].add("request")
        seen(c, a.get("asked_at"))
    # Deals.
    for d in _safe(pod, "SELECT id, name, company_id, company_name, people, stage, status, last_activity_at, updated_at "
                        "FROM deal ORDER BY updated_at DESC"):
        for h, name in _deal_people(d.get("people")):
            c = cand(h, name=name, company_id=d.get("company_id"), company_name=d.get("company_name"))
            c["sources"]["deal"].append(d["id"])
            if DEAL_RANK.get(d.get("status"), -1) > DEAL_RANK.get(c.get("deal_status") or "", -1) or not c.get("deal_status"):
                c["deal_status"], c["deal_stage"] = d.get("status"), d.get("stage")
            seen(c, d.get("last_activity_at") or d.get("updated_at"))
    # The member's own people.
    mine = _safe(pod, "SELECT p.id, p.name, p.org, p.title, h.handle, pp.kind, pp.company_id, pp.last_contact_at "
                      "FROM person p JOIN person_handle h ON h.person_id = p.id "
                      "LEFT JOIN people_person pp ON pp.id = p.id "
                      f"WHERE h.kind = 'email' AND (pp.kind IN ({lits(PEOPLE_KINDS)}) OR pp.id IS NULL) "
                      "AND (pp.in_scope IS NULL OR pp.in_scope = TRUE) ORDER BY p.id")
    for m in mine:
        h = _email(m.get("handle"))
        if not h or (m.get("kind") is None and h not in cands):
            continue  # someone People map hasn't sorted counts only when the team knows them otherwise
        c = cand(h, name=m.get("name"), title=m.get("title"), company_id=m.get("company_id"), company_name=m.get("org"),
                 people_kind=m.get("kind"))
        c["sources"]["mine"].append(me)
        seen(c, m.get("last_contact_at"))
    # Pasted lists.
    for r in _safe(pod, "SELECT id, study_id, handle, name, company_name, title, fields FROM interviews_pasted "
                        f"WHERE study_id IS NULL OR study_id = {lit(study['id'])} ORDER BY id"):
        h = _email(r.get("handle"))
        if not h:
            continue
        c = cand(h, name=r.get("name"), title=r.get("title"), company_name=r.get("company_name"))
        c["sources"]["pasted"].append(r["id"])
        c["fields"].update(jl(r.get("fields"), {}) or {})

    # Filters, ranking, chips.
    now = now_utc()
    chosen = {}
    for h, c in cands.items():
        if h.split("@")[-1] in own_domains:
            continue
        ok, unchecked = True, []
        for f in filters:
            passes, unknown = _matches(c, f, names)
            if not passes:
                ok = False
                break
            if unknown:
                unchecked.append(f.get("field"))
        if not ok:
            continue
        why = []
        if c["deal_status"] in ("won", "open"):
            why.append(f"Deal {c['deal_status']}" + (f" · {str(c['deal_stage']).lower()}" if c["deal_status"] == "open" and c["deal_stage"] else ""))
        if c["said"]:
            why.append(f"Said {plural(c['said'], 'thing')}")
        elif c["sources"]["ask"]:
            why.append(f"Asked for {plural(len(c['sources']['ask']), 'thing')}")
        if c["sources"]["mine"]:
            why.append("Your contact" if me in c["sources"]["mine"] else "A colleague's contact")
        if c["sources"]["pasted"]:
            why.append("Pasted list")
            plan = next((v for k, v in c["fields"].items() if str(k).strip().lower() == "plan" and v), None)
            if plan:
                why.append(f"Plan: {plan}")
        if "title_has" in unchecked:
            why.append("Title not known")
        recency = 0.0
        if c["last"]:
            recency = max(0.0, 99.0 - min(99.0, (now - c["last"]).days / 3.0))
        rank = 1000.0 * min(c["said_about"], 9) + 100.0 * DEAL_RANK.get(c["deal_status"] or "", 0) + recency \
            - (50.0 if unchecked else 0.0)
        chosen[h] = (c, why[:4], rank)
    ranked = sorted(chosen.values(), key=lambda t: -t[2])[:MOST]

    existing = {r["handle"]: r for r in q_all(pod, f"SELECT * FROM interviews_person WHERE study_id = {lit(study['id'])} ORDER BY id")}
    writes = []
    for c, why, rank in ranked:
        h = c["handle"]
        old = existing.get(h) or {}
        srcs = {k: sorted(set(map(str, v)))[:20] for k, v in c["sources"].items()}
        if old:
            old_mine = (jl(old.get("sources"), {}) or {}).get("mine") or []
            srcs["mine"] = sorted(set(srcs["mine"]) | {m for m in old_mine if m != me})
        row = {"id": old.get("id") or person_row_id(study["id"], "email", h), "study_id": study["id"],
               "handle_kind": "email", "handle": h, "name": c["name"] or old.get("name"), "title": c["title"] or old.get("title"),
               "company_id": c["company_id"], "company_name": c["company_name"], "sources": srcs, "why": why,
               "quote": c["quote"], "quote_from": c["quote_from"], "deal_status": c["deal_status"], "deal_stage": c["deal_stage"],
               "rank": round(rank, 2), "sample": bool(study.get("sample"))}
        if not old:
            row["stage"] = "fits"
        writes.append(row)
    keep = {w["handle"] for w in writes}
    gone = [r["id"] for h, r in existing.items() if h not in keep and r.get("stage") == "fits"
            and not [m for m in ((jl(r.get("sources"), {}) or {}).get("mine") or []) if m != me]]
    for i in range(0, len(writes), 100):
        pod.records.bulk_create("interviews_person", writes[i:i + 100], upsert=True)
    for i in range(0, len(gone), 100):
        pod.records.bulk_delete("interviews_person", gone[i:i + 100])
    rest_refresh(pod, s, keep)
    after = q_all(pod, f"SELECT id, stage, rests_until FROM interviews_person WHERE study_id = {lit(study['id'])} ORDER BY id")
    resting = sum(1 for r in after if is_resting(r))
    counts = {k: sum(1 for c, _w, _r in ranked if c["sources"][k]) for k in ("deal", "feedback", "ask", "mine", "pasted")}
    counts.update(total=len(after), resting=resting)
    pod.records.update("interviews_study", study["id"], {"pool_at": now_iso(), "pool_counts": counts})
    return InterviewsPoolResult(people=len(after), resting=resting, counts=counts,
                                message=f"{plural(len(after), 'person', 'people')} fit, {resting} resting under the contact rules.")
