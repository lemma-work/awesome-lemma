"""Deal tracker listening, on the sample: write the newer messages a real
sync would write into four sample conversations, let Mail's own sort read them
(it writes `sorted_at`, which is what `deals-heard-conversation` listens for),
and print what each read answered and proposed, with timings.

  Brightwave  Daniel: finance agreed, the price, sign by the 28th   -> stage, amount, close date, next step
  Tidal Foods Marcus: the Leeds kitchen wants 5 more seats           -> a new deal
  Ferro       Lena: they chose another vendor for the dashboard     -> lost
  Studio Tan  Grace quotes the owner for design work                 -> no (the team is buying)
  Build Notes Jonas offers the owner a paid sponsor slot              -> not read: People map put him at no company
  Studio Tan  Grace: approve the quote by Friday (grace2)             -> should be no; a dismissal test case
  Lind        Oskar: his fee for the year-end accounts                -> should be no; a dismissal test case
  Volkov      Hannah offers an introduction to a friend's agency       -> no deal yet; the dismissal test
  Romano      Lucia offers an introduction to a logistics firm         -> not read: People map put her at no company
  Orchard     Sana asks for two more seats                             -> a small expansion: the teaching test

Writes into the sample mailbox only: a `message` row, the conversation's
counters, and the message appended to its document, as Mail's sync does; then
`mail_sort` on those conversations. Nothing is sent anywhere. From deals/:

    uv run --no-project python bench/listen_test.py [case ...]
"""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEMMA = str(HERE.parent / "bin" / "lemma")

CASES = {
    "brightwave": ("daniel@brightwave-health.example", "Daniel Kowalski",
                   "Hi,\n\nFinance signed off on the two-year term. 40 seats at the 15% discount comes to EUR 11,520 a year, which works for us. "
                   "Please send the order form and we'll sign it by 28 November.\n\nThanks,\nDaniel"),
    "tidal": ("ap@tidal-foods.example", "Marcus Lee",
              "Hello,\n\nThanks for reissuing INV-2207, it's paid. Separately, our Leeds kitchen wants to join: could you quote us for 5 more seats "
              "on the same plan?\n\nMarcus Lee\nAccounts payable, Tidal Foods"),
    "ferro": ("lena.fischer@ferro-logistics.example", "Lena Fischer",
              "Hello,\n\nA quick update on the shipments dashboard: we've decided to go with another vendor for it, as it's bundled with our "
              "fleet software. Sorry it isn't better news. The export fix is working well though.\n\nLena"),
    "jonas": ("jonas@buildnotes.example", "Jonas Weber",
              "Hi again,\n\nOne more idea: we have one sponsor slot left for season three. The package is EUR 2,000 for four episodes, "
              "with a read at the start of each. If you want it, I'd need a yes by Friday 27 November.\n\nJonas"),
    "grace2": ("grace@studio-tan.example", "Grace Tan",
               "Hi,\n\nIf you approve the EUR 6,000 quote by Friday, I'll book our kick-off for 1 December and send the contract over "
               "for you to sign.\n\nGrace"),
    "oskar": ("oskar@lind-accounting.example", "Oskar Lind",
              "Hi,\n\nFor the year-end accounts my fee is EUR 1,800, the same as last year. Shall I go ahead and book it in for January? "
              "I'd need your go-ahead by 4 December.\n\nBest regards,\nOskar Lind"),
    "hannah": ("hannah@volkov-advisory.example", "Hannah Volkov",
               "Hi,\n\nv2 looks good. Unrelated: a founder friend runs a 30-person agency and is looking for exactly this kind of tool. "
               "Happy to introduce you if you like.\n\nH"),
    "lucia": ("lucia@romano.example", "Lucia Romano",
              "Hi!\n\nMy old colleague now runs operations at a 50-person logistics firm and keeps complaining about customer mail. "
              "Want me to put you two in touch?\n\nLucia"),
    "orchard": ("sana@orchard-dental.example", "Sana Iqbal",
                "Hi,\n\nThe onboarding went really well, thank you. We've just hired two hygienists: could we add two more seats from "
                "December?\n\nSana"),
    "grace": ("grace@studio-tan.example", "Grace Tan",
              "Hi,\n\nHere's my quote for the brand refresh: EUR 6,000 for the logo and the website colours, and I can start on 1 December. "
              "Shall I send over the contract?\n\nGrace"),
}


def cli(*args: str) -> dict:
    out = subprocess.run([LEMMA, "--output", "json", *args], capture_output=True, text=True, check=False)
    text = out.stdout
    if "{" not in text:
        raise SystemExit(f"lemma {' '.join(args)} failed: {out.stderr[-1500:] or text[-1500:]}")
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def rows(sql: str) -> list[dict]:
    return cli("query", "run", sql).get("items") or []


def main() -> None:
    which = [a for a in sys.argv[1:] if a in CASES] or list(CASES)
    me = rows("select email from mail_mailbox where account_id = 'sample' limit 1")[0]["email"]
    convs = {}
    for key in which:
        handle, name, text = CASES[key]
        conv = rows("select id, subject, message_count, document_path from conversation "
                    f"where counterpart_handle = '{handle}' order by last_message_at desc limit 1")[0]
        now = datetime.now(timezone.utc)
        stamp = now.isoformat()
        cli("records", "create", "message", "--data", json.dumps({
            "conversation_id": conv["id"], "source": "mail", "source_id": f"deals-test-{key}-{int(time.time())}",
            "direction": "inbound", "from_handle": handle, "from_name": name, "to_handles": [me],
            "subject": conv["subject"] if conv["subject"].lower().startswith("re:") else f"Re: {conv['subject']}",
            "sent_at": stamp, "snippet": " ".join(text.split())[:1000], "has_attachments": False}))
        block = f"\n\n## {name} <{handle}> — {now.strftime('%Y-%m-%d %H:%M')} UTC\n*To: {me}*\n\n{text}\n"
        subprocess.run([LEMMA, "files", "append", conv["document_path"], block], capture_output=True, text=True, check=True)
        cli("records", "update", "conversation", conv["id"], "--data", json.dumps({
            "last_message_at": stamp, "last_inbound_at": stamp, "last_direction": "inbound", "state": "new",
            "snippet": " ".join(text.split())[:400], "message_count": int(conv.get("message_count") or 0) + 1}))
        convs[key] = conv["id"]
        print(f"{key}: wrote Daniel-style inbound into “{conv['subject']}”".replace("Daniel-style", name + "'s"))
    began = time.monotonic()
    sort = cli("functions", "run", "mail_sort", "--data", json.dumps({"conversation_ids": list(convs.values())}))
    print(f"mail_sort: {sort.get('status')} {(sort.get('output_data') or {}).get('message')} ({time.monotonic() - began:.0f}s)")
    sorted_at = time.monotonic()
    pending = dict(convs)
    seen_reads: dict[str, dict] = {}
    while pending and time.monotonic() - sorted_at < 150:
        time.sleep(5)
        for key, cid in list(pending.items()):
            got = rows("select id, changes_deal, changes_confidence, kinds, kinds_confidence, outcome, proposals, created_at "
                       f"from deals_read where conversation_id = '{cid}' and trigger = 'listen' order by created_at desc limit 1")
            if not got or got[0]["created_at"] < datetime.fromtimestamp(time.time() - (time.monotonic() - began) - 5, timezone.utc).isoformat():
                continue
            r = got[0]
            if r["outcome"] == "asked":
                continue  # the extractor is still working
            seen_reads[key] = r
            print(f"{key}: {r['changes_deal']} ({r['changes_confidence']:.2f}) kinds={r['kinds']} ({r['kinds_confidence']}) -> "
                  f"{r['outcome']}, {r['proposals']} proposed, {time.monotonic() - sorted_at:.0f}s after the sort")
            for c in rows(f"select kind, deal_name, value, quote, speaker from deals_change where read_id = '{r['id']}'"):
                print(f"    {c['kind']:10} {c.get('deal_name')} {json.dumps(c['value'])}\n               “{c['quote']}” — {c.get('speaker')}")
            del pending[key]
    for key in pending:
        print(f"{key}: no read after {time.monotonic() - sorted_at:.0f}s")


if __name__ == "__main__":
    main()
