#input_type_name: MailSetupReportInput
#output_type_name: MailSetupReportResult
#function_name: mail_setup_report

"""What the first read found, shaped for the set-up agent.

  writing      the owner's own words to real people: the raw material for
               their voice (previews are too short for a voice)
  people       who they write to and hear from most, by reciprocity
  domains      where their conversations come from, with sample subjects: the
               raw material for categories like Investors or Customers
  bulk         who sends them the most bulk mail
  categories   the categories they already have
  totals       counts for the screen
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel


class MailSetupReportInput(BaseModel):
    samples: int = 14


class MailSetupReportResult(BaseModel):
    me: dict
    totals: dict
    writing: list[dict]
    people: list[dict]
    domains: list[dict]
    bulk: list[dict]
    categories: list[dict]


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _yours(document: str) -> list[str]:
    """The sections of a conversation document the owner wrote ('## You …')."""
    out = []
    for block in re.split(r"\n(?=## )", document):
        if block.startswith("## You"):
            body = block.split("\n", 1)[1] if "\n" in block else ""
            body = "\n".join(l for l in body.splitlines() if not l.startswith("*To:")).strip()
            if len(body) > 40:
                out.append(body[:900])
    return out


def mail_setup_report(ctx: FunctionContext, data: MailSetupReportInput) -> MailSetupReportResult:
    pod = ctx.pod
    q = lambda sql: _rows(pod.query(sql))  # noqa: E731
    with ThreadPoolExecutor(max_workers=8) as pool:
        settings_job = pool.submit(q, "SELECT display_name, my_domains, timezone FROM mail_settings LIMIT 1")
        mail_job = pool.submit(q, "SELECT email, provider FROM mail_mailbox")
        totals_job = pool.submit(q,
            "SELECT COUNT(*) AS conversations, COUNT(*) FILTER (WHERE kind = 'people') AS with_people, "
            "COUNT(*) FILTER (WHERE kind = 'broadcast') AS broadcast, "
            "COUNT(DISTINCT counterpart_handle) FILTER (WHERE kind = 'people') AS people FROM conversation "
            "WHERE source = 'mail'")
        people_job = pool.submit(q,
            "SELECT h.handle AS email, p.name, p.org, p.conversation_count, p.inbound_count, p.outbound_count, "
            "p.weight, p.last_inbound_at, p.last_outbound_at FROM person p "
            "JOIN person_handle h ON h.person_id = p.id AND h.kind = 'email' ORDER BY p.weight DESC LIMIT 25")
        domains_job = pool.submit(q,
            "SELECT SPLIT_PART(counterpart_handle, '@', 2) AS domain, COUNT(*) AS conversations, "
            "LEFT(STRING_AGG(subject, ' | ' ORDER BY last_message_at DESC), 300) AS subjects "
            "FROM conversation WHERE source = 'mail' AND kind = 'people' AND counterpart_handle IS NOT NULL "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 40")
        bulk_job = pool.submit(q,
            "SELECT c.counterpart_handle AS sender, MAX(c.counterpart_name) AS name, MAX(t.provider_category) AS category, "
            "COUNT(*) AS conversations, LEFT(STRING_AGG(c.subject, ' | ' ORDER BY c.last_message_at DESC), 160) AS subjects "
            "FROM conversation c LEFT JOIN mail_thread t ON t.id = c.id WHERE c.source = 'mail' AND c.kind = 'broadcast' "
            "GROUP BY c.counterpart_handle ORDER BY 4 DESC LIMIT 25")
        writing_job = pool.submit(q,
            "SELECT id, subject, counterpart_handle, document_path FROM conversation WHERE source = 'mail' AND kind = 'people' "
            "AND document_path IS NOT NULL AND last_outbound_at IS NOT NULL "
            f"ORDER BY last_outbound_at DESC LIMIT {max(4, min(data.samples, 24))}")
        category_job = pool.submit(q, "SELECT key, name, sentence FROM mail_category WHERE state = 'active' ORDER BY position")
        settings = (settings_job.result() or [{}])[0]
        mailboxes = mail_job.result()
        totals = (totals_job.result() or [{}])[0]
        people = people_job.result()
        domains = domains_job.result()
        bulk = bulk_job.result()
        sample_rows = writing_job.result()
        categories = category_job.result()

        def read(row: dict) -> dict | None:
            try:
                text = pod.files.download(row["document_path"]).decode("utf-8", "replace")
            except Exception:  # noqa: BLE001
                return None
            yours = _yours(text)
            if not yours:
                return None
            return {"to": row.get("counterpart_handle"), "subject": row.get("subject"), "you_wrote": yours[-2:]}

        writing = [w for w in pool.map(read, sample_rows) if w]

    mine = {m["email"].lower() for m in mailboxes}
    own = {d.lower() for d in (settings.get("my_domains") or [])}
    return MailSetupReportResult(
        me={"name": settings.get("display_name"), "addresses": sorted(mine), "own_domains": sorted(own),
            "timezone": settings.get("timezone")},
        totals={k: int(v or 0) for k, v in totals.items()},
        writing=writing,
        people=[p for p in people if (p.get("email") or "").lower() not in mine],
        domains=[d for d in domains if d.get("domain") and d["domain"] not in own],
        bulk=bulk,
        categories=categories,
    )
