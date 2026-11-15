import { allowsNegative, keyColumn } from "@/lib/masters/helpers";
import type { MasterColumn, MasterDef, Row } from "@/lib/schema";

/**
 * How a setup form is laid out and checked field by field. The setup tables describe columns only, so the sections
 * come from what each field is: the fields the list shows, personal details, contact and address, the rest, and the
 * status switches last.
 */

export interface FormSection {
  title: string;
  columns: MasterColumn[];
}

const CONTACT = /phone|mobile|email|fax|contact|address|country|state|city|region|postal|zip|website|po ?box/i;
const PERSONAL = /^(title|first ?name|middle ?name|last ?name|family ?name|gender|sex|dob|birth|nationality|identification|identity|marital|profile ?photo)/i;
const STATUS = /^(status|active|enabled|disabled)$/i;

const isStatus = (c: MasterColumn) => c.type === "bool" || STATUS.test(c.key) || STATUS.test(c.label);
const matches = (re: RegExp, c: MasterColumn) => re.test(c.key) || re.test(c.label);

export function formSections(def: Pick<MasterDef, "columns">): FormSection[] {
  const main: MasterColumn[] = [], personal: MasterColumn[] = [], contact: MasterColumn[] = [], more: MasterColumn[] = [], status: MasterColumn[] = [];
  def.columns.forEach((c, i) => {
    // The first two columns (the code and the name) always open the form.
    if (i < 2) main.push(c);
    else if (isStatus(c)) status.push(c);
    else if (matches(PERSONAL, c)) personal.push(c);
    else if (matches(CONTACT, c)) contact.push(c);
    else if (!c.formOnly) main.push(c);
    else more.push(c);
  });
  const all: FormSection[] = [
    { title: "Main Details", columns: main },
    { title: "Personal Details", columns: personal },
    { title: "Contact And Address", columns: contact },
    { title: "More Details", columns: more },
    { title: "Status", columns: status },
  ];
  const used = all.filter((s) => s.columns.length);
  // A short form reads better as one block than as sections of one or two fields.
  if (def.columns.length <= 6) return [{ title: "Details", columns: def.columns }];
  return used;
}

const keyText = (v: Row[string] | undefined) => String(v ?? "").trim().toLowerCase();

/**
 * The problem with each field, keyed by column, in the same words and by the same rules as `rowProblems`, so each
 * message can sit under its own field. Missing required fields are only listed when `showMissing` is true.
 */
export function fieldErrors(def: MasterDef, row: Row, rows: Row[], index: number | null, showMissing: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of def.columns) {
    const v = row[c.key];
    if (c.field?.required && (v === undefined || v === "")) {
      if (showMissing) out[c.key] = `Enter ${c.label}.`;
      continue;
    }
    if (c.type === "number" && v !== undefined && v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) out[c.key] = `${c.label} must be a number.`;
      else if (n < 0 && !allowsNegative(c)) out[c.key] = `${c.label} cannot be below zero.`;
    }
  }
  const key = keyColumn(def);
  const mine = key ? keyText(row[key.key]) : "";
  if (key && mine && !out[key.key] && rows.some((r, i) => i !== index && keyText(r[key.key]) === mine)) {
    out[key.key] = `${key.label} ${String(row[key.key]).trim()} is already used by another row. Each row needs its own.`;
  }
  return out;
}

/** True when the form differs from what it opened with. Blank and missing count as the same. */
export function isDirty(initial: Row, current: Row): boolean {
  const keys = new Set([...Object.keys(initial), ...Object.keys(current)]);
  for (const k of keys) {
    const a = initial[k], b = current[k];
    const ea = a === undefined || a === "" || a === false, eb = b === undefined || b === "" || b === false;
    if (ea && eb) continue;
    if (a !== b) return true;
  }
  return false;
}
