/* A conversation document (conversation.document_path) back into messages.
   mail_sync writes one per conversation: "# Subject", then per message
   "## Who <email> — 2026-10-08 08:09 UTC", an optional "*To: …*" line, the body. */

export interface DocMessage {
  who: string
  email?: string
  you: boolean
  when?: string
  to?: string
  body: string
}

const HEAD = /^## (.+?)(?: <([^>]+)>)? — (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC\s*$/

export function parseThreadDoc(text: string): DocMessage[] {
  const out: DocMessage[] = []
  let current: DocMessage | null = null
  const body: string[] = []
  const flush = () => {
    if (current) {
      current.body = body.join('\n').trim()
      out.push(current)
    }
    body.length = 0
  }
  for (const line of text.split('\n')) {
    const m = line.match(HEAD)
    if (m) {
      flush()
      const who = m[1].trim()
      current = { who, email: m[2], you: who === 'You', when: m[3].replace(' ', 'T') + ':00Z', body: '' }
      continue
    }
    if (!current) continue
    if (!body.length && /^\*To: .*\*$/.test(line.trim())) {
      current.to = line.trim().slice(5, -1)
      continue
    }
    body.push(line)
  }
  flush()
  return out
}
