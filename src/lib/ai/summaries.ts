import { ageOf, fullName, vitalsLine, type AiContext } from "./context";
import { DISPOSITIONS } from "../reference-data";

/** Chart summary, discharge summary text and the documentation quality check. */

const cls = { I: "Inpatient", O: "Outpatient", E: "Emergency", P: "Pre-admit" } as const;

export function summariseChart(c: AiContext): { text: string; sources: string[] } {
  const e = c.enc;
  const p = c.patient;
  const lines: string[] = [];
  lines.push(`${fullName(p)}, ${ageOf(p.dob, c.now)} year old ${p.sex === "M" ? "man" : "woman"}, MRN ${p.mrn}.`);
  lines.push(`${cls[e.cls]} visit ${e.visitNumber}, ${e.status}${e.admitAt ? `, arrived ${e.admitAt.replace("T", " ")}` : ""}.`);
  if (e.complaints.length || e.reason) lines.push(`Reason: ${e.complaints.map((x) => x.text).join(", ") || e.reason}.`);
  lines.push(e.dx.length ? `Diagnoses: ${e.dx.map((d) => `${d.text} (${d.code})`).join("; ")}.` : "Diagnoses: none recorded.");
  lines.push(e.allergies.length ? `Allergies: ${e.allergies.map((a) => a.text).join(", ")}.` : "Allergies: none recorded.");
  lines.push(`Vitals: ${vitalsLine(e.vitals)}`);
  if (c.meds.length) lines.push(`Medicines: ${c.meds.map((m) => m.name).join(", ")}.`);
  if (e.pr.length) lines.push(`Procedures: ${e.pr.map((x) => x.text).join(", ")}.`);
  if (e.notes.length) lines.push(`Latest note (${e.notes[e.notes.length - 1].author}): ${e.notes[e.notes.length - 1].text}`);
  if (c.soap.length) lines.push(`${c.soap.length} SOAP note${c.soap.length === 1 ? "" : "s"} on file.`);
  return { text: lines.join("\n"), sources: ["Visit", "Chief Complaints", "Diagnosis", "Allergies", "Vitals", "Prescriptions", "Procedures", "Progress Notes"] };
}

export function draftDischargeSummary(c: AiContext): { text: string; sources: string[] } {
  const e = c.enc;
  const p = c.patient;
  const los = e.admitAt && e.dischargeAt ? Math.max(0, Math.round((new Date(e.dischargeAt).getTime() - new Date(e.admitAt).getTime()) / 86_400_000)) : undefined;
  const disp = DISPOSITIONS.find((d) => d.code === e.disposition)?.label;
  const t: string[] = [];
  t.push("DISCHARGE SUMMARY");
  t.push(`Patient: ${fullName(p)}   MRN: ${p.mrn}   Age/Sex: ${ageOf(p.dob, c.now)} / ${p.sex}`);
  t.push(`Visit: ${e.visitNumber}   Admitted: ${e.admitAt?.replace("T", " ") ?? "not recorded"}   Discharged: ${e.dischargeAt?.replace("T", " ") ?? "not yet"}${los !== undefined ? `   Stay: ${los} day${los === 1 ? "" : "s"}` : ""}`);
  t.push("");
  t.push("Presenting complaint");
  t.push(e.complaints.map((x) => x.text).join(", ") || e.reason || "Not recorded.");
  t.push("");
  t.push("Diagnoses");
  t.push(e.dx.length ? e.dx.map((d) => `- ${d.text} (${d.code}), ${d.type === "F" ? "final" : d.type === "A" ? "admitting" : "working"}`).join("\n") : "- None recorded.");
  if (e.pr.length) {
    t.push("");
    t.push("Procedures");
    t.push(e.pr.map((x) => `- ${x.text} (${x.code})`).join("\n"));
  }
  t.push("");
  t.push("Hospital course");
  t.push(e.notes.length ? e.notes.map((n) => `- ${n.at.replace("T", " ")} ${n.author}: ${n.text}`).join("\n") : "- No progress notes recorded.");
  t.push("");
  t.push("Condition at discharge");
  t.push(vitalsLine(e.vitals));
  t.push("");
  t.push("Allergies");
  t.push(e.allergies.length ? e.allergies.map((a) => `- ${a.text}: ${a.reaction || "reaction not stated"}`).join("\n") : "- None recorded.");
  t.push("");
  t.push("Medicines");
  t.push(c.meds.length ? c.meds.map((m) => `- ${[m.name, m.dose, m.frequency].filter(Boolean).join(", ")}`).join("\n") : "- None recorded.");
  t.push("");
  t.push(`Disposition: ${disp ?? "not chosen"}`);
  t.push("Follow-up and advice: the clinician to complete.");
  return { text: t.join("\n"), sources: ["Visit", "Chief Complaints", "Diagnosis", "Procedures", "Progress Notes", "Vitals", "Allergies", "Prescriptions", "Disposition"] };
}

export interface QualityIssue {
  level: "high" | "medium" | "info";
  text: string;
  fix: string;
}

export function qualityCheck(c: AiContext): QualityIssue[] {
  const e = c.enc;
  const out: QualityIssue[] = [];
  const add = (cond: boolean, level: QualityIssue["level"], text: string, fix: string) => cond && out.push({ level, text, fix });
  add(e.allergies.length === 0, "medium", "Allergies are not recorded.", "Open Allergies. Add each allergy, or record that there are none known.");
  add(e.dx.length === 0, "high", "There is no primary diagnosis.", "Open Diagnosis and add one. Discharge and clinical documents need it.");
  add(e.dx.length > 0 && !e.dx.some((d) => d.type === "F") && e.status !== "active", "medium", "No final diagnosis is set.", "Mark the diagnosis as final in Diagnosis.");
  const procDate = !!e.dischargeAt || c.forms("operation-request").some((r) => !!r.values.preferredDate);
  add(e.pr.length > 0 && !procDate, "medium", "Procedures have no date.", "Add the date on the Operation Request form, or discharge the visit. The procedure segment needs a date.");
  add(e.complaints.length === 0 && !e.reason, "medium", "No chief complaint or visit reason.", "Open Chief Complaints and add one.");
  add(!e.vitals, "medium", "No vital signs are recorded.", "Open Vitals and enter the latest set.");
  add(e.notes.length === 0 && c.soap.length === 0, "info", "There is no progress note or SOAP note.", "Write a note in Progress Notes or SOAP Notes.");
  add(c.soap.some((s) => s.status === "draft"), "info", "A SOAP note is still a draft.", "Open SOAP Notes and co-sign it.");
  add(e.status === "discharged" && !e.disposition, "medium", "The discharge has no disposition.", "Send an update (A08) after choosing where the patient went.");
  add(e.dirty === true, "info", "The chart changed after the last ADT update was sent.", "Press Send Update on the chart.");
  const coded = e.complaints.filter((x) => !x.code);
  add(coded.length > 0, "info", `${coded.length} complaint${coded.length === 1 ? " has" : "s have"} no SNOMED CT code.`, "Pick the complaint from the coded list.");
  const missing = e.dx.filter((d) => !d.code);
  add(missing.length > 0, "high", "A diagnosis has no code.", "Add an ICD-10-AM code.");
  return out;
}
