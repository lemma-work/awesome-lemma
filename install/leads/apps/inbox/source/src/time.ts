/* Times as a person reads them, in their own timezone. */

let zone: string | undefined
export function setZone(tz?: string | null) {
  zone = tz || undefined
}
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function parts(d: Date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** "14:05" today, "Tue" this week, "8 Oct" this year, "8 Oct 2025" older. The list's time column. */
export function short(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  if (parts(d) === parts(now)) return d.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
  const days = (now.getTime() - d.getTime()) / 86400000
  if (days < 6 && days > -1) return d.toLocaleDateString('en-GB', { timeZone: zone, weekday: 'short' })
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-GB', { timeZone: zone, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "Thu 8 Oct, 14:05". */
export function full(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** "Mon 12 Oct". */
export function day(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short' })
}

export function clock(iso?: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' })
}

export function ago(iso?: string | null): string {
  if (!iso) return ''
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** "in 3 days", "tomorrow", "overdue by 2 days". */
export function until(iso?: string | null): string {
  if (!iso) return ''
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const d = Math.round(Math.abs(s) / 86400)
  if (s < 0) return d < 1 ? 'due now' : `overdue ${d} day${d === 1 ? '' : 's'}`
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86400) return `in ${Math.round(s / 3600)} h`
  return d === 1 ? 'tomorrow' : `in ${d} days`
}

/** ISO for a local wall-clock time `days` from today at `hour` in the person's zone. */
export function localAt(days: number, hour: number, minute = 0): string {
  const now = new Date()
  const target = new Date(now.getTime() + days * 86400000)
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(target)
  // Find the UTC instant whose local time in `zone` is ymd hour:minute.
  const guess = new Date(`${ymd}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: zone }))
  const offset = shown.getTime() - new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return new Date(guess.getTime() - offset).toISOString()
}

/** Days from today to the next given weekday (1 = Monday). */
export function nextWeekday(target: number): number {
  const today = new Date().getDay()
  const diff = (target - today + 7) % 7
  return diff === 0 ? 7 : diff
}
