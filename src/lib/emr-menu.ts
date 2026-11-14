import type { FormGroup } from "./schema";

/**
 * The left menu of the patient chart. "native" sections have their own component.
 * "form" sections are rendered by the generic form engine from src/lib/emr-forms.ts.
 */
export type EmrGroup = "General" | Exclude<FormGroup, "General">;

export type NativeId =
  | "overview" | "complaints" | "vitals" | "diagnosis" | "prescription" | "procedures" | "allergies"
  | "laboratory" | "radiology" | "notes" | "soap" | "documents" | "adt" | "surgery"
  | "emar" | "follow-up" | "consults";

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
  f("e-and-m", "E&M", "General"),
  f("patient-education", "Patient Education", "General"),
  n("soap", "SOAP Notes"),
  f("refer-patient", "Refer Patient", "General"),
  n("consults", "Consult Requests"),
  n("follow-up", "Follow-Up"),
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

  f("infertility-assessment", "Infertility Assessment", "Gynecology & Antenatal (OPD)"),
  f("ovulation-induction-cycle", "Ovulation Induction Cycle", "Gynecology & Antenatal (OPD)"),

  f("delivery-outcomes", "Delivery Outcomes", "Obstetrics & Labor (IPD)"),
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
