# forms:hand
# The owner's side, run only as the owner (their own schedules, their own
# app): their conversation about an answer, their person, and what Today
# shows them. A run can write only its own rows in the per-person tables,
# which is why each member has their own schedules. Shared word for word:
# bin/common.py copies it in from bin/shared/hand.py. Edit it there.


def conversation_id(member: str, answer: str) -> str:
    return fid("conversation", member, answer)


def message_id(member: str, answer: str, direction: str, key: str = "1") -> str:
    return fid("message", member, answer, direction, key)


def draft_id_for(member: str, answer: str) -> str:
    return fid("draft", member, answer)


def find_person(pod, me: str, handle_kind: str, handle: str, name, org) -> str | None:
    """The owner's person for this handle, made (with its handle) when new: Mail's ids, so the two meet."""
    if not handle:
        return None
    kind = handle_kind or "email"
    found = q(pod, f"SELECT person_id FROM person_handle WHERE kind = {lit(kind)} AND LOWER(handle) = {lit(handle.lower())} LIMIT 1")
    if found:
        return str(found[0]["person_id"])
    person = str(_uuid.uuid5(PERSON_NS, f"{me}:{kind}:{handle.lower()}"))
    pod.records.bulk_create("person", [{k: v for k, v in {"id": person, "name": clip(name, 200) or None, "org": clip(org, 200) or None,
                                                          "first_seen_at": now_iso()}.items() if v is not None}], upsert=True)
    pod.records.bulk_create("person_handle", [{"id": str(_uuid.uuid5(PERSON_NS, f"{person}:{kind}:{handle.lower()}")), "person_id": person,
                                               "kind": kind, "handle": handle.lower(), "display_name": clip(name, 200) or None}], upsert=True)
    return person


def my_mailbox(pod) -> dict | None:
    """The owner's own mailbox to draft in: a live one first, never the sample's for a real answer."""
    try:
        boxes = q(pod, "SELECT id, provider, account_id, email, state FROM mail_mailbox ORDER BY connected_at LIMIT 20")
    except Exception:  # noqa: BLE001
        return None
    real = [b for b in boxes if b.get("account_id") != "sample"]
    real.sort(key=lambda b: 0 if b.get("state") == "live" else 1)
    return real[0] if real else None


def my_items(pod, me: str) -> list:
    """What in Forms needs this member now: replies owed, and where-should-this-go picks."""
    found = q(pod, "SELECT a.*, f.name AS form_name FROM form_answer a LEFT JOIN form f ON f.id = a.form_id "
                   f"WHERE a.owner_user_id = {lit(me)} AND a.state IN ('unsure', 'routed', 'drafted') "
                   "AND COALESCE(a.routed_to, 'forms') <> 'triage' ORDER BY a.received_at LIMIT 500")
    drafts = {}
    ids = [str(r["draft_id"]) for r in found if r.get("draft_id")]
    if ids:
        try:
            drafts = {str(d["id"]): d for d in q(pod, f"SELECT id, body, state FROM draft WHERE id IN ({lits(ids)})")}
        except Exception:  # noqa: BLE001
            drafts = {}
    items = []
    for r in found:
        who = r.get("name") or r.get("handle") or "Someone"
        form = r.get("form_name") or "a form"
        version = f"{r.get('state')}:{r.get('draft_state')}:{r.get('hand_version')}"
        base = {"source_table": "form_answer", "source_id": str(r["id"]), "source_version": version, "app": APP, "path": f"/a/{r['id']}",
                "person_name": clip(who, 200), "person_handle": r.get("handle"), "since_at": iso(r.get("received_at")),
                "quote": clip(r.get("message"), 600) or None, "weight": 1.0}
        if r.get("state") == "unsure":
            items.append(dict(base, verb="decide", title=clip(f"Where should {first_name(who)}'s answer go?", 300),
                              why=clip(f"{form}: the Lemma isn't sure what it is", 300)))
            continue
        d = drafts.get(str(r.get("draft_id") or ""))
        item = dict(base, verb="answer", title=clip(f"{who} · {form}", 300),
                    why=clip(r.get("owner_why") or f"Came in through {form}", 300),
                    conversation_id=conversation_id(me, str(r["id"])) if r.get("taken_at") else None)
        if d and d.get("state") in ("proposed", "approved", "failed"):
            item.update(prepared="Reply drafted in your mailbox", prepared_text=clip(d.get("body"), 2000))
        elif r.get("draft_state") == "no_mailbox":
            item.update(why=clip("Connect your mail to have replies drafted", 300))
        elif r.get("draft_state") in ("wanted", "writing"):
            item.update(prepared="Drafting a reply…")
        items.append(item)
    return items


# contract:needs-you
# end contract


def refresh_mine(pod, ctx) -> dict:
    """Write this member's Forms items in Today, and close the rest. Runs as them."""
    me = str(ctx.user_id) if getattr(ctx, "user_id", None) else None
    if not me:
        return {}
    try:
        return needs_you_write(pod, APP, me, my_items(pod, me))
    except Exception as exc:  # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"[:300]}


def close_conversation(pod, me: str, answer: str) -> None:
    cid = conversation_id(me, answer)
    try:
        if q(pod, f"SELECT id FROM conversation WHERE id = {lit(cid)}"):
            pod.table("conversation").update(cid, {"state": "done", "ask": None})
    except Exception:  # noqa: BLE001
        pass
# end forms:hand
