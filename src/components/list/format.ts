import { fmtShort, toDate, type DateInput } from "@/lib/format";

/** Lists use the app-wide date and time text (24-hour) from lib/format. */
export { fmtDate, fmtDateTime, fmtTime, toDate } from "@/lib/format";

/** "15 Nov, 15:08" for the current year, the full date and time otherwise. */
export const fmtShortDateTime = (v: DateInput, now?: DateInput): string => fmtShort(v, now);

/** A sortable key for a date: its time in milliseconds, or undefined. */
export const dateKey = (v: DateInput): number | undefined => toDate(v)?.getTime();
