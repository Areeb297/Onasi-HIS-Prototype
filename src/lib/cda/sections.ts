import type { Dx } from "../model";
import { dispositionLabel, dump, humanize, isStillbirth, latest, pick, procedureDate } from "./chartdata";
import { allergyEntry, DELIVERY_TIDS, problemEntry, simpleObs, surgeryEntry, vitalsEntry, vitalsList } from "./entries";
import { DOC_SPECS, SECTIONS } from "./docspec";
import type { Block, DocInput, SectionOut, Usage } from "./types";

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
const lines = (arr: string[]) => (arr.length ? list(arr) : p("No information available."));
const text = (t: string, sources: string[]): Part => (t.trim() ? { blocks: [p(t.trim())], sources } : NONE);

const dxLabel = (d: Dx) => `${d.text} (${d.code})`;
const when = (s?: string) => (s ? s.replace("T", " ") : "");

function dxPart(i: DocInput, dxs: Dx[], prefix: string, sources: string[]): Part {
  if (!dxs.length) return NONE;
  const start = i.enc.admitAt ?? i.enc.expectedAdmitAt;
  const active = i.enc.status === "active";
  return {
    blocks: [list(dxs.map((d, n) => ({ id: `${prefix}-${n + 1}`, text: dxLabel(d) })))],
    entries: dxs.map((d, n) => problemEntry(`${i.docId}:${prefix}:${n}`, d, `${prefix}-${n + 1}`, start, active ? undefined : i.enc.dischargeAt, active)),
    sources,
  };
}

function medsPart(i: DocInput): Part {
  const m = i.medications ?? [];
  if (!m.length) return NONE;
  return {
    blocks: [{ kind: "table", head: ["Medicine", "Dose", "Route", "Frequency"], rows: m.map((x) => [x.name, x.dose ?? "", x.route ?? "", x.frequency ?? ""]) }],
    sources: ["Prescriptions for this visit"],
  };
}

function surgeriesPart(i: DocInput): Part {
  const prs = i.enc.pr;
  if (!prs.length) return NONE;
  const date = procedureDate(i);
  return {
    blocks: [{ kind: "table", head: ["Procedure", "Code", "Date"], rows: prs.map((x, n) => [x.text, x.code, date]) }],
    entries: prs.map((x, n) => surgeryEntry(`${i.docId}:sx:${n}`, x, `sx-${n + 1}`, date)),
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
    const part = dxPart(i, prim, "ref", ["Encounter.dx (first)"]);
    return part.has === false ? text(i.enc.reason, ["Encounter.reason"]) : { ...part, blocks: [p(`Reason for the visit: ${i.enc.reason || "not entered"}.`), ...part.blocks] };
  },
  hpi: (i) => text(i.soap?.find((s) => s.subjective)?.subjective ?? i.enc.notes[0]?.text ?? i.enc.reason, ["SOAP subjective", "Progress notes", "Encounter.reason"]),
  admitdx: (i) => {
    const a = i.enc.dx.filter((d) => d.type === "A");
    return dxPart(i, a.length ? a : i.enc.dx.slice(0, 1), "adm", ["Encounter.dx (admitting)"]);
  },
  problems: (i) => {
    const rest = i.enc.dx.slice(1);
    if (!i.enc.dx.length) return NONE;
    if (!rest.length) return { blocks: [p("No active problems other than the principal diagnosis.")], sources: ["Encounter.dx"] };
    return dxPart(i, rest, "prob", ["Encounter.dx (after the first)"]);
  },
  dcdx: (i) => {
    const f = i.enc.dx.filter((d) => d.type === "F");
    return dxPart(i, f.length ? f : i.enc.dx, "dcdx", ["Encounter.dx (final)"]);
  },
  allergies: (i) => {
    const a = i.enc.allergies;
    if (!a.length) return NONE;
    const start = i.enc.admitAt ?? i.enc.expectedAdmitAt;
    return {
      blocks: [{ kind: "table", head: ["Substance", "Severity", "Reaction"], rows: a.map((x) => [x.text, { SV: "Severe", MO: "Moderate", MI: "Mild" }[x.severity], x.reaction]) }],
      entries: a.map((x, n) => allergyEntry(`${i.docId}:al:${n}`, x, `al-${n + 1}`, start)),
      sources: ["Encounter.allergies"],
    };
  },
  meds: medsPart,
  admedhx: () => NONE,
  medsgiven: medsPart,
  dcmeds: medsPart,
  surgeries: surgeriesPart,
  drains: () => NONE,
  devices: () => NONE,
  immun: () => NONE,
  bloodgroup: () => NONE,
  transfusion: () => NONE,
  screening: () => NONE,
  vitals: (i) => {
    const v = i.enc.vitals;
    if (!v || !vitalsList(v).length) return NONE;
    const rows = vitalsList(v).map((x) => [x.name, String(x.value), x.unit]);
    return {
      blocks: [{ kind: "table", head: ["Measurement", "Value", "Unit"], rows }, p(`Measured ${when(v.at)}.`)],
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
    const ga = pick(latest(i, "delivery-outcomes"), ["gestationalAge"]);
    return ga ? { blocks: [p(`Current pregnancy delivered at ${ga} weeks. Earlier pregnancies are not recorded in the chart.`)], sources: ["Delivery Outcomes: gestationalAge"] } : NONE;
  },
  labor: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const rows = (["deliveredAt", "mode", "presentation", "anesthesia", "episiotomy"] as const)
      .map((k) => [humanize(k), pick(r, [k])])
      .filter(([, v]) => v);
    return rows.length ? { blocks: [{ kind: "table", head: ["Item", "Value"], rows }], sources: ["Delivery Outcomes"] } : NONE;
  },
  delivery: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const still = isStillbirth(i);
    const status = pick(r, ["birthStatus"]);
    const comp = pick(r, ["complications"]);
    const entries = [
      still
        ? simpleObs(`${i.docId}:still`, DELIVERY_TIDS.still, "57062-2", "Stillborn Births", { type: "INT", v: 1 }, "dl-1")
        : simpleObs(`${i.docId}:live`, DELIVERY_TIDS.live, "11636-8", "Live Births", { type: "INT", v: 1 }, "dl-1"),
    ];
    const blocks: Block[] = [list([{ id: "dl-1", text: status ? `Birth status: ${status}` : "Birth status not recorded" }]), p(`Mother's complications: ${comp || "none recorded"}.`)];
    return { blocks, entries, sources: ["Delivery Outcomes: birthStatus, complications"] };
  },
  newbornstatus: (i) => {
    const r = latest(i, "delivery-outcomes");
    if (!r) return NONE;
    const a1 = pick(r, ["apgar1"]);
    const a5 = pick(r, ["apgar5"]);
    const ball = latest(i, "newborn-ballard-score");
    const ga = pick(ball, ["estimatedGa"]) || pick(r, ["gestationalAge"]);
    const rows = [
      ["Birth weight", pick(r, ["birthWeight"]) && `${pick(r, ["birthWeight"])} g`],
      ["Sex", pick(r, ["sex"])],
      ["Apgar at 1 minute", a1],
      ["Apgar at 5 minutes", a5],
      ["Gestational age", ga && `${ga} weeks`],
      ["Baby went to", pick(r, ["babyDisposition"])],
    ].filter(([, v]) => v) as string[][];
    const entries: string[] = [];
    if (a1 !== "" && !Number.isNaN(+a1)) entries.push(simpleObs(`${i.docId}:ap1`, DELIVERY_TIDS.apgar, "9272-6", "1 minute Apgar Score", { type: "INT", v: +a1 }, "nb-ap1", ["1.3.6.1.4.1.19376.1.5.3.1.4.13"]));
    if (a5 !== "" && !Number.isNaN(+a5)) entries.push(simpleObs(`${i.docId}:ap5`, DELIVERY_TIDS.apgar, "9274-2", "5 minute Apgar Score", { type: "INT", v: +a5 }, "nb-ap5", ["1.3.6.1.4.1.19376.1.5.3.1.4.13"]));
    if (ga && !Number.isNaN(+ga)) entries.push(simpleObs(`${i.docId}:ga`, DELIVERY_TIDS.ga, "49051-6", "Gestational Age", { type: "PQ", v: +ga, unit: "wk" }, "nb-ga"));
    return rows.length ? { blocks: [{ kind: "table", head: ["Item", "Value"], rows }], entries, sources: ["Delivery Outcomes", "Newborn Ballard Score"] } : NONE;
  },

  /* ----- operative note ----- */
  preop: (i) => {
    const r = latest(i, "operation-request");
    const t = pick(r, ["preopDiagnosis"]);
    if (t) return { blocks: [p(t)], sources: ["Operation Request: preopDiagnosis"] };
    return dxPart(i, i.enc.dx.slice(0, 1), "pre", ["Encounter.dx (first)"]);
  },
  postproc: (i) => dxPart(i, i.enc.dx.filter((d) => d.type === "F"), "ppd", ["Encounter.dx (final)"]),
  postop: (i) => dxPart(i, i.enc.dx, "pod", ["Encounter.dx"]),
  procdone: (i) => {
    const all = i.enc.pr;
    const sel = i.procIndex !== undefined && i.procIndex >= 0 ? all.slice(i.procIndex, i.procIndex + 1) : all;
    if (!sel.length) return text(pick(latest(i, "operation-request"), ["procedure"]), ["Operation Request: procedure"]);
    const date = procedureDate(i);
    return {
      blocks: [{ kind: "table", head: ["Procedure", "Code", "Date"], rows: sel.map((x) => [x.text, x.code, date]) }],
      entries: sel.map((x, n) => surgeryEntry(`${i.docId}:op:${n}`, x, `sx-${n + 1}`, date)),
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
  findings: (i) => text(i.enc.notes.filter((n) => /find/i.test(n.text)).map((n) => n.text).join(" "), ["Progress notes"]),
  procdesc: (i) => {
    const r = latest(i, "operation-request");
    const ins = pick(r, ["instructions"]);
    const notes = i.enc.notes.map((n) => n.text).join(" ");
    return text([ins, notes].filter(Boolean).join(" "), ["Operation Request: instructions", "Progress notes"]);
  },
  specimens: () => NONE,
  complications: () => NONE,
  ebl: () => NONE,
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
    out.push({
      key, templateIds: s.tids, loinc: s.loinc, loincName: s.loincName, title: s.title, usage: usage as Usage,
      blocks: part.blocks, entries: part.entries ?? [], hasData: has, sources: part.sources,
    });
  }
  return out;
}

/** R2 and O sections with no data are left out of the document. R sections stay, with "No information available". */
export const included = (s: SectionOut): boolean => s.hasData || s.usage === "R";

