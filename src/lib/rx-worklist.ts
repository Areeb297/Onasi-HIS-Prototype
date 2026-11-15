import { getDrug } from "./rx";
import type { Dispense, DispenseLine, Drug, ItemStatus, Prescription, RxState } from "./rx-types";
import { needsPharmacist, verifiedOpenItems, type VerifyStatus } from "./rx-verify";

/**
 * Worklist rules for the pharmacy page that do not depend on the screen: which tab an item is on, which prescriptions of a patient
 * can be dispensed together, and the list of what was handed out with what can still be changed.
 */

export type WorklistTab = "waiting" | "to-verify" | "ready" | "all";
export type StatusFilter = "all" | ItemStatus;

export const TABS: { id: WorklistTab; label: string }[] = [
  { id: "waiting", label: "Waiting For Pharmacy" },
  { id: "to-verify", label: "To Verify" },
  { id: "ready", label: "Ready To Dispense" },
  { id: "all", label: "All" },
];

export const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All Statuses" },
  { id: "active", label: "Active" },
  { id: "on-hold", label: "On Hold" },
  { id: "stopped", label: "Stopped" },
  { id: "cancelled", label: "Cancelled" },
  { id: "completed", label: "Completed" },
];

export interface TabFacts {
  /** Active and not fully handed over. */
  open: boolean;
  verify: VerifyStatus;
  itemStatus: ItemStatus;
}

/**
 * To Verify is a prescription item the pharmacist has not cleared yet: new, answered by the prescriber, or queried (as in the HIS). A rejected item waits for the prescriber and shows under Waiting For Pharmacy and All.
 * Ready To Dispense is a verified item with something left to hand over. Waiting For Pharmacy is both of those plus items on hold.
 */
export function tabMatches(tab: WorklistTab, f: TabFacts): boolean {
  switch (tab) {
    case "all": return true;
    case "to-verify": return f.open && (needsPharmacist(f.verify) || f.verify === "queried");
    case "ready": return f.open && f.verify === "verified";
    case "waiting": return f.open || f.itemStatus === "on-hold";
  }
}

export const statusMatches = (filter: StatusFilter, itemStatus: ItemStatus): boolean => filter === "all" || itemStatus === filter;

/* ---------- multi-drug dispense ---------- */

/** The prescriptions of one patient that have a verified item to hand over, oldest first. Each one still gets its own checks and its own message. */
export function readyPrescriptions(s: RxState, patientId: string): Prescription[] {
  return s.prescriptions
    .filter((rx) => rx.patientId === patientId && rx.sentAt && verifiedOpenItems(s, rx).length > 0)
    .sort((a, b) => (a.sentAt ?? a.authoredAt).localeCompare(b.sentAt ?? b.authoredAt));
}

/** How many items and prescriptions a multi-drug dispense would cover. */
export function readySummary(s: RxState, patientId: string): { prescriptions: number; items: number } {
  const list = readyPrescriptions(s, patientId);
  return { prescriptions: list.length, items: list.reduce((n, rx) => n + verifiedOpenItems(s, rx).length, 0) };
}

/* ---------- what was dispensed ---------- */

export interface LineChange {
  ok: boolean;
  /** Why not, in words. Empty when ok. */
  reason: string;
}

/** The change rule of the dispense messages: update and cancel are offered for narcotic, controlled and restricted items. */
export function canChangeLine(drug: Pick<Drug, "controlClass" | "generic">, line: Pick<DispenseLine, "status">): LineChange {
  if (line.status === "cancelled") return { ok: false, reason: "This dispense is already cancelled." };
  // Any dispense can be cancelled or updated, as in the HIS: the new version replaces the old one for every medicine type.
  return { ok: true, reason: "" };
}

export interface DispensedRow {
  key: string;
  dispense: Dispense;
  line: DispenseLine;
  rx?: Prescription;
  drug: Drug;
  change: LineChange;
}

export type DispensedFilter = "all" | "completed" | "cancelled";

/** Every line that was handed out, newest first, with whether it can still be changed. */
export function dispensedRows(s: RxState, filter: DispensedFilter = "all"): DispensedRow[] {
  const rows: DispensedRow[] = [];
  for (const d of s.dispenses) {
    const rx = s.prescriptions.find((p) => p.id === d.rxId);
    for (const line of d.lines) {
      if (filter !== "all" && line.status !== filter) continue;
      const drug = getDrug(line.drugId);
      rows.push({ key: `${d.id}:${line.id}`, dispense: d, line, rx, drug, change: canChangeLine(drug, line) });
    }
  }
  return rows.sort((a, b) => b.dispense.handedOverAt.localeCompare(a.dispense.handedOverAt));
}
