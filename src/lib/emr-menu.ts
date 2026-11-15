import type { FormGroup } from "./schema";

/**
 * The left menu of the patient chart. "native" sections have their own component.
 * "form" sections are rendered by the generic form engine from src/lib/emr-forms.ts.
 */
export type EmrGroup = "General" | Exclude<FormGroup, "General">;

export type NativeId =
  | "overview" | "complaints" | "vitals" | "diagnosis" | "prescription" | "procedures" | "allergies"
  | "laboratory" | "radiology" | "notes" | "soap" | "documents" | "adt" | "surgery"
  | "emar" | "follow-up" | "consults" | "sick-leave";

export interface EmrItem {
  id: string;
  label: string;
  group: EmrGroup;
  kind: "native" | "form";
  /** Required permission to see it. */
  nursingOnly?: boolean;
}

const n = (id: NativeId, label: string, group: EmrGroup = "General"): EmrItem => ({ id, label, group, kind: "native" });
const f = (id: string, label: string, group: EmrGroup): EmrItem => ({ id, label, group, kind: "form" });

export const EMR_MENU: EmrItem[] = [
  n("overview", "Overview"),
  n("complaints", "Chief Complaints"),
  n("vitals", "Vitals"),
  n("diagnosis", "Diagnosis"),
  n("prescription", "Prescription"),
  n("emar", "Medication Chart"),
  n("procedures", "Procedures"),
  n("allergies", "Allergies"),
  n("laboratory", "Laboratory"),
  n("radiology", "Radiology"),
  n("notes", "Progress Notes"),
  f("nurse-notes", "Nurse Notes", "General"),
  f("attachments", "Attachments", "General"),
  f("toxicology-screening", "Toxicology Screening", "General"),
  f("medical-history", "Medical History", "General"),
  f("medical-devices", "Medical Devices", "General"),
  f("treatment-plan", "Treatment Plan", "General"),
  f("patient-education", "Patient Education", "General"),
  n("soap", "SOAP Notes"),
  f("patient-education-library", "Patient Education Library", "General"),
  f("refer-patient", "Refer Patient", "General"),
  n("consults", "Consult Requests"),
  n("follow-up", "Follow-Up"),
  n("sick-leave", "Sick Leave"),
  n("documents", "Clinical Documents"),
  n("adt", "ADT Messages"),

  f("rehab-initial-assessment", "Initial Assessment", "Rehab"),
  f("rehab-family-assessment", "Family Assessment", "Rehab"),
  f("rehab-mental-status", "Mental Status Assessment", "Rehab"),
  f("rehab-risk-assessment", "Risk Assessment", "Rehab"),
  f("rehab-admission-screening", "Admission Screening", "Rehab"),
  f("rehab-observation-record", "Observation Record", "Rehab"),
  f("rehab-substance-seizure", "Substance Seizure Record", "Rehab"),
  f("rehab-diagnostic-criteria", "Diagnostic Criteria", "Rehab"),
  f("rehab-medical-examination", "Medical Examination", "Rehab"),
  f("rehab-beneficiary-search", "Admission Search", "Rehab"),

  f("infertility-assessment", "Infertility Assessment", "Gynecology & Antenatal (OPD)"),
  f("ovulation-induction-cycle", "Ovulation Induction Cycle", "Gynecology & Antenatal (OPD)"),
  f("menstrual-cycle", "Menstrual Cycle", "Gynecology & Antenatal (OPD)"),
  f("pregnancy", "Pregnancy", "Gynecology & Antenatal (OPD)"),
  f("prenatal-visit", "Prenatal Visit", "Gynecology & Antenatal (OPD)"),
  f("maternity-preadmission", "Maternity Pre-Admission", "Gynecology & Antenatal (OPD)"),

  f("labor-admission", "Labor & Delivery Admission Assessment", "Obstetrics & Labor (IPD)"),
  f("obstetrician-emergency-assessment", "Obstetrician Emergency Assessment", "Obstetrics & Labor (IPD)"),
  f("labor-flowsheet", "Active Labor Flowsheet", "Obstetrics & Labor (IPD)"),
  f("delivery-outcomes", "Delivery Outcomes", "Obstetrics & Labor (IPD)"),
  f("pregnancy-newborn", "Pregnancy Newborn", "Obstetrics & Labor (IPD)"),
  f("maternity-icu", "Maternity ICU Postpartum Recovery", "Obstetrics & Labor (IPD)"),
  f("newborn-ballard-score", "Newborn Ballard Score", "Obstetrics & Labor (IPD)"),

  n("surgery", "Surgery Case", "OT"),
  f("ot-roster", "OT Roster", "OT"),
  f("operation-request", "Operation Request", "OT"),
  f("pre-anesthesia-assessment", "Pre-Anesthesia Assessment", "OT"),
  f("ot-schedule", "OT Schedule", "OT"),

  f("nursing-initial-assessment", "Nursing Initial Assessment", "Nursing"),
  f("nursing-pain-assessment", "Nursing Pain Assessment", "Nursing"),
  f("nursing-pain-scale", "Nursing Pain Scale", "Nursing"),
  f("nursing-daily-reassessment", "Nursing Daily Re-assessment", "Nursing"),
  f("pediatric-fall-risk", "Pediatric Fall Risk (Humpty Dumpty)", "Nursing"),
  f("adult-fall-risk", "Adult Fall Risk (Morse)", "Nursing"),
  f("intake-output", "Daily Intake & Output", "Nursing"),
  f("turning-repositioning", "Turning & Repositioning", "Nursing"),
  f("pressure-ulcer-chart", "Pressure Ulcer Chart", "Nursing"),
  f("restraint-monitoring", "Restraint Monitoring", "Nursing"),
];

export const EMR_GROUPS: EmrGroup[] = ["General", "Rehab", "Gynecology & Antenatal (OPD)", "Obstetrics & Labor (IPD)", "OT", "Nursing"];

/* ---------- module tabs ---------- */

/**
 * The chart's module tabs, the way Epic lays out a visit: a few tabs across the top, and under a tab its sections as
 * sub-tabs, so every section is at most two clicks away. Section ids are the ones of EMR_MENU, and `?s=<id>` still
 * opens a section. Laboratory and Radiology hold both orders and results, so they sit under Orders and under Results;
 * `?t=orders` says which of the two tabs is meant, and without it Results wins.
 * Everything not named here (the specialty and general forms, ADT Messages) is under More.
 */
export type TabId = "overview" | "notes" | "orders" | "results" | "medications" | "vitals" | "problems" | "documents" | "more";

export interface EmrTabItem {
  /** A section id of EMR_MENU. */
  id: string;
  label: string;
}

export interface EmrTab {
  id: TabId;
  label: string;
  items: EmrTabItem[];
}

const pick = (id: string, label?: string): EmrTabItem => ({ id, label: label ?? EMR_MENU.find((i) => i.id === id)!.label });

const NAMED: EmrTab[] = [
  { id: "overview", label: "Overview", items: [pick("overview")] },
  { id: "notes", label: "Notes", items: [pick("notes"), pick("soap"), pick("nurse-notes")] },
  {
    id: "orders", label: "Orders",
    items: [pick("prescription"), pick("laboratory", "Laboratory Orders"), pick("radiology", "Radiology Orders"), pick("procedures"), pick("consults"), pick("follow-up"), pick("refer-patient")],
  },
  { id: "results", label: "Results", items: [pick("laboratory", "Laboratory Results"), pick("radiology", "Radiology Reports")] },
  { id: "medications", label: "Medications", items: [pick("emar")] },
  { id: "vitals", label: "Vitals", items: [pick("vitals")] },
  { id: "problems", label: "Problems", items: [pick("complaints"), pick("diagnosis"), pick("allergies")] },
  { id: "documents", label: "Documents", items: [pick("documents"), pick("attachments"), pick("sick-leave")] },
];

const named = new Set(NAMED.flatMap((t) => t.items.map((i) => i.id)));

export const EMR_TABS: EmrTab[] = [...NAMED, { id: "more", label: "More", items: EMR_MENU.filter((i) => !named.has(i.id)).map((i) => pick(i.id)) }];

/** The tab a section opens in. `wanted` (the `t` of the link) wins when that tab holds the section; else Results before Orders. */
export function tabFor(section: string, wanted?: string | null): EmrTab {
  const holds = (t: EmrTab) => t.items.some((i) => i.id === section);
  return EMR_TABS.find((t) => t.id === wanted && holds(t)) ?? EMR_TABS.find((t) => t.id === "results" && holds(t)) ?? EMR_TABS.find(holds) ?? EMR_TABS[0];
}
