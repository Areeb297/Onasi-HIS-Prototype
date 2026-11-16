import { audit } from "./audit";
import { createStore } from "./fhir/store-util";
import { can, currentUser } from "./session";

/**
 * Claim scrubbing rule engine: the rules the claim review runs, the NPHIES validation rules loaded from the NPHIES
 * workbook, and the field mapping that tells a rule where each claim field comes from. Follows the HIS rcm/rule-engine
 * (Generic Rules and NPHIES Rules tabs), rcm/rule-engine/upload and rcm/field-mapping pages.
 *
 * The HIS builds a rule as a query over its database tables. Here a rule is either a built-in check (the review rules the
 * claim always had, now seeded as rules so their severity, trigger, claim types and on/off can be changed) or a list of
 * conditions on mapped claim fields, all of which must hold for the rule to fire.
 */

export type Severity = "warning" | "soft" | "hard";
export const SEVERITY_NAME: Record<Severity, string> = { warning: "Warning", soft: "Soft Stop", hard: "Hard Stop" };
export type RuleTrigger = "both" | "priorauth" | "claim";
// HIS lookup Claim Scrubbing Rule Trigger Stage (262): Before PreAuth Submit, Before Claim Submit.
export const TRIGGER_LABEL: Record<RuleTrigger, string> = { both: "Before PreAuth And Claim Submit", priorauth: "Before PreAuth Submit", claim: "Before Claim Submit" };
export type RuleSource = "generic" | "nphies";
export type ClaimTypeKey = "institutional" | "professional" | "pharmacy" | "oral" | "vision";

/** The checks the claim review always had. Each is a seeded rule. */
export type BuiltInCheck = "no-principal-dx" | "many-principal-dx" | "no-chief-complaint" | "no-vitals" | "vitals-missing" | "auth-not-approved" | "line-no-dx" | "line-zero-cost"
  | "symptom-principal" | "injury-no-external-cause";
export const BUILT_IN_LABEL: Record<BuiltInCheck, string> = {
  "no-principal-dx": "A principal diagnosis is set", "many-principal-dx": "Only one diagnosis is principal", "no-chief-complaint": "The chief complaint is recorded",
  "no-vitals": "Vital signs are recorded", "vitals-missing": "All eight vital signs have a value or an absence reason", "auth-not-approved": "Prior authorization is approved when needed",
  "line-no-dx": "Each service line is linked to a diagnosis", "line-zero-cost": "Each service line has a price",
  "symptom-principal": "A symptom code is not principal when a definite diagnosis is coded", "injury-no-external-cause": "An injury has an external cause code",
};

export type Operator = "empty" | "not-empty" | "equals" | "not-equals" | "greater" | "less" | "contains" | "not-contains";
export const OPERATOR_LABEL: Record<Operator, string> = {
  empty: "Is Empty", "not-empty": "Is Not Empty", equals: "Equals", "not-equals": "Does Not Equal", greater: "Greater Than", less: "Less Than", contains: "Contains", "not-contains": "Does Not Contain",
};
export const NO_VALUE: Operator[] = ["empty", "not-empty"];

export interface Condition { field: string; op: Operator; value: string }

export interface Rule {
  id: string;
  source: RuleSource;
  name: string;
  description: string;
  category: string;
  severity: Severity;
  trigger: RuleTrigger;
  /** Claim types the rule applies to. Empty means every type. */
  claimTypes: ClaimTypeKey[];
  active: boolean;
  check?: BuiltInCheck;
  conditions?: Condition[];
  /** What the review says when the rule fires, and how to fix it. */
  message: string;
  fix: string;
  /** The NPHIES business rule this matches, for example BV-00027. */
  nphiesCode?: string;
  /** NPHIES rules: the element of the message the rule is about, as the NPHIES workbook names it. */
  relatedElement?: string;
  updatedAt: string;
  updatedBy: string;
}

export type FieldScope = "claim" | "line";
export type FieldType = "text" | "number" | "list";

/**
 * Where a claim field comes from. `key` is the value the engine reads; source and NPHIES path are what the HIS table and
 * the NPHIES message call it. An inactive field cannot be used in a condition, and rules that use it are skipped.
 */
export interface FieldMap { id: string; key: string; name: string; source: string; nphiesPath: string; type: FieldType; scope: FieldScope; active: boolean; updatedAt: string }

/** The values a condition can read. Claim fields once per claim, line fields once per service line. */
export interface ClaimFacts {
  claim: Record<string, string | number | undefined>;
  lines: { key: string; seq: number; text: string; values: Record<string, string | number | undefined> }[];
}

/** The fields the engine knows how to read. A mapping points at one of these keys. */
export const FIELD_KEYS: { key: string; scope: FieldScope; type: FieldType; name: string }[] = [
  { key: "claim.type", scope: "claim", type: "list", name: "Claim Type" },
  { key: "claim.subType", scope: "claim", type: "list", name: "Claim Sub-Type" },
  { key: "claim.priority", scope: "claim", type: "list", name: "Claim Priority" },
  { key: "claim.payer", scope: "claim", type: "text", name: "Payer" },
  { key: "claim.net", scope: "claim", type: "number", name: "Claim Net Amount" },
  { key: "claim.insurance", scope: "claim", type: "number", name: "Insurance Share" },
  { key: "claim.lineCount", scope: "claim", type: "number", name: "Number Of Service Lines" },
  { key: "claim.end", scope: "claim", type: "text", name: "Service End Date" },
  { key: "dx.count", scope: "claim", type: "number", name: "Number Of Diagnoses" },
  { key: "dx.principalCount", scope: "claim", type: "number", name: "Number Of Principal Diagnoses" },
  { key: "dx.codes", scope: "claim", type: "text", name: "Diagnosis Codes" },
  { key: "careTeam.count", scope: "claim", type: "number", name: "Care Team Size" },
  { key: "careTeam.primaryCount", scope: "claim", type: "number", name: "Primary Doctors On Care Team" },
  { key: "encounter.class", scope: "claim", type: "list", name: "Encounter Class" },
  { key: "encounter.lengthOfStay", scope: "claim", type: "number", name: "Length Of Stay (Days)" },
  { key: "encounter.triage", scope: "claim", type: "text", name: "Triage Category" },
  { key: "eligibility.status", scope: "claim", type: "list", name: "Eligibility Status" },
  { key: "auth.status", scope: "claim", type: "list", name: "Prior Authorization Status" },
  { key: "patient.age", scope: "claim", type: "number", name: "Patient Age" },
  { key: "patient.sex", scope: "claim", type: "list", name: "Patient Sex" },
  { key: "complaint.text", scope: "claim", type: "text", name: "Chief Complaint" },
  { key: "line.system", scope: "line", type: "list", name: "Service Code System" },
  { key: "line.code", scope: "line", type: "text", name: "Service Code" },
  { key: "line.kind", scope: "line", type: "list", name: "Service Kind" },
  { key: "line.quantity", scope: "line", type: "number", name: "Quantity" },
  { key: "line.unitCost", scope: "line", type: "number", name: "Unit Cost" },
  { key: "line.net", scope: "line", type: "number", name: "Line Net Amount" },
  { key: "line.dxLinks", scope: "line", type: "number", name: "Diagnoses Linked To Line" },
];

/* ---------- seed ---------- */

const SEED_AT = "2026-06-01T08:00:00.000Z";
const SEED_BY = "System Administrator";

const SOURCE: Record<string, [string, string]> = {
  "claim.type": ["RcmClaim.ClaimTypeId", "Claim.type"], "claim.subType": ["RcmClaim.SubTypeId", "Claim.subType"], "claim.priority": ["RcmClaim.PriorityId", "Claim.priority"],
  "claim.payer": ["RcmClaim.PayerId", "Claim.insurer"], "claim.net": ["Bill.NetAmount", "Claim.total"], "claim.insurance": ["Bill.InsuranceAmount", "Claim.total (payer share)"],
  "claim.lineCount": ["BillDetail (count)", "Claim.item (count)"], "claim.end": ["RcmClaim.ServiceEndDate", "Claim.billablePeriod.end"], "dx.count": ["ClaimDiagnosis (count)", "Claim.diagnosis (count)"],
  "dx.principalCount": ["ClaimDiagnosis.DiagnosisTypeId", "Claim.diagnosis.type"], "dx.codes": ["ClaimDiagnosis.Icd10Code", "Claim.diagnosis.diagnosisCodeableConcept"],
  "careTeam.count": ["ClaimCareTeam (count)", "Claim.careTeam (count)"], "careTeam.primaryCount": ["ClaimCareTeam.RoleId", "Claim.careTeam.role"],
  "encounter.class": ["Visit.VisitTypeId", "Encounter.class"], "encounter.lengthOfStay": ["Admission.LengthOfStay", "Encounter.period"], "encounter.triage": ["EmergencyVisit.TriageCategory", "Encounter.extension-triageCategory"],
  "eligibility.status": ["EligibilityResponse.Status", "CoverageEligibilityResponse.insurance.inforce"], "auth.status": ["PreAuthorization.StatusId", "Claim.insurance.preAuthRef"],
  "patient.age": ["Patient.DateOfBirth", "Patient.birthDate"], "patient.sex": ["Patient.GenderId", "Patient.gender"], "complaint.text": ["VisitComplaint.Description", "Claim.supportingInfo (chief-complaint)"],
  "line.system": ["BillDetail.CodeSystem", "Claim.item.productOrService.coding.system"], "line.code": ["BillDetail.ServiceCode", "Claim.item.productOrService.coding.code"],
  "line.kind": ["BillDetail.ServiceTypeId", "Claim.item.extension-package"], "line.quantity": ["BillDetail.Quantity", "Claim.item.quantity"], "line.unitCost": ["BillDetail.UnitPrice", "Claim.item.unitPrice"],
  "line.net": ["BillDetail.NetAmount", "Claim.item.net"], "line.dxLinks": ["BillDetailDiagnosis (count)", "Claim.item.diagnosisSequence"],
};

export const SEED_FIELDS: FieldMap[] = FIELD_KEYS.map((f, i) => ({
  id: `FM-${String(i + 1).padStart(3, "0")}`, key: f.key, name: f.name, source: SOURCE[f.key]?.[0] ?? f.key, nphiesPath: SOURCE[f.key]?.[1] ?? "", type: f.type, scope: f.scope, active: true, updatedAt: SEED_AT,
}));

const built = (id: string, check: BuiltInCheck, severity: Severity, trigger: RuleTrigger, category: string, nphiesCode: string | undefined, message: string, fix: string): Rule => ({
  id, source: "generic", name: BUILT_IN_LABEL[check], description: `Built-in check of the claim review. ${message}`, category, severity, trigger, claimTypes: [], active: true, check,
  message, fix, nphiesCode, updatedAt: SEED_AT, updatedBy: SEED_BY,
});

export const SEED_RULES: Rule[] = [
  built("GR-001", "no-principal-dx", "hard", "both", "Diagnosis", "BV-00027", "There is no principal diagnosis.", "Set one diagnosis to Principal in the Diagnoses section, or add it in the chart."),
  built("GR-002", "many-principal-dx", "hard", "both", "Diagnosis", "BV-00027", "More than one diagnosis is marked Principal.", "Change the others to Secondary."),
  built("GR-003", "no-chief-complaint", "hard", "both", "Supporting Information", "BV-00501", "The chief complaint is missing.", "Record the chief complaint in the chart."),
  built("GR-004", "no-vitals", "hard", "both", "Supporting Information", "BV-00763", "No vital signs are recorded for this visit.", "Record the vital signs in the chart, or an absence reason for each one."),
  built("GR-005", "vitals-missing", "soft", "both", "Supporting Information", "BV-00763", "Some vital signs are missing.", "Record each one in the chart, or an absence reason. The payer may reject the claim without them."),
  built("GR-006", "auth-not-approved", "hard", "claim", "Prior Authorization", "BV-00045", "The visit needs prior authorization and it is not approved.", "Send Prior Authorization and wait for the approval before sending the claim."),
  built("GR-007", "line-no-dx", "soft", "both", "Service Lines", "BV-00230", "A service line is not linked to a diagnosis.", "Tick the diagnosis this service was for."),
  // ICD-10-AM with the Australian Coding Standards (the edition CHI mandates): a symptom (R00-R99) is not the principal
  // diagnosis once a definite one is coded, and an injury (S00-T98) carries an external cause (V01-Y98).
  built("CS-003", "symptom-principal", "soft", "both", "Diagnosis", undefined, "A symptom code is principal although a definite diagnosis is coded.", "Make the definite diagnosis principal and the symptom secondary, or remove the symptom."),
  built("CS-004", "injury-no-external-cause", "soft", "both", "Diagnosis", undefined, "An injury is coded without an external cause code.", "Add the external cause (V01-Y98): how and where the injury happened."),
  built("GR-008", "line-zero-cost", "warning", "both", "Service Lines", undefined, "A service line has no cost.", "The invoice has no price for it, so the payer pays nothing. Bill it on the invoice or remove the line."),
  {
    id: "GR-009", source: "generic", name: "High Value Claim", description: "Claims above 5,000 SAR are checked by a senior biller before they go out.", category: "Amounts", severity: "warning", trigger: "claim",
    claimTypes: [], active: true, conditions: [{ field: "claim.net", op: "greater", value: "5000" }], message: "The claim is above 5,000 SAR.", fix: "Ask a senior biller to check the claim before sending it.",
    updatedAt: SEED_AT, updatedBy: SEED_BY,
  },
  // Claims bill SBS codes (CHI); ACHI is the clinical code and becomes SBS by adding its two-digit extension.
  {
    id: "CS-001", source: "generic", name: "ACHI Code On A Claim Line", description: "Claims bill procedures with their SBS code, not the ACHI code from the chart.", category: "Service Lines", severity: "soft", trigger: "both",
    claimTypes: [], active: true, conditions: [{ field: "line.system", op: "equals", value: "ACHI" }],
    message: "A service line carries an ACHI code.", fix: "Replace it with the SBS code: the ACHI code plus its two-digit extension (for example 30571-00-00).", updatedAt: SEED_AT, updatedBy: SEED_BY,
  },
  {
    id: "CS-002", source: "generic", name: "Placeholder Service Code", description: "A sample code that the hospital has not mapped to its SBS or SFDA code yet.", category: "Service Lines", severity: "warning", trigger: "both",
    claimTypes: [], active: true, conditions: [{ field: "line.code", op: "contains", value: "SAMPLE" }],
    message: "A service line still has a sample code.", fix: "Map the service to its SBS code (medicines: the SFDA code) in the price list before sending.", updatedAt: SEED_AT, updatedBy: SEED_BY,
  },
  {
    id: "GR-010", source: "generic", name: "Long Inpatient Stay", description: "Stays longer than 10 days usually need a length of stay extension from the payer.", category: "Prior Authorization", severity: "soft", trigger: "both",
    claimTypes: ["institutional"], active: false, conditions: [{ field: "encounter.class", op: "equals", value: "I" }, { field: "encounter.lengthOfStay", op: "greater", value: "10" }],
    message: "The stay is longer than 10 days.", fix: "Check the payer approved the extra days before sending.", updatedAt: SEED_AT, updatedBy: SEED_BY,
  },
  ...([
    ["BV-00112", "Coverage", "Claim.insurance.coverage", "The member must be covered on the service date.", "hard", [{ field: "eligibility.status", op: "equals", value: "Not Eligible" }], "The payer said the member was not covered.", "Check eligibility again, or bill the visit as cash."],
    ["BV-00318", "Item", "Claim.item.productOrService", "Every service line needs a service code.", "hard", [{ field: "line.code", op: "empty", value: "" }], "A service line has no service code.", "Enter the SBS code on the line (medicines: the SFDA code)."],
    ["BV-00341", "Encounter", "Encounter.extension-triageCategory", "An emergency claim carries the triage category.", "soft", [{ field: "encounter.class", op: "equals", value: "E" }, { field: "encounter.triage", op: "empty", value: "" }], "The emergency visit has no triage category.", "Ask the triage nurse to record the CTAS level in the chart."],
    ["BV-00610", "Claim", "Claim.billablePeriod.end", "An inpatient claim needs the service end date.", "hard", [{ field: "encounter.class", op: "equals", value: "I" }, { field: "claim.end", op: "empty", value: "" }], "The inpatient claim has no service end date.", "Set the Service End date in Claim Details."],
    ["BV-00920", "Item", "Claim.item.quantity", "The quantity of a service line must be at least 1.", "hard", [{ field: "line.quantity", op: "less", value: "1" }], "A service line has a quantity below 1.", "Correct the quantity on the invoice."],
    ["BV-01004", "Care Team", "Claim.careTeam.role", "The care team needs a primary doctor.", "hard", [{ field: "careTeam.primaryCount", op: "less", value: "1" }], "No doctor on the care team is Primary.", "Set one doctor to Primary in the Care Team section."],
  ] as [string, string, string, string, Severity, Condition[], string, string][]).map(([code, category, element, description, severity, conditions, message, fix]): Rule => ({
    id: code, source: "nphies", name: description.replace(/\.$/, ""), description, category, severity, trigger: "both", claimTypes: [], active: true, conditions, message, fix,
    nphiesCode: code, relatedElement: element, updatedAt: SEED_AT, updatedBy: SEED_BY,
  })),
];

/* ---------- store ---------- */

interface RuleState { rules: Rule[]; fields: FieldMap[]; seq: number }
const store = createStore<RuleState>("onasi-rcm-rules-v1", () => ({ rules: SEED_RULES.map((r) => ({ ...r })), fields: SEED_FIELDS.map((f) => ({ ...f })), seq: 10 }));
export const useRules = store.use;
export const getRules = store.get;
export const resetRules = store.reset;

/** The rules the claim review runs. Tests and fresh installs get the seeded set. */
export const activeRuleSet = (): { rules: Rule[]; fields: FieldMap[] } => {
  const s = store.get();
  return { rules: s.rules, fields: s.fields };
};

/* ---------- evaluating ---------- */

const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")));
const isEmpty = (v: unknown) => v === undefined || v === null || String(v).trim() === "";

export function conditionHolds(c: Condition, value: string | number | undefined): boolean {
  const text = String(value ?? "").toLowerCase();
  const want = c.value.trim().toLowerCase();
  switch (c.op) {
    case "empty": return isEmpty(value);
    case "not-empty": return !isEmpty(value);
    case "equals": return text === want;
    case "not-equals": return text !== want;
    case "greater": return !isEmpty(value) && Number.isFinite(num(value)) && num(value) > num(c.value);
    case "less": return !isEmpty(value) && Number.isFinite(num(value)) && num(value) < num(c.value);
    case "contains": return text.includes(want);
    case "not-contains": return !text.includes(want);
  }
}

/** Whether the rule applies to this use (prior authorization or claim) and this claim type. */
export const ruleApplies = (r: Pick<Rule, "active" | "trigger" | "claimTypes">, use: "priorauth" | "claim", claimType?: string): boolean =>
  r.active && (r.trigger === "both" || r.trigger === use) && (!r.claimTypes.length || !claimType || r.claimTypes.includes(claimType as ClaimTypeKey));

export interface ConditionHit { lineKey?: string; seq?: number; text?: string }

/**
 * Where a condition rule fires. With only claim fields it fires once; with a line field it fires once per line where every
 * condition holds. A rule that uses an unknown or inactive field never fires (the screen says so).
 */
export function evaluateConditions(conditions: Condition[], facts: ClaimFacts, fields: FieldMap[]): ConditionHit[] {
  if (!conditions.length) return [];
  const known = new Map(fields.filter((f) => f.active).map((f) => [f.key, f]));
  if (conditions.some((c) => !known.has(c.field))) return [];
  const lineLevel = conditions.some((c) => known.get(c.field)!.scope === "line");
  const read = (c: Condition, line?: ClaimFacts["lines"][number]) => (known.get(c.field)!.scope === "line" ? line?.values[c.field] : facts.claim[c.field]);
  if (!lineLevel) return conditions.every((c) => conditionHolds(c, read(c))) ? [{}] : [];
  return facts.lines.filter((l) => conditions.every((c) => conditionHolds(c, read(c, l)))).map((l) => ({ lineKey: l.key, seq: l.seq, text: l.text }));
}

/** Fields a rule uses that are missing or switched off. */
export function brokenFields(r: Pick<Rule, "conditions">, fields: FieldMap[]): string[] {
  const active = new Set(fields.filter((f) => f.active).map((f) => f.key));
  return (r.conditions ?? []).filter((c) => !active.has(c.field)).map((c) => c.field);
}

export const conditionText = (c: Condition, fields: FieldMap[] = store.get().fields): string => {
  const name = fields.find((f) => f.key === c.field)?.name ?? c.field;
  return NO_VALUE.includes(c.op) ? `${name} ${OPERATOR_LABEL[c.op].toLowerCase()}` : `${name} ${OPERATOR_LABEL[c.op].toLowerCase()} ${c.value}`;
};

/* ---------- changing rules and fields ---------- */

export type EngineResult = { ok: true; id?: string } | { ok: false; problems: string[] };
const who = () => { try { return currentUser().name; } catch { return "Unknown"; } };
const denied = (target: string): EngineResult => {
  audit("denied", target, { detail: "Needs billing" });
  return { ok: false, problems: ["Your role cannot change the rule engine. This needs the billing permission."] };
};

export type RuleInput = Omit<Rule, "id" | "updatedAt" | "updatedBy"> & { id?: string };

export function ruleProblems(r: RuleInput, fields: FieldMap[], others: Rule[]): string[] {
  const out: string[] = [];
  if (r.name.trim().length < 3) out.push("Give the rule a name.");
  if (r.message.trim().length < 3) out.push("Say what the review shows when the rule fires.");
  if (!r.check) {
    if (!r.conditions?.length) out.push("Add at least one condition.");
    for (const c of r.conditions ?? []) {
      const f = fields.find((x) => x.key === c.field);
      if (!f) out.push("Choose a field for every condition.");
      else if (!f.active) out.push(`${f.name} is switched off in Field Mapping.`);
      if (!NO_VALUE.includes(c.op) && !c.value.trim()) out.push(`Enter a value for ${f?.name ?? "the condition"}.`);
      if ((c.op === "greater" || c.op === "less") && c.value.trim() && !Number.isFinite(num(c.value))) out.push(`${f?.name ?? "The field"} is compared with a number. Enter a number.`);
    }
  }
  return [...new Set(out)];
}

/** Adds or updates a rule. A built-in rule keeps its check: only severity, trigger, claim types, texts and on/off change. */
export function saveRule(input: RuleInput): EngineResult {
  if (!can("billing")) return denied("Rule engine rule");
  const s = store.get();
  const existing = input.id ? s.rules.find((r) => r.id === input.id) : undefined;
  const next: RuleInput = existing?.check ? { ...input, check: existing.check, conditions: undefined, source: existing.source } : input;
  const problems = ruleProblems(next, s.fields, s.rules.filter((r) => r.id !== input.id));
  if (problems.length) return { ok: false, problems };
  const seq = existing ? s.seq : s.seq + 1;
  const id = existing?.id ?? input.id?.trim() ?? (next.source === "nphies" ? `NR-${String(seq).padStart(3, "0")}` : `GR-${String(seq).padStart(3, "0")}`);
  if (!existing && s.rules.some((r) => r.id === id)) return { ok: false, problems: [`Rule ${id} already exists.`] };
  const rule: Rule = { ...next, id, name: next.name.trim(), message: next.message.trim(), fix: next.fix.trim(), updatedAt: new Date().toISOString(), updatedBy: who() } as Rule;
  store.set({ ...s, seq, rules: existing ? s.rules.map((r) => (r.id === id ? rule : r)) : [...s.rules, rule] });
  audit(existing ? "update" : "create", `Rule ${id}`, { detail: `${rule.name}, ${SEVERITY_NAME[rule.severity]}, ${rule.active ? "active" : "inactive"}` });
  return { ok: true, id };
}

export function setRuleActive(id: string, active: boolean): EngineResult {
  if (!can("billing")) return denied(`Rule ${id}`);
  const s = store.get();
  const r = s.rules.find((x) => x.id === id);
  if (!r) return { ok: false, problems: ["This rule was not found."] };
  if (active && brokenFields(r, s.fields).length) return { ok: false, problems: ["The rule uses a field that is switched off in Field Mapping. Switch the field on first."] };
  store.set({ ...s, rules: s.rules.map((x) => (x.id === id ? { ...x, active, updatedAt: new Date().toISOString(), updatedBy: who() } : x)) });
  audit("update", `Rule ${id}`, { detail: active ? "Switched on" : "Switched off" });
  return { ok: true };
}

/** Built-in rules cannot be deleted, only switched off. */
export function deleteRule(id: string): EngineResult {
  if (!can("billing")) return denied(`Rule ${id}`);
  const s = store.get();
  const r = s.rules.find((x) => x.id === id);
  if (!r) return { ok: false, problems: ["This rule was not found."] };
  if (r.check) return { ok: false, problems: ["A built-in rule cannot be deleted. Switch it off instead."] };
  store.set({ ...s, rules: s.rules.filter((x) => x.id !== id) });
  audit("delete", `Rule ${id}`, { detail: r.name });
  return { ok: true };
}

export type FieldInput = Omit<FieldMap, "id" | "updatedAt"> & { id?: string };

export function saveField(input: FieldInput): EngineResult {
  if (!can("billing")) return denied("Field mapping");
  const s = store.get();
  const problems: string[] = [];
  if (input.name.trim().length < 2) problems.push("Give the field a name.");
  if (!FIELD_KEYS.some((k) => k.key === input.key)) problems.push("Choose the claim value the field reads.");
  if (!input.source.trim()) problems.push("Enter the source table and column.");
  if (s.fields.some((f) => f.key === input.key && f.id !== input.id)) problems.push("Another mapping already reads this value.");
  if (problems.length) return { ok: false, problems };
  const meta = FIELD_KEYS.find((k) => k.key === input.key)!;
  const id = input.id ?? `FM-${String(s.fields.length + 1).padStart(3, "0")}`;
  const field: FieldMap = { ...input, id, name: input.name.trim(), source: input.source.trim(), nphiesPath: input.nphiesPath.trim(), scope: meta.scope, type: meta.type, updatedAt: new Date().toISOString() };
  store.set({ ...s, fields: input.id ? s.fields.map((f) => (f.id === id ? field : f)) : [...s.fields, field] });
  audit(input.id ? "update" : "create", `Field mapping ${id}`, { detail: `${field.name}: ${field.source}` });
  return { ok: true, id };
}

/** Switching a field off also switches off the active rules that use it, and says which. */
export function setFieldActive(id: string, active: boolean): EngineResult & { stopped?: string[] } {
  if (!can("billing")) return denied(`Field mapping ${id}`);
  const s = store.get();
  const f = s.fields.find((x) => x.id === id);
  if (!f) return { ok: false, problems: ["This mapping was not found."] };
  const stopped = active ? [] : s.rules.filter((r) => r.active && r.conditions?.some((c) => c.field === f.key)).map((r) => r.id);
  store.set({
    ...s,
    fields: s.fields.map((x) => (x.id === id ? { ...x, active, updatedAt: new Date().toISOString() } : x)),
    rules: s.rules.map((r) => (stopped.includes(r.id) ? { ...r, active: false, updatedAt: new Date().toISOString(), updatedBy: who() } : r)),
  });
  audit("update", `Field mapping ${id}`, { detail: `${active ? "Switched on" : "Switched off"}${stopped.length ? `; rules switched off: ${stopped.join(", ")}` : ""}` });
  return { ok: true, stopped };
}

/* ---------- uploading NPHIES rules ---------- */

/** The headers the HIS looks for in the NPHIES workbook, plus the optional columns this screen also reads. */
export const UPLOAD_COLUMNS = {
  required: ["Rule ID", "Rule Type", "Related Element", "Description", "Display"],
  optional: ["Severity", "Field", "Operator", "Value"],
};

export type UploadStatus = "Ready" | "Needs Review" | "Existing Rule" | "Invalid";
export interface UploadRow { index: number; status: UploadStatus; reason: string; rule: RuleInput }

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Finds the header row (it may not be the first) and reads each rule row. */
export function readRuleRows(table: string[][], fields: FieldMap[] = store.get().fields, existing: Rule[] = store.get().rules): { rows: UploadRow[]; missing: string[] } {
  const want = UPLOAD_COLUMNS.required.map(norm);
  const headerAt = table.findIndex((r) => want.every((w) => r.some((c) => norm(c) === w)));
  if (headerAt < 0) return { rows: [], missing: UPLOAD_COLUMNS.required };
  const head = table[headerAt].map(norm);
  const col = (name: string) => head.indexOf(norm(name));
  const get = (r: string[], name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
  const seen = new Set<string>();
  const rows = table.slice(headerAt + 1).filter((r) => r.some((c) => c.trim())).map((r, i): UploadRow => {
    const id = get(r, "Rule ID");
    const sevText = get(r, "Severity").toLowerCase();
    const severity: Severity = sevText.includes("hard") || sevText === "error" ? "hard" : sevText.includes("soft") ? "soft" : sevText.includes("warn") ? "warning" : "hard";
    const fieldText = get(r, "Field");
    const field = fields.find((f) => norm(f.key) === norm(fieldText) || norm(f.name) === norm(fieldText) || (f.nphiesPath && norm(f.nphiesPath) === norm(fieldText)))
      ?? fields.find((f) => f.nphiesPath && norm(f.nphiesPath) === norm(get(r, "Related Element")));
    const opText = norm(get(r, "Operator"));
    const op = (Object.keys(OPERATOR_LABEL) as Operator[]).find((o) => norm(o) === opText || norm(OPERATOR_LABEL[o]) === opText);
    const description = get(r, "Description") || get(r, "Display");
    const rule: RuleInput = {
      id, source: "nphies", name: (get(r, "Display") || description).replace(/\.$/, "").slice(0, 120), description, category: get(r, "Rule Type") || "NPHIES", severity, trigger: "both", claimTypes: [],
      active: true, conditions: field && op ? [{ field: field.key, op, value: get(r, "Value") }] : [], message: get(r, "Display") || description, fix: "See the NPHIES rule description.", nphiesCode: id,
      relatedElement: get(r, "Related Element"),
    };
    let status: UploadStatus = "Ready";
    let reason = "Ready to save.";
    if (!id) { status = "Invalid"; reason = "Rule ID is required."; }
    else if (seen.has(id)) { status = "Invalid"; reason = "This Rule ID is in the file twice."; }
    else if (!description) { status = "Invalid"; reason = "Description or Display is required."; }
    else if (!rule.conditions!.length) { status = "Needs Review"; reason = field ? "No operator. It is saved switched off until a condition is set." : "No mapped field. It is saved switched off until it is mapped."; }
    else if (existing.some((e) => e.id === id)) { status = "Existing Rule"; reason = "A rule with this ID exists. Saving updates it."; }
    if (id) seen.add(id);
    if (status === "Needs Review") rule.active = false;
    return { index: headerAt + i + 2, status, reason, rule };
  });
  return { rows, missing: [] };
}

/** Saves the chosen upload rows. Invalid rows are refused; rows without a condition are saved switched off. */
export function saveUploadedRules(rows: UploadRow[]): EngineResult & { saved?: number } {
  if (!can("billing")) return denied("Rule upload");
  if (!rows.length) return { ok: false, problems: ["Select at least one rule to save."] };
  if (rows.some((r) => r.status === "Invalid")) return { ok: false, problems: ["Invalid rows cannot be saved. Remove them from the selection."] };
  const s = store.get();
  const at = new Date().toISOString();
  const by = who();
  let rules = [...s.rules];
  for (const r of rows) {
    const rule: Rule = { ...(r.rule as Rule), id: r.rule.id!, updatedAt: at, updatedBy: by };
    rules = rules.some((x) => x.id === rule.id) ? rules.map((x) => (x.id === rule.id ? { ...rule, check: x.check } : x)) : [...rules, rule];
  }
  store.set({ ...s, rules });
  audit("create", "NPHIES rule upload", { detail: `${rows.length} rule(s) saved` });
  return { ok: true, saved: rows.length };
}

/** A sample workbook in CSV, with the headers the upload looks for. */
export function sampleRulesCsv(): string {
  return [
    "Rule ID,Rule Type,Related Element,Description,Display,Severity,Field,Operator,Value",
    "BV-00501,Supporting Info,Claim.supportingInfo,The chief complaint must be sent.,Chief complaint is missing,Hard Stop,Chief Complaint,Is Empty,",
    "BV-00777,Item,Claim.item.unitPrice,A priced service line must have a unit price above zero.,Unit price must be above zero,Soft Stop,Unit Cost,Less Than,0.01",
    "BV-00888,Diagnosis,Claim.diagnosis,A claim cannot carry more than 12 diagnoses.,Too many diagnoses,Warning,Number Of Diagnoses,Greater Than,12",
    "BV-00999,Claim,Claim.extension-newborn,The newborn flag must match the patient age.,Newborn flag mismatch,,,,",
  ].join("\n");
}
