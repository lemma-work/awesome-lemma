#input_type_name: PeopleCompanyContextInput
#output_type_name: PeopleCompanyContextResult
#function_name: people_company_context

"""What the look-up needs about one company: its name and domains, and who on
the team knows whom there (names and titles only).

Only what the whole team may see goes in, because the look-up is kept on the
company, which the whole team sees: never a subject line or a word of anyone's
mail. Marks the company `research_state = writing` so a second press does not
start a second run.
"""

from __future__ import annotations

from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class PeopleCompanyContextInput(BaseModel):
    company_id: str


class PeopleCompanyContextResult(BaseModel):
    company: dict
    domains: list[str]
    people: list[dict]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def people_company_context(ctx: FunctionContext, data: PeopleCompanyContextInput) -> PeopleCompanyContextResult:
    pod = ctx.pod
    cid = data.company_id
    pod.table("people_company").update(cid, {"research_state": "writing", "research_error": None})
    company = (_rows(pod.query(
        f"SELECT id, name, domain, description, website FROM company WHERE id = {_sql(cid)}")) or [{}])[0]
    domains = [r["domain"] for r in _rows(pod.query(
        f"SELECT domain FROM company_domain WHERE company_id = {_sql(cid)} ORDER BY domain"))]
    people = {}
    for r in _rows(pod.query(
            "SELECT handle, name, title FROM people_link "
            f"WHERE company_id = {_sql(cid)} ORDER BY last_contact_at DESC NULLS LAST LIMIT 40")):
        people.setdefault(r["handle"], {"name": r.get("name"), "title": r.get("title")})
    return PeopleCompanyContextResult(company=company, domains=domains, people=list(people.values())[:8])
