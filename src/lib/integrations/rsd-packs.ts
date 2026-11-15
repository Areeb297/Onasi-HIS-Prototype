import { audit } from "../audit";
import { createStore } from "../fhir/store-util";
import { fmtDate } from "../format";
import { DRUGS, DRUG_BY_ID } from "../rx-catalogue";
import { batchesFor } from "../rx-stock";
import type { Drug } from "../rx-types";
import { can, currentUser } from "../session";
import { isOff, logCall, modeOf } from "./call-log";
import { makeGln, makeGtin14, type Gs1 } from "./rsd-gs1";

/**
 * SFDA RSD (drug track and trace) at the pharmacy. Simulated: nothing leaves the browser, and every call is written to the
 * shared integration call log (call-log.ts).
 *
 * What the pharmacy has to do, from the SFDA DTTS Integration Guide (OPS-G-117 v2.1):
 *  - a supplier dispatches packs to the pharmacy's GLN, and the pharmacy must accept them (Accept Dispatch, or Accept for one
 *    serial number). Until it does, nobody can use the packs;
 *  - when a pack is dispensed, report Pharmacy Sale (Consume for medicine used on an inpatient), by GTIN and serial number;
 *  - when a dispense is reversed, report the cancel of that sale (Pharmacy Sale Cancel, Consume Cancel).
 *
 * ASSUMPTIONS, where the guide does not say or this screen simplifies:
 *  - The pharmacy sells whole packs. Packs needed for a dispense = quantity divided by the pack size, rounded up.
 *  - A cancelled sale puts the pack back on the shelf, so it can be dispensed again. Status Cancelled shows that it was sold once and taken back.
 *  - Rejecting a dispatch is sent as a Return to the supplier (Return Service).
 *  - The response is Success or an error in words. The SFDA error codes are not copied, because the Error Code List service is not in the guide.
 *  - The GTINs, serials, GLNs and suppliers are made up. A GLN is 13 digits with a GS1 check digit.
 *  - When the integration is switched Off on the Integrations page, nothing here is required or reported.
 */

export type PackStatus = "received" | "accepted" | "dispensed" | "cancelled" | "rejected";

export const STATUS_LABEL: Record<PackStatus, string> = { received: "Received", accepted: "Accepted", dispensed: "Dispensed", cancelled: "Cancelled", rejected: "Rejected" };
export const STATUS_TONE: Record<PackStatus, "info" | "ok" | "neutral" | "warn" | "danger"> = { received: "info", accepted: "ok", dispensed: "neutral", cancelled: "warn", rejected: "danger" };

export type SaleService = "Pharmacy Sale" | "Consume";

export interface Pack extends Gs1 {
  drugId: string;
  status: PackStatus;
  dispatchId?: string;
  acceptedAt?: string;
  sale?: { dispenseNumber: string; lineId: string; service: SaleService; at: string };
  cancelledAt?: string;
}

export interface Dispatch {
  id: string;
  supplier: string;
  supplierGln: string;
  poRef: string;
  sentAt: string;
  status: "pending" | "accepted" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
  /** Key of every pack in it, gtin|serial. */
  packKeys: string[];
}

interface State {
  packs: Record<string, Pack>;
  dispatches: Dispatch[];
  seq: number;
}

/** The hospital pharmacy's GLN. Made up. */
export const PHARMACY_GLN = makeGln("628100000012");

export const packKey = (gtin: string, serial: string) => `${gtin}|${serial}`;

/** The 14-digit GTIN of a sample drug. Worked out from the drug number, so the same drug always has the same one. */
export function gtinOf(drug: Pick<Drug, "id">): string {
  const n = parseInt(drug.id.replace(/\D/g, ""), 10) || 0;
  return makeGtin14(`0629${String(n).padStart(9, "0")}`);
}

/** The drug that owns a GTIN, or undefined. */
export const drugByGtin = (gtin: string): Drug | undefined => DRUGS.find((d) => gtinOf(d) === gtin);

/** Whole packs needed for a quantity of units. */
export const packsNeeded = (qty: number, drug: Pick<Drug, "pack">): number => (qty > 0 ? Math.ceil(qty / Math.max(1, drug.pack.size)) : 0);

/* ---------- seed ---------- */

const SUPPLIERS: { name: string; gln: string }[] = [
  { name: "Al Wadi Medical Supply", gln: makeGln("628100000100") },
  { name: "Najd Pharma Distribution", gln: makeGln("628100000200") },
  { name: "Red Sea Healthcare Trading", gln: makeGln("628100000300") },
];

const monthEnd = (from: Date, ahead: number) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + ahead + 1, 0)).toISOString().slice(0, 10);

function seedRsd(now: Date = new Date()): State {
  const packs: Record<string, Pack> = {};
  const add = (p: Pack) => { packs[packKey(p.gtin, p.serial)] = p; };
  // Accepted packs for every sample drug and every batch it has on the shelf, four of each.
  for (const d of DRUGS) {
    const num = String(parseInt(d.id.replace(/\D/g, ""), 10) || 0).padStart(3, "0");
    for (const b of batchesFor(d, [], now, false)) {
      for (let k = 1; k <= 4; k++) {
        add({ gtin: gtinOf(d), serial: `${num}${b.lot.slice(-1)}${String(1000 + k)}`, batch: b.lot, expiry: b.expiry, drugId: d.id, status: "accepted", acceptedAt: new Date(now.getTime() - 30 * 86_400_000).toISOString() });
      }
    }
  }
  // Three dispatches from suppliers that wait for the pharmacy to accept.
  const dispatches: Dispatch[] = [];
  const pending = [
    { drug: "DRG001", supplier: 0, packs: 6, lot: "RSD2611A", ahead: 22, minutesAgo: 95 },
    { drug: "DRG002", supplier: 1, packs: 5, lot: "RSD2611B", ahead: 18, minutesAgo: 60 },
    { drug: "DRG010", supplier: 2, packs: 4, lot: "RSD2611C", ahead: 24, minutesAgo: 25 },
  ];
  pending.forEach((x, i) => {
    const d = DRUG_BY_ID[x.drug];
    if (!d) return;
    const id = `DSP-RSD-${String(7001 + i)}`;
    const keys: string[] = [];
    for (let k = 1; k <= x.packs; k++) {
      const p: Pack = { gtin: gtinOf(d), serial: `D${7001 + i}${String(100 + k)}`, batch: x.lot, expiry: monthEnd(now, x.ahead), drugId: d.id, status: "received", dispatchId: id };
      add(p);
      keys.push(packKey(p.gtin, p.serial));
    }
    dispatches.push({ id, supplier: SUPPLIERS[x.supplier].name, supplierGln: SUPPLIERS[x.supplier].gln, poRef: `PO-26-${4100 + i}`, sentAt: new Date(now.getTime() - x.minutesAgo * 60_000).toISOString(), status: "pending", packKeys: keys });
  });
  return { packs, dispatches, seq: 0 };
}

const store = createStore<State>("onasi-emr-rsd-packs-v1", () => seedRsd());
export const useRsd = store.use;
export const getRsd = store.get;
export const resetRsd = store.reset;

/* ---------- reading ---------- */

export const packsList = (s: State = store.get()): Pack[] => Object.values(s.packs);
export const packOf = (gtin: string, serial: string, s: State = store.get()): Pack | undefined => s.packs[packKey(gtin, serial)];
export const dispatchById = (id: string, s: State = store.get()): Dispatch | undefined => s.dispatches.find((d) => d.id === id);
export const pendingDispatches = (s: State = store.get()): Dispatch[] => s.dispatches.filter((d) => d.status === "pending");
export const packsOfDispatch = (d: Dispatch, s: State = store.get()): Pack[] => d.packKeys.map((k) => s.packs[k]).filter(Boolean);

export function countsByStatus(s: State = store.get()): Record<PackStatus, number> {
  const out: Record<PackStatus, number> = { received: 0, accepted: 0, dispensed: 0, cancelled: 0, rejected: 0 };
  for (const p of packsList(s)) out[p.status] += 1;
  return out;
}

/** RSD is part of the pharmacy only when the integration is not switched Off. */
export const rsdActive = (): boolean => !isOff("rsd");

const today = (now: Date) => now.toISOString().slice(0, 10);
export const isExpiredPack = (p: Pick<Pack, "expiry">, now: Date = new Date()): boolean => p.expiry < today(now);

/* ---------- the rules ---------- */

/** Why a pack cannot be dispensed, in words. Empty when it can. `drugId` is the drug being dispensed. */
export function dispenseProblem(p: Pack | undefined, drugId?: string, now: Date = new Date()): string {
  if (!p) return "This pack is not known to the pharmacy. It did not arrive by a supplier dispatch.";
  const name = DRUG_BY_ID[p.drugId]?.generic ?? "This medicine";
  if (drugId && p.drugId !== drugId) return `This pack is ${name}, not ${DRUG_BY_ID[drugId]?.generic ?? "the medicine being dispensed"}.`;
  switch (p.status) {
    case "received": return "This pack is not accepted yet. Accept the supplier's dispatch first.";
    case "rejected": return "This pack was rejected and returned to the supplier.";
    case "dispensed": return `This pack was already dispensed${p.sale ? ` on ${p.sale.dispenseNumber}` : ""}.`;
    default: break;
  }
  if (isExpiredPack(p, now)) return `This pack expired on ${fmtDate(p.expiry)}.`;
  return "";
}

export const canDispense = (p: Pack | undefined, drugId?: string, now: Date = new Date()): boolean => dispenseProblem(p, drugId, now) === "";

/** Accepted or cancelled packs of a drug that are in date, earliest expiry first, optionally from one batch. */
export function suggestPacks(drugId: string, count: number, lot?: string, skip: string[] = [], now: Date = new Date(), s: State = store.get()): Pack[] {
  return packsList(s)
    .filter((p) => p.drugId === drugId && canDispense(p, drugId, now) && (!lot || p.batch === lot) && !skip.includes(packKey(p.gtin, p.serial)))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.serial.localeCompare(b.serial))
    .slice(0, Math.max(0, count));
}

const mayAct = (): boolean => can("rx.dispense") || can("admin");
const who = () => { try { return currentUser().name; } catch { return "Unknown"; } };

/* ---------- calls (simulated) ---------- */

export interface CallResult {
  ok: boolean;
  /** One line for the screen. */
  message: string;
}

const refused = (message: string): CallResult => ({ ok: false, message });
const NO_RIGHTS = "This needs the dispensing permission.";
const OFF_TEXT = "RSD is switched off, so nothing was reported.";

const gtinRequest = (p: Pack) => ({ GTIN: p.gtin, SN: p.serial, BN: p.batch, XD: p.expiry });

function put(next: State) { store.set(next); }

/** The supplier's dispatch: the pharmacy accepts every pack in it at once (Accept Dispatch Service). */
export function acceptDispatch(id: string): CallResult {
  if (!mayAct()) return refused(NO_RIGHTS);
  if (!rsdActive()) return refused(OFF_TEXT);
  const s = store.get();
  const d = dispatchById(id, s);
  if (!d) return refused("That dispatch was not found.");
  if (d.status !== "pending") return refused(`This dispatch was already ${d.status === "accepted" ? "accepted" : "rejected"}.`);
  const now = new Date();
  const packs = { ...s.packs };
  for (const k of d.packKeys) if (packs[k]?.status === "received") packs[k] = { ...packs[k], status: "accepted", acceptedAt: now.toISOString() };
  put({ ...s, packs, dispatches: s.dispatches.map((x) => (x.id === id ? { ...x, status: "accepted", decidedAt: now.toISOString(), decidedBy: who() } : x)) });
  logCall({
    integration: "rsd", operation: "Accept Dispatch", ok: true,
    summary: `${d.id} from ${d.supplier}: ${d.packKeys.length} packs accepted`,
    request: { service: "AcceptDispatchService", receiverGLN: PHARMACY_GLN, senderGLN: d.supplierGln, dispatchNotification: d.id, products: d.packKeys.length },
    response: { status: "Success", message: `${d.packKeys.length} packs accepted` },
  }, now.getTime());
  audit("update", `RSD dispatch ${d.id}`, { detail: `Accepted ${d.packKeys.length} packs from ${d.supplier}` });
  return { ok: true, message: `${d.packKeys.length} packs accepted. RSD answered Success.` };
}

/** The pharmacy does not take the dispatch: every pack goes back (Return Service). A reason is needed. */
export function rejectDispatch(id: string, reason: string): CallResult {
  if (!mayAct()) return refused(NO_RIGHTS);
  if (!rsdActive()) return refused(OFF_TEXT);
  if (reason.trim().length < 5) return refused("Give the reason for rejecting the dispatch.");
  const s = store.get();
  const d = dispatchById(id, s);
  if (!d) return refused("That dispatch was not found.");
  if (d.status !== "pending") return refused(`This dispatch was already ${d.status === "accepted" ? "accepted" : "rejected"}.`);
  const now = new Date();
  const packs = { ...s.packs };
  for (const k of d.packKeys) if (packs[k]?.status === "received") packs[k] = { ...packs[k], status: "rejected" };
  put({ ...s, packs, dispatches: s.dispatches.map((x) => (x.id === id ? { ...x, status: "rejected", decidedAt: now.toISOString(), decidedBy: who(), reason: reason.trim() } : x)) });
  logCall({
    integration: "rsd", operation: "Return (Reject Dispatch)", ok: true,
    summary: `${d.id} from ${d.supplier}: ${d.packKeys.length} packs returned`,
    request: { service: "ReturnService", receiverGLN: PHARMACY_GLN, senderGLN: d.supplierGln, dispatchNotification: d.id, reason: reason.trim() },
    response: { status: "Success", message: "Returned to the supplier" },
  }, now.getTime());
  audit("update", `RSD dispatch ${d.id}`, { detail: `Rejected: ${reason.trim()}` });
  return { ok: true, message: "The dispatch was rejected and the packs go back to the supplier." };
}

/** One scanned pack at goods receipt: accept it by serial number (Accept Service). */
export function acceptPack(g: Gs1): CallResult {
  if (!mayAct()) return refused(NO_RIGHTS);
  if (!rsdActive()) return refused(OFF_TEXT);
  const s = store.get();
  const p = packOf(g.gtin, g.serial, s);
  const now = new Date();
  const fail = (message: string): CallResult => {
    logCall({ integration: "rsd", operation: "Accept Pack", ok: false, summary: `GTIN ${g.gtin}, serial ${g.serial}: ${message}`, request: { service: "AcceptService", receiverGLN: PHARMACY_GLN, products: [gtinRequest({ ...g, drugId: "", status: "received" })] }, response: { status: "Error", message } }, now.getTime());
    return refused(message);
  };
  if (!p) return fail("RSD has no dispatch of this pack to this pharmacy.");
  if (p.batch !== g.batch || p.expiry !== g.expiry) return fail("The batch or expiry on the pack does not match the dispatch.");
  if (p.status === "accepted") return fail("This pack is already accepted.");
  if (p.status !== "received") return fail(`This pack is ${STATUS_LABEL[p.status].toLowerCase()}, so it cannot be accepted.`);
  const next: State = { ...s, packs: { ...s.packs, [packKey(p.gtin, p.serial)]: { ...p, status: "accepted", acceptedAt: now.toISOString() } } };
  // When the last pack of a dispatch is accepted one by one, the dispatch is done.
  const d = p.dispatchId ? dispatchById(p.dispatchId, next) : undefined;
  if (d && d.status === "pending" && d.packKeys.every((k) => next.packs[k]?.status === "accepted")) {
    next.dispatches = next.dispatches.map((x) => (x.id === d.id ? { ...x, status: "accepted", decidedAt: now.toISOString(), decidedBy: who() } : x));
  }
  put(next);
  logCall({ integration: "rsd", operation: "Accept Pack", ok: true, summary: `GTIN ${p.gtin}, serial ${p.serial}: accepted`, request: { service: "AcceptService", receiverGLN: PHARMACY_GLN, products: [gtinRequest(p)] }, response: { status: "Success" } }, now.getTime());
  return { ok: true, message: "Pack accepted. RSD answered Success." };
}

/** What a dispense scanned: pack keys by prescription item id. */
export type PackScans = Record<string, string[]>;

/** Problems in what was scanned for a dispense, one text each. Empty when every line has its packs and every pack can be dispensed. */
export function scanProblems(lines: { itemId: string; drugId: string; quantity: number; lot?: string }[], scans: PackScans, now: Date = new Date(), s: State = store.get()): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  for (const l of lines) {
    const drug = DRUG_BY_ID[l.drugId];
    const keys = scans[l.itemId] ?? [];
    const need = packsNeeded(l.quantity, drug);
    const name = drug?.generic ?? "the medicine";
    if (keys.length < need) out.push(`Scan ${need === 1 ? "the pack" : `all ${need} packs`} of ${name}. ${keys.length} of ${need} scanned.`);
    if (keys.length > need) out.push(`${name}: ${keys.length} packs are scanned but ${need === 1 ? "1 pack is" : `${need} packs are`} needed. Remove the extra.`);
    for (const k of keys) {
      const [gtin, serial] = k.split("|");
      const p = s.packs[k];
      const bad = dispenseProblem(p, l.drugId, now);
      if (bad) out.push(`${name} ${serial ?? ""}: ${bad}`.replace("  ", " "));
      else if (used.has(k)) out.push(`${name} ${serial}: this pack is scanned twice.`);
      else if (l.lot && p && p.batch !== l.lot) out.push(`${name} ${serial}: the pack is from batch ${p.batch}, but batch ${l.lot} is chosen.`);
      used.add(k);
      void gtin;
    }
  }
  return out;
}

/** After a dispense went through: report the sale of each scanned pack (Pharmacy Sale, or Consume for an inpatient). */
export function reportSale(args: { dispenseNumber: string; lines: { itemId: string; lineId: string; drugId: string }[]; scans: PackScans; inpatient: boolean }): CallResult[] {
  if (!rsdActive()) return [];
  const service: SaleService = args.inpatient ? "Consume" : "Pharmacy Sale";
  const results: CallResult[] = [];
  const now = new Date();
  for (const l of args.lines) {
    for (const k of args.scans[l.itemId] ?? []) {
      const s = store.get();
      const p = s.packs[k];
      const bad = dispenseProblem(p, l.drugId, now);
      const ref = p ? gtinRequest(p) : { GTIN: k.split("|")[0], SN: k.split("|")[1] };
      if (bad || !p) {
        logCall({ integration: "rsd", operation: service, ok: false, summary: `${k.replace("|", ", serial ")}: ${bad}`, request: { service: service === "Consume" ? "ConsumeProduct" : "PharmacySaleProduct", GLN: PHARMACY_GLN, products: [ref], reference: args.dispenseNumber }, response: { status: "Error", message: bad } }, now.getTime());
        results.push(refused(bad));
        continue;
      }
      put({ ...s, packs: { ...s.packs, [k]: { ...p, status: "dispensed", sale: { dispenseNumber: args.dispenseNumber, lineId: l.lineId, service, at: now.toISOString() } } } });
      logCall({ integration: "rsd", operation: service, ok: true, summary: `GTIN ${p.gtin}, serial ${p.serial}: ${service === "Consume" ? "consumed" : "sold"} on ${args.dispenseNumber}`, request: { service: service === "Consume" ? "ConsumeProduct" : "PharmacySaleProduct", GLN: PHARMACY_GLN, products: [ref], reference: args.dispenseNumber }, response: { status: "Success" } }, now.getTime());
      results.push({ ok: true, message: `${p.serial}: ${service} reported` });
    }
  }
  return results;
}

/** The packs of one dispense line, from its sale. */
export const packsOfLine = (dispenseNumber: string, lineId: string, s: State = store.get()): Pack[] =>
  packsList(s).filter((p) => p.sale?.dispenseNumber === dispenseNumber && p.sale.lineId === lineId);

/** After a dispense line was cancelled: report the cancel of each of its sales. The pack is back on the shelf. */
export function reportCancel(dispenseNumber: string, lineId: string): CallResult[] {
  if (!rsdActive()) return [];
  const results: CallResult[] = [];
  const now = new Date();
  for (const p of packsOfLine(dispenseNumber, lineId)) {
    if (p.status !== "dispensed" || !p.sale) continue;
    const s = store.get();
    const service = p.sale.service;
    // The sale stays on the pack, so the dispense screen can still show which packs the cancelled line had.
    put({ ...s, packs: { ...s.packs, [packKey(p.gtin, p.serial)]: { ...p, status: "cancelled", cancelledAt: now.toISOString() } } });
    logCall({ integration: "rsd", operation: `${service} Cancel`, ok: true, summary: `GTIN ${p.gtin}, serial ${p.serial}: ${service === "Consume" ? "consumption" : "sale"} cancelled for ${dispenseNumber}`, request: { service: service === "Consume" ? "ConsumeCancelProduct" : "PharmacySaleCancelProduct", GLN: PHARMACY_GLN, products: [gtinRequest(p)], reference: dispenseNumber }, response: { status: "Success" } }, now.getTime());
    results.push({ ok: true, message: `${p.serial}: ${service} cancel reported` });
  }
  return results;
}

/** Status word for the integration, for screens that show it next to the packs. */
export const rsdMode = () => modeOf("rsd");
