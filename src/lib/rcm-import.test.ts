import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { autoMap, checkRows, IMPORT_FIELDS, missingRequired, parseCsv, readAmount, readDate, readTable, readXlsx, templateCsv, type ImportContext } from "./rcm-import";

const TODAY = new Date(2026, 10, 15);
const ctx = (): ImportContext => ({ ledger: new Set(["CLM-26-4436"]), live: new Set(["CLM-00002A"]), mrns: new Set(["MRN-100302"]), nationalIds: new Set(["1072215546"]), today: TODAY });

/** A zip with stored (uncompressed) entries, enough to test the .xlsx reader without a library. */
function storedZip(files: Record<string, string>, deflate = false): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = enc.encode(name), raw = enc.encode(text);
    const d = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, deflate ? 8 : 0, true); lv.setUint32(18, d.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, deflate ? 8 : 0, true); cv.setUint32(20, d.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true);
    c.set(n, 46);
    parts.push(local, d);
    central.push(c);
    offset += local.length + d.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out.buffer;
}

describe("claim import", () => {
  it("reads CSV with quotes, commas and line breaks", () => {
    const rows = parseCsv('﻿Claim Number,Patient Name\r\n"CLM-1","Alharbi, Sara"\n"CLM-2","He said ""hi""\nthen left"\n\n');
    expect(rows).toEqual([["Claim Number", "Patient Name"], ["CLM-1", "Alharbi, Sara"], ["CLM-2", 'He said "hi"\nthen left']]);
  });

  it("reads the first sheet of an .xlsx file with shared and inline strings", async () => {
    const buf = storedZip({
      "xl/sharedStrings.xml": '<sst><si><t>Claim Number</t></si><si><r><t>Patient </t></r><r><t>Name</t></r></si><si><t>Noura &amp; Co</t></si></sst>',
      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Claimed</t></is></c></row><row r="2"><c r="A2" t="str"><v>CLM-9</v></c><c r="B2" t="s"><v>2</v></c><c r="D2"><v>350.5</v></c></row></sheetData></worksheet>',
    });
    expect(await readXlsx(buf)).toEqual([["Claim Number", "Patient Name", "", "Claimed"], ["CLM-9", "Noura & Co", "", "350.5"]]);
    const t = await readTable({ name: "claims.XLSX", text: async () => "", arrayBuffer: async () => buf });
    expect(t.headers).toEqual(["Claim Number", "Patient Name", "", "Claimed"]);
    await expect(readTable({ name: "claims.xls", text: async () => "", arrayBuffer: async () => buf })).rejects.toThrow(/xlsx/);
  });

  it("reads deflated workbook parts, as Excel saves them", async () => {
    const buf = storedZip({ "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Claim Number</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>CLM-1</t></is></c></row></sheetData></worksheet>' }, true);
    expect(await readXlsx(buf)).toEqual([["Claim Number"], ["CLM-1"]]);
  });

  it("maps headers by name and lists required fields still unmapped", () => {
    const m = autoMap(["Claim No", "Member Name", "MRN", "Insurance", "Date of Service", "ICD10", "Item Code", "Net Amount", "Notes"]);
    expect(m).toMatchObject({ claimNumber: 0, patientName: 1, mrn: 2, payer: 3, serviceDate: 4, diagnosis: 5, serviceCode: 6, claimed: 7 });
    expect(missingRequired(m)).toEqual([]);
    expect(missingRequired({}).map((f) => f.key)).toEqual(IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key));
  });

  it("reads dates and amounts in the usual forms", () => {
    expect(readDate("2026-11-02")).toBe("2026-11-02");
    expect(readDate("2/11/2026")).toBe("2026-11-02");
    expect(readDate("2026-02-30")).toBeNull();
    expect(readDate("46328")).toBe("2026-11-02");
    expect(readAmount("1,250.50 SAR")).toBe(1250.5);
    expect(readAmount("")).toBeNull();
    expect(Number.isNaN(readAmount("abc"))).toBe(true);
  });

  it("marks each row Ready, Update or Invalid with plain reasons", () => {
    const rows = parseCsv(templateCsv());
    const table = { headers: rows[0], rows: [
      ...rows.slice(1),
      ["CLM-26-4436", "Wafa Alsubaie", "MRN-100421", "", "Bupa Arabia", "2026-11-13", "Professional", "E03.9", "SBS-SAMPLE-1001", "", "350", "350", "Approved"],
      ["", "No Number", "", "", "Unknown Co", "2026-12-01", "Dental", "123", "", "", "-5", "10", "Paid"],
      ["CLM-26-5001", "Dup", "MRN-1", "123", "Daman", "31/02/2026", "", "J06.9", "SBS-1", "", "100", "200", ""],
      ["CLM-00002A", "Live", "MRN-2", "", "Daman", "2026-11-01", "", "J06.9", "SBS-1", "", "100", "", ""],
    ] };
    const out = checkRows(table, autoMap(table.headers), ctx());
    expect(out.map((r) => r.status)).toEqual(["Ready", "Ready", "Update", "Invalid", "Invalid", "Invalid"]);
    expect(out[0].claim).toMatchObject({ claimNumber: "CLM-26-5001", state: "Approved", approved: 315, claimed: 350 });
    expect(out[0].patient).toBe("New");
    expect(out[1].patient).toBe("Existing");
    expect(out[1].claim.state).toBe("Submitted");
    expect(out[3].issues).toEqual([
      "Claim Number is required.",
      "Patient MRN or National ID / Iqama is required.",
      "Payer 'Unknown Co' is not in the payer list.",
      "Service Date cannot be in the future.",
      "Claim Type 'Dental' is not one of Institutional, Professional, Pharmacy, Oral, Vision.",
      "'123' is not an ICD-10-AM code.",
      "Service Code (SBS) is required.",
      "Claimed Amount must be a number above zero.",
      "Claim Status 'Paid' is not one of Submitted, Approved, Partly Approved, Rejected, Denied.",
    ]);
    expect(out[4].issues).toEqual([
      "Claim CLM-26-5001 is already on row 2 of this file.",
      "National ID / Iqama 123 must be 10 digits starting with 1 or 2.",
      "Service Date '31/02/2026' is not a date. Use YYYY-MM-DD or DD/MM/YYYY.",
      "Approved Amount cannot be more than the Claimed Amount.",
    ]);
    expect(out[5].issues[0]).toMatch(/sent from this system/);
  });
});
