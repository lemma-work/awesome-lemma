#input_type_name: LeadsSetupPrepareInput
#output_type_name: LeadsSetupPrepareResult
#function_name: leads_setup_prepare

"""Set-up: what to offer. People map's relationship kinds with how many of the
person's people are each (customer, investor and partner on; candidate and
vendor offered; colleague and other never), the companies of their own
customers as example chips for "who fits you", the team's description of a
good fit when someone already wrote it (it is one per Lemma; they may change
it), and anything they answered before (a set-up run again keeps it)."""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

KINDS = [
    ("customer", "Customers", "People who buy from you, might buy, or are being onboarded or renewed.", True, False),
    ("investor", "Investors", "Funds, angels and board members.", True, False),
    ("partner", "Partners", "Agencies, advisors, introducers and anyone you work with rather than sell to.", True, False),
    ("candidate", "Candidates", "People you might hire.", False, False),
    ("vendor", "Vendors", "People who sell to you or provide a service you pay for.", False, False),
    ("colleague", "Colleagues", "Your own team. Never looked up.", False, True),
    ("other", "Other", "Friends, family, press, strangers. Never looked up.", False, True),
]
DEFAULT_KINDS = [k for k, _, _, on, _ in KINDS if on]


class LeadsSetupPrepareInput(BaseModel):
    pass


class LeadsSetupPrepareResult(BaseModel):
    kinds: list[dict]
    profile_by: str | None = None
    team_profile: bool = False
    kinds_on: list[str]
    suggestions: list[dict]
    fit_sentence: str | None = None
    fit_examples: list[str] = []
    daily_limit: int = 10
    people: int
    people_setup: str | None = None


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def leads_setup_prepare(ctx: FunctionContext, data: LeadsSetupPrepareInput) -> LeadsSetupPrepareResult:
    pod = ctx.pod
    settings = (_rows(pod.query(
        "SELECT fit_sentence, fit_examples, kinds, daily_limit FROM leads_settings ORDER BY created_at LIMIT 1")) or [{}])[0]
    team = (_rows(pod.query(
        "SELECT fit_sentence, fit_examples, set_by_name FROM leads_profile WHERE fit_sentence IS NOT NULL LIMIT 1")) or [{}])[0]
    try:
        people_setup = (_rows(pod.query(
            "SELECT setup_step FROM people_settings ORDER BY created_at LIMIT 1")) or [{}])[0].get("setup_step")
    except Exception:  # noqa: BLE001 - People map not set up for them yet
        people_setup = None
    counts = {r["kind"]: int(r["n"]) for r in _rows(pod.query(
        "SELECT kind, COUNT(*) AS n FROM people_person WHERE in_scope IS TRUE AND deal_with IS TRUE "
        "AND kind IS NOT NULL GROUP BY kind"))}
    kinds = [{"key": k, "label": label, "sentence": sentence, "count": counts.get(k, 0), "on": on, "never": never}
             for k, label, sentence, on, never in KINDS]
    chosen = [k for k in (settings.get("kinds") or DEFAULT_KINDS) if k in dict((x[0], 1) for x in KINDS)]
    suggestions = _rows(pod.query(
        "SELECT c.name, c.domain, COUNT(*) AS people FROM people_person pp JOIN company c ON c.id = pp.company_id "
        "WHERE pp.in_scope IS TRUE AND pp.deal_with IS TRUE AND pp.kind = 'customer' "
        "GROUP BY c.name, c.domain ORDER BY COUNT(*) DESC, c.name LIMIT 8"))
    return LeadsSetupPrepareResult(
        kinds=kinds, kinds_on=chosen,
        suggestions=[{"name": s.get("name"), "domain": s.get("domain")} for s in suggestions],
        fit_sentence=team.get("fit_sentence") or settings.get("fit_sentence"),
        fit_examples=list(team.get("fit_examples") or settings.get("fit_examples") or []),
        profile_by=team.get("set_by_name") if team.get("fit_sentence") else None,
        team_profile=bool(team.get("fit_sentence")),
        daily_limit=int(settings.get("daily_limit") or 10),
        people=sum(counts.get(k, 0) for k in chosen), people_setup=people_setup,
    )
