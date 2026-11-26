#input_type_name: MailSampleDataInput
#output_type_name: MailSampleDataResult
#function_name: mail_sample_data

"""A made-up mailbox, so Mail can be seen working, and tested, without anyone's
real mail.

`load` adds a mailbox whose account is `sample` and writes its thirty-six
conversations (a month of a small company founder's mail: investors,
customers, candidates, a board member, services, newsletters and pitches,
every address at a reserved `.example` domain) as a fixture beside it. Nothing
is sorted yet: the first read (`mail_sync`) reads the fixture exactly as it
reads Gmail, writing conversations, messages and documents, and the sort and
the writer then run on them as on real mail. The sample mailbox has no
account, so nothing can ever be sent from it.

`load` also makes the sample's people (a person and an email handle each,
with the ids Mail's people refresh would give them) unless they are already
there, and marks every row it made in `mail_sample_row`. Another plugin's
sample (Meetings') has the same made-up people; whoever loads first makes
them, and the other finds them.

`clear` removes every row the sample made, and the files. A person the sample
made goes only when every handle they have is one the sample made and nothing
else in the Lemma refers to them: no meeting has them on it, and no promise,
conversation, message or draft from anything but the sample names them. One
who stays keeps their handles, with Mail's counts for them set back to none.
Nothing is chosen by an address's domain. When the sample is the person's only
mailbox, it also removes their Mail settings, categories, rules, corrections
and activity, since all of those were learned from made-up mail; with a real
mailbox connected, those are theirs and stay.

Ids come from the caller, so two people can each load their own sample, and
loading twice changes nothing.
"""

from __future__ import annotations

import json
import time as wall
import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Any

from lemma_sdk import FunctionContext
from pydantic import BaseModel

NS = uuid.UUID("9c4f7f0e-1b2a-4d55-8f0c-6a3e2d1b7c90")
SAMPLE_ROOT = "/mail-sample"
SAMPLE_ACCOUNT = "sample"
MAIL_TABLES_FULL = ("mail_correction", "mail_rule", "mail_category", "mail_activity", "mail_settings", "mail_sample_row")
# The ids Mail's people refresh (mail_people) and Meetings give a person and
# a handle, so a person the sample makes is the one either would have made.
PERSON_NS = uuid.UUID("3f8a1c52-7d0e-4b61-9c2a-5e4f7a9b0d13")
FREEMAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "live.com", "me.com"}


class MailSampleDataInput(BaseModel):
    mode: str = "load"


class MailSampleDataResult(BaseModel):
    mode: str
    mailbox_id: str | None = None
    conversations: int
    messages: int
    removed: int
    removed_files: int
    message: str


def _rows(response: Any) -> list[dict]:
    payload = response.to_dict() if hasattr(response, "to_dict") else response
    return [r for r in (payload or {}).get("items", []) if isinstance(r, dict)]


def _sql(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def _in(values) -> str:
    return ", ".join(_sql(v) for v in values) or "NULL"


# key, subject, (name, email), provider category, cc, messages as
# (days ago, hour, from_owner, text). The owner's own lines are written in one
# consistent voice (short, warm, "Cheers"), so the set-up has a voice to learn.
CONVERSATIONS: list[tuple] = [
    # Investors
    ("northgate", "Northgate Ventures: next steps on the seed round", ("Mira Okafor", "mira@northgate-vc.example"), "personal", [], [
        (9, 10, True, "Hi Mira,\n\nThanks for the time today. Quick recap: we're raising 1.5M to get to 40 paying teams by summer. Deck attached.\n\nHappy to go deeper on retention whenever suits.\n\nCheers"),
        (2, 16, False, "Thanks, this was a good first look and the partners liked the retention numbers.\n\nCould you share the data room and the last three months of revenue by Thursday? We'd like to bring it to Monday's partner meeting.\n\nMira Okafor\nPartner, Northgate Ventures"),
    ]),
    ("harbor", "Intro: Harbor Lane Capital", ("Tomás Reyes", "tomas@harborlane.example"), "personal", [], [
        (6, 9, False, "Hi,\n\nLucia Romano suggested we talk: she said you're raising a seed round for a tool that keeps customer mail and promises in one place. I lead seed at Harbor Lane and we back B2B tools. Happy to hear more.\n\nTomás Reyes\nHarbor Lane Capital"),
        (5, 11, True, "Hi Tomás,\n\nGood to meet you, and thanks to Lucia. Would a 30-minute call next week work?\n\nCheers"),
        (4, 15, False, "Good to meet you too. Happy to chat. I'll send over a few times for next week by tomorrow.\n\nTomás"),
    ]),
    ("investor-update", "October update: 31 paying teams, first enterprise pilot", ("Mira Okafor", "mira@northgate-vc.example"), "personal", ["aisha@quill-partners.example", "eleanor@parkhill.example"], [
        (12, 8, True, "Hi all,\n\nQuick October update.\n\nWins: 31 paying teams (up from 24), first enterprise pilot signed, churn at zero for the third month.\nAsks: intros to ops leads at logistics companies.\n\nNo need to reply. Full numbers in the doc.\n\nCheers"),
    ]),
    ("quill", "Quill Partners: before the term sheet", ("Aisha Bello", "aisha@quill-partners.example"), "personal", [], [
        (8, 14, True, "Hi Aisha,\n\nGreat speaking yesterday. Anything else you need from us before your committee?\n\nCheers"),
        (3, 12, False, "Thanks! Before we send the term sheet we need two things: the current cap table and confirmation on the size of the option pool.\n\nOnce we have those I'll have the draft term sheet to you by Friday.\n\nAisha"),
    ]),
    # Customers
    ("brightwave", "Renewal for 40 seats", ("Daniel Kowalski", "daniel@brightwave-health.example"), "personal", [], [
        (20, 11, True, "Hi Daniel,\n\nHeads up that your annual plan renews on the 30th. Anything you'd like to change?\n\nCheers"),
        (1, 9, False, "Hi,\n\nWe'd like to renew and go from 32 to 40 seats. Finance asked whether you can do 15% off for a two-year term. Could you send a revised quote by the end of the month?\n\nThanks,\nDaniel Kowalski\nOperations, Brightwave Health"),
    ]),
    ("ferro", "Bug: CSV export drops the last row", ("Lena Fischer", "lena.fischer@ferro-logistics.example"), "personal", [], [
        (4, 10, False, "Hello,\n\nWhen we export the shipments view to CSV the last row is missing. It happens every time with more than 200 rows. Screenshot attached.\n\nLena Fischer\nFerro Logistics"),
        (3, 17, True, "Hi Lena,\n\nThanks for the clear report, we can reproduce it. We'll have a fix out by Wednesday and I'll let you know when it's live.\n\nCheers"),
    ]),
    ("orchard", "Onboarding call next week?", ("Sana Iqbal", "sana@orchard-dental.example"), "personal", [], [
        (2, 13, False, "Hi there,\n\nWe've signed and the team is keen to get started. Could we do the onboarding call Tuesday or Wednesday afternoon next week? Four of us will join.\n\nSana Iqbal\nPractice manager, Orchard Dental"),
    ]),
    ("tidal", "Invoice INV-2207 seat count", ("Marcus Lee", "ap@tidal-foods.example"), "personal", [], [
        (5, 9, False, "Hello,\n\nInvoice INV-2207 lists 12 seats but our contract is for 10. Can you reissue it with the right count? We can't pay it until it matches.\n\nMarcus Lee\nAccounts payable, Tidal Foods"),
    ]),
    ("velo", "Re: Export fix", ("Inès Moreau", "ines@velo-cycles.example"), "personal", [], [
        (7, 15, True, "Hi Inès,\n\nThe export fix is live. Could you try it and tell me if it works on your side?\n\nCheers"),
        (6, 10, False, "Tried it this morning, all working now. Thanks for the quick fix!\n\nInès"),
    ]),
    # People
    ("lunch", "Lunch Thursday?", ("Felix Brandt", "felix@brandt-family.example"), "personal", [], [
        (1, 19, False, "Hey! I'm near your office on Thursday. Free for lunch around 12:30? There's a new ramen place I've been meaning to try.\n\nFelix"),
    ]),
    ("advisor", "Re: pricing page draft", ("Hannah Volkov", "hannah@volkov-advisory.example"), "personal", [], [
        (6, 9, True, "Hi Hannah,\n\nAttached is a first draft of the new pricing page. Would love your eyes on the tiers.\n\nCheers"),
        (4, 18, False, "Looks good overall. Two notes: drop the middle tier, and put the annual price first. Happy to look again.\n\nH"),
        (4, 20, True, "Thanks Hannah, both make sense. I'll revise it and send you v2 tomorrow.\n\nCheers"),
    ]),
    ("vat", "Q3 VAT return", ("Oskar Lind", "oskar@lind-accounting.example"), "personal", [], [
        (3, 11, False, "Hi,\n\nI'll file the Q3 VAT return on the 25th. Please send me the last two bank statements before then, and the receipt for the new laptops.\n\nBest regards,\nOskar Lind\nLind Accounting"),
    ]),
    ("keys", "Spare office keys", ("Ruth Adeyemi", "ruth@parkside-offices.example"), "personal", [], [
        (2, 8, False, "Morning,\n\nThe spare keys for your new desks are at reception. No need to reply, just pick them up whenever.\n\nRuth\nParkside Offices"),
    ]),
    ("podcast", "Guest on Build Notes?", ("Jonas Weber", "jonas@buildnotes.example"), "personal", [], [
        (5, 14, False, "Hi,\n\nI host Build Notes, a podcast about small software companies. I loved your post on pricing and would like to have you on. We record remotely, about 45 minutes. Would any date in the next three weeks work?\n\nJonas Weber"),
    ]),
    ("grace", "Quote for the brand refresh", ("Grace Tan", "grace@studio-tan.example"), "personal", [], [
        (14, 10, True, "Hi Grace,\n\nWe'd like to refresh the logo and the website colours. Could you send a rough quote and timeline?\n\nCheers"),
        (13, 9, False, "Sounds fun. I'll put something together. What's your rough budget?\n\nGrace"),
        (5, 16, True, "Hi Grace, around 6k for both. Does that work for a first phase?\n\nCheers"),
    ]),
    ("rafael", "Intro to the hiring lead at Lumen", ("Rafael Costa", "rafael@costa.example"), "personal", [], [
        (4, 12, True, "Hi Rafael,\n\nCould you introduce me to the hiring lead at Lumen? We're looking at how they run engineering interviews.\n\nCheers"),
        (3, 9, False, "Of course. I'll make the intro this week.\n\nR"),
    ]),
    # VIP (a board member)
    ("board", "Board meeting prep", ("Eleanor Park", "eleanor@parkhill.example"), "personal", [], [
        (10, 9, True, "Hi Eleanor,\n\nDraft agenda for the board meeting attached. Anything you'd like added?\n\nCheers"),
        (1, 8, False, "Thanks. Please send the board pack by Monday 9am, and add a page on the hiring plan: the other directors will ask about the two senior roles.\n\nEleanor"),
    ]),
    # Hiring
    ("yusuf", "Application: Senior Backend Engineer", ("Yusuf Demir", "yusuf.demir@mailbox.example"), "personal", [], [
        (3, 22, False, "Hello,\n\nI'm applying for the Senior Backend Engineer role. I've spent six years on payment systems in Go and Postgres, most recently leading a team of four. My CV is attached.\n\nKind regards,\nYusuf Demir"),
    ]),
    ("chloe", "Following up on my interview", ("Chloé Martin", "chloe.martin@mailbox.example"), "personal", [], [
        (9, 16, True, "Hi Chloé,\n\nThanks for coming in on Tuesday. We'll be in touch about next steps within a week.\n\nCheers"),
        (1, 10, False, "Hi,\n\nJust checking in on next steps after last week's interview. I have another offer to answer by Friday, so it would help to know where things stand.\n\nThanks,\nChloé"),
    ]),
    ("talent", "Re: shortlist for the design role", ("Bea Novak", "bea@talentbridge.example"), "personal", [], [
        (11, 11, True, "Hi Bea,\n\nThanks for the first shortlist. Could you look for people with more product design than brand work?\n\nCheers"),
        (2, 15, False, "Understood. I'll send three more profiles by Friday, all product-focused.\n\nBea Novak\nTalentBridge"),
    ]),
    # Updates (services)
    ("payout", "Your payout of EUR 4,210.00 is on the way", ("Payflow", "payments@payflow.example"), "updates", [], [
        (1, 6, False, "A payout of EUR 4,210.00 is on its way to your bank account ending 4417. It should arrive in 1 to 2 business days."),
    ]),
    ("ci", "[app] CI failed on main", ("Codehost", "notifications@codehost.example"), "updates", [], [
        (0, 7, False, "The workflow 'tests' failed on main for commit 3f2a9c1. 2 tests failed in export_test.go."),
    ]),
    ("receipt", "Your receipt from Cloudinn Hosting", ("Cloudinn Hosting", "billing@cloudinn.example"), "updates", [], [
        (8, 4, False, "Receipt #88213. Amount paid: USD 312.40 for October. Thank you for your business."),
    ]),
    ("signin", "New sign-in to your account", ("Accounts", "security@accounts.example"), "updates", [], [
        (4, 21, False, "We noticed a new sign-in from Chrome on macOS. If this was you, you don't need to do anything."),
    ]),
    ("shipped", "Your order has shipped", ("Deskshop", "orders@deskshop.example"), "updates", [], [
        (6, 13, False, "Good news: your order of 2 standing desks has shipped and will arrive Thursday. Track it here."),
    ]),
    ("weekly-sync", "Updated invitation: Weekly sync", ("Calendar", "calendar-notification@calendar.example"), "updates", [], [
        (2, 9, False, "This event has been updated: Weekly sync, Mondays 10:00 to 10:30. Joining link changed."),
    ]),
    # Newsletters
    ("saasletter", "Five pricing teardowns", ("SaaS Letter", "news@saasletter.example"), "promotions", [], [
        (2, 7, False, "This week: five pricing pages taken apart, two funding rounds, and a hiring report. Read online."),
    ]),
    ("founders-weekly", "The Founder's Weekly #212", ("Founder's Weekly", "hello@foundersweekly.example"), "promotions", [], [
        (6, 7, False, "In this issue: why small teams win at support, a founder's guide to board meetings, and ten tools we tried."),
    ]),
    ("iconkit", "New in the library: 40 icons", ("Iconkit", "updates@iconkit.example"), "promotions", [], [
        (9, 12, False, "We've added 40 new icons to the library, including a full set for finance and travel. Update the plugin to get them."),
    ]),
    ("devconf", "Early bird ends Friday: DevConf 2027", ("DevConf", "events@devconf.example"), "promotions", [], [
        (3, 10, False, "Early bird tickets end this Friday. Save 30% on two days of talks about building software."),
    ]),
    # Cold
    ("leadforge", "Quick question", ("Blake Morgan", "blake@leadforge.example"), "personal", [], [
        (1, 8, False, "Hi there,\n\nCan I get 15 minutes to show you how we 10x outbound pipelines with AI SDRs? Teams like yours book 40 meetings a month.\n\nBlake"),
    ]),
    ("rankrise", "Partnership opportunity", ("Nadia Holt", "nadia@rankrise.example"), "personal", [], [
        (5, 7, False, "Hello,\n\nI came across your blog and would love to propose a link exchange. We have several high-authority sites in your niche.\n\nNadia"),
    ]),
    ("execsearch", "An exciting CTO opportunity", ("Owen Pike", "owen@execsearch.example"), "personal", [], [
        (7, 11, False, "Hi,\n\nI'm working on a CTO search for a well-funded fintech and your background stood out. Open to a confidential chat?\n\nOwen Pike\nExecSearch"),
    ]),
    # Harder to place
    ("lucia-fwd", "Fwd: thoughts?", ("Lucia Romano", "lucia@romano.example"), "personal", [], [
        (2, 21, False, "Saw this and thought of you. thoughts?\n\n---------- Forwarded message ---------\nSubject: The end of the per-seat price\nA long read on why software companies are moving away from charging per seat."),
    ]),
    ("fintech-week", "Speaking at FinTech Week", ("Arjun Mehta", "arjun@fintechweek.example"), "personal", [], [
        (4, 9, False, "Dear founder,\n\nWe're putting together the startup stage for FinTech Week in March and would like to invite you to speak. Speaker packages start at EUR 1,500.\n\nArjun Mehta\nProgramme team"),
    ]),
    ("office-move", "Re: moving the team to the 3rd floor", ("Ruth Adeyemi", "ruth@parkside-offices.example"), "personal", [], [
        (16, 10, True, "Hi Ruth,\n\nCould we move to the larger room on the 3rd floor from next month?\n\nCheers"),
        (15, 12, False, "Yes, that works. I'll confirm the date once the current tenant leaves."),
    ]),
]


def _ids(ctx: FunctionContext):
    who = str(ctx.user_id or ctx.user_email or "someone")
    return lambda key: str(uuid.uuid5(NS, f"{who}:{key}"))


def _messages(me: str, now: datetime) -> list[dict]:
    out = []
    for key, subject, (name, email), category, cc, notes in CONVERSATIONS:
        bulk = category in ("updates", "promotions")
        for index, (days, hour, mine, text) in enumerate(notes):
            stamp = datetime.combine((now - timedelta(days=days)).date(), time(hour, (index * 7) % 60), timezone.utc)
            if stamp > now:
                stamp = now - timedelta(minutes=30 + index)
            newest = index == len(notes) - 1
            out.append({
                "id": f"sample-{key}-{index}",
                "thread": f"sample-{key}",
                "from_email": me if mine else email,
                "from_name": None if mine else name,
                "to": [email] if mine else [me],
                "cc": list(cc),
                "subject": subject if index == 0 else (subject if subject.lower().startswith("re:") else f"Re: {subject}"),
                "sent_at": stamp.isoformat(),
                "snippet": " ".join(text.split())[:300],
                "text": text,
                "labels": (["SENT"] if mine else ["INBOX"]) + ([] if mine else [f"CATEGORY_{category.upper()}"]),
                "category": None if mine else category,
                "bulk": bulk,
                "has_attachments": "attached" in text.lower(),
                "unread": (not mine) and newest and days <= 3,
                "in_inbox": not mine,
                "outbound": mine,
            })
    return out


def _org(email: str) -> str | None:
    domain = email.rsplit("@", 1)[-1]
    if domain in FREEMAIL:
        return None
    label = domain.split(".")[-2] if domain.count(".") >= 1 else domain
    return " ".join(part.capitalize() for part in label.replace("_", "-").split("-"))


def _make_people(ctx: FunctionContext) -> int:
    """The people of the sample's conversations with people, made now and
    marked as the sample's, unless their handle (or person) already exists."""
    pod = ctx.pod
    wanted: dict[str, str] = {}
    for _key, _subject, (name, email), category, _cc, _notes in CONVERSATIONS:
        if category not in ("updates", "promotions"):
            wanted.setdefault(email.lower(), name)
    handles = sorted(wanted)
    found = {r["handle"] for r in _rows(pod.query(
        f"SELECT handle FROM person_handle WHERE kind = 'email' AND handle IN ({_in(handles)})"))}
    ids = {h: str(uuid.uuid5(PERSON_NS, f"{ctx.user_id}:email:{h}")) for h in handles if h not in found}
    have = {r["id"] for r in _rows(pod.query(f"SELECT id FROM person WHERE id IN ({_in(ids.values())})"))} if ids else set()
    people, links, marks = [], [], []
    for handle, pid in ids.items():
        if pid not in have:
            people.append({"id": pid, "name": wanted[handle], "org": _org(handle), "title": None, "is_vip": False,
                           "conversation_count": 0, "inbound_count": 0, "outbound_count": 0, "weight": 0})
            marks.append({"table_name": "person", "row_id": pid})
        hid = str(uuid.uuid5(PERSON_NS, f"{pid}:email:{handle}"))
        links.append({"id": hid, "person_id": pid, "kind": "email", "handle": handle, "display_name": wanted[handle]})
        marks.append({"table_name": "person_handle", "row_id": hid})
    for start in range(0, len(people), 100):
        pod.records.bulk_create("person", people[start : start + 100])
    for start in range(0, len(links), 100):
        pod.records.bulk_create("person_handle", links[start : start + 100])
    for start in range(0, len(marks), 100):
        pod.records.bulk_create("mail_sample_row", marks[start : start + 100])
    return len(people)


def _forget(pod: Any, drop) -> int:
    """Remove the people the sample made, when nothing else knows them."""
    marks = _rows(pod.query("SELECT table_name, row_id FROM mail_sample_row LIMIT 5000"))
    made_people = {str(m["row_id"]) for m in marks if m["table_name"] == "person"}
    made_handles = {str(m["row_id"]) for m in marks if m["table_name"] == "person_handle"}
    if not made_handles and not made_people:
        return 0
    rows = _rows(pod.query(
        f"SELECT id, person_id, kind, handle FROM person_handle WHERE id IN ({_in(made_handles)}) "
        f"OR person_id IN ({_in(made_people)}) LIMIT 5000"))
    candidates = {r["person_id"] for r in rows if r["id"] in made_handles} | made_people
    everyone = _rows(pod.query(
        f"SELECT id, person_id, handle FROM person_handle WHERE person_id IN ({_in(candidates)}) LIMIT 5000")) if candidates else []
    theirs: dict[str, list[dict]] = {}
    for r in everyone:
        theirs.setdefault(r["person_id"], []).append(r)
    handles = sorted({str(r["handle"]).lower() for r in everyone})
    named: set[str] = set()
    in_mail: set[str] = set()
    if handles:
        chunk = _in(handles)
        checks = [
            f"SELECT LOWER(counterpart_handle) AS h FROM conversation WHERE LOWER(counterpart_handle) IN ({chunk})",
            "SELECT DISTINCT LOWER(r.value) AS h FROM conversation c, jsonb_array_elements_text(c.participants::jsonb) AS r(value) "
            f"WHERE LOWER(r.value) IN ({chunk})",
            f"SELECT LOWER(from_handle) AS h FROM message WHERE LOWER(from_handle) IN ({chunk})",
            "SELECT DISTINCT LOWER(r.value) AS h FROM message m, jsonb_array_elements_text(m.to_handles::jsonb) AS r(value) "
            f"WHERE LOWER(r.value) IN ({chunk})",
            f"SELECT LOWER(person_handle) AS h FROM promise WHERE LOWER(person_handle) IN ({chunk})",
            "SELECT DISTINCT LOWER(r.value) AS h FROM draft d, jsonb_array_elements_text(d.to_handles::jsonb) AS r(value) "
            f"WHERE LOWER(r.value) IN ({chunk})",
            "SELECT DISTINCT LOWER(a.value->>'handle') AS h FROM meeting m, jsonb_array_elements(m.attendees::jsonb) AS a(value) "
            f"WHERE LOWER(a.value->>'handle') IN ({chunk})",
        ]
        for index, sql in enumerate(checks):
            # Any check that cannot run counts as "someone may know them".
            try:
                hits = {r["h"] for r in _rows(pod.query(sql)) if r.get("h")}
            except Exception:  # noqa: BLE001
                hits = set(handles)
            named |= hits
            if index < 4:  # conversations and messages: what Mail counts from
                in_mail |= hits
    gone, kept = [], []
    for pid in sorted(candidates):
        own = theirs.get(pid, [])
        only_ours = bool(own) and all(r["id"] in made_handles for r in own)
        if pid in made_people and not own:
            gone.append(pid)
        elif only_ours and not any(str(r["handle"]).lower() in named for r in own):
            gone.append(pid)
        else:
            kept.append(pid)
    removed = 0
    for start in range(0, len(gone), 200):
        chunk = _in(gone[start : start + 200])
        removed += drop("person_handle", f"person_id IN ({chunk})")
        removed += drop("person", f"id IN ({chunk})")
    # Someone else knows the ones who stay. Where no conversation or message
    # names them any more, Mail's counts for them came from the sample's
    # messages, which are gone.
    stale = [pid for pid in kept if not any(str(r["handle"]).lower() in in_mail for r in theirs.get(pid, []))]
    for start in range(0, len(stale), 100):
        pod.records.bulk_update("person", [
            {"id": pid, "conversation_count": 0, "inbound_count": 0, "outbound_count": 0, "weight": 0,
             "cadence_days": None, "first_seen_at": None, "last_inbound_at": None, "last_outbound_at": None}
            for pid in stale[start : start + 100]])
    removed += drop("mail_sample_row", "TRUE")
    return removed


def _load(ctx: FunctionContext) -> MailSampleDataResult:
    _id = _ids(ctx)
    pod = ctx.pod
    now = datetime.now(timezone.utc)
    me = (ctx.user_email or "you@yourcompany.example").lower()
    settings = (_rows(pod.query("SELECT id, display_name FROM mail_settings LIMIT 1")) or [{}])[0]

    mailbox_id = _id("mailbox")
    if not _rows(pod.query(f"SELECT id FROM mail_mailbox WHERE id = {_sql(mailbox_id)}")):
        pod.records.bulk_create("mail_mailbox", [{
            "id": mailbox_id, "provider": "gmail", "account_id": SAMPLE_ACCOUNT, "email": me,
            "owner_name": settings.get("display_name"), "state": "backfilling",
            "connected_at": now.isoformat(),
        }])
    try:
        pod.files.create_folder(SAMPLE_ROOT)
    except Exception:  # noqa: BLE001 — the bundle made it; already there is the usual case
        pass
    messages = _messages(me, now)
    pod.files.write_text(f"{SAMPLE_ROOT}/{mailbox_id}.json", json.dumps(messages))
    made = _make_people(ctx)
    return MailSampleDataResult(
        mode="load", mailbox_id=mailbox_id, conversations=len(CONVERSATIONS), messages=len(messages),
        removed=0, removed_files=0,
        message=f"Sample mailbox ready: {len(CONVERSATIONS)} conversations, {len(messages)} messages, {made} new people, waiting for its first read.",
    )


def _close_items(pod, conv_in: str) -> None:
    items = [r["id"] for r in _rows(pod.query(
        f"SELECT id FROM needs_you WHERE source_plugin = 'mail' AND state <> 'done' AND conversation_id IN ({conv_in}) LIMIT 5000"))]
    for start in range(0, len(items), 100):
        pod.records.bulk_update("needs_you", [{"id": i, "state": "done", "closed_by": "source"} for i in items[start : start + 100]])


def _clear(ctx: FunctionContext) -> MailSampleDataResult:
    pod = ctx.pod
    boxes = _rows(pod.query("SELECT id, account_id FROM mail_mailbox"))
    sample = [b["id"] for b in boxes if b.get("account_id") == SAMPLE_ACCOUNT]
    full = not any(b.get("account_id") != SAMPLE_ACCOUNT for b in boxes)
    removed = 0

    def drop(table: str, where: str) -> int:
        count = 0
        while True:
            ids = [r["id"] for r in _rows(pod.query(f"SELECT id FROM {table} WHERE {where} LIMIT 500"))]
            for start in range(0, len(ids), 100):
                pod.records.bulk_delete(table, ids[start : start + 100])
            count += len(ids)
            if len(ids) < 500:
                return count

    conversation_ids: list[str] = []
    paths: list[str] = []
    if sample:
        rows = _rows(pod.query(
            f"SELECT id, document_path FROM conversation WHERE source = 'mail' AND source_account IN ({_in(sample)}) LIMIT 2000"))
        conversation_ids = [r["id"] for r in rows]
        paths = [r["document_path"] for r in rows if (r.get("document_path") or "").startswith(SAMPLE_ROOT + "/")]
        paths += [f"{SAMPLE_ROOT}/{b}.json" for b in sample]
        conv_in, box_in = _in(conversation_ids), _in(sample)
        # The person's day: Mail's items from these conversations leave it
        # (closed by the source; nothing is deleted there).
        _close_items(pod, conv_in)
        removed += drop("draft", f"(source = 'mail' AND source_account IN ({box_in})) OR conversation_id IN ({conv_in})")
        removed += drop("promise", f"conversation_id IN ({conv_in})")
        removed += drop("message", f"conversation_id IN ({conv_in})")
        removed += drop("mail_correction", f"conversation_id IN ({conv_in})")
        removed += drop("mail_nudge", f"id IN ({conv_in})")
        removed += drop("mail_activity", f"conversation_id IN ({conv_in}) OR ref_id IN ({box_in})")
        removed += drop("mail_thread", f"id IN ({conv_in})")
        # A draft or promise writer still running can add a row that points at
        # a conversation after its kind was cleared; clear those and try again.
        for attempt in range(5):
            try:
                removed += drop("conversation", f"source = 'mail' AND source_account IN ({box_in})")
                break
            except Exception:  # noqa: BLE001 — still referenced: a writer landed in between
                if attempt == 4:
                    raise
                wall.sleep(3)
                for table in ("draft", "promise", "message"):
                    removed += drop(table, f"conversation_id IN ({conv_in})")
        # A writer still running when the conversations went can leave an item.
        _close_items(pod, conv_in)
        removed += drop("mail_sync_state", f"mailbox_id IN ({box_in})")
        removed += drop("mail_mailbox", f"id IN ({box_in})")
    # People met only in the sample: their .example handles, then whoever is
    # left with no handle at all.
    # Last: the sample's own conversations, messages, promises and drafts are
    # gone, so whatever still names one of its people is someone else's.
    removed += _forget(pod, drop)
    if full:
        # Everything left was learned from made-up mail.
        for table in MAIL_TABLES_FULL:  # noqa: B007
            removed += drop(table, "TRUE")

    removed_files = 0
    for path in paths:
        try:
            pod.files.delete(path)
            removed_files += 1
        except Exception:  # noqa: BLE001 — never written (bulk mail has no document) or already gone
            pass
    return MailSampleDataResult(
        mode="clear", conversations=0, messages=0, removed=removed, removed_files=removed_files,
        message=f"Removed {removed} sample rows and {removed_files} files"
        + ("; Mail is back to its first screen." if full else "; your real mailbox and settings are untouched."),
    )


def mail_sample_data(ctx: FunctionContext, data: MailSampleDataInput) -> MailSampleDataResult:
    if data.mode == "clear":
        return _clear(ctx)
    if data.mode == "load":
        return _load(ctx)
    raise ValueError("mode is load or clear")
