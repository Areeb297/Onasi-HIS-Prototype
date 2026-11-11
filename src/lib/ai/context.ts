import type { Encounter, LogEntry, Patient, Vitals } from "../model";
import type { FormRecord } from "../schema";
import type { SoapNote } from "./soap-store";

/**
 * What the assistant may look at: one open chart. The engine gets this and nothing else (data minimisation).
 * Pure data, so every rule can be tested without the app.
 */

export interface AiMed {
  name: string;
  dose?: string;
  frequency?: string;
  /** Allergy words that mean a direct conflict. */
  allergyKeys: string[];
  /** Allergy words that mean possible cross-reactivity. */
  crossKeys: string[];
}

export interface AiContext {
  enc: Encounter;
  patient: Patient;
  forms: (formId: string) => FormRecord[];
  soap: SoapNote[];
  meds: AiMed[];
  /** ADT message log entries for this visit, newest first. */
  log: LogEntry[];
  now: Date;
}

export const AI_LABEL = "AI draft. A clinician must review.";
export const SIM_NOTE = "Simulated assistant. It follows fixed rules and templates. It is not a certified medical device.";

export const ageOf = (dob: string, now: Date = new Date()): number => Math.floor((now.getTime() - new Date(dob).getTime()) / (365.25 * 86_400_000));
export const fullName = (p: Patient) => `${p.given} ${p.family}`;

/* ---------- vitals ---------- */

export interface VitalNums {
  sbp?: number;
  dbp?: number;
  pulse?: number;
  temp?: number;
  spo2?: number;
  rr?: number;
  weight?: number;
}

const n = (s: string | undefined): number | undefined => {
  const v = parseFloat(s ?? "");
  return Number.isFinite(v) ? v : undefined;
};

export function vitalNums(v: Vitals | undefined): VitalNums {
  if (!v) return {};
  const bp = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(v.bp ?? "");
  return { sbp: bp ? +bp[1] : undefined, dbp: bp ? +bp[2] : undefined, pulse: n(v.pulse), temp: n(v.temp), spo2: n(v.spo2), rr: n(v.rr), weight: n(v.weight) };
}

export function vitalsLine(v: Vitals | undefined): string {
  if (!v) return "No vital signs recorded.";
  const parts = [v.bp && `BP ${v.bp} mmHg`, v.pulse && `pulse ${v.pulse}/min`, v.temp && `temperature ${v.temp} C`, v.spo2 && `SpO2 ${v.spo2}%`, v.rr && `respiratory rate ${v.rr}/min`, v.weight && `weight ${v.weight} kg`].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "No vital signs recorded.";
}

/** Plain text of everything a clinician wrote, lower case, for keyword matching. */
export function chartText(c: AiContext): string {
  const e = c.enc;
  return [e.reason, ...e.complaints.map((x) => x.text), ...e.notes.map((x) => x.text), ...e.dx.map((d) => d.text), ...c.soap.flatMap((s) => [s.subjective, s.assessment])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function formLines(c: AiContext, formId: string, limit = 6): string[] {
  const last = c.forms(formId).slice(-1)[0];
  if (!last) return [];
  return Object.entries(last.values)
    .filter(([, v]) => v !== "" && v !== false && !(Array.isArray(v) && !v.length))
    .slice(0, limit)
    .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${Array.isArray(v) ? v.join(", ") : v === true ? "yes" : v}`);
}

export const dateOnly = (s?: string) => (s ? s.slice(0, 10) : "");
