import { RCM_PAYERS, type ClaimState, type ImportClaim } from "./rcm-cases";

/**
 * Claim Import: read a claim file in the browser, map its columns, check every row and keep the good ones.
 * Follows the HIS rcm/import page (upload, review, Save Selected) with a column mapping step added, because files from
 * other systems rarely use our headers.
 *
 * Files: .csv, and .xlsx read without any extra library (an .xlsx file is a zip of XML parts; the browser unzips it with
 * DecompressionStream). Only the first worksheet is read. Older .xls files are not supported.
 * One row is one claim with one service line.
 */

/* ---------- reading the file ---------- */

/** Limits that keep a large or hostile file from freezing the browser tab. */
export const IMPORT_LIMITS = {
  /** The file as uploaded. */
  fileBytes: 10 * 1024 * 1024,
  /** All the XML inside an .xlsx after unzipping. A real 10 MB workbook unzips to well under this. */
  unzippedBytes: 60 * 1024 * 1024,
  /** Claim rows under the header row. */
  rows: 5000,
} as const;

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;
const TOO_BIG_UNZIPPED = `The workbook is too large once opened (over ${mb(IMPORT_LIMITS.unzippedBytes)}). Split it into smaller files, or save it as .csv.`;

/** Splits CSV text into rows. Handles quotes, doubled quotes, commas and line breaks inside quotes, and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Inflates one entry, stopping as soon as it passes `limit` bytes, so a zip bomb never fills memory. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Error(TOO_BIG_UNZIPPED);
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/** The files inside a zip, by name. Stored and deflated entries only. Stops when the unzipped total passes `limit`. */
export async function unzip(buf: ArrayBuffer, limit: number = IMPORT_LIMITS.unzippedBytes): Promise<Map<string, string>> {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("This file is not an Excel workbook (.xlsx).");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const dec = new TextDecoder();
  const files = new Map<string, string>();
  let used = 0;
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("The workbook is damaged.");
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error("The workbook uses a compression this page cannot read. Save it again as .xlsx or .csv.");
    const bytes = method === 8 ? await inflate(raw, limit - used) : raw;
    used += bytes.length;
    if (used > limit) throw new Error(TOO_BIG_UNZIPPED);
    files.set(name, dec.decode(bytes));
  }
  return files;
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first worksheet of an .xlsx file as rows of text. */
export async function readXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const files = await unzip(buf);
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheetName = files.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : [...files.keys()].filter((k) => k.startsWith("xl/worksheets/") && k.endsWith(".xml")).sort()[0];
  const sheet = sheetName ? files.get(sheetName) : undefined;
  if (!sheet) throw new Error("The workbook has no worksheet.");
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : next;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = "";
      if (type === "s") val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(body);
      else if (v !== undefined) val = unescapeXml(v);
      while (row.length < idx) row.push("");
      row[idx] = val;
      next = idx + 1;
    }
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

export interface Table { headers: string[]; rows: string[][] }

export async function readTable(file: { name: string; size?: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }): Promise<Table> {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) throw new Error("Choose a .csv or .xlsx file. Older .xls files are not supported: save them as .xlsx first.");
  if ((file.size ?? 0) > IMPORT_LIMITS.fileBytes) {
    throw new Error(`The file is ${mb(file.size ?? 0)}. The largest file this page reads is ${mb(IMPORT_LIMITS.fileBytes)}. Split it into smaller files.`);
  }
  let all: string[][];
  if (name.endsWith(".csv")) {
    const text = await file.text();
    if (text.length > IMPORT_LIMITS.fileBytes) throw new Error(`The file is larger than ${mb(IMPORT_LIMITS.fileBytes)}. Split it into smaller files.`);
    all = parseCsv(text);
  } else {
    const buf = await file.arrayBuffer();
    if (buf.byteLength > IMPORT_LIMITS.fileBytes) throw new Error(`The file is larger than ${mb(IMPORT_LIMITS.fileBytes)}. Split it into smaller files.`);
    all = await readXlsx(buf);
  }
  if (all.length < 2) throw new Error("The file has no rows under the header row.");
  if (all.length - 1 > IMPORT_LIMITS.rows) {
    throw new Error(`The file has ${(all.length - 1).toLocaleString("en-US")} claim rows. The most this page imports at once is ${IMPORT_LIMITS.rows.toLocaleString("en-US")}. Split it into smaller files.`);
  }
  const headers = all[0].map((h) => h.trim());
  const width = headers.length;
  return { headers, rows: all.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim())) };
}

/* ---------- column mapping ---------- */

export type FieldKey = "claimNumber" | "patientName" | "mrn" | "nationalId" | "payer" | "serviceDate" | "claimType" | "diagnosis" | "serviceCode" | "serviceText" | "claimed" | "approved" | "status";
export interface ImportField { key: FieldKey; label: string; required: boolean; hint?: string; synonyms: string[] }

export const IMPORT_FIELDS: ImportField[] = [
  { key: "claimNumber", label: "Claim Number", required: true, synonyms: ["claim number", "claim no", "claim id", "claim identifier", "claim"] },
  { key: "patientName", label: "Patient Name", required: true, synonyms: ["patient name", "patient", "member name", "name"] },
  { key: "mrn", label: "MRN", required: false, hint: "MRN or National ID is needed", synonyms: ["mrn", "mr number", "medical record number", "file number"] },
  { key: "nationalId", label: "National ID / Iqama", required: false, hint: "MRN or National ID is needed", synonyms: ["national id", "iqama", "national id / iqama", "id number", "identity number"] },
  { key: "payer", label: "Payer", required: true, synonyms: ["payer", "insurance", "insurer", "payer / insurance", "insurance company"] },
  { key: "serviceDate", label: "Service Date", required: true, synonyms: ["service date", "date of service", "visit date", "date"] },
  { key: "claimType", label: "Claim Type", required: false, synonyms: ["claim type", "type"] },
  { key: "diagnosis", label: "Principal Diagnosis (ICD-10-AM)", required: true, synonyms: ["principal diagnosis", "diagnosis", "icd-10-am", "icd10", "diagnosis code"] },
  { key: "serviceCode", label: "Service Code (SBS)", required: true, synonyms: ["service code", "sbs code", "item code", "procedure code", "service code (sbs)"] },
  { key: "serviceText", label: "Service Description", required: false, synonyms: ["service description", "service", "item description", "description"] },
  { key: "claimed", label: "Claimed Amount (SAR)", required: true, synonyms: ["claimed amount", "claimed", "amount", "net amount", "claimed amount (sar)"] },
  { key: "approved", label: "Approved Amount (SAR)", required: false, synonyms: ["approved amount", "approved", "approved amount (sar)"] },
  { key: "status", label: "Claim Status", required: false, synonyms: ["claim status", "status"] },
];

export type Mapping = Partial<Record<FieldKey, number>>;
const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/** Matches each field to the header with the same name or a known other name. Each header is used once. */
export function autoMap(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<number>();
  const hs = headers.map(norm);
  for (const f of IMPORT_FIELDS) {
    const names = [norm(f.label), ...f.synonyms.map(norm)];
    for (const name of names) {
      const i = hs.findIndex((h, j) => !used.has(j) && h === name);
      if (i >= 0) { out[f.key] = i; used.add(i); break; }
    }
  }
  return out;
}

export function missingRequired(m: Mapping): ImportField[] {
  return IMPORT_FIELDS.filter((f) => f.required && (m[f.key] === undefined || m[f.key]! < 0));
}

/* ---------- checking the rows ---------- */

export type RowStatus = "Ready" | "Update" | "Invalid";
export interface ImportRow { index: number; status: RowStatus; patient: "Existing" | "New"; issues: string[]; claim: ImportClaim; raw: string[] }

export interface ImportContext {
  /** Claim numbers already in the claim ledger (updatable). */
  ledger: Set<string>;
  /** Claim numbers sent from this system (never overwritten by a file). */
  live: Set<string>;
  /** Known patients by MRN and by National ID. */
  mrns: Set<string>;
  nationalIds: Set<string>;
  today?: Date;
}

const STATES: Record<string, ClaimState> = { submitted: "Submitted", approved: "Approved", "partly approved": "Partly Approved", "partially approved": "Partly Approved", partial: "Partly Approved", rejected: "Rejected", denied: "Denied" };
const TYPES = ["Institutional", "Professional", "Pharmacy", "Oral", "Vision"];

/** Reads a date as YYYY-MM-DD from YYYY-MM-DD, DD/MM/YYYY or an Excel day number. */
export function readDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return validDay(s.slice(0, 10));
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (m) return validDay(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}
function validDay(s: string): string | null {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export function readAmount(v: string): number | null {
  const s = v.replace(/sar/i, "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const ICD10AM = /^[A-Z]\d{2}(\.\d{1,4})?$/;
export const NATIONAL_ID = /^[12]\d{9}$/;

export function checkRows(table: Table, m: Mapping, ctx: ImportContext): ImportRow[] {
  const today = ctx.today ?? new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const get = (r: string[], k: FieldKey) => (m[k] !== undefined && m[k]! >= 0 ? (r[m[k]!] ?? "").trim() : "");
  const seen = new Map<string, number>();
  return table.rows.map((r, index) => {
    const issues: string[] = [];
    const claimNumber = get(r, "claimNumber").toUpperCase();
    const patientName = get(r, "patientName");
    const mrn = get(r, "mrn").toUpperCase();
    const nationalId = get(r, "nationalId").replace(/\s/g, "");
    const payerRaw = get(r, "payer");
    const payer = RCM_PAYERS.find((p) => p.toLowerCase() === payerRaw.toLowerCase());
    const dateRaw = get(r, "serviceDate");
    const serviceDate = readDate(dateRaw);
    const typeRaw = get(r, "claimType");
    const type = typeRaw ? TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) : "Professional";
    const diagnosis = get(r, "diagnosis").toUpperCase();
    const dxCode = diagnosis.split(/\s+/)[0];
    const serviceCode = get(r, "serviceCode").toUpperCase();
    const claimed = readAmount(get(r, "claimed"));
    const approvedRaw = get(r, "approved");
    const approved = approvedRaw ? readAmount(approvedRaw) : null;
    const statusRaw = get(r, "status").toLowerCase();

    if (!claimNumber) issues.push("Claim Number is required.");
    else if (seen.has(claimNumber)) issues.push(`Claim ${claimNumber} is already on row ${seen.get(claimNumber)! + 2} of this file.`);
    else seen.set(claimNumber, index);
    if (claimNumber && ctx.live.has(claimNumber)) issues.push(`Claim ${claimNumber} was sent from this system. Change it on the claim page.`);
    if (!patientName) issues.push("Patient Name is required.");
    if (!mrn && !nationalId) issues.push("Patient MRN or National ID / Iqama is required.");
    if (nationalId && !NATIONAL_ID.test(nationalId)) issues.push(`National ID / Iqama ${nationalId} must be 10 digits starting with 1 or 2.`);
    if (!payerRaw) issues.push("Payer is required.");
    else if (!payer) issues.push(`Payer '${payerRaw}' is not in the payer list.`);
    if (!dateRaw) issues.push("Service Date is required.");
    else if (!serviceDate) issues.push(`Service Date '${dateRaw}' is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`);
    else if (serviceDate > todayIso) issues.push("Service Date cannot be in the future.");
    if (!type) issues.push(`Claim Type '${typeRaw}' is not one of ${TYPES.join(", ")}.`);
    if (!diagnosis) issues.push("Principal Diagnosis (ICD-10-AM) is required.");
    else if (!ICD10AM.test(dxCode)) issues.push(`'${dxCode}' is not an ICD-10-AM code.`);
    if (!serviceCode) issues.push("Service Code (SBS) is required.");
    if (claimed === null) issues.push("Claimed Amount is required.");
    else if (Number.isNaN(claimed) || claimed <= 0) issues.push("Claimed Amount must be a number above zero.");
    if (approved !== null && (Number.isNaN(approved) || approved < 0)) issues.push("Approved Amount must be a number, zero or more.");
    else if (approved !== null && claimed !== null && claimed > 0 && approved > claimed + 0.004) issues.push("Approved Amount cannot be more than the Claimed Amount.");
    let state: ClaimState | undefined = statusRaw ? STATES[statusRaw] : undefined;
    if (statusRaw && !state) issues.push(`Claim Status '${get(r, "status")}' is not one of Submitted, Approved, Partly Approved, Rejected, Denied.`);
    if (!state) state = approved === null || Number.isNaN(approved) ? "Submitted" : approved <= 0 ? "Denied" : claimed !== null && approved < claimed ? "Partly Approved" : "Approved";
    const known = (mrn && ctx.mrns.has(mrn)) || (nationalId && ctx.nationalIds.has(nationalId));
    const claim: ImportClaim = {
      claimNumber, patientName, mrn, nationalId: nationalId || undefined, payer: payer ?? payerRaw, type: type ?? "Professional", serviceDate: serviceDate ?? "",
      diagnosis, serviceCode, serviceText: get(r, "serviceText"), claimed: claimed && !Number.isNaN(claimed) ? claimed : 0,
      approved: approved !== null && !Number.isNaN(approved) ? approved : undefined, state,
    };
    const status: RowStatus = issues.length ? "Invalid" : ctx.ledger.has(claimNumber) ? "Update" : "Ready";
    return { index, status, patient: known ? "Existing" : "New", issues, claim, raw: r };
  });
}

export function templateCsv(): string {
  const head = IMPORT_FIELDS.map((f) => f.label);
  const rows = [
    ["CLM-26-5001", "Abdullah Alsubaie", "MRN-100231", "1023344556", "Bupa Arabia", "2026-11-02", "Professional", "J06.9", "SBS-SAMPLE-1001", "Outpatient Consultation", "350", "315", "Approved"],
    ["CLM-26-5002", "Maha Alshammari", "MRN-100302", "1072215546", "Tawuniya", "2026-11-03", "Institutional", "K35.8", "SBS-SAMPLE-1003", "Inpatient Stay", "3200", "", "Submitted"],
  ];
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
}
