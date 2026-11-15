import { CTAS_LEVELS } from "./ctas";
import type { Encounter, HisState, Patient } from "./model";
import { ADMISSION_METHODS, DISPOSITIONS, SERVICES, countryLabel } from "./reference-data";
import { getFormRecords } from "./records";
import { getRx, rxForVisit } from "./rx";
import { DRUG_BY_ID, FREQ_BY_ID, ROUTE_LABEL, drugLabel } from "./rx-catalogue";
import type { RxState } from "./rx-types";
import { fmtDate, fmtDateTime } from "./format";

/**
 * What the chart overview shows besides the review panels: the patient's visits, the details of this visit,
 * demographics, and short summaries of medicines, history and attachments. Pure reads over the stores.
 */

export const NOT_RECORDED = "Not recorded";
const ms = (s: string | undefined): number => (s ? new Date(s).getTime() : 0);
const serviceLabel = (code: string | undefined) => (code ? SERVICES.find((s) => s.code === code)?.label ?? code : "");
const EMERGENCY_METHODS = new Set(["02", "03", "04", "05", "06", "07", "08", "12", "15"]);

export const CLASS_LABEL: Record<Encounter["cls"], string> = { I: "Inpatient", O: "Outpatient", E: "Emergency" };
export const STATUS_LABEL: Record<Encounter["status"], string> = { preadmit: "Pre-Admission", active: "Active", discharged: "Discharged", cancelled: "Cancelled" };

/** Every visit of the patient, newest first. */
export function patientVisits(state: HisState, patientId: string): Encounter[] {
  return state.encounters
    .filter((e) => e.patientId === patientId)
    .sort((a, b) => ms(b.admitAt ?? b.expectedAdmitAt) - ms(a.admitAt ?? a.expectedAdmitAt) || b.visitNumber.localeCompare(a.visitNumber));
}

export interface DetailRow { label: string; value: string; known: boolean }
const row = (label: string, value: string | undefined | null): DetailRow => ({ label, value: value || NOT_RECORDED, known: !!value });

/** Priority as the app holds it: the triage level for an emergency visit, else from the admission method. */
export function priorityOf(enc: Encounter): string {
  if (enc.cls === "E") {
    const c = enc.ed?.ctas ? CTAS_LEVELS.find((l) => l.level === enc.ed?.ctas) : undefined;
    return c ? `${c.label} (CTAS ${c.level})` : "Emergency, not triaged yet";
  }
  if (enc.admissionMethod && EMERGENCY_METHODS.has(enc.admissionMethod)) return "Emergency";
  return enc.cls === "I" ? "Elective" : "Routine";
}

function stayLength(enc: Encounter): string | undefined {
  const days = enc.admission?.expectedStayDays;
  if (days) return `${days} day${days === 1 ? "" : "s"}`;
  const a = ms(enc.admitAt ?? enc.expectedAdmitAt), b = ms(enc.expectedDischargeAt);
  if (a && b && b > a) {
    const d = Math.round((b - a) / 86_400_000);
    return d >= 1 ? `${d} day${d === 1 ? "" : "s"}, by the expected discharge date` : "Less than a day, by the expected discharge date";
  }
  return undefined;
}

function dispositionOf(enc: Encounter): string | undefined {
  if (enc.status !== "discharged") return undefined;
  const coded = DISPOSITIONS.find((d) => d.code === enc.disposition)?.label;
  return enc.ed?.disposition ?? coded ?? (enc.discharge ? { home: "Home", transfer: "Transfer", ama: "Left against medical advice", died: "Died" }[enc.discharge.outcome] : undefined);
}

const when = (s?: string) => (s ? fmtDateTime(s) : undefined);

/** The encounter details the HIS shows, filled from what the app holds. Missing ones say "Not recorded". */
export function encounterDetails(enc: Encounter): DetailRow[] {
  const ctas = enc.ed?.ctas ? CTAS_LEVELS.find((l) => l.level === enc.ed?.ctas) : undefined;
  const rows: DetailRow[] = [
    row("Status", STATUS_LABEL[enc.status]),
    row("Class", CLASS_LABEL[enc.cls]),
    row("Service Type", serviceLabel(enc.service)),
    row("Priority", priorityOf(enc)),
    row("Start Date", when(enc.admitAt ?? enc.expectedAdmitAt)),
    row("End Date", enc.status === "discharged" ? when(enc.dischargeAt) : enc.status === "cancelled" ? "Cancelled" : "Still open"),
    row("Intended Length Of Stay", enc.cls === "I" ? stayLength(enc) : "Same day"),
    row("Admission Source", ADMISSION_METHODS.find((m) => m.code === enc.admissionMethod)?.label),
    row("Admission Type", enc.admission?.admissionType),
    row("Admission Specialty", enc.admission?.specialty ?? serviceLabel(enc.service)),
    row("Discharge Specialty", enc.status === "discharged" ? serviceLabel(enc.service) : "Not discharged yet"),
    row("Discharge Disposition", enc.status === "discharged" ? dispositionOf(enc) : "Not discharged yet"),
  ];
  if (enc.cls === "E" || enc.ed) {
    rows.push(
      row("Emergency Service Start", when(enc.ed?.arrivalAt)),
      row("Triage Date", when(enc.ed?.triageAt)),
      row("Triage Category", ctas ? `Level ${ctas.level}, ${ctas.label}` : undefined),
      row("Arrival Mode", enc.ed?.arrivalMode),
    );
  }
  return rows;
}

/** Identity type, from the registration record, else from the first digit of the national number. */
export function identityType(p: Patient): string {
  if (p.extra?.idType) return p.extra.idType;
  if (/^1\d{9}$/.test(p.nationalId)) return "National ID";
  if (/^2\d{9}$/.test(p.nationalId)) return "Iqama";
  return p.nationalId ? "Other identity document" : "";
}

export function demographics(p: Patient): DetailRow[] {
  const x = p.extra ?? {};
  const address = [x.addressLine1 ?? x.addressText, x.addressLine2, x.city, x.region, p.address ? `Short address ${p.address}` : ""].filter(Boolean).join(", ");
  const ins = x.insurance;
  const insurance = !ins || x.visitPayType === "Cash" ? "Cash patient" : `${ins.payer}, ${ins.className || "no class"}, policy ${ins.policyNo}, expires ${ins.expiryDate}${ins.status === "Expired" ? " (expired)" : ""}`;
  return [
    row("Identity Type", identityType(p)),
    row("Identity Number", x.idNumber ?? p.nationalId),
    row("Phone", x.mobile ?? x.homePhone ?? x.otherPhone),
    row("Nationality", countryLabel(p.nationality)),
    row("Date Of Birth", p.dob ? fmtDate(p.dob) : undefined),
    row("Address", address),
    row("Insurance", insurance),
  ];
}

/* ---------- summary cards ---------- */

export interface MedLine { id: string; drug: string; detail: string; rxNumber: string }

/** Medicines on sent, active prescription items of the visit. */
export function activeMedicines(visit: string, rx: RxState = getRx()): MedLine[] {
  const out: MedLine[] = [];
  for (const p of rxForVisit(rx, visit)) {
    if (!p.sentAt) continue;
    for (const i of p.items) {
      if (i.status !== "active") continue;
      const d = DRUG_BY_ID[i.drugId];
      out.push({
        id: i.id, rxNumber: p.number, drug: d ? drugLabel(d) : i.drugId,
        detail: [`${i.dose} ${d?.unit ?? ""}`.trim(), ROUTE_LABEL[i.route] ?? i.route, i.asNeeded ? "as needed" : FREQ_BY_ID[i.frequencyId]?.label ?? i.frequencyId, p.usage === "discharge" ? "take home" : ""].filter(Boolean).join(" · "),
      });
    }
  }
  return out;
}

const asText = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v === false || v === undefined || v === null ? "" : String(v));

export interface HistorySummary { visit: string; at: string; author: string; lines: [string, string][] }

/** The newest Medical History record across the patient's visits. */
export function latestHistory(visits: string[]): HistorySummary | undefined {
  const all = visits.flatMap((v) => getFormRecords(v, "medical-history").map((r) => ({ v, r })));
  const top = all.sort((a, b) => b.r.at.localeCompare(a.r.at))[0];
  if (!top) return undefined;
  const pick: [string, string][] = [
    ["historyOfPresentIllness", "Present Illness"], ["conditions", "Past Conditions"], ["surgeries", "Past Surgeries"],
    ["familyHistory", "Family History"], ["smoking", "Smoking"], ["physicalExamination", "Physical Examination"], ["treatmentPlan", "Treatment Plan"],
  ];
  const lines = pick.map(([k, label]) => [label, asText(top.r.values[k])] as [string, string]).filter(([, v]) => v);
  return { visit: top.v, at: top.r.at, author: top.r.author, lines };
}

export interface AttachmentLine { id: string; visit: string; name: string; type: string; date: string; by: string }

/** Attachments registered on any of the patient's visits, newest first. */
export function attachmentsOf(visits: string[]): AttachmentLine[] {
  return visits
    .flatMap((v) => getFormRecords(v, "attachments").map((r) => ({
      id: r.id, visit: v, name: asText(r.values.fileName) || "Unnamed file", type: asText(r.values.docType), date: asText(r.values.docDate) || r.at.slice(0, 10), by: r.author,
    })))
    .sort((a, b) => b.date.localeCompare(a.date));
}
