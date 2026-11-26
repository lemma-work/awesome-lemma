#input_type_name: EarlyAccessSetupSaveInput
#output_type_name: EarlyAccessSetupSaveResult
#function_name: early_access_setup_save

"""Keep a beta from the beta sheet, as the person: the beta row, what its
public page draws (Public `early_access_page`), the shared `feature` at stage
beta (and a `product` when the team has none yet), the person's mailbox to
send from, and the sign-up's row in the shared `form` table. Only the fields
given change; safe to run again. Turning the page on is the app's (a table
opened to visitors, the web widget and the triggers can only be made by a
person); it saves `state` open and what each step read back here after.
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# early-access:common
# Shared by Early access' functions, word for word (bin/common.py).
import hashlib as _hashlib
import json as _json
import re as _re
import time as _time
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

EA_NS = _uuid.UUID("43265d5b-adc8-4882-aeed-b4433a61b096")
FEEDBACK_NS = _uuid.UUID("19126ba2-6613-4244-a0c9-bb395b202890")
FORMS_NS = _uuid.UUID("ba341d0a-0b0a-4d01-9869-2c8791b9f203")
COMPANY_NS = _uuid.UUID("c6fc6ea2-4356-443e-8065-e1d71b8f6359")
PLUGIN = "early-access"
APP = "early-access"
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com",
            "me.com", "proton.me", "protonmail.com", "aol.com"}
EMAIL = _re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$")
IN_BETA = ("invited", "active", "quiet")
QUESTIONS = [
    {"key": "role", "label": "Your role", "on": True},
    {"key": "use_for", "label": "What would you use it for?", "on": True},
    {"key": "today", "label": "How do you do it today?", "on": True},
    {"key": "company", "label": "Company", "on": True},
]


def rid(*parts) -> str:
    """A stable id from its parts."""
    return str(_uuid.uuid5(EA_NS, "|".join(str(p) for p in parts)))


def tester_id(beta_id, handle_kind, handle) -> str:
    """One person in one beta: uuid5(EA_NS, "<beta id>|<kind>:<handle>")."""
    return str(_uuid.uuid5(EA_NS, f"{beta_id}|{handle_kind}:{str(handle).strip().lower()}"))


def quote_key(quote: str) -> str:
    return _hashlib.sha1(" ".join(str(quote).lower().split()).encode()).hexdigest()[:16]


def feedback_id(source: str, source_id: str, quote: str) -> str:
    """The contract's id rule (_contract/tables/feedback.json)."""
    return str(_uuid.uuid5(FEEDBACK_NS, f"{source}:{source_id}|{quote_key(quote)}"))


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
    """A JSON column as Python, whether the API handed back text or JSON."""
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return _json.loads(value)
    except (TypeError, ValueError):
        return default


def now() -> _datetime:
    return _datetime.now(_tz.utc)


def now_iso() -> str:
    return now().isoformat()


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def days_since(value) -> float | None:
    moment = stamp(value)
    return None if moment is None else (now() - moment).total_seconds() / 86400


def clip(text, n: int):
    text = (str(text) if text is not None else "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def first_name(name, handle=None) -> str:
    name = str(name or "").strip()
    if name:
        return name.split()[0]
    return str(handle or "there").split("@")[0]


def beta_of(pod, beta_id) -> dict | None:
    if not beta_id:
        return None
    found = q(pod, f"SELECT * FROM early_access_beta WHERE id = {lit(beta_id)}")
    return dict(found[0]) if found else None


def tester_of(pod, tid) -> dict | None:
    if not tid:
        return None
    found = q(pod, f"SELECT * FROM early_access_tester WHERE id = {lit(tid)}")
    return dict(found[0]) if found else None


def add_event(t: dict, what: str, quote=None, source=None, ai=False, at=None) -> list:
    """The tester's timeline with one more line (newest last, at most 60)."""
    line = {"at": at or now_iso(), "what": clip(what, 300)}
    if quote:
        line["quote"] = clip(quote, 600)
    if source:
        line["source"] = source
    if ai:
        line["ai"] = True
    return (jl(t.get("timeline"), []) + [line])[-60:]


def pace_line(beta: dict) -> str:
    n = int(beta.get("batch_size") or 10)
    return f"We let in about {n} a week, by fit. We'll write when it's your turn."


def status_line(state: str, beta: dict, invited: bool = True) -> str:
    if state == "in":
        return ("You're in. The invite is in your inbox; reply to it with anything that gets in the way." if invited
                else "You're in. The team will write to you about how to start.")
    if state == "not_now":
        return "Not this time. Thank you for signing up; we'll keep your answers for the next round."
    return pace_line(beta)


def set_status(pod, ref, beta: dict, state: str, line: str | None = None, invited: bool = True) -> None:
    """The Public row the sign-up page reads for its own ref: a state and one general line."""
    if not ref:
        return
    pod.records.bulk_create("early_access_status", [{
        "id": rid("status", ref), "ref": ref, "beta_id": beta.get("id"), "state": state,
        "line": clip(line or status_line(state, beta, invited), 300)}], upsert=True)


def count_in_forms(pod, beta: dict, answered: bool = False) -> None:
    """Keep this beta's sign-up in the shared `form` table (Forms counts every door
    there), with its last answer and seven days of counts. Its answers stay Early access's."""
    try:
        since = (now() - _timedelta(days=7)).date().isoformat()
        days = q(pod, "SELECT CAST(created_at AS DATE) AS day, COUNT(*) AS n FROM early_access_signup "
                      f"WHERE beta_id = {lit(beta['id'])} AND created_at >= {lit(since)} GROUP BY CAST(created_at AS DATE) ORDER BY day")
        row = {"id": str(_uuid.uuid5(FORMS_NS, f"plugin:early_access_signup:{beta['id']}")),
               "name": clip(f"Early access: {beta.get('name')}", 200), "source": "plugin",
               "source_id": f"early_access_signup:{beta['id']}", "owner_plugin": PLUGIN, "purpose": "beta",
               "reply_mode": "draft", "audience": "contacts", "place": clip(beta.get("page_url") or f"/{beta.get('slug')}", 300),
               "state": {"open": "on", "paused": "paused"}.get(beta.get("state") or "", "off"),
               "held_by_user_id": beta.get("owner_user_id"),
               "fields": [{"key": k["key"], "label": k["label"], "order": i} for i, k in enumerate(
                   [{"key": "name", "label": "Your name"}, {"key": "email", "label": "Your email"}]
                   + [x for x in (jl(beta.get("questions"), QUESTIONS) or []) if x.get("on", True)])],
               "week": [{"day": str(d.get("day"))[:10], "n": int(d.get("n") or 0)} for d in days],
               "sample": bool(beta.get("sample"))}
        if answered:
            row["last_answer_at"] = now_iso()
        pod.records.bulk_create("form", [row], upsert=True)
    except Exception:  # noqa: BLE001 - the sign-up is handled either way
        pass


def decide(pod, instruction: str, schema: dict, evidence, examples=None) -> dict:
    """One Decisions call, retried on rate limits: {"answers": {k: {value, confidence}}} or {"error": ...}."""
    for attempt in range(4):
        try:
            got = as_dict(pod.decisions.make(instruction=instruction, schema=schema, evidence=evidence,
                                             examples=examples or None, priority="background"))
            answers = {}
            for key, value in as_dict(got.get("answers")).items():
                value = as_dict(value) if not isinstance(value, (str, int, float, bool, list)) else {"value": value}
                answers[key] = {"value": value.get("value"), "confidence": value.get("confidence")}
            return {"answers": answers}
        except Exception as exc:  # noqa: BLE001 - classified below
            status = getattr(exc, "status_code", None) or getattr(exc, "status", None)
            if status == 429 or "RATE_LIMITED" in str(exc):
                _time.sleep(float(getattr(exc, "retry_after", None) or 8))
                continue
            if status in (502, 503, 504) or "UNAVAILABLE" in str(exc):
                _time.sleep(1.5 * (attempt + 1))
                continue
            return {"error": f"{type(exc).__name__}: {exc}"[:300]}
    return {"error": "the Decisions API was unavailable"}


def remember_sample(pod, table: str, ids: list) -> None:
    if ids:
        pod.records.bulk_create("early_access_sample_row", [
            {"id": rid("sample", table, i), "table_name": table, "row_id": str(i)} for i in ids], upsert=True)


def start_drafts(pod, kind: str, tester_ids: list) -> int:
    """One early-access-draft run per tester (create the run, submit its form)."""
    started = 0
    for tid in list(dict.fromkeys(tester_ids))[:60]:
        try:
            run = as_dict(pod.workflows.create_run("early-access-draft", about=("early_access_tester", str(tid))))
            pod.workflows.submit_form(str(run.get("id")), node_id="ask", inputs={"tester_id": str(tid), "kind": kind})
            started += 1
        except Exception:  # noqa: BLE001 - the next press or sweep tries again
            continue
    return started
# end early-access:common

RESERVED = {"b", "p", "setup", "settings", "assets", "api", "status", "check-in"}
SLUG = _re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$")


class EarlyAccessSetupSaveInput(BaseModel):
    beta_id: str | None = None
    name: str | None = None
    intro: str | None = None
    slug: str | None = None
    feature_id: str | None = None
    product_name: str | None = None
    flag_tool: str | None = None
    flag_key: str | None = None
    cohort_id: str | None = None
    cohort_name: str | None = None
    posthog_account_id: str | None = None
    posthog_project_id: str | None = None
    posthog_url: str | None = None
    usage_events: list | None = None
    survey_id: str | None = None
    batch_size: int | None = None
    checkin_day: int | None = None
    quiet_days: int | None = None
    questions: list[dict] | None = None
    mailbox: str | None = None
    state: str | None = None
    page_url: str | None = None
    widget_key: str | None = None
    turned_on: list[dict] | None = None


class EarlyAccessSetupSaveResult(BaseModel):
    ok: bool
    beta_id: str | None = None
    slug: str | None = None
    problem: str | None = None
    message: str = ""


def _feature(pod, data, me) -> tuple[str | None, str | None]:
    """The shared feature (made when the name is new), and its product."""
    if data.feature_id:
        found = q(pod, f"SELECT id, product_id FROM feature WHERE id = {lit(data.feature_id)}")
        if found:
            return found[0]["id"], found[0].get("product_id")
    name = clip(data.name, 120)
    same = q(pod, f"SELECT id, product_id FROM feature WHERE lower(name) = {lit(name.lower())} AND state = 'active' LIMIT 1")
    if same:
        return same[0]["id"], same[0].get("product_id")
    products = q(pod, "SELECT id FROM product WHERE role = 'ours' ORDER BY created_at LIMIT 1")
    if products:
        product_id = products[0]["id"]
    else:
        pname = clip(data.product_name or "Our product", 120)
        product_id = rid("product", pname.lower())
        pod.records.bulk_create("product", [{"id": product_id, "name": pname, "role": "ours", "active": True,
                                             "source": PLUGIN}], upsert=True)
    fid = rid("feature", name.lower())
    pod.records.bulk_create("feature", [{"id": fid, "product_id": product_id, "name": name, "state": "active",
                                         "origin": "team", "stage": "beta", "stage_at": now_iso(),
                                         "owner_user_id": me, "source": PLUGIN, "source_id": fid}], upsert=True)
    return fid, product_id


def early_access_setup_save(ctx: FunctionContext, data: EarlyAccessSetupSaveInput) -> EarlyAccessSetupSaveResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    beta = beta_of(pod, data.beta_id) if data.beta_id else None
    if data.beta_id and not beta:
        return EarlyAccessSetupSaveResult(ok=False, problem="That beta isn't in this Lemma any more.")
    if not beta and not (data.name or "").strip():
        return EarlyAccessSetupSaveResult(ok=False, problem="Name the feature in beta first.")
    slug = (data.slug or "").strip().lower() if data.slug is not None else None
    if slug is not None:
        if not SLUG.match(slug) or slug in RESERVED:
            return EarlyAccessSetupSaveResult(ok=False, problem="The page's address takes lowercase letters, numbers and dashes, and can't be b, p or setup.")
        taken = q(pod, f"SELECT id FROM early_access_beta WHERE slug = {lit(slug)}")
        if taken and (not beta or taken[0]["id"] != beta["id"]):
            return EarlyAccessSetupSaveResult(ok=False, problem=f"Another beta already uses /{slug}. Pick another address.")
    row: dict = {}
    if not beta:
        bid = rid("beta", slug or data.name.strip().lower(), now_iso())
        fid, pid = _feature(pod, data, me)
        row.update({"id": bid, "feature_id": fid, "product_id": pid, "state": "draft", "owner_user_id": me,
                    "slug": slug or _re.sub(r"[^a-z0-9]+", "-", data.name.lower()).strip("-")[:40] or "beta",
                    "questions": QUESTIONS, "flag_tool": "none", "batch_size": 10, "checkin_day": 6, "quiet_days": 7,
                    "posthog_account": "posthog"})
    else:
        bid = beta["id"]
        row["id"] = bid
        if data.feature_id and data.feature_id != beta.get("feature_id"):
            fid, pid = _feature(pod, data, me)
            row.update({"feature_id": fid, "product_id": pid})
    for key in ("name", "intro", "flag_tool", "flag_key", "cohort_id", "cohort_name", "posthog_account_id",
                "posthog_project_id", "posthog_url", "usage_events", "survey_id", "batch_size", "checkin_day", "quiet_days",
                "questions", "page_url", "widget_key", "turned_on"):
        value = getattr(data, key)
        if value is not None:
            row[key] = value
    if slug is not None:
        row["slug"] = slug
    if data.flag_tool and data.flag_tool not in ("posthog", "none", "by_hand"):
        return EarlyAccessSetupSaveResult(ok=False, problem="The flag is PostHog, by hand, or none.")
    if data.state is not None:
        if data.state not in ("draft", "open", "paused", "closed"):
            return EarlyAccessSetupSaveResult(ok=False, problem="A beta is open, paused or closed.")
        row["state"] = data.state
        if data.state == "open" and not (beta or {}).get("opened_at"):
            row["opened_at"] = now_iso()
    for key, low, high in (("batch_size", 1, 200), ("checkin_day", 1, 30), ("quiet_days", 2, 60)):
        if key in row and not (low <= int(row[key]) <= high):
            return EarlyAccessSetupSaveResult(ok=False, problem=f"{key.replace('_', ' ').capitalize()} must be between {low} and {high}.")
    if beta:
        pod.records.bulk_update("early_access_beta", [row])
    else:
        pod.records.bulk_create("early_access_beta", [row], upsert=True)
    beta = beta_of(pod, bid) or row
    # The feature is in beta while the beta runs (Release notes moves it to live).
    if beta.get("feature_id"):
        feat = q(pod, f"SELECT id, stage FROM feature WHERE id = {lit(beta['feature_id'])}")
        if feat and feat[0].get("stage") in ("idea", "planned", "building"):
            pod.records.bulk_update("feature", [{"id": feat[0]["id"], "stage": "beta", "stage_at": now_iso()}])
    page_state = {"open": "open", "paused": "paused"}.get(beta.get("state") or "", "closed")
    pod.records.bulk_create("early_access_page", [{
        "id": rid("page", bid), "beta_id": bid, "slug": beta["slug"], "name": beta["name"], "intro": beta.get("intro"),
        "questions": [{"key": x["key"], "label": x["label"]} for x in (jl(beta.get("questions"), QUESTIONS) or []) if x.get("on", True)],
        "pace": pace_line(beta), "state": page_state}], upsert=True)
    if data.mailbox is not None:
        mine = q(pod, "SELECT id FROM early_access_settings LIMIT 1")
        sid = mine[0]["id"] if mine else rid("settings", me)
        pod.records.bulk_create("early_access_settings", [{"id": sid, "mailbox": data.mailbox or None}], upsert=True)
    count_in_forms(pod, beta)
    return EarlyAccessSetupSaveResult(ok=True, beta_id=bid, slug=beta["slug"], message="Saved.")
