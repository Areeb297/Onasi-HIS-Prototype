import type { Dx } from "../model";
import { deliveredAt, dispositionLabel, dump, humanize, isStillbirth, latest, noKnownAllergies, pick, procedureDate } from "./chartdata";
import { allergyEntry, deliveryModeCode, deliveryProcedureEntry, medicationEntry, noProblemEntry, OBS_TIDS, problemEntry, simpleObs, surgeryEntry, vitalsEntry, vitalsList } from "./entries";
import { DOC_SPECS, SECTIONS } from "./docspec";
import type { Block, DocInput, MedLine, SectionOut, Usage } from "./types";

/** Fills each section from the chart. A section with nothing to say gets hasData = false. */

interface Part {
  blocks: Block[];
  entries?: string[];
  sources: string[];
  has?: boolean;
}

const p = (text: string): Block => ({ kind: "p", text });
const list = (items: (string | { id?: string; text: string })[]): Block => ({ kind: "list", items: items.map((t) => (typeof t === "string" ? { text: t } : t)) });
const NONE: Part = { blocks: [p("No information available.")], sources: [], has: false };
const text = (t: string, sources: string[]): Part => (t.trim() ? { blocks: [p(t.trim())], sources } : NONE);

const dxLabel = (d: Dx) => `${d.text} (${d.code})`;
const when = (s?: string) => (s ? s.replace("T", " ") : "");

/** Diagnoses as a list plus one Problem Concern Entry each. */
function dxPart(i: DocInput, dxs: Dx[], prefix: string, sources: string[], lead?: string): Part {
  const intro = lead ? [p(lead)] : [];
  if (!dxs.length) return lead ? { blocks: intro, sources, has: false } : NONE;
  const start = i.enc.admitAt ?? i.enc.expectedAdmitAt;
  const active = i.enc.status === "active";
  return {
    blocks: [...intro, list(dxs.map((d, n) => ({ id: `${prefix}-${n + 1}`, text: dxLabel(d) })))],
    entries: dxs.map((d, n) => problemEntry(`${i.docId}:${prefix}:${n}`, d, `${prefix}-${n + 1}`, start, i.enc.dischargeAt, active)),
    sources,
  };
}

/** A medication table with one Medications Entry per row. INT is an open prescription, EVN a medicine that was given. */
function medsTable(i: DocInput, m: MedLine[], prefix: string, mood: "INT" | "EVN", sources: string[]): Part {
  if (!m.length) return NONE;
  const id = (n: number, part = "") => `${prefix}-${n + 1}${part}`;
  return {
    blocks: [{
      kind: "table",
      head: ["Medicine", "Code", "Dose form", "Dose", "Route", "Frequency", "Instructions"],
      rows: m.map((x) => [x.name, x.code ?? "Not coded", x.formName ?? "Not recorded", x.dose ?? "", x.route ?? "", x.frequency ?? "", x.instruction || "As directed"]),
      ids: m.map((_, n) => [id(n), id(n, "-code"), id(n, "-form"), undefined, undefined, undefined, id(n, "-inst")]),
    }],
    entries: m.map((x, n) => medicationEntry(`${i.docId}:${prefix}:${n}`, x, mood, { row: id(n), code: id(n, "-code"), form: id(n, "-form"), instruct: id(n, "-inst") })),
    sources,
  };
}
const rxMeds = (prefix: string, mood: "INT" | "EVN") => (i: DocInput): Part => medsTable(i, i.medications ?? [], prefix, mood, ["Prescriptions for this visit"]);

function surgeriesPart(i: DocInput, prefix = "sx"): Part {
  const prs = i.enc.pr;
  if (!prs.length) return NONE;
  const date = procedureDate(i);
  return {
    blocks: [{ kind: "table", head: ["Procedure", "Code", "Date"], rows: prs.map((x) => [x.text, x.code, date]), ids: prs.map((_, n) => [`${prefix}-${n + 1}`]) }],
    entries: prs.map((x, n) => surgeryEntry(`${i.docId}:${prefix}:${n}`, x, `${prefix}-${n + 1}`, date)),
    sources: ["Encounter.pr", "Operation Request date"],
  };
}

const BUILDERS: Record<string, (i: DocInput) => Part> = {
  chief: (i) => {
    const c = i.enc.complaints;
    if (c.length) return { blocks: [list(c.map((x) => (x.code ? `${x.text} (SNOMED CT ${x.code})` : x.text)))], sources: ["Encounter.complaints"] };
    return text(i.enc.reason, ["Encounter.reason"]);
  },
  referral: (i) => {
    const prim = i.enc.dx.slice(0, 1);
    // Entries here are "required if known", so a visit with no diagnosis sends the reason as text only.
    if (!prim.length) return text(i.enc.reason, ["Encounter.reason"]);
    return dxPart(i, prim, "ref", ["Encounter.dx (first)"], `Reason for the visit: ${i.enc.reason || "not entered"}.`);
  },
  hpi: (i) => text(i.soap?.find((s) => s.subjective)?.subjective ?? i.enc.notes[0]?.text ?? i.enc.reason, ["SOAP subjective", "Progress notes", "Encounter.reason"]),
  admitdx: (i) => {
    const a = i.enc.dx.filter((d) => d.type === "A");
    return dxPart(i, a.length ? a : i.enc.dx.slice(0, 1), "adm", ["Encounter.dx (admitting)"]);
  },
  problems: (i) => {
    const rest = i.enc.dx.slice(1);
    if (!i.enc.dx.length) return NONE;
    if (rest.length) return dxPart(i, rest, "prob", ["Encounter.dx (after the first)"]);
    // The section needs at least one entry. With only a principal diagnosis on the visit, the entry
    // "No current problems or disability" (SNOMED CT 160245001) is written, as the Problem Entry page says.
    return {
      blocks: [list([{ id: "prob-none", text: "No active problems other than the principal diagnosis." }])],
      entries: [noProblemEntry(`${i.docId}:prob:none`, "prob-none")],
      sources: ["Encounter.dx"],
    };
  },
  dcdx: (i) => {
    const f = i.enc.dx.filter((d) => d.type === "F");
    return dxPart(i, f.length ? f : i.enc.dx, "dcdx", ["Encounter.dx (final)"]);
  },
  allergies: (i) => {
    const a = i.enc.allergies;
    const start = i.enc.admitAt ?? i.enc.expectedAdmitAt;
    if (!a.length) {
      // "None known" is only stated when a nurse ticked it. An empty list alone means nobody recorded the answer.
      if (!noKnownAllergies(i)) return NONE;
      return {
        blocks: [list([{ id: "al-none", text: "No known allergies." }])],
        entries: [allergyEntry(`${i.docId}:al:none`, null, "al-none", start)],
        sources: ["Nursing Initial Assessment: no known allergies"],
      };
    }
    return {
      blocks: [{ kind: "table", head: ["Substance", "Severity", "Reaction"], rows: a.map((x) => [x.text, { SV: "Severe", MO: "Moderate", MI: "Mild" }[x.severity], x.reaction]), ids: a.map((_, n) => [`al-${n + 1}`]) }],
      entries: a.map((x, n) => allergyEntry(`${i.docId}:al:${n}`, x, `al-${n + 1}`, start)),
      sources: ["Encounter.allergies"],
    };
  },
  meds: rxMeds("med", "INT"),
  admedhx: (i) => {
    // Medicines the patient was taking before admission. The chart holds them as free text on the pre-anesthesia form.
    const raw = pick(latest(i, "pre-anesthesia-assessment"), ["medications"]);
    const lines = raw.split(/[\n;,]+/).map((s) => s.trim()).filter(Boolean);
    return medsTable(i, lines.map((name) => ({ name })), "medadm", "EVN", ["Pre-Anesthesia Assessment: current medicines"]);
  },
  medsgiven: rxMeds("medgiven", "EVN"),
  dcmeds: rxMeds("meddc", "INT"),
  surgeries: (i) => surgeriesPart(i),
  drains: () => NONE,
  devices: () => NONE,
  immun: () => NONE,
  bloodgroup: () => NONE,
  transfusion: () => NONE,
  screening: () => NONE,
  vitals: (i) => {
    const v = i.enc.vitals;
    if (!v || !vitalsList(v).length) return NONE;
    const vs = vitalsList(v);
    return {
      blocks: [{ kind: "table", head: ["Measurement", "Value", "Unit"], rows: vs.map((x) => [x.name, String(x.value), x.unit]), ids: vs.map((x) => [`vs-${x.ref}`]) }, p(`Measured ${when(v.at)}.`)],
      entries: [vitalsEntry(`${i.docId}:vs`, v, v.at)],
      sources: ["Encounter.vitals"],
    };
  },
  exam: (i) => text(i.soap?.find((s) => s.objective)?.objective ?? "", ["SOAP objective"]),
  careplan: (i) => {
    const plan = (i.soap ?? []).map((s) => s.plan).filter(Boolean);
    const tp = i.forms("treatment-plan").flatMap((r) => dump(r));
    const all = [...plan, ...tp];
    return all.length ? { blocks: [list(all)], sources: ["SOAP plan", "Treatment Plan form"] } : NONE;
  },
  assessplan: (i) => {
    const s = (i.soap ?? []).filter((x) => x.assessment || x.plan);
    if (!s.length) return NONE;
    return { blocks: s.flatMap((x) => [x.assessment && p(`Assessment: ${x.assessment}`), x.plan && p(`Plan: ${x.plan}`)].filter((b): b is Block => !!b)), sources: ["SOAP assessment and plan"] };
  },
  course: (i) => {
    const n = i.enc.notes;
    return n.length ? { blocks: [list(n.map((x) => `${when(x.at)} ${x.author}: ${x.text}`))], sources: ["Progress notes"] } : NONE;
  },
  disposition: (i) => text(dispositionLabel(i.enc.disposition), ["Encounter.disposition"]),

  /* ----- maternal and newborn ----- */
  pregnancy: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const ga = pick(r, ["gestationalAge"]);
    // The delivery record describes one baby, so the one pregnancy fact the chart can state in coded form is "not a multiple pregnancy".
    return {
      blocks: [
        p(ga ? `Current pregnancy delivered at ${ga} weeks. Earlier pregnancies are not recorded in the chart.` : "Earlier pregnancies are not recorded in the chart."),
        list([{ id: "pg-1", text: "Multiple pregnancy: no (one baby recorded for this delivery)." }]),
      ],
      entries: [simpleObs(`${i.docId}:pg:1`, OBS_TIDS.pregnancy, "45371-2", "MULTIPLE PREGNANCY", { type: "BL", v: false }, "pg-1", deliveredAt(i))],
      sources: ["Delivery Outcomes: gestationalAge"],
    };
  },
  labor: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const keys = (["deliveredAt", "mode", "presentation", "anesthesia", "episiotomy"] as const).filter((k) => pick(r, [k]));
    if (!keys.length) return NONE;
    const mode = pick(r, ["mode"]);
    return {
      blocks: [{ kind: "table", head: ["Item", "Value"], rows: keys.map((k) => [humanize(k), pick(r, [k])]), ids: keys.map((k) => (k === "mode" ? [undefined, "ld-mode"] : [])) }],
      // Exactly one procedure entry records the mode of delivery.
      entries: mode ? [deliveryProcedureEntry(`${i.docId}:ld`, mode, "ld-mode", deliveredAt(i))] : [],
      sources: ["Delivery Outcomes"],
    };
  },
  delivery: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const still = isStillbirth(i);
    const status = pick(r, ["birthStatus"]);
    const comp = pick(r, ["complications"]);
    const at = deliveredAt(i);
    // Both counts are always sent: one baby per delivery record, so one of them is 1 and the other 0.
    const entries = [
      simpleObs(`${i.docId}:live`, OBS_TIDS.live, "11636-8", "Live Births", { type: "INT", v: still ? 0 : 1 }, "dl-live", at),
      simpleObs(`${i.docId}:still`, OBS_TIDS.still, "57062-2", "Stillborn Births", { type: "INT", v: still ? 1 : 0 }, "dl-still", at),
    ];
    const blocks: Block[] = [
      p(status ? `Birth status: ${status}.` : "Birth status not recorded."),
      list([{ id: "dl-live", text: `Live births: ${still ? 0 : 1}` }, { id: "dl-still", text: `Stillbirths: ${still ? 1 : 0}` }]),
      p(`Mother's complications: ${comp || "none recorded"}.`),
    ];
    return { blocks, entries, sources: ["Delivery Outcomes: birthStatus, complications"] };
  },
  newbornstatus: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const at = deliveredAt(i);
    const ball = latest(i, "newborn-ballard-score");
    const ga = pick(ball, ["estimatedGa"]) || pick(r, ["gestationalAge"]);
    // Apgar LOINC codes: see the assumption note. 1, 5 and 10 minutes are all asked for.
    const apgar = [
      { key: "apgar1", label: "Apgar at 1 minute", code: "9272-6", name: "1 minute Apgar Score", id: "nb-ap1" },
      { key: "apgar5", label: "Apgar at 5 minutes", code: "9274-2", name: "5 minute Apgar Score", id: "nb-ap5" },
      { key: "apgar10", label: "Apgar at 10 minutes", code: "9271-8", name: "10 minute Apgar Score", id: "nb-ap10" },
    ].map((a) => ({ ...a, v: pick(r, [a.key]) })).filter((a) => a.v !== "" && !Number.isNaN(+a.v));
    const rows: { cells: string[]; id?: string }[] = [];
    const add = (label: string, v: string | false, id?: string) => { if (v) rows.push({ cells: [label, v], id }); };
    add("Birth weight", pick(r, ["birthWeight"]) && `${pick(r, ["birthWeight"])} g`);
    add("Sex", pick(r, ["sex"]));
    apgar.forEach((a) => add(a.label, a.v, a.id));
    add("Gestational age", ga && `${ga} weeks`, "nb-ga");
    add("Baby went to", pick(r, ["babyDisposition"]));
    if (!rows.length) return NONE;
    const entries = apgar.map((a) => simpleObs(`${i.docId}:${a.key}`, OBS_TIDS.apgar, a.code, a.name, { type: "INT", v: +a.v }, a.id, at));
    if (ga && !Number.isNaN(+ga)) entries.push(simpleObs(`${i.docId}:ga`, OBS_TIDS.ga, "49051-6", "Gestational Age", { type: "PQ", v: +ga, unit: "wk" }, "nb-ga", at));
    return {
      blocks: [{ kind: "table", head: ["Item", "Value"], rows: rows.map((x) => x.cells), ids: rows.map((x) => [undefined, x.id]) }],
      entries,
      sources: ["Delivery Outcomes", "Newborn Ballard Score"],
    };
  },

  /* ----- operative note ----- */
  preop: (i) => {
    const t = pick(latest(i, "operation-request"), ["preopDiagnosis"]);
    // The surgeon's wording goes in as text; the coded entry is the first diagnosis of the visit.
    return dxPart(i, i.enc.dx.slice(0, 1), "pre", t ? ["Operation Request: preopDiagnosis", "Encounter.dx (first)"] : ["Encounter.dx (first)"], t || undefined);
  },
  postproc: (i) => {
    const f = i.enc.dx.filter((d) => d.type === "F");
    return f.length ? dxPart(i, f, "ppd", ["Encounter.dx (final)"]) : NONE;
  },
  postop: (i) => dxPart(i, i.enc.dx, "pod", ["Encounter.dx"]),
  procdone: (i) => {
    const all = i.enc.pr;
    const sel = i.procIndex !== undefined && i.procIndex >= 0 ? all.slice(i.procIndex, i.procIndex + 1) : all;
    if (!sel.length) return text(pick(latest(i, "operation-request"), ["procedure"]), ["Operation Request: procedure"]);
    const date = procedureDate(i);
    return {
      blocks: [{ kind: "table", head: ["Procedure", "Code", "Date"], rows: sel.map((x) => [x.text, x.code, date]), ids: sel.map((_, n) => [`op-${n + 1}`]) }],
      entries: sel.map((x, n) => surgeryEntry(`${i.docId}:op:${n}`, x, `op-${n + 1}`, date)),
      sources: ["Encounter.pr", "Operation Request date"],
    };
  },
  planned: (i) => {
    const r = latest(i, "operation-request");
    const proc = pick(r, ["procedure"]) || pick(latest(i, "pre-anesthesia-assessment"), ["plannedProcedure"]);
    if (!proc) return NONE;
    return { blocks: [p(`${proc}. Priority: ${pick(r, ["urgency"]) || "not recorded"}.`)], sources: ["Operation Request"] };
  },
  anesthesia: (i) => {
    const t = pick(latest(i, "pre-anesthesia-assessment"), ["plannedAnesthesia"]) || pick(latest(i, "operation-request"), ["anesthesiaType"]);
    return text(t, ["Pre-Anesthesia Assessment", "Operation Request"]);
  },
  acuity: (i) => {
    const r = latest(i, "pre-anesthesia-assessment");
    const asa = pick(r, ["asa"]);
    return asa ? { blocks: [p(`ASA physical status ${asa}.`)], sources: ["Pre-Anesthesia Assessment: asa"] } : NONE;
  },
  findings: (i) => {
    const t = pick(latest(i, "operation-request"), ["opFindings"]);
    if (t) return text(t, ["Surgery Case: operative note findings"]);
    return text(i.enc.notes.filter((n) => /find/i.test(n.text)).map((n) => n.text).join(" "), ["Progress notes"]);
  },
  procdesc: (i) => {
    const r = latest(i, "operation-request");
    const ins = pick(r, ["instructions"]);
    const notes = i.enc.notes.map((n) => n.text).join(" ");
    return text([ins, notes].filter(Boolean).join(" "), ["Operation Request: instructions", "Progress notes"]);
  },
  specimens: (i) => text(pick(latest(i, "operation-request"), ["specimens"]), ["Surgery Case: operative note specimens"]),
  complications: (i) => text(pick(latest(i, "operation-request"), ["complications"]), ["Surgery Case: operative note complications"]),
  ebl: (i) => {
    const ml = pick(latest(i, "operation-request"), ["bloodLossMl"]);
    return ml ? text(`${ml} mL`, ["Surgery Case: operative note blood loss"]) : NONE;
  },
  fluids: () => NONE,
  procdisp: (i) => text(dispositionLabel(i.enc.disposition) || (i.enc.status === "discharged" ? "Discharged" : ""), ["Encounter.disposition"]),
};

export function buildSections(i: DocInput): SectionOut[] {
  const spec = DOC_SPECS[i.type];
  const out: SectionOut[] = [];
  for (const [key, usage] of spec.plan) {
    const s = SECTIONS[key];
    const part = (BUILDERS[key] ?? (() => NONE))(i);
    const has = part.has !== false && part.blocks.length > 0 && !(part.blocks.length === 1 && part.blocks[0].kind === "p" && part.blocks[0].text === "No information available.");
    const entries = part.entries ?? [];
    // The IHE procedure-list template id on List of Surgeries is only allowed when procedure entries are present (page 15893106).
    const templateIds = s.tidsWithEntries && !entries.length ? s.tids.filter((t) => !s.tidsWithEntries?.includes(t)) : s.tids;
    out.push({ key, templateIds, loinc: s.loinc, loincName: s.loincName, title: s.title, usage: usage as Usage, blocks: part.blocks, entries, hasData: has, sources: part.sources });
  }
  return out;
}

/** R2 and O sections with no data are left out of the document. R sections stay, with "No information available". */
export const included = (s: SectionOut): boolean => s.hasData || s.usage === "R";
