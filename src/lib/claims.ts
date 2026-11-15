import { audit } from "./audit";
import { dxKind } from "./chart-entries";
import { createStore } from "./fhir/store-util";
import { testByCode } from "./fhir/lab-catalog";
import { procByCode } from "./fhir/rad-catalog";
import type { LabOrder, RadOrder } from "./fhir/types";
import { invoiceOf, invoiceView, insurerOf, linesFromCharge, payerPaid, vatAppliesToPatientShare, round2, type Invoice, type InvoiceLine, type Totals } from "./invoice";
import { getLab } from "./lab";
import type { Encounter, Patient, Pr } from "./model";
import {
  caseOf, estimateCharge, finActionFor, getFinancial, needsAuthorization, payerOf, runFinancial, stepViews,
  type AuthStatus, type FinAction, type FinCase,
} from "./nphies-financial";
import { getRad } from "./radiology";
import { DOCTORS, SERVICES } from "./reference-data";
import { getDrug, getRx } from "./rx";
import type { RxState } from "./rx-types";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { claimReadiness, type ClaimLine as VitalClaimLine } from "./vitals";

/**
 * The biller's claim for a visit: header, care team, supporting information, diagnoses, service lines, totals and the
 * claim review (scrubbing) that runs before anything is sent.
 *
 * One source of money: every amount comes from the visit invoice (invoice.ts), which takes its lines from estimateCharge in
 * nphies-financial.ts. The claim only splits each invoice line into one service line per test, exam or medicine, at the
 * invoice unit cost. Nothing here sets a price. Sending goes through runFinancial, so this screen, NPHIES Financial and the
 * invoice always agree.
 *
 * Hospital choices to confirm before go-live (made here so the screens can work):
 *  - Claim type and sub-type by visit class: outpatient Professional / Outpatient, emergency Institutional / Emergency,
 *    inpatient Institutional / Inpatient. One claim per visit, medicines included (NPHIES expects a separate pharmacy claim).
 *  - Service codes are SBS sample codes (SBS-SAMPLE-nnnn), the same placeholders the masters use. The hospital SBS price
 *    list is the source of truth.
 *  - The AR-DRG box is an estimate from the principal diagnosis. The licensed AR-DRG grouper decides the final code.
 */

/* ---------- code lists ---------- */

export type ClaimType = "institutional" | "professional" | "pharmacy" | "oral" | "vision";
export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  institutional: "Institutional", professional: "Professional", pharmacy: "Pharmacy", oral: "Oral", vision: "Vision",
};
export type ClaimSubType = "op" | "ip" | "emr";
export const SUBTYPE_LABEL: Record<ClaimSubType, string> = { op: "Outpatient", ip: "Inpatient", emr: "Emergency" };
export type ClaimPriority = "normal" | "stat" | "deferred";
export const PRIORITY_LABEL: Record<ClaimPriority, string> = { normal: "Normal", stat: "Immediate", deferred: "Deferred" };

export type DxType = "principal" | "secondary" | "admitting" | "differential" | "discharge";
export const DX_TYPE_LABEL: Record<DxType, string> = {
  principal: "Principal", secondary: "Secondary", admitting: "Admitting", differential: "Differential", discharge: "Discharge",
};
export type OnAdmission = "y" | "n" | "u";
export const ON_ADMISSION_LABEL: Record<OnAdmission, string> = { y: "Yes", n: "No", u: "Unknown" };

export type CareRole = "primary" | "assist" | "supervisor" | "other";
export const CARE_ROLE_LABEL: Record<CareRole, string> = { primary: "Primary", assist: "Assisting", supervisor: "Supervisor", other: "Other" };

/** Supporting information a biller can add on top of what comes from the chart. NPHIES claim-information-category codes. */
export const SUPPORT_CATEGORIES: { code: string; label: string }[] = [
  { code: "reason-for-visit", label: "Reason For Visit" },
  { code: "onset", label: "Onset" },
  { code: "history-of-present-illness", label: "History Of Present Illness" },
  { code: "physical-examination", label: "Physical Examination" },
  { code: "treatment-plan", label: "Treatment Plan" },
  { code: "investigation-result", label: "Investigation Result" },
  { code: "patient-history", label: "Patient History" },
  { code: "estimated-Length-of-Stay", label: "Estimated Length Of Stay" },
  { code: "attachment", label: "Attachment" },
];
export const SUPPORT_LABEL: Record<string, string> = Object.fromEntries(SUPPORT_CATEGORIES.map((c) => [c.code, c.label]));

export type CodeSystem = "SBS" | "ACHI";

/* ---------- saved claim edits ---------- */

export interface CareTeamMember { doctorId: string; role: CareRole }
export interface SupportItem { id: string; category: string; value: string }
export interface LineEdit {
  system?: CodeSystem;
  code?: string;
  start?: string;
  end?: string;
  /** Links by ICD-10-AM code, so a change in the chart's diagnosis order does not move a link. */
  dxCodes?: string[];
  /** Links by doctor id. */
  careIds?: string[];
}
/** A service line added by the biller, such as a procedure from the chart. It has no price on the invoice. */
export interface ExtraLine { key: string; system: CodeSystem; code: string; text: string; start: string }
export interface SoftStopAck { at: string; by: string; reason: string; ids: string[] }
export interface SendLog { at: string; by: string; use: ClaimUse; action: FinAction; amount: number }

export interface ClaimDraft {
  visit: string;
  type?: ClaimType;
  subType?: ClaimSubType;
  priority?: ClaimPriority;
  claimDate?: string;
  start?: string;
  end?: string;
  careTeam?: CareTeamMember[];
  dx?: Record<string, { type?: DxType; onAdmission?: OnAdmission }>;
  support?: SupportItem[];
  lines?: Record<string, LineEdit>;
  extraLines?: ExtraLine[];
  ack?: SoftStopAck;
  reviewedAt?: string;
  sends?: SendLog[];
}

interface ClaimState { drafts: ClaimDraft[]; seq: number }

const store = createStore<ClaimState>("onasi-emr-claims-v1", () => ({ drafts: [], seq: 0 }));
export const useClaims = store.use;
export const getClaims = store.get;
export const resetClaims = store.reset;
export const draftOf = (visit: string, s: ClaimState = store.get()): ClaimDraft | undefined => s.drafts.find((d) => d.visit === visit);

/* ---------- the claim as the screen shows it ---------- */

export interface ClaimDx { seq: number; code: string; text: string; type: DxType; onAdmission: OnAdmission }
export interface ClaimCare { seq: number; doctorId: string; name: string; role: CareRole; qualification: string }
export interface ClaimServiceLine {
  key: string;
  seq: number;
  kind: "visit" | "lab" | "rad" | "rx" | "proc";
  text: string;
  system: CodeSystem;
  code: string;
  start: string;
  end: string;
  quantity: number;
  unitCost: number;
  gross: number;
  discount: number;
  net: number;
  dxCodes: string[];
  dxSeqs: number[];
  careIds: string[];
  careSeqs: number[];
  /** Added by the biller; can be removed. Lines from the invoice cannot. */
  extra: boolean;
}
export interface DrgEstimate { code: string; text: string; mdc: string; losDays: number; note: string }

export interface ClaimModel {
  visit: string;
  enc: Encounter;
  patient: Patient;
  payer: string;
  type: ClaimType;
  subType: ClaimSubType;
  priority: ClaimPriority;
  claimDate: string;
  start: string;
  end: string;
  careTeam: ClaimCare[];
  dx: ClaimDx[];
  /** The eight vital signs and the chief complaint, from the chart (vitals.ts claimReadiness). */
  chart: VitalClaimLine[];
  support: SupportItem[];
  lines: ClaimServiceLine[];
  totals: Totals;
  /** What the claim sends: the invoice net, which equals the NPHIES Financial charge. */
  net: number;
  authNeeded: boolean;
  fin: FinCase;
  drg: DrgEstimate | null;
  /** A claim the payer is holding or has approved cannot be changed. */
  locked: boolean;
  draft: ClaimDraft | undefined;
}

const dateOnly = (s: string | undefined) => (s ?? "").slice(0, 10);
const todayIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function defaultHeader(enc: Pick<Encounter, "cls">): { type: ClaimType; subType: ClaimSubType; priority: ClaimPriority } {
  if (enc.cls === "I") return { type: "institutional", subType: "ip", priority: "normal" };
  if (enc.cls === "E") return { type: "institutional", subType: "emr", priority: "stat" };
  return { type: "professional", subType: "op", priority: "normal" };
}

const KIND_OF_DX: Record<string, DxType> = { P: "principal", S: "secondary", AD: "admitting", DF: "differential" };

const digits = (s: string, n: number) => String((s.replace(/\D/g, "") ? Number(s.replace(/\D/g, "")) : s.length) % 10 ** n).padStart(n, "0");
const VISIT_CODE: Record<string, { code: string; text: string }> = {
  O: { code: "SBS-SAMPLE-1001", text: "Outpatient Consultation" },
  E: { code: "SBS-SAMPLE-1002", text: "Emergency Department Visit" },
  I: { code: "SBS-SAMPLE-1003", text: "Inpatient Stay" },
};

export interface BuildInput {
  enc: Encounter;
  patient: Patient;
  /** The visit invoice. Pass a transient one built from estimateCharge when the invoice was not opened yet. */
  invoice: Invoice;
  insurancePaid: number;
  labOrders: LabOrder[];
  radOrders: RadOrder[];
  rx: RxState;
  chart: VitalClaimLine[];
  fin: FinCase;
  draft?: ClaimDraft;
  today?: Date;
}

interface BaseLine { key: string; kind: ClaimServiceLine["kind"]; text: string; code: string; start: string; dxCode?: string }

/** One base line per test, exam and medicine, in the same counts estimateCharge uses. Falls back to numbered lines. */
function expand(inv: InvoiceLine, i: BuildInput): BaseLine[] {
  const v = i.enc.visitNumber;
  const visitDay = dateOnly(i.enc.admitAt ?? i.enc.ed?.arrivalAt);
  let out: BaseLine[] = [];
  if (inv.key === "visit") {
    const c = VISIT_CODE[i.enc.cls] ?? VISIT_CODE.O;
    return [{ key: "visit", kind: "visit", text: c.text, code: c.code, start: visitDay }];
  }
  if (inv.key === "lab") {
    out = i.labOrders.filter((o) => o.visitNumber === v && o.status !== "cancelled").flatMap((o) =>
      o.codes.map((c): BaseLine => ({ key: `lab:${o.id}:${c}`, kind: "lab", text: testByCode(c)?.display ?? `Laboratory test ${c}`, code: `SBS-SAMPLE-3${digits(c, 3)}`, start: dateOnly(o.orderedAt), dxCode: o.diagnosis?.code })));
  } else if (inv.key === "rad") {
    out = i.radOrders.filter((o) => o.visitNumber === v && o.status !== "cancelled").map((o): BaseLine => ({
      key: `rad:${o.id}`, kind: "rad", text: procByCode(o.procCode)?.display ?? `Radiology exam ${o.procCode}`, code: `SBS-SAMPLE-4${digits(o.procCode, 3)}`, start: dateOnly(o.orderedAt), dxCode: o.diagnosis?.code,
    }));
  } else if (inv.key === "rx") {
    out = i.rx.prescriptions.filter((p) => p.visitNumber === v).flatMap((p) =>
      p.items.filter((it) => it.status !== "cancelled" && !it.patientProvided).map((it): BaseLine => {
        let name = it.drugId;
        try { const d = getDrug(it.drugId); name = `${d.generic} ${d.strengthValue} ${d.strengthUnit}`; } catch { /* unknown drug id */ }
        return { key: `rx:${p.id}:${it.id}`, kind: "rx", text: name, code: `SBS-SAMPLE-5${digits(it.drugId, 3)}`, start: dateOnly(p.authoredAt), dxCode: it.reason?.code };
      }));
  }
  if (out.length === inv.units) return out;
  // The invoice is fixed (visit finished) or the orders changed: keep the invoice count, with numbered lines.
  return Array.from({ length: inv.units }, (_, n) => ({ key: `${inv.key}:#${n + 1}`, kind: inv.key as BaseLine["kind"], text: `${inv.service} ${n + 1}`, code: `SBS-SAMPLE-9${digits(inv.key, 1)}${String(n + 1).padStart(2, "0")}`, start: visitDay }));
}

export function buildClaim(i: BuildInput): ClaimModel {
  const { enc, patient, draft } = i;
  const today = todayIso(i.today ?? new Date());
  const head = defaultHeader(enc);

  // Diagnoses from the chart, principal first. The claim may change the type and the on-admission flag.
  const chartDx = enc.dx.map((d, idx) => ({ d, kind: dxKind(d, idx) }));
  const ordered = [...chartDx.filter((x) => x.kind === "P"), ...chartDx.filter((x) => x.kind !== "P")];
  const dx: ClaimDx[] = ordered.map(({ d, kind }, n) => {
    const over = draft?.dx?.[d.code] ?? {};
    const fromChart: OnAdmission = d.onAdmission === true ? "y" : d.onAdmission === false ? "n" : "u";
    return { seq: n + 1, code: d.code, text: d.text, type: over.type ?? KIND_OF_DX[kind] ?? "secondary", onAdmission: over.onAdmission ?? fromChart };
  });
  const dxSeq = new Map(dx.map((d) => [d.code, d.seq]));

  // Care team: what the biller saved, else the attending, admitting and consulting doctors of the visit.
  const team: CareTeamMember[] = draft?.careTeam ?? [
    { doctorId: enc.attending, role: "primary" as CareRole },
    ...(enc.admitting && enc.admitting !== enc.attending ? [{ doctorId: enc.admitting, role: "other" as CareRole }] : []),
    ...(enc.consulting && enc.consulting !== enc.attending && enc.consulting !== enc.admitting ? [{ doctorId: enc.consulting, role: "assist" as CareRole }] : []),
  ].filter((m) => !!m.doctorId);
  const careTeam: ClaimCare[] = team.map((m, n) => {
    const doc = DOCTORS.find((d) => d.id === m.doctorId);
    return {
      seq: n + 1, doctorId: m.doctorId, role: m.role,
      name: doc ? `Dr. ${doc.given} ${doc.family}` : m.doctorId,
      qualification: SERVICES.find((s) => s.code === doc?.service)?.label ?? "Not Recorded",
    };
  });
  const careSeq = new Map(careTeam.map((c) => [c.doctorId, c.seq]));
  const firstCare = careTeam[0] ? [careTeam[0].doctorId] : [];

  // Service lines: the invoice lines split per item at the invoice unit cost, then the biller's extra lines (no price).
  const end = draft?.end ?? (dateOnly(enc.dischargeAt) || today);
  const lines: ClaimServiceLine[] = [];
  for (const inv of i.invoice.lines) {
    const base = expand(inv, i);
    const perDiscount = inv.units ? round2(inv.discount / inv.units) : 0;
    for (const b of base) {
      const edit = draft?.lines?.[b.key] ?? {};
      const defaultDx = b.kind === "visit" ? dx.filter((d) => d.type === "principal").map((d) => d.code) : b.dxCode && dxSeq.has(b.dxCode) ? [b.dxCode] : [];
      const dxCodes = (edit.dxCodes ?? defaultDx).filter((c) => dxSeq.has(c));
      const careIds = (edit.careIds ?? firstCare).filter((c) => careSeq.has(c));
      const gross = round2(inv.unitCost);
      lines.push({
        key: b.key, seq: 0, kind: b.kind, text: b.text, system: edit.system ?? "SBS", code: edit.code ?? b.code,
        start: edit.start ?? (b.start || today), end: edit.end ?? (b.kind === "visit" ? end : b.start || today),
        quantity: 1, unitCost: round2(inv.unitCost), gross, discount: perDiscount, net: round2(gross - perDiscount),
        dxCodes, dxSeqs: dxCodes.map((c) => dxSeq.get(c)!), careIds, careSeqs: careIds.map((c) => careSeq.get(c)!), extra: false,
      });
    }
  }
  for (const x of draft?.extraLines ?? []) {
    const edit = draft?.lines?.[x.key] ?? {};
    const dxCodes = (edit.dxCodes ?? []).filter((c) => dxSeq.has(c));
    const careIds = (edit.careIds ?? firstCare).filter((c) => careSeq.has(c));
    lines.push({
      key: x.key, seq: 0, kind: "proc", text: x.text, system: edit.system ?? x.system, code: edit.code ?? x.code,
      start: edit.start ?? x.start, end: edit.end ?? x.start, quantity: 1, unitCost: 0, gross: 0, discount: 0, net: 0,
      dxCodes, dxSeqs: dxCodes.map((c) => dxSeq.get(c)!), careIds, careSeqs: careIds.map((c) => careSeq.get(c)!), extra: true,
    });
  }
  lines.forEach((l, n) => (l.seq = n + 1));

  const view = invoiceView(i.invoice, i.insurancePaid);
  const charge = { total: view.totals.taxable, lines: [] };
  const authNeeded = needsAuthorization(enc, charge);
  const claim = i.fin.claim;
  return {
    visit: enc.visitNumber, enc, patient, payer: i.invoice.insurer ?? payerOf(patient),
    type: draft?.type ?? head.type, subType: draft?.subType ?? head.subType, priority: draft?.priority ?? head.priority,
    claimDate: draft?.claimDate ?? today, start: draft?.start ?? (dateOnly(enc.admitAt ?? enc.ed?.arrivalAt) || today), end,
    careTeam, dx, chart: i.chart, support: draft?.support ?? [], lines, totals: view.totals, net: view.totals.taxable,
    authNeeded, fin: i.fin,
    drg: enc.cls === "I" ? estimateDrg(dx, dateOnly(enc.admitAt) || today, dateOnly(enc.dischargeAt) || today) : null,
    locked: !!claim && (claim.status === "approved" || claim.status === "pended" || claim.status === "needs-info"),
    draft,
  };
}

/* ---------- AR-DRG estimate ---------- */

const DRG_TABLE: { test: RegExp; adrg: string; text: string; mdc: string }[] = [
  { test: /^A4[01]/, adrg: "T60", text: "Septicaemia", mdc: "MDC 18 Infectious and Parasitic Diseases" },
  { test: /^(J09|J1[0-8]|J2[0-2])/, adrg: "E62", text: "Respiratory Infections and Inflammations", mdc: "MDC 04 Respiratory System" },
  { test: /^J44/, adrg: "E65", text: "Chronic Obstructive Airways Disease", mdc: "MDC 04 Respiratory System" },
  { test: /^(J4[05]|J46)/, adrg: "E69", text: "Bronchitis and Asthma", mdc: "MDC 04 Respiratory System" },
  { test: /^I50/, adrg: "F62", text: "Heart Failure and Shock", mdc: "MDC 05 Circulatory System" },
  { test: /^(R07|I20)/, adrg: "F74", text: "Chest Pain", mdc: "MDC 05 Circulatory System" },
  { test: /^(A0[89]|K5[02])/, adrg: "G67", text: "Oesophagitis and Gastroenteritis", mdc: "MDC 06 Digestive System" },
  { test: /^E1[0-4]/, adrg: "K60", text: "Diabetes", mdc: "MDC 10 Endocrine, Nutritional and Metabolic" },
  { test: /^(N10|N39\.0)/, adrg: "L63", text: "Kidney and Urinary Tract Infections", mdc: "MDC 11 Kidney and Urinary Tract" },
  { test: /^S72\.0/, adrg: "I78", text: "Fracture of Neck of Femur", mdc: "MDC 08 Musculoskeletal System" },
];

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000));

/** Estimated AR-DRG from the principal diagnosis. Two or more secondary diagnoses give the higher complexity split. */
export function estimateDrg(dx: Pick<ClaimDx, "code" | "type">[], admit: string, discharge: string): DrgEstimate {
  const losDays = Math.max(1, daysBetween(admit, discharge));
  const principal = dx.find((d) => d.type === "principal");
  const note = "Estimate only. The AR-DRG grouper and its complexity score decide the final code.";
  if (!principal) return { code: "960Z", text: "Ungroupable", mdc: "Error DRG", losDays, note: "No principal diagnosis. Set one so the stay can be grouped." };
  const hit = DRG_TABLE.find((r) => r.test.test(principal.code));
  if (!hit) return { code: "", text: "Not Estimated", mdc: "", losDays, note: `${principal.code} is not in the estimate table. Send the stay to the AR-DRG grouper.` };
  const secondary = dx.filter((d) => d.type === "secondary").length;
  const split = secondary >= 2 ? "A" : "B";
  return { code: `${hit.adrg}${split}`, text: `${hit.text}, ${split === "A" ? "Major" : "Minor"} Complexity`, mdc: hit.mdc, losDays, note };
}

/* ---------- claim review (scrubbing) ---------- */

export type Severity = "warning" | "soft" | "hard";
export const SEVERITY_LABEL: Record<Severity, string> = { warning: "Warning", soft: "Soft Stop", hard: "Hard Stop" };
export type ClaimUse = "priorauth" | "claim";
export type RuleId = "no-principal-dx" | "many-principal-dx" | "no-chief-complaint" | "no-vitals" | "vitals-missing" | "auth-not-approved" | "line-no-dx" | "line-zero-cost";

export interface Finding {
  /** Rule id, plus the line key for line rules. Soft stops are acknowledged by this id. */
  id: string;
  rule: RuleId;
  severity: Severity;
  text: string;
  fix: string;
  lineKey?: string;
}

export interface ReviewInput {
  dx: { code: string; type: DxType }[];
  chiefComplaint: boolean;
  /** Labels of the vital signs with neither a value nor an absence reason. */
  vitalsMissing: string[];
  vitalsTotal: number;
  authNeeded: boolean;
  authStatus?: AuthStatus;
  lines: { key: string; seq: number; text: string; unitCost: number; dxSeqs: number[] }[];
}

/**
 * Hard Stop blocks sending. Soft Stop needs the biller to confirm with a reason. Warning is shown only.
 * The prior authorization check applies to the claim only.
 */
export function reviewClaim(r: ReviewInput, use: ClaimUse): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "id"> & { id?: string }) => out.push({ ...f, id: f.id ?? f.rule });
  const principal = r.dx.filter((d) => d.type === "principal").length;
  if (principal === 0) add({ rule: "no-principal-dx", severity: "hard", text: "There is no principal diagnosis.", fix: "Set one diagnosis to Principal in the Diagnoses section, or add it in the chart." });
  if (principal > 1) add({ rule: "many-principal-dx", severity: "hard", text: `${principal} diagnoses are marked Principal. Only one is allowed.`, fix: "Change the others to Secondary." });
  if (!r.chiefComplaint) add({ rule: "no-chief-complaint", severity: "hard", text: "The chief complaint is missing.", fix: "Record the chief complaint in the chart." });
  if (r.vitalsTotal > 0 && r.vitalsMissing.length >= r.vitalsTotal) {
    add({ rule: "no-vitals", severity: "hard", text: "No vital signs are recorded for this visit.", fix: "Record the vital signs in the chart, or an absence reason for each one." });
  } else if (r.vitalsMissing.length) {
    add({ rule: "vitals-missing", severity: "soft", text: `Vital signs missing: ${r.vitalsMissing.join(", ")}.`, fix: "Record each one in the chart, or an absence reason. The payer may reject the claim without them." });
  }
  if (use === "claim" && r.authNeeded && r.authStatus !== "approved") {
    const state = !r.authStatus ? "was not requested" : r.authStatus === "pended" ? "is still waiting for the payer" : r.authStatus === "denied" ? "was denied" : "was cancelled";
    add({ rule: "auth-not-approved", severity: "hard", text: `This visit needs prior authorization and it ${state}.`, fix: "Send Prior Authorization and wait for the approval before sending the claim." });
  }
  for (const l of r.lines) {
    if (!l.dxSeqs.length) add({ id: `line-no-dx:${l.key}`, rule: "line-no-dx", severity: "soft", lineKey: l.key, text: `Line ${l.seq}, ${l.text}, is not linked to a diagnosis.`, fix: "Tick the diagnosis this service was for." });
    if (!(l.unitCost > 0)) add({ id: `line-zero-cost:${l.key}`, rule: "line-zero-cost", severity: "warning", lineKey: l.key, text: `Line ${l.seq}, ${l.text}, has no cost.`, fix: "The invoice has no price for it, so the payer pays nothing. Bill it on the invoice or remove the line." });
  }
  const rank: Record<Severity, number> = { hard: 0, soft: 1, warning: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function reviewInputOf(m: ClaimModel): ReviewInput {
  const vitals = m.chart.filter((l) => l.key !== "complaint");
  return {
    dx: m.dx,
    chiefComplaint: m.chart.some((l) => l.key === "complaint" && l.state !== "missing"),
    vitalsMissing: vitals.filter((l) => l.state === "missing").map((l) => l.label),
    vitalsTotal: vitals.length,
    authNeeded: m.authNeeded,
    authStatus: m.fin.authorization?.status,
    lines: m.lines,
  };
}

export const reviewModel = (m: ClaimModel, use: ClaimUse): Finding[] => reviewClaim(reviewInputOf(m), use);

/** Soft stops still to confirm: those whose id is not in the saved confirmation. */
export function unconfirmedSoftStops(findings: Finding[], ack: SoftStopAck | undefined): Finding[] {
  const ok = new Set(ack?.ids ?? []);
  return findings.filter((f) => f.severity === "soft" && !ok.has(f.id));
}

export function reviewSummary(findings: Finding[]): { hard: number; soft: number; warning: number } {
  return {
    hard: findings.filter((f) => f.severity === "hard").length,
    soft: findings.filter((f) => f.severity === "soft").length,
    warning: findings.filter((f) => f.severity === "warning").length,
  };
}

/* ---------- reading from the stores ---------- */

/** The invoice of the visit, or the one it would get, so amounts always come from the invoice rules. */
export function invoiceFor(enc: Encounter, patient: Patient): Invoice {
  return invoiceOf(enc.visitNumber) ?? {
    visit: enc.visitNumber, number: 0, patientId: patient.id, createdAt: new Date().toISOString(),
    insurer: insurerOf(patient), vat: vatAppliesToPatientShare(patient), lines: linesFromCharge(estimateCharge(enc)), transactions: [],
    zatca: { status: "Pending", clockFrom: new Date().toISOString(), attempts: 0 },
  };
}

export function claimFor(visit: string, today: Date = new Date()): ClaimModel | null {
  const his = getState();
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && his.patients.find((p) => p.id === enc.patientId);
  if (!enc || !patient) return null;
  return buildClaim({
    enc, patient, invoice: invoiceFor(enc, patient), insurancePaid: payerPaid(visit), labOrders: getLab().orders, radOrders: getRad().orders,
    rx: getRx(), chart: claimReadiness(visit).lines, fin: caseOf(visit), draft: draftOf(visit), today,
  });
}

/** Insured visits that can carry a claim: billable visits whose patient is not a cash patient. */
export function insuredVisits(): { enc: Encounter; patient: Patient; payer: string }[] {
  const his = getState();
  const out: { enc: Encounter; patient: Patient; payer: string }[] = [];
  for (const enc of his.encounters) {
    if (enc.status === "cancelled" || enc.status === "preadmit") continue;
    const patient = his.patients.find((p) => p.id === enc.patientId);
    if (!patient || patient.mergedInto) continue;
    const payer = insurerOf(patient);
    if (payer) out.push({ enc, patient, payer });
  }
  return out;
}

/* ---------- where the claim stands and what can be sent ---------- */

export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "info";

export function claimStatusOf(fin: FinCase): { label: string; tone: StatusTone } {
  const { eligibility: el, authorization: au, claim: cl, payment: pay } = fin;
  if (pay?.status === "notice-sent") return { label: "Paid", tone: "ok" };
  if (pay) return { label: "Payment Advice Received", tone: "ok" };
  if (cl?.status === "approved") return { label: "Claim Approved", tone: "ok" };
  if (cl?.status === "needs-info") return { label: "Payer Asked A Question", tone: "warn" };
  if (cl?.status === "pended") return { label: "Claim Waiting For Payer", tone: "info" };
  if (cl?.status === "rejected") return { label: "Claim Rejected", tone: "danger" };
  if (cl?.status === "cancelled") return { label: "Claim Cancelled", tone: "neutral" };
  if (au?.status === "pended") return { label: "Authorization Waiting", tone: "info" };
  if (au?.status === "denied") return { label: "Authorization Denied", tone: "danger" };
  if (au?.status === "approved") return { label: "Authorization Approved", tone: "ok" };
  if (el?.status === "not-eligible") return { label: "Not Eligible", tone: "danger" };
  if (el?.status === "eligible") return { label: "Eligible", tone: "neutral" };
  return { label: "Not Started", tone: "neutral" };
}

export interface SendOption {
  enabled: boolean;
  label: string;
  action: FinAction | null;
  /** True when the action sends a request that the claim review must clear (not a poll or an answer). */
  reviewed: boolean;
  why: string;
}

const PA_LABEL: Record<string, string> = { "Request Authorization": "Send Prior Authorization", "Request Again": "Send Prior Authorization Again", "Check For Answer": "Check Authorization Answer" };
const CLAIM_LABEL: Record<string, string> = { "Submit Claim": "Send Claim", "Resubmit Claim": "Send Claim Again", "Check For Answer": "Check Claim Answer", "Send Answer": "Send Answer To Payer" };

/** What the three buttons can do now, read from the NPHIES Financial steps so every screen agrees. */
export function sendOptions(enc: Encounter, fin = getFinancial()): { eligibility: SendOption; priorAuth: SendOption; claim: SendOption } {
  const [el, au, cl] = stepViews(enc, fin);
  const opt = (v: typeof el, labels: Record<string, string>, fallback: string, reviewedActions: FinAction[]): SendOption => {
    const action = finActionFor(v);
    return {
      enabled: !!action, action, reviewed: !!action && reviewedActions.includes(action),
      label: (v.action && labels[v.action]) ?? fallback,
      why: action ? v.hint : v.hint || v.status,
    };
  };
  return {
    eligibility: opt(el, { "Check Eligibility": "Check Eligibility", "Check Again": "Check Eligibility Again" }, "Check Eligibility", []),
    priorAuth: opt(au, PA_LABEL, "Send Prior Authorization", ["authorization"]),
    claim: opt(cl, CLAIM_LABEL, "Send Claim", ["claim"]),
  };
}

/* ---------- actions ---------- */

export type ActionResult = { ok: true } | { ok: false; problems: string[]; needsConfirm?: boolean; blocked?: boolean };

const who = () => { try { return currentUser().name; } catch { return "Unknown"; } };
const denied = (target: string): ActionResult => {
  audit("denied", target, { detail: "Needs billing" });
  return { ok: false, problems: ["Your role cannot change claims. This needs the billing permission."] };
};

function upsertDraft(visit: string, fn: (d: ClaimDraft) => ClaimDraft): ClaimDraft {
  const s = store.get();
  const cur = draftOf(visit, s) ?? { visit };
  const next = fn(cur);
  store.set({ ...s, drafts: s.drafts.some((d) => d.visit === visit) ? s.drafts.map((d) => (d.visit === visit ? next : d)) : [...s.drafts, next] });
  return next;
}

function editable(visit: string, target: string): ActionResult | null {
  if (!can("billing")) return denied(target);
  const m = claimFor(visit);
  if (!m) return { ok: false, problems: ["This visit was not found."] };
  if (m.locked) return { ok: false, problems: ["The payer is holding or has approved this claim. It cannot be changed now."] };
  return null;
}

const nameFor = (visit: string) => {
  const his = getState();
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  return patientName(his.patients.find((p) => p.id === enc?.patientId));
};

export type HeaderPatch = Partial<Pick<ClaimDraft, "type" | "subType" | "priority" | "claimDate" | "start" | "end">>;

export function saveHeader(visit: string, patch: HeaderPatch): ActionResult {
  const no = editable(visit, `Claim header, visit ${visit}`);
  if (no) return no;
  if (patch.start && patch.end && patch.end < patch.start) return { ok: false, problems: ["The service end date is before the start date."] };
  upsertDraft(visit, (d) => ({ ...d, ...patch }));
  audit("update", `Claim header, visit ${visit}`, { patient: nameFor(visit), detail: Object.keys(patch).join(", ") });
  return { ok: true };
}

export function saveCareTeam(visit: string, team: CareTeamMember[]): ActionResult {
  const no = editable(visit, `Claim care team, visit ${visit}`);
  if (no) return no;
  const ids = team.map((m) => m.doctorId);
  if (!team.length) return { ok: false, problems: ["The care team needs at least one doctor."] };
  if (new Set(ids).size !== ids.length) return { ok: false, problems: ["A doctor is listed twice in the care team."] };
  if (!team.some((m) => m.role === "primary")) return { ok: false, problems: ["One doctor must have the Primary role."] };
  upsertDraft(visit, (d) => ({ ...d, careTeam: team.map((m) => ({ ...m })) }));
  audit("update", `Claim care team, visit ${visit}`, { patient: nameFor(visit), detail: `${team.length} member(s)` });
  return { ok: true };
}

export function saveDx(visit: string, code: string, patch: { type?: DxType; onAdmission?: OnAdmission }): ActionResult {
  const no = editable(visit, `Claim diagnosis, visit ${visit}`);
  if (no) return no;
  upsertDraft(visit, (d) => ({ ...d, dx: { ...(d.dx ?? {}), [code]: { ...(d.dx?.[code] ?? {}), ...patch } } }));
  audit("update", `Claim diagnosis ${code}, visit ${visit}`, { patient: nameFor(visit), detail: [patch.type && `Type ${DX_TYPE_LABEL[patch.type]}`, patch.onAdmission && `On admission ${ON_ADMISSION_LABEL[patch.onAdmission]}`].filter(Boolean).join(", ") });
  return { ok: true };
}

export function addSupport(visit: string, category: string, value: string): ActionResult {
  const no = editable(visit, `Claim supporting information, visit ${visit}`);
  if (no) return no;
  const text = value.trim();
  if (!SUPPORT_LABEL[category]) return { ok: false, problems: ["Choose a category from the list."] };
  if (text.length < 2) return { ok: false, problems: ["Type the value."] };
  const s = store.get();
  store.set({ ...s, seq: s.seq + 1 });
  upsertDraft(visit, (d) => ({ ...d, support: [...(d.support ?? []), { id: `SI-${s.seq + 1}`, category, value: text }] }));
  audit("update", `Claim supporting information, visit ${visit}`, { patient: nameFor(visit), detail: `${SUPPORT_LABEL[category]} added` });
  return { ok: true };
}

export function removeSupport(visit: string, id: string): ActionResult {
  const no = editable(visit, `Claim supporting information, visit ${visit}`);
  if (no) return no;
  upsertDraft(visit, (d) => ({ ...d, support: (d.support ?? []).filter((x) => x.id !== id) }));
  return { ok: true };
}

export function saveLine(visit: string, key: string, patch: LineEdit): ActionResult {
  const no = editable(visit, `Claim service line, visit ${visit}`);
  if (no) return no;
  if (patch.start && patch.end && patch.end < patch.start) return { ok: false, problems: ["The line end date is before its start date."] };
  if (patch.code !== undefined && !patch.code.trim()) return { ok: false, problems: ["The service code cannot be empty."] };
  upsertDraft(visit, (d) => ({ ...d, lines: { ...(d.lines ?? {}), [key]: { ...(d.lines?.[key] ?? {}), ...patch } } }));
  return { ok: true };
}

/** Adds a procedure from the chart as an ACHI line. It carries no price, so the review warns about it. */
export function addProcedureLine(visit: string, pr: Pick<Pr, "code" | "text" | "at" | "dxCode">): ActionResult {
  const no = editable(visit, `Claim service line, visit ${visit}`);
  if (no) return no;
  const s = store.get();
  store.set({ ...s, seq: s.seq + 1 });
  const key = `proc:${pr.code}:${s.seq + 1}`;
  upsertDraft(visit, (d) => ({
    ...d,
    extraLines: [...(d.extraLines ?? []), { key, system: "ACHI", code: pr.code, text: pr.text, start: dateOnly(pr.at) || todayIso(new Date()) }],
    lines: pr.dxCode ? { ...(d.lines ?? {}), [key]: { dxCodes: [pr.dxCode] } } : d.lines,
  }));
  audit("update", `Claim service line, visit ${visit}`, { patient: nameFor(visit), detail: `ACHI ${pr.code} added` });
  return { ok: true };
}

export function removeExtraLine(visit: string, key: string): ActionResult {
  const no = editable(visit, `Claim service line, visit ${visit}`);
  if (no) return no;
  upsertDraft(visit, (d) => ({ ...d, extraLines: (d.extraLines ?? []).filter((x) => x.key !== key) }));
  return { ok: true };
}

/** Runs the review and records when. Returns the findings for both uses. */
export function runReview(visit: string, today: Date = new Date()): { priorauth: Finding[]; claim: Finding[] } | null {
  const m = claimFor(visit, today);
  if (!m) return null;
  const res = { priorauth: reviewModel(m, "priorauth"), claim: reviewModel(m, "claim") };
  if (can("billing")) upsertDraft(visit, (d) => ({ ...d, reviewedAt: new Date().toISOString() }));
  const sum = reviewSummary(res.claim);
  audit("view", `Claim review, visit ${visit}`, { patient: nameFor(visit), detail: `${sum.hard} hard stop(s), ${sum.soft} soft stop(s), ${sum.warning} warning(s)` });
  return res;
}

/** The biller confirms the soft stops shown now, with a reason. A new soft stop later needs a new confirmation. */
export function confirmSoftStops(visit: string, ids: string[], reason: string): ActionResult {
  if (!can("billing")) return denied(`Claim soft stops, visit ${visit}`);
  const text = reason.trim();
  if (text.length < 5) return { ok: false, problems: ["Type why it is safe to send with these soft stops."] };
  upsertDraft(visit, (d) => ({ ...d, ack: { at: new Date().toISOString(), by: who(), reason: text, ids: [...new Set(ids)] } }));
  audit("update", `Claim soft stops confirmed, visit ${visit}`, { patient: nameFor(visit), detail: `${ids.length} soft stop(s). Reason: ${text}` });
  return { ok: true };
}

/**
 * Sends prior authorization or the claim through NPHIES Financial (runFinancial). A request is sent only when the
 * review has no hard stop and every soft stop is confirmed. Checking for an answer is never held back.
 */
export function sendFromClaim(visit: string, use: ClaimUse, today: Date = new Date()): ActionResult {
  if (!can("billing")) return denied(`Claim send, visit ${visit}`);
  const m = claimFor(visit, today);
  if (!m) return { ok: false, problems: ["This visit was not found."] };
  const opt = sendOptions(m.enc)[use === "claim" ? "claim" : "priorAuth"];
  if (!opt.enabled || !opt.action) return { ok: false, problems: [opt.why || "Nothing can be sent at this step."] };
  if (opt.reviewed) {
    const findings = reviewModel(m, use);
    const hard = findings.filter((f) => f.severity === "hard");
    if (hard.length) {
      audit("denied", `${use === "claim" ? "Claim" : "Prior authorization"} send, visit ${visit}`, { patient: patientName(m.patient), detail: `Blocked by ${hard.length} hard stop(s)` });
      return { ok: false, blocked: true, problems: hard.map((f) => f.text) };
    }
    const soft = unconfirmedSoftStops(findings, m.draft?.ack);
    if (soft.length) return { ok: false, needsConfirm: true, problems: soft.map((f) => f.text) };
  }
  const ok = runFinancial(visit, opt.action);
  if (!ok) return { ok: false, problems: ["NPHIES Financial did not run this step."] };
  upsertDraft(visit, (d) => ({ ...d, sends: [...(d.sends ?? []), { at: new Date().toISOString(), by: who(), use, action: opt.action!, amount: m.net }].slice(-30) }));
  return { ok: true };
}

/** Eligibility comes first in NPHIES Financial. Offered on the claim so the biller does not have to leave it. */
export function checkEligibility(visit: string): ActionResult {
  if (!can("billing")) return denied(`Eligibility, visit ${visit}`);
  const his = getState();
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  if (!enc) return { ok: false, problems: ["This visit was not found."] };
  const opt = sendOptions(enc).eligibility;
  if (!opt.enabled || !opt.action) return { ok: false, problems: [opt.why || "Eligibility is already confirmed."] };
  return runFinancial(visit, opt.action) ? { ok: true } : { ok: false, problems: ["NPHIES Financial did not run this step."] };
}
