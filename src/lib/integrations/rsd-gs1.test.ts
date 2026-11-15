import { describe, expect, it } from "vitest";
import { checkDigit, expiryFromYymmdd, gs1Text, makeGln, makeGtin14, parseGs1, parseManual, validCheckDigit } from "./rsd-gs1";

const GTIN = makeGtin14("0629000000012");
const GS = "\u001d";

describe("GS1 check digits", () => {
  it("works out the known example: 6291041500213 has check digit 3", () => {
    expect(checkDigit("629104150021")).toBe(3);
    expect(validCheckDigit("6291041500213")).toBe(true);
    expect(validCheckDigit("6291041500214")).toBe(false);
  });
  it("makes valid GTIN-14 and GLN numbers", () => {
    expect(GTIN).toHaveLength(14);
    expect(validCheckDigit(GTIN)).toBe(true);
    const gln = makeGln("628100000001");
    expect(gln).toHaveLength(13);
    expect(validCheckDigit(gln)).toBe(true);
  });
  it("refuses text that is not digits", () => {
    expect(validCheckDigit("ABCDEFGH1")).toBe(false);
    expect(validCheckDigit("12")).toBe(false);
  });
});

describe("expiry date in the code", () => {
  it("reads YYMMDD, and a day of 00 as the last day of the month", () => {
    expect(expiryFromYymmdd("271231")).toBe("2027-12-31");
    expect(expiryFromYymmdd("280200")).toBe("2028-02-29");
    expect(expiryFromYymmdd("270200")).toBe("2027-02-28");
  });
  it("refuses a date that does not exist", () => {
    expect(expiryFromYymmdd("271301")).toBeNull();
    expect(expiryFromYymmdd("270230")).toBeNull();
    expect(expiryFromYymmdd("27123")).toBeNull();
    expect(expiryFromYymmdd("ab1231")).toBeNull();
  });
});

describe("reading a DataMatrix", () => {
  const want = { gtin: GTIN, serial: "SN12345678", batch: "LOT-9A", expiry: "2027-12-31" };

  it("reads the bracket form, in any order", () => {
    const r = parseGs1(`(01)${GTIN}(21)SN12345678(17)271231(10)LOT-9A`);
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(want);
    expect(parseGs1(`(10)LOT-9A(17)271231(21)SN12345678(01)${GTIN}`).value).toEqual(want);
  });

  it("reads what a scanner sends: group separators after the variable fields, with or without the symbology prefix", () => {
    const raw = `01${GTIN}21SN12345678${GS}17271231${GS}10LOT-9A`;
    expect(parseGs1(raw).value).toEqual(want);
    expect(parseGs1(`]d2${raw}`).value).toEqual(want);
    expect(parseGs1(`01${GTIN}17271231${GS}10LOT-9A${GS}21SN12345678`).value).toEqual(want);
  });

  it("reads a separator typed as <GS> or ^", () => {
    expect(parseGs1(`01${GTIN}21SN12345678<GS>17271231<GS>10LOT-9A`).value).toEqual(want);
    expect(parseGs1(`01${GTIN}21SN12345678^17271231^10LOT-9A`).value).toEqual(want);
  });

  it("round-trips the text it makes", () => {
    expect(parseGs1(gs1Text(want, "brackets")).value).toEqual(want);
    expect(parseGs1(gs1Text(want, "scanner")).value).toEqual(want);
  });

  it("says what is missing or wrong, in words", () => {
    expect(parseGs1("").problems).toEqual(["Scan or type the code on the pack."]);
    expect(parseGs1(`(01)${GTIN}(17)271231(10)LOT`).problems).toContain("The serial number (21) is missing.");
    expect(parseGs1(`(01)${GTIN}(21)S1(10)LOT`).problems).toContain("The expiry date (17) is missing.");
    expect(parseGs1(`(01)${GTIN}(21)S1(17)271231`).problems).toContain("The batch number (10) is missing.");
    expect(parseGs1(`(21)S1(17)271231(10)LOT`).problems).toContain("The GTIN (01) is missing.");
    const bad = GTIN.slice(0, 13) + String((Number(GTIN[13]) + 1) % 10);
    expect(parseGs1(`(01)${bad}(21)S1(17)271231(10)LOT`).problems[0]).toMatch(/check digit/);
    expect(parseGs1(`(01)123(21)S1(17)271231(10)LOT`).problems[0]).toMatch(/14 digits/);
    expect(parseGs1(`(01)${GTIN}(21)S1(17)271399(10)LOT`).problems[0]).toMatch(/not a date/);
    expect(parseGs1(`(01)${GTIN}(21)${"X".repeat(21)}(17)271231(10)LOT`).problems[0]).toMatch(/1 to 20 characters/);
  });

  it("never invents a part: what could not be read is left out", () => {
    const r = parseGs1(`(01)${GTIN}(21)S1(17)271399(10)LOT`);
    expect(r.ok).toBe(false);
    expect(r.value.expiry).toBeUndefined();
    expect(r.value.gtin).toBe(GTIN);
  });

  it("reports an identifier it does not read", () => {
    const r = parseGs1(`99XYZ`);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.includes("(99)"))).toBe(true);
  });

  it("reads a pack typed by hand and checks it the same way", () => {
    expect(parseManual({ gtin: GTIN, serial: "SN1", batch: "L1", expiry: "2027-06-30" }).value).toEqual({ gtin: GTIN, serial: "SN1", batch: "L1", expiry: "2027-06-30" });
    expect(parseManual({ gtin: GTIN, serial: "", batch: "L1", expiry: "2027-06-30" }).ok).toBe(false);
    expect(parseManual({ gtin: GTIN, serial: "SN1", batch: "L1", expiry: "30/06/2027" }).ok).toBe(false);
  });
});
