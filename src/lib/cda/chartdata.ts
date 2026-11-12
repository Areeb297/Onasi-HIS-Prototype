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

/** Discharge disposition "Died": SNOMED CT 79779006 in CS-Adm-DischargeDisposition. "20" is the older HL7 code, kept for saved data. */
export const isDeathDisposition = (code: string | undefined): boolean => code === "79779006" || code === "20";
export const isDead = (i: DocInput): boolean => isDeathDisposition(i.enc.disposition);

export const isStillbirth = (i: DocInput): boolean =>
  i.forms("delivery-outcomes").some((r) => /^still/i.test(str(r.values.birthStatus)));

export function dispositionLabel(code?: string): string {
  const d = DISPOSITIONS.find((x) => x.code === code);
  return d ? d.label : code ? `Code ${code}` : "";
}

/**
 * Start and end of the encounter in local "YYYY-MM-DDTHH:mm".
 * For an operative note they are the operation start and end ("Operative Datetime In" and "Out", CDA Header by Document Type,
 * page 15925336 row 7), read from the Operation Request form. The visit times are never used in their place.
 */
export function encounterTimes(i: DocInput): { start: string; end: string } {
  if (i.type === "operative") {
    const r = latest(i, "operation-request");
    return { start: pick(r, ["operationStart"]), end: pick(r, ["operationEnd"]) };
  }
  const e = i.enc;
  return { start: e.admitAt ?? e.expectedAdmitAt ?? "", end: e.dischargeAt ?? "" };
}

/** Time of birth from the delivery record, or the admission time when it is missing. */
export const deliveredAt = (i: DocInput): string => pick(latest(i, "delivery-outcomes"), ["deliveredAt"]) || i.enc.admitAt || i.enc.expectedAdmitAt || "";

/** True when a nurse ticked "No known allergies" on the Nursing Initial Assessment. */
export const noKnownAllergies = (i: DocInput): boolean => !!pick(latest(i, "nursing-initial-assessment"), ["noKnownAllergies"]);

/** Date a procedure was done. PR1-5 needs one, and the Pr model has none, so it comes from the operation request or the visit. */
export function procedureDate(i: Pick<DocInput, "enc" | "forms">): string {
  const req = i.forms("operation-request");
  const d = pick(req[req.length - 1], ["preferredDate"]);
  if (d) return d;
  return (i.enc.dischargeAt ?? i.enc.admitAt ?? "").slice(0, 10);
}

/**
 * The baby's own Health ID (temporary or permanent), typed on the Delivery Outcomes form.
 * It is issued by the national Health ID service (Workflows page 54755960, Exception 2). The app never makes one up.
 */
export const babyHealthId = (i: DocInput): string => pick(latest(i, "delivery-outcomes"), ["babyHealthId"]).trim();
