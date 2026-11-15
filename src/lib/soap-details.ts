import { useSyncExternalStore } from "react";
import { listSoap, type SoapNote } from "./ai/soap-store";
import type { Encounter, Patient } from "./model";
import { fmtDateTime } from "./format";

/**
 * The structured parts of a SOAP note, as the HIS keeps them: history of present illness, past medical, family and
 * social history, physical examination, risk factors, follow-up and patient education. Kept beside the SOAP note
 * (src/lib/ai/soap-store.ts) by note id, so notes saved before this existed still open with these parts empty.
 * A signed note is locked: its details cannot change.
 */

export interface SoapDetail {
  chiefComplaint: string;
  hpi: string;
  pastMedical: string;
  familyHistory: string;
  socialHistory: string;
  vitalSigns: string;
  physicalExam: string;
  diagnosis: string;
  riskFactors: string[];
  proceduresOrTests: string;
  followUp: string;
  patientEducation: string;
}

export type SoapTextKey = Exclude<keyof SoapDetail, "riskFactors">;

export const EMPTY_DETAIL: SoapDetail = {
  chiefComplaint: "", hpi: "", pastMedical: "", familyHistory: "", socialHistory: "", vitalSigns: "", physicalExam: "",
  diagnosis: "", riskFactors: [], proceduresOrTests: "", followUp: "", patientEducation: "",
};

/** Sub-fields under each SOAP letter, in the order the HIS shows them. */
export const DETAIL_FIELDS: Record<"subjective" | "objective" | "assessment" | "plan", { key: SoapTextKey; label: string; hint?: string }[]> = {
  subjective: [
    { key: "chiefComplaint", label: "Chief Complaint" },
    { key: "hpi", label: "History Of Present Illness", hint: "How it started, how long, what makes it better or worse." },
    { key: "pastMedical", label: "Past Medical History" },
    { key: "familyHistory", label: "Family History" },
    { key: "socialHistory", label: "Social History", hint: "Smoking, work, living situation." },
  ],
  objective: [
    { key: "vitalSigns", label: "Vital Signs" },
    { key: "physicalExam", label: "Physical Examination" },
  ],
  assessment: [
    { key: "diagnosis", label: "Diagnosis" },
  ],
  plan: [
    { key: "proceduresOrTests", label: "Procedures Or Tests" },
    { key: "followUp", label: "Follow-Up Instructions" },
    { key: "patientEducation", label: "Patient Education" },
  ],
};

export const RISK_FACTORS = [
  "Smoking", "Diabetes", "High blood pressure", "High cholesterol", "Obesity", "Family history of heart disease", "Older age",
  "Pregnancy", "Weak immune system", "Chronic kidney disease", "Recent surgery", "Lives alone",
];

/* ---------- store ---------- */

const KEY = "onasi-emr-soap-detail-v1";
let details: Record<string, SoapDetail> = {};
try {
  const raw = localStorage.getItem(KEY);
  if (raw) details = JSON.parse(raw) as Record<string, SoapDetail>;
} catch {
  /* storage may be blocked */
}
const listeners = new Set<() => void>();

function commit(next: Record<string, SoapDetail>) {
  details = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(details));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSoapDetails(): Record<string, SoapDetail> {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => details, () => details);
}

/** The details of a note, with every part present. Empty for a note saved before details existed. */
export function detailOf(noteId: string, all: Record<string, SoapDetail> = details): SoapDetail {
  return { ...EMPTY_DETAIL, ...(all[noteId] ?? {}) };
}

export const hasDetail = (d: SoapDetail): boolean =>
  d.riskFactors.length > 0 || (Object.keys(EMPTY_DETAIL) as (keyof SoapDetail)[]).some((k) => k !== "riskFactors" && !!(d[k] as string).trim());

/** Saves the details of a draft note. Refuses a signed note. */
export function saveSoapDetail(visit: string, noteId: string, d: SoapDetail): boolean {
  const note = listSoap(visit).find((n) => n.id === noteId);
  if (!note || note.status === "signed") return false;
  commit({ ...details, [noteId]: { ...EMPTY_DETAIL, ...d, riskFactors: [...new Set(d.riskFactors.map((r) => r.trim()).filter(Boolean))] } });
  return true;
}

export function deleteSoapDetail(noteId: string) {
  if (!details[noteId]) return;
  const next = { ...details };
  delete next[noteId];
  commit(next);
}

export const resetSoapDetails = () => commit({});

/* ---------- helpers ---------- */

/** Parts that can be filled from the chart: complaints, latest vital signs and diagnoses. Only empty parts are filled. */
export function fillFromChart(d: SoapDetail, enc: Encounter): SoapDetail {
  const v = enc.vitals;
  const vitals = v ? [v.bp && `BP ${v.bp} mmHg`, v.pulse && `Pulse ${v.pulse}/min`, v.rr && `Breathing ${v.rr}/min`, v.temp && `Temperature ${v.temp} °C`, v.spo2 && `SpO2 ${v.spo2}%`, v.weight && `Weight ${v.weight} kg`].filter(Boolean).join(", ") : "";
  return {
    ...d,
    chiefComplaint: d.chiefComplaint || enc.complaints.map((c) => c.text).join(", ") || enc.reason || "",
    vitalSigns: d.vitalSigns || vitals,
    diagnosis: d.diagnosis || enc.dx.map((x) => `${x.code} ${x.text}`).join("; "),
  };
}

const stamp = (iso?: string) => (iso ? fmtDateTime(iso) : "");
const line = (label: string, value: string) => `${label}: ${value.trim() || "Not recorded"}`;

/** The note as plain text, for Download. */
export function soapText(note: SoapNote, d: SoapDetail, patient: Pick<Patient, "given" | "family" | "mrn" | "dob">, hospital: string): string {
  const out: string[] = [
    `${hospital}`,
    "SOAP NOTE",
    "",
    line("Patient", `${patient.given} ${patient.family}`),
    line("MRN", patient.mrn),
    line("Date Of Birth", patient.dob),
    line("Visit", note.visit),
    line("Written", `${stamp(note.at)} by ${note.author}`),
    line("Status", note.status === "signed" ? `Signed by ${note.signedBy} on ${stamp(note.signedAt)}` : "Draft, not signed"),
    "",
    "SUBJECTIVE",
    note.subjective.trim() || "Not recorded",
    ...DETAIL_FIELDS.subjective.map((f) => line(f.label, d[f.key])),
    "",
    "OBJECTIVE",
    note.objective.trim() || "Not recorded",
    ...DETAIL_FIELDS.objective.map((f) => line(f.label, d[f.key])),
    "",
    "ASSESSMENT",
    note.assessment.trim() || "Not recorded",
    ...DETAIL_FIELDS.assessment.map((f) => line(f.label, d[f.key])),
    line("Risk Factors", d.riskFactors.join(", ")),
    "",
    "PLAN",
    note.plan.trim() || "Not recorded",
    ...DETAIL_FIELDS.plan.map((f) => line(f.label, d[f.key])),
    "",
  ];
  if (note.aiDrafted) out.push("This note started from an AI draft and was reviewed by the clinician.");
  return out.join("\n");
}

export const soapFileName = (note: SoapNote): string => `SOAP_Note_${note.visit}_${note.at.slice(0, 10)}_${note.id}.txt`;
