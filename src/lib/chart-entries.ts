import type { Allergy, AllergyCategory, Complaint, Dx, Patient } from "./model";
import type { AllergenGroup, CodedTerm } from "./reference-data";
import { coverageOutcome } from "./registration";

/**
 * Rules for the chart's diagnosis, allergy and chief complaint lists, kept free of screens so they can be tested.
 *
 * Diagnosis types follow the HIS (Principal, Secondary, Admitting, Differential). The ADT messages keep their own values:
 *  - DG1-6 (A, W, F) is held in `Dx.type`: Admitting is A, Differential is W, Principal and Secondary are W while the
 *    visit is open and F once the patient is discharged.
 *  - DG1-15 is 1 for the Principal diagnosis and 2 for the others. The Principal diagnosis is always kept first in
 *    the list, so documents and screens that read the first diagnosis still get the Principal one.
 *  - Older records have no `kind`. They are read as before: the first diagnosis is the Principal one,
 *    an Admitting (A) one is Admitting, and the rest are Secondary.
 */

/* ---------- search ---------- */

/** True when the text looks like the start of a code (for example "J1", "E11.9" or "3861"). */
export const looksLikeCode = (q: string): boolean => /^[A-Za-z]\d/.test(q) || /^\d{3,}$/.test(q);

/** Codes whose code or name match. Needs three letters, or the start of a code. Code matches come first. */
export function searchCodes<T extends CodedTerm>(list: T[], query: string, limit = 25): T[] {
  const q = query.trim().toLowerCase();
  if (!q || (q.length < 3 && !looksLikeCode(q))) return [];
  const flat = (s: string) => s.toLowerCase().replace(/\./g, "");
  const words = q.split(/\s+/);
  const byCode: T[] = [];
  const byText: T[] = [];
  for (const t of list) {
    if (flat(t.code).startsWith(flat(q))) byCode.push(t);
    else if (words.every((w) => t.text.toLowerCase().includes(w))) byText.push(t);
  }
  return [...byCode, ...byText].slice(0, limit);
}

/* ---------- diagnosis ---------- */

export type DxKind = NonNullable<Dx["kind"]>;

export const DX_KINDS: { code: DxKind; label: string }[] = [
  { code: "P", label: "Principal" },
  { code: "S", label: "Secondary" },
  { code: "AD", label: "Admitting" },
  { code: "DF", label: "Differential" },
];
export const dxKindLabel = (k: DxKind): string => DX_KINDS.find((x) => x.code === k)?.label ?? "Secondary";

/** The HIS type of a diagnosis. Older records (no kind) are read from their DG1-6 type and their place in the list. */
export function dxKind(d: Dx, index: number): DxKind {
  if (d.kind) return d.kind;
  if (index === 0) return "P";
  return d.type === "A" ? "AD" : "S";
}

/** DG1-6 value for a HIS diagnosis type. */
export function dxMessageType(kind: DxKind, discharged: boolean): Dx["type"] {
  if (kind === "AD") return "A";
  if (kind === "DF") return "W";
  return discharged ? "F" : "W";
}

/** DG1-15 priority: 1 for the Principal diagnosis, 2 for the others. Older lists without types use the first place. */
export function dxPriority(list: Dx[], index: number): "1" | "2" {
  const typed = list.some((d) => d.kind);
  if (typed) return list[index]?.kind === "P" ? "1" : "2";
  return index === 0 ? "1" : "2";
}

/** Writes the type on every diagnosis (so older records stop depending on their place) and puts the Principal one first. */
export function normalizeDx(list: Dx[]): Dx[] {
  const typed = list.map((d, i) => ({ ...d, kind: dxKind(d, i) }));
  const p = typed.findIndex((d) => d.kind === "P");
  if (p <= 0) return typed;
  return [typed[p], ...typed.filter((_, i) => i !== p)];
}

export const principalCount = (list: Dx[]): number => list.filter((d, i) => dxKind(d, i) === "P").length;

/** What is wrong with the list as a whole. Empty when it follows the rules (an empty list is allowed). */
export function dxListProblems(list: Dx[]): string[] {
  if (!list.length) return [];
  const n = principalCount(list);
  if (n === 0) return ["One Principal diagnosis is mandatory."];
  if (n > 1) return ["Only one Principal diagnosis is allowed."];
  return [];
}

export interface DxDraft { code: string; text: string; kind: DxKind; onAdmission: boolean }

export interface DxSaveResult {
  list: Dx[];
  error?: string;
  /** Set when another diagnosis lost the Principal type to this one. */
  demoted?: string;
}

/**
 * Adds a diagnosis (index null) or changes one (its index in the active list). Choosing Principal when another
 * diagnosis is Principal makes that one Secondary, so there is never more than one.
 */
export function saveDx(
  current: Dx[],
  draft: DxDraft,
  index: number | null,
  ctx: { discharged: boolean; inpatient: boolean; by: string; at: string },
): DxSaveResult {
  const list = normalizeDx(current);
  if (!draft.code) return { list: current, error: "Pick a diagnosis code." };
  if (list.some((d, i) => i !== index && d.code === draft.code)) return { list: current, error: `${draft.code} is already in the list.` };
  const hasOtherPrincipal = list.some((d, i) => i !== index && d.kind === "P");
  if (draft.kind !== "P" && !hasOtherPrincipal) {
    return { list: current, error: "One Principal diagnosis is mandatory. Make this diagnosis Principal, or make another one Principal first." };
  }
  const prev = index === null ? undefined : list[index];
  const entry: Dx = {
    ...prev,
    code: draft.code,
    text: draft.text,
    kind: draft.kind,
    type: dxMessageType(draft.kind, ctx.discharged),
    onAdmission: draft.onAdmission,
    at: prev?.at ?? ctx.at,
    by: ctx.by,
  };
  // ZDG1-3: 2 = present on admission, 1 = arose during the stay. Only inpatient discharge updates send it.
  if (ctx.inpatient) entry.onset = draft.onAdmission ? "2" : "1";
  let demoted: string | undefined;
  let next = index === null ? [...list, entry] : list.map((d, i) => (i === index ? entry : d));
  if (draft.kind === "P") {
    next = next.map((d) => {
      if (d === entry || d.kind !== "P") return d;
      demoted = `${d.code} ${d.text}`;
      return { ...d, kind: "S" as const, type: dxMessageType("S", ctx.discharged) };
    });
  }
  return { list: normalizeDx(next), demoted };
}

/** Whether the diagnosis at `index` may be removed or set to Inactive. The Principal one goes last. */
export function canRetireDx(list: Dx[], index: number): string | null {
  if (dxKind(list[index], index) === "P" && list.length > 1) return "Make another diagnosis Principal before you remove or deactivate this one.";
  return null;
}

/** Moves an inactive diagnosis back to the active list. */
export function reactivateDx(active: Dx[], d: Dx, discharged: boolean): DxSaveResult {
  const list = normalizeDx(active);
  if (list.some((x) => x.code === d.code)) return { list: active, error: `${d.code} is already active.` };
  const hasPrincipal = list.some((x) => x.kind === "P");
  let kind: DxKind = d.kind ?? "S";
  if (!hasPrincipal) kind = "P";
  else if (kind === "P") kind = "S";
  return { list: normalizeDx([...list, { ...d, kind, type: dxMessageType(kind, discharged) }]) };
}

/* ---------- allergies ---------- */

export const groupCategory = (g: AllergenGroup): AllergyCategory => (g === "drug" ? "Medication" : g === "food" ? "Food" : "Environment");

/** AL1-2 allergy type for a category. */
export function al1Type(category: AllergyCategory | undefined, fallback: Allergy["type"] = "DALG"): NonNullable<Allergy["type"]> {
  if (category === "Medication") return "DALG";
  if (category === "Food") return "FALG";
  if (category === "Environment" || category === "Biologic") return "ALG";
  return fallback ?? "DALG";
}

/** Category of an older record, read from its AL1-2 type. */
export const categoryOf = (a: Allergy): AllergyCategory => a.category ?? (a.type === "FALG" ? "Food" : a.type === "ALG" ? "Environment" : "Medication");

const SEV_RANK = { MI: 1, MO: 2, SV: 3 } as const;

/** AL1-4 severity: the worst reaction (anaphylaxis is severe). Without a graded reaction, it follows the criticality. */
export function al1Severity(a: Pick<Allergy, "reactions" | "criticality" | "severity">): Allergy["severity"] {
  let worst: Allergy["severity"] | undefined;
  for (const r of a.reactions ?? []) {
    const s = r.anaphylaxis ? "SV" : r.severity;
    if (s && (!worst || SEV_RANK[s] > SEV_RANK[worst])) worst = s;
  }
  if (worst) return worst;
  if (a.criticality === "High") return "SV";
  if (a.criticality === "Low") return "MI";
  return a.severity ?? "MO";
}

/** AL1-5 reaction text: every manifestation once, with anaphylaxis named first. */
export function al1Reaction(a: Pick<Allergy, "reactions" | "reaction">): string {
  if (!a.reactions?.length) return a.reaction ?? "";
  const out: string[] = [];
  const add = (s: string) => { const t = s.trim(); if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t); };
  if (a.reactions.some((r) => r.anaphylaxis)) add("Anaphylaxis");
  for (const r of a.reactions) for (const m of r.manifestations) add(m);
  return out.join(", ");
}

/** An allergy that should warn staff: active record, clinically active, and not refuted or entered in error. */
export function isLiveAllergy(a: Allergy): boolean {
  if (a.active === false) return false;
  if (a.clinicalStatus && a.clinicalStatus !== "Active") return false;
  return a.verification !== "Refuted" && a.verification !== "Entered In Error";
}

/** Fills the message fields (AL1-2, AL1-4, AL1-5) from what the HIS records. */
export function finalizeAllergy(a: Allergy): Allergy {
  return { ...a, text: a.text.trim(), type: al1Type(a.category, a.type), severity: al1Severity(a), reaction: al1Reaction(a) };
}

/** Required fields of the allergy form, as in the HIS. */
export function allergyProblems(a: Allergy): string[] {
  const out: string[] = [];
  if (!a.text.trim()) out.push("Enter or pick the allergen.");
  if (!a.category) out.push("Choose the category.");
  if (!a.reactionType) out.push("Choose the type.");
  if (!a.clinicalStatus) out.push("Choose the clinical status.");
  if (!a.verification) out.push("Choose the verification status.");
  if (!a.criticality) out.push("Choose the criticality.");
  if (!a.source) out.push("Choose the source.");
  if ((a.reactions ?? []).some((r) => !r.manifestations.some((m) => m.trim()))) out.push("Each reaction needs at least one manifestation.");
  return out;
}

/** Puts a saved allergy in the list it belongs to: live allergies in `allergies`, the rest in `allergiesInactive`. */
export function placeAllergy(active: Allergy[], inactive: Allergy[], a: Allergy, replacing?: { list: "active" | "inactive"; index: number }) {
  const act = replacing?.list === "active" ? active.filter((_, i) => i !== replacing.index) : [...active];
  const ina = replacing?.list === "inactive" ? inactive.filter((_, i) => i !== replacing.index) : [...inactive];
  const done = finalizeAllergy(a);
  if (isLiveAllergy(done)) {
    const at = replacing?.list === "active" ? Math.min(replacing.index, act.length) : act.length;
    act.splice(at, 0, done);
  } else ina.push(done);
  return { allergies: act, allergiesInactive: ina };
}

/* ---------- patient header: payer ---------- */

export interface CoverageView {
  /** "Cash", or the payer name. */
  payer: string;
  /** Plan (class and network) of the insured patient. */
  plan?: string;
  /** Eligible or Not Eligible. Empty for cash patients. */
  eligible?: boolean;
  /** Where the answer came from, in words. */
  basis?: string;
}

/**
 * Payer, plan and eligibility for the chart header. A later NPHIES eligibility answer for the visit wins over the
 * coverage check made at registration. A cash visit, or no card on file, shows "Cash".
 */
export function coverageView(
  patient: Pick<Patient, "extra">,
  today: string,
  visitEligibility?: { status: "eligible" | "not-eligible" },
): CoverageView {
  const card = patient.extra?.insurance;
  if (!card || patient.extra?.visitPayType === "Cash") return { payer: "Cash" };
  const plan = [card.className, card.network].filter(Boolean).join(", ") || undefined;
  if (visitEligibility) return { payer: card.payer, plan, eligible: visitEligibility.status === "eligible", basis: "NPHIES eligibility check for this visit" };
  const o = coverageOutcome(card, today);
  return { payer: card.payer, plan, eligible: o.kind === "covered" || o.kind === "limit-exhausted", basis: `Registration check: ${o.title}` };
}

/* ---------- chief complaints ---------- */

export const COMPLAINT_MAX = 500;

export const complaintSystemLabel = (c: Complaint): string => (c.system === "ICD10AM" ? "ICD-10-AM" : "SNOMED CT");

/** The free-text rules of the HIS: codes or text, not both, and at most 500 characters of text. */
export function complaintProblems(codes: CodedTerm[], text: string): string[] {
  const t = text.trim();
  if (!codes.length && !t) return ["Select code(s) or enter free text."];
  if (codes.length && t) return ["You can either select code(s) or enter free text."];
  if (t.length > COMPLAINT_MAX) return [`Free text is limited to ${COMPLAINT_MAX} characters.`];
  return [];
}

/** The visit reason (PV2) as the active complaints in words. */
export const reasonFromComplaints = (list: Complaint[]): string => list.map((c) => c.text).join("; ");
