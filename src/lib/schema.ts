/**
 * Shared schema types. EMR forms and setup (master) pages are described as data,
 * and generic engines render them. Add a form or a master by adding data, not code.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "scale"; // 0..max score, shown as buttons

export interface FieldOption {
  value: string;
  label: string;
  /** Score for risk scales. */
  score?: number;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: (string | FieldOption)[];
  unit?: string;
  min?: number;
  max?: number;
  required?: boolean;
  placeholder?: string;
  /** Group fields under a heading inside the form. */
  section?: string;
  /** Full row on the form grid. Text areas are always full. */
  full?: boolean;
  /** Developer View tag, for example "DG1-3" or "Composition.section". */
  hl7?: string;
  hint?: string;
  /** Number worked out from other number fields: the sum of `add` minus the sum of `subtract`. Shown read-only. */
  compute?: { add: string[]; subtract?: string[] };
  /** Filled by the system and shown read-only: the signed-in user, or the allergies recorded in the chart. */
  auto?: "user" | "allergies";
  /** Starting value for a new record: the time now, today's date, or the shift that is running now. */
  prefill?: "now" | "today" | "shift";
}

/** Names a range of a total score, for example "High risk" for 45 and above. */
export interface ScoreBand {
  min: number;
  max: number;
  label: string;
  tone: "ok" | "warn" | "danger";
}

export type FormGroup = "General" | "Rehab" | "Gynecology & Antenatal (OPD)" | "Obstetrics & Labor (IPD)" | "OT" | "Nursing";

export interface FormDef {
  id: string;
  title: string;
  group: FormGroup;
  description?: string;
  fields: FieldDef[];
  /** Field keys shown as columns in the record list. Defaults to the first four fields. */
  summaryKeys?: string[];
  /** Which NPHIES document or message this form feeds, if any. Shown in Developer View. */
  nphies?: string;
  /** Computed total for score forms: sum of scale scores. */
  scoreLabel?: string;
  /** Risk bands for the total score. */
  scoreBands?: ScoreBand[];
  /** The total only counts when every scored item is answered. */
  scoreAll?: boolean;
  /** Age group the tool is made for. Children are under 14 years. */
  audience?: "child" | "adult";
  /** Form id of the same kind of tool for the other age group. */
  alternative?: string;
  /** Short forms used on the form, with their meaning. */
  legend?: [string, string][];
  /** Extra summary above the record list. */
  rollup?: "fluid-balance";
}

export type CellType = "text" | "badge" | "bool" | "number" | "date" | "mono";

export interface MasterColumn {
  key: string;
  label: string;
  type?: CellType;
  /** Fields in the add and edit form. Defaults to a text field. */
  field?: Pick<FieldDef, "type" | "options" | "required" | "placeholder">;
}

export type Row = Record<string, string | number | boolean>;

export interface MasterDef {
  id: string;
  title: string;
  /** Group in the menu, for example "Client Setup". */
  module: string;
  description?: string;
  columns: MasterColumn[];
  seed: Row[];
  /** Tell the user what is real and what is a scaffold. */
  note?: string;
  readOnly?: boolean;
}

export interface FormRecord {
  id: string;
  at: string; // ISO
  author: string;
  values: Record<string, string | number | boolean | string[]>;
}
