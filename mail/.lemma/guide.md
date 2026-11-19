# Mail

Each person's own mail (Gmail or Outlook), read once, sorted, and with replies
drafted in their voice. Mail never sends on its own: a person presses Send.
Its set-up rewrites everything between the markers around this text; the
team's own notes about Mail go below them and stay.

## Where mail lives

- Each person's own, private to them: `conversation` (one per thread:
  `category`, `state` new, needs_reply, waiting, fyi or done, `priority` 0 to
  3, `ask`), `message`, `draft` (`state` proposed, approved, sent…) and
  `promise` (made either way, `quote` the sentence, `due_at`). Mail's own
  working state per conversation is `mail_thread`, same id.
- Each conversation is also one document,
  `/me/mail/conversations/<conversation id>.md`.
- The person's categories are `mail_category`; their writing voice is `voice`
  in their own `mail_settings` row.
- The app is `inbox`.

## From chat

- **Find mail**: `mail_search` with plain words, and any of `from_handle`,
  `after`, `before` (YYYY-MM-DD). It searches what Mail read and, through
  Gmail's or Outlook's own search, older mail too. Each hit says whether Mail
  holds the conversation (`conversation_id`) and links to it.
- **A reply drafted**: `mail_thread_action` with `action` `draft`, the
  `conversation_ids` and a `hint` ("yes, Thursday works"). Mail's writer
  drafts it in the person's voice and it waits in the Inbox for them.
- **Anything else written in the person's name** follows their voice.
- **Tidying**: `mail_thread_action` with `done`, `snooze` (`until`), `move`
  (`category`), `read`, `unread` or `mute` changes Gmail or Outlook too, and a
  move teaches the sort. Only when asked.

## Never

- Never send mail and never approve a draft: `mail_send_draft` sends only
  what the person approved in the Inbox. Say where the draft is.
- Never show one person's mail to anyone else, in any conversation.
- Never copy mail into `/memory` or a table the team reads.
