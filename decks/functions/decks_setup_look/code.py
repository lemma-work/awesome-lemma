#input_type_name: DecksSetupLookInput
#output_type_name: DecksSetupLookResult
#function_name: decks_setup_look

"""Set-up, step 1: the look a person's new decks take.

brand: the Lemma's brand, read from the shared `brand` table each time a deck
is made or worked on (never copied here). theme: one of Deck maker's themes.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class DecksSetupLookInput(BaseModel):
    source: str = "theme"
    theme_id: str | None = None


class DecksSetupLookResult(BaseModel):
    look_source: str
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def decks_setup_look(ctx: FunctionContext, data: DecksSetupLookInput) -> DecksSetupLookResult:
    pod = ctx.pod
    row = {"look_source": "brand" if data.source == "brand" else "theme", "theme_id": data.theme_id or None, "setup_step": "first"}
    mine = next(iter(_rows(pod.query("SELECT id FROM decks_settings ORDER BY created_at LIMIT 1"))), None)
    if mine:
        pod.table("decks_settings").update(mine["id"], row)
    else:
        pod.records.create("decks_settings", dict(row, display_name=(ctx.user_email or "").split("@")[0] or None))
    return DecksSetupLookResult(look_source=row["look_source"],
                                message="New decks take the team's brand." if row["look_source"] == "brand" else "New decks take the theme you picked.")
