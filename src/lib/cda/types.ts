import type { Check, Encounter, Patient } from "../model";
import type { FormRecord } from "../schema";

/**
 * Clinical documents (CDA R2 over IHE ITI-41). Spec snapshot:
 * references/pages/clinical-documents in the nphies-uhr skill.
 */

export type DocType = "outpatient" | "discharge" | "operative" | "maternal" | "newborn";
export const DOC_TYPES: DocType[] = ["outpatient", "discharge", "operative", "maternal", "newborn"];

/** M/R/R2/O/X usage codes from the spec. Sections are R (required), R2 (required if known) or O (optional). */
export type Usage = "R" | "R2" | "O";

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: { id?: string; text: string }[] }
  | { kind: "table"; head: string[]; rows: string[][] };

/** One section, after it has been filled from the chart. */
export interface SectionOut {
  key: string;
  /** nphies template id first, then the IHE and HL7 CCD ids. */
  templateIds: string[];
  loinc: string;
  loincName: string;
  title: string;
  usage: Usage;
  blocks: Block[];
  /** Pre-rendered <entry> XML. */
  entries: string[];
  /** False when the chart had nothing for this section. */
  hasData: boolean;
  /** Which chart fields fed this section. Shown in Developer View. */
  sources: string[];
}

export interface MedLine {
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
}

export interface SoapLite {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

/** Everything a builder needs. Pure data, so the builders are easy to test. */
export interface DocInput {
  type: DocType;
  enc: Encounter;
  patient: Patient;
  /** Reads form records for the visit, for example getFormRecords(visit, formId). */
  forms: (formId: string) => FormRecord[];
  author: { id: string; name: string; specialty: string };
  now: Date;
  /** Local document id (the extension of ClinicalDocument/id). */
  docId: string;
  /** Common to all versions of the document. */
  setId: string;
  version: number;
  /** Document id of the version this one replaces. */
  replaces?: string;
  amendReason?: string;
  /** Operative note: index into enc.pr. -1 or undefined means all procedures. */
  procIndex?: number;
  medications?: MedLine[];
  soap?: SoapLite[];
}

export interface Coded {
  code: string;
  system: string;
  display: string;
}

export interface Iti41Metadata {
  documentEntry: {
    entryUUID: string;
    uniqueId: string;
    patientId: string;
    sourcePatientId: string;
    title: string;
    typeCode: Coded;
    classCode: Coded;
    formatCode: Coded;
    mimeType: string;
    confidentialityCode: Coded;
    /** UTC, format YYYYMMDDhhmmss */
    creationTime: string;
    languageCode: string;
    healthcareFacilityTypeCode: Coded;
    practiceSettingCode: Coded;
    author: { institution: string; person: string; role: string; speciality: string };
    availabilityStatus: "Approved" | "Deprecated";
    hash: string;
    size: number;
    referenceIdList: string[];
    objectType: string;
    comments?: string;
  };
  submissionSet: {
    entryUUID: string;
    uniqueId: string;
    sourceId: string;
    submissionTime: string;
    contentTypeCode: Coded;
    patientId: string;
    availabilityStatus: "Approved" | "Deprecated";
    intendedRecipient: string;
  };
  /** Present on an amendment: the new document replaces the old one. */
  association?: { type: "RPLC"; source: string; target: string };
}

export interface BuiltDoc {
  type: DocType;
  title: string;
  docId: string;
  setId: string;
  version: number;
  xml: string;
  sections: SectionOut[];
  metadata: Iti41Metadata;
  /** Light summary of the header for the preview. */
  header: {
    patientName: string;
    healthId: string;
    authorName: string;
    org: string;
    encounterId: string;
    encounterStart: string;
    encounterEnd: string;
    createdAt: string;
    status: "final" | "amended";
  };
  /** Chart facts the validator needs. */
  facts: {
    hasEncounterStart: boolean;
    hasEncounterEnd: boolean;
    encounterFallback: boolean;
    dxCount: number;
    procCount: number;
    stillbirth: boolean;
    died: boolean;
    newbornTempId: boolean;
  };
}

export interface SimResponse {
  ok: boolean;
  status: string;
  /** Submission set unique id the registry would return. */
  submissionId: string;
  errors: { code: string; context: string }[];
  xml: string;
  at: string;
}

export type { Check };
