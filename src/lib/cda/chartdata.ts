import type { FormRecord } from "../schema";
import { DOCTORS, DISPOSITIONS } from "../reference-data";
import type { DocInput } from "./types";

/** Reading chart data for the builders. Form fields are read by key, with a looser fallback by name. */

export const humanize = (key: string): string => {
  const s = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const str = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v === undefined || v === null || v === false ? "" : v === true ? "Yes" : String(v));

export const latest = (i: DocInput, formId: string): FormRecord | undefined => {
  const all = i.forms(formId);
  return all[all.length - 1];
};

/** First non-empty value among the keys; then any field whose name matches the pattern. */
export function pick(r: FormRecord | undefined, keys: string[], fuzzy?: RegExp): string {
  if (!r) return "";
  for (const k of keys) {
    const v = str(r.values[k]);
    if (v) return v;
  }
  if (fuzzy) for (const [k, raw] of Object.entries(r.values)) if (fuzzy.test(k) && str(raw)) return str(raw);
  return "";
}

/** "Label: value" lines for every filled field. */
export function dump(r: FormRecord | undefined, skip: string[] = []): string[] {
  if (!r) return [];
  return Object.entries(r.values)
    .filter(([k, v]) => !skip.includes(k) && str(v))
    .map(([k, v]) => `${humanize(k)}: ${str(v)}`);
}

export const doctor = (id: string) => DOCTORS.find((d) => d.id === id);
export const doctorName = (id: string): string => {
  const d = doctor(id);
  return d ? `Dr. ${d.given} ${d.family}` : "Unknown clinician";
};

export const isDead = (i: DocInput): boolean => i.enc.disposition === "20";

export const isStillbirth = (i: DocInput): boolean =>
  i.forms("delivery-outcomes").some((r) => /^still/i.test(str(r.values.birthStatus)));

export function dispositionLabel(code?: string): string {
  const d = DISPOSITIONS.find((x) => x.code === code);
  return d ? d.label : code ? `Code ${code}` : "";
}

/** Start and end of the encounter in local "YYYY-MM-DDTHH:mm". For an operative note the operation times are used if known. */
export function encounterTimes(i: DocInput): { start: string; end: string; fallback: boolean } {
  const e = i.enc;
  const start = e.admitAt ?? e.expectedAdmitAt ?? "";
  const end = e.dischargeAt ?? "";
  // The operation request records a date and a duration only, so the operation in and out times are not known exactly.
  return { start, end, fallback: i.type === "operative" };
}

/** Date a procedure was done. PR1-5 needs one, and the Pr model has none, so it comes from the operation request or the visit. */
export function procedureDate(i: Pick<DocInput, "enc" | "forms">): string {
  const req = i.forms("operation-request");
  const d = pick(req[req.length - 1], ["preferredDate"]);
  if (d) return d;
  return (i.enc.dischargeAt ?? i.enc.admitAt ?? "").slice(0, 10);
}

/** A temporary Health ID for a newborn who has none yet. Made up. */
export const newbornTempId = (motherHealthId: string): string => `8${motherHealthId.slice(1)}`;
