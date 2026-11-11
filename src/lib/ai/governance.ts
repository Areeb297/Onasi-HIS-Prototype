import type { AuditEntry } from "../audit";
import type { UseCaseId } from "./engine";

/**
 * AI governance data: the use case register, the usage statistics, and the checklists.
 * Statuses are honest. The assistant is a simulated decision-support aid. It is not a certified medical device.
 */

export type Risk = "Low" | "Medium" | "High";
export type Status = "Applied" | "Partial" | "Not applied";

export interface RegisterRow {
  id: Exclude<UseCaseId, "help">;
  name: string;
  purpose: string;
  data: string;
  risk: Risk;
  /** Why this risk rating. It is the Onasi team's own rating, not a regulator's classification. */
  riskWhy: string;
  hitl: string;
  status: string;
}

const PROTO = "Simulated with rules.";

export const REGISTER: RegisterRow[] = [
  { id: "soap", name: "Draft a SOAP note", purpose: "Save typing time by pre-filling a note from the chart.", data: "Complaints, vitals, diagnoses, allergies, notes, exam forms, prescriptions", risk: "Medium", riskWhy: "Wrong text could be signed without a careful read.", hitl: "Clinician edits, saves, and co-signs. Nothing is signed automatically.", status: PROTO },
  { id: "cds", name: "Clinical decision support", purpose: "Point out drug-allergy conflicts, abnormal vitals, a qSOFA screen and gaps before discharge.", data: "Allergies, prescriptions, vitals, diagnoses, disposition", risk: "High", riskWhy: "It can influence treatment. Software that advises on diagnosis or treatment may count as a medical device.", hitl: "Alerts are advice. The clinician decides. Accept only records that the alert was read.", status: PROTO + " Rules are not clinically validated." },
  { id: "codes", name: "Suggest diagnosis codes", purpose: "Suggest ICD-10-AM and SNOMED CT codes from complaints and notes.", data: "Complaints, visit reason, notes, SOAP text", risk: "Medium", riskWhy: "Wrong codes affect records, statistics and billing.", hitl: "Each code is ticked by the clinician. Accepted codes enter as working diagnoses.", status: PROTO + " Small built-in dictionary." },
  { id: "discharge", name: "Draft discharge summary text", purpose: "Assemble a discharge summary from the stay.", data: "Visit, diagnoses, procedures, notes, vitals, allergies, prescriptions, disposition", risk: "Medium", riskWhy: "A discharge summary guides later care.", hitl: "Clinician edits, then accepts. It enters as a progress note, not as a signed document.", status: PROTO },
  { id: "summary", name: "Summarise the chart", purpose: "Give a short overview of the open chart.", data: "The open chart", risk: "Low", riskWhy: "It repeats what is already in the chart.", hitl: "Clinician reads and accepts or rejects.", status: PROTO },
  { id: "education", name: "Patient education leaflet", purpose: "Give the patient simple advice in English, and short Arabic for four topics.", data: "Diagnoses, complaints, the question asked", risk: "Low", riskWhy: "Patient-facing, but general advice only. Translation risk exists.", hitl: "Clinician reads it before it is shared. A qualified person checks the Arabic.", status: PROTO },
  { id: "orders", name: "Suggest orders", purpose: "Suggest lab and imaging tests for a complaint.", data: "Complaints, visit reason", risk: "Medium", riskWhy: "Over-ordering or missing a test.", hitl: "Suggestions are text. The clinician places any order in the Laboratory or Radiology tab.", status: PROTO },
  { id: "nphies-error", name: "Explain an NPHIES validation error", purpose: "Explain a failed or warned ADT check in plain words and say how to fix it.", data: "The last ADT message log entry for the visit (checks only)", risk: "Low", riskWhy: "It explains system checks. It does not touch clinical content.", hitl: "The user decides whether to follow the fix.", status: PROTO },
  { id: "quality", name: "Documentation quality check", purpose: "Find missing allergies, diagnosis, procedure date and similar gaps.", data: "The open chart", risk: "Low", riskWhy: "Reminders only.", hitl: "The user decides what to fix.", status: PROTO },
];

/* ---------- usage statistics from the audit trail ---------- */

export interface Usage {
  suggested: number;
  accepted: number;
  rejected: number;
  edited: number;
  /** accepted / (accepted + rejected). Null when nothing has been decided yet. */
  acceptance: number | null;
}

const useCaseOf = (e: AuditEntry): string => /^AI ([\w-]+):/.exec(e.target)?.[1] ?? "other";

export const isAi = (e: AuditEntry) => e.action === "ai-suggest" || e.action === "ai-accept" || e.action === "ai-reject";

export function usageOf(entries: AuditEntry[], useCase?: string): Usage {
  const ai = entries.filter((e) => isAi(e) && (!useCase || useCaseOf(e) === useCase));
  const suggested = ai.filter((e) => e.action === "ai-suggest").length;
  const acc = ai.filter((e) => e.action === "ai-accept");
  const rejected = ai.filter((e) => e.action === "ai-reject").length;
  const edited = acc.filter((e) => /Edited before accepting/.test(e.detail ?? "")).length;
  const decided = acc.length + rejected;
  return { suggested, accepted: acc.length, rejected, edited, acceptance: decided ? acc.length / decided : null };
}

export const aiUseCase = useCaseOf;

/* ---------- checklists ---------- */

export interface Item {
  id: string;
  requirement: string;
  how: string;
  status: Status;
}

export interface Framework {
  id: string;
  name: string;
  note: string;
  items: Item[];
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "sdaia",
    name: "SDAIA AI Ethics Principles",
    note: "Published by the Saudi Data and AI Authority in September 2023. These are principles, not binding legislation. This table is the Onasi team's reading, not an assessment by SDAIA.",
    items: [
      { id: "fair", requirement: "Fairness: avoid unfair bias", how: "Rules are fixed and the same for every patient. No bias testing was done. Arabic leaflets exist for only four topics.", status: "Not applied" },
      { id: "privacy", requirement: "Privacy and security", how: "No network calls. The engine sees only the open chart. Actions are audited. Data sits unencrypted in the browser.", status: "Partial" },
      { id: "humanity", requirement: "Humanity: people stay in control", how: "Every output is a draft with Accept, Edit and Reject. Nothing is signed, ordered or sent by the assistant.", status: "Applied" },
      { id: "social", requirement: "Social and environmental benefit", how: "Not assessed.", status: "Not applied" },
      { id: "safety", requirement: "Reliability and safety", how: "Deterministic rules with unit tests. Not clinically validated. Simple thresholds only.", status: "Partial" },
      { id: "transparency", requirement: "Transparency and explainability", how: "Each output says it is an AI draft, says it is simulated, and lists the chart fields used.", status: "Applied" },
      { id: "accountability", requirement: "Accountability and responsibility", how: "The audit trail records who asked, who accepted or rejected, and when. No named owner or incident process.", status: "Partial" },
    ],
  },
  {
    id: "pdpl",
    name: "Saudi PDPL (Personal Data Protection Law)",
    note: "Rows are themes from the law, read by the Onasi team. Not legal advice. Ask counsel before relying on any row.",
    items: [
      { id: "consent", requirement: "Consent or another lawful basis for processing", how: "The app records no consent or lawful basis for AI processing.", status: "Not applied" },
      { id: "purpose", requirement: "Purpose limitation", how: "The assistant uses the open chart only for the task asked. It does not reuse data for other purposes. Nothing technical stops a future misuse.", status: "Partial" },
      { id: "minimise", requirement: "Data minimisation", how: "Only the open chart is passed to the engine. Confidential charts are blocked unless the glass was broken. The audit log stores the source field names, not the text.", status: "Applied" },
      { id: "security", requirement: "Security of personal data", how: "No encryption at rest, no real access control. Roles are simulated.", status: "Not applied" },
      { id: "transfer", requirement: "Transfer of data outside the Kingdom", how: "No data leaves the browser. A real model hosted abroad would need review.", status: "Applied" },
      { id: "rights", requirement: "Rights of the person (access, correction, objection)", how: "Not built.", status: "Not applied" },
      { id: "retention", requirement: "Keep data no longer than needed", how: "The audit trail keeps the last 2000 entries. No retention policy.", status: "Partial" },
    ],
  },
  {
    id: "sfda",
    name: "SFDA guidance for software and AI medical devices",
    note: "This app's assistant is a simulated decision-support aid. It is NOT a certified medical device and has not been assessed or registered by SFDA. Nothing here claims certification.",
    items: [
      { id: "intended", requirement: "A written intended use", how: "Stated in the assistant: a drafting aid that a clinician must review.", status: "Partial" },
      { id: "classify", requirement: "Decide whether the software is a medical device, and its risk class", how: "Not assessed. The decision support rules could make it one in real use.", status: "Not applied" },
      { id: "evidence", requirement: "Clinical evaluation and validation evidence", how: "Unit tests only. No clinical study.", status: "Not applied" },
      { id: "label", requirement: "Clear labelling for users", how: "Every output is labelled AI draft, and marked simulated.", status: "Applied" },
      { id: "monitor", requirement: "Monitor use after release", how: "The usage log and acceptance rate give a signal. No incident reporting process.", status: "Partial" },
      { id: "register", requirement: "Registration or authorisation before marketing", how: "Not done. Not claimed.", status: "Not applied" },
    ],
  },
];

export const countStatus = (f: Framework): Record<Status, number> => ({
  Applied: f.items.filter((i) => i.status === "Applied").length,
  Partial: f.items.filter((i) => i.status === "Partial").length,
  "Not applied": f.items.filter((i) => i.status === "Not applied").length,
});
