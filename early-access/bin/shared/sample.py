# early-access:sample
# The sample beta: made-up people at .example addresses, as of `at` (UTC).
# Used by early_access_sample_data and, outside the Lemma, bin/demo-fixtures.py.
SAMPLE_PEOPLE = [
    # name, company, role, status, fit, reason, use_for, uses_7d, last_used_days, said, said_source, said_days, signed_days, in_days
    ("Amara Okafor", "Lumen Health", "Data lead", "quiet", "strong", "Sends 12 filtered exports to clients every Monday; Lumen Health has an open deal.", "We send 12 filtered exports to clients every Monday.", 0, 22, "Will try it properly this week.", "mail", 22, 55, 29),
    ("Sam Carter", "Birch and Co", "Finance", "quiet", "strong", "Exports ledgers filtered by cost centre weekly, and asked for this in mail twice.", "We filter ledgers by cost centre every week.", 0, 12, "The 10k row cap stops us using it.", "form", 12, 54, 36),
    ("Kenji Sato", "Waypoint", "Engineer", "waiting", "strong", "Schedules 30 exports a day from the API, the heaviest use in the queue.", "We schedule 30 exports a day from the API.", None, None, None, None, None, 6, None),
    ("Ruth Mensah", "Calder", "Ops manager", "waiting", "strong", "Asked for filtered exports twice in mail since September.", "Our clients ask for filtered CSVs weekly.", None, None, None, None, None, 4, None),
    ("Olu Adeyemi", "Brightwater", "Finance lead", "waiting", "strong", "Open deal in Deal tracker whose next step is showing filtered exports.", "Our auditors need filtered ledgers every quarter.", None, None, None, None, None, 11, None),
    ("Wen Zhou", "Kiteline", "Head of data", "waiting", "strong", "Exports of 50 to 80 thousand rows: would test the row-cap blocker.", "Our exports are 50 to 80 thousand rows.", None, None, None, None, None, 5, None),
    ("Ines Duarte", "Saltmarsh", "Analyst", "waiting", "strong", "Rebuilds the same filtered export every morning, the same job as the active testers.", "I rebuild the same filtered export every morning.", None, None, None, None, None, 7, None),
    ("Clara Becker", "Fjord", "Product manager", "waiting", "strong", "Reported the export bug this beta fixes.", "We gave up on exports after the filter bug.", None, None, None, None, None, 6, None),
    ("Arjun Mehta", "Tallyho", "Founder", "waiting", "strong", "Exports for every investor update and replies fast in mail.", "I export for every investor update.", None, None, None, None, None, 9, None),
    ("Sofia Rossi", "Larkspur", "Support lead", "waiting", "strong", "Support team of 12 that filters tickets by date before every weekly review.", "We filter tickets by date before every review.", None, None, None, None, None, 2, None),
    ("Marcus Lee", "Pinecrest", "Analyst", "waiting", "strong", "Uses date filters daily: 40 filtered views a week in PostHog.", "Date ranges, always.", None, None, None, None, None, 13, None),
    ("Nadia Petrov", "Ostrava", "Operations", "waiting", "strong", "Weekly warehouse exports; waited longest of the strong fits.", "Weekly exports for our warehouse team.", None, None, None, None, None, 41, None),
    ("Ben Ashford", "Hollis", "Consultant", "waiting", "maybe", "Exports once a month, so would say little in two weeks.", "Monthly client report.", None, None, None, None, None, 8, None),
    ("Leah Brandt", "Corvid", "Marketing", "waiting", "maybe", "Wants exports for campaign lists; filters not mentioned.", "Campaign lists for our ads.", None, None, None, None, None, 10, None),
    ("Tariq Hassan", "Meridian", "Analyst", "waiting", "maybe", "Filters by region, but exports are run by another team today.", "Regional numbers for the board.", None, None, None, None, None, 15, None),
    ("Yara Nunes", "Oakline", "Operations", "waiting", "maybe", "Vague use: 'reports' with no frequency given.", "Reports.", None, None, None, None, None, 18, None),
    ("Paul Grant", "Hearth", "Founder", "waiting", "maybe", "Small team; exports a few times a quarter.", "Quarterly numbers for our accountant.", None, None, None, None, None, 20, None),
    ("Mira Kovac", "Tidewater", "Data analyst", "waiting", "maybe", "Uses a BI tool for this today; might compare the two.", "We use a BI tool for this today.", None, None, None, None, None, 22, None),
    ("Dev Patel", "Quillon", "Engineer", "waiting", "maybe", "Wants the API more than the filtered export.", "Mostly the API.", None, None, None, None, None, 24, None),
    ("Grace Liu", "Fernway", "Finance", "waiting", "maybe", "Monthly close exports; filters by account.", "Month-end close.", None, None, None, None, None, 26, None),
    ("Oscar Lind", "Harbor", "Sales ops", "waiting", "maybe", "Pipeline exports for forecasts, filtered by owner.", "Forecast pipeline by owner.", None, None, None, None, None, 28, None),
    ("Zainab Ali", "Pellucid", "Researcher", "waiting", "maybe", "Exports survey data occasionally.", "Survey data for papers.", None, None, None, None, None, 30, None),
    ("Hana Kim", "", "Student", "waiting", "not_now", "Personal account with no team using the product.", "Curious about the product.", None, None, None, None, None, 2, None),
    ("Ivan Petrov", "", "Hobbyist", "waiting", "not_now", "Personal email and no use described.", "Just looking.", None, None, None, None, None, 3, None),
    ("Lucia Ortiz", "Brava", "Designer", "waiting", "not_now", "Never exports today; wants to see the product first.", "We don't export yet.", None, None, None, None, None, 12, None),
    ("Femi Adebayo", "Cobalt", "Engineer", "waiting", None, None, "Large nightly exports with filters by date and team.", None, None, None, None, None, 0, None),
    ("Priya Raman", "Northwind", "Ops lead", "active", "strong", "Runs 14 filtered exports a week for client reports.", "Client reports every week, filtered.", 14, 0, "Date filter resets when I export, every time.", "mail", 3, 50, 36),
    ("Leila Haddad", "Tessera", "Support lead", "active", "strong", "Weekly review export across 6 support queues.", "Our weekly review export.", 9, 0, "The weekly review export takes a minute now, not twenty.", "form", 7, 49, 36),
    ("Tomas Ortega", "Fernhill", "Analyst", "active", "strong", "Replaces a spreadsheet macro the team runs daily.", "We run a macro to filter every export.", 22, 1, "This replaced a spreadsheet macro for us.", "form", 30, 48, 36),
    ("Mei Lin", "Orbit Labs", "Product manager", "active", "maybe", "Exports for roadmap reviews, twice a month.", "Roadmap reviews.", 6, 3, "Can it keep my column order too?", "survey", 8, 44, 22),
    ("Noah Fischer", "Granite", "Analyst", "active", "strong", "Daily exports filtered by product line.", "Daily exports by product line.", 11, 0, "Saving a filter for next time would help.", "form", 5, 40, 22),
    ("Aisha Bello", "Meadow", "Finance lead", "active", "strong", "Board pack exports filtered by entity.", "Board packs by entity.", 4, 2, None, None, None, 38, 22),
    ("Diego Alvarez", "Quarry", "Analyst", "left", "maybe", "Exports once a month.", "Monthly numbers.", 0, 24, "Turned it off: we export once a month.", "form", 23, 52, 36),
    ("Chloe Martin", "Lattice", "Ops", "left", "maybe", "Uses another tool for exports.", "Exports for ops.", 0, 30, "We moved to another tool.", "mail", 28, 51, 36),
    ("Jonas Weber", "Kettle", "Founder", "invited", "strong", "Small team, daily exports for investors.", "Daily exports for investors.", 0, None, None, None, None, 14, 2),
    ("Elena Popa", "Driftwood", "Data lead", "invited", "strong", "Exports 20 filtered files for partners each week.", "Partner exports, filtered.", 0, None, None, None, None, 16, 2),
    ("Rafael Costa", "Sundial", "Analyst", "invited", "maybe", "Wants filters on scheduled exports.", "Scheduled exports.", 0, None, None, None, None, 19, 2),
    ("Anya Ivanova", "Bramble", "Engineer", "invited", "strong", "Builds client exports by hand today, every week.", "We build client exports by hand.", 1, 0, None, None, None, 21, 5),
    ("Kofi Mensah", "Saffron", "Ops", "quiet", "maybe", "Exports for the warehouse, monthly.", "Warehouse counts.", 0, 15, None, None, None, 46, 29),
    ("Lina Haddad", "Cinder", "Support", "not_now", "not_now", "No export use in the sign-up.", "Want to try new things.", None, None, None, None, None, 35, None),
]


def _slug_email(name: str, company: str) -> str:
    first = name.split()[0].lower().replace("á", "a")
    domain = (company or "mail").lower().replace(" and ", "").replace(" ", "")
    return f"{first}@{domain}.example"


def sample_rows(at, me: str | None = None) -> dict:
    """Every row of the sample beta, keyed by table, as of `at` (UTC datetime)."""
    def ago(days, hours=0):
        return None if days is None else (at - _timedelta(days=days, hours=hours)).isoformat()

    product_id = rid("sample", "product")
    feature_id = rid("sample", "feature")
    beta_id = rid("sample", "beta")
    beta = {"id": beta_id, "feature_id": feature_id, "product_id": product_id, "slug": "sample-csv-export",
            "name": "CSV export with filters", "intro": "Export any table with the filters you set, from the app or the API.",
            "state": "open", "flag_tool": "posthog", "flag_key": "csv-export-filters", "cohort_id": "4521",
            "cohort_name": "CSV export beta", "posthog_account": "posthog", "posthog_url": "https://posthog.sample.example/project/1",
            "usage_events": ["export_csv"], "batch_size": 10, "checkin_day": 6, "quiet_days": 7, "questions": QUESTIONS,
            "owner_user_id": me, "opened_at": ago(56), "page_url": "https://early-access.sample.example/sample-csv-export?k=pk_sample_demo",
            "widget_key": "pk_sample_demo", "sweep_at": ago(0, 1), "sweep": {"usage": "read", "people": 17, "at": ago(0, 1)},
            "turned_on": [{"step": s, "ok": True, "said": w, "at": ago(56)} for s, w in (
                ("open", "Sign-ups open to visitors who confirm their email."), ("checkin", "The check-in page takes answers."),
                ("widget", "The Lemma's web widget allows this page."), ("triggers", "Sign-ups and check-ins are handled as they arrive."),
                ("sweep", "Usage is read every hour."), ("page", "The page is on."))],
            "sample": True}
    testers, feedback, timeline_drafts, statuses = [], [], [], []
    batch_days = sorted({p[13] for p in SAMPLE_PEOPLE if p[13] is not None}, reverse=True)
    batches = {d: rid("sample", "batch", d) for d in batch_days}
    for i, p in enumerate(SAMPLE_PEOPLE):
        name, company, role, status, fit, reason, use_for, uses, last_used, said, src, said_days, signed, in_days = p
        email = _slug_email(name, company)
        tid = tester_id(beta_id, "email", email)
        ref = rid("sample", "ref", email).replace("-", "")[:24]
        tl = [{"at": ago(signed), "what": "Signed up on the page", "quote": use_for, "source": "sign-up"}]
        if fit:
            label = fit.replace("_", " ")
            tl.append({"at": ago(signed, -1), "what": f"Fit {label}: {reason}", "ai": True})
        if in_days is not None:
            tl.append({"at": ago(in_days), "what": "Let in (flag on in PostHog), invite waiting for Send"})
            tl.append({"at": ago(in_days, -1), "what": "Invite sent from your mailbox"})
        if last_used is not None and uses is not None and (uses or last_used < (in_days or 0)):
            tl.append({"at": ago(max(0, (in_days or 1) - 1)), "what": "First used it", "source": "posthog"})
        if said:
            tl.append({"at": ago(said_days), "what": {"mail": "Replied in mail", "form": "Answered the check-in", "survey": "Answered the PostHog survey"}[src],
                       "quote": said, "source": src})
        if status == "quiet":
            tl.append({"at": ago(max(0, (last_used or in_days or 8) - 7)), "what": f"{min(last_used or 30, 30)} days with no use and nothing said"})
        if status == "left":
            tl.append({"at": ago(said_days or 20), "what": "Taken out of the beta: " + (said or "asked to leave")})
        row = {"id": tid, "beta_id": beta_id, "handle_kind": "email", "handle": email, "name": name,
               "company_name": company or None, "role": role, "ref": ref, "email_proof": "code",
               "answers": {"use_for": use_for, "today": "A spreadsheet after every export." if i % 3 == 0 else "By hand.", "role": role,
                           **({"company": company} if company else {})},
               "status": status, "fit": fit, "fit_reason": reason, "fit_sure": 0.82 if fit == "strong" else 0.64 if fit else None,
               "fit_at": ago(signed, -1) if fit else None, "fit_by": "lemma" if fit else None,
               "batch_id": batches.get(in_days), "invited_by": me if in_days is not None else None, "invited_at": ago(in_days),
               "flag_state": ("on" if in_days is not None else None) if i != 36 else "waiting_for_person",
               "flag_note": "PostHog doesn't know them yet. They're added the hour after their first sign-in." if i == 36 else None,
               "first_used_at": ago(max(0, (in_days or 1) - 1)) if (uses or 0) or (last_used is not None and in_days and last_used < in_days) else None,
               "last_used_at": ago(last_used) if last_used is not None and (uses or (in_days and last_used < in_days)) else None,
               "uses_7d": uses, "last_heard_at": ago(said_days), "last_said": said or use_for,
               "last_said_source": src or "sign-up", "chased_at": ago(5) if name == "Sam Carter" else None,
               "left_reason": said if status == "left" else None, "timeline": tl, "signed_up_at": ago(signed), "sample": True}
        if status in ("quiet",) and name == "Amara Okafor":
            row["chase_draft_id"] = rid("draft", "chase", tid)
            timeline_drafts.append(row)
        testers.append(row)
        statuses.append({"id": rid("status", ref), "ref": ref, "beta_id": beta_id,
                         "state": {"waiting": "waiting", "not_now": "not_now", "left": "not_now"}.get(status, "in"),
                         "line": status_line({"waiting": "waiting", "not_now": "not_now", "left": "not_now"}.get(status, "in"), beta)})
        if said and src in ("form", "survey", "mail"):
            sid = rid("sample", "said", tid)
            feedback.append({"id": feedback_id(src, sid, said), "quote": said, "product_id": product_id, "feature_id": feature_id,
                             "filed_by": "lemma", "kind": "problem" if any(w in said.lower() for w in ("cap", "resets", "stops", "turned it off")) else
                             ("request" if said.endswith("?") or "would help" in said else "praise" if "replaced" in said or "minute now" in said else "other"),
                             "importance": "blocker" if "stops us" in said else "unknown", "handle_kind": "email", "handle": email,
                             "name": name, "company_name": company or None, "source": src, "source_account": "early-access",
                             "source_id": sid, "said_at": ago(said_days), "state": "new", "plugin": PLUGIN, "is_public": False})
    batch_rows = [{"id": bid, "beta_id": beta_id, "picked_by": me, "picked_at": ago(d), "size": sum(1 for p in SAMPLE_PEOPLE if p[13] == d),
                   "sent": True, "tester_ids": [t["id"] for t, p in zip(testers, SAMPLE_PEOPLE) if p[13] == d], "sample": True}
                  for d, bid in batches.items()]
    drafts = []
    for t in timeline_drafts:
        drafts.append({"id": t["chase_draft_id"], "source": "mail", "source_account": "", "kind": "new", "to_handles": [t["handle"]],
                       "subject": "CSV export with filters: did it work for you?",
                       "body": "Hi Amara,\n\nChecking in on the filtered exports. Did Monday's client exports work, or did something get in the way? Even a one-line answer helps us fix the right thing.",
                       "state": "proposed", "rationale": "The one note: 22 days with no use and nothing said.",
                       "built_from": {"plugin": PLUGIN, "tester_id": t["id"], "beta_id": beta_id, "kind": "chase",
                                      "used": ["sign-up: 12 filtered exports every Monday", "last heard: Nov 4"]}})
        t["timeline"] = t["timeline"] + [{"at": ago(0, 2), "what": "One note drafted", "ai": True}]
    return {"product": [{"id": product_id, "name": "Ledgerline", "role": "ours", "active": True, "source": PLUGIN}],
            "feature": [{"id": feature_id, "product_id": product_id, "name": "CSV export with filters", "state": "active", "origin": "team",
                         "stage": "beta", "stage_at": ago(56), "owner_user_id": me, "source": PLUGIN, "source_id": feature_id}],
            "early_access_beta": [beta], "early_access_tester": testers, "early_access_batch": batch_rows,
            "early_access_page": [{"id": rid("page", beta_id), "beta_id": beta_id, "slug": beta["slug"], "name": beta["name"], "intro": beta["intro"],
                                   "questions": [{"key": x["key"], "label": x["label"]} for x in QUESTIONS], "pace": pace_line(beta), "state": "paused"}],
            "early_access_status": statuses, "feedback": feedback, "draft": drafts}
# end early-access:sample
