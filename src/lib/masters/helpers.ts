import type { MasterColumn, MasterDef, Row } from "../schema";

/** Small builders so the master definitions stay short. All sample data is made up. */

export const RCM_NOTE =
  "Scaffold with sample rows. Claims and RCM are the financial NPHIES scope, not the Unified Health Record (UHR) clinical scope. Nothing here is sent to a payer.";

export const text = (key: string, label: string, required = false, placeholder?: string): MasterColumn => ({
  key, label, ...(required || placeholder ? { field: { type: "text", required, placeholder } } : {}),
});
export const mono = (key: string, label: string, required = false, placeholder?: string): MasterColumn => ({
  key, label, type: "mono", ...(required || placeholder ? { field: { type: "text", required, placeholder } } : {}),
});
export const num = (key: string, label: string, required = false): MasterColumn => ({
  key, label, type: "number", ...(required ? { field: { type: "number", required } } : {}),
});
export const date = (key: string, label: string, required = false): MasterColumn => ({
  key, label, type: "date", ...(required ? { field: { type: "date", required } } : {}),
});
export const bool = (key: string, label: string): MasterColumn => ({ key, label, type: "bool" });
export const badge = (key: string, label: string, options: string[], required = true): MasterColumn => ({
  key, label, type: "badge", field: { type: "select", options, required },
});
/** Plain text cell that is edited with a dropdown. */
export const pick = (key: string, label: string, options: string[], required = false): MasterColumn => ({
  key, label, field: { type: "select", options, required },
});
export const monoPick = (key: string, label: string, options: string[], required = false): MasterColumn => ({
  key, label, type: "mono", field: { type: "select", options, required },
});

/** Marks a field as form only: it is asked in the add and edit form and left out of the list. */
export const more = (...cols: MasterColumn[]): MasterColumn[] => cols.map((c) => ({ ...c, formOnly: true }));

export const STATUS = ["Active", "Draft", "Review", "Disabled"];
export const CLINICS = ["Family Medicine", "Internal Medicine", "Pediatrics", "Orthopedics", "Radiology", "Laboratory", "Emergency", "Rehabilitation"];

/* ---------- rules for saving a row ---------- */

const keyText = (v: Row[string] | undefined) => String(v ?? "").trim().toLowerCase();

/**
 * The column that names a row (its code or number): the first column, when it is a typed code. Two rows may not share
 * it. A table whose sample rows already repeat the first column (a log, a list of pages by module) has no key column.
 */
export function keyColumn(def: MasterDef): MasterColumn | undefined {
  const first = def.columns[0];
  if (!first || first.type !== "mono" || first.field?.type === "select") return undefined;
  const seen = new Set<string>();
  for (const r of def.seed) {
    const k = keyText(r[first.key]);
    if (!k) continue;
    if (seen.has(k)) return undefined;
    seen.add(k);
  }
  return first;
}

/** Number columns where a figure below zero has a meaning (money owed back, a difference). Every other number must be zero or more. */
const MAY_BE_NEGATIVE = /balance|variance|adjust|difference/i;
export const allowsNegative = (c: MasterColumn): boolean => MAY_BE_NEGATIVE.test(c.key) || MAY_BE_NEGATIVE.test(c.label);

/**
 * What stops a setup row from being saved, in plain words. `index` is the place of the row being changed, or null for a new row.
 */
export function rowProblems(def: MasterDef, row: Row, rows: Row[], index: number | null): string[] {
  const out: string[] = [];
  for (const c of def.columns) {
    const v = row[c.key];
    if (c.field?.required && (v === undefined || v === "")) out.push(`Enter ${c.label}.`);
    if (c.type === "number" && v !== undefined && v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) out.push(`${c.label} must be a number.`);
      else if (n < 0 && !allowsNegative(c)) out.push(`${c.label} cannot be below zero.`);
    }
  }
  const key = keyColumn(def);
  const mine = key ? keyText(row[key.key]) : "";
  if (key && mine && rows.some((r, i) => i !== index && keyText(r[key.key]) === mine)) {
    out.push(`${key.label} ${String(row[key.key]).trim()} is already used by another row. Each row needs its own.`);
  }
  return out;
}
