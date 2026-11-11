import { audit } from "../audit";
import type { Encounter, Patient } from "../model";
import { getFormRecords } from "../records";
import { getRx, rxForVisit } from "../rx";
import { DRUG_BY_ID, FREQ_BY_ID } from "../rx-catalogue";
import { currentUser } from "../session";
import { getState, nowLocal, patientName, updateEncounter } from "../store";
import type { AiContext, AiMed } from "./context";
import type { AiOutput } from "./engine";
import { listSoap } from "./soap-store";

/** The impure edge: reads the live stores to build the context, and records what the clinician does with each output. */

export function medsOf(visit: string): AiMed[] {
  try {
    return rxForVisit(getRx(), visit)
      .flatMap((p) => p.items)
      .filter((it) => it.status !== "cancelled" && it.status !== "stopped")
      .map((it) => {
        const d = DRUG_BY_ID[it.drugId];
        return {
          name: d ? `${d.generic} ${d.strengthValue} ${d.strengthUnit}` : it.drugId,
          dose: d ? `${it.dose} ${d.unit}` : String(it.dose),
          frequency: it.asNeeded ? "as needed" : FREQ_BY_ID[it.frequencyId]?.label,
          allergyKeys: d?.allergyKeys ?? [],
          crossKeys: d?.crossKeys ?? [],
        };
      });
  } catch {
    return [];
  }
}

export function buildContext(enc: Encounter, patient: Patient, now: Date = new Date()): AiContext {
  return {
    enc, patient, now,
    forms: (id) => getFormRecords(enc.visitNumber, id),
    soap: listSoap(enc.visitNumber),
    meds: medsOf(enc.visitNumber),
    log: getState().log.filter((l) => l.visitNumber === enc.visitNumber).sort((a, b) => b.seq - a.seq),
  };
}

/** Reads the open chart from the address: #/chart?visit=V100001&s=... */
export function visitFromHash(hash: string = typeof window === "undefined" ? "" : window.location.hash): string | null {
  const raw = hash.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  if (path !== "/chart") return null;
  return new URLSearchParams(query).get("visit");
}

export function contextFromHash(hash?: string): AiContext | null {
  const visit = visitFromHash(hash);
  if (!visit) return null;
  const st = getState();
  const enc = st.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && st.patients.find((p) => p.id === enc.patientId);
  return enc && patient ? buildContext(enc, patient) : null;
}

/* ---------- audit: what the assistant did and what the clinician did with it ---------- */

const detail = (o: AiOutput, visit: string, extra = "") =>
  `${o.useCase}, visit ${visit}, ${o.engine}. Sources: ${o.sources.join(", ") || "none"}.${extra}`;

export function auditSuggest(o: AiOutput, enc: Encounter, p: Patient) {
  audit("ai-suggest", `AI ${o.useCase}: ${o.title}`, { patient: patientName(p), detail: detail(o, enc.visitNumber) });
}

export function auditAccept(o: AiOutput, enc: Encounter, p: Patient, edited: boolean, what: string) {
  audit("ai-accept", `AI ${o.useCase}: ${o.title}`, { patient: patientName(p), detail: detail(o, enc.visitNumber, ` ${edited ? "Edited before accepting." : "Accepted as written."} ${what}`) });
}

export function auditReject(o: AiOutput, enc: Encounter, p: Patient, reason?: string) {
  audit("ai-reject", `AI ${o.useCase}: ${o.title}`, { patient: patientName(p), detail: detail(o, enc.visitNumber, reason ? ` Reason: ${reason}` : "") });
}

/** Add the text to the chart as a progress note that says it began as an AI draft. */
export function addAiNote(visit: string, text: string) {
  updateEncounter(visit, (e) => {
    e.notes = [...e.notes, { at: nowLocal(), author: `${currentUser().name} (from AI draft)`, text }];
  });
}

export function addDiagnoses(visit: string, items: { code: string; text: string }[]): number {
  let added = 0;
  updateEncounter(visit, (e) => {
    for (const it of items) {
      if (e.dx.some((d) => d.code === it.code)) continue;
      e.dx = [...e.dx, { code: it.code, text: it.text, type: "W" }];
      added++;
    }
  });
  return added;
}
