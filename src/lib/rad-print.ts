import { attachmentsOf, fmtSize, markReportPrinted } from "./rad-extras";
import type { RadOrder } from "./fhir/types";
import type { Patient } from "./model";
import { esc, printDocument, printHtml, printableName } from "./print-doc";
import { procByCode } from "./radiology";
import { fmtDateTime } from "./format";

const when = (iso: string) =>
  fmtDateTime(iso);

const CSS = `
@page { size: A4; margin: 14mm }
h1 { font-size: 18px; margin: 0 0 2mm } h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #475569; margin: 5mm 0 1mm }
.hd { display: flex; justify-content: space-between; border-bottom: 0.4mm solid #0f172a; padding-bottom: 3mm; margin-bottom: 3mm }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1mm 6mm; font-size: 12px }
.txt { white-space: pre-wrap; font-size: 12px; line-height: 1.45 }
.imp { font-weight: 700 } .crit { color: #b91c1c; font-weight: 700 }
.draft { display: inline-block; border: 0.4mm solid #b45309; color: #b45309; padding: 0 2mm; font-weight: 700; font-size: 11px }
.sign { margin-top: 8mm; border-top: 0.3mm solid #94a3b8; padding-top: 2mm; font-size: 11px }
ul { margin: 0; padding-left: 5mm; font-size: 11px }
`;

/** The report as a page: patient, exam, text, signature and the names of the attached files. A report that is not signed is marked Draft. */
export function radReportBody(order: RadOrder, patient: Patient): string | null {
  const r = order.report;
  if (!r || !order.study) return null;
  const proc = procByCode(order.procCode);
  const att = attachmentsOf(order);
  const signed = !!r.signedAt && !!r.signedBy;
  const addenda = r.addenda?.length ? r.addenda : r.addendum ? [{ text: r.addendum, at: r.reportedAt, by: "" }] : [];
  const section = (title: string, text: string) => (text.trim() ? `<h2>${esc(title)}</h2><div class="txt">${esc(text)}</div>` : "");
  const body = `
    <div class="hd"><div><h1>Radiology Report</h1><div>${esc(proc?.display ?? order.procCode)}</div></div><div>${signed ? "" : '<span class="draft">DRAFT, NOT SIGNED</span>'}</div></div>
    <div class="grid">
      <div><b>Patient:</b> ${esc(printableName(patient))}</div><div><b>MRN:</b> ${esc(patient.mrn)}</div>
      <div><b>Date Of Birth:</b> ${esc(patient.dob)} (${esc(patient.sex === "M" ? "Male" : "Female")})</div><div><b>Visit:</b> ${esc(order.visitNumber)}</div>
      <div><b>Exam Done:</b> ${esc(when(order.study.performedEnd))}</div><div><b>Accession:</b> ${esc(order.study.accession)}</div>
      ${order.study.machine ? `<div><b>Machine:</b> ${esc(order.study.machine)}</div>` : ""}
      ${order.indication ? `<div><b>Reason For Exam:</b> ${esc(order.indication)}</div>` : ""}
    </div>
    ${section("Technique", r.technique)}${section("Comparison", r.comparison)}${section("Findings", r.findings)}
    ${r.impression.trim() ? `<h2>Impression</h2><div class="txt imp">${esc(r.impression)}</div>` : ""}
    ${r.critical ? `<p class="crit">Critical finding${r.communicated ? ` told to ${esc(r.communicated)}` : ""}.</p>` : ""}
    ${addenda.map((a, i) => `<h2>Addendum ${i + 1}</h2><div class="txt">${esc(a.text)}</div>${a.by ? `<div style="font-size:10px;color:#475569">Added by ${esc(a.by)}, ${esc(when(a.at))}</div>` : ""}`).join("")}
    ${att.images.length || att.pdf ? `<h2>Attachments</h2><ul>${att.images.map((i) => `<li>Image: ${esc(i.name)} (${esc(fmtSize(i.size))})</li>`).join("")}${att.pdf ? `<li>PDF: ${esc(att.pdf.name)} (${esc(fmtSize(att.pdf.size))})</li>` : ""}</ul>` : ""}
    <div class="sign">${signed ? `Reporting radiologist: <b>${esc(r.signedBy!.name)}</b>. Signed ${esc(when(r.signedAt!))}.` : "Reporting radiologist: not signed."}</div>`;
  return body;
}

/** The whole page, for tests and for anyone who wants the markup. */
export const radReportHtml = (order: RadOrder, patient: Patient): string | null => {
  const body = radReportBody(order, patient);
  return body ? printHtml({ title: `Radiology Report ${order.id}`, css: CSS, body }) : null;
};

/** Opens the print dialog for the report. Returns false when there is nothing to print or the browser cannot print. */
export function printRadReport(order: RadOrder, patient: Patient): boolean {
  const body = radReportBody(order, patient);
  if (!body) return false;
  const ok = printDocument({ title: `Radiology Report ${order.id}`, css: CSS, body });
  if (ok) markReportPrinted(order);
  return ok;
}
