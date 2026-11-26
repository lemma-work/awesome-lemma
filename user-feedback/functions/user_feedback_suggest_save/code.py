#input_type_name: UserFeedbackSuggestSaveInput
#output_type_name: UserFeedbackSuggestSaveResult
#function_name: user_feedback_suggest_save

"""Keep what the nightly grouper found.

  - A group of three or more quotes that fit no feature becomes a suggested
    feature (state suggested, origin lemma), its quotes filed under it; a
    person accepts, merges or drops it. Before that, one Decisions call asks
    whether the name is the same as one of the team's features (a shortlist
    of up to 63): a sure yes makes the "looks like the same feature" card,
    unless the team kept the two apart before.
  - Each one-line `point` the grouper wrote fills a quote's empty `point`.
  - Asks still pointing at a feature itself follow its linked work, once it
    has some.

The grouper writes names and points only; everything it says about which
quote is which is checked here against the rows (an id it made up is dropped).
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

MIN_GROUP = 3
SURE_SAME = 0.6


class UserFeedbackSuggestSaveInput(BaseModel):
    found: dict = {}


class UserFeedbackSuggestSaveResult(BaseModel):
    suggested: int
    duplicates: int
    points: int
    asks_moved: int
    calls: int
    message: str


def user_feedback_suggest_save(ctx: FunctionContext, data: UserFeedbackSuggestSaveInput) -> UserFeedbackSuggestSaveResult:
    pod = ctx.pod
    found = data.found or {}
    if isinstance(found.get("output"), dict):
        found = found["output"]
    s = settings_of(pod)
    ours = [p for p in products_of(pod) if p.get("role") != "rival"]
    active = features_of(pod)
    all_feats = {f["name"].lower(): f for f in features_of(pod, ("active", "suggested", "archived", "merged"))}
    apart = {tuple(sorted(p)) for p in (s.get("kept_apart") or []) if isinstance(p, list) and len(p) == 2}
    dupes = [d for d in (s.get("duplicates") or []) if isinstance(d, dict)]
    calls = suggested = points = 0

    groups = [g for g in (found.get("groups") or []) if isinstance(g, dict) and str(g.get("name") or "").strip()]
    wanted = sorted({str(i) for g in groups for i in (g.get("quote_ids") or [])})
    still = {r["id"] for r in q(pod, f"SELECT id FROM feedback WHERE id IN ({lits(wanted)}) AND feature_id IS NULL "
                                    "AND state <> 'set_aside'")} if wanted else set()
    for g in groups:
        ids = [i for i in dict.fromkeys(str(x) for x in g.get("quote_ids") or []) if i in still]
        name = clip(str(g["name"]).strip().rstrip("."), 120)
        if len(ids) < MIN_GROUP or not ours:
            continue
        same = all_feats.get(name.lower())
        if same and same.get("state") == "active":
            fid = same["id"]
        elif same and same.get("state") in ("archived", "merged"):
            continue  # the team dropped this one before
        else:
            fid = same["id"] if same else rid("feature", ours[0]["id"], name.lower())
            if not same:
                pod.records.bulk_create("feature", [{
                    "id": fid, "product_id": ours[0]["id"], "name": name, "description": clip(g.get("description"), 600),
                    "state": "suggested", "origin": "lemma", "stage": "idea", "stage_at": now_iso(),
                    "source": PLUGIN, "source_id": fid}], upsert=True)
                all_feats[name.lower()] = {"id": fid, "name": name, "state": "suggested"}
                suggested += 1
            short = shortlist(active, f"{name} {g.get('description') or ''}")
            if short:
                schema = {"type": "object", "properties": {"same": {
                    "type": "string",
                    "description": "Is the suggested feature the same thing as one of the team's features, under another name? Same means a person would file every one of its quotes there. If none is, answer none.",
                    "oneOf": [*({"const": f["id"], "description": clip(f["name"] + (f": {f['description']}" if f.get("description") else "")
                                                                         + (f". Also called: {', '.join(f['aliases'][:5])}" if f.get("aliases") else ""), 300)}
                                for f in short), {"const": "none", "description": "None of these."}]}}}
                evidence = "\n".join([f"Suggested feature: {name}", f"What it is: {g.get('description') or ''}", "",
                                      "Quotes under it:", *(f"- {r['quote'][:300]}" for r in q(pod, f"SELECT quote FROM feedback WHERE id IN ({lits(ids[:8])})"))])
                try:
                    got, n = decide(pod, "Compare a suggested feature with a product team's own list of features.", schema, evidence)
                    calls += n
                    value, conf = answer(got, "same")
                    if value and value != "none" and (conf is None or conf >= SURE_SAME) and tuple(sorted([fid, value])) not in apart:
                        dupes = [d for d in dupes if d.get("a") != fid]
                        dupes.append({"a": fid, "b": value, "confidence": conf, "at": now_iso()})
                except Exception:  # noqa: BLE001 — no card tonight
                    calls += 1
        bulk_update(pod, "feedback", [{"id": i, "feature_id": fid, "filed_by": "lemma"} for i in ids])
        still -= set(ids)

    valid_points = {}
    for p in found.get("points") or []:
        if isinstance(p, dict) and p.get("id") and str(p.get("point") or "").strip():
            valid_points[str(p["id"])] = clip(str(p["point"]).strip(), 200)
    if valid_points:
        empty = {r["id"] for r in q(pod, f"SELECT id FROM feedback WHERE id IN ({lits(list(valid_points))}) AND point IS NULL")}
        bulk_update(pod, "feedback", [{"id": i, "point": valid_points[i]} for i in empty])
        points = len(empty)

    moved = 0
    linked = {f["id"]: f for f in active if f.get("work_source") and f.get("work_id")}
    if linked:
        for a in q(pod, f"SELECT id, work_id FROM ask WHERE work_source = 'feature' AND work_id IN ({lits(list(linked))}) LIMIT 2000"):
            f = linked[a["work_id"]]
            pod.records.update("ask", a["id"], {"work_source": f["work_source"], "work_id": f["work_id"], "work_url": f.get("work_url")})
            moved += 1
    names = {f["id"] for f in features_of(pod, ("active", "suggested"))}
    dupes = [d for d in dupes if d.get("a") in names and d.get("b") in names][-10:]
    save_settings(pod, {"duplicates": dupes})
    return UserFeedbackSuggestSaveResult(suggested=suggested, duplicates=len(dupes), points=points, asks_moved=moved, calls=calls,
                                         message=f"{suggested} suggested features, {points} points written, {len(dupes)} likely duplicates.")
