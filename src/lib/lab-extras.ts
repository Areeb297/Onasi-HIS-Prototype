import { audit } from "./audit";
import { createStore } from "./fhir/store-util";
import type { LabOrder, LabSpecimen } from "./fhir/types";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

/**
 * What the laboratory worklist keeps besides the order itself: how the sample was taken, when the lab received it,
 * how often the labels were printed, and the overall comments and conclusion on a result.
 * Kept in its own store, so orders saved earlier still open. An order with no entry here simply has none of this yet.
 * None of it is sent to NPHIES.
 */

export interface SampleDetails {
  method: string;
  source: string;
  care: string;
  risk: string;
}

export interface SampleRecord {
  /** The collection time of the first specimen. An entry only counts while it matches, so a reset of the lab data cannot leave a stale one. */
  collectedAt: string;
  details?: SampleDetails;
  receivedAt?: string;
  receivedBy?: string;
  labelsPrinted?: number;
}

export interface LabNotes {
  conclusion: string;
  comments: string;
  at: string;
  by: string;
}

interface State {
  samples: Record<string, SampleRecord>;
  notes: Record<string, LabNotes>;
}

const store = createStore<State>("onasi-emr-lab-extras-v1", () => ({ samples: {}, notes: {} }));
export const useLabExtras = store.use;
export const getLabExtras = store.get;
export const resetLabExtras = store.reset;

/* ---------- lists the sample form offers ---------- */

/**
 * Values of the HIS lookups on LaboratorySampleItem: "Specimen Collection Method" (CollectionMethodId), "Specimen Sample Care"
 * (SpecimentSampleCareId) and "Specimen Risk" (SpecimenRiskId). Clean Catch Urine and Midstream Urine are not in the HIS
 * list yet (listed as New in HIS); Standard Precautions means no special risk and is saved as an empty SpecimenRiskId.
 */
export const COLLECTION_METHODS = ["Venipuncture", "Capillary Specimen", "Arterial Puncture", "Line, Venous", "Line, Arterial", "Catheterized", "Swab", "Biopsy", "Aspiration, Fine Needle", "Blood Culture, Aerobic Bottle", "Blood Culture, Anaerobic Bottle", "Clean Catch Urine", "Midstream Urine"];
export const SPECIMEN_SOURCES = ["Left Arm", "Right Arm", "Hand Vein", "Foot Or Heel", "Urethra", "Throat", "Nose", "Wound"];
export const SAMPLE_CARE = ["Routine Handling", "Store At Room Temperature", "On Ice", "Keep Refrigerated", "Keep Frozen", "Protect From Light", "Transport Immediately", "Deliver Within 1 Hour", "Anaerobic Transport", "Viral Transport Medium"];
export const SPECIMEN_RISKS = ["Standard Precautions", "Biohazard", "Material Danger Infectious", "Biological", "Corrosive", "Poison", "Radioactive", "Injury Hazard"];

/** What the form starts with: the usual choice for the specimen type. */
export function defaultSampleDetails(specimenKeys: string[]): SampleDetails {
  const urine = specimenKeys.length > 0 && specimenKeys.every((k) => k === "URN");
  const nose = specimenKeys.length > 0 && specimenKeys.every((k) => k === "NPS");
  return {
    method: urine ? "Clean Catch Urine" : nose ? "Swab" : "Venipuncture",
    source: urine ? "Urethra" : nose ? "Nose" : "Left Arm",
    care: "Store At Room Temperature",
    risk: "Standard Precautions",
  };
}

/* ---------- selectors ---------- */

/** The label text of one specimen. The specimen id is already made of capital letters, digits and dashes, so every scanner reads it. */
export const specimenBarcode = (s: Pick<LabSpecimen, "id">): string => s.id.toUpperCase();

/** The record for this order, or undefined when there is none or it belongs to an older collection. */
export function sampleOf(order: Pick<LabOrder, "id" | "specimens">, s: State = store.get()): SampleRecord | undefined {
  const rec = s.samples[order.id];
  const first = order.specimens[0];
  return rec && first && rec.collectedAt === first.collectedAt ? rec : undefined;
}

/** In the lab and handed in at the bench. */
export const isReceived = (order: Pick<LabOrder, "id" | "specimens">, s?: State): boolean => !!sampleOf(order, s)?.receivedAt;

export const notesOf = (orderId: string, s: State = store.get()): LabNotes | undefined => s.notes[orderId];

/* ---------- actions ---------- */

function allowed(): boolean {
  if (can("lab.result")) return true;
  pushToast({ tone: "warn", text: "Your role cannot do this.", detail: "This needs the lab.result permission." });
  return false;
}

const nameOfOrder = (o: Pick<LabOrder, "patientId">): string => patientName(getState().patients.find((p) => p.id === o.patientId));

/** Saved when the specimen is collected. Call it after collectSpecimens succeeded, with the order read again. */
export function recordSampleDetails(order: Pick<LabOrder, "id" | "specimens" | "patientId">, details: SampleDetails): boolean {
  const first = order.specimens[0];
  if (!first) return false;
  const s = store.get();
  const old = sampleOf(order, s);
  store.set({ ...s, samples: { ...s.samples, [order.id]: { ...old, collectedAt: first.collectedAt, details } } });
  audit("update", `Lab sample ${order.id}`, { patient: nameOfOrder(order), detail: `${details.method}, ${details.source}, ${details.care}, risk: ${details.risk}` });
  return true;
}

/** The lab accepts the sample at the bench. Start Processing needs this first on the worklist. */
export function receiveSample(order: Pick<LabOrder, "id" | "specimens" | "patientId">): boolean {
  if (!allowed()) return false;
  const first = order.specimens[0];
  if (!first) return false;
  const s = store.get();
  const old = sampleOf(order, s);
  if (old?.receivedAt) return true;
  store.set({
    ...s,
    samples: { ...s.samples, [order.id]: { ...old, collectedAt: first.collectedAt, receivedAt: new Date().toISOString(), receivedBy: currentUser().name } },
  });
  audit("update", `Lab sample ${order.id}`, { patient: nameOfOrder(order), detail: `Received in the lab by ${currentUser().name}` });
  return true;
}

export function markLabelsPrinted(order: Pick<LabOrder, "id" | "specimens" | "patientId">): void {
  const first = order.specimens[0];
  if (!first) return;
  const s = store.get();
  const old = sampleOf(order, s);
  store.set({ ...s, samples: { ...s.samples, [order.id]: { ...old, collectedAt: first.collectedAt, labelsPrinted: (old?.labelsPrinted ?? 0) + 1 } } });
  audit("print", `Lab sample labels ${order.id}`, { patient: nameOfOrder(order), detail: `Printed, ${(old?.labelsPrinted ?? 0) + 1} time(s)` });
}

export function saveNotes(orderId: string, patch: { conclusion: string; comments: string }): boolean {
  if (!allowed()) return false;
  const s = store.get();
  store.set({ ...s, notes: { ...s.notes, [orderId]: { ...patch, at: new Date().toISOString(), by: currentUser().name } } });
  audit("update", `Lab result notes ${orderId}`, { detail: "Conclusion and comments saved" });
  return true;
}
