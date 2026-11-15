import { audit } from "../audit";
import { createStore } from "../fhir/store-util";
import type { Patient } from "../model";
import { esc, printableName, type PrintOptions } from "../print-doc";
import { FACILITY_NAME, ORG_ID } from "../reference-data";
import { currentUser, roleOf } from "../session";
import { getState } from "../store";
import { isOff, logCall } from "./call-log";

/**
 * Sick leave through the MoH Seha platform. In Saudi Arabia a sick leave counts only when it is issued on Seha, so the
 * chart sends it there and keeps the leave number that comes back. Simulated: nothing leaves the browser.
 *
 * Assumptions for the demo: one leave is 1 to 30 days; the diagnosis must be one already recorded on the visit;
 * two issued leaves of the same kind for one patient cannot overlap; the leave number format (PSL-YYMMDD-NNNNN)
 * and the doctor licence numbers are made up.
 */

export type LeaveType = "sick" | "companion";
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = { sick: "Sick Leave", companion: "Companion Leave" };
export type EmployerType = "government" | "private";
export const EMPLOYER_LABEL: Record<EmployerType, string> = { government: "Government", private: "Private" };
export type LeaveStatus = "Issued" | "Cancelled";
export const RELATIONS = ["Father", "Mother", "Husband", "Wife", "Son", "Daughter", "Brother", "Sister", "Other Relative"];
export const MAX_DAYS = 30;

/** Made-up SCFHS licence numbers, by user id. A doctor with no licence on file cannot issue a leave. */
const LICENCE: Record<string, string> = { U1: "14RM0036512" };

export interface TrailEntry {
  at: string;
  by: string;
  text: string;
}

export interface SickLeave {
  /** The leave number Seha returned. */
  number: string;
  visit: string;
  patientId: string;
  type: LeaveType;
  companionName?: string;
  companionRelation?: string;
  /** YYYY-MM-DD */
  startDate: string;
  days: number;
  /** YYYY-MM-DD, the last day of the leave. */
  endDate: string;
  /** ICD-10-AM diagnosis taken from the visit. */
  dxCode: string;
  dxText: string;
  doctor: string;
  licence: string;
  employerType: EmployerType;
  notes: string;
  status: LeaveStatus;
  issuedAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
  trail: TrailEntry[];
}

interface State {
  leaves: SickLeave[];
  seq: number;
}

const store = createStore<State>("onasi-emr-seha-leaves-v1", () => ({ leaves: [], seq: 0 }));
export const useSeha = store.use;
export const resetSeha = store.reset;

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const iso = (t: number) => new Date(t).toISOString();
const OFF = "Seha is switched off. Ask the System Administrator to connect it.";

/** The last day of a leave: a 3 day leave from the 10th ends on the 12th. */
export function leaveEnd(startDate: string, days: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

export const leavesOf = (visit: string, s: State = store.get()): SickLeave[] =>
  s.leaves.filter((l) => l.visit === visit).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));

/** Only a doctor issues or cancels a sick leave. Returns why not, or null when the signed-in user may. */
export function issueBlock(): string | null {
  const u = currentUser();
  if (roleOf(u).id !== "physician") return "Only a doctor can issue or cancel a sick leave.";
  if (!LICENCE[u.id]) return "Your licence number is not on file. Ask the System Administrator to add it.";
  return null;
}
export const licenceOfCurrentUser = (): string => LICENCE[currentUser().id] ?? "";

const patientOf = (id: string): Patient | undefined => getState().patients.find((p) => p.id === id);

function patch(number: string, fn: (l: SickLeave) => SickLeave) {
  const s = store.get();
  store.set({ ...s, leaves: s.leaves.map((l) => (l.number === number ? fn(l) : l)) });
}
const addTrail = (number: string, text: string, now: number) =>
  patch(number, (l) => ({ ...l, trail: [...l.trail, { at: iso(now), by: currentUser().name, text }] }));

export interface LeaveInput {
  visit: string;
  type: LeaveType;
  companionName?: string;
  companionRelation?: string;
  startDate: string;
  days: number;
  dxCode: string;
  employerType: EmployerType;
  notes?: string;
}

export function issueSickLeave(input: LeaveInput, now: number = Date.now()): Result<SickLeave> {
  const enc = getState().encounters.find((e) => e.visitNumber === input.visit);
  const block = issueBlock();
  if (block) {
    audit("denied", "Sick leave", { patient: enc?.patientId, detail: block });
    return { ok: false, errors: [block] };
  }
  if (isOff("seha")) return { ok: false, errors: [OFF] };
  const dx = enc?.dx.find((d) => d.code === input.dxCode);
  const companion = input.type === "companion";
  const errors: string[] = [];
  if (!enc) errors.push("This visit was not found.");
  else if (!dx) errors.push(enc.dx.length ? "Choose the diagnosis for the leave." : "Add a diagnosis to the visit first. A sick leave needs one.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) errors.push("Enter the first day of the leave.");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DAYS) errors.push(`Enter the number of days, 1 to ${MAX_DAYS}.`);
  if (companion && !input.companionName?.trim()) errors.push("Enter the companion's name.");
  if (companion && !input.companionRelation) errors.push("Choose how the companion is related to the patient.");
  if (errors.length || !enc || !dx) return { ok: false, errors };

  const s = store.get();
  const endDate = leaveEnd(input.startDate, input.days);
  const clash = s.leaves.find((l) => l.patientId === enc.patientId && l.type === input.type && l.status === "Issued" && l.startDate <= endDate && input.startDate <= l.endDate);
  if (clash) return { ok: false, errors: [`This patient already has a ${LEAVE_TYPE_LABEL[input.type].toLowerCase()} for these dates (${clash.number}). Cancel it first.`] };

  const seq = s.seq + 1;
  const u = currentUser();
  const number = `PSL-${iso(now).slice(2, 10).replace(/-/g, "")}-${String(seq).padStart(5, "0")}`;
  const p = patientOf(enc.patientId);
  const leave: SickLeave = {
    number, visit: enc.visitNumber, patientId: enc.patientId, type: input.type,
    companionName: companion ? input.companionName!.trim() : undefined, companionRelation: companion ? input.companionRelation : undefined,
    startDate: input.startDate, days: input.days, endDate, dxCode: dx.code, dxText: dx.text, doctor: u.name, licence: LICENCE[u.id],
    employerType: input.employerType, notes: input.notes?.trim() ?? "", status: "Issued", issuedAt: iso(now),
    trail: [{ at: iso(now), by: u.name, text: `Issued on Seha for ${input.days} ${input.days === 1 ? "day" : "days"}` }],
  };
  store.set({ seq, leaves: [...s.leaves, leave] });
  logCall({
    integration: "seha", operation: "Issue Sick Leave", ok: true, summary: `${number}: issued, ${leave.startDate} to ${endDate}`,
    request: {
      facilityId: ORG_ID, patientIdNumber: p?.nationalId, leaveType: input.type, companion: companion ? { name: leave.companionName, relation: leave.companionRelation } : undefined,
      startDate: leave.startDate, days: leave.days, endDate, diagnosis: { system: "ICD-10-AM", code: dx.code, display: dx.text },
      practitioner: { name: u.name, licence: leave.licence }, employerType: input.employerType, notes: leave.notes || undefined,
    },
    response: { leaveNumber: number, status: "Issued", issuedAt: leave.issuedAt },
  }, now);
  audit("create", `Sick leave ${number}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${LEAVE_TYPE_LABEL[input.type]}, ${leave.startDate} to ${endDate}, ${dx.code}` });
  return { ok: true, value: leave };
}

export function cancelSickLeave(number: string, reason: string, now: number = Date.now()): Result<SickLeave> {
  const block = issueBlock();
  if (block) return { ok: false, errors: [block] };
  if (isOff("seha")) return { ok: false, errors: [OFF] };
  const l = store.get().leaves.find((x) => x.number === number);
  if (!l) return { ok: false, errors: ["This sick leave was not found."] };
  if (l.status === "Cancelled") return { ok: false, errors: ["This sick leave is already cancelled."] };
  if (!reason.trim()) return { ok: false, errors: ["Enter the reason for cancelling."] };
  const by = currentUser().name;
  patch(number, (x) => ({
    ...x, status: "Cancelled", cancelledAt: iso(now), cancelledBy: by, cancelReason: reason.trim(),
    trail: [...x.trail, { at: iso(now), by, text: `Cancelled on Seha: ${reason.trim()}` }],
  }));
  logCall({
    integration: "seha", operation: "Cancel Sick Leave", ok: true, summary: `${number}: cancelled`,
    request: { leaveNumber: number, reason: reason.trim() }, response: { leaveNumber: number, status: "Cancelled", cancelledAt: iso(now) },
  }, now);
  audit("update", `Sick leave ${number}`, { patient: l.patientId, detail: `Cancelled: ${reason.trim()}` });
  return { ok: true, value: store.get().leaves.find((x) => x.number === number)! };
}

export interface Verification {
  /** True only for a leave that exists, belongs to this ID number and is still Issued. */
  valid: boolean;
  message: string;
  leave?: SickLeave;
}

/** The Seha inquiry an employer runs: the leave number and the patient's ID number. */
export function verifySickLeave(number: string, idNumber: string, now: number = Date.now()): Result<Verification> {
  if (isOff("seha")) return { ok: false, errors: [OFF] };
  const l = store.get().leaves.find((x) => x.number === number.trim());
  const match = l && patientOf(l.patientId)?.nationalId === idNumber.trim() ? l : undefined;
  const v: Verification = !match
    ? { valid: false, message: "No sick leave was found for this leave number and ID number." }
    : match.status === "Cancelled"
      ? { valid: false, message: "This sick leave was cancelled. It is not valid.", leave: match }
      : { valid: true, message: "This sick leave is valid.", leave: match };
  logCall({
    integration: "seha", operation: "Verify Sick Leave", ok: !!match, summary: `${number.trim()}: ${v.valid ? "valid" : match ? "cancelled" : "not found"}`,
    request: { leaveNumber: number.trim(), idNumber: idNumber.trim() },
    response: match ? { found: true, status: match.status, startDate: match.startDate, endDate: match.endDate, days: match.days, facility: FACILITY_NAME } : { found: false },
  }, now);
  if (match) addTrail(match.number, `Checked on Seha: ${v.valid ? "valid" : "cancelled"}`, now);
  return { ok: true, value: v };
}

/** The printed copy. Every value goes through esc(). Printing is written to the audit trail by recordPrint. */
export function sickLeavePrint(l: SickLeave): PrintOptions {
  const p = patientOf(l.patientId);
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  return {
    title: `${LEAVE_TYPE_LABEL[l.type]} ${l.number}`,
    css: "@page{size:A4;margin:16mm}h1{font-size:18px;margin:0 0 2px}p{margin:0 0 12px;color:#475569}table{width:100%;border-collapse:collapse}" +
      "th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #e2e8f0;vertical-align:top}th{width:34%;color:#475569;font-weight:600}" +
      ".st{display:inline-block;margin-bottom:12px;padding:3px 10px;border:1px solid #0f172a;border-radius:99px;font-weight:700}.ft{margin-top:18px;font-size:11px;color:#475569}",
    body:
      `<h1>${esc(LEAVE_TYPE_LABEL[l.type])}</h1><p>${esc(FACILITY_NAME)}. Issued through the Seha platform.</p>` +
      `<div class="st">${esc(l.status)}</div><table>` +
      row("Leave Number", l.number) + row("Patient", printableName(p)) + row("ID Number", p?.nationalId ?? "") + row("MRN", p?.mrn ?? "") +
      (l.type === "companion" ? row("Companion", `${l.companionName} (${l.companionRelation})`) : "") +
      row("From", l.startDate) + row("To", l.endDate) + row("Days", String(l.days)) + row("Diagnosis (ICD-10-AM)", `${l.dxCode} ${l.dxText}`) +
      row("Doctor", l.doctor) + row("Licence Number", l.licence) + row("Employer Type", EMPLOYER_LABEL[l.employerType]) + row("Issued", new Date(l.issuedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })) +
      (l.notes ? row("Notes", l.notes) : "") + (l.status === "Cancelled" ? row("Cancelled", `${l.cancelledBy}: ${l.cancelReason}`) : "") +
      `</table><div class="ft">Check this leave on the Seha platform with the leave number and the patient's ID number.</div>`,
  };
}

export function recordPrint(number: string, now: number = Date.now()) {
  const l = store.get().leaves.find((x) => x.number === number);
  if (!l) return;
  addTrail(number, "Printed", now);
  audit("export", `Sick leave ${number}`, { patient: l.patientId, detail: "Printed" });
}
