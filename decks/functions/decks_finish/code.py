#input_type_name: DecksFinishInput
#output_type_name: DecksFinishResult
#function_name: decks_finish

"""The last step of `decks-work`: close the job and say what was done.

- outline: done when the deck is waiting for approval; otherwise failed.
- cards: the deck is `ready` when every card is written (a card the writer
  failed on is left `failed` with its outline, for "Write it again").
- edit: one line on which cards changed, for the person.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class DecksFinishInput(BaseModel):
    job_id: str


class DecksFinishResult(BaseModel):
    state: str
    summary: str | None = None


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _list(positions: list[int]) -> str:
    words = [f"{p}" for p in sorted(positions)]
    if not words:
        return ""
    if len(words) == 1:
        return f"card {words[0]}"
    return "cards " + ", ".join(words[:-1]) + " and " + words[-1]


def decks_finish(ctx: FunctionContext, data: DecksFinishInput) -> DecksFinishResult:
    pod = ctx.pod
    now = datetime.now(timezone.utc).isoformat()
    job = pod.table("decks_job").get(data.job_id)
    if job.get("state") not in ("working",):
        # Already settled in the plan (ask, done, failed): nothing to close.
        return DecksFinishResult(state=str(job.get("state")), summary=job.get("summary"))
    deck = pod.table("decks_deck").get(job["deck_id"])
    cards = _rows(pod.query(f"SELECT id, position, status, edit_id, version FROM decks_card WHERE deck_id = {_sql(deck['id'])} ORDER BY position"))
    kind = job.get("kind")

    if kind == "outline":
        if deck.get("status") == "outline_ready" and cards:
            state, summary = "done", job.get("summary") or f"Outline ready: {len(cards)} cards."
        else:
            state, summary = "failed", None
            if deck.get("status") == "outlining":
                pod.table("decks_deck").update(deck["id"], {"status": "failed", "error": "The outline wasn't written. Try again."})
        pod.table("decks_job").update(data.job_id, {"state": state, "summary": summary, "finished_at": now,
                                                    "error": None if state == "done" else "The outline wasn't written."})
        return DecksFinishResult(state=state, summary=summary)

    if kind == "cards":
        ready = [c for c in cards if c.get("status") == "ready"]
        failed = [c for c in cards if c.get("status") == "failed"]
        stuck = [c for c in cards if c.get("status") in ("writing", "outline")]
        if stuck:
            pod.records.bulk_update("decks_card", [{"id": c["id"], "status": "failed"} for c in stuck])
            failed += stuck
        if ready:
            summary = f"Wrote {len(ready)} of {len(cards)} cards." + (f" {_list([c['position'] for c in failed]).capitalize()} couldn't be written; write it again from the deck." if failed else "")
            pod.table("decks_deck").update(deck["id"], {"status": "ready", "ready_at": now, "error": None})
            pod.table("decks_job").update(data.job_id, {"state": "done", "summary": summary, "finished_at": now})
            return DecksFinishResult(state="done", summary=summary)
        pod.table("decks_deck").update(deck["id"], {"status": "failed", "error": "No card could be written. Try again."})
        pod.table("decks_job").update(data.job_id, {"state": "failed", "finished_at": now, "error": "No card could be written."})
        return DecksFinishResult(state="failed")

    # an edit
    changed = [c for c in cards if c.get("edit_id") == data.job_id]
    stuck = [c for c in cards if c.get("status") == "writing"]
    if stuck:
        pod.records.bulk_update("decks_card", [{"id": c["id"], "status": "ready" if c.get("version") else "failed"} for c in stuck])
    summary = job.get("summary")
    if not summary:
        action = job.get("action")
        positions = [c["position"] for c in changed]
        if action == "add" and positions:
            summary = f"Added {_list(positions)}. Nothing else changed."
        elif positions:
            summary = f"Rewrote {_list(positions)}. Nothing else changed."
        else:
            summary = "Nothing changed."
    pod.table("decks_job").update(data.job_id, {"state": "done", "summary": summary, "finished_at": now})
    return DecksFinishResult(state="done", summary=summary)
