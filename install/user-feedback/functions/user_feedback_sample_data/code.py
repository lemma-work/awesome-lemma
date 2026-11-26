#input_type_name: UserFeedbackSampleDataInput
#output_type_name: UserFeedbackSampleDataResult
#function_name: user_feedback_sample_data

"""A sample to look around in, and taking it away again.

`load` writes a made-up B2B reporting product (Ledgerline) and two made-up
rivals (Tallyfold, Gridwise), the product's features by area, eight weeks of
what people at sixteen made-up companies said about them (by role, at
`.example` addresses) and what was said in public, the companies and their
deals, and four sentences from the person's own mail and meetings that only
they can see. Dates are around today. Every row it makes in a shared table is
noted in `user_feedback_sample_row`; the person's own heard rows carry
`sample`.

`clear` removes only those rows (and the asks kept from them), and closes
the sample's items in the person's Today. The team's own rows stay.

`build()` is pure (no Lemma): bin/demo-fixtures.py makes the "Try it" demo
from the same rows.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# user-feedback:common
# Shared by every User feedback function, word for word: bin/common.py copies
# it in from bin/blocks/common.py. Edit it there, never here.
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

UF_NS = _uuid.UUID("44fc201d-eaa8-4f33-8a17-e5100410dbec")
# The contract's namespaces (_contract/tables/feedback.json, ask.json, company.json).
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
ASK_NS = _uuid.UUID("9972cf8e-4f42-4b98-86fc-fa5697c1f089")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
SETTINGS_ID = str(_uuid.uuid5(UF_NS, "settings"))
PLUGIN = "user-feedback"
APP = "feedback"
KINDS = ("request", "problem", "praise", "question", "comparison", "other")
SENTIMENTS = ("positive", "negative", "mixed", "neutral")
IMPORTANCE = ("unknown", "nice", "important", "blocker")
PUBLIC_SOURCES = ("hn", "reddit", "x", "youtube", "tiktok", "linkedin", "review", "web")


def rid(*parts) -> str:
    """A stable id of User feedback's own from its parts."""
    return str(_uuid.uuid5(UF_NS, ":".join(str(p) for p in parts)))


def member_row_id(user_id) -> str:
    return rid("member", user_id)


def quote_key(quote: str) -> str:
    """The contract's quote key: sha1 of the quote lowercased, whitespace collapsed, first 16 hex."""
    flat = _re.sub(r"\s+", " ", str(quote or "").strip().lower())
    return _hashlib.sha1(flat.encode("utf-8")).hexdigest()[:16]


def feedback_id(source: str, source_id: str, quote: str) -> str:
    """The contract's id for a feedback row (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


def ask_id(handle_kind, handle, source, source_id, work_source, work_id) -> str:
    """The contract's id for an ask (_contract/tables/ask.json)."""
    return str(_uuid.uuid5(ASK_NS, f"{handle_kind}:{handle}|{source}:{source_id}|{work_source}:{work_id}"))


def company_id_for(domain: str) -> str:
    return str(_uuid.uuid5(COMPANY_NS, "company:" + domain.lower()))


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


def jl(value, default=None):
    """A JSON column's value, whether it came back parsed or as text."""
    if value is None or value == "":
        return default
    if isinstance(value, str):
        try:
            return _json.loads(value)
        except ValueError:
            return default
    return value


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def parse_dt(value):
    if not value:
        return None
    try:
        out = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return out if out.tzinfo else out.replace(tzinfo=_tz.utc)


def clip(text, n: int):
    if text is None:
        return None
    text = str(text)
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def bulk_upsert(pod, table: str, items: list) -> None:
    for start in range(0, len(items), 100):
        pod.records.bulk_create(table, items[start : start + 100], upsert=True)


def bulk_update(pod, table: str, items: list) -> None:
    for start in range(0, len(items), 100):
        pod.records.bulk_update(table, items[start : start + 100])


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM user_feedback_settings WHERE id = {lit(SETTINGS_ID)}")
    s = found[0] if found else {}
    for key in ("filers", "hn_keywords", "brightdata_sources", "schedules", "duplicates", "kept_apart", "brightdata_accounts"):
        s[key] = jl(s.get(key), {} if key in ("schedules", "brightdata_accounts") else [])
    return s


def save_settings(pod, patch: dict) -> None:
    """Change the settings row's given columns only (made on first save)."""
    patch = {k: v for k, v in patch.items() if k != "id"}
    if q(pod, f"SELECT id FROM user_feedback_settings WHERE id = {lit(SETTINGS_ID)}"):
        if patch:
            pod.records.update("user_feedback_settings", SETTINGS_ID, patch)
    else:
        pod.records.bulk_create("user_feedback_settings", [dict(patch, id=SETTINGS_ID)], upsert=True)


def products_of(pod, active_only: bool = False) -> list:
    out = []
    for p in q(pod, "SELECT id, name, role, company_id, url, aliases, keywords, active FROM product ORDER BY name LIMIT 500"):
        p["aliases"] = [str(a) for a in (jl(p.get("aliases"), []) or []) if str(a).strip()]
        p["keywords"] = [str(k) for k in (jl(p.get("keywords"), []) or []) if str(k).strip()]
        if active_only and p.get("active") is False:
            continue
        out.append(p)
    return out


def features_of(pod, states=("active",)) -> list:
    out = []
    for f in q(pod, "SELECT id, product_id, name, description, parent_id, aliases, state, stage, work_source, work_id, "
                    f"work_url, merged_into FROM feature WHERE state IN ({lits(states)}) ORDER BY name LIMIT 2000"):
        f["aliases"] = [str(a) for a in (jl(f.get("aliases"), []) or []) if str(a).strip()]
        out.append(f)
    return out


# --- the words a quote shares with a feature ------------------------------------

_STOP = set("the a an and or of to in on for with without from by at is are be it its this that these those our your "
            "their we you they my me i not no can could would should will just also into out up as".split())


def _stem(word: str) -> str:
    for end in ("ing", "ed", "es", "s"):
        if len(word) > len(end) + 2 and word.endswith(end):
            return word[: -len(end)]
    return word


def _tokens(text: str) -> list:
    return [w for w in _re.findall(r"[a-z0-9]+", str(text or "").lower()) if w not in _STOP]


def matched_words(quote: str, feature: dict) -> list:
    """The feature's name or other names the quote says, whole ("CSV export"),
    else the words of them it says ("export"). Empty when none."""
    said = {_stem(w) for w in _tokens(quote)}
    whole, part = [], []
    for term in [feature.get("name") or "", *(feature.get("aliases") or [])]:
        raws = [w for w in _tokens(term) if len(w) >= 2]
        if not raws:
            continue
        hits = [w for w in raws if _stem(w) in said]
        if len(hits) == len(raws):
            whole.append(term)
            continue
        for raw in hits:
            if len(raw) >= 3 and raw not in part:
                part.append(raw)
    return whole[:2] if whole else part[:3]


def shortlist(features: list, quote: str, limit: int = 63) -> list:
    """At most `limit` of the team's features to choose from: all of them when
    they fit; past that, those whose words the quote says, then their parents,
    then every parent, then the rest by name (a choice holds 64 options)."""
    feats = [f for f in features if f.get("state", "active") == "active"]
    by_id = {f["id"]: f for f in feats}
    parents = [f for f in feats if not f.get("parent_id")]
    if len(feats) <= limit:
        return sorted(feats, key=lambda f: (0 if not f.get("parent_id") else 1, f["name"].lower()))
    scored = sorted(feats, key=lambda f: -len(matched_words(quote, f)))
    out, seen = [], set()

    def add(f):
        if f and f["id"] not in seen and len(out) < limit:
            seen.add(f["id"])
            out.append(f)

    for f in scored:
        if matched_words(quote, f):
            add(by_id.get(f.get("parent_id")))
            add(f)
    for f in parents:
        add(f)
    for f in sorted(feats, key=lambda f: f["name"].lower()):
        add(f)
    return out


def options_for(pick, quote: str, short: list) -> tuple:
    """Up to three features to offer, the pick first, then the closest by words,
    then the pick's siblings; and the words matching each."""
    by_id = {f["id"]: f for f in short}
    out = [pick] if pick in by_id else []
    ranked = sorted(short, key=lambda f: -len(matched_words(quote, f)))
    for f in ranked:
        if len(out) >= 3:
            break
        if f["id"] not in out and matched_words(quote, f):
            out.append(f["id"])
    if pick in by_id:
        parent = by_id[pick].get("parent_id")
        for f in short:
            if len(out) >= 3:
                break
            if f["id"] not in out and parent and (f.get("parent_id") == parent or f["id"] == parent):
                out.append(f["id"])
    matched = {fid: matched_words(quote, by_id[fid]) for fid in out}
    return out, {k: v for k, v in matched.items() if v}


# --- Decisions -------------------------------------------------------------------

def decide(pod, instruction: str, schema: dict, evidence: str, examples=None, tries: int = 4) -> tuple:
    """One Decisions call, a 429 waited out. (answers, calls); answers {} when it failed."""
    calls = 0
    for attempt in range(tries):
        try:
            calls += 1
            response = pod.decisions.make(instruction=instruction[:7900], evidence=evidence[:60000], schema=schema,
                                          examples=examples or None, priority="background")
            payload = response.to_dict() if hasattr(response, "to_dict") else response
            return (payload or {}).get("answers") or {}, calls
        except Exception as exc:  # noqa: BLE001 — classified below
            text = str(exc)
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status == 429 or "429" in text[:40] or "RATE_LIMITED" in text:
                _time.sleep(float(getattr(exc, "retry_after", None) or 6))
                continue
            if status in (502, 503, 504) or "UNAVAILABLE" in text:
                _time.sleep(1.5 * (attempt + 1))
                continue
            raise
    return {}, calls


def answer(answers: dict, key: str) -> tuple:
    item = answers.get(key) or {}
    if hasattr(item, "to_dict"):
        item = item.to_dict()
    if not isinstance(item, dict):
        return item, None
    return item.get("value"), item.get("confidence")


# --- asks: a kept request from someone with a handle -------------------------------

def work_of(feature: dict) -> tuple:
    """The work an ask about this feature points at: its linked work, else the feature."""
    if feature.get("work_source") and feature.get("work_id"):
        return feature["work_source"], feature["work_id"], feature.get("work_url")
    return "feature", feature["id"], None


def write_ask(pod, fb: dict, feature) -> str | None:
    """The `ask` a kept request from someone with a handle gets, against the
    feature's work (else the feature). Its id is the contract's, from the values
    it is first written with, so writing again changes nothing."""
    if not feature or fb.get("kind") != "request" or not fb.get("handle") or not fb.get("handle_kind"):
        return None
    if fb.get("state") != "processed":
        return None
    work_source, work_id, work_url = work_of(feature)
    source, source_id = fb.get("source") or "note", fb.get("source_id") or fb["id"]
    aid = ask_id(fb["handle_kind"], fb["handle"], source, source_id, work_source, work_id)
    existing = q(pod, f"SELECT id FROM ask WHERE id = {lit(aid)}")
    # An ask already written for this quote against the feature, before work was linked.
    if not existing:
        older = q(pod, f"SELECT id FROM ask WHERE handle_kind = {lit(fb['handle_kind'])} AND handle = {lit(fb['handle'])} "
                       f"AND source = {lit(source)} AND source_id = {lit(source_id)} AND work_source = 'feature' "
                       f"AND work_id = {lit(feature['id'])} LIMIT 1")
        if older:
            pod.records.update("ask", older[0]["id"], {"work_source": work_source, "work_id": work_id, "work_url": work_url,
                                                      "work_title": clip(feature.get("name"), 300)})
            return older[0]["id"]
        pod.records.bulk_create("ask", [{
            "id": aid, "work_source": work_source, "work_id": work_id, "work_url": work_url,
            "work_title": clip(feature.get("name"), 300),
            "handle_kind": fb["handle_kind"], "handle": fb["handle"], "name": fb.get("name"),
            "company_id": fb.get("company_id"), "company_name": fb.get("company_name"),
            "source": source, "source_account": fb.get("source_account"), "source_id": source_id,
            "source_url": clip(fb.get("source_url"), 500), "heard_by": fb.get("heard_by"),
            "conversation_id": fb.get("conversation_id"), "asked_at": fb.get("said_at") or now_iso(),
            "state": "open", "plugin": PLUGIN,
        }], upsert=True)
    return aid

# --- sharing: a member's heard sentences to the team ------------------------------

def share_rows(pod, heard: list, me: str) -> int:
    """Heard rows to the team's `feedback`: the sentence and who said it, never the thread."""
    if not heard:
        return 0
    now = now_iso()
    fb, filing, back = [], [], []
    for h in heard:
        fb.append({
            "id": h["id"], "quote": h["quote"], "point": h.get("point"), "product_id": h.get("product_id"),
            "feature_id": h.get("feature_id"), "filed_by": "lemma" if h.get("feature_id") else None,
            "kind": h.get("kind") or "other", "compared_with": jl(h.get("compared_with")),
            "sentiment": h.get("sentiment"), "importance": h.get("importance") or "unknown",
            "handle_kind": h.get("handle_kind"), "handle": h.get("handle"), "name": h.get("name"),
            "company_id": h.get("company_id"), "company_name": h.get("company_name"),
            "source": h["source"], "source_account": h.get("source_account"), "source_id": h["source_id"],
            "at_seconds": h.get("at_seconds"), "heard_by": me, "conversation_id": h.get("conversation_id"),
            "is_public": False, "said_at": h["said_at"], "state": "new", "plugin": PLUGIN,
        })
        filing.append({"id": h["id"], "options": jl(h.get("options"), []), "confidence": h.get("confidence"),
                       "matched": jl(h.get("matched"), {}), "picked": h.get("feature_id"), "calls": 0, "filed_at": now,
                       "sample": bool(h.get("sample"))})
        back.append({"id": h["id"], "share_state": "shared", "feedback_id": h["id"], "shared_at": now})
    bulk_upsert(pod, "user_feedback_filing", filing)
    bulk_upsert(pod, "feedback", fb)
    bulk_update(pod, "user_feedback_heard", back)
    return len(fb)


def share_item(pod, me: str) -> None:
    """This member's "N quotes from your mail to share", or resolve it. Only in a
    function that embeds the needs-you snippet, running as the member."""
    waiting = q(pod, "SELECT id, quote, name, company_name, said_at FROM user_feedback_heard "
                     "WHERE share_state = 'unshared' ORDER BY said_at DESC LIMIT 200")
    items = []
    if waiting:
        n = len(waiting)
        top = waiting[0]
        items.append({
            "verb": "decide", "title": f"{n} {'quote' if n == 1 else 'quotes'} from your mail and meetings to share",
            "why": "Sentences about the product. Only you can see them until you share one.",
            "quote": clip(top["quote"], 600), "person_name": top.get("name"),
            "source_table": "user_feedback_heard", "source_id": "to-share", "source_version": f"{n}:{top['id']}",
            "app": APP, "path": "/mine", "weight": 0.4,
        })
    needs_you_write(pod, PLUGIN, me, items, "source_table = 'user_feedback_heard'")
# end user-feedback:common

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


class UserFeedbackSampleDataInput(BaseModel):
    mode: str = "load"


class UserFeedbackSampleDataResult(BaseModel):
    rows: int
    message: str


DOMAIN = "ledgerline.example"
PRODUCTS = {
    "ours": ("Ledgerline", "ours", "https://ledgerline.example", ["Ledgerline app"], ["Ledgerline", "ledgerline.example"]),
    "tf": ("Tallyfold", "rival", "https://tallyfold.example", [], ["Tallyfold"]),
    "gw": ("Gridwise", "rival", "https://gridwise.example", [], ["Gridwise"]),
}
COMPANIES = {
    "hl": ("Halden Logistics", "halden.example"), "cv": ("Corvel Health", "corvel.example"),
    "bw": ("Brightwater Co.", "brightwater.example"), "pr": ("Pell & Rowe", "pellrowe.example"),
    "mf": ("Marlow Freight", "marlowfreight.example"), "ks": ("Kestrel Insurance", "kestrel.example"),
    "ar": ("Arden Foods", "ardenfoods.example"), "tv": ("Tovey Analytics", "tovey.example"),
    "ng": ("Northgate Clinics", "northgate.example"), "ql": ("Quillon Legal", "quillon.example"),
    "se": ("Sable Energy", "sable.example"), "fr": ("Fennick Retail", "fennick.example"),
    "hv": ("Harrow & Vale", "harrowvale.example"), "lb": ("Linden Bank", "lindenbank.example"),
    "om": ("Orrin Media", "orrin.example"), "cg": ("Calder Group", "calder.example"),
}
# company, status, amount, stage
DEALS = [("cv", "open", 58000, "Proposal"), ("hl", "open", 24000, "Negotiation"), ("mf", "won", 41000, "Won"),
         ("ks", "open", 36000, "Evaluation"), ("lb", "open", 30000, "Proposal"), ("bw", "open", 18000, "Discovery"),
         ("tv", "won", 22000, "Won"), ("se", "open", 27000, "Evaluation")]
# key, name, parent key, stage, description, aliases
FEATURES = [
    ("reporting", "Reporting", None, "live", "Reports and dashboards: building, filtering, sharing and exporting them.", []),
    ("access", "Access", None, "live", "Who can sign in and what they can see.", []),
    ("integrations", "Integrations", None, "live", "Connections to other tools.", []),
    ("platform", "Platform", None, "live", "The API, limits, the apps and how fast it all is.", []),
    ("csv", "CSV export", "reporting", "live", "Downloading a table or dashboard as a CSV file. Not scheduled reports, not the API.",
     ["download CSV", "data export", "spreadsheet export"]),
    ("sched", "Scheduled reports", "reporting", "live", "Reports sent on a schedule by email. Not the weekly digest.", ["report emails", "recurring report"]),
    ("filters", "Dashboard filters", "reporting", "live", "Filtering a dashboard by date, team or any field.", ["filters"]),
    ("digest", "Email digest", "reporting", "live", "The weekly summary email.", ["weekly digest", "weekly email"]),
    ("sso", "SSO (SAML)", "access", "idea", "Signing in through the customer's identity provider with SAML.", ["SAML", "single sign-on", "Okta"]),
    ("roles", "Roles and permissions", "access", "live", "What each person can see and change; read-only and admin roles.", ["read-only access", "permissions"]),
    ("audit", "Audit log", "access", "idea", "A record of who changed what, for auditors and security reviews.", ["audit trail"]),
    ("sfdc", "Salesforce sync", "integrations", "live", "Two-way sync of accounts and contacts with Salesforce.", ["Salesforce"]),
    ("slack", "Slack alerts", "integrations", "live", "Alerts posted to Slack when a number crosses a threshold.", ["Slack alert", "Slack notifications"]),
    ("api", "API limits", "platform", "live", "How many API calls a workspace can make, and what happens past the limit.", ["rate limit", "API limit"]),
    ("mobile", "Mobile app", "platform", "live", "The iPhone and Android apps.", ["iPhone app", "Android app"]),
    ("keepfilters", "Keep filters in export", "csv", "idea", "An export that keeps the filters and column order set on screen.", []),
    ("big", "Exports over 50k rows", "csv", "planned", "Exports that finish above fifty thousand rows instead of timing out.", ["large exports"]),
]
SUGGESTED = [
    ("bulk", "Bulk edit", "Changing the owner, category or tags of many dashboards or reports at once."),
    ("excel", "Export to Excel", "Downloading a table straight into an Excel file."),
]

# Quotes: feature | weeks ago | kind | importance | role | company (or @rival product) | source | quote
# source: m mail, t meeting, n note typed by a member, hn, yt (YouTube), rd (Reddit). vs:<rival> marks a comparison.
QUOTES = """
csv|0|problem|important|Head of Finance|hl|m|When I export to CSV it drops every filter I set, so I redo it in a spreadsheet every Monday.
csv|0|problem|blocker|Data lead|cv|t|Exports time out for us above about fifty thousand rows.
csv|0|problem|important|Finance analyst|ks|m|The CSV export puts dates in a format our ledger won't import.
csv|0|request|important|Controller|lb|m|We need the export to include the totals row, auditors ask for it every month.
csv|0|problem|nice|Operations lead|ar|m|Every export comes out with the columns in a different order than on screen.
csv|0|problem|important|Analyst|tv|t|Half my week is exporting the same three dashboards to CSV by hand.
csv|0|problem|blocker|Head of Data|se|t|If the export can't handle a year of meter readings we can't move off our old tool.
csv|0|request|nice|Account manager|om|m|A button to export just the rows I've selected would save a lot of deleting.
csv|0|problem|important|Finance director|hv|m|The export button spins for a minute and then gives up without saying why.
csv|0|praise|unknown|Fleet manager|mf|t|Export is the first thing I show new hires. It just works.
csv|1|problem|important|VP Engineering|cv|m|Our analysts live in spreadsheets. The export has to be reliable or we lose them.
csv|1|problem|nice|Office manager|pr|m|Special characters in client names come out garbled in the CSV.
csv|1|request|important|Data engineer|ks|m|Could the CSV export use the same field names as the API, so our scripts don't break?
csv|2|problem|important|Head of Finance|ar|t|The month-end export takes so long that people start it and go to lunch.
csv|2|problem|nice|Analyst|fr|m|Numbers in the export lose their thousands separators but keep the currency sign.
csv|2|praise|unknown|Controller|tv|m|The new export is much faster than it was last quarter, thank you.
csv|3|request|important|Reporting lead|lb|m|We'd like to export a whole dashboard at once instead of one table at a time.
csv|3|problem|important|Finance analyst|se|m|The CSV cuts off long notes fields at 255 characters.
csv|4|problem|nice|Operations analyst|cg|m|Exported files are all called export.csv, so they overwrite each other in my downloads.
csv|4|request|nice|Planner|hl|t|Could the export file name include the dashboard and the date?
csv|5|problem|important|Data lead|ng|m|Exporting more than a few months of appointments just fails.
csv|6|request|nice|Analyst|om|m|An export to Google Sheets would save us the download step.
csv|7|problem|nice|Office manager|ql|m|The export ignores the timezone we picked for the dashboard.
keepfilters|0|request|important|Analyst|ks|t|Can the export keep the filters I set? Right now I get every region, not just mine.
keepfilters|0|request|nice|Finance analyst|fr|m|Please make the CSV export respect the date range on the dashboard.
keepfilters|1|request|important|Controller|hl|m|Could the export keep the column order we picked?
keepfilters|2|problem|important|Operations lead|ar|m|We filter by depot and the export still gives us all twenty depots.
keepfilters|3|request|nice|Analyst|tv|m|If the export kept the filters I'd stop fixing every file by hand.
keepfilters|4|request|nice|Account manager|om|t|Exports should match what's on the screen, filters and all.
keepfilters|6|request|nice|Reporting lead|lb|m|A saved filter that applies to exports too would be ideal.
big|0|problem|blocker|Head of Data|cv|m|Our yearly claims export never finishes; it's about two hundred thousand rows.
big|0|request|important|Data engineer|se|m|We need exports in the hundreds of thousands of rows, even if it arrives by email later.
big|1|problem|important|Analyst|ng|m|Anything over fifty thousand rows times out, so we split it by month.
big|2|problem|important|Data lead|tv|t|Big exports time out at exactly the moment the board pack is due.
big|4|request|nice|Data engineer|ks|m|Could large exports run in the background and send a link when they're ready?
sso|0|request|blocker|VP Engineering|cv|t|If we can't do SAML by January, procurement won't sign.
sso|0|request|blocker|IT director|lb|m|Our security review fails on anything without SAML single sign-on.
sso|0|request|important|Head of IT|ks|m|We'd roll it out to the whole claims team if it worked with Okta.
sso|0|request|blocker|CISO|se|t|Without SSO we can't add more than ten people; that's our policy.
sso|0|question|important|IT manager|hv|m|Do you support SAML, or only Google sign-in?
sso|0|request|important|Systems lead|ng|m|Every new clinic means another set of passwords; SSO would end that.
sso|0|request|nice|Operations lead|ar|m|Single sign-on would make onboarding seasonal staff much quicker.
sso|1|request|important|IT director|cg|m|We need SAML before we can expand past the pilot team.
sso|1|request|important|Head of IT|om|t|Is SSO on your roadmap? It's the first thing our IT team asked.
sso|2|request|important|Security lead|tv|m|Our auditors flagged shared passwords. SAML would close that finding.
sso|2|question|nice|IT manager|fr|m|Can we sign in with Azure AD yet?
sso|3|request|important|CTO|hl|t|We moved everything else to Okta this year; this is one of three tools left.
sso|3|request|important|Head of IT|ql|m|Our clients' contracts require single sign-on for every system holding their data.
sso|4|request|nice|IT manager|pr|m|SSO would be nice, but it's not urgent for us.
sso|5|request|important|Systems lead|ks|m|Okta support would help us get this past security.
sso|6|request|nice|Office manager|bw|m|Will you add sign in with Microsoft?
bulk|0|request|important|Ops lead|bw|m|We change the owner on forty dashboards one at a time.
bulk|0|request|nice||@ours|hn|Select all, change category. That's all I want.
bulk|0|request|important|Reporting lead|lb|m|When someone leaves we spend a morning moving their reports to someone else.
bulk|0|request|nice|Analyst|fr|m|Let me tag twenty reports at once instead of opening each one.
bulk|0|problem|important|Operations lead|ar|t|Reorganising our folders took two days because everything is one by one.
bulk|0|request|nice|Account manager|om|m|A way to archive a batch of old dashboards would help us tidy up.
bulk|1|request|nice|Analyst|tv|m|I'd love to change the date range on all my dashboards in one go.
bulk|1|request|important|Controller|hl|m|We need to update the cost centre on hundreds of saved reports.
bulk|2|request|nice|Planner|cg|m|Multi-select in the report list, please.
excel|0|request|nice|Finance analyst|fr|m|Could it download straight into an Excel file instead of a CSV?
excel|1|request|nice|Controller|pr|m|Our accountant wants .xlsx files, not CSV.
excel|2|request|nice|Office manager|ql|m|An Excel download with the formatting kept would be lovely.
excel|3|question|unknown|Analyst|ng|m|Is there a way to get the table as an Excel workbook?
api|0|problem|blocker|Platform engineer|hl|m|We hit the limit at month end and the sync just stops.
api|0|problem|important|Data engineer|se|m|The API limit resets daily, but our loads all run in one hour.
api|0|problem|||@gw|yt|Gridwise is great until you hit the API limit, then every sync just stops.
api|0|question|important|Developer|tv|m|Can we pay for a higher API limit?
api|1|problem|important|Data engineer|ks|t|Our nightly job keeps getting rate limited halfway through.
api|1|problem|nice|Developer|om|m|The rate limit error doesn't say when we can try again.
api|2|request|important|Platform engineer|lb|m|We need a bulk endpoint so we don't burn the limit one record at a time.
api|3|problem|nice|Developer|cg|m|We hit the API limit just testing our integration.
api|5|question|unknown|Developer|ar|m|What is the API limit on the business plan?
filters|0|praise|unknown|Operations manager|pr|m|Love the new dashboard filters. Saved me an hour on board prep.
filters|0|praise|unknown|Analyst|ks|m|The new filters are exactly what we asked for, thank you.
filters|0|praise|unknown|Head of Finance|hl|t|Filtering by cost centre has changed how we run our monthly review.
filters|0|problem|nice|Analyst|fr|m|The date filter forgets my choice when I come back to the dashboard.
filters|1|praise|unknown|Reporting lead|lb|m|Being able to filter by region in one click is great.
filters|1|problem|nice|Analyst|tv|m|Filters on a shared dashboard change it for everyone.
filters|1|problem|nice|Planner|cg|m|I can't filter by more than one team at a time.
filters|2|problem|important|Operations lead|ar|m|Our managers can't find the filters; they're hidden behind a menu.
filters|2|problem|nice|Account manager|om|m|Filters don't apply to the charts at the bottom of the dashboard.
filters|3|problem|important|Data lead|ng|t|We need to filter by clinic, and the field doesn't show up as a filter.
filters|3|problem|nice|Analyst|se|m|The filter list is so long I scroll for a minute to find a field.
filters|4|problem|important|Controller|hl|m|There's no way to filter a dashboard by fiscal quarter.
filters|4|problem|nice|Office manager|pr|m|Filters reset every time I share the link.
filters|5|problem|nice|Analyst|tv|m|Filtering by a custom field isn't possible yet.
filters|5|problem|important|Reporting lead|lb|m|We want filters that apply to every chart on the page at once.
filters|6|problem|nice|Finance analyst|ks|m|I can only filter by one date field.
filters|7|problem|nice|Analyst|fr|m|There's no way to save a filter.
sched|0|comparison|||@ours|hn|Tried Tallyfold and this one. Tallyfold's scheduled reports kept arriving empty; this one just works.|vs:tf
sched|0|request|nice|Finance director|hv|m|Could scheduled reports go to a shared mailbox instead of one person?
sched|1|problem|important|Controller|lb|m|The Monday report arrived on Tuesday twice this month.
sched|3|request|nice|Account manager|om|m|We'd like to schedule a report for the first working day of the month.
sched|5|praise|unknown|Operations lead|ar|m|The scheduled report is the only one our directors actually open.
sched|6|problem|nice|Analyst|ng|m|Scheduled reports come as a link, and our directors want the numbers in the email.
digest|0|praise|unknown|Founder|pr|m|The weekly digest is the only email from you I actually read.
digest|3|request|nice|Head of Finance|ks|m|Could the weekly digest show last month too?
digest|5|problem|nice|Office manager|ql|m|The digest goes to people who left months ago.
roles|0|question|unknown|Controller|hl|m|Is there a way to give our auditors read-only access?
roles|2|request|important|IT director|lb|m|We need a role that can see reports but not change them.
roles|4|problem|nice|Reporting lead|cg|m|Everyone who can view a dashboard can also delete it.
roles|6|request|nice|Operations lead|ar|m|A viewer role for our store managers would help.
audit|1|request|important|Security lead|tv|m|Our auditors want a log of who changed each report.
audit|4|question|important|CISO|se|m|Do you keep an audit trail of permission changes?
sfdc|0|request|important|RevOps lead|bw|m|We would pay more for a Salesforce sync that doesn't duplicate contacts.
sfdc|1|problem|important|Sales operations|ks|m|The Salesforce sync makes a second account whenever a name changes.
sfdc|3|problem|nice|RevOps lead|om|m|Custom fields from Salesforce don't come across.
sfdc|5|request|nice|Account manager|hv|m|Could the Salesforce sync run every hour instead of nightly?
sfdc|6|praise|unknown|Sales operations|tv|m|Since the Salesforce sync our pipeline report finally matches.
slack|0|request|nice|Customer success, for Brightwater Co.|bw|n|Can the Slack alert say which dashboard it came from? Right now it just says “threshold crossed”.
slack|1|request|nice|Operations lead|ar|m|We'd like Slack alerts to go to different channels per region.
slack|3|problem|nice|Analyst|fr|m|Slack alerts fire again every hour while the number stays high.
slack|5|praise|unknown|Ops lead|bw|m|The Slack alerts caught a stock problem before our customers did.
mobile|0|praise|unknown|Fleet manager|mf|t|Honestly the mobile app is what my field team opens most.
mobile|1|problem|nice|Operations lead|ar|m|The mobile app logs us out every day.
mobile|3|request|nice|Field manager|mf|m|Could the mobile app work offline in depots with no signal?
mobile|5|praise|unknown|Planner|cg|m|Checking numbers on the phone between sites is a real time saver.
csv|0|problem|||@tf|hn|Tallyfold's export is a joke, it caps at ten thousand rows and doesn't tell you.
csv|2|praise|||@gw|yt|Gridwise exports keep the filters, which is the only reason we stayed.
sched|1|problem|||@tf|rd|Tallyfold's scheduled emails have been arriving blank for weeks.
sched|2|problem|||@tf|hn|Every Tallyfold scheduled report I set up quietly stopped after a month.
sso|1|praise|||@tf|rd|Tallyfold's SAML setup took ten minutes with Okta.
filters|2|problem|||@tf|rd|Tallyfold dashboards still can't filter by more than one field.
api|1|problem|||@gw|rd|Gridwise throttles you hard the moment you sync more than one source.
mobile|2|problem|||@tf|hn|The Tallyfold mobile app is just the website in a frame.
csv|1|problem|||@tf|yt|Tallyfold exports drop every column you've hidden, even the ones you need.
sfdc|3|problem|||@gw|yt|Gridwise's Salesforce connector duplicated half our accounts.
"""

# Kept but fitting no feature (Not filed), and set aside: weeks ago | role | company | source | quote
UNFILED = """
1|Office manager|pr|m|Your invoices still show our old address.
2|Analyst|ng|m|The help centre search doesn't find articles I know exist.
3|Account manager|om|t|Onboarding took longer than we'd planned because of our own data.
"""
SET_ASIDE = """
0|Office manager|bw|m|Thanks for the quick call yesterday.
0|Controller|hl|m|Could we move Thursday's check-in to the afternoon?
1|Analyst|tv|m|Attached is the purchase order for next year.
1|Finance analyst|ks|m|Please send the invoice to accounts payable instead.
2|Operations lead|ar|m|We're closed for the holiday on Monday.
3|IT manager|fr|m|I'll forward this to our security team.
"""

# The person's own mail and meetings: only they see these until they share.
MINE = [
    ("sso", "comparison", "important", "CTO", "mf", "m", "Re: renewal terms", 0, "We're also looking at Tallyfold because they already do SAML.", ["tf"]),
    ("big", "problem", "important", "Data lead", "cv", "t", "Onboarding call", 0, "Exports time out for us above about fifty thousand rows, so we split them by quarter.", []),
    ("digest", "praise", "unknown", "Founder", "pr", "m", "Re: invoice", 1, "Honestly the weekly digest is the one email from software I read every week.", []),
    ("sfdc", "request", "important", "RevOps lead", "bw", "m", "Re: plan options", 2, "We'd move up a plan for a Salesforce sync that leaves our contacts alone.", []),
]

# The Lemma's three choices for the inbox's first rows (the rest are worked out by code).
OPTIONS = {
    "When I export to CSV": ["csv", "filters", "sched"],
    "If we can't do SAML": ["sso", "roles", "audit"],
    "Tried Tallyfold and this one": ["sched", "digest", "filters"],
    "Can the Slack alert": ["slack", "filters", "digest"],
    "Love the new dashboard filters": ["filters", "sched", "csv"],
    "Gridwise is great until": ["api", "sfdc", "slack"],
    "Is there a way to give our auditors": ["roles", "sso", "audit"],
    "Honestly the mobile app": ["mobile", "filters", "sched"],
}
# Which of this week's quotes are still in the inbox, to file.
INBOX = list(OPTIONS)
UNSURE = {"Is there a way to give our auditors", "Tried Tallyfold and this one"}


def _sid(*parts) -> str:
    return rid("sample", *parts)


def _email(role: str, domain: str) -> str:
    slug = _re.sub(r"[^a-z]+", ".", role.lower()).strip(".") or "team"
    return f"{slug}@{domain}"


def build(now, me: str | None, colleague: str | None = None) -> dict:
    """Every sample row, by table, dated around `now`. Pure: no Lemma. With a
    `colleague` (the demo's second member), two in three of the shared quotes
    were heard by them."""
    out = {t: [] for t in ("product", "feature", "company", "company_domain", "deal", "feedback", "user_feedback_filing",
                           "ask", "user_feedback_post", "user_feedback_listen", "user_feedback_heard")}
    pid = {k: _sid("product", k) for k in PRODUCTS}
    for k, (name, role, url, aliases, keywords) in PRODUCTS.items():
        out["product"].append({"id": pid[k], "name": name, "role": role, "url": url, "aliases": aliases or None,
                               "keywords": keywords, "active": True, "source": "sample", "source_id": k})
    cid = {k: company_id_for(d) for k, (_, d) in COMPANIES.items()}
    for k, (name, domain) in COMPANIES.items():
        out["company"].append({"id": cid[k], "name": name, "domain": domain, "name_from": "domain"})
        out["company_domain"].append({"id": str(_uuid.uuid5(COMPANY_NS, domain)), "company_id": cid[k], "domain": domain})
    for co, status, amount, stage in DEALS:
        name, domain = COMPANIES[co]
        out["deal"].append({"id": _sid("deal", co), "name": f"{name}: annual plan", "company_id": cid[co], "company_name": name,
                            "company_domain": domain, "stage": stage, "status": status, "amount": float(amount), "currency": "USD",
                            "owner_user_id": me, "source": "sample", "source_id": co,
                            "closed_at": (now - _timedelta(days=40)).isoformat() if status == "won" else None})
    fid = {k: _sid("feature", k) for k, *_ in FEATURES}
    fid.update({k: _sid("feature", k) for k, *_ in SUGGESTED})
    for k, name, parent, stage, desc, aliases in FEATURES:
        row = {"id": fid[k], "product_id": pid["ours"], "name": name, "description": desc, "parent_id": fid.get(parent),
               "aliases": aliases or None, "state": "active", "origin": "team", "stage": stage,
               "stage_at": (now - _timedelta(days=14 if k == "filters" else 120)).isoformat(),
               "source": "sample", "source_id": k}
        if k == "csv":
            row.update(owner_user_id=me, work_source="github", work_id="ledgerline/app#412",
                       work_url="https://github.example/ledgerline/app/issues/412")
        if k == "big":
            row.update(work_source="github", work_id="ledgerline/app#455", work_url="https://github.example/ledgerline/app/issues/455")
        out["feature"].append(row)
    for k, name, desc in SUGGESTED:
        out["feature"].append({"id": fid[k], "product_id": pid["ours"], "name": name, "description": desc, "state": "suggested",
                               "origin": "lemma", "stage": "idea", "stage_at": (now - _timedelta(days=1)).isoformat(),
                               "source": "sample", "source_id": k})
    feats = {r["id"]: dict(r, aliases=r.get("aliases") or []) for r in out["feature"]}

    def when(weeks: int, n: int) -> str:
        days = weeks * 7 + (n * 3) % 6 + (0 if weeks else 0)
        hours = (n * 5) % 9 + 1
        return (now - _timedelta(days=days, hours=hours)).isoformat()

    counter = 0
    inbox_left = list(INBOX)
    for line in [x for x in QUOTES.strip().splitlines() if x.strip()]:
        parts = line.split("|")
        fkey, weeks, kind, imp, role, co, src, quote = parts[:8]
        vs = [pid[p.split(":")[1]] for p in parts[8:] if p.startswith("vs:")]
        counter += 1
        weeks = int(weeks)
        product = pid[co[1:]] if co.startswith("@") else pid["ours"]
        public = src in ("hn", "yt", "rd")
        company = None if co.startswith("@") else co
        source = {"m": "mail", "t": "meeting", "n": "note", "hn": "hn", "yt": "youtube", "rd": "reddit"}[src]
        source_id = f"sample-{source}-{counter}"
        fb_id = feedback_id(source, source_id, quote)
        lead = next((k for k in INBOX if quote.startswith(k)), None)
        state = "new" if lead in inbox_left else "processed"
        if lead in inbox_left:
            inbox_left.remove(lead)
        feature = fid[fkey]
        handle = _email(role, COMPANIES[company][1]) if company and src != "n" else None
        if src == "n":
            handle = _email("ops lead", COMPANIES[company][1])
        row = {
            "id": fb_id, "quote": quote, "product_id": product, "feature_id": feature,
            "filed_by": "lemma", "kind": kind, "compared_with": vs or None,
            "sentiment": {"praise": "positive", "problem": "negative", "comparison": "mixed"}.get(kind, "neutral"),
            "importance": imp or "unknown",
            "handle_kind": ("email" if company else {"hn": "hn", "yt": "youtube", "rd": "reddit"}.get(src)),
            "handle": handle or (f"sample-{src}-{counter}" if public else None),
            "name": None if public else ("Ops lead" if src == "n" else role),
            "company_id": cid.get(company) if company else None,
            "company_name": COMPANIES[company][0] if company else None,
            "source": source, "source_account": "sample", "source_id": source_id,
            "source_url": (f"https://news.ycombinator.example/item?id={9000 + counter}" if src == "hn" else
                           f"https://youtube.example/watch?v=sample{counter}" if src == "yt" else
                           f"https://reddit.example/r/analytics/comments/sample{counter}" if src == "rd" else None),
            "at_seconds": ({"If we can't": 872, "Exports time out for us": 1330, "Honestly the mobile": 1865}.get(
                next((k for k in ("If we can't", "Exports time out for us", "Honestly the mobile") if quote.startswith(k)), ""))
                           or (401 if src == "yt" and "Gridwise is great" in quote else 192 if src == "yt" else
                               (counter * 97) % 2400 + 60 if src == "t" else None)),
            "heard_by": (colleague if colleague and counter % 3 else me) if src in ("m", "t", "n") else None, "is_public": public,
            "authenticity": "organic" if public else "unknown", "said_at": when(weeks, counter), "state": state,
            "plugin": PLUGIN,
        }
        if src == "n":
            row["name"] = "Customer success, for Brightwater Co."
        out["feedback"].append(row)
        # The Lemma's filing: its choices, how sure, the words that match.
        short = [feats[x] for x in feats if feats[x]["state"] == "active"]
        if lead:
            opts = [fid[k] for k in OPTIONS[lead]]
        else:
            opts, _ = options_for(feature, quote, short)
            opts = opts or [feature]
        matched = {o: matched_words(quote, feats[o]) for o in opts if o in feats}
        out["user_feedback_filing"].append({
            "id": fb_id, "options": opts, "confidence": 0.55 if lead in UNSURE else 0.86 + (counter % 10) / 100,
            "matched": {k: v for k, v in matched.items() if v}, "picked": feature, "calls": 3 if source == "mail" else 2,
            "filed_at": row["said_at"], "sample": True})
        if public:
            out["user_feedback_post"].append({
                "id": rid("post", source, source_id), "source": source, "source_id": source_id, "url": row["source_url"],
                "product_id": product, "author": f"sample-{src}-{counter}", "title": None, "published_at": row["said_at"],
                "state": "kept", "feedback_count": 1, "sample": True})
        if state == "processed" and kind == "request" and handle and feature in feats and feats[feature]["state"] == "active":
            f = feats[feature]
            ws, wi, wu = work_of(f)
            out["ask"].append({
                "id": ask_id("email", handle, source, source_id, ws, wi), "work_source": ws, "work_id": wi, "work_url": wu,
                "work_title": f["name"], "handle_kind": "email", "handle": handle, "name": row["name"],
                "company_id": row["company_id"], "company_name": row["company_name"], "source": source,
                "source_account": "sample", "source_id": source_id, "heard_by": me, "asked_at": row["said_at"],
                "state": "open", "plugin": PLUGIN})
    for block, state in ((UNFILED, "processed"), (SET_ASIDE, "set_aside")):
        for line in [x for x in block.strip().splitlines() if x.strip()]:
            weeks, role, co, src, quote = line.split("|")
            counter += 1
            source = {"m": "mail", "t": "meeting"}[src]
            source_id = f"sample-{source}-{counter}"
            out["feedback"].append({
                "id": feedback_id(source, source_id, quote), "quote": quote, "product_id": pid["ours"], "feature_id": None,
                "kind": "other", "importance": "unknown", "handle_kind": "email", "handle": _email(role, COMPANIES[co][1]),
                "name": role, "company_id": cid[co], "company_name": COMPANIES[co][0], "source": source,
                "source_account": "sample", "source_id": source_id, "heard_by": me, "is_public": False,
                "authenticity": "unknown", "said_at": when(int(weeks), counter), "state": state, "plugin": PLUGIN})
    for i, (fkey, kind, imp, role, co, src, place, days, quote, rivals) in enumerate(MINE):
        source = "mail" if src == "m" else "meeting"
        source_id = f"sample-mine-{i}"
        f = feats[fid[fkey]]
        short = [feats[x] for x in feats if feats[x]["state"] == "active"]
        opts, matched = options_for(f["id"], quote, short)
        out["user_feedback_heard"].append({
            "id": feedback_id(source, source_id, quote), "quote": quote, "product_id": pid["ours"], "feature_id": f["id"],
            "kind": kind, "compared_with": [pid[r] for r in rivals] or None,
            "sentiment": {"praise": "positive", "problem": "negative", "comparison": "mixed"}.get(kind, "neutral"),
            "importance": imp, "handle_kind": "email", "handle": _email(role, COMPANIES[co][1]), "name": role, "role": role,
            "company_id": cid[co], "company_name": COMPANIES[co][0], "source": source, "source_account": "sample",
            "source_id": source_id, "at_seconds": 1330 if source == "meeting" else None, "place": place,
            "said_at": (now - _timedelta(days=days, hours=2 + i)).isoformat(), "confidence": 0.9, "options": opts or [f["id"]],
            "matched": matched, "share_state": "unshared", "sample": True})
    # Listening, as it would read after a week.
    for k, p in pid.items():
        out["user_feedback_listen"].append({
            "id": _sid("listen", "hn", k), "source": "hn", "product_id": p, "state": "done",
            "started_at": (now - _timedelta(minutes=40)).isoformat(), "finished_at": (now - _timedelta(minutes=39)).isoformat(),
            "found": {"ours": 14, "tf": 9, "gw": 4}[k], "kept": {"ours": 3, "tf": 3, "gw": 0}[k], "records": 0,
            "keywords": PRODUCTS[k][4], "calls": 11 if k == "ours" else 0, "sample": True})
    return out


SHARED = ("product", "feature", "company", "company_domain", "deal", "feedback", "ask")
OWN = ("user_feedback_filing", "user_feedback_post", "user_feedback_listen")


def _load(ctx: FunctionContext) -> UserFeedbackSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    s = settings_of(pod)
    if s.get("setup_done_at") and not s.get("sample"):
        has = q(pod, "SELECT COUNT(*) AS n FROM feedback WHERE plugin = 'user-feedback' AND source_account IS DISTINCT FROM 'sample'")
        if int((has or [{}])[0].get("n") or 0):
            raise ValueError("This Lemma already has the team's own feedback; the sample would mix with it.")
    rows_ = build(_datetime.now(_tz.utc), me)
    # Companies and domains a member's People map already has stay theirs: only new ones are the sample's.
    have = {r["id"] for r in q(pod, f"SELECT id FROM company WHERE id IN ({lits([c['id'] for c in rows_['company']])})")}
    rows_["company"] = [c for c in rows_["company"] if c["id"] not in have]
    have = {r["id"] for r in q(pod, f"SELECT id FROM company_domain WHERE id IN ({lits([c['id'] for c in rows_['company_domain']])})")}
    rows_["company_domain"] = [c for c in rows_["company_domain"] if c["id"] not in have]
    noted = []
    total = 0
    for table in ("product", "company", "company_domain", "deal", "feature", "user_feedback_filing", "feedback", "ask",
                  "user_feedback_post", "user_feedback_listen", "user_feedback_heard"):
        items = rows_[table]
        bulk_upsert(pod, table, items)
        total += len(items)
        if table in SHARED:
            noted += [{"id": rid("sample-row", table, r["id"]), "table_name": table, "row_id": r["id"]} for r in items]
    bulk_upsert(pod, "user_feedback_sample_row", noted)
    names = {p["name"]: p for p in rows_["product"]}
    save_settings(pod, {
        "sample": True, "products_done": True, "features_done": True, "team_name": "Ledgerline",
        "setup_done_at": s.get("setup_done_at") or now_iso(), "hn": True,
        "filers": s.get("filers") or ([{"user_id": me, "name": None}] if me else []),
        "duplicates": [{"a": _sid("feature", "excel"), "b": _sid("feature", "csv"), "confidence": 0.82, "at": now_iso()}],
    })
    if me:
        pod.records.bulk_create("user_feedback_member", [{"id": member_row_id(me), "member_id": me, "read_mail": True,
                                                         "read_meetings": True, "auto_share": False,
                                                         "setup_done_at": now_iso()}], upsert=True)
        share_item(pod, me)
    return UserFeedbackSampleDataResult(rows=total, message=f"Loaded the sample: {len(rows_['feedback'])} quotes about "
                                                             f"{names['Ledgerline']['name']} and two rivals.")


def _clear(ctx: FunctionContext) -> UserFeedbackSampleDataResult:
    pod = ctx.pod
    me = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    noted = q(pod, "SELECT table_name, row_id FROM user_feedback_sample_row LIMIT 5000")
    by_table: dict = {}
    for r in noted:
        by_table.setdefault(r["table_name"], []).append(r["row_id"])
    fb_ids = by_table.get("feedback", [])
    # Asks kept from the sample's quotes since it was loaded.
    asks = q(pod, "SELECT id FROM ask WHERE source_account = 'sample' AND plugin = 'user-feedback' LIMIT 5000")
    by_table.setdefault("ask", [])
    by_table["ask"] = sorted(set(by_table["ask"]) | {a["id"] for a in asks})
    total = 0

    def drop(table, ids):
        nonlocal total
        ids = sorted(set(ids))
        for start in range(0, len(ids), 100):
            chunk = ids[start : start + 100]
            present = [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE id IN ({lits(chunk)})")]
            if present:
                pod.records.bulk_delete(table, present)
                total += len(present)

    for table in ("ask", "feedback", "deal", "feature", "company_domain", "company", "product"):
        drop(table, by_table.get(table, []))
    # Features the sample's nightly pass or a person made from its quotes.
    drop("feature", [r["id"] for r in q(pod, "SELECT id FROM feature WHERE product_id IN "
                                             f"({lits(by_table.get('product', []))}) LIMIT 2000")] if by_table.get("product") else [])
    for table in ("user_feedback_filing", "user_feedback_post", "user_feedback_listen"):
        drop(table, [r["id"] for r in q(pod, f"SELECT id FROM {table} WHERE sample = TRUE LIMIT 5000")])
    drop("user_feedback_filing", fb_ids)
    drop("user_feedback_heard", [r["id"] for r in q(pod, "SELECT id FROM user_feedback_heard WHERE sample = TRUE LIMIT 5000")])
    drop("user_feedback_sample_row", [r["id"] for r in q(pod, "SELECT id FROM user_feedback_sample_row LIMIT 5000")])
    s = settings_of(pod)
    left = [p for p in products_of(pod) if p.get("role") != "rival"]
    save_settings(pod, {"sample": False, "duplicates": [], "products_done": bool(left), "features_done": bool(left),
                        "setup_done_at": s.get("setup_done_at") if left else None})
    if me:
        share_item(pod, me)
        needs_you_write(pod, PLUGIN, me, [], "source_table <> 'user_feedback_heard'")
    return UserFeedbackSampleDataResult(rows=total, message="Cleared the sample. The team's own rows are as they were.")


def user_feedback_sample_data(ctx: FunctionContext, data: UserFeedbackSampleDataInput) -> UserFeedbackSampleDataResult:
    if data.mode == "clear":
        return _clear(ctx)
    if data.mode != "load":
        raise ValueError("mode is load or clear")
    return _load(ctx)
