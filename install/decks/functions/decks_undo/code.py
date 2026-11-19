#input_type_name: DecksUndoInput
#output_type_name: DecksUndoResult
#function_name: decks_undo

"""Put an edit back: the cards it rewrote or removed as they were, a card it
added gone, the look as it was.

With `cards` it is a correction too ("Wrong cards?"): the edit is put back,
the person's pick is kept as a correction of "which cards does this request
touch?" (the newest go with every later Decisions call as examples), and the
same request is asked again on exactly those cards.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KEEP = ("title", "outline", "layout", "blocks", "notes", "status", "version", "edit_id")


class DecksUndoInput(BaseModel):
    job_id: str
    # The cards the request should have touched (card ids): undo, then redo on these.
    cards: list[str] | None = None


class DecksUndoResult(BaseModel):
    undone: bool
    redo_job_id: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def decks_undo(ctx: FunctionContext, data: DecksUndoInput) -> DecksUndoResult:
    pod = ctx.pod
    job = pod.table("decks_job").get(data.job_id)
    if job.get("kind") != "edit" or job.get("state") not in ("done", "failed"):
        return DecksUndoResult(undone=False, message="Only a finished edit can be put back.")
    deck = pod.table("decks_deck").get(job["deck_id"])
    before = job.get("before") if isinstance(job.get("before"), dict) else {}
    cards = {c["id"]: c for c in _rows(pod.query(f"SELECT * FROM decks_card WHERE deck_id = {_sql(deck['id'])}"))}

    if "look" in before:
        pod.table("decks_deck").update(deck["id"], {"look": before.get("look"), "voice": before.get("voice")})
    added = [i for i in before.get("added") or [] if i in cards]
    if added:
        pod.records.bulk_delete("decks_card", added)
    restore_new, restore_old = [], []
    for old in before.get("cards") or []:
        row = {k: old.get(k) for k in KEEP}
        row["id"] = old["id"]
        if old["id"] in cards:
            restore_old.append(row)
        else:
            restore_new.append(dict(row, deck_id=deck["id"], position=old.get("position") or 1))
    if restore_old:
        pod.records.bulk_update("decks_card", restore_old)
    if restore_new:
        pod.records.bulk_create("decks_card", restore_new, upsert=True)
    positions = before.get("positions") if isinstance(before.get("positions"), dict) else {}
    if positions:
        now = {c["id"]: c for c in _rows(pod.query(f"SELECT id, position FROM decks_card WHERE deck_id = {_sql(deck['id'])}"))}
        ordered = sorted(now.values(), key=lambda c: (positions.get(c["id"], 10_000), c["position"]))
        moves = [{"id": c["id"], "position": i} for i, c in enumerate(ordered, start=1) if c["position"] != i]
        if moves:
            pod.records.bulk_update("decks_card", moves)
    pod.table("decks_job").update(data.job_id, {"state": "undone"})

    if data.cards is None:
        return DecksUndoResult(undone=True, message="Put back as it was.")

    chosen = [c for c in data.cards if c in cards or c in {o["id"] for o in before.get("cards") or []}]
    redo = pod.records.create("decks_job", {
        "deck_id": deck["id"], "kind": "edit", "state": "wanted", "request": job.get("request"),
        "action": job.get("action") if job.get("action") in ("rewrite", "add", "remove") else "rewrite",
        # The answer it corrects and what it was shown, so the plan keeps the correction.
        "cards": job.get("cards") or [], "evidence": job.get("evidence"), "chosen": chosen,
    })
    return DecksUndoResult(undone=True, redo_job_id=str(redo.get("id")),
                           message="Put back, and asked again on the cards you picked.")
