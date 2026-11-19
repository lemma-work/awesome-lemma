// Dates in the person's own time zone (from their settings), whatever the
// device says.

let zone: string | undefined;

export function setZone(next: string | null | undefined): void {
  zone = next || undefined;
}

// Browsers still report some zones by their old names (Chrome says
// Asia/Calcutta); the server's zone database knows only the current ones.
const ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires", "Atlantic/Faeroe": "Atlantic/Faroe",
};

export function browserZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return ALIASES[zone] || zone;
  } catch {
    return "UTC";
  }
}

const cache = new Map<string, Intl.DateTimeFormat>();
function f(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify([zone, options]);
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...options });
    cache.set(key, fmt);
  }
  return fmt;
}

export const at = (iso: string | null | undefined): Date | null => (iso ? new Date(iso) : null);

/** YYYY-MM-DD in the person's zone. */
export function dayKey(d: Date): string {
  const parts = f({ year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function clock(d: Date | null): string {
  return d ? f({ hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "";
}

export function dayName(d: Date): string {
  return f({ weekday: "long", day: "numeric", month: "short" }).format(d);
}

export function shortDay(d: Date): string {
  return f({ weekday: "short", day: "numeric", month: "short" }).format(d);
}

export function longWhen(d: Date): string {
  return f({ weekday: "long", day: "numeric", month: "long" }).format(d);
}

export function minutesBetween(a: Date | null, b: Date | null): number | null {
  return a && b ? Math.round((b.getTime() - a.getTime()) / 60000) : null;
}

export function duration(mins: number | null): string {
  if (!mins) return "";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** "today 18:00", "tomorrow 09:00", "Thu 18:00", "Thu 26 Nov 18:00". */
export function relDay(d: Date, now = new Date()): string {
  const today = dayKey(now);
  const key = dayKey(d);
  const tomorrow = dayKey(new Date(now.getTime() + 86400000));
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  const t = clock(d);
  if (key === today) return `today ${t}`;
  if (key === tomorrow) return `tomorrow ${t}`;
  if (key === yesterday) return `yesterday ${t}`;
  const days = Math.abs(d.getTime() - now.getTime()) / 86400000;
  return days < 6 ? `${f({ weekday: "short" }).format(d)} ${t}` : `${shortDay(d)} ${t}`;
}

/** The weekday index (0 Monday) of a date in the person's zone. */
export function weekday(d: Date): number {
  const name = f({ weekday: "short" }).format(d);
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
}

/** Seven day keys, Monday to Sunday, of the week `offset` weeks from now. */
export function weekDays(offset: number, now = new Date()): { key: string; date: Date }[] {
  const noon = new Date(now.getTime());
  const back = weekday(noon);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(noon.getTime() + ((i - back) + offset * 7) * 86400000);
    out.push({ key: dayKey(date), date });
  }
  return out;
}

export function weekLabel(days: { date: Date }[]): string {
  const a = days[0].date;
  const b = days[6].date;
  const month = (d: Date) => f({ month: "short" }).format(d);
  const day = (d: Date) => f({ day: "numeric" }).format(d);
  return month(a) === month(b) ? `${day(a)}–${day(b)} ${month(b)}` : `${day(a)} ${month(a)} – ${day(b)} ${month(b)}`;
}
