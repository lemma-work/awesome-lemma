#input_type_name: DecksSetupDoneInput
#output_type_name: DecksSetupDoneResult
#function_name: decks_setup_done

"""Set-up, last step: the person is set up, and Decks opens (on their first
deck's outline when they wrote a sentence, on the sample when they chose it).
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class DecksSetupDoneInput(BaseModel):
    deck_id: str | None = None


class DecksSetupDoneResult(BaseModel):
    deck_id: str | None = None
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def decks_setup_done(ctx: FunctionContext, data: DecksSetupDoneInput) -> DecksSetupDoneResult:
    pod = ctx.pod
    mine = next(iter(_rows(pod.query("SELECT id FROM decks_settings ORDER BY created_at LIMIT 1"))), None)
    if mine:
        pod.table("decks_settings").update(mine["id"], {"setup_step": "done"})
    else:
        pod.records.create("decks_settings", {"setup_step": "done", "look_source": "theme"})
    return DecksSetupDoneResult(deck_id=data.deck_id, message="Set up.")
