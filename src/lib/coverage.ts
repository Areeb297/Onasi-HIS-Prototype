import { useSyncExternalStore } from "react";
import type { Patient } from "./model";
import { coverageOutcome, findDuplicates, type CoverageKind } from "./registration";
import { retrieveInsurance, type InsuranceCard } from "./registry";
import { getState } from "./store";

/**
 * Patient coverages: the insurance policies a patient holds, in priority order, and the eligibility answers saved on them.
 * Own localStorage store, keyed by patient id.
 *
 * Assumptions (from the HIS screens, not from the NPHIES ADT pages):
 *  - Priority 1 is the primary coverage. Two active coverages cannot share a priority.
 *  - A patient with no saved coverages starts from the one insurance card the registration check finds
 *    (the card saved on the patient file, or the registry card for the ID number).
 *  - Eligibility answers are simulated with the same rules as the registration check. A real HIS sends an
 *    NPHIES eligibility request (financial services) and reads the CoverageEligibilityResponse.
 */

export const PAYER_TYPES = ["Insurance", "Policy Holder"] as const;
export type PayerType = (typeof PAYER_TYPES)[number];
export const INSURERS = ["Bupa Arabia", "Tawuniya", "MedGulf", "Al Rajhi Takaful", "Walaa", "Malath", "Arabian Shield", "Gulf Union Alahlia"];
export const TPAS = ["None", "Saudi Health TPA", "Gulf Care TPA", "Najd Claims Management"];
export const PLANS = ["VIP", "Class A", "Class B", "Class C"];
/** HIS lookup "Relationship" (PatientCoverages.RelationshipToSubscriber). */
export const RELATIONSHIPS = ["Self", "Spouse", "Child", "Parent", "Common Law Spouse", "Injured Party", "Other"];
export const REQUEST_TYPES = ["Discovery", "Validation", "Benefits", "Benefits And Validation"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_PRIORITIES = ["Normal", "Stat", "Deferred"] as const;
export type RequestPriority = (typeof REQUEST_PRIORITIES)[number];

export interface EligibilityAnswer {
  /** The payer will pay for care in the service period. A used-up limit is eligible with a warning. */
  eligible: boolean;
  kind: CoverageKind;
  title: string;
  text: string;
  /** When the answer came back. ISO time. */
  at: string;
  by: string;
  requestType: RequestType;
  priority: RequestPriority;
  serviceStart: string;
  serviceEnd: string;
  transfer: boolean;
  newborn: boolean;
}

export interface Coverage {
  id: string;
  patientId: string;
  /** 1 is the primary coverage. */
  priority: number;
  payerType: PayerType;
  /** The insurance company. Empty for a policy holder that pays directly. */
  insurer: string;
  tpa: string;
  plan: string;
  memberId: string;
  policyNo: string;
  network: string;
  relationship: string;
  /** National ID of the subscriber, when the patient is a dependent. */
  subscriberId: string;
  copayPercent: number;
  coinsurancePercent: number;
  /** yyyy-mm-dd */
  startDate: string;
  endDate: string;
  offlineApproval: boolean;
  approvalNo: string;
  active: boolean;
  /** The simulated payer answer for this policy. Covered when empty. */
  answer?: InsuranceCard["coverage"];
  /** The latest eligibility answer. */
  eligibility?: EligibilityAnswer;
}

export type CoverageInput = Omit<Coverage, "id" | "patientId" | "eligibility" | "answer" | "active"> & { active?: boolean };

/* ---------- pure rules ---------- */

/** A coverage made from the insurance card the registration check found. */
export function coverageFromCard(card: NonNullable<NonNullable<Patient["extra"]>["insurance"]>, patientId: string, priority = 1, id = `${patientId}-C${priority}`): Coverage {
  return {
    id, patientId, priority, payerType: "Insurance", insurer: card.payer, tpa: "None", plan: card.className, memberId: card.memberId,
    policyNo: card.policyNo, network: card.network, relationship: "Self", subscriberId: "", copayPercent: card.copayPercent, coinsurancePercent: 0,
    startDate: card.startDate, endDate: card.expiryDate, offlineApproval: false, approvalNo: "",
    // An expired card is kept on file as a coverage. It stays active (in the list) and the check answers "not active" from its dates.
    active: true, answer: card.coverage,
  };
}

/** The card a patient starts from: the one saved at registration, or the registry card for the ID number. */
export function initialCoverages(p: Patient | undefined): Coverage[] {
  if (!p) return [];
  const card = p.extra?.insurance ?? retrieveInsurance(p.extra?.idNumber || p.nationalId);
  return card ? [coverageFromCard(card, p.id)] : [];
}

/** The coverage as an insurance card, so the registration answer (`coverageOutcome`) can read it. */
export function coverageCard(c: Coverage, today: string): InsuranceCard {
  const inDate = (!c.startDate || c.startDate <= today) && (!c.endDate || c.endDate >= today);
  return {
    payer: c.insurer || c.tpa || "The policy holder", policyNo: c.policyNo, memberId: c.memberId, className: c.plan, network: c.network || "network",
    startDate: c.startDate, expiryDate: c.endDate, copayPercent: c.copayPercent, status: c.active && inDate ? "Active" : "Expired", coverage: c.answer,
  };
}

/** Coverages in priority order, active first. */
export function sortCoverages(list: Coverage[]): Coverage[] {
  return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.priority - b.priority);
}

/**
 * The primary active coverage: the lowest priority number among the active coverages that are in date today.
 * When none is in date, the lowest priority active one, so the check can say that it has ended.
 */
export function primaryCoverage(list: Coverage[], today: string): Coverage | undefined {
  const active = sortCoverages(list).filter((c) => c.active);
  return active.find((c) => (!c.startDate || c.startDate <= today) && (!c.endDate || c.endDate >= today)) ?? active[0];
}

/** What stops a coverage from being saved, one line per problem. `others` are the patient's other coverages. */
export function coverageProblems(c: CoverageInput, others: Coverage[]): string[] {
  const out: string[] = [];
  if (!c.payerType) out.push("Pick the payer type.");
  if (c.payerType === "Insurance" && !c.insurer) out.push("Pick the insurance company.");
  if (c.payerType === "Policy Holder" && !c.insurer && (!c.tpa || c.tpa === "None")) out.push("Pick the insurance company or the TPA.");
  if (!c.memberId.trim()) out.push("Enter the member number.");
  if (!Number.isInteger(c.priority) || c.priority < 1) out.push("Coverage priority is a whole number from 1.");
  else if ((c.active ?? true) && others.some((o) => o.active && o.priority === c.priority)) out.push(`Another active coverage already has priority ${c.priority}.`);
  if (!c.relationship) out.push("Pick the relationship to the subscriber.");
  if (c.relationship && c.relationship !== "Self" && !/^\d{10}$/.test(c.subscriberId.trim())) out.push("Enter the subscriber's 10 digit national ID.");
  for (const [v, label] of [[c.copayPercent, "Co-pay"], [c.coinsurancePercent, "Co-insurance"]] as const) {
    if (!Number.isFinite(v) || v < 0 || v > 100) out.push(`${label} is a percent from 0 to 100.`);
  }
  if (!c.startDate) out.push("Enter the start date.");
  if (!c.endDate) out.push("Enter the end date.");
  if (c.startDate && c.endDate && c.endDate < c.startDate) out.push("The end date cannot be before the start date.");
  if (c.offlineApproval && !c.approvalNo.trim()) out.push("Enter the approval number for the offline approval.");
  return out;
}

export interface EligibilityRequest {
  /** Empty only for a discovery request, which asks the payer to find the coverage. */
  coverageId: string;
  requestType: RequestType;
  /** The payer to ask. Needed for a discovery request without a coverage. */
  payer: string;
  priority: RequestPriority;
  serviceStart: string;
  serviceEnd: string;
  transfer: boolean;
  newborn: boolean;
}

/** What stops the eligibility request from being sent. */
export function eligibilityProblems(r: EligibilityRequest): string[] {
  const out: string[] = [];
  if (!r.requestType) out.push("Pick the request type.");
  if (r.requestType !== "Discovery" && !r.coverageId) out.push("Pick the coverage to check.");
  if (r.requestType === "Discovery" && !r.coverageId && !r.payer) out.push("Pick the payer to ask.");
  if (!r.priority) out.push("Pick the priority.");
  if (!r.serviceStart || !r.serviceEnd) out.push("Enter the service start and end dates.");
  else if (r.serviceEnd < r.serviceStart) out.push("The service end date cannot be before the start date.");
  return out;
}

/** The simulated payer answer, worked out the same way as the registration check, for the first day of service. */
export function answerFor(card: InsuranceCard | null | undefined, r: EligibilityRequest, at: string, by: string): EligibilityAnswer {
  const o = coverageOutcome(card, r.serviceStart);
  return {
    eligible: !o.blocking, kind: o.kind, title: o.title, text: o.text, at, by, requestType: r.requestType, priority: r.priority,
    serviceStart: r.serviceStart, serviceEnd: r.serviceEnd, transfer: r.transfer, newborn: r.newborn,
  };
}

/** The eligibility answer for the list: the newest one on any active coverage. */
export function latestEligibility(list: Coverage[]): EligibilityAnswer | undefined {
  return list.filter((c) => c.active && c.eligibility).map((c) => c.eligibility!).sort((a, b) => b.at.localeCompare(a.at))[0];
}

/** One line for the list, for example "Bupa Arabia, Class A". */
export function coverageLabel(c: Coverage | undefined): string {
  if (!c) return "Cash";
  return [c.insurer || c.tpa, c.plan].filter((x) => x && x !== "None").join(", ");
}

/* ---------- store ---------- */

interface State {
  /** Saved coverages by patient id. A patient missing here starts from `initialCoverages`. */
  byPatient: Record<string, Coverage[]>;
  seq: number;
}

const KEY = "onasi-his-coverage-v1";
const EMPTY: State = { byPatient: {}, seq: 0 };
let state: State | null = null;
const listeners = new Set<() => void>();

function load(): State {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as State) };
  } catch {
    /* storage may be blocked */
  }
  return EMPTY;
}

function get(): State {
  if (!state) state = load();
  return state;
}

function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useCoverages(): State {
  return useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), get, get);
}

export const resetCoverages = () => commit({ ...EMPTY });

/** The coverages of one patient, saved or started from the registration card. */
export function coveragesOf(patientId: string, s: State = get(), patients: Patient[] = getState().patients): Coverage[] {
  return s.byPatient[patientId] ?? initialCoverages(patients.find((p) => p.id === patientId));
}

/**
 * The card the registration check reads. For a patient who already has a file here (the file picked, or the same ID number
 * or Health ID), the primary active coverage on that file. Otherwise the registry card for the ID number.
 */
export function registrationCard(q: { idNumber: string; patientId?: string; healthId?: string }, today: string, patients: Patient[] = getState().patients, s: State = get()): InsuranceCard | null {
  const file = q.patientId
    ? patients.find((p) => p.id === q.patientId)
    : findDuplicates({ idNumber: q.idNumber, healthId: q.healthId }, patients.filter((p) => !p.mergedInto))[0]?.patient;
  if (file) {
    const list = coveragesOf(file.id, s, patients);
    if (list.length) {
      const primary = primaryCoverage(list, today);
      return primary ? coverageCard(primary, today) : null;
    }
  }
  return (q.idNumber ? retrieveInsurance(q.idNumber) : undefined) ?? null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function put(patientId: string, list: Coverage[], seq?: number) {
  const s = get();
  commit({ byPatient: { ...s.byPatient, [patientId]: list }, seq: seq ?? s.seq });
}

/** Add a coverage, or change one when `id` is given. */
export function saveCoverage(patientId: string, input: CoverageInput, id?: string): Result<Coverage> {
  const list = coveragesOf(patientId);
  const others = list.filter((c) => c.id !== id);
  const problems = coverageProblems(input, others);
  if (problems.length) return { ok: false, problems };
  const s = get();
  const before = id ? list.find((c) => c.id === id) : undefined;
  const seq = before ? s.seq : s.seq + 1;
  const c: Coverage = {
    ...(before ?? {}),
    ...input,
    memberId: input.memberId.trim(), subscriberId: input.subscriberId.trim(), approvalNo: input.offlineApproval ? input.approvalNo.trim() : "",
    id: before?.id ?? `${patientId}-N${seq}`, patientId, active: input.active ?? before?.active ?? true,
  };
  put(patientId, before ? list.map((x) => (x.id === id ? c : x)) : [...list, c], seq);
  return { ok: true, value: c };
}

/** Mark a coverage inactive. It stays on file but no longer counts for the check or the priority. */
export function markCoverageInactive(patientId: string, id: string): boolean {
  const list = coveragesOf(patientId);
  if (!list.some((c) => c.id === id && c.active)) return false;
  put(patientId, list.map((c) => (c.id === id ? { ...c, active: false } : c)));
  return true;
}

/**
 * Send an eligibility request (simulated). The answer is saved on the coverage with its date.
 * A discovery request without a coverage asks the payer to find one: a card found with that payer is added as a new coverage.
 */
export function requestEligibility(patientId: string, r: EligibilityRequest, by: string, now: Date = new Date()): Result<{ answer: EligibilityAnswer; coverage?: Coverage }> {
  const problems = eligibilityProblems(r);
  if (problems.length) return { ok: false, problems };
  const at = now.toISOString();
  const list = coveragesOf(patientId);
  if (r.coverageId) {
    const c = list.find((x) => x.id === r.coverageId);
    if (!c) return { ok: false, problems: ["That coverage was not found."] };
    const answer = answerFor(coverageCard(c, r.serviceStart), r, at, by);
    const saved = { ...c, eligibility: answer };
    put(patientId, list.map((x) => (x.id === c.id ? saved : x)));
    return { ok: true, value: { answer, coverage: saved } };
  }
  const p = getState().patients.find((x) => x.id === patientId);
  const found = retrieveInsurance(p?.extra?.idNumber || p?.nationalId || "");
  const card = found && found.payer === r.payer ? found : null;
  const answer = answerFor(card, r, at, by);
  if (!card) return { ok: true, value: { answer } };
  const s = get();
  const priority = Math.max(0, ...list.filter((c) => c.active).map((c) => c.priority)) + 1;
  const added = { ...coverageFromCard(card, patientId, priority, `${patientId}-N${s.seq + 1}`), eligibility: answer };
  put(patientId, [...list, added], s.seq + 1);
  return { ok: true, value: { answer, coverage: added } };
}

/** After a merge: the duplicate's coverages that the kept file does not have (same member number) move across, after the kept ones. */
export function moveCoverages(fromId: string, toId: string, patients: Patient[] = getState().patients) {
  const s = get();
  const from = coveragesOf(fromId, s, patients);
  const to = coveragesOf(toId, s, patients);
  if (!from.length) return;
  let next = Math.max(0, ...to.filter((c) => c.active).map((c) => c.priority));
  const moved = from
    .filter((c) => !to.some((t) => t.memberId === c.memberId && t.insurer === c.insurer))
    .map((c, i) => ({ ...c, id: `${toId}-M${s.seq + 1 + i}`, patientId: toId, priority: c.active ? ++next : c.priority }));
  commit({ byPatient: { ...s.byPatient, [toId]: [...to, ...moved], [fromId]: [] }, seq: s.seq + moved.length });
}
