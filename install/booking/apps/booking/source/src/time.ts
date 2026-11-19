// Times, said the same way on the visitor's page and the members' side.
//
// Everything is stored in UTC. A visitor sees times in their own zone (which
// they can change); a member sees their own. Browsers still report a few
// zones by old names (Chrome says Asia/Calcutta), which the functions' zone
// database does not know, so they are mapped to the current ones.

const RENAMED: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon", "Europe/Kiev": "Europe/Kyiv", "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Atlantic/Faeroe": "Atlantic/Faroe", "US/Eastern": "America/New_York", "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles", "Etc/UTC": "UTC", GMT: "UTC",
};

export function current(zone: string): string {
  return RENAMED[zone] || zone;
}

export function browserZone(): string {
  try {
    return current(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  } catch {
    return "UTC";
  }
}

export function zones(include: string[] = []): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone").map(current);
  } catch {
    all = [];
  }
  return [...new Set([...include.filter(Boolean), ...all])].sort();
}

/** "New York", "Kolkata", "UTC". */
export function place(zone: string): string {
  if (!zone || zone === "UTC") return "UTC";
  return zone.split("/").pop()!.replace(/_/g, " ");
}

function parts(date: Date, zone: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, ...opts }).format(date);
}

/** 3:30 pm */
export function clock(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" })
    .format(date).replace(" AM", " am").replace(" PM", " pm");
}

/** 2026-11-24, the day as the zone sees it. */
export function dayKey(date: Date, zone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return p;
}

/** Tue */
export function weekday(date: Date, zone: string): string {
  return parts(date, zone, { weekday: "short" });
}

/** 24 Nov */
export function dayMonth(date: Date, zone: string): string {
  return parts(date, zone, { day: "numeric", month: "short" });
}

/** Tuesday 24 November */
export function longDay(date: Date, zone: string): string {
  return parts(date, zone, { weekday: "long", day: "numeric", month: "long" });
}

/** Tue 24 Nov */
export function shortDay(date: Date, zone: string): string {
  return parts(date, zone, { weekday: "short", day: "numeric", month: "short" });
}

/** Tuesday 24 November, 3:30 – 4:00 pm */
export function span(start: Date, end: Date, zone: string): string {
  const a = clock(start, zone);
  const b = clock(end, zone);
  const same = a.slice(-2) === b.slice(-2);
  return `${longDay(start, zone)}, ${same ? a.slice(0, -3) : a} – ${b}`;
}

/** The zone's offset from UTC now, like "UTC+5:30". */
export function offset(zone: string, at = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "";
    return name.replace("GMT", "UTC") || "UTC";
  } catch {
    return "";
  }
}

/** Minutes, said plainly: 30 minutes, 1 hour, 1 hour 30. */
export function length(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hour${h > 1 ? "s" : ""}${m ? ` ${m}` : ""}`;
}

export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function daysText(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (d.join() === "0,1,2,3,4") return "Monday to Friday";
  if (d.length > 2 && d[d.length - 1] - d[0] === d.length - 1) return `${DAY_NAMES[d[0]]} to ${DAY_NAMES[d[d.length - 1]]}`;
  return d.map((x) => DAY_NAMES[x]).join(", ");
}
