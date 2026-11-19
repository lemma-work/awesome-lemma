#input_type_name: PeopleSetupApplyInput
#output_type_name: PeopleSetupApplyResult
#function_name: people_setup_apply

"""Set-up: keep the two answers, the categories that count and the owner's
own domains, before the first read finds the people."""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NEVER_COUNTED = {"updates", "newsletters", "cold"}


class PeopleSetupApplyInput(BaseModel):
    categories: list[str] = []
    own_domains: list[str] = []


class PeopleSetupApplyResult(BaseModel):
    categories: list[str]
    own_domains: list[str]
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def people_setup_apply(ctx: FunctionContext, data: PeopleSetupApplyInput) -> PeopleSetupApplyResult:
    pod = ctx.pod
    known = {r["key"] for r in _rows(pod.query("SELECT key FROM mail_category"))}
    categories = [k for k in dict.fromkeys(data.categories) if k in known and k not in NEVER_COUNTED]
    domains = []
    for d in data.own_domains:
        d = str(d).strip().lower().removeprefix("@").removeprefix("www.")
        if d and "." in d and " " not in d and d not in domains:
            domains.append(d[:253])
    settings = (_rows(pod.query("SELECT id FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    values = {"categories": categories, "own_domains": domains, "setup_step": "finding"}
    if settings.get("id"):
        pod.table("people_settings").update(settings["id"], values)
    else:
        pod.records.bulk_create("people_settings", [values])
    return PeopleSetupApplyResult(categories=categories, own_domains=domains,
                                  message=f"Counting {len(categories)} categories; {len(domains)} domain(s) are yours.")
