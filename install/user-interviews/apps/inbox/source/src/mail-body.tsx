import { Fragment, useState, type ReactNode } from 'react'
import { ImageIcon, MoreHorizontal } from 'lucide-react'

/* A message body, from the text in the thread document to something you read.

   The document is plain text with a little markdown: mail_sync turns HTML mail
   into paragraphs and keeps links as [label](url). Older documents (and some
   support desks' "plain text" parts) still hold raw HTML, so that is cleaned
   here too, through DOMParser, which builds an inert document: no scripts run
   and no images load. Nothing from a message is ever set as HTML. */

const LOOKS_HTML = /<(p|div|br|table|span|html|body|strong|a|ul|ol|li|font|b|i|em)[\s>/]/i
const BLOCK = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL'])
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE'])

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.textContent || '').replace(/\s+/g, ' '))
      return
    }
    if (!(node instanceof Element) || SKIP.has(node.tagName)) return
    const block = BLOCK.has(node.tagName)
    if (block) out.push('\n')
    if (node.tagName === 'LI') out.push('• ')
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      const label = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (/^https?:\/\//i.test(href) && label && label !== href && !/^(https?:\/\/|www\.)/i.test(label)) {
        out.push(`[${label.replace(/[[\]]/g, '')}](${href})`)
        return
      }
    }
    node.childNodes.forEach(walk)
    if (block && node.tagName !== 'BR') out.push('\n')
  }
  walk(doc.body)
  return out
    .join('')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The text to show, whatever the document holds. */
export function cleanBody(raw: string): string {
  const text = (raw || '').replace(/\r\n?/g, '\n')
  const clean = LOOKS_HTML.test(text) ? htmlToText(text) : text
  // A reply's own text ends where the history it quotes begins; older documents
  // kept the "On Tue, … wrote:" line that introduced it.
  return clean.replace(/\n*On [^\n]{4,200}(\n[^\n]{0,120})?\s*wrote:\s*$/i, '').trim()
}

/** One line for a folded message: no links, no placeholders, no signature. */
export function peek(raw: string): string {
  return splitSignature(cleanBody(raw))
    .body.replace(/\[image: [^\]]*\]/g, '')
    .replace(MD_LINK, '$1')
    .replace(/^>.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const SIGN_OFF = /^(sent from my \w+|get outlook for \w+|sent from (mail|outlook) for \w+)/i
const MARKER = /^--\s?$/
const MD_LINK = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g
// "This message and its attachments are intended only for…"
const NOTICE = /^(this (e-?mail|message|communication|transmission)|confidential|disclaimer|the (information|contents?) (contained |in |of )|notice:|caution:|privileged|important:)/i
// What a signature line looks like: a bar of links, a phone, a title, a firm.
const SIG_CUE = /(\||\b(ph|phone|tel|mob|mobile|cell|fax|m|t)\s?[.:]\s*\+?\d|\+\d[\d\s()-]{7,}|\blinked\s?in\b|\btwitter\b|\b(partners?|advisors?|capital|ventures|inc|llc|ltd|pvt|founder|co-founder|ceo|cto|coo|cfo|vp|director|manager|head of|principal|associate|analyst)\b)/i

function isNotice(para: string): boolean {
  return para.length > 100 && NOTICE.test(para.trim())
}

/* Where a message's own words stop. An explicit "-- " or "Sent from my…" line
   says so; otherwise trailing paragraphs that look like a signature (short,
   no sentence, a cue such as "|", a phone, a title) or a legal notice are
   taken off the end, never the first paragraph. */
function splitSignature(text: string): { body: string; signature: string; notice: string } {
  const lines = text.split('\n')
  const at = lines.findIndex((l) => MARKER.test(l) || SIGN_OFF.test(l.trim()))
  let body = text.trim()
  let tail: string[] = []
  if (at >= 0) {
    body = lines.slice(0, at).join('\n').trim()
    tail = lines.slice(MARKER.test(lines[at]) ? at + 1 : at).join('\n').split(/\n\s*\n/)
  } else {
    const paras = body.split(/\n\s*\n/)
    let cut = paras.length
    for (let i = paras.length - 1; i > 0; i--) {
      const p = paras[i].trim()
      // Judge length on what shows: a [label](url) link is as long as its label.
      const plines = p.replace(MD_LINK, '$1').split('\n')
      const sentence = /[.?!]$/.test(p) && p.split(/\s+/).length >= 5
      const sig = plines.length <= 4 && plines.every((l) => l.length <= 72) && !sentence && SIG_CUE.test(p)
      if (isNotice(p) || sig) cut = i
      else break
    }
    body = paras.slice(0, cut).join('\n\n').trim()
    tail = paras.slice(cut)
  }
  const notice = tail.filter(isNotice).join('\n\n').trim()
  const signature = tail.filter((p) => !isNotice(p)).join('\n\n').trim()
  return { body, signature, notice }
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'quote'; text: string }

const LIST_ITEM = /^\s*([-*•]|\d{1,2}[.)])\s+/

/* Plain-text mail is hard-wrapped near 72 columns. Put a wrapped line back
   together with the next one, so text flows to the reader's width; keep real
   breaks (short lines, list items, addresses, sign-offs). */
function unwrap(lines: string[]): string[] {
  const out: string[] = []
  let prev = '' // the previous raw line: a joined line is long, the wrap it came from was not
  for (const line of lines) {
    const wrapped = out.length > 0 && prev.length >= 58 && prev.length <= 80 && !prev.endsWith(':') && !LIST_ITEM.test(line) && !line.startsWith('[image:')
    if (wrapped) out[out.length - 1] += ' ' + line.trim()
    else out.push(line)
    prev = line
  }
  return out
}

function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    if (lines.every((l) => l.trim().startsWith('>'))) {
      const quote = lines.map((l) => l.trim().replace(/^>\s?/, '')).join('\n')
      const last = out[out.length - 1]
      if (last?.kind === 'quote') last.text += '\n\n' + quote
      else out.push({ kind: 'quote', text: quote })
      continue
    }
    out.push({ kind: 'p', lines: unwrap(lines) })
  }
  return out
}

const TOKEN = /\[image: ([^\]]+)\]|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g

function shortUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('www.') ? 'https://' + url : url)
    const path = u.pathname === '/' ? '' : u.pathname
    const shown = u.host.replace(/^www\./, '') + path
    return shown.length > 44 ? shown.slice(0, 42) + '…' : shown
  } catch {
    return url.length > 44 ? url.slice(0, 42) + '…' : url
  }
}

function inline(line: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push(line.slice(last, at))
    const k = `${key}-${n++}`
    if (m[1]) {
      out.push(
        <span key={k} className="mb-file">
          <ImageIcon size={12} aria-hidden="true" /> {m[1]}
        </span>,
      )
    } else if (m[2] && m[3]) {
      out.push(
        <a key={k} href={m[3]} target="_blank" rel="noopener noreferrer" title={m[3]}>
          {m[2]}
        </a>,
      )
    } else if (m[4]) {
      // Trailing punctuation belongs to the sentence, not the address.
      const url = m[4].replace(/[.,;:!?)\]'"]+$/, '')
      out.push(
        <a key={k} href={url.startsWith('www.') ? 'https://' + url : url} target="_blank" rel="noopener noreferrer" title={url}>
          {shortUrl(url)}
        </a>,
      )
      if (url.length < m[4].length) out.push(m[4].slice(url.length))
    } else if (m[5]) {
      out.push(
        <a key={k} href={`mailto:${m[5]}`}>
          {m[5]}
        </a>,
      )
    }
    last = at + m[0].length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}

function Lines({ lines, id }: { lines: string[]; id: string }) {
  return (
    <>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 ? <br /> : null}
          {inline(l, `${id}-${i}`)}
        </Fragment>
      ))}
    </>
  )
}

function Quote({ text, id }: { text: string; id: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-quote">
      <button type="button" className="mb-dots" onClick={() => setOpen((v) => !v)} aria-expanded={open} title={open ? 'Hide quoted text' : 'Show quoted text'}>
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <blockquote>
          {blocks(text).map((b, i) => (b.kind === 'p' ? <p key={i}><Lines lines={b.lines} id={`${id}-q${i}`} /></p> : null))}
        </blockquote>
      ) : null}
    </div>
  )
}

function Notice({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-notice">
      <button type="button" className="m-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? 'Hide legal notice' : 'Legal notice'}
      </button>
      {open ? <p>{text}</p> : null}
    </div>
  )
}

export function MailBody({ text }: { text: string }) {
  const { body, signature, notice } = splitSignature(cleanBody(text))
  const parts = blocks(body)
  return (
    <div className="mb">
      {parts.length ? (
        parts.map((b, i) => (b.kind === 'quote' ? <Quote key={i} text={b.text} id={`b${i}`} /> : <p key={i}><Lines lines={b.lines} id={`b${i}`} /></p>))
      ) : (
        <p className="c-muted">No text in this message.</p>
      )}
      {signature ? (
        <div className="mb-sig">
          {signature.split(/\n\s*\n/).map((s, i) => (
            <p key={i}>
              <Lines lines={s.split('\n')} id={`s${i}`} />
            </p>
          ))}
        </div>
      ) : null}
      {notice ? <Notice text={notice} /> : null}
    </div>
  )
}
