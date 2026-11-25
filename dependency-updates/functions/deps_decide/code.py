#input_type_name: DepsDecideInput
#output_type_name: DepsDecideResult
#function_name: deps_decide

"""A person's decision on an update, from the app's buttons, Today or chat.

  monday        add it to the next weekly batch (a major: with the fix, if
                the Lemma can make it)
  own           its own pull request: the app then starts that run
  not_yet       skip this version; the next one asks again
  let_through   a release held as risky joins like any other
  take_now      one still waiting out the wait joins the next batch
  ignore        leave the package out for a range (version_range, reason;
                all_repos for every repository)
  drop          take it out of its open pull request: the app then starts a
                comment run that removes its commit
  put_back      put a dropped update back: the app starts that run too
  stop_ignoring id is an ignore's id: it goes, and what it covered comes back
  ask           id is a pull request's (deps_batch) id: `text` goes on its
                timeline as asked from the app; the app starts the run

It settles the owner's item in Today when the owner decides; anyone else's
decision is settled there on the owner's next run or open of the app (the
item is the owner's own row).
"""

from __future__ import annotations

from lemma_sdk import FunctionContext
from pydantic import BaseModel

# deps:common
# Shared by every Dependency updates function, word for word: bin/common.py
# copies it in. Edit it there, never here.
import json as _json
import re as _re
import uuid as _uuid
from datetime import datetime as _datetime, timedelta as _timedelta, timezone as _tz

DEPS_NS = _uuid.UUID("863c73f9-b46d-41f0-a465-489177755eb8")
SETTINGS_ID = str(_uuid.uuid5(DEPS_NS, "settings"))
PLUGIN = "dependency-updates"
APP = "dependencies"
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ECOSYSTEMS = ("npm", "pypi", "actions")
STATES = ("waiting", "ready", "needs_you", "risky", "in_batch", "opened", "merged", "dropped", "by_hand",
          "ignored", "superseded")
# Still to happen: what an ignore, a newer version or a person's choice may change.
OPEN_STATES = ("waiting", "ready", "needs_you", "risky", "dropped", "by_hand")
PLATFORM_KEYS = ("repository_schedule", "workflows", "alerts", "alert_trigger", "checks")
REPO_STATUSES = ("new", "needs_confirm", "ok", "private_registry", "cant_install", "unsupported")


def update_id(repo: str, ecosystem: str, package: str, to_version: str) -> str:
    """One candidate update: the same row however often a run finds it."""
    return str(_uuid.uuid5(DEPS_NS, f"{repo.lower()}|{ecosystem}|{package}|{clean_version(to_version)}"))


def batch_id(repo: str, branch: str) -> str:
    return str(_uuid.uuid5(DEPS_NS, f"{repo.lower()}|{branch}"))


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


def now_iso() -> str:
    return _datetime.now(_tz.utc).isoformat()


def cut(value, n: int):
    """Text held to a column's length; None stays None."""
    if value is None:
        return None
    text = str(value).strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "\u2026"


def jlist(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip().startswith("["):
        try:
            got = _json.loads(value)
            return got if isinstance(got, list) else []
        except ValueError:
            return []
    return []


def jobj(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip().startswith("{"):
        try:
            got = _json.loads(value)
            return got if isinstance(got, dict) else {}
        except ValueError:
            return {}
    return {}


def stamp(value):
    if not value:
        return None
    try:
        moment = _datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=_tz.utc)


def who(ctx) -> str:
    """The person a run is for, as their name."""
    return (getattr(ctx, "user_name", None) or (getattr(ctx, "user_email", None) or "").split("@")[0]
            or "Someone")


def settings_of(pod) -> dict:
    found = q(pod, f"SELECT * FROM deps_settings WHERE id = {lit(SETTINGS_ID)}") or q(
        pod, "SELECT * FROM deps_settings ORDER BY created_at LIMIT 1")
    s = dict(found[0]) if found else {}
    s["weekday"] = s.get("weekday") if s.get("weekday") in WEEKDAYS else "mon"
    s["run_time"] = s.get("run_time") or "06:00"
    s["timezone"] = s.get("timezone") or "UTC"
    s["wait_days"] = int(s.get("wait_days") if s.get("wait_days") is not None else 3)
    s["wait_major_days"] = int(s.get("wait_major_days") if s.get("wait_major_days") is not None else 14)
    s["hold_install_scripts"] = s.get("hold_install_scripts") is not False
    s["platform"] = jobj(s.get("platform"))
    s["schedule_ids"] = jobj(s.get("schedule_ids"))
    return s


def clean_version(value) -> str:
    """'v4', '^5.2.0', '==2.9.0' -> '4', '5.2.0', '2.9.0'."""
    text = str(value or "").strip()
    text = _re.sub(r"^(?:[=v^~<>! ]+)", "", text)
    return text


def parts(value) -> tuple:
    """A version's leading numbers: '3.25.76' -> (3, 25, 76); 'v5' -> (5,)."""
    out = []
    for piece in clean_version(value).split("."):
        m = _re.match(r"\d+", piece)
        if not m:
            break
        out.append(int(m.group(0)))
    return tuple(out)


def bump_of(from_version, to_version) -> str:
    """major, minor or patch: the first number that moved. 0.118 -> 0.121 is a minor."""
    a, b = parts(from_version), parts(to_version)
    if not a or not b:
        return "minor"
    for i in range(max(len(a), len(b))):
        x = a[i] if i < len(a) else 0
        y = b[i] if i < len(b) else 0
        if x != y:
            return "major" if i == 0 else ("minor" if i == 1 else "patch")
    return "patch"


def newer(a, b) -> bool:
    """a is a later version than b."""
    pa, pb = parts(a), parts(b)
    n = max(len(pa), len(pb))
    return pa + (0,) * (n - len(pa)) > pb + (0,) * (n - len(pb))


def in_range(update: dict, version_range) -> bool:
    """An ignore's range against an update: 'all', 'patches', 'minors',
    '19.x' (a major), '3.25.x', or an exact version."""
    rng = str(version_range or "").strip().lower()
    to = clean_version(update.get("to_version"))
    if rng in ("", "all", "*"):
        return True
    if rng in ("patch", "patches"):
        return (update.get("bump") or bump_of(update.get("from_version"), to)) == "patch"
    if rng in ("minor", "minors"):
        return (update.get("bump") or bump_of(update.get("from_version"), to)) in ("minor", "patch")
    if rng.endswith(".x") or rng.endswith(".*"):
        want = parts(rng[:-2])
        return bool(want) and parts(to)[: len(want)] == want
    return clean_version(rng) == to


def ignore_for(ignores: list, update: dict):
    """The ignore that covers this update, or None."""
    for ig in ignores:
        if (ig.get("package") or "") != (update.get("package") or ""):
            continue
        if ig.get("repo") and str(ig["repo"]).lower() != str(update.get("repo") or "").lower():
            continue
        if in_range(update, ig.get("version_range")):
            return ig
    return None


def major_of(version) -> str:
    p = parts(version)
    return str(p[0]) if p else clean_version(version)


def risk_words(risk: dict) -> str:
    """Why a release is held as risky, in a few words."""
    risk = jobj(risk)
    if risk.get("install_script"):
        return "adds an install script"
    if risk.get("new_publisher"):
        return "comes from a new publisher"
    if risk.get("age_hours") is not None and float(risk.get("age_hours") or 0) < 24:
        return "is hours old"
    return "looks risky"


def needs_items(pod, s: dict) -> list:
    """What Dependency updates asks of its owner, as needs_you items: one
    "decide" per held major and per risky release."""
    items = []
    for u in q(pod, "SELECT id, repo, package, from_version, to_version, bump, state, why, risk, updated_at FROM deps_update "
                    "WHERE state IN ('needs_you', 'risky') ORDER BY created_at LIMIT 200"):
        short = str(u.get("repo") or "").split("/")[-1]
        if u["state"] == "needs_you":
            title = f"{u['package']} {major_of(u['to_version'])}: add to Monday, its own PR, or not yet?"
            weight = 2
        else:
            title = f"{u['package']} {clean_version(u['to_version'])} {risk_words(u.get('risk'))}: let it through?"
            weight = 3
        items.append({
            "verb": "decide", "title": cut(title, 300),
            "why": cut(f"{short} \u00b7 {u.get('why') or (str(u.get('from_version') or '') + ' to ' + str(u['to_version']))}", 300),
            "source_table": "deps_update", "source_id": u["id"],
            "source_version": f"{u['state']}:{clean_version(u['to_version'])}",
            "app": APP, "path": f"/u/{u['id']}", "weight": weight,
        })
    return items


def write_needs(pod, ctx, s: dict):
    """The owner's items in Today, written only by the owner's own runs:
    needs_you is each member's own (RLS). Anyone else's run leaves them to
    the owner's next run or the owner's next open of the app."""
    me = str(getattr(ctx, "user_id", None) or "")
    owner = str(s.get("owner_user_id") or "")
    if not me or not owner or me != owner:
        return None
    return needs_you_write(pod, PLUGIN, me, needs_items(pod, s), None)
# end deps:common

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

ACTIONS = ("monday", "own", "not_yet", "let_through", "take_now", "ignore", "drop", "put_back", "stop_ignoring", "ask")


class DepsDecideInput(BaseModel):
    id: str
    action: str
    version_range: str | None = None
    reason: str | None = None
    all_repos: bool = False
    text: str | None = None


class DepsDecideResult(BaseModel):
    ok: bool
    state: str | None = None
    # What the app should start next, as the person: {kind: own|comment, repo, text}.
    start: dict | None = None
    message: str


def _append_step(pod, batch: dict, kind: str, text: str) -> None:
    steps = [x for x in jlist(batch.get("steps")) if isinstance(x, dict)]
    steps.append({"at": now_iso(), "kind": kind, "text": cut(text, 600), "ok": True})
    pod.records.update("deps_batch", batch["id"], {"steps": steps[-200:]})


def _waited(u: dict, s: dict) -> bool:
    released = stamp(u.get("released_at"))
    if not released:
        return True
    days = s["wait_major_days"] if u.get("bump") == "major" else s["wait_days"]
    return (_datetime.now(_tz.utc) - released) >= _timedelta(days=days)


def deps_decide(ctx: FunctionContext, data: DepsDecideInput) -> DepsDecideResult:
    pod = ctx.pod
    s = settings_of(pod)
    name = who(ctx)
    action = (data.action or "").strip().lower()
    if action not in ACTIONS:
        return DepsDecideResult(ok=False, message=f"'{data.action}' is not one of {', '.join(ACTIONS)}.")

    if action == "stop_ignoring":
        ig = (q(pod, f"SELECT * FROM deps_ignore WHERE id = {lit(data.id)}") or [None])[0]
        if not ig:
            return DepsDecideResult(ok=False, message="That ignore is gone already.")
        pod.records.delete("deps_ignore", ig["id"])
        rest = q(pod, f"SELECT * FROM deps_ignore WHERE id <> {lit(ig['id'])} LIMIT 2000")
        back = []
        for u in q(pod, f"SELECT * FROM deps_update WHERE state = 'ignored' AND package = {lit(ig['package'])} LIMIT 500"):
            if ig.get("repo") and str(ig["repo"]).lower() != str(u.get("repo") or "").lower():
                continue
            if not ignore_for(rest, u):
                back.append({"id": u["id"], "state": "waiting", "why": f"No longer ignored, by {name}", "choice": None,
                             "decided_by": name, "decided_at": now_iso()})
        if back:
            pod.records.bulk_update("deps_update", back)
        write_needs(pod, ctx, s)
        return DepsDecideResult(ok=True, message=f"Stopped ignoring {ig['package']} {ig['version_range']}"
                                + (f"; {len(back)} back to waiting." if back else "."))

    if action == "ask":
        batch = (q(pod, f"SELECT * FROM deps_batch WHERE id = {lit(data.id)}") or [None])[0]
        text = (data.text or "").strip()
        if not batch or not text:
            return DepsDecideResult(ok=False, message="Say what to do, on a pull request the Lemma opened.")
        _append_step(pod, batch, "comment", f"{name} asked from the app: {text}")
        return DepsDecideResult(ok=True, state=batch.get("state"), start={"kind": "comment", "repo": batch["repo"], "text": text,
                                "pr_number": batch.get("pr_number"), "batch_id": batch["id"]}, message="Asked the Lemma.")

    u = (q(pod, f"SELECT * FROM deps_update WHERE id = {lit(data.id)}") or [None])[0]
    if not u:
        return DepsDecideResult(ok=False, message="That update is gone; the next run may have found a newer version.")
    label = f"{u['package']} {clean_version(u['to_version'])}"
    patch: dict = {"choice": action, "decided_by": name, "decided_at": now_iso()}
    start = None

    if action in ("monday", "take_now"):
        if u["state"] not in OPEN_STATES:
            return DepsDecideResult(ok=False, state=u["state"], message=f"{label} is {u['state'].replace('_', ' ')} already.")
        patch["state"] = "ready"
        patch["why"] = (f"Added to the next batch by {name}" + (", with the fix if the Lemma can make it" if u.get("bump") == "major" else "")
                        if action == "monday" else f"Taken before the wait ends, by {name}")
        message = f"{label} joins the next batch."
    elif action == "own":
        if u["state"] not in OPEN_STATES:
            return DepsDecideResult(ok=False, state=u["state"], message=f"{label} is {u['state'].replace('_', ' ')} already.")
        patch["state"] = "ready"
        patch["why"] = f"Its own pull request, asked by {name}"
        start = {"kind": "own", "repo": u["repo"], "update_id": u["id"],
                 "text": f"Open its own pull request for {u['package']} {u.get('from_version') or ''} -> {clean_version(u['to_version'])}."}
        message = f"Opening {label} as its own pull request."
    elif action == "let_through":
        if u["state"] != "risky":
            return DepsDecideResult(ok=False, state=u["state"], message=f"{label} isn't held as risky.")
        risk = jobj(u.get("risk"))
        risk["let_through_by"] = name
        patch["risk"] = risk
        patch["state"] = "ready" if _waited(u, s) else "waiting"
        patch["why"] = f"Let through by {name}"
        message = f"{label} is let through" + (": it joins the next batch." if patch["state"] == "ready" else ", after the wait.")
    elif action in ("not_yet", "ignore"):
        if action == "not_yet":
            rng, reason = clean_version(u["to_version"]), (data.reason or "Not yet")
        else:
            rng = (data.version_range or "").strip() or (f"{major_of(u['to_version'])}.x" if u.get("bump") == "major" else clean_version(u["to_version"]))
            reason = (data.reason or "").strip() or None
        pod.records.create("deps_ignore", {"repo": None if data.all_repos else u["repo"], "package": u["package"],
                                           "version_range": cut(rng, 64), "reason": cut(reason, 300), "by_kind": "person",
                                           "by_name": name})
        patch["state"] = "ignored"
        patch["why"] = cut(f"{'Not yet' if action == 'not_yet' else 'Ignored'}: {rng}" + (f" ({reason})" if reason and action == "ignore" else "") + f", by {name}", 300)
        # Everything else the new ignore covers goes too.
        others = []
        ig = {"repo": None if data.all_repos else u["repo"], "package": u["package"], "version_range": rng}
        for o in q(pod, f"SELECT * FROM deps_update WHERE package = {lit(u['package'])} AND id <> {lit(u['id'])} "
                        f"AND state IN ({lits(OPEN_STATES)}) LIMIT 200"):
            if not jobj(o.get("security")) and ignore_for([ig], o):
                others.append({"id": o["id"], "state": "ignored", "why": patch["why"]})
        if others:
            pod.records.bulk_update("deps_update", others)
        message = f"{label}: not this version." if action == "not_yet" else f"Ignoring {u['package']} {rng}."
    elif action == "drop":
        if u["state"] not in ("in_batch", "opened"):
            return DepsDecideResult(ok=False, state=u["state"], message=f"{label} isn't in an open pull request.")
        batch = (q(pod, f"SELECT * FROM deps_batch WHERE id = {lit(u.get('batch_id'))}") or [None])[0]
        if not batch:
            return DepsDecideResult(ok=False, message=f"Couldn't find {label}'s pull request.")
        text = f"drop {u['package']}" + (f": {data.reason}" if data.reason else "")
        _append_step(pod, batch, "comment", f"{name} asked from the app: {text}")
        patch = {"choice": "drop", "decided_by": name, "decided_at": now_iso()}
        start = {"kind": "comment", "repo": u["repo"], "text": text, "pr_number": batch.get("pr_number"), "batch_id": batch["id"]}
        message = f"Asked the Lemma to drop {u['package']}."
    else:  # put_back
        if u["state"] != "dropped":
            return DepsDecideResult(ok=False, state=u["state"], message=f"{label} wasn't dropped.")
        batch = (q(pod, f"SELECT * FROM deps_batch WHERE id = {lit(u.get('batch_id'))}") or [None])[0]
        if batch and batch.get("state") == "open":
            text = f"put {u['package']} back"
            _append_step(pod, batch, "comment", f"{name} asked from the app: {text}")
            start = {"kind": "comment", "repo": u["repo"], "text": text, "pr_number": batch.get("pr_number"), "batch_id": batch["id"]}
            message = f"Asked the Lemma to put {u['package']} back."
        else:
            patch["state"] = "ready"
            patch["why"] = f"Put back by {name}: joins the next batch"
            message = f"{label} joins the next batch."

    pod.records.update("deps_update", u["id"], patch)
    write_needs(pod, ctx, s)
    return DepsDecideResult(ok=True, state=patch.get("state") or u["state"], start=start, message=message)
