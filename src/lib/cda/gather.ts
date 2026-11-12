import { listSoap } from "../ai/soap-store";
import type { Encounter, Patient } from "../model";
import { getFormRecords } from "../records";
import { SERVICES } from "../reference-data";
import { currentUser } from "../session";
import { getRx, rxForVisit } from "../rx";
import { DRUG_BY_ID, FREQ_BY_ID, ROUTE_LABEL } from "../rx-catalogue";
import { doctor } from "./chartdata";
import type { DocInput, DocType, MedLine } from "./types";

/** Builds the builder input from the live chart. The builders themselves stay pure. */

export const DOC_CODE: Record<DocType, string> = { outpatient: "OPS", discharge: "DIS", operative: "OPN", maternal: "MAT", newborn: "NBN" };

/** Medicines on the visit's prescriptions, without cancelled or stopped items. */
export function medsForVisit(visit: string): MedLine[] {
  try {
    return rxForVisit(getRx(), visit)
      .flatMap((p) => p.items)
      .filter((it) => it.status !== "cancelled" && it.status !== "stopped")
      .map((it) => {
        const d = DRUG_BY_ID[it.drugId];
        return {
          name: d ? `${d.generic} ${d.strengthValue} ${d.strengthUnit}` : it.drugId,
          dose: d ? `${it.dose} ${d.unit}` : String(it.dose),
          route: ROUTE_LABEL[it.route] ?? it.route,
          frequency: it.asNeeded ? "As needed" : FREQ_BY_ID[it.frequencyId]?.label ?? it.frequencyId,
          // Same drug and dose form codes as the prescription message (demo codes, see the assumption notes).
          code: d?.code,
          codeSystem: d ? "2.16.840.1.113883.3.3731.1.205.1" : undefined,
          formCode: d?.formCode,
          formName: d?.form,
          // The strength goes in as one number and unit. Combined strengths such as "mg/5 mL" stay in the name only.
          strengthValue: d && /^[A-Za-z]+$/.test(d.strengthUnit) ? d.strengthValue : undefined,
          strengthUnit: d && /^[A-Za-z]+$/.test(d.strengthUnit) ? d.strengthUnit : undefined,
          instruction: it.patientInstruction,
        };
      });
  } catch {
    return [];
  }
}

export interface GatherOptions {
  docId: string;
  setId: string;
  version: number;
  replaces?: string;
  amendReason?: string;
  procIndex?: number;
  now?: Date;
}

export function gatherInput(type: DocType, enc: Encounter, patient: Patient, o: GatherOptions): DocInput {
  const d = doctor(enc.attending);
  const svc = SERVICES.find((s) => s.code === enc.service)?.label ?? enc.service;
  return {
    type, enc, patient,
    forms: (formId) => getFormRecords(enc.visitNumber, formId),
    author: { id: d?.id ?? "UNK", name: d ? `Dr. ${d.given} ${d.family}` : currentUser().name, specialty: svc },
    now: o.now ?? new Date(),
    docId: o.docId, setId: o.setId, version: o.version, replaces: o.replaces, amendReason: o.amendReason, procIndex: o.procIndex,
    medications: medsForVisit(enc.visitNumber),
    soap: listSoap(enc.visitNumber).filter((s) => s.status === "signed" || s.subjective || s.plan),
  };
}
