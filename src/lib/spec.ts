/**
 * NPHIES ADT event table (from the Confluence "ADT" page) and the scenarios (from the PDF).
 * R = required, O = optional, - = must not be present.
 */

/** R = required, O = optional, - = must not be present, I = may be sent but nphies ignores it. */
export type Req = "R" | "O" | "-" | "I";

export const STANDARD_SEGMENTS = ["MSH", "EVN", "PID", "PD1", "PV1", "PV2", "AL1", "DG1", "PR1", "MRG"] as const;
export const Z_SEGMENTS = ["ZPV1", "ZDG1", "ZPR1"] as const;
export type StdSegId = (typeof STANDARD_SEGMENTS)[number];
export type ZSegId = (typeof Z_SEGMENTS)[number];
export type SegId = StdSegId | ZSegId;

export type EventId =
  | "A01" | "A02" | "A03" | "A04" | "A05" | "A06" | "A07" | "A08" | "A08-CNHI"
  | "A11" | "A12" | "A13" | "A31" | "A38" | "A45" | "A50";

export type EventGroup = "Admit and Visit" | "Move and End" | "Updates" | "Cancels" | "Merge and Move";

export interface EventSpec {
  id: EventId;
  /** The HL7 trigger code that goes in MSH-9 and EVN-1. */
  trigger: string;
  /** MSH-9.3 message structure. */
  structure: string;
  /** Name from the Confluence page (used in the UI). */
  name: string;
  /** Name from the PDF, shown in help text when it is different. */
  pdfName?: string;
  group: EventGroup;
  segments: Record<StdSegId, Req>;
  useCase: string;
  workflow: string;
  purpose: string;
  /** Extra note shown on the screen. */
  note?: string;
}

type Row = [Req, Req, Req, Req, Req, Req, Req, Req, Req, Req]; // MSH EVN PID PD1 PV1 PV2 AL1 DG1 PR1 MRG

function seg(row: Row): Record<StdSegId, Req> {
  const out = {} as Record<StdSegId, Req>;
  STANDARD_SEGMENTS.forEach((s, i) => (out[s] = row[i]));
  return out;
}

const FULL: Row = ["R", "R", "R", "O", "R", "O", "O", "O", "O", "-"];

export const EVENTS: EventSpec[] = [
  {
    id: "A01", trigger: "A01", structure: "ADT_A01", name: "Admit/Visit Notification", group: "Admit and Visit",
    segments: seg(FULL),
    useCase: "Inpatient admission",
    workflow: "Patient arrives, admissions staff register and assign a bed, the HIS sends A01.",
    purpose: "A new inpatient encounter started.",
  },
  {
    id: "A02", trigger: "A02", structure: "ADT_A02", name: "Transfer a Patient", group: "Move and End",
    segments: seg(["R", "R", "R", "O", "R", "O", "-", "-", "-", "-"]),
    useCase: "Move within the same facility",
    workflow: "Nurse or coordinator records a room or bed transfer.",
    purpose: "Everyone knows the current location.",
  },
  {
    id: "A03", trigger: "A03", structure: "ADT_A03", name: "Discharge/End Visit", group: "Move and End",
    segments: seg(["R", "R", "R", "O", "R", "O", "I", "R", "O", "-"]),
    useCase: "Inpatient stay ends",
    workflow: "Physician enters the discharge order, discharge is processed, the HIS sends A03.",
    purpose: "Patient has officially left.",
    note: "DG1 is required for A03. AL1 is marked \"I\" (ignored). The Confluence page says: the AL1 segment is ignored for A03 messages. You may send it, but it has no effect.",
  },
  {
    id: "A04", trigger: "A04", structure: "ADT_A01", name: "Register a Patient", group: "Admit and Visit",
    segments: seg(FULL),
    useCase: "Outpatient or same-day registration",
    workflow: "Front desk creates a visit (imaging, labs).",
    purpose: "Start outpatient workflows.",
    note: "PV1 is required for A04. PID-3 must be the NHIC Health ID with its OID. PID-7 is required. Sex, address short code, marital status and nationality are required if known. Set PV1-8 (referring doctor) and PV1-44 (registration time).",
  },
  {
    id: "A05", trigger: "A05", structure: "ADT_A05", name: "Pre-Admit a Patient", group: "Admit and Visit",
    segments: seg(FULL),
    useCase: "Planned future admission",
    workflow: "Staff enter pre-admission data with an estimated admit date.",
    purpose: "Prepare resources in advance.",
  },
  {
    id: "A06", trigger: "A06", structure: "ADT_A06", name: "Change an Outpatient to an Inpatient", group: "Admit and Visit",
    segments: seg(FULL),
    useCase: "Outpatient becomes inpatient",
    workflow: "Clinician decides to admit, status changes.",
    purpose: "Care level went up.",
  },
  {
    id: "A07", trigger: "A07", structure: "ADT_A06", name: "Change an Inpatient to an Outpatient", group: "Admit and Visit",
    segments: seg(FULL),
    useCase: "Inpatient becomes outpatient",
    workflow: "Care status is updated after reassessment.",
    purpose: "Correct billing and workflow.",
  },
  {
    id: "A08", trigger: "A08", structure: "ADT_A01", name: "Update Patient Information", group: "Updates",
    segments: seg(FULL),
    useCase: "Update data (diagnosis, procedures, doctor info)",
    workflow: "Staff update the record.",
    purpose: "Keep connected systems in step.",
    note: "PV1 is required for A08.",
  },
  {
    id: "A08-CNHI", trigger: "A08", structure: "ADT_A01", name: "Update Patient Information (CNHI Discharge)", group: "Updates",
    segments: seg(FULL),
    useCase: "Submit or correct discharge info for CNHI reporting",
    workflow:
      "After discharge the HIS sends a customised A08 limited to discharge updates, with CNHI fields and the Z-segments ZPV1, ZDG1, ZPR1.",
    purpose: "Let the receiver tell it apart from a normal A08.",
    note: "This variant is only in the PDF. The field lists for ZPV1, ZDG1 and ZPR1 are not defined yet, so they are placeholders.",
  },
  {
    id: "A11", trigger: "A11", structure: "ADT_A09", name: "Cancel Admit/Visit Notification", group: "Cancels",
    segments: seg(["R", "R", "R", "O", "R", "O", "-", "O", "-", "-"]),
    useCase: "A01 was sent in error",
    workflow: "Staff cancel the admission.",
    purpose: "Reverse an A01.",
  },
  {
    id: "A12", trigger: "A12", structure: "ADT_A12", name: "Cancel Transfer", group: "Cancels",
    segments: seg(["R", "R", "R", "O", "R", "O", "-", "O", "-", "-"]),
    useCase: "A02 was wrong",
    workflow: "Transfer is cancelled.",
    purpose: "Revert to the prior location.",
  },
  {
    id: "A13", trigger: "A13", structure: "ADT_A01", name: "Cancel Discharge/End Visit", group: "Cancels",
    segments: seg(FULL),
    useCase: "Discharged in error, or immediate readmit",
    workflow: "Discharge is reversed.",
    purpose: "Restore inpatient status.",
  },
  {
    id: "A31", trigger: "A31", structure: "ADT_A05", name: "Update Person Information", group: "Updates",
    segments: seg(FULL),
    useCase: "Change to core identity (name, date of birth)",
    workflow: "Master person record is updated.",
    purpose: "Identity stays consistent.",
    note: "NPHIES does not process or store patient demographics, but PID is still required.",
  },
  {
    id: "A38", trigger: "A38", structure: "ADT_A38", name: "Cancel Pre-Admit", group: "Cancels",
    segments: seg(["R", "R", "R", "O", "R", "O", "-", "O", "-", "-"]),
    useCase: "A05 made in error or cancelled",
    workflow: "Pre-admission is deleted.",
    purpose: "Remove the pre-admit record.",
  },
  {
    id: "A45", trigger: "A45", structure: "ADT_A45", name: "Move Visit Information", pdfName: "Move Account Information", group: "Merge and Move",
    segments: seg(["R", "R", "R", "O", "R", "-", "-", "-", "-", "R"]),
    useCase: "Visit or account number on the wrong person",
    workflow: "HIM moves the visit from the wrong patient to the right one.",
    purpose: "Correct misassigned visit data.",
    note: "The MERGE_INFO group is MRG then PV1, in that order.",
  },
  {
    id: "A50", trigger: "A50", structure: "ADT_A50", name: "Change Visit Number", pdfName: "Change Patient Identifier List", group: "Merge and Move",
    segments: seg(["R", "R", "R", "O", "R", "-", "-", "-", "-", "R"]),
    useCase: "Patient has several identifiers",
    workflow: "MPI de-duplication merges records, survivor ID chosen.",
    purpose: "Old IDs point to the new master ID.",
    note: "The MERGE_INFO group is MRG then PV1, in that order.",
  },
];

export const EVENT_BY_ID: Record<EventId, EventSpec> = Object.fromEntries(EVENTS.map((e) => [e.id, e])) as Record<EventId, EventSpec>;

export const GROUPS: EventGroup[] = ["Admit and Visit", "Move and End", "Updates", "Cancels", "Merge and Move"];

export function eventLabel(id: EventId): string {
  return id === "A08-CNHI" ? "A08 CNHI" : id;
}

/** Segment order inside the message. For A45 and A50 the MRG group comes before PV1. */
export function segmentOrder(event: EventSpec): SegId[] {
  if (event.trigger === "A45" || event.trigger === "A50") {
    return ["MSH", "EVN", "PID", "PD1", "MRG", "PV1"];
  }
  const base: SegId[] = ["MSH", "EVN", "PID", "PD1", "PV1", "PV2", "AL1", "DG1", "PR1"];
  if (event.id === "A08-CNHI") base.push("ZPV1", "ZDG1", "ZPR1");
  return base;
}

export const OPEN_QUESTIONS = [
  "Resolved: the \"I\" for AL1 on A03 means ignored. The Confluence ADT page says the AL1 segment is ignored for A03 messages.",
  "The two sources name A45 and A50 differently. The UI uses the Confluence names. The PDF names are shown in the help text.",
  "The CNHI A08 variant has field definitions on the Confluence pages ZPV1, ZDG1 and ZPR1. The app still uses three placeholder fields per Z-segment. Replace them with the real fields.",
  "Value sets for PV1-2 (CS-Adm-PatientClass), PID-8, PID-16 and PID-28 are not in the integration guide pages read so far. The app uses I, O, E, P, M or F, S M D W, and ISO 3166 numeric country codes. Check them against the Mapping Guide.",
  "A03 requires DG1. A01, A04 to A08, A13 and A31 have DG1 optional.",
];
