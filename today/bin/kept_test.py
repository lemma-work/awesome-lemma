"""Check that promises close themselves: on the sample, write the newer message
that a real sync would write into two conversations with an open promise the
owner made, and watch Mail's trigger (mail-promise-kept) ask whether each was
kept, and the person's day (needs_you) follow.

  Hannah  the owner sends v2 of the pricing page, as promised   -> expect yes, closed
  Lena    Lena asks whether the CSV fix is out yet               -> expect no, still open

From today/, after bin/sample_day.py:

    uv run --no-project python bin/kept_test.py [--pod <id>]

Writes exactly what Mail's sync writes for a new message (a `message` row and
the conversation's last_message_at, as one plain update, so the
today-promise-check schedule fires), into the sample mailbox only. Nothing is
sent anywhere. Prints each promise's answer, confidence and state.
"""
import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = str(HERE / "lemma")
POD: list[str] = []

CASES = [
    ("Hannah Volkov", "outbound", "Hi Hannah, here's v2 of the pricing page: the middle tier is gone and the annual price "
     "comes first. It's attached. Cheers", True),
    ("Lena Fischer", "inbound", "Hi, any news on the CSV export fix? The warehouse team keeps losing the last row of "
     "every export. Thanks, Lena", False),
]


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *POD, *args], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index("{"): out.rindex("}") + 1])


def rows(sql: str) -> list[dict]:
    return cli("query", "run", sql).get("items") or []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pod")
    args = parser.parse_args()
    if args.pod:
        POD.extend(["--pod", args.pod])
    me = rows("select email from mail_mailbox where account_id = 'sample' limit 1")[0]["email"]
    watched = []
    for name, direction, text, attached in CASES:
        found = rows("select p.id as promise_id, p.text, c.id, c.subject, c.counterpart_handle, c.counterpart_name, c.message_count "
                     f"from promise p join conversation c on c.id = p.conversation_id where p.person_name = '{name}' "
                     "and p.direction = 'i_owe' and p.state = 'open' limit 1")
        if not found:
            print(f"{name}: no open promise in the sample (already closed?)")
            continue
        conv = found[0]
        now = datetime.now(timezone.utc).isoformat()
        handle = conv["counterpart_handle"]
        cli("records", "create", "message", "--data", json.dumps({
            "conversation_id": conv["id"], "source": "mail", "source_id": f"today-test-{int(time.time())}-{name.split()[0].lower()}",
            "direction": direction, "from_handle": me if direction == "outbound" else handle,
            "from_name": None if direction == "outbound" else conv["counterpart_name"],
            "to_handles": [handle] if direction == "outbound" else [me], "subject": conv["subject"], "sent_at": now,
            "snippet": text, "has_attachments": attached}))
        change = {"last_message_at": now, "last_direction": direction, "snippet": text[:400],
                  "message_count": int(conv.get("message_count") or 0) + 1,
                  ("last_outbound_at" if direction == "outbound" else "last_inbound_at"): now}
        cli("records", "update", "conversation", conv["id"], "--data", json.dumps(change))
        print(f"{name}: wrote a new {direction} message into “{conv['subject']}” at {now[11:19]}")
        watched.append((name, conv["promise_id"]))
    began = time.monotonic()
    pending = dict(watched)
    while pending and time.monotonic() - began < 300:
        time.sleep(5)
        for name, pid in list(pending.items()):
            got = rows(f"select p.state, (select n.state from needs_you n where n.source_id = p.id::text and n.verb = 'do' limit 1) as item, "
                       f"(select n.title from needs_you n where n.source_id = p.id::text and n.verb = 'decide' and n.state = 'open' limit 1) as asked "
                       f"from promise p where p.id = '{pid}'")
            if got and (got[0]["state"] != "open" or got[0].get("asked") or time.monotonic() - began > 60):
                g = got[0]
                print(f"{name}: promise {g['state']}, its to-do item {g.get('item')}"
                      + (f", asked the person: {g['asked']}" if g.get("asked") else "")
                      + f" ({round(time.monotonic() - began)} s after the write)")
                del pending[name]
    for name in pending:
        print(f"{name}: no answer after {round(time.monotonic() - began)} s")


if __name__ == "__main__":
    main()
