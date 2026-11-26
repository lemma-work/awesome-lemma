#input_type_name: EarlyAccessDraftInput
#output_type_name: EarlyAccessDraftResult
#function_name: early_access_draft

"""One note to one tester, in two steps around the early-access-writer agent
(the early-access-draft workflow), run as the person whose mailbox it goes
from: the app's press (invites, a Not now note) or their own hourly sweep
(the day-6 check-in, the one chase).

    invite   "You're in": what they said at sign-up, in their words, and how
             to start
    checkin  a short check-in with the link to the check-in page
    chase    the one note to someone let in who hasn't used it or said
             anything; never a second (one id per tester, and chased_at)
    not_now  why not this round, and what would change it

`start` (the app, the sweep): one early-access-draft run per tester, its
form submitted at once, so the run never waits on a person.
`brief` gathers the person, their sign-up answers, the beta, the link, the
member's voice from Mail (`mail_settings.voice`) and the team's brand voice
when Brand kit has one; skips a note already drafted. `save` keeps the
agent's text as a Mail `draft` (kind new, from the member's chosen mailbox,
`built_from` {plugin: early-access, tester_id, beta_id, kind}) and points the
tester at it. Nothing here sends: a person presses Send.
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

KINDS = ("invite", "checkin", "chase", "not_now")
COLUMN = {"invite": "invite_draft_id", "checkin": "checkin_draft_id", "chase": "chase_draft_id", "not_now": "not_now_draft_id"}
SUBJECT = {"invite": "You're in: {name}", "checkin": "How is {name} going?", "chase": "{name}: did it work for you?",
           "not_now": "About the {name} beta"}
VOICE_FALLBACK = "Plain and brief, the way a busy person writes to someone they respect: no exclamation marks, no filler."


class EarlyAccessDraftInput(BaseModel):
    mode: str = "brief"  # start | brief | save
    tester_id: str | None = None
    tester_ids: list[str] | None = None
    kind: str = "invite"
    written: dict | None = None


class EarlyAccessDraftResult(BaseModel):
    skip: bool = False
    brief: dict | None = None
    draft_id: str | None = None
    started: int = 0
    message: str = ""



def checkin_link(beta: dict, t: dict) -> str | None:
    url = beta.get("page_url") or ""
    m = _re.match(r"^(https?://[^/?#]+)", url)
    if not m or not t.get("ref"):
        return None
    key = _re.search(r"[?&]k=([A-Za-z0-9_-]+)", url)
    return f"{m.group(1)}/{beta['slug']}/check-in?ref={t['ref']}" + (f"&k={key.group(1)}" if key else "")


def _mailbox(pod) -> dict | None:
    try:
        mine = q(pod, "SELECT mailbox FROM early_access_settings LIMIT 1")
        boxes = q(pod, "SELECT id, provider, email, account_id FROM mail_mailbox ORDER BY connected_at LIMIT 10")
    except Exception:  # noqa: BLE001 - Mail not set up for this person
        return None
    want = mine[0].get("mailbox") if mine else None
    return next((b for b in boxes if b["id"] == want), None) or next((b for b in boxes if b.get("account_id") != "sample"), None) or (boxes[0] if boxes else None)


def early_access_draft(ctx: FunctionContext, data: EarlyAccessDraftInput) -> EarlyAccessDraftResult:
    pod = ctx.pod
    me = str(ctx.user_id)
    if data.kind not in KINDS:
        return EarlyAccessDraftResult(skip=True, message="Not a note Early access writes.")
    if data.mode == "start":
        n = start_drafts(pod, data.kind, data.tester_ids or ([data.tester_id] if data.tester_id else []))
        return EarlyAccessDraftResult(started=n, message=f"Writing {n} {'note' if n == 1 else 'notes'}.")
    t = tester_of(pod, data.tester_id)
    if not t:
        return EarlyAccessDraftResult(skip=True, message="No such tester.")
    beta = beta_of(pod, t["beta_id"]) or {}
    did = rid("draft", data.kind, t["id"])
    if data.kind == "chase" and t.get("chased_at"):
        return EarlyAccessDraftResult(skip=True, message="They've had their one note already.")
    existing = q(pod, f"SELECT id, state FROM draft WHERE id = {lit(did)}")
    if existing and existing[0].get("state") not in ("discarded", "failed"):
        return EarlyAccessDraftResult(skip=True, draft_id=did, message="Already drafted.")

    if data.mode == "brief":
        voice = VOICE_FALLBACK
        try:
            got = q(pod, "SELECT voice FROM mail_settings LIMIT 1")
            voice = (got[0].get("voice") if got else None) or VOICE_FALLBACK
        except Exception:  # noqa: BLE001 - Mail not set up: plain voice
            pass
        brand = None
        try:
            got = q(pod, "SELECT voice FROM brand WHERE state IN ('check', 'ready') ORDER BY is_default DESC LIMIT 1")
            brand = got[0].get("voice") if got else None
        except Exception:  # noqa: BLE001 - no Brand kit
            pass
        a = jl(t.get("answers"), {}) or {}
        said = [{"at": e.get("at"), "source": e.get("source"), "quote": e.get("quote")}
                for e in (jl(t.get("timeline"), []) or []) if e.get("quote")][-4:]
        brief = {"kind": data.kind, "to": {"name": t.get("name"), "first_name": first_name(t.get("name"), t.get("handle")),
                                            "company": t.get("company_name"), "role": t.get("role")},
                 "beta": {"name": beta.get("name"), "intro": beta.get("intro"), "flag": beta.get("flag_tool") or "none"},
                 "signed_up_said": {k: a.get(k) for k in ("use_for", "today") if a.get(k)},
                 "said_since": said, "uses_7d": t.get("uses_7d"), "last_used_at": t.get("last_used_at"),
                 "days_in": int(days_since(t.get("invited_at")) or 0) if t.get("invited_at") else None,
                 "checkin_link": checkin_link(beta, t) if data.kind in ("checkin", "chase") else None,
                 "fit_reason": t.get("fit_reason") if data.kind == "not_now" else None,
                 "voice": clip(voice, 3000), "brand_voice": clip(brand, 1000) if brand else None}
        return EarlyAccessDraftResult(brief=brief, message=f"Writing to {brief['to']['first_name']}.")

    written = data.written or {}
    if isinstance(written.get("answer"), dict):
        written = written["answer"]
    body = str(written.get("body") or "").strip()
    if not body or written.get("skip"):
        return EarlyAccessDraftResult(skip=True, message=written.get("skip_reason") or "The writer wrote nothing.")
    link = checkin_link(beta, t)
    if data.kind == "checkin" and link and link not in body:
        body = body.rstrip() + "\n\n" + link
    box = _mailbox(pod)
    subject = clip(written.get("subject") or SUBJECT[data.kind].format(name=beta.get("name") or "the beta"), 200)
    pod.records.bulk_create("draft", [{
        "id": did, "source": "mail", "source_account": box["id"] if box else "", "kind": "new",
        "to_handles": [t["handle"]], "subject": subject, "body": body, "original_body": body, "state": "proposed",
        "rationale": clip(written.get("rationale") or f"{data.kind.replace('_', ' ').capitalize()} for {beta.get('name')}", 800),
        "built_from": {"plugin": PLUGIN, "tester_id": t["id"], "beta_id": beta.get("id"), "kind": data.kind,
                       "used": [clip(u, 80) for u in (written.get("used") or [])][:4]},
    }], upsert=True)
    what = {"invite": "Invite drafted", "checkin": "Check-in drafted", "chase": "One note drafted", "not_now": "Not-now note drafted"}[data.kind]
    pod.records.bulk_update("early_access_tester", [{"id": t["id"], COLUMN[data.kind]: did,
                                                     "timeline": add_event(t, what + (" in your mailbox" if box else ""), ai=True)}])
    return EarlyAccessDraftResult(draft_id=did, message=what + ("." if box else "; connect a mailbox in Mail to send it."))
