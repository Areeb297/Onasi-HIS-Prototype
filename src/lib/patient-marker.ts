import type { Patient } from "./model";

/**
 * A small coloured marker per patient (colour plus initials), shown on the patient's chart tab and as a band on the
 * chart, so a clinician sees at a glance which patient a screen belongs to. The colour is stable: the same patient
 * always gets the same colour, on every screen and after a reload.
 *
 * Colours come from the Onasi brand ramps (Dark Green, deep teal, mint, cyan, neutral). Dark fills carry white text and
 * light fills carry Dark Green text, so neighbouring patients differ in lightness as well as hue, and every pair passes
 * WCAG AA for the initials.
 */

export interface MarkerColor { bg: string; fg: string; name: string }

export const PATIENT_COLORS: readonly MarkerColor[] = [
  { bg: "#032C26", fg: "#FFFFFF", name: "Dark Green" },
  { bg: "#39EDD5", fg: "#032C26", name: "Cyan" },
  { bg: "#016B5F", fg: "#FFFFFF", name: "Deep Teal" },
  { bg: "#0CE69F", fg: "#032C26", name: "Mint" },
  { bg: "#4A554E", fg: "#FFFFFF", name: "Slate" },
  { bg: "#03C1AC", fg: "#032C26", name: "Sea" },
  { bg: "#00704F", fg: "#FFFFFF", name: "Forest" },
  // Pale Mint, not Minty White: Minty White almost disappears on the light green page.
  { bg: "#A6F0CF", fg: "#032C26", name: "Pale Mint" },
];

/** A confidential patient whose glass is not broken gets this neutral marker and no initials. */
export const NEUTRAL_MARKER: MarkerColor = { bg: "#D5DCD8", fg: "#3B4540", name: "Neutral" };

/** FNV-1a: a small, stable hash, so a patient id always maps to the same colour. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const patientColor = (patientId: string): MarkerColor => PATIENT_COLORS[hashId(patientId) % PATIENT_COLORS.length];

export function initialsOf(p: Pick<Patient, "given" | "family">): string {
  const first = (s: string | undefined) => (s ?? "").trim().charAt(0).toUpperCase();
  return `${first(p.given)}${first(p.family)}` || "?";
}

export interface PatientMarker extends MarkerColor { initials: string; masked: boolean }

/** The marker for a patient. `masked` is true for a confidential patient whose glass is not broken. */
export function patientMarker(p: Pick<Patient, "id" | "given" | "family">, masked: boolean): PatientMarker {
  return masked ? { ...NEUTRAL_MARKER, initials: "", masked: true } : { ...patientColor(p.id), initials: initialsOf(p), masked: false };
}
