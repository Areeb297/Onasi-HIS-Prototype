import { getDocsState } from "../docs";
import type { SendRecord } from "../fhir/types";
import { getLab } from "../lab";
import { getRad } from "../radiology";
import { getState } from "../store";
import { getVitals } from "../vitals";
import type { CallEntry } from "./call-log";
import { pretty } from "./call-log";
import { medicationCalls } from "./raqeeb";

/** NPHIES Clinical (UHR) messages, read from the stores that sent them: ADT, lab, radiology, medication, vital signs and CDA documents. */

const KIND: Record<string, string> = { "lab-order": "Lab Order", "lab-result": "Lab Result", "rad-order": "Radiology Order", "rad-report": "Radiology Report" };
const hl7 = (m: string) => m.replace(/\r/g, "\n");

const fhir = (ref: string, s: SendRecord): CallEntry => ({
  id: `UHR-${ref}-${s.kind}-${s.seq}`, integration: "nphies-clinical", at: s.at, operation: KIND[s.kind] ?? s.kind,
  summary: `${ref}, version ${s.version}. ${s.response.status === "accepted" ? "Accepted" : "Rejected"}`, ok: s.response.status === "accepted",
  format: "JSON", request: pretty(s.bundle), response: pretty(s.response),
});

export function nphiesClinicalCalls(): CallEntry[] {
  const adt = getState().log.map((l): CallEntry => ({
    id: `UHR-ADT-${l.seq}`, integration: "nphies-clinical", at: l.sentAt, operation: `ADT ${l.eventId}`, summary: `${l.patientName}, visit ${l.visitNumber}`,
    ok: l.errors === 0, format: "HL7 v2", request: hl7(l.message),
    // The ADT log keeps the checks, not an acknowledgement message.
    response: l.errors === 0 ? `Accepted. ${l.warnings} warnings.` : `Not accepted. ${l.errors} errors, ${l.warnings} warnings.`,
  }));
  const lab = getLab().orders.flatMap((o) => o.sends.map((s) => fhir(o.id, s)));
  const rad = getRad().orders.flatMap((o) => o.sends.map((s) => fhir(o.id, s)));
  const vitals = getVitals().panels.flatMap((p) => p.sends.map((s): CallEntry => ({
    id: `UHR-VS-${s.controlId}`, integration: "nphies-clinical", at: s.at, operation: "Vital Signs", summary: `Visit ${s.visit}. ${s.accepted ? "Accepted" : "Rejected"}`,
    ok: s.accepted, format: "HL7 v2", request: hl7(s.message), response: hl7(s.ack),
  })));
  const docs = getDocsState().docs.filter((d) => d.response).map((d): CallEntry => ({
    id: `UHR-CDA-${d.id}`, integration: "nphies-clinical", at: d.response!.at, operation: "Clinical Document", summary: `${d.built.title}, visit ${d.visit}. ${d.response!.status}`,
    ok: d.response!.ok, format: "XML", request: d.built.xml, response: d.response!.xml,
  }));
  return [...adt, ...lab, ...rad, ...medicationCalls(false), ...vitals, ...docs];
}
