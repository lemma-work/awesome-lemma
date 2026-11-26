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
