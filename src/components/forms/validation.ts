/**
 * Form validation helpers. Pure functions, no React, so they are easy to test.
 *
 * The rule for showing errors: a field shows its error after the user leaves it (blur) or after a save attempt,
 * never while they are still typing in it for the first time.
 */

export type Errors = Record<string, string>;
export type Value = unknown;
export type Rule<V = Record<string, Value>> = (value: Value, all: V) => string | undefined;

/** Empty for a form: nothing typed, nothing picked, or an empty list. `false` counts as empty for a tick box. */
export function isBlank(v: Value): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "number") return Number.isNaN(v);
  return false;
}

export const rules = {
  required: (message = "This field is required."): Rule => (v) => (isBlank(v) ? message : undefined),
  /** A number between min and max. Empty passes: pair it with required when a value must be given. */
  range: (min: number | undefined, max: number | undefined, message?: string): Rule => (v) => {
    if (isBlank(v)) return undefined;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (Number.isNaN(n)) return "Enter a number.";
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return message ?? rangeText(min, max);
    return undefined;
  },
  minLength: (n: number, message?: string): Rule => (v) => (isBlank(v) || String(v).trim().length >= n ? undefined : message ?? `Enter at least ${n} characters.`),
  pattern: (re: RegExp, message: string): Rule => (v) => (isBlank(v) || re.test(String(v).trim()) ? undefined : message),
};

/** "Enter a number from 1 to 4", "Enter 0 or more", "Enter 10 or less". */
export function rangeText(min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) return `Enter a number from ${min} to ${max}.`;
  if (min !== undefined) return `Enter ${min} or more.`;
  if (max !== undefined) return `Enter ${max} or less.`;
  return "Enter a number.";
}

/** Runs the rules of each field and keeps the first problem of each. Fields with no problem are left out. */
export function validate<V extends Record<string, Value>>(values: V, fieldRules: Partial<Record<string, Rule<V>[]>>): Errors {
  const out: Errors = {};
  for (const [key, list] of Object.entries(fieldRules)) {
    for (const rule of list ?? []) {
      const msg = rule(values[key], values);
      if (msg) { out[key] = msg; break; }
    }
  }
  return out;
}

/** The errors the user should see now: those of fields they have left, or all of them after a save attempt. */
export function visibleErrors(errors: Errors, touched: ReadonlySet<string>, submitted: boolean): Errors {
  if (submitted) return errors;
  const out: Errors = {};
  for (const [k, v] of Object.entries(errors)) if (touched.has(k)) out[k] = v;
  return out;
}

/** The first field with an error, in the order the fields appear on the form. */
export function firstErrorKey(errors: Errors, order: readonly string[]): string | undefined {
  return order.find((k) => errors[k]) ?? Object.keys(errors)[0];
}

/** "1 field needs attention", "3 fields need attention". */
export function attentionText(n: number): string {
  return n === 1 ? "1 field needs attention" : `${n} fields need attention`;
}

/** Errors in the order of the form, each with the label to show in a summary. */
export function summaryItems(errors: Errors, order: readonly string[], labels: Record<string, string> = {}): { key: string; label: string; message: string }[] {
  const keys = [...order.filter((k) => errors[k]), ...Object.keys(errors).filter((k) => !order.includes(k))];
  return keys.map((key) => ({ key, label: labels[key] ?? key, message: errors[key] }));
}

/** How many of a list of keys have an error. Used for the count on a section or a step. */
export function countIn(errors: Errors, keys: readonly string[]): number {
  return keys.filter((k) => errors[k]).length;
}
