import { audit } from "./audit";
import { createStore } from "./fhir/store-util";
import type { RadOrder } from "./fhir/types";
import { can, currentUser } from "./session";
import { getState, patientName } from "./store";
import { pushToast } from "./toast";

/**
 * Files attached to a radiology report, as the HIS result entry has: up to 10 images (PNG or JPG) and one PDF.
 * Only the file names, sizes and who added them are kept, in the browser. The files themselves are not stored and are not sent to NPHIES.
 * A thumbnail can be shown while the page is open (see previewOf). Kept apart from the order, so earlier orders still open.
 */

export const MAX_IMAGES = 10;

export interface RadFile {
  id: string;
  name: string;
  size: number;
  type: string;
  addedAt: string;
  addedBy: string;
}

interface Entry {
  /** The study the files belong to. An entry only counts while it matches, so a reset of the radiology data cannot leave a stale one. */
  studyUid: string;
  images: RadFile[];
  pdf?: RadFile;
  seq: number;
}

interface State {
  entries: Record<string, Entry>;
  /** How many times the report was printed, by order id. */
  prints: Record<string, number>;
}

const store = createStore<State>("onasi-emr-rad-extras-v1", () => ({ entries: {}, prints: {} }));
export const useRadExtras = store.use;
export const getRadExtras = store.get;
export const resetRadExtras = store.reset;

/* ---------- thumbnails (this page view only) ---------- */

const previews = new Map<string, string>();
export const previewOf = (fileId: string): string | undefined => previews.get(fileId);
export function setPreview(fileId: string, url: string) {
  previews.set(fileId, url);
}
function dropPreview(fileId: string) {
  const u = previews.get(fileId);
  if (u && typeof URL !== "undefined") URL.revokeObjectURL(u);
  previews.delete(fileId);
}

/* ---------- rules ---------- */

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export const isImageFile = (f: FileLike): boolean =>
  (f.type === "image/png" || f.type === "image/jpeg") && ["png", "jpg", "jpeg"].includes(ext(f.name));
export const isPdfFile = (f: FileLike): boolean => f.type === "application/pdf" && ext(f.name) === "pdf";

export function imageProblem(f: FileLike): string | null {
  if (!isImageFile(f)) return `${f.name}: only PNG and JPG images are allowed.`;
  if (f.size <= 0) return `${f.name}: the file is empty.`;
  return null;
}

export function pdfProblem(f: FileLike): string | null {
  if (!isPdfFile(f)) return `${f.name}: only a PDF file is allowed here.`;
  if (f.size <= 0) return `${f.name}: the file is empty.`;
  return null;
}

export const fmtSize = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ---------- selectors ---------- */

export interface Attachments {
  images: RadFile[];
  pdf?: RadFile;
}

export function attachmentsOf(order: Pick<RadOrder, "id" | "study">, s: State = store.get()): Attachments {
  const e = s.entries[order.id];
  return e && order.study && e.studyUid === order.study.studyUid ? { images: e.images, pdf: e.pdf } : { images: [] };
}

export const printCountOf = (orderId: string, s: State = store.get()): number => s.prints[orderId] ?? 0;

/* ---------- actions ---------- */

const nameOfOrder = (o: Pick<RadOrder, "patientId">): string => patientName(getState().patients.find((p) => p.id === o.patientId));

function allowed(order: Pick<RadOrder, "report">): string | null {
  if (!can("rad.report")) {
    pushToast({ tone: "warn", text: "Your role cannot do this.", detail: "This needs the rad.report permission." });
    return "Your role cannot attach files to a report.";
  }
  if (order.report?.signedAt) return "The report is signed, so files cannot change. Add an addendum instead.";
  return null;
}

function entryFor(order: Pick<RadOrder, "id" | "study">, s: State): Entry | null {
  if (!order.study) return null;
  const e = s.entries[order.id];
  return e && e.studyUid === order.study.studyUid ? e : { studyUid: order.study.studyUid, images: [], seq: 0 };
}

export interface AddResult {
  added: RadFile[];
  problems: string[];
}

/** Adds images. A file that breaks a rule is skipped and named in problems. The rest are kept. */
export function addImages(order: RadOrder, files: FileLike[]): AddResult {
  const denied = allowed(order);
  if (denied) return { added: [], problems: [denied] };
  const s = store.get();
  const e = entryFor(order, s);
  if (!e) return { added: [], problems: ["The exam is not done yet, so there is no study to attach images to."] };
  const problems: string[] = [];
  const added: RadFile[] = [];
  let images = [...e.images];
  let seq = e.seq;
  for (const f of files) {
    const bad = imageProblem(f);
    if (bad) problems.push(bad);
    else if (images.length >= MAX_IMAGES) problems.push(`${f.name}: a report can have at most ${MAX_IMAGES} images.`);
    else if (images.some((i) => i.name === f.name && i.size === f.size)) problems.push(`${f.name}: this image is already attached.`);
    else {
      seq += 1;
      const rec: RadFile = { id: `${order.id}-IMG-${seq}`, name: f.name, size: f.size, type: f.type, addedAt: new Date().toISOString(), addedBy: currentUser().name };
      images = [...images, rec];
      added.push(rec);
    }
  }
  if (added.length) {
    store.set({ ...s, entries: { ...s.entries, [order.id]: { ...e, images, seq } } });
    audit("update", `Radiology report ${order.id}`, { patient: nameOfOrder(order), detail: `${added.length} image(s) attached: ${added.map((a) => a.name).join(", ")}` });
  }
  return { added, problems };
}

/** Sets the one result PDF, replacing the earlier one. */
export function setPdf(order: RadOrder, file: FileLike): AddResult {
  const denied = allowed(order);
  if (denied) return { added: [], problems: [denied] };
  const s = store.get();
  const e = entryFor(order, s);
  if (!e) return { added: [], problems: ["The exam is not done yet, so there is no study to attach a PDF to."] };
  const bad = pdfProblem(file);
  if (bad) return { added: [], problems: [bad] };
  if (e.pdf) dropPreview(e.pdf.id);
  const seq = e.seq + 1;
  const rec: RadFile = { id: `${order.id}-PDF-${seq}`, name: file.name, size: file.size, type: file.type, addedAt: new Date().toISOString(), addedBy: currentUser().name };
  store.set({ ...s, entries: { ...s.entries, [order.id]: { ...e, pdf: rec, seq } } });
  audit("update", `Radiology report ${order.id}`, { patient: nameOfOrder(order), detail: `Result PDF attached: ${file.name}` });
  return { added: [rec], problems: [] };
}

export function removeFile(order: RadOrder, fileId: string): boolean {
  if (allowed(order)) return false;
  const s = store.get();
  const e = entryFor(order, s);
  if (!e) return false;
  const hit = e.images.find((i) => i.id === fileId) ?? (e.pdf?.id === fileId ? e.pdf : undefined);
  if (!hit) return false;
  dropPreview(fileId);
  store.set({
    ...s,
    entries: { ...s.entries, [order.id]: { ...e, images: e.images.filter((i) => i.id !== fileId), pdf: e.pdf?.id === fileId ? undefined : e.pdf } },
  });
  audit("update", `Radiology report ${order.id}`, { patient: nameOfOrder(order), detail: `Attachment removed: ${hit.name}` });
  return true;
}

export function markReportPrinted(order: Pick<RadOrder, "id" | "patientId">): void {
  const s = store.get();
  const n = (s.prints[order.id] ?? 0) + 1;
  store.set({ ...s, prints: { ...s.prints, [order.id]: n } });
  audit("print", `Radiology report print ${order.id}`, { patient: nameOfOrder(order), detail: `Printed, ${n} time(s)` });
}
