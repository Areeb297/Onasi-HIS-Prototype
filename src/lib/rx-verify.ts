import { audit } from "./audit";
import { fillOf, getDrug, getRx, setRx } from "./rx";
import { FREQ_BY_ID, ROUTE_LABEL } from "./rx-catalogue";
import { dailyAmount, isControlled, isRaqeebScope } from "./rx-logic";
import { checkSafety, type SafetyFinding, type SafetyInput } from "./rx-safety";
import { sendDispense, type DispenseRequest, type SendOutcome } from "./rx-send";
import { batchesFor, stockProblem } from "./rx-stock";
import type { Dispense, Drug, Prescription, RxItem, RxState, RxVerification, Witness } from "./rx-types";
import { currentUser } from "./session";

/**
 * Pharmacy rules that belong to the hospital, not to nphies:
 * the pharmacist check before dispensing, the witness for controlled drugs, the Raqeeb secure code choice and stock.
 * Nothing in this file builds or sends a message. Dispensing goes through `dispenseChecked`, which runs these
 * rules and then hands over to `sendDispense`.
 */

/* ---------- where an item stands ---------- */

/**
 * to-verify  waiting for the pharmacist
 * queried    the pharmacist asked the prescriber a question, no answer yet
 * answered   the prescriber answered, the pharmacist must look again
 * rejected   the pharmacist refused the item, the prescriber must change or cancel it
 * verified   can be dispensed
 */
export type VerifyStatus = "to-verify" | "queried" | "answered" | "rejected" | "verified";

export const VERIFY_LABEL: Record<VerifyStatus, string> = {
  "to-verify": "To Verify",
  queried: "Query Sent",
  answered: "Query Answered",
  rejected: "Rejected By Pharmacy",
  verified: "Verified",
};

/**
 * An item with no check on record is To Verify. Two exceptions keep older saved data usable:
 * an item that already has medicine handed over counts as verified, and a check made on an older
 * version of the item no longer counts.
 */
export function verifyStatusOf(item: Pick<RxItem, "verify" | "version">, dispensedTotal = 0): VerifyStatus {
  const v = item.verify;
  if (!v) return dispensedTotal > 0 ? "verified" : "to-verify";
  if (v.version !== item.version) return "to-verify";
  if (v.status === "queried") return v.query?.answer ? "answered" : "queried";
  return v.status;
}

export function verifyStatusIn(s: RxState, rx: Prescription, item: RxItem): VerifyStatus {
  return verifyStatusOf(item, fillOf(s, rx, item).dispensedTotal);
}

/** The pharmacist has to act: a new item, a changed item or an answered question. */
export const needsPharmacist = (st: VerifyStatus): boolean => st === "to-verify" || st === "answered";
/** The prescriber has to act. */
export const needsPrescriber = (st: VerifyStatus): boolean => st === "queried" || st === "rejected";

/** Sent, active and not fully dispensed items, with where each one stands. */
export function pharmacyItems(s: RxState, rx: Prescription): { item: RxItem; status: VerifyStatus }[] {
  if (!rx.sentAt) return [];
  return rx.items.filter((i) => i.status === "active" && !fillOf(s, rx, i).done).map((item) => ({ item, status: verifyStatusIn(s, rx, item) }));
}

/** Only these can be dispensed. */
export function verifiedOpenItems(s: RxState, rx: Prescription): RxItem[] {
  return pharmacyItems(s, rx).filter((x) => x.status === "verified").map((x) => x.item);
}

/* ---------- the check sheet ---------- */

export type SheetLevel = "stop" | "caution" | "clear" | "info";

export interface SheetSection {
  id: "allergy" | "duplicate" | "interaction" | "dose" | "weight" | "kidney";
  title: string;
  level: SheetLevel;
  lines: string[];
}

export interface SheetInput extends SafetyInput {
  /** Kidney facts from the chart, already in words. See kidneyNotes. */
  kidney?: KidneyNote[];
  /** The prescriber overrode a direct allergy conflict. */
  allergyOverride?: RxItem["allergyOverride"];
}

export interface KidneyNote {
  text: string;
  /** True when the result or diagnosis points to reduced kidney function. */
  concern: boolean;
}

const unitOf = (d: Drug) => d.strengthUnit.split("/")[0];
const r2 = (n: number) => Math.round(n * 100) / 100;

function level(found: SafetyFinding[]): SheetLevel {
  if (found.some((f) => f.level === "block" || f.level === "error")) return "stop";
  if (found.some((f) => f.level === "warn")) return "caution";
  return found.length ? "info" : "clear";
}

/**
 * The pharmacist check sheet. It runs the same safety rules the prescriber sees while typing (checkSafety)
 * and sorts the findings under the headings a pharmacist works through.
 */
export function buildCheckSheet(i: SheetInput): SheetSection[] {
  const all = checkSafety(i);
  const of = (...kinds: SafetyFinding["kind"][]) => all.filter((f) => kinds.includes(f.kind) && f.id !== "ctrl-scope");
  const d = i.drug;

  const allergy = of("allergy", "cross-allergy");
  const allergyLines = allergy.map((f) => f.text);
  if (i.allergyOverride) allergyLines.push(`The prescriber went ahead despite the ${i.allergyOverride.allergy} allergy. Reason given: ${i.allergyOverride.reason}`);
  const noMatch = i.allergies.length
    ? `No match between ${d.generic} and the recorded allergies: ${i.allergies.map((a) => a.text).join(", ")}.`
    : "No allergies recorded for this patient.";

  const dup = of("duplicate");
  const inter = of("interaction");
  const dose = of("dose", "route", "controlled", "age");
  const day = i.dose > 0 ? dailyAmount(d, i.dose, i.frequencyId) : 0;
  const doseFact = `Daily dose ${r2(day)} ${unitOf(d)}. Usual maximum ${d.maxDailyDose} ${unitOf(d)}.`;

  const weightLines: string[] = [];
  let weightLevel: SheetLevel = "info";
  if (i.weightKg && i.weightKg > 0) {
    weightLines.push(`Weight ${i.weightKg} kg.${day > 0 ? ` That is ${r2(day / i.weightKg)} ${unitOf(d)} per kg per day.` : ""}`);
    if (i.ageYears !== undefined) weightLines.push(`Age ${i.ageYears} years.`);
  } else {
    weightLevel = "caution";
    weightLines.push("Weight is not recorded on this visit. A dose per kg cannot be checked.");
  }

  const kidney = i.kidney ?? [];
  return [
    { id: "allergy", title: "Allergies", level: allergy.length ? level(allergy) : "clear", lines: allergyLines.length ? allergyLines : [noMatch] },
    { id: "duplicate", title: "Duplicate Drugs", level: level(dup), lines: dup.length ? dup.map((f) => f.text) : ["No other active item with the same drug or the same class on this visit."] },
    { id: "interaction", title: "Interactions", level: level(inter), lines: inter.length ? inter.map((f) => f.text) : ["No interaction found with the other active items on this visit."] },
    { id: "dose", title: "Dose Range", level: level(dose), lines: [...dose.map((f) => f.text), doseFact] },
    { id: "weight", title: "Weight", level: weightLevel, lines: weightLines },
    {
      id: "kidney",
      title: "Kidney",
      level: kidney.some((k) => k.concern) ? "caution" : "info",
      lines: kidney.length ? kidney.map((k) => k.text) : ["No kidney test result and no kidney diagnosis recorded."],
    },
  ];
}

/** A serious finding means the pharmacist must type a note before verifying. */
export const sheetNeedsNote = (sheet: SheetSection[]): boolean => sheet.some((x) => x.level === "stop");

const CREATININE = "2160-0";

/** Kidney facts from the chart: a kidney diagnosis on the visit and the latest creatinine result of the patient. */
export function kidneyNotes(
  dx: { text: string }[],
  labOrders: { patientId: string; results: Record<string, { value: string; interp?: string; at: string }> }[],
  patientId: string,
): KidneyNote[] {
  const out: KidneyNote[] = [];
  for (const x of dx) {
    if (/kidney|renal|nephr/i.test(x.text)) out.push({ text: `Diagnosis on this visit: ${x.text}.`, concern: true });
  }
  const results = labOrders
    .filter((o) => o.patientId === patientId)
    .map((o) => o.results[CREATININE])
    .filter((r): r is { value: string; interp?: string; at: string } => !!r && !!r.value)
    .sort((a, b) => a.at.localeCompare(b.at));
  const last = results[results.length - 1];
  if (last) {
    const high = last.interp === "H" || last.interp === "HH";
    const when = new Date(last.at);
    const date = Number.isNaN(when.getTime()) ? last.at : when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    out.push({ text: `Creatinine ${last.value} mg/dL on ${date}${high ? ", above the normal range. Check if the dose needs lowering." : ", in or below the normal range."}`, concern: high });
  }
  return out;
}

/** One line a pharmacist reads first: dose in units and in strength, route, frequency and duration. */
export function orderLine(drug: Drug, item: Pick<RxItem, "dose" | "route" | "frequencyId" | "durationDays" | "asNeeded">): { dose: string; route: string; frequency: string; duration: string } {
  const amount = r2(item.dose * drug.perUnit);
  return {
    dose: `${item.dose} ${drug.unit}${item.dose === 1 || drug.unit === "mL" ? "" : "s"} (${amount} ${unitOf(drug)})`,
    route: ROUTE_LABEL[item.route] ?? item.route,
    frequency: `${FREQ_BY_ID[item.frequencyId]?.label ?? item.frequencyId}${item.asNeeded ? ", as needed" : ""}`,
    duration: `${item.durationDays} day${item.durationDays === 1 ? "" : "s"}`,
  };
}

/* ---------- pharmacist and prescriber actions ---------- */

export interface ActionResult {
  ok: boolean;
  problem?: string;
}

function patchVerify(rxId: string, itemId: string, make: (item: RxItem, rx: Prescription) => RxVerification | string): ActionResult & { rx?: Prescription; item?: RxItem } {
  const s = getRx();
  const rx = s.prescriptions.find((p) => p.id === rxId);
  const item = rx?.items.find((i) => i.id === itemId);
  if (!rx || !item) return { ok: false, problem: "Prescription item not found." };
  if (!rx.sentAt) return { ok: false, problem: "This prescription was not sent to the pharmacy yet." };
  if (item.status !== "active") return { ok: false, problem: `This item is ${item.status}. It cannot be checked.` };
  const next = make(item, rx);
  if (typeof next === "string") return { ok: false, problem: next };
  setRx({ ...s, prescriptions: s.prescriptions.map((p) => (p.id !== rxId ? p : { ...p, items: p.items.map((i) => (i.id === itemId ? { ...i, verify: next } : i)) })) });
  return { ok: true, rx, item };
}

function stamp(item: RxItem): Pick<RxVerification, "version" | "by" | "byId" | "at"> {
  const u = currentUser();
  return { version: item.version, by: u.name, byId: u.id, at: new Date().toISOString() };
}

const label = (rx: Prescription, item: RxItem) => `${getDrug(item.drugId).generic}, ${rx.number}`;

/** Verify an item. `needNote` is true when the check sheet shows a serious finding. */
export function verifyItem(rxId: string, itemId: string, note = "", needNote = false): ActionResult {
  const text = note.trim();
  const res = patchVerify(rxId, itemId, (item) => {
    if (needNote && text.length < 5) return "Type a note that says why it is safe to go ahead.";
    // Keep the question and answer so the trail stays readable.
    return { status: "verified", ...stamp(item), note: text || undefined, query: item.verify?.version === item.version ? item.verify.query : undefined };
  });
  if (res.ok && res.rx && res.item) {
    audit("update", `Pharmacist verified ${res.item.identifier}`, { patient: res.rx.patientId, detail: `Visit ${res.rx.visitNumber}. ${label(res.rx, res.item)}${text ? `. Note: ${text}` : ""}` });
  }
  return { ok: res.ok, problem: res.problem };
}

/** Ask the prescriber a question. The item cannot be dispensed until the pharmacist verifies it. */
export function queryPrescriber(rxId: string, itemId: string, question: string): ActionResult {
  const text = question.trim();
  if (text.length < 5) return { ok: false, problem: "Type the question for the prescriber." };
  const res = patchVerify(rxId, itemId, (item) => ({ status: "queried", ...stamp(item), query: { text } }));
  if (res.ok && res.rx && res.item) {
    audit("update", `Pharmacist query ${res.item.identifier}`, { patient: res.rx.patientId, detail: `Visit ${res.rx.visitNumber}. ${label(res.rx, res.item)}. Question: ${text}` });
  }
  return { ok: res.ok, problem: res.problem };
}

/** Refuse an item. The prescriber changes it (a new check follows) or cancels it. No message is sent. */
export function rejectItem(rxId: string, itemId: string, reason: string): ActionResult {
  const text = reason.trim();
  if (text.length < 5) return { ok: false, problem: "Type the reason for rejecting this item." };
  const res = patchVerify(rxId, itemId, (item) => ({ status: "rejected", ...stamp(item), reason: text, query: item.verify?.version === item.version ? item.verify.query : undefined }));
  if (res.ok && res.rx && res.item) {
    audit("update", `Pharmacist rejected ${res.item.identifier}`, { patient: res.rx.patientId, detail: `Visit ${res.rx.visitNumber}. ${label(res.rx, res.item)}. Reason: ${text}` });
  }
  return { ok: res.ok, problem: res.problem };
}

/** The prescriber answers the question. The item goes back to the pharmacist. */
export function answerQuery(rxId: string, itemId: string, answer: string): ActionResult {
  const text = answer.trim();
  if (text.length < 2) return { ok: false, problem: "Type your answer for the pharmacist." };
  const res = patchVerify(rxId, itemId, (item) => {
    const v = item.verify;
    if (!v || v.status !== "queried" || !v.query || v.version !== item.version) return "There is no open question on this item.";
    return { ...v, query: { ...v.query, answer: text, answeredBy: currentUser().name, answeredAt: new Date().toISOString() } };
  });
  if (res.ok && res.rx && res.item) {
    audit("update", `Prescriber answered query ${res.item.identifier}`, { patient: res.rx.patientId, detail: `Visit ${res.rx.visitNumber}. ${label(res.rx, res.item)}. Answer: ${text}` });
  }
  return { ok: res.ok, problem: res.problem };
}

/* ---------- controlled drugs ---------- */

const person = (s: string) => s.toLowerCase().replace(/^dr\.?\s+/, "").split(",")[0].replace(/\s+/g, " ").trim();

/** Witness name and staff number are both needed, and the witness cannot be the person who dispenses. */
export function witnessProblems(w: Partial<Witness> | undefined, dispenser: { id: string; name: string }): string[] {
  const name = (w?.name ?? "").trim();
  const staffNo = (w?.staffNo ?? "").trim();
  const out: string[] = [];
  if (name.length < 3) out.push("Enter the full name of the witness.");
  if (!staffNo) out.push("Enter the staff number of the witness.");
  if ((staffNo && staffNo.toLowerCase() === dispenser.id.toLowerCase()) || (name.length >= 3 && person(name) === person(dispenser.name))) {
    out.push("The witness cannot be the pharmacist who dispenses. Ask a second member of staff.");
  }
  return out;
}

/**
 * The Raqeeb secure code step has to be chosen by the user. There is no default.
 * Dispensing without the patient's code needs a reason from the list.
 */
export function secureProblems(raqeeb: boolean, secure: Dispense["secure"] | undefined): string[] {
  if (!raqeeb) return [];
  if (!secure) return ["Choose how the Raqeeb secure code is handled: the patient gave the code, or dispense without the code."];
  if (secure.mode === "authenticated") return (secure.value ?? "").trim().length >= 4 ? [] : ["Enter the secure code the patient received."];
  return (secure.justification ?? "").trim() ? [] : ["Choose the reason for dispensing without the secure code."];
}

/* ---------- the gate in front of every dispense ---------- */

/** Hospital rules checked before a dispense. An empty list means the dispense can go ahead. */
export function dispenseGate(s: RxState, req: DispenseRequest, dispenser: { id: string; name: string } = currentUser(), today: Date = new Date()): string[] {
  const rx = s.prescriptions.find((p) => p.id === req.rxId);
  if (!rx) return ["Prescription not found."];
  const out: string[] = [];
  let controlled = false;
  for (const l of req.lines) {
    const item = rx.items.find((i) => i.id === l.itemId);
    if (!item) continue;
    const drug = getDrug(item.drugId);
    if (isControlled(drug.controlClass)) controlled = true;
    const fill = fillOf(s, rx, item);
    const st = verifyStatusOf(item, fill.dispensedTotal);
    if (st !== "verified") {
      out.push(
        st === "rejected" ? `${drug.generic} was rejected by the pharmacy. It cannot be dispensed.`
          : st === "queried" ? `${drug.generic} is waiting for the prescriber to answer a question. It cannot be dispensed yet.`
            : `${drug.generic} is not verified. Open the check sheet and verify it first.`,
      );
      continue;
    }
    const stock = stockProblem(drug, batchesFor(drug, s.dispenses, today), l.lot, l.quantity, fill.remaining, today);
    if (stock) out.push(stock);
  }
  if (controlled) out.push(...witnessProblems(req.witness, dispenser));
  out.push(...secureProblems(isRaqeebScope(rx.controlled, rx.usage), req.secure));
  return out;
}

/** Dispense through the hospital rules. Use this from the screens instead of sendDispense. */
export function dispenseChecked(req: DispenseRequest): { outcome: SendOutcome | null; problems: string[] } {
  const problems = dispenseGate(getRx(), req);
  if (problems.length) return { outcome: null, problems };
  const witness = req.witness ? { name: req.witness.name.trim(), staffNo: req.witness.staffNo.trim() } : undefined;
  const res = sendDispense({ ...req, witness });
  if (res.outcome?.ok && witness) {
    const rx = getRx().prescriptions.find((p) => p.id === req.rxId);
    audit("create", `Controlled drug witness ${res.outcome.record.targetId}`, {
      patient: rx?.patientId,
      detail: `${rx ? `Visit ${rx.visitNumber}. ` : ""}Witness ${witness.name}, staff number ${witness.staffNo}.${req.secure?.mode === "override" ? ` Dispensed without the secure code. Reason code ${req.secure.justification}.` : ""}`,
    });
  }
  return res;
}
