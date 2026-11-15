/**
 * GS1 numbers for the SFDA RSD (Drug Track and Trace System). Every medicine pack carries a GS1 DataMatrix with
 *   (01) GTIN, 14 digits          (21) serial number, up to 20 characters
 *   (17) expiry date, YYMMDD      (10) batch or lot number, up to 20 characters
 * and every location has a GLN, 13 digits. The check digit of a GTIN and of a GLN is worked out the same way (GS1 mod 10).
 *
 * Scanners put the group separator character (ASCII 29) after a field that has no fixed length. Typed text may use
 * brackets, "(01)06290000000123(21)AB12(17)271231(10)LOT1", or the separator written as <GS> or ^.
 */

export interface Gs1 {
  gtin: string;
  serial: string;
  batch: string;
  /** YYYY-MM-DD. A day of 00 in the code means the last day of the month. */
  expiry: string;
}

export interface Gs1Parse {
  /** Whatever was read, even when something is wrong. */
  value: Partial<Gs1>;
  /** All four parts are there and correct. */
  ok: boolean;
  /** What is wrong, in plain words. Empty when ok. */
  problems: string[];
}

const GS = "\u001d";

/** The GS1 check digit for the digits before it. */
export function checkDigit(body: string): number {
  let sum = 0;
  const d = body.split("").reverse();
  d.forEach((c, i) => { sum += Number(c) * (i % 2 === 0 ? 3 : 1); });
  return (10 - (sum % 10)) % 10;
}

/** True when the text is all digits and its last digit is the check digit of the rest. */
export const validCheckDigit = (n: string): boolean => /^\d{8,18}$/.test(n) && checkDigit(n.slice(0, -1)) === Number(n.slice(-1));

/** A valid GTIN-14 from a 13-digit base (13 digits, no check digit): the check digit is added. */
export const makeGtin14 = (base13: string): string => `${base13}${checkDigit(base13)}`;

/** A valid GLN from a 12-digit base. */
export const makeGln = (base12: string): string => `${base12}${checkDigit(base12)}`;

const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();

/** YYMMDD to YYYY-MM-DD, or null when it is not a date. Years 00 to 99 are read as 2000 to 2099. */
export function expiryFromYymmdd(s: string): string | null {
  if (!/^\d{6}$/.test(s)) return null;
  const y = 2000 + Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  let d = Number(s.slice(4, 6));
  if (m < 1 || m > 12) return null;
  if (d === 0) d = lastDay(y, m);
  if (d > lastDay(y, m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** YYYY-MM-DD to YYMMDD. */
export const yymmddFromExpiry = (iso: string): string => `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;

/** The DataMatrix text a scanner would send (with separators), or the bracket form for display. */
export function gs1Text(g: Gs1, form: "scanner" | "brackets" = "brackets"): string {
  if (form === "brackets") return `(01)${g.gtin}(21)${g.serial}(17)${yymmddFromExpiry(g.expiry)}(10)${g.batch}`;
  return `01${g.gtin}21${g.serial}${GS}17${yymmddFromExpiry(g.expiry)}10${g.batch}`;
}

const VARIABLE = new Set(["10", "21"]);
const FIXED: Record<string, number> = { "01": 14, "17": 6 };

/** Splits the text into application identifiers and values. Unknown identifiers are reported, not guessed at. */
function split(raw: string): { pairs: [string, string][]; problems: string[] } {
  const problems: string[] = [];
  let t = raw.replace(/^\]d2/i, "").replace(/<GS>|\{GS\}|\^/gi, GS).replace(/[\r\n\t]/g, "").trim();
  const pairs: [string, string][] = [];
  if (t.includes("(")) {
    for (const m of t.matchAll(/\((\d{2,4})\)([^(]*)/g)) pairs.push([m[1], m[2].replace(new RegExp(GS, "g"), "").trim()]);
    return { pairs, problems };
  }
  t = t.replace(/\s+/g, "");
  let i = 0;
  while (i < t.length) {
    if (t[i] === GS) { i += 1; continue; }
    const ai = t.slice(i, i + 2);
    i += 2;
    if (ai in FIXED) {
      pairs.push([ai, t.slice(i, i + FIXED[ai])]);
      i += FIXED[ai];
    } else if (VARIABLE.has(ai)) {
      const end = t.indexOf(GS, i);
      const stop = end < 0 ? t.length : end;
      pairs.push([ai, t.slice(i, stop)]);
      i = stop;
    } else {
      problems.push(`The code has an identifier this screen does not read: (${ai}).`);
      break;
    }
  }
  return { pairs, problems };
}

const CHARS = /^[\x21-\x7e]{1,20}$/;

export function parseGs1(input: string): Gs1Parse {
  const text = (input ?? "").trim();
  if (!text) return { value: {}, ok: false, problems: ["Scan or type the code on the pack."] };
  const { pairs, problems } = split(text);
  const get = (ai: string) => pairs.find(([a]) => a === ai)?.[1];
  const value: Partial<Gs1> = {};

  const gtin = get("01");
  if (gtin === undefined) problems.push("The GTIN (01) is missing.");
  else if (!/^\d{14}$/.test(gtin)) problems.push("The GTIN (01) must be 14 digits.");
  else if (!validCheckDigit(gtin)) problems.push("The GTIN check digit is wrong. Scan the pack again.");
  else value.gtin = gtin;

  const serial = get("21");
  if (serial === undefined || serial === "") problems.push("The serial number (21) is missing.");
  else if (!CHARS.test(serial)) problems.push("The serial number (21) must be 1 to 20 characters.");
  else value.serial = serial;

  const batch = get("10");
  if (batch === undefined || batch === "") problems.push("The batch number (10) is missing.");
  else if (!CHARS.test(batch)) problems.push("The batch number (10) must be 1 to 20 characters.");
  else value.batch = batch;

  const xd = get("17");
  if (xd === undefined || xd === "") problems.push("The expiry date (17) is missing.");
  else {
    const iso = expiryFromYymmdd(xd);
    if (!iso) problems.push("The expiry date (17) is not a date. It must be YYMMDD.");
    else value.expiry = iso;
  }

  const clean = problems.filter((p, i) => problems.indexOf(p) === i);
  return { value, ok: clean.length === 0, problems: clean };
}

/** The same four parts typed by hand. Checked the same way as a scan. */
export function parseManual(m: { gtin: string; serial: string; batch: string; expiry: string }): Gs1Parse {
  const yy = /^\d{4}-\d{2}-\d{2}$/.test(m.expiry) ? yymmddFromExpiry(m.expiry) : "";
  return parseGs1(`(01)${m.gtin.trim()}(21)${m.serial.trim()}(17)${yy}(10)${m.batch.trim()}`);
}
