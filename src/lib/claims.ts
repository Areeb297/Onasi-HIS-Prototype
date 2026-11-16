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
import { DEMO_MARK, demoClaimTypeOf, demoTargetOf } from "./rcm-demo";
import { activeRuleSet, evaluateConditions, ruleApplies, type ClaimFacts, type FieldMap, type Rule } from "./rule-engine";
import { buildDemoClaims, type DemoClaimInput, type PayerAnswer } from "./rcm-demo-claims";

export type { AnswerError, AnswerLine, PayerAnswer } from "./rcm-demo-claims";

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
export interface SendLog { at: string; by: string; use: ClaimUse; action: FinAction; amount: number; batchId?: string }
/** The last batch the claim was sent in, from the Billing Worklist. */
export interface BatchRef { id: string; at: string; priority: ClaimPriority; by: string }

export interface ClaimDraft {
  visit: string;
  type?: ClaimType;
  subType?: ClaimSubType;
  priority?: ClaimPriority;
  claimDate?: string;
  /** The day the claim is booked in the accounts. Defaults to the claim date. */
  accountingDate?: string;
  /** When the biller last pressed Save. Edits are kept as they are made; Save marks the claim as checked. */
  savedAt?: string;
  savedBy?: string;
  batch?: BatchRef;
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

interface ClaimState {
  drafts: ClaimDraft[];
  seq: number;
  /** Payer answers kept beyond NPHIES Financial: rejection errors and line approvals and denials, by visit. */
  answers?: Record<string, PayerAnswer>;
  /** The demo claim history was added once; a reset of NPHIES Financial does not bring it back. */
  demoSeeded?: boolean;
}

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
  accountingDate: string;
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
  /** The payer's answer for the claim now on file (or the denied prior authorization), when one was recorded. */
  answer?: PayerAnswer;
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
  O: { code: "83600-00-00", text: "General Practitioner Consult" },
  E: { code: "83600-00-90", text: "Emergency Consult" },
  I: { code: "83000-00-01", text: "Undetermined Stay In Ward" },
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
  answer?: PayerAnswer;
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
    claimDate: draft?.claimDate ?? today, accountingDate: draft?.accountingDate ?? draft?.claimDate ?? today, start: draft?.start ?? (dateOnly(enc.admitAt ?? enc.ed?.arrivalAt) || today), end,
    careTeam, dx, chart: i.chart, support: draft?.support ?? [], lines, totals: view.totals, net: view.totals.taxable,
    authNeeded, fin: i.fin,
    drg: enc.cls === "I" ? estimateDrg(dx, dateOnly(enc.admitAt) || today, dateOnly(enc.dischargeAt) || today) : null,
    locked: !!claim && (claim.status === "approved" || claim.status === "pended" || claim.status === "needs-info"),
    draft,
    answer: answerFor(i.answer, i.fin),
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
  /** The built-in check (RuleId) or, for a condition rule, the rule's id in the rule engine. */
  rule: RuleId | (string & {});
  severity: Severity;
  text: string;
  fix: string;
  lineKey?: string;
  /** The rule engine rule that produced the finding, and its NPHIES code when it has one. */
  ruleId?: string;
  nphiesCode?: string;
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
  /** Claim type, for rules limited to some claim types. */
  claimType?: string;
  /** Field values for the condition rules of the rule engine. Without them only the built-in checks run. */
  facts?: ClaimFacts;
}

/**
 * Runs the active rules of the rule engine (rule-engine.ts). The built-in checks keep their own wording; their severity,
 * trigger, claim types and on/off come from their rule. Condition rules run on the claim facts.
 * Hard Stop blocks sending. Soft Stop needs the biller to confirm with a reason. Warning is shown only.
 * Prior authorization approval is checked for the claim only, whatever the rule's trigger.
 */
export function reviewClaim(r: ReviewInput, use: ClaimUse, set: { rules: Rule[]; fields: FieldMap[] } = activeRuleSet()): Finding[] {
  const out: Finding[] = [];
  const rules = set.rules.filter((x) => ruleApplies(x, use, r.claimType));
  const add = (rule: RuleId, f: Omit<Finding, "id" | "rule" | "severity"> & { id?: string }) => {
    const def = rules.find((x) => x.check === rule);
    if (def) out.push({ ...f, id: f.id ?? rule, rule, severity: def.severity, ruleId: def.id, nphiesCode: def.nphiesCode });
  };
  const principal = r.dx.filter((d) => d.type === "principal").length;
  if (principal === 0) add("no-principal-dx", { text: "There is no principal diagnosis.", fix: "Set one diagnosis to Principal in the Diagnoses section, or add it in the chart." });
  if (principal > 1) add("many-principal-dx", { text: `${principal} diagnoses are marked Principal. Only one is allowed.`, fix: "Change the others to Secondary." });
  if (!r.chiefComplaint) add("no-chief-complaint", { text: "The chief complaint is missing.", fix: "Record the chief complaint in the chart." });
  if (r.vitalsTotal > 0 && r.vitalsMissing.length >= r.vitalsTotal) {
    add("no-vitals", { text: "No vital signs are recorded for this visit.", fix: "Record the vital signs in the chart, or an absence reason for each one." });
  } else if (r.vitalsMissing.length) {
    add("vitals-missing", { text: `Vital signs missing: ${r.vitalsMissing.join(", ")}.`, fix: "Record each one in the chart, or an absence reason. The payer may reject the claim without them." });
  }
  if (use === "claim" && r.authNeeded && r.authStatus !== "approved") {
    const state = !r.authStatus ? "was not requested" : r.authStatus === "pended" ? "is still waiting for the payer" : r.authStatus === "denied" ? "was denied" : "was cancelled";
    add("auth-not-approved", { text: `This visit needs prior authorization and it ${state}.`, fix: "Send Prior Authorization and wait for the approval before sending the claim." });
  }
  for (const l of r.lines) {
    if (!l.dxSeqs.length) add("line-no-dx", { id: `line-no-dx:${l.key}`, lineKey: l.key, text: `Line ${l.seq}, ${l.text}, is not linked to a diagnosis.`, fix: "Tick the diagnosis this service was for." });
    if (!(l.unitCost > 0)) add("line-zero-cost", { id: `line-zero-cost:${l.key}`, lineKey: l.key, text: `Line ${l.seq}, ${l.text}, has no cost.`, fix: "The invoice has no price for it, so the payer pays nothing. Bill it on the invoice or remove the line." });
  }
  if (r.facts) {
    for (const rule of rules.filter((x) => !x.check && x.conditions?.length)) {
      for (const hit of evaluateConditions(rule.conditions!, r.facts, set.fields)) {
        out.push({
          id: hit.lineKey ? `rule:${rule.id}:${hit.lineKey}` : `rule:${rule.id}`, rule: rule.id, ruleId: rule.id, nphiesCode: rule.nphiesCode, severity: rule.severity, lineKey: hit.lineKey,
          text: hit.seq ? `Line ${hit.seq}, ${hit.text}: ${rule.message}` : rule.message, fix: rule.fix,
        });
      }
    }
  }
  const rank: Record<Severity, number> = { hard: 0, soft: 1, warning: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

const dayGap = (a?: string, b?: string) => (a ? Math.max(0, Math.round(((b ? new Date(b) : new Date()).getTime() - new Date(a).getTime()) / 86_400_000)) : 0);
const ageOn = (dob: string, on: Date) => {
  const d = new Date(`${dob}T00:00:00`);
  let age = on.getFullYear() - d.getFullYear();
  if (on.getMonth() < d.getMonth() || (on.getMonth() === d.getMonth() && on.getDate() < d.getDate())) age -= 1;
  return age;
};

/** The values the condition rules read, from the built claim. The keys are the rule engine's field keys. */
export function claimFacts(m: ClaimModel): ClaimFacts {
  const el = m.fin.eligibility?.status;
  const au = m.fin.authorization?.status;
  return {
    claim: {
      "claim.type": m.type, "claim.subType": m.subType, "claim.priority": m.priority, "claim.payer": m.payer, "claim.net": m.net, "claim.insurance": m.totals.insuranceAmount,
      "claim.lineCount": m.lines.length, "claim.end": m.end, "dx.count": m.dx.length, "dx.principalCount": m.dx.filter((d) => d.type === "principal").length,
      "dx.codes": m.dx.map((d) => d.code).join(" "), "careTeam.count": m.careTeam.length, "careTeam.primaryCount": m.careTeam.filter((c) => c.role === "primary").length,
      "encounter.class": m.enc.cls, "encounter.lengthOfStay": m.enc.cls === "I" ? dayGap(m.enc.admitAt, m.enc.dischargeAt) : 0,
      "encounter.triage": m.enc.ed?.ctas ? `CTAS ${m.enc.ed.ctas}` : "", "eligibility.status": el === "eligible" ? "Eligible" : el === "not-eligible" ? "Not Eligible" : "",
      "auth.status": au ? (au === "approved" ? "Approved" : au === "pended" ? "Pended" : au === "denied" ? "Denied" : "Cancelled") : "",
      "patient.age": ageOn(m.patient.dob, new Date()), "patient.sex": m.patient.sex, "complaint.text": m.chart.find((l) => l.key === "complaint")?.value ?? "",
    },
    lines: m.lines.map((l) => ({
      key: l.key, seq: l.seq, text: l.text,
      values: { "line.system": l.system, "line.code": l.code, "line.kind": l.kind, "line.quantity": l.quantity, "line.unitCost": l.unitCost, "line.net": l.net, "line.dxLinks": l.dxSeqs.length },
    })),
  };
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
    claimType: m.type,
    facts: claimFacts(m),
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
    rx: getRx(), chart: withVisitVitals(claimReadiness(visit).lines, enc), fin: caseOf(visit), draft: draftOf(visit), answer: store.get().answers?.[visit], today,
  });
}

/**
 * Vital signs recorded on the visit at the nurse station (the visit record) count for the claim when the chart has no
 * reading of that sign. Readings in the chart always win.
 */
export function withVisitVitals(lines: VitalClaimLine[], enc: Pick<Encounter, "vitals">): VitalClaimLine[] {
  const v = enc.vitals;
  if (!v) return lines;
  const [sbp, dbp] = (v.bp ?? "").split("/").map((x) => x.trim());
  const val: Record<string, string | undefined> = {
    sbp: sbp ? `${sbp} mmHg` : undefined, dbp: dbp ? `${dbp} mmHg` : undefined, pulse: v.pulse ? `${v.pulse} /min` : undefined,
    rr: v.rr ? `${v.rr} /min` : undefined, temp: v.temp ? `${v.temp} °C` : undefined, spo2: v.spo2 ? `${v.spo2} %` : undefined,
    weight: v.weight ? `${v.weight} kg` : undefined, height: v.height ? `${v.height} cm` : undefined,
  };
  return lines.map((l) => (l.state === "missing" && val[l.key] ? { ...l, state: "measured" as const, value: val[l.key] } : l));
}

/** A stored answer belongs to the claim on file only; a claim sent again gets a new number and its own answer. */
function answerFor(a: PayerAnswer | undefined, fin: FinCase): PayerAnswer | undefined {
  if (!a) return undefined;
  if (a.claimNumber) return fin.claim?.claimNumber === a.claimNumber ? a : undefined;
  return fin.authorization?.status === "denied" && !fin.claim ? a : undefined;
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

/** Every status the worklist can show, in the HIS words, in the order of the claim's life. */
export const CLAIM_STATUSES = [
  "Drafted", "Reviewed", "Not Eligible", "PreAuth Pended", "PreAuth Approved", "PreAuth Rejected", "PreAuth Cancelled", "Claim Submitted", "Claim Pended",
  "Claim Approved", "Claim Partially Approved", "Claim Rejected", "Claim Cancelled", "Payment Received", "Partially Paid", "Paid",
] as const;

/**
 * Where the claim stands, in the HIS words. A visit with no claim sent is Drafted, or Reviewed once the review ran.
 * Partially Approved compares the line answers with the claim; Partially Paid compares the payment with the approved amount.
 */
export function claimStatusOf(fin: FinCase, extra: { draft?: ClaimDraft; answer?: PayerAnswer } = {}): { label: string; tone: StatusTone } {
  const { eligibility: el, authorization: au, claim: cl, payment: pay } = fin;
  const partlyApproved = !!extra.answer?.lines.some((l) => l.denied > 0.004);
  if (pay && cl?.approved !== undefined && pay.amount + 0.004 < cl.approved) return { label: "Partially Paid", tone: "warn" };
  if (pay?.status === "notice-sent") return { label: "Paid", tone: "ok" };
  if (pay) return { label: "Payment Received", tone: "ok" };
  if (cl?.status === "approved") return partlyApproved ? { label: "Claim Partially Approved", tone: "warn" } : { label: "Claim Approved", tone: "ok" };
  if (cl?.status === "needs-info") return { label: "Claim Pended", tone: "warn" };
  if (cl?.status === "pended") return { label: "Claim Submitted", tone: "info" };
  if (cl?.status === "rejected") return { label: "Claim Rejected", tone: "danger" };
  if (cl?.status === "cancelled") return { label: "Claim Cancelled", tone: "neutral" };
  if (au?.status === "pended") return { label: "PreAuth Pended", tone: "info" };
  if (au?.status === "denied") return { label: "PreAuth Rejected", tone: "danger" };
  if (au?.status === "approved") return { label: "PreAuth Approved", tone: "ok" };
  if (au?.status === "cancelled") return { label: "PreAuth Cancelled", tone: "neutral" };
  if (el?.status === "not-eligible") return { label: "Not Eligible", tone: "danger" };
  if (extra.draft?.reviewedAt) return { label: "Reviewed", tone: "info" };
  return { label: "Drafted", tone: "neutral" };
}

/** Status of a built claim, with its draft and payer answer. */
export const statusOfClaim = (m: Pick<ClaimModel, "fin" | "draft" | "answer">) => claimStatusOf(m.fin, { draft: m.draft, answer: m.answer });

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
    priorAuth: claimSent(enc.visitNumber, fin)
      ? { enabled: false, label: "Send Prior Authorization", action: null, reviewed: false, why: "The claim is already with the payer. Prior authorization comes before the claim." }
      : opt(au, PA_LABEL, "Send Prior Authorization", ["authorization"]),
    claim: opt(cl, CLAIM_LABEL, "Send Claim", ["claim"]),
  };
}

/** A claim the payer holds, answered or not (a rejected or cancelled claim can be sent again). */
function claimSent(visit: string, fin: ReturnType<typeof getFinancial>): boolean {
  const c = caseOf(visit, fin).claim;
  return !!c && c.status !== "rejected" && c.status !== "cancelled";
}

/* ---------- actions ---------- */

export type ActionResult = { ok: true } | { ok: false; problems: string[]; needsConfirm?: boolean; blocked?: boolean };

const who = () => { try { return currentUser().name; } catch { return "Unknown"; } };
type Right = "billing" | "coding" | "approvals";
const RIGHT_WORK: Record<Right, string> = { billing: "change or send claims", coding: "change diagnoses or service codes", approvals: "check eligibility or ask for prior authorization" };
const denied = (target: string, right: Right = "billing"): ActionResult => {
  audit("denied", target, { detail: `Needs ${right}` });
  return { ok: false, problems: [`Your role cannot ${RIGHT_WORK[right]}. This needs the ${right} permission.`] };
};

function upsertDraft(visit: string, fn: (d: ClaimDraft) => ClaimDraft): ClaimDraft {
  const s = store.get();
  const cur = draftOf(visit, s) ?? { visit };
  const next = fn(cur);
  store.set({ ...s, drafts: s.drafts.some((d) => d.visit === visit) ? s.drafts.map((d) => (d.visit === visit ? next : d)) : [...s.drafts, next] });
  return next;
}

function editable(visit: string, target: string, right: Right = "billing"): ActionResult | null {
  if (!can(right)) return denied(target, right);
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

export type HeaderPatch = Partial<Pick<ClaimDraft, "type" | "subType" | "priority" | "claimDate" | "accountingDate" | "start" | "end">>;

export function saveHeader(visit: string, patch: HeaderPatch): ActionResult {
  const no = editable(visit, `Claim header, visit ${visit}`);
  if (no) return no;
  if (patch.start && patch.end && patch.end < patch.start) return { ok: false, problems: ["The service end date is before the start date."] };
  if (patch.claimDate === "" || patch.accountingDate === "") return { ok: false, problems: ["The date cannot be empty."] };
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
  const no = editable(visit, `Claim diagnosis, visit ${visit}`, "coding");
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
  const no = editable(visit, `Claim service line, visit ${visit}`, "coding");
  if (no) return no;
  if (patch.start && patch.end && patch.end < patch.start) return { ok: false, problems: ["The line end date is before its start date."] };
  if (patch.code !== undefined && !patch.code.trim()) return { ok: false, problems: ["The service code cannot be empty."] };
  upsertDraft(visit, (d) => ({ ...d, lines: { ...(d.lines ?? {}), [key]: { ...(d.lines?.[key] ?? {}), ...patch } } }));
  return { ok: true };
}

/** Adds a procedure from the chart as an ACHI line. It carries no price, so the review warns about it. */
export function addProcedureLine(visit: string, pr: Pick<Pr, "code" | "text" | "at" | "dxCode">): ActionResult {
  const no = editable(visit, `Claim service line, visit ${visit}`, "coding");
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
  const no = editable(visit, `Claim service line, visit ${visit}`, "coding");
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
export function sendFromClaim(visit: string, use: ClaimUse, today: Date = new Date(), batchId?: string): ActionResult {
  const right: Right = use === "claim" ? "billing" : "approvals";
  if (!can(right)) return denied(`${use === "claim" ? "Claim" : "Prior authorization"} send, visit ${visit}`, right);
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
  upsertDraft(visit, (d) => ({ ...d, sends: [...(d.sends ?? []), { at: new Date().toISOString(), by: who(), use, action: opt.action!, amount: m.net, ...(batchId ? { batchId } : {}) }].slice(-30) }));
  return { ok: true };
}

/** Save on the claim form. Every edit is already kept; Save records who checked the claim and when. */
export function saveClaim(visit: string): ActionResult {
  const no = editable(visit, `Claim save, visit ${visit}`);
  if (no) return no;
  upsertDraft(visit, (d) => ({ ...d, savedAt: new Date().toISOString(), savedBy: who() }));
  audit("update", `Claim saved, visit ${visit}`, { patient: nameFor(visit) });
  return { ok: true };
}

/* ---------- billing worklist ---------- */

/**
 * Item chips of a worklist row. The HIS shows Dx, Proc, EnM, Lab, Rad, Rx and Pkg. Saudi hospitals bill a consultation
 * with an SBS code, not a US E&M level, so EnM is shown as Consult. The inpatient stay line has its own chip.
 * Packages are not modelled here, so Pkg stays at zero.
 */
export type ItemChip = "dx" | "proc" | "consult" | "stay" | "lab" | "rad" | "rx" | "pkg";
export const ITEM_CHIPS: { key: ItemChip; short: string; full: string }[] = [
  { key: "dx", short: "Dx", full: "Diagnoses (ICD-10-AM)" },
  { key: "proc", short: "Proc", full: "Procedures (ACHI)" },
  { key: "consult", short: "Consult", full: "Consultations" },
  { key: "stay", short: "Stay", full: "Inpatient stay" },
  { key: "lab", short: "Lab", full: "Laboratory tests" },
  { key: "rad", short: "Rad", full: "Radiology exams" },
  { key: "rx", short: "Rx", full: "Medicines" },
  { key: "pkg", short: "Pkg", full: "Packages" },
];

export interface ItemCounts { total: number; chips: Record<ItemChip, number> }

/** Total Items is the number of service lines. Dx counts the claim diagnoses, which are not service lines. */
export function itemCounts(m: { dx: unknown[]; lines: Pick<ClaimServiceLine, "kind">[]; enc: Pick<Encounter, "cls"> }): ItemCounts {
  const chips: Record<ItemChip, number> = { dx: m.dx.length, proc: 0, consult: 0, stay: 0, lab: 0, rad: 0, rx: 0, pkg: 0 };
  for (const l of m.lines) {
    if (l.kind === "visit") chips[m.enc.cls === "I" ? "stay" : "consult"] += 1;
    else chips[l.kind] += 1;
  }
  return { total: m.lines.length, chips };
}

export interface WorklistRow {
  visit: string;
  enc: Encounter;
  patient: Patient;
  payer: string;
  m: ClaimModel;
  status: { label: string; tone: StatusTone };
  findings: Finding[];
  options: ReturnType<typeof sendOptions>;
  /** Local date-time the visit started: admission, arrival or registration. */
  visitAt: string;
  invoiceNumber?: number;
  items: ItemCounts;
}

/** One row per insured visit, newest first. */
export function billingRows(fin = getFinancial(), today: Date = new Date()): WorklistRow[] {
  return insuredVisits().map(({ enc, patient, payer }) => {
    const m = claimFor(enc.visitNumber, today)!;
    return {
      visit: enc.visitNumber, enc, patient, payer, m,
      status: statusOfClaim(m), findings: reviewModel(m, "claim"), options: sendOptions(enc, fin),
      visitAt: enc.admitAt ?? enc.ed?.arrivalAt ?? "", invoiceNumber: invoiceOf(enc.visitNumber)?.number || undefined,
      items: itemCounts(m),
    };
  });
}

export interface WorklistFilter { patient: string; payer: string; type: "" | ClaimType; status: string; from: string; to: string }
export const EMPTY_WORKLIST_FILTER: WorklistFilter = { patient: "", payer: "", type: "", status: "", from: "", to: "" };
export type WorklistSort = "visit-desc" | "visit-asc" | "patient" | "payer" | "net-desc" | "net-asc";
export const WORKLIST_SORT_LABEL: Record<WorklistSort, string> = {
  "visit-desc": "Newest First", "visit-asc": "Oldest First", patient: "Patient Name", payer: "Payer", "net-desc": "Highest Net", "net-asc": "Lowest Net",
};

type FilterableRow = Pick<WorklistRow, "visit" | "payer" | "status" | "visitAt"> & { patient: Patient; m: Pick<ClaimModel, "type" | "net" | "fin"> };

/** Patient search matches the name, MRN, visit number, invoice number or claim number. Dates compare the visit day. */
export function filterRows<R extends FilterableRow & { invoiceNumber?: number }>(rows: R[], f: WorklistFilter): R[] {
  const q = f.patient.trim().toLowerCase();
  return rows.filter((r) => {
    const day = r.visitAt.slice(0, 10);
    if (q && !`${patientName(r.patient)} ${r.patient.mrn} ${r.visit} ${r.invoiceNumber ?? ""} ${r.m.fin.claim?.claimNumber ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.payer && r.payer !== f.payer) return false;
    if (f.type && r.m.type !== f.type) return false;
    if (f.status && r.status.label !== f.status) return false;
    if (f.from && (!day || day < f.from)) return false;
    if (f.to && (!day || day > f.to)) return false;
    return true;
  });
}

export function sortRows<R extends FilterableRow>(rows: R[], sort: WorklistSort): R[] {
  const by: Record<WorklistSort, (a: R, b: R) => number> = {
    "visit-desc": (a, b) => b.visitAt.localeCompare(a.visitAt),
    "visit-asc": (a, b) => a.visitAt.localeCompare(b.visitAt),
    patient: (a, b) => patientName(a.patient).localeCompare(patientName(b.patient)),
    payer: (a, b) => a.payer.localeCompare(b.payer) || b.visitAt.localeCompare(a.visitAt),
    "net-desc": (a, b) => b.m.net - a.m.net,
    "net-asc": (a, b) => a.m.net - b.m.net,
  };
  return [...rows].sort((a, b) => by[sort](a, b) || a.visit.localeCompare(b.visit));
}

/** Which bulk action a selection allows. Both need one payer; Submit also needs claims that can be sent now. */
export interface BatchCheck {
  ok: boolean;
  why: string;
  payer?: string;
  /** Visits the action will run on. */
  ready: string[];
  /** Visits it will skip, with the reason. */
  skipped: { visit: string; why: string }[];
}

export function batchCheck(rows: Pick<WorklistRow, "visit" | "payer" | "options">[], kind: "review" | "submit"): BatchCheck {
  if (!rows.length) return { ok: false, why: "Select at least one claim.", ready: [], skipped: [] };
  const payers = [...new Set(rows.map((r) => r.payer))];
  if (payers.length > 1) {
    const named = payers.length === 2 ? `${payers[0]} and ${payers[1]}` : `${payers.length} payers`;
    return { ok: false, why: `A batch goes to one payer. The selection has claims for ${named}.`, ready: [], skipped: [] };
  }
  const payer = payers[0];
  if (kind === "review") return { ok: true, why: "", payer, ready: rows.map((r) => r.visit), skipped: [] };
  const ready: string[] = [];
  const skipped: BatchCheck["skipped"] = [];
  for (const r of rows) {
    const c = r.options.claim;
    if (c.enabled && c.action === "claim") ready.push(r.visit);
    else skipped.push({ visit: r.visit, why: c.enabled ? `${c.label} first. It is not a new claim to send.` : c.why || "Nothing can be sent at this step." });
  }
  if (!ready.length) return { ok: false, why: "None of the selected claims can be sent now.", payer, ready, skipped };
  return { ok: true, why: "", payer, ready, skipped };
}

export interface BatchResult { batchId: string; sent: string[]; held: { visit: string; why: string }[] }

/**
 * Submit Batch Request: sends the ready claims of one payer through sendFromClaim, so each still passes its own review.
 * The priority is set on every claim of the batch. A claim with a Hard Stop or an unconfirmed Soft Stop is held back.
 */
export function submitBatch(visits: string[], priority: ClaimPriority, today: Date = new Date()): { ok: true; value: BatchResult } | { ok: false; problems: string[] } {
  if (!can("billing")) {
    denied("Claim batch");
    return { ok: false, problems: ["Your role cannot send claims. This needs the billing permission."] };
  }
  const fin = getFinancial();
  const rows = visits.map((v) => claimFor(v, today)).filter((m): m is ClaimModel => !!m);
  const check = batchCheck(rows.map((m) => ({ visit: m.visit, payer: m.payer, options: sendOptions(m.enc, fin) })), "submit");
  if (!check.ok) return { ok: false, problems: [check.why] };
  const s = store.get();
  store.set({ ...s, seq: s.seq + 1 });
  const batchId = `BAT-${String(s.seq + 1).padStart(5, "0")}`;
  const at = new Date().toISOString();
  const sent: string[] = [];
  const held: BatchResult["held"] = [...check.skipped];
  for (const visit of check.ready) {
    const m = rows.find((x) => x.visit === visit)!;
    if (!m.locked) upsertDraft(visit, (d) => ({ ...d, priority, batch: { id: batchId, at, priority, by: who() } }));
    const r = sendFromClaim(visit, "claim", today, batchId);
    if (r.ok) sent.push(visit);
    else held.push({ visit, why: r.blocked ? `Hard Stop: ${r.problems[0]}` : r.needsConfirm ? "Soft Stops need a reason. Open the claim to confirm them." : r.problems[0] ?? "Not sent." });
  }
  audit("send-fhir", `Claim batch ${batchId}`, { detail: `Payer ${check.payer}, priority ${PRIORITY_LABEL[priority]}, ${sent.length} sent, ${held.length} held back` });
  return { ok: true, value: { batchId, sent, held } };
}

/** Review Batch: runs the review on each claim and returns the counts per claim. */
export function reviewBatch(visits: string[], today: Date = new Date()): { visit: string; findings: Finding[] }[] {
  return visits.flatMap((visit) => {
    const r = runReview(visit, today);
    return r ? [{ visit, findings: r.claim }] : [];
  });
}

const POLL_ACTIONS: FinAction[] = ["poll-auth", "poll-claim", "poll-payment"];

/** Answers the payer still owes: queued prior authorizations and claims, and approved claims waiting for payment advice. */
export function pollTargets(payer = ""): { visit: string; action: FinAction; label: string }[] {
  const fin = getFinancial();
  return insuredVisits()
    .filter((v) => !payer || v.payer === payer)
    .flatMap(({ enc }) => stepViews(enc, fin).flatMap((view) => {
      const action = finActionFor(view);
      return action && POLL_ACTIONS.includes(action) ? [{ visit: enc.visitNumber, action, label: `${view.label}: ${view.status}` }] : [];
    }));
}

/** Poll Request: asks NPHIES for every answer waiting for the chosen payer, through NPHIES Financial. */
export function pollRequest(payer = ""): ActionResult & { polled?: number } {
  if (!can("billing")) return denied("Poll request");
  const targets = pollTargets(payer);
  if (!targets.length) return { ok: false, problems: [payer ? `Nothing is waiting for an answer from ${payer}.` : "Nothing is waiting for a payer answer."] };
  let polled = 0;
  for (const t of targets) if (runFinancial(t.visit, t.action)) polled += 1;
  return { ok: true, polled };
}

/** Eligibility comes first in NPHIES Financial. Offered on the claim so the biller does not have to leave it. */
export function checkEligibility(visit: string): ActionResult {
  if (!can("approvals")) return denied(`Eligibility, visit ${visit}`, "approvals");
  const his = getState();
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  if (!enc) return { ok: false, problems: ["This visit was not found."] };
  const opt = sendOptions(enc).eligibility;
  if (!opt.enabled || !opt.action) return { ok: false, problems: [opt.why || "Eligibility is already confirmed."] };
  return runFinancial(visit, opt.action) ? { ok: true } : { ok: false, problems: ["NPHIES Financial did not run this step."] };
}

/* ---------- demo claim history ---------- */

const FIN_KEY = "onasi-emr-nphies-financial-v1";

/**
 * Gives every demo visit (rcm-demo.ts) its claim history once: NPHIES Financial cases with their messages, the claim
 * drafts (saved, reviewed, sent) and the payer answers. Amounts are the visit invoice figures, so the claim page, the
 * invoice and Submitted Transactions agree. Runs only when the demo patients are in the seed and the visit has no
 * financial history yet. Returns the number of visits it gave a history to.
 */
export function seedDemoClaims(now: Date = new Date()): number {
  const s0 = store.get();
  if (s0.demoSeeded) return 0;
  const his = getState();
  if (!his.patients.some((p) => p.id === DEMO_MARK)) return 0;
  const fin = getFinancial();
  const inputs: DemoClaimInput[] = [];
  const models = new Map<string, ClaimModel>();
  for (const enc of his.encounters) {
    const target = demoTargetOf(enc);
    if (!target || caseOf(enc.visitNumber, fin).messages.length) continue;
    const m = claimFor(enc.visitNumber, now);
    const start = enc.admitAt ?? enc.ed?.arrivalAt;
    if (!m || !m.payer || !start) continue;
    models.set(enc.visitNumber, m);
    const share = m.totals.taxable > 0 ? m.totals.insuranceAmount / m.totals.taxable : 0;
    const lines = m.lines.map((l) => ({ seq: l.seq, key: l.key, net: l.net, insurance: round2(l.net * share) }));
    // Rounding goes to the last line, so the lines add up to the invoice insurance share.
    if (lines.length) lines[lines.length - 1].insurance = round2(lines[lines.length - 1].insurance + m.totals.insuranceAmount - lines.reduce((n, l) => n + l.insurance, 0));
    inputs.push({
      visit: enc.visitNumber, target, cls: enc.cls === "I" ? "I" : enc.cls === "E" ? "E" : "O", start: new Date(start), end: enc.dischargeAt ? new Date(enc.dischargeAt) : now,
      healthId: m.patient.healthId, payer: m.payer, net: m.net, insurance: m.totals.insuranceAmount, lines, dxCount: m.dx.length, authNeeded: m.authNeeded,
    });
  }
  if (!inputs.length) return 0;
  const r = buildDemoClaims(inputs, now, fin.seq);
  // NPHIES Financial has no import: its state object takes the cases and is saved under its own key.
  fin.cases.push(...r.cases);
  fin.seq = r.seq;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(FIN_KEY, JSON.stringify(fin)); } catch { /* storage blocked */ }

  const biller = "Majed Aldosari";
  const drafts = [...s0.drafts];
  for (const i of inputs) {
    const st = r.steps[i.visit];
    const m = models.get(i.visit)!;
    const soft = reviewModel(m, "claim").filter((f) => f.severity === "soft").map((f) => f.id);
    const sentDay = (st.sentAt ?? st.savedAt).slice(0, 10);
    const sends: SendLog[] = [
      ...(st.paSentAt ? [{ at: st.paSentAt, by: biller, use: "priorauth" as const, action: "authorization" as const, amount: m.net }] : []),
      ...(st.sentAt ? [{ at: st.sentAt, by: biller, use: "claim" as const, action: "claim" as const, amount: m.net }] : []),
    ];
    const d: ClaimDraft = {
      visit: i.visit, savedAt: st.savedAt, savedBy: biller, claimDate: sentDay, accountingDate: sentDay,
      ...(demoClaimTypeOf(m.enc) ? { type: demoClaimTypeOf(m.enc) } : {}),
      ...(st.reviewedAt ? { reviewedAt: st.reviewedAt } : {}),
      ...(st.sentAt && soft.length ? { ack: { at: st.sentAt, by: biller, reason: "Height not measured at the visit; the payer accepts it for this plan.", ids: soft } } : {}),
      ...(sends.length ? { sends } : {}),
    };
    const at = drafts.findIndex((x) => x.visit === i.visit);
    if (at >= 0) drafts[at] = { ...drafts[at], ...d }; else drafts.push(d);
  }
  store.set({ ...s0, drafts, answers: { ...(s0.answers ?? {}), ...r.answers }, demoSeeded: true });
  return inputs.length;
}

// In the browser the demo history is added on first load. Tests call seedDemoClaims themselves.
if (typeof window !== "undefined") {
  try { seedDemoClaims(); } catch { /* the demo history is optional */ }
}

