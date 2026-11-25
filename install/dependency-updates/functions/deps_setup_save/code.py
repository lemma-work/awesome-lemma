#input_type_name: DepsSetupSaveInput
#output_type_name: DepsSetupSaveResult
#function_name: deps_setup_save

"""Dependency updates' set-up, saved: the repositories to watch, the day and
time of the weekly batch, the wait, and commands a person confirmed.

Whoever saves it first is the owner: their "decide" items go to Today, and
the schedules the app makes run as them. Saving again keeps the owner.
Writes the memory block (deps_memory) and the owner's items in Today.

It never makes schedules: no function grant holds `schedule.create`, so the
app makes them as the person (deps-weekly-<repo>, deps-security-<repo>,
deps-alert-<repo>, deps-github-*, deps-comment) and keeps their ids here.
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


class DepsSetupSaveInput(BaseModel):
    # [{repo: "owner/name", github_repo_id, default_branch}]; null keeps them.
    repos: list[dict] | None = None
    # Each left out keeps what is saved (Monday 06:00, 3 and 14 days, hold on a first save).
    weekday: str | None = None
    run_time: str | None = None
    timezone: str | None = None
    wait_days: int | None = None
    wait_major_days: int | None = None
    hold_install_scripts: bool | None = None
    # Commands a person confirmed: [{repo, install_cmd, test_cmd, build_cmd}].
    commands: list[dict] = []
    # Look around with the sample week instead (deps_sample_data runs next).
    sample: bool = False


class DepsSetupSaveResult(BaseModel):
    settings_id: str
    repos: list[str]
    owner: str | None
    memory: str
    message: str


def deps_setup_save(ctx: FunctionContext, data: DepsSetupSaveInput) -> DepsSetupSaveResult:
    pod = ctx.pod
    old = settings_of(pod)
    me = str(ctx.user_id) if ctx.user_id else None
    owner_id = old.get("owner_user_id") or me
    owner_name = old.get("owner_name") if old.get("owner_user_id") else who(ctx)
    first = not old.get("setup_done_at")
    run_time = data.run_time if _re.match(r"^([01]\d|2[0-3]):[0-5]\d$", data.run_time or "") else (
        old.get("run_time") if not first else "06:00")
    weekday = data.weekday if data.weekday in WEEKDAYS else (old["weekday"] if not first else "mon")
    wait = data.wait_days if data.wait_days is not None else (old["wait_days"] if not first else 3)
    wait_major = data.wait_major_days if data.wait_major_days is not None else (old["wait_major_days"] if not first else 14)
    hold = data.hold_install_scripts if data.hold_install_scripts is not None else old["hold_install_scripts"]
    row = {
        "id": old.get("id") or SETTINGS_ID, "owner_user_id": owner_id, "owner_name": cut(owner_name, 200),
        "weekday": weekday, "run_time": run_time,
        "timezone": cut(data.timezone or old.get("timezone") or "UTC", 64),
        "wait_days": max(0, min(60, int(wait))), "wait_major_days": max(0, min(120, int(wait_major))),
        "hold_install_scripts": bool(hold),
        "setup_done_at": old.get("setup_done_at") or now_iso(),
    }
    if not old.get("id"):
        row["alerts"] = "osv"
        row["platform"] = {}
    pod.records.bulk_create("deps_settings", [row], upsert=True)

    names: list[str] = []
    if data.repos is not None:
        have = {str(r["repo"]).lower(): r for r in q(pod, "SELECT id, repo, active FROM deps_repo LIMIT 500")}
        keep = set()
        for r in data.repos:
            repo = str((r or {}).get("repo") or "").strip().strip("/")
            if not _re.match(r"^[\w.-]+/[\w.-]+$", repo):
                continue
            keep.add(repo.lower())
            names.append(repo)
            patch = {"active": True}
            if r.get("github_repo_id"):
                patch["github_repo_id"] = int(r["github_repo_id"])
            if r.get("default_branch"):
                patch["default_branch"] = cut(r["default_branch"], 200)
            if repo.lower() in have:
                pod.records.update("deps_repo", have[repo.lower()]["id"], patch)
            else:
                pod.records.create("deps_repo", dict(patch, repo=repo, status="new"))
        off = [{"id": r["id"], "active": False} for key, r in have.items() if key not in keep and r.get("active")]
        if off:
            pod.records.bulk_update("deps_repo", off)
    for c in data.commands or []:
        repo = str((c or {}).get("repo") or "")
        found = q(pod, f"SELECT id FROM deps_repo WHERE LOWER(repo) = {lit(repo.lower())} LIMIT 1")
        if not found:
            continue
        patch = {key: cut(c.get(key), 400) for key in ("install_cmd", "test_cmd", "build_cmd") if c.get(key) is not None}
        patch.update(status="ok", commands_confirmed_by=cut(who(ctx), 200), status_note=None)
        pod.records.update("deps_repo", found[0]["id"], patch)

    try:
        memory = as_dict(as_dict(pod.functions.run("deps_memory", {})).get("output_data")).get("message") or "done"
    except Exception as exc:  # noqa: BLE001 - set-up goes on without it
        memory = f"Could not write the memory block: {type(exc).__name__}"
    try:
        write_needs(pod, ctx, settings_of(pod))
    except Exception:  # noqa: BLE001
        pass
    if data.sample:
        message = "Saved. Load the sample week with deps_sample_data."
    elif names:
        message = f"Watching {len(names)} repositor{'y' if len(names) == 1 else 'ies'}; the first run finds each one's commands."
    else:
        message = "Saved."
    return DepsSetupSaveResult(settings_id=row["id"], repos=names, owner=owner_name, memory=memory, message=message)
