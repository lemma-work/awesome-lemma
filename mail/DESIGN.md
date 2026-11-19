# Mail: design

## Thesis

> For a founder or operator who lives in Gmail or Outlook, the Inbox turns a
> month of mail into a short list of replies already written in their own
> voice, by reading every conversation once against categories they wrote in
> their own words, and asking them only when it is not sure.

- **Hero moment:** a conversation open beside the list, why it is there ("Give
  Chloé a decision by Thursday, ahead of her Friday deadline · People, 86%
  sure"), the promise they made in it with the sentence, and the reply under
  it, "Drafted in your voice", one press from sent.
- **First 30 seconds** (after set-up): Needs reply, with what the first read
  found in one line above it: replies owed, how many drafted, waiting, promises,
  how many it was not sure about.
- **Information spine:** the conversation. Categories, what it needs, drafts,
  promises and corrections all hang off one.

## Direction: a dense mail client, on the kit

The Inbox keeps the Inbox Lemma's working layout (decided 8 Oct 2026: a mail client
is a tool, not a poster): a left side for what you need to do, the list, the
conversation beside it. It takes the plugins' one look from `../_kit`: Inter,
the host's `--lemma-app-*` tokens with Lemma's light and dark fallbacks,
weight 500 at most, lucide icons, the kit's buttons, pills, menus, segmented
tabs, search on `/`, tables, cards, drawers, skeletons and empty states. Its
own CSS (`apps/inbox/source/src/mail.css`) is layout only and uses the kit's
`--c-*` roles, never a colour of its own.

Mail's own marks, kept small:

- **Unread** is the name and subject in the text colour at 500, with a dot.
- **Not sure** is a warning pill on the row and an amber-ruled card in the
  conversation that asks where it goes, with the person's categories as
  one-press chips. Pressing one is a correction.
- **Why it is here**: one line under the subject, the ask (written by the
  writer) or the reason, and how sure the read was, in percent.
- **Drafted in your voice** marks the writer's work, with "Why?" opening its
  note on what it used.
- **Promises** sit in the conversation as a line plus the sentence, the
  kit's evidence quote; the Promises page is the owed ledger, both ways.

## Resource map

| UI | Purpose | Resource | Surface | Live |
| --- | --- | --- | --- | --- |
| Left side counts | what needs me | `conversation`, `mail_thread`, `mail_category` | one grouped query | change stream |
| List | the queue | `conversation` ⋈ `mail_thread` (600 newest open or 21 days) | `datastore.query` | change stream |
| Category tabs | my categories | `mail_category` | query | change stream |
| Conversation | the messages | `conversation.document_path` | `files.download` | on open |
| Why here, Not sure | the read and its confidence | `mail_thread.reason`, `confidence`, `unsure` | query | change stream |
| Move, It needs, Not sure chips | a correction | `mail_thread_action` (`move`, `state`) → `mail_correction` | function | write |
| Done, Snooze, Mute, Unread | handle it | `mail_thread_action`, mirrored to Gmail or Outlook | function | write |
| Reply | the draft | `draft` (shared) | records | write; send via `mail_send_draft` |
| Draft a reply, intents, Redraft | ask the writer | `mail_thread.draft_state/draft_hint` → `mail-draft-wanted` | `mail_thread_action` (`draft`) | write |
| Promises | owed both ways | `promise` (shared) | query; Kept is a records update | change stream |
| Settings: categories | the sentences | `mail_category`; Sort again = `mail_resort` + `mail-sort` | records, function, workflow | write |
| Settings: rules, voice | how it sorts and writes | `mail_rule`, `mail_settings.voice` | records | write |
| Settings: mailboxes | sample, schedules | `mail_mailbox`, `mail_sample_data` clear, `schedules` | function, SDK | write |
| Set-up | five steps | `mail-setup` run, its forms | `workflows.runs.create/get/submitForm` | polled every 2.5 s |

Counts come from aggregates over every conversation; the list holds one page.

## Pages

Paths stay in the Lemma's address (the kit's `usePath`):
`/needs`, `/inbox`, `/waiting`, `/unsure`, `/snoozed`, `/aside`, `/done`,
`/sorting`, each with `/<conversation id>`; `/promises`; `/settings/<tab>`.
Until set-up is done every path shows set-up.

## Set-up

A step rail (Connect, Read, Categories, Drafts, Sort) and one question per
screen. Connect lists the organisation's connected accounts for the provider,
with Connect for a new one and "Look around with a sample mailbox" below a
rule. Read shows counters (conversations, people, drafts) and a meter.
Categories puts what it found first (with a "Found in your mail" pill and
why), then the five; each is a name field, a sentence, and a keep switch; the
voice as traits with Edit; rules and VIPs as switch lists; "Keep these" sticks
to the bottom. Drafts is a checklist with each category's sentence. Sort shows
"Sorted n of 36" until the inbox opens.

## States

Loading draws the list as skeleton rows. Empty says what is absent and what
fills it ("When someone is waiting on you it lands here, sorted, with the
reply drafted in your voice"). A draft being written says so in the reply box
with the hint. Send waits ten seconds with Undo; failures keep the text and
show the provider's words. A load error is a banner with Try again. The sample
mailbox is a banner on every page, and Send is off with the reason under it.

## Responsive

Above 1180px: side, list, conversation. 860 to 1180: the list narrows to
340px when a conversation is open. Below 860: one pane at a time, the side as a
drawer from a menu button, Back in the conversation's toolbar. At 640 and
below rows are two lines and the toolbar keeps icons. Checked at 375px: no
sideways scroll. Row quick actions (Done, Snooze) appear on hover only as a
shortcut: every action is in the conversation's toolbar, which works without
hover.

## Keyboard

j/k move · Enter or o open · e done · x select · / search · Esc close · ⌘↵ send.

## Acceptance

- Light and dark follow the Lemma when framed (the kit's `lemma-app-theme`
  handling), and the device otherwise.
- No horizontal scroll at 375px; no action reachable only on hover.
- Every count is a count of what was read, said as such.
- Nothing sends without a person pressing Send; the sample can never send.
