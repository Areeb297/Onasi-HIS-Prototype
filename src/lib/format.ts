/**
 * App-wide date and time text. One way to write them everywhere:
 *   time            15:48            (24 hour, never AM or PM)
 *   date            15 Nov 2026
 *   date and time   15 Nov 2026, 15:48
 *   relative        just now, 12 min ago (under an hour); older times fall back to the date and time
 *
 * The text does not depend on the browser language, so a screenshot and a test read the same on every machine.
 * Every function takes an ISO text, a "YYYY-MM-DDTHH:mm" local text, a Date or a number, and shows local time.
 * A value that is not a date gives an empty text, so a screen never shows "Invalid Date".
 */

export type DateInput = string | number | Date | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The date, or null when there is none or it is not a date. A plain "YYYY-MM-DD" is read as that local day. */
export function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.getMonth() === m - 1 ? date : null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 15:48 */
export function fmtTime(v: DateInput): string {
  const d = toDate(v);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "";
}

/** 15 Nov 2026 */
export function fmtDate(v: DateInput): string {
  const d = toDate(v);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "";
}

/** 15 Nov 2026, 15:48 */
export function fmtDateTime(v: DateInput): string {
  const d = toDate(v);
  return d ? `${fmtDate(d)}, ${fmtTime(d)}` : "";
}

/** 15 Nov, 15:48 for a time in the current year, and the full date and time for any other year. */
export function fmtShort(v: DateInput, now: DateInput = new Date()): string {
  const d = toDate(v);
  const n = toDate(now) ?? new Date();
  if (!d) return "";
  return d.getFullYear() === n.getFullYear() ? `${d.getDate()} ${MONTHS[d.getMonth()]}, ${fmtTime(d)}` : fmtDateTime(d);
}

/**
 * "just now" under a minute, "12 min ago" under an hour. From an hour on it is the date and time, because "5 h ago" has to be
 * worked out by the reader. A time in the future is shown as its date and time too.
 */
export function fmtRelative(v: DateInput, now: DateInput = new Date()): string {
  const d = toDate(v);
  const n = toDate(now) ?? new Date();
  if (!d) return "";
  const min = Math.floor((n.getTime() - d.getTime()) / 60_000);
  if (min < 0 || min >= 60) return fmtDateTime(d);
  if (min < 1) return "just now";
  return `${min} min ago`;
}

/** How long a span is: 45 min, 1 h 20 min, 2 d 3 h. */
export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** The day of the week: "Sunday", "Sun" or "S". */
export function fmtWeekday(v: DateInput, style: "long" | "short" | "narrow" = "short"): string {
  const d = toDate(v);
  if (!d) return "";
  const name = WEEKDAYS_LONG[d.getDay()];
  return style === "long" ? name : style === "short" ? name.slice(0, 3) : name.slice(0, 1);
}

/** Sun 15 Nov: for a day heading on a roster or a calendar, where the year is already clear. */
export function fmtDayHeading(v: DateInput): string {
  const d = toDate(v);
  return d ? `${fmtWeekday(d)} ${d.getDate()} ${MONTHS[d.getMonth()]}` : "";
}

/** Sunday 15 Nov 2026: today's date at the top of a dashboard. */
export function fmtLongDate(v: DateInput): string {
  const d = toDate(v);
  return d ? `${fmtWeekday(d, "long")} ${fmtDate(d)}` : "";
}

/** November 2026: a month heading. */
export function fmtMonthYear(v: DateInput): string {
  const d = toDate(v);
  return d ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : "";
}

/** 15 Nov: a day with no year, for chart axes. */
export function fmtDayMonth(v: DateInput): string {
  const d = toDate(v);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]}` : "";
}
