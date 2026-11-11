import type { FieldDef, FieldOption } from "../schema";

type Extra = Partial<Omit<FieldDef, "key" | "label" | "type" | "options">>;
type Opts = (string | FieldOption)[];

/** Small constructors so the form data stays short and readable. */
export const text = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "text", ...x });
export const area = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "textarea", ...x });
export const num = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "number", ...x });
export const date = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "date", ...x });
export const dt = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "datetime", ...x });
export const time = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "time", ...x });
export const sel = (key: string, label: string, options: Opts, x: Extra = {}): FieldDef => ({ key, label, type: "select", options, ...x });
export const radio = (key: string, label: string, options: Opts, x: Extra = {}): FieldDef => ({ key, label, type: "radio", options, ...x });
export const multi = (key: string, label: string, options: Opts, x: Extra = {}): FieldDef => ({ key, label, type: "multiselect", options, ...x });
export const chk = (key: string, label: string, x: Extra = {}): FieldDef => ({ key, label, type: "checkbox", ...x });
export const scale = (key: string, label: string, max: number, x: Extra = {}): FieldDef => ({ key, label, type: "scale", max, ...x });

/** Put every field in a named section heading. */
export const section = (name: string, ...fields: FieldDef[]): FieldDef[] => fields.map((f) => ({ ...f, section: name }));

/** Scored option: label with a numeric score. */
export const so = (value: string, label: string, score: number): FieldOption => ({ value, label, score });

/** Numeric score options from min to max, for example -1 to 5. */
export const scoreRange = (min: number, max: number): FieldOption[] =>
  Array.from({ length: max - min + 1 }, (_, i) => {
    const n = min + i;
    return { value: String(n), label: String(n), score: n };
  });

export const YES_NO = ["Yes", "No"];
export const YES_NO_UNKNOWN = ["Yes", "No", "Unknown"];
export const NORMAL_ABNORMAL = ["Normal", "Abnormal", "Not examined"];
export const SHIFTS = ["Morning", "Evening", "Night"];
