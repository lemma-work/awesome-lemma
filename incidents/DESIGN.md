# Incidents: design

Engineers' tool, so it looks like one (incident.io, Linear): dense rows, a
record layout, no art. Drawn with the kit, `--c-*` roles only, Inter at 500
at most, lucide icons at 12 to 15px.

## The incident page (the canvas's A)

- **Bar on top, everywhere**: Incidents · segmented Active / Follow-ups /
  Resolved with counts · search on `/` · Declare incident · set-up.
- **Record header**: breadcrumb, title (21px), facts as pills with words
  (severity, status, lead, "38 min · since 14:02", the channel), the status
  steps (a step is ticked only when the incident was in it), then two tabs:
  **Incident** and **Write-up** (with its state: drafting, to review,
  reviewed).
- **Incident tab**, main column: **Now** (the Lemma's, refreshed in place;
  "next on a mention, a change, or at 14:51" and *Not live yet* until Slack's
  channel events reach the Lemma), **Most likely cause** (confidence and
  "3 of 4 signs agree"; evidence with its source icon; ruled out; not
  checked, every missing source named), **Update drafted** (the To line, *No
  public status page*, Edit, **Send update**: the one accent while open),
  **Timeline** with filters All / Messages / Changes / Lemma / Pinned.
  Properties beside: severity (changes from a menu), status, lead, comms,
  responders + Lemma; impact (who, people with their source, started,
  noticed, service); changed in the hour before; linked (Triage item,
  channel, *call notes: Not connected*); Change status, Resolve and draft
  the write-up.
- **Write-up tab**, same layout: the document with a cite chip after every
  claim (press one: the event shows beside, with a link to where it
  happened), flagged claims underlined; beside it, the review's flags
  (Remove the sentence / Keep it), follow-ups (tasks and proposals: Accept /
  Not now / Add), and what it was built from. **Mark reviewed** is the one
  accent.

## Rules kept

- The Lemma's work carries sparkles and the `ai` pill: Now, the cause, the
  drafted update, the write-up, proposals. Never a colour of its own.
- What the platform doesn't back is said in place, in a dashed note, never
  faked: *Not live yet*, *from the workflow run*, *No public status page*,
  *No call notes during the call*, *Not connected*, "not checked".
- No number without a source: people affected shows its source, or "No
  source gave a number".
- 375px: rows fold onto two lines, the two columns become one, the bar wraps;
  no sideways scroll (checked in the screenshots).
- Copy: "Lemma", never "pod", "teammate" or "room"; no sample names outside
  the sample.

## Pictures

`.lemma/shots/`: `incidents` (/i/14), `incidents-writeup` (INC-14 resolved in
the demo), `incidents-past-writeup` (/i/13/writeup), `incidents-list` (/),
`incidents-followups`, `incidents-setup`; each light and dark at 1440×900,
and `-375` at phone width.
