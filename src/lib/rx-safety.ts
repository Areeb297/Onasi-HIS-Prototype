import type { Allergy } from "./model";
import { PARENTERAL, ROUTE_LABEL } from "./rx-catalogue";
import { dailyAmount, isControlled, isRaqeebScope } from "./rx-logic";
import type { Drug, UsageSetting } from "./rx-types";

/**
 * Medication safety checks. They run while the prescriber types.
 * Only a direct drug-allergy conflict ("block") needs an override reason. The rest are passive notes.
 * Supports HIMSS closed-loop medication thinking and CBAHI medication management themes.
 */

export type SafetyLevel = "block" | "error" | "warn" | "info";

export interface SafetyFinding {
  id: string;
  kind: "allergy" | "cross-allergy" | "duplicate" | "dose" | "route" | "measure" | "controlled" | "interaction" | "age";
  level: SafetyLevel;
  text: string;
  /** The allergy text that triggered the finding. */
  allergy?: string;
}

export interface OtherItem {
  drug: Drug;
  /** For example "Rx-100003". */
  where: string;
}

export interface SafetyInput {
  drug: Drug;
  dose: number;
  frequencyId: string;
  durationDays: number;
  route: string;
  refills: number;
  usage: UsageSetting;
  allergies: Allergy[];
  /** Other active, on-hold or draft items for the same visit. Leave out the item being edited. */
  others: OtherItem[];
  heightCm?: number;
  weightKg?: number;
  ageYears?: number;
}

const norm = (s: string) => s.trim().toLowerCase();

function matches(text: string, keys: string[]): boolean {
  const t = norm(text);
  if (!t) return false;
  return keys.some((k) => {
    const key = norm(k);
    return t.includes(key) || (t.length >= 4 && key.includes(t));
  });
}

export function allergyMatch(drug: Drug, allergyText: string): "direct" | "cross" | null {
  if (matches(allergyText, drug.allergyKeys)) return "direct";
  if (matches(allergyText, drug.crossKeys)) return "cross";
  return null;
}

export function checkSafety(i: SafetyInput): SafetyFinding[] {
  const out: SafetyFinding[] = [];
  const d = i.drug;

  // Drug-allergy conflicts
  for (const a of i.allergies) {
    const m = allergyMatch(d, a.text);
    if (m === "direct") {
      out.push({
        id: `allergy-${a.text}`,
        kind: "allergy",
        level: "block",
        allergy: a.text,
        text: `Allergy conflict. The patient is allergic to ${a.text} (${a.severity === "SV" ? "severe" : a.severity === "MO" ? "moderate" : "mild"}${a.reaction ? `, ${a.reaction}` : ""}). ${d.generic} is in this group.`,
      });
    } else if (m === "cross") {
      out.push({
        id: `cross-${a.text}`,
        kind: "cross-allergy",
        level: "warn",
        allergy: a.text,
        text: `Possible cross-reactivity. The patient is allergic to ${a.text}. ${d.generic} can react in some patients.`,
      });
    }
  }

  // Duplicate therapy
  for (const o of i.others) {
    if (o.drug.id === d.id) {
      out.push({ id: `dup-${o.where}-${o.drug.id}`, kind: "duplicate", level: "warn", text: `Duplicate therapy. ${d.generic} is already prescribed on this visit (${o.where}).` });
    } else if (o.drug.therapeuticClass === d.therapeuticClass) {
      out.push({
        id: `dupclass-${o.where}-${o.drug.id}`,
        kind: "duplicate",
        level: "warn",
        text: `Same class as ${o.drug.generic} (${d.therapeuticClass}), already prescribed (${o.where}).`,
      });
    }
  }

  // Opioid with benzodiazepine
  const classes = new Set(i.others.map((o) => o.drug.therapeuticClass));
  if ((d.therapeuticClass === "Opioid" && classes.has("Benzodiazepine")) || (d.therapeuticClass === "Benzodiazepine" && classes.has("Opioid"))) {
    out.push({ id: "opioid-benzo", kind: "interaction", level: "warn", text: "Opioid with a benzodiazepine can cause heavy sedation and slow breathing. Review the need." });
  }

  // Dose sanity
  if (!(i.dose > 0)) {
    out.push({ id: "dose-zero", kind: "dose", level: "error", text: "Dose must be above zero." });
  } else {
    const day = dailyAmount(d, i.dose, i.frequencyId);
    if (day > d.maxDailyDose) {
      out.push({ id: "dose-high", kind: "dose", level: "warn", text: `Daily dose ${round(day)} ${unitOf(d)} is above the usual maximum of ${d.maxDailyDose} ${unitOf(d)}.` });
    }
  }
  if (i.durationDays > 90) {
    out.push({ id: "dur-long", kind: "dose", level: "warn", text: `${i.durationDays} days is a long course. Check the duration.` });
  }

  // Route sanity
  if (!d.routes.includes(i.route)) {
    const solid = ["Tablet", "Capsule", "Patch", "Inhaler", "Suspension"].includes(d.form);
    if (solid && PARENTERAL.includes(i.route)) {
      out.push({ id: "route-bad", kind: "route", level: "error", text: `${d.form} cannot be given by ${ROUTE_LABEL[i.route] ?? i.route} route.` });
    } else {
      out.push({ id: "route-odd", kind: "route", level: "warn", text: `${ROUTE_LABEL[i.route] ?? i.route} is not a usual route for ${d.generic} ${d.form.toLowerCase()}.` });
    }
  }

  // Height and weight are mandatory in the prescription bundle
  const missing = [!(i.heightCm && i.heightCm > 0) && "height", !(i.weightKg && i.weightKg > 0) && "weight"].filter(Boolean);
  if (missing.length) {
    out.push({ id: "measure", kind: "measure", level: "warn", text: `Add ${missing.join(" and ")} before sending. nphies needs both on every prescription.` });
  }

  // Age based notes
  if ((i.ageYears ?? 0) >= 65 && ["Benzodiazepine", "Hypnotic", "NSAID", "Opioid"].includes(d.therapeuticClass)) {
    out.push({ id: "age-65", kind: "age", level: "info", text: `Patient is ${i.ageYears}. ${d.therapeuticClass} drugs carry more risk in older adults. Use the lowest dose.` });
  }

  // Controlled drug rules
  if (isControlled(d.controlClass)) {
    if (i.refills > 0) {
      out.push({ id: "ctrl-refill", kind: "controlled", level: "error", text: "Repeats and refills are not allowed for narcotic, controlled or restricted items." });
    }
    if (i.durationDays > 30) {
      out.push({ id: "ctrl-days", kind: "controlled", level: "warn", text: "Controlled drugs are usually limited to 30 days. Check the local policy." });
    }
    out.push({
      id: "ctrl-scope",
      kind: "controlled",
      level: "info",
      text: isRaqeebScope(true, i.usage)
        ? "Raqeeb item. A Raqeeb reference id is issued when this prescription is accepted. It is needed to cancel or change it."
        : "Inpatient use is outside the Raqeeb scope. No Raqeeb reference id is issued.",
    });
  }
  return out;
}

const unitOf = (d: Drug) => d.strengthUnit.split("/")[0];
const round = (n: number) => Math.round(n * 100) / 100;

export const hasBlock = (f: SafetyFinding[]) => f.filter((x) => x.level === "block");
export const hasError = (f: SafetyFinding[]) => f.filter((x) => x.level === "error");
