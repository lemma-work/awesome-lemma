#input_type_name: EarlyAccessTakeOutInput
#output_type_name: EarlyAccessTakeOutResult
#function_name: early_access_take_out

"""Take one tester out of a beta (the drawer's press, as the person): out of
the flag's static cohort when they were put in it, status `left` with the
reason, and their Public status row says Not this time. Their words stay.
`fit` instead: a member's own fit call (kept as an example for the next
read), with no other change.
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

# early-access:posthog
# PostHog over its own MCP server (the pod connector `posthog`, catalog `mcp`):
# one CLI-style `exec` command per call, as Triage and Factory call it.
# PostHog refuses a command over about 1,000 characters, so HogQL over many
# people is sent in batches. Reads need a key with read scopes; adding to a
# cohort needs cohort:write.
MAX_COMMAND = 960


class PostHogProblem(Exception):
    """What PostHog or the connection said, kept short; `kind` says which."""

    def __init__(self, kind: str, text: str):
        super().__init__(text)
        self.kind = kind  # not_connected, no_scope, no_person, refused


def _ph_kind(text: str) -> str:
    low = text.lower()
    if "missing the required scope" in low or "scope" in low and "write" in low:
        return "no_scope"
    if any(s in low for s in ("not connected", "no shared account", "none is shared", "shared account", "needs_account", "reauth", "connector.use",
                              "not found: connector", "no such connector", "404")):
        return "not_connected"
    return "refused"


def ph_exec(pod, beta: dict, command: str, why: str):
    """Run one exec command; the first line of PostHog's answer as JSON when it is, else the text."""
    if len(command) > MAX_COMMAND + 60:
        raise PostHogProblem("refused", "The PostHog command is too long.")
    payload = {"command": command, "context": f"Early access: {why}"}
    slug = beta.get("posthog_account") or "posthog"
    try:
        if beta.get("posthog_account_id"):
            got = as_dict(pod.connectors.execute(slug, "exec", payload, account_id=beta["posthog_account_id"]))
        else:
            got = as_dict(pod.connectors.execute(slug, "exec", payload))
    except Exception as exc:  # noqa: BLE001 - said in words by the caller
        text = f"{getattr(exc, 'message', None) or exc}"
        raise PostHogProblem(_ph_kind(text), clip(text, 300)) from exc
    result = got.get("result", got)
    text = result.get("text") if isinstance(result, dict) else result
    if not isinstance(text, str):
        return result
    head = text.split("\n", 1)[0].strip()
    try:
        return _json.loads(head)
    except ValueError:
        return text


def ph_call(pod, beta: dict, tool: str, args: dict, why: str, confirm: bool = False):
    # Runs in the connection's active project (PostHog's MCP default project).
    flag = " --confirm" if confirm else ""
    return ph_exec(pod, beta, f"call --json{flag} {tool} " + _json.dumps(args, separators=(",", ":")), why)


def ph_rows(answer) -> list:
    """execute-sql answers "results": "col|col\\nv|v"; as dicts."""
    text = answer.get("results") if isinstance(answer, dict) else None
    if isinstance(text, list):
        return [r for r in text if isinstance(r, dict)]
    if not isinstance(text, str):
        return []
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if not lines:
        return []
    head = lines[0].split("|")
    out = []
    for ln in lines[1:]:
        vals = ln.split("|")
        out.append({k: (None if v in ("", "(null)") else v) for k, v in zip(head, vals)})
    return out


def _hq(value) -> str:
    return "'" + str(value).replace("\\", "").replace("'", "") + "'"


def usage_by_email(pod, beta: dict, emails: list) -> dict:
    """{email: {uses_7d, first, last}} from HogQL: the flag answered true for them, or
    one of the beta's own events (or a page under its URL), last 90 days."""
    events = jl(beta.get("usage_events"), []) or []
    names = [e for e in events if isinstance(e, str) and e.strip()]
    url = next((e.get("url") for e in events if isinstance(e, dict) and e.get("url")), None)
    used = []
    if beta.get("flag_key"):
        used.append(f"(event = '$feature_flag_called' AND properties.$feature_flag = {_hq(beta['flag_key'])} "
                    "AND toString(properties.$feature_flag_response) = 'true')")
    if names:
        used.append("event IN (" + ",".join(_hq(n) for n in names[:8]) + ")")
    if url:
        used.append(f"(event = '$pageview' AND properties.$current_url LIKE {_hq('%' + url + '%')})")
    if not used:
        return {}
    head = ("SELECT lower(toString(person.properties.email)) AS e, countIf(timestamp > now() - INTERVAL 7 DAY) AS n7, "
            "min(timestamp) AS f, max(timestamp) AS l FROM events WHERE timestamp > now() - INTERVAL 90 DAY AND ("
            + " OR ".join(used) + ") AND e IN (")
    out, batch = {}, []

    def run(batch):
        sql = head + ",".join(_hq(e) for e in batch) + ") GROUP BY e LIMIT 500"
        for r in ph_rows(ph_call(pod, beta, "execute-sql", {"query": sql}, "reading who used the beta")):
            if r.get("e"):
                out[str(r["e"]).lower()] = {"uses_7d": int(float(r.get("n7") or 0)), "first": r.get("f"), "last": r.get("l")}

    for email in sorted({str(e).lower() for e in emails if e}):
        trial = batch + [email]
        size = len(head) + sum(len(x) + 3 for x in trial) + 90
        if batch and size > MAX_COMMAND:
            run(batch)
            batch = [email]
        else:
            batch = trial
    if batch:
        run(batch)
    return out


def person_by_email(pod, beta: dict, email: str):
    """PostHog's person UUID for an email, or None when PostHog doesn't know them yet."""
    answer = ph_call(pod, beta, "persons-list", {"email": email, "limit": 1}, "finding a tester in PostHog")
    found = (answer.get("results") or []) if isinstance(answer, dict) else []
    first = found[0] if found and isinstance(found[0], dict) else None
    return (first.get("uuid") or first.get("id")) if first else None


def cohort_add(pod, beta: dict, person_ids: list) -> None:
    """Add people to the flag's static cohort (PATCH .../add_persons_to_static_cohort/,
    body {"person_ids": [uuid]}; needs cohort:write). Not run against PostHog yet."""
    ph_call(pod, beta, "cohorts-add-persons-to-static-cohort-partial-update",
            {"id": int(beta["cohort_id"]), "person_ids": person_ids[:100]}, "letting testers into the beta", confirm=True)


def cohort_remove(pod, beta: dict, person_id: str) -> None:
    ph_call(pod, beta, "cohorts-rm-person-from-static-cohort-partial-update",
            {"id": int(beta["cohort_id"]), "person_id": person_id}, "taking a tester out of the beta", confirm=True)
# end early-access:posthog


class EarlyAccessTakeOutInput(BaseModel):
    tester_id: str
    reason: str | None = None
    fit: str | None = None  # strong | maybe | not_now: a member's call, nothing else changes
    flag_on: bool | None = None  # a by-hand flag ticked on


class EarlyAccessTakeOutResult(BaseModel):
    ok: bool
    message: str = ""


def early_access_take_out(ctx: FunctionContext, data: EarlyAccessTakeOutInput) -> EarlyAccessTakeOutResult:
    pod = ctx.pod
    t = tester_of(pod, data.tester_id)
    if not t:
        return EarlyAccessTakeOutResult(ok=False, message="No such tester.")
    beta = beta_of(pod, t["beta_id"]) or {}
    if data.fit:
        if data.fit not in ("strong", "maybe", "not_now"):
            return EarlyAccessTakeOutResult(ok=False, message="Fit is strong, maybe or not now.")
        label = data.fit.replace("_", " ")
        pod.records.bulk_update("early_access_tester", [{"id": t["id"], "fit": data.fit, "fit_by": "person", "fit_at": now_iso(),
                                                         "timeline": add_event(t, f"Fit set to {label} by hand")}])
        return EarlyAccessTakeOutResult(ok=True, message=f"Fit set to {label}.")
    if data.flag_on is not None:
        pod.records.bulk_update("early_access_tester", [{"id": t["id"], "flag_state": "on" if data.flag_on else "by_hand",
                                                         "timeline": add_event(t, "Flag ticked on by hand" if data.flag_on else "Flag tick taken off")}])
        return EarlyAccessTakeOutResult(ok=True, message="Ticked." if data.flag_on else "Unticked.")
    note = None
    if beta.get("flag_tool") == "posthog" and t.get("posthog_person_id") and beta.get("cohort_id") and t.get("flag_state") == "on":
        try:
            cohort_remove(pod, beta, t["posthog_person_id"])
        except PostHogProblem:
            note = "PostHog didn't take them out of the cohort; remove them there."
    reason = clip(data.reason, 400) or None
    pod.records.bulk_update("early_access_tester", [{"id": t["id"], "status": "left", "left_reason": reason,
                                                     "flag_state": "failed" if note else ("none" if t.get("flag_state") == "on" else t.get("flag_state")),
                                                     "flag_note": note,
                                                     "timeline": add_event(t, "Taken out of the beta" + (f": {reason}" if reason else ""))}])
    set_status(pod, t.get("ref"), beta, "not_now", "This beta has ended for you. Thank you for trying it.")
    return EarlyAccessTakeOutResult(ok=True, message=note or "Taken out of the beta.")
