import { ageOf, formLines, vitalsLine, type AiContext } from "./context";
import { vitalFlags } from "./cds";

/** SOAP note draft built from the chart. Templates only. */

export interface SoapText {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  sources: string[];
}

const EXAM_FORMS: [string, string][] = [
  ["rehab-medical-examination", "Medical examination"],
  ["nursing-initial-assessment", "Nursing assessment"],
  ["pre-anesthesia-assessment", "Pre-anesthesia assessment"],
];

export function draftSoap(c: AiContext): SoapText {
  const e = c.enc;
  const sources: string[] = [];
  const age = ageOf(c.patient.dob, c.now);

  // Subjective
  const cc = e.complaints.map((x) => x.text);
  const s: string[] = [];
  if (cc.length) {
    s.push(`${age} year old ${c.patient.sex === "M" ? "man" : "woman"} presenting with ${cc.join(", ").toLowerCase()}.`);
    sources.push("Chief Complaints");
  } else if (e.reason) {
    s.push(`${age} year old ${c.patient.sex === "M" ? "man" : "woman"} presenting with: ${e.reason}.`);
    sources.push("Visit reason");
  } else s.push(`${age} year old ${c.patient.sex === "M" ? "man" : "woman"}. The presenting complaint is not recorded.`);
  const firstNote = e.notes[0];
  if (firstNote) {
    s.push(`History: ${firstNote.text}`);
    sources.push("Progress Notes");
  }
  s.push(e.allergies.length ? `Allergies: ${e.allergies.map((a) => `${a.text} (${a.reaction || "reaction not stated"})`).join(", ")}.` : "Allergies: none recorded.");
  if (e.allergies.length) sources.push("Allergies");

  // Objective
  const o: string[] = [`Vitals${e.vitals?.at ? ` (${e.vitals.at.replace("T", " ")})` : ""}: ${vitalsLine(e.vitals)}`];
  if (e.vitals) sources.push("Vitals");
  const abnormal = vitalFlags(c).filter((f) => f.level !== "info");
  if (abnormal.length) o.push(`Abnormal findings: ${abnormal.map((f) => f.text.replace(/\.$/, "")).join("; ")}.`);
  for (const [id, label] of EXAM_FORMS) {
    const lines = formLines(c, id);
    if (lines.length) {
      o.push(`${label}: ${lines.join("; ")}.`);
      sources.push(`Form: ${label}`);
    }
  }
  if (!e.vitals && o.length === 1) o.push("No examination findings are recorded yet.");

  // Assessment
  const a: string[] = [];
  if (e.dx.length) {
    a.push(...e.dx.map((d, i) => `${i + 1}. ${d.text} (${d.code})${d.type === "F" ? ", final" : d.type === "A" ? ", admitting" : ", working"}`));
    sources.push("Diagnosis");
  } else a.push("No diagnosis is recorded yet. The clinician should enter a working diagnosis.");

  // Plan
  const p: string[] = [];
  if (c.meds.length) {
    p.push(`Medicines: ${c.meds.map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ")).join("; ")}.`);
    sources.push("Prescriptions");
  }
  if (e.pr.length) {
    p.push(`Procedures: ${e.pr.map((x) => x.text).join(", ")}.`);
    sources.push("Procedures");
  }
  p.push("Investigations, follow-up and patient advice: the clinician to complete.");

  return { subjective: s.join("\n"), objective: o.join("\n"), assessment: a.join("\n"), plan: p.join("\n"), sources: [...new Set(sources)] };
}

export const soapAsText = (t: Pick<SoapText, "subjective" | "objective" | "assessment" | "plan">, name = "") =>
  `${name ? `SOAP note: ${name}\n` : ""}S (Subjective)\n${t.subjective}\n\nO (Objective)\n${t.objective}\n\nA (Assessment)\n${t.assessment}\n\nP (Plan)\n${t.plan}`;


/** Reads an edited SOAP text (the same layout soapAsText writes) back into its four parts. Falls back to the original when the headings were removed. */
export function parseSoapText(text: string, fallback: Pick<SoapText, "subjective" | "objective" | "assessment" | "plan">) {
  const m = /S \(Subjective\)\n([\s\S]*?)\n+O \(Objective\)\n([\s\S]*?)\n+A \(Assessment\)\n([\s\S]*?)\n+P \(Plan\)\n([\s\S]*)$/.exec(text.replace(/\r/g, ""));
  if (!m) return fallback;
  return { subjective: m[1].trim(), objective: m[2].trim(), assessment: m[3].trim(), plan: m[4].trim() };
}
