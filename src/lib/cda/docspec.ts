import type { DocType, Usage } from "./types";

/**
 * Static facts from the spec: document templates, type codes, and which sections each document carries, in order.
 * Sources: "CDA Header by Document Type" (Table 22), "Document Content Module Overview" (Table 21),
 * the CDA Body pages (Tables 23 to 27), "Document Metadata (Clinical Documents)", and each Section page.
 */

export const NPHIES_NS = "urn:oid:2.16.840.1.113883.3.3731.1.2.2.11111111111110";
export const LOINC = "2.16.840.1.113883.6.1";
export const SNOMED = "2.16.840.1.113883.6.96";

export interface SectionSpec {
  key: string;
  title: string;
  loinc: string;
  loincName: string;
  /** nphies id, then IHE and HL7 CCD ids (primary ids only). */
  tids: string[];
  /** Template ids that may only be sent when the section has coded entries. */
  tidsWithEntries?: string[];
  /** Spec page for Developer View. */
  page: string;
}

const N = (n: number) => `2.16.840.1.113883.3.3731.1.210.100.${n}`;

export const SECTIONS: Record<string, SectionSpec> = {
  chief: { key: "chief", title: "Chief Complaint", loinc: "10154-3", loincName: "CHIEF COMPLAINT", tids: [N(1), "1.3.6.1.4.1.19376.1.5.3.1.1.13.2.1"], page: "Chief Complaint Section" },
  referral: { key: "referral", title: "Reason for Referral", loinc: "42349-1", loincName: "REASON FOR REFERRAL", tids: [N(2), "1.3.6.1.4.1.19376.1.5.3.1.3.1"], page: "Reason for Referral Section (Diagnosis)" },
  problems: { key: "problems", title: "Active problems", loinc: "11450-4", loincName: "PROBLEM LIST", tids: [N(3), "1.3.6.1.4.1.19376.1.5.3.1.3.6", "2.16.840.1.113883.10.20.1.11"], page: "Active Problems Section (Problem List)" },
  hpi: { key: "hpi", title: "History of Present Illness", loinc: "10164-2", loincName: "HISTORY OF PRESENT ILLNESS", tids: [N(4), "1.3.6.1.4.1.19376.1.5.3.1.3.4"], page: "History of Present Illness Section" },
  meds: { key: "meds", title: "Medications List", loinc: "10160-0", loincName: "HISTORY OF MEDICATION USE", tids: [N(5), "1.3.6.1.4.1.19376.1.5.3.1.3.19", "2.16.840.1.113883.10.20.1.8"], page: "Medications Section" },
  immun: { key: "immun", title: "Immunizations", loinc: "11369-6", loincName: "HISTORY OF IMMUNIZATIONS", tids: [N(6), "1.3.6.1.4.1.19376.1.5.3.1.3.23", "2.16.840.1.113883.10.20.1.6"], page: "Immunizations Section" },
  surgeries: { key: "surgeries", title: "List of Surgeries", loinc: "47519-4", loincName: "HISTORY OF PROCEDURES", tids: [N(7), "1.3.6.1.4.1.19376.1.5.3.1.3.12", "1.3.6.1.4.1.19376.1.5.3.1.3.11", "2.16.840.1.113883.10.20.1.12"], tidsWithEntries: ["1.3.6.1.4.1.19376.1.5.3.1.3.12"], page: "List of Surgeries Section (History of Procedures)" },
  allergies: { key: "allergies", title: "Allergies and Adverse Reactions", loinc: "48765-2", loincName: "ALLERGIES, ADVERSE REACTIONS, ALERTS", tids: [N(8), "1.3.6.1.4.1.19376.1.5.3.1.3.13", "2.16.840.1.113883.10.20.1.2"], page: "Allergies and Adverse Reactions Section" },
  exam: { key: "exam", title: "Physical Examination", loinc: "29545-1", loincName: "PHYSICAL EXAMINATION", tids: [N(9), "1.3.6.1.4.1.19376.1.5.3.1.3.24"], page: "Physical Examination Section" },
  vitals: { key: "vitals", title: "Vital Signs", loinc: "8716-3", loincName: "VITAL SIGNS", tids: [N(10), "1.3.6.1.4.1.19376.1.5.3.1.1.5.3.2", "1.3.6.1.4.1.19376.1.5.3.1.3.25", "2.16.840.1.113883.10.20.1.16"], page: "Vital Signs Section" },
  devices: { key: "devices", title: "Visible Implanted Medical Devices", loinc: "57080-4", loincName: "IMPLANTED MEDICAL DEVICE", tids: [N(11), "1.3.6.1.4.1.19376.1.5.3.1.1.9.48"], page: "Visible Implanted Medical Devices Section" },
  drains: { key: "drains", title: "Surgical Drains", loinc: "11537-8", loincName: "SURGICAL DRAINS", tids: [N(12), "2.16.840.1.113883.10.20.7.13"], page: "Surgical Drains Section" },
  careplan: { key: "careplan", title: "Care Plan", loinc: "61145-9", loincName: "TREATMENT PLAN", tids: [N(13), "1.3.6.1.4.1.19376.1.5.3.1.3.31", "2.16.840.1.113883.10.20.1.10"], page: "Care Plan Section" },
  bloodgroup: { key: "bloodgroup", title: "Blood Group Test Results", loinc: "30954-2", loincName: "STUDIES SUMMARY", tids: [N(14)], page: "Blood Group Coded Results Section" },
  assessplan: { key: "assessplan", title: "Assessment and Plan", loinc: "51847-2", loincName: "ASSESSMENT AND PLAN", tids: [N(15), "1.3.6.1.4.1.19376.1.5.3.1.1.13.2.5"], page: "Assessment and Plan Section (Outpatient Course)" },
  admedhx: { key: "admedhx", title: "Medications History on Admission", loinc: "42346-7", loincName: "MEDICATIONS ON ADMISSION", tids: [N(16), "1.3.6.1.4.1.19376.1.5.3.1.3.20"], page: "Admission Medications History Section" },
  admitdx: { key: "admitdx", title: "Admitting Diagnosis", loinc: "46241-6", loincName: "HOSPITAL ADMISSION DX", tids: [N(17), "1.3.6.1.4.1.19376.1.5.3.1.3.3"], page: "Hospital Admission Diagnosis Section (Problem List)" },
  medsgiven: { key: "medsgiven", title: "Medications Administered", loinc: "18610-6", loincName: "MEDICATION ADMINISTERED", tids: [N(18), "1.3.6.1.4.1.19376.1.5.3.1.3.21"], page: "Medications Administered Section" },
  dcmeds: { key: "dcmeds", title: "Hospital Discharge Medications", loinc: "10183-2", loincName: "HOSPITAL DISCHARGE MEDICATIONS", tids: [N(19), "1.3.6.1.4.1.19376.1.5.3.1.3.22"], page: "Hospital Discharge Medications Section" },
  dcdx: { key: "dcdx", title: "Discharge Diagnosis", loinc: "11535-2", loincName: "HOSPITAL DISCHARGE DX", tids: [N(20), "1.3.6.1.4.1.19376.1.5.3.1.3.7"], page: "Discharge Diagnosis Section (Discharge Condition)" },
  course: { key: "course", title: "Hospital Course", loinc: "8648-8", loincName: "HOSPITAL COURSE", tids: [N(21), "1.3.6.1.4.1.19376.1.5.3.1.3.5"], page: "Hospital Course Section" },
  disposition: { key: "disposition", title: "Discharge Disposition", loinc: "8650-4", loincName: "HOSPITAL DISCHARGE DISPOSITION", tids: [N(22), "1.3.6.1.4.1.19376.1.5.3.1.3.32"], page: "Discharge Disposition Section" },
  pregnancy: { key: "pregnancy", title: "Pregnancy History", loinc: "10162-6", loincName: "HISTORY OF PREGNANCIES", tids: [N(23), "1.3.6.1.4.1.19376.1.5.3.1.1.5.3.4"], page: "Pregnancy History Section" },
  labor: { key: "labor", title: "Labor and Delivery Events", loinc: "29544-3", loincName: "PROCEDURES", tids: [N(24), "1.3.6.1.4.1.19376.1.5.3.1.1.13.2.11"], page: "Labor and Delivery Events Section" },
  delivery: { key: "delivery", title: "Delivery Event Outcome", loinc: "42545-4", loincName: "EVENT OUTCOME", tids: [N(25), "1.3.6.1.4.1.19376.1.5.3.1.1.21.2.9"], page: "Delivery Event Outcome Section" },
  newbornstatus: { key: "newbornstatus", title: "Newborn Status at Maternal Discharge", loinc: "57077-0", loincName: "NEWBORN STATUS AT MATERNAL DISCHARGE", tids: [N(26), "1.3.6.1.4.1.19376.1.5.3.1.1.21.2.8"], page: "Newborn Status at Maternal Discharge Section" },
  screening: { key: "screening", title: "Newborn Screening Test Results", loinc: "30954-2", loincName: "STUDIES SUMMARY", tids: [N(27)], page: "Newborn Screening Coded Results Section" },
  preop: { key: "preop", title: "Preoperative Diagnosis", loinc: "10219-4", loincName: "SURGICAL OPERATION NOTE PREOPERATIVE DIAGNOSIS", tids: [N(28), "2.16.840.1.113883.10.20.22.2.34"], page: "Preoperative Diagnosis Section (Pre-Operative Condition)" },
  postproc: { key: "postproc", title: "Postprocedure Diagnosis", loinc: "59769-0", loincName: "POSTPROCEDURE DIAGNOSIS", tids: [N(29), "2.16.840.1.113883.10.20.22.2.36"], page: "Postprocedure Diagnosis Section (Confirmed Diagnosis)" },
  postop: { key: "postop", title: "Postoperative Diagnosis", loinc: "10218-6", loincName: "SURGICAL OPERATION NOTE POSTOPERATIVE DIAGNOSIS", tids: [N(30), "2.16.840.1.113883.10.20.22.2.35"], page: "Postoperative Diagnosis Section (Post-Operative Conditions)" },
  acuity: { key: "acuity", title: "Acuity Assessment", loinc: "11283-9", loincName: "ACUITY ASSESSMENT", tids: [N(31), "1.3.6.1.4.1.19376.1.5.3.1.1.13.2.2"], page: "Acuity Assessment Section" },
  planned: { key: "planned", title: "Planned Procedure", loinc: "59772-4", loincName: "PLANNED PROCEDURES", tids: [N(32), "2.16.840.1.113883.10.20.22.2.30"], page: "Planned Procedure Section" },
  procdone: { key: "procdone", title: "Operative Note Surgical Procedure", loinc: "10223-6", loincName: "SURGICAL OPERATION NOTE SURGICAL PROCEDURE", tids: [N(33), "2.16.840.1.113883.10.20.7.14"], page: "Operative Note Surgical Procedure Section" },
  anesthesia: { key: "anesthesia", title: "Anesthesia", loinc: "59774-0", loincName: "PROCEDURE ANESTHESIA", tids: [N(34), "2.16.840.1.113883.10.20.22.2.25"], page: "Anesthesia Section" },
  complications: { key: "complications", title: "Complications", loinc: "55109-3", loincName: "COMPLICATIONS", tids: [N(35), "2.16.840.1.113883.10.20.22.2.37"], page: "Complications Section" },
  specimens: { key: "specimens", title: "Procedure Specimens Taken", loinc: "59773-2", loincName: "PROCEDURE SPECIMENS TAKEN", tids: [N(36), "2.16.840.1.113883.10.20.22.2.31"], page: "Procedure Specimens Taken Section" },
  ebl: { key: "ebl", title: "Estimated Blood Loss", loinc: "59770-8", loincName: "PROCEDURE ESTIMATED BLOOD LOSS", tids: [N(37), "2.16.840.1.113883.10.20.18.2.9"], page: "Estimated Blood Loss Section" },
  fluids: { key: "fluids", title: "Operative Note Fluids", loinc: "10216-0", loincName: "SURGICAL OPERATION NOTE FLUIDS", tids: [N(38), "2.16.840.1.113883.10.20.7.12"], page: "Operative Note Fluids Section" },
  findings: { key: "findings", title: "Procedure Findings", loinc: "59776-5", loincName: "PROCEDURE FINDINGS", tids: [N(39), "2.16.840.1.113883.10.20.22.2.28"], page: "Procedure Findings Section" },
  procdesc: { key: "procdesc", title: "Procedure Description", loinc: "29554-3", loincName: "PROCEDURE", tids: [N(40), "2.16.840.1.113883.10.20.22.2.27"], page: "Procedure Description Section" },
  procdisp: { key: "procdisp", title: "Procedure Disposition", loinc: "59775-7", loincName: "PROCEDURE DISPOSITION", tids: [N(41), "2.16.840.1.113883.10.20.18.2.12"], page: "Procedure Disposition Section" },
  transfusion: { key: "transfusion", title: "History of Blood Transfusion", loinc: "56836-0", loincName: "HISTORY OF BLOOD TRANSFUSION", tids: [N(42), "1.3.6.1.4.1.19376.1.5.3.1.1.9.12"], page: "History of Blood Transfusion Section" },
};

type Plan = [key: string, usage: Usage][];

const DISCHARGE_BASE: Plan = [
  ["chief", "R"], ["admitdx", "R"], ["hpi", "R2"], ["allergies", "R"], ["problems", "R"], ["admedhx", "R"], ["bloodgroup", "R2"],
  ["course", "R2"], ["surgeries", "R2"], ["drains", "R2"], ["medsgiven", "R"], ["immun", "R2"], ["vitals", "R"], ["exam", "R2"],
  ["devices", "R2"], ["dcmeds", "R"], ["careplan", "R"], ["dcdx", "R"], ["disposition", "R"],
];

const insertAfter = (plan: Plan, after: string, add: Plan): Plan => {
  const i = plan.findIndex(([k]) => k === after);
  return [...plan.slice(0, i + 1), ...add, ...plan.slice(i + 1)];
};

const MATERNAL: Plan = (() => {
  let p = insertAfter(DISCHARGE_BASE, "hpi", [["pregnancy", "R"]]);
  p = insertAfter(p, "course", [["labor", "R"], ["delivery", "R"]]);
  p = insertAfter(p, "devices", [["newbornstatus", "R"]]);
  return p;
})();

const NEWBORN: Plan = (() => {
  let p = insertAfter(DISCHARGE_BASE, "hpi", [["pregnancy", "R"]]);
  p = insertAfter(p, "course", [["labor", "R"], ["delivery", "R"], ["screening", "R"]]);
  p = insertAfter(p, "devices", [["newbornstatus", "R"]]);
  return p;
})();

export interface DocSpec {
  type: DocType;
  label: string;
  /** Short plain-English description for HIS View. */
  blurb: string;
  templateId: string;
  typeCode: string;
  typeDisplay: string;
  /** Title sent in ClinicalDocument/title. */
  title: string;
  classCode: "SUMMARIES" | "REPORT";
  /** Table 22: performer usage. */
  performer: "O" | "R" | "M";
  plan: Plan;
}

export const DOC_SPECS: Record<DocType, DocSpec> = {
  outpatient: {
    type: "outpatient", label: "Outpatient Encounter Summary", blurb: "Summary of a clinic visit. Sent after the visit ends.",
    templateId: "2.16.840.1.113883.3.3731.1.210.1", typeCode: "96345-4", typeDisplay: "Outpatient Summary Note", title: "Outpatient Encounter Summary",
    classCode: "SUMMARIES", performer: "O",
    plan: [
      ["chief", "R"], ["referral", "R"], ["hpi", "R2"], ["allergies", "R"], ["problems", "R2"], ["meds", "R2"], ["surgeries", "R2"],
      ["drains", "R2"], ["bloodgroup", "O"], ["immun", "R2"], ["vitals", "R2"], ["exam", "R2"], ["devices", "R2"], ["assessplan", "O"], ["careplan", "R"],
    ],
  },
  discharge: {
    type: "discharge", label: "Discharge Summary", blurb: "Summary of a hospital stay. Sent when the patient goes home.",
    templateId: "2.16.840.1.113883.3.3731.1.210.2", typeCode: "18842-5", typeDisplay: "Discharge Summary", title: "Discharge Summary",
    classCode: "SUMMARIES", performer: "O", plan: DISCHARGE_BASE,
  },
  operative: {
    type: "operative", label: "Operative Note", blurb: "One note for each surgery. Sent when the surgery is done.",
    templateId: "2.16.840.1.113883.3.3731.1.210.5", typeCode: "11504-8", typeDisplay: "Surgical operation note", title: "Operative Note",
    classCode: "REPORT", performer: "M",
    plan: [
      ["preop", "R"], ["postproc", "R2"], ["procdone", "R"], ["findings", "R"], ["drains", "R2"], ["specimens", "R2"], ["complications", "R2"],
      ["anesthesia", "R2"], ["ebl", "R2"], ["fluids", "R2"], ["procdesc", "R"], ["problems", "R"], ["devices", "O"], ["transfusion", "R"],
      ["acuity", "R"], ["careplan", "R2"], ["postop", "R"], ["planned", "R"], ["procdisp", "R"],
    ],
  },
  maternal: {
    type: "maternal", label: "Maternal Discharge Summary", blurb: "Summary of the mother's stay after a delivery.",
    templateId: "2.16.840.1.113883.3.3731.1.210.3", typeCode: "97702-5", typeDisplay: "Maternal and Fetal Medicine Discharge Summary", title: "Maternal Discharge Summary",
    classCode: "SUMMARIES", performer: "O", plan: MATERNAL,
  },
  newborn: {
    type: "newborn", label: "Newborn Discharge Summary", blurb: "Summary of the baby's stay. Not created for a stillbirth.",
    templateId: "2.16.840.1.113883.3.3731.1.210.4", typeCode: "78418-1", typeDisplay: "Neonatal perinatal medicine Discharge summary report for display or printing", title: "Newborn Discharge Summary",
    classCode: "SUMMARIES", performer: "O", plan: NEWBORN,
  },
};

/**
 * Things the app assumes because the guide and the official samples do not give a value.
 * Listed in Developer View. Codes that start with DEMO- are stand-ins, never real NPHIES codes.
 */
export const ASSUMPTIONS: string[] = [
  "Codes that start with DEMO- are stand-ins. The real values are in the IS0200 data dictionary, which was not available. The validator warns about each one.",
  "Healthcare facility type (metadata, page 17596480, 'Healthcare Facility Type of Care'): the code system 2.16.840.1.113883.3.3731.1.202.2 is from the official sample. The codes are DEMO- codes.",
  "Practice setting (metadata, page 17596480, 'Facility Medical Unit and Department'): the code system 2.16.840.1.113883.3.3731.1.202.6 is from the official sample. The code sent is the medical unit code the ADT messages use (CS-Adm-MedicalUnitIdentifier, page 23200557), on the assumption that both lists are the same.",
  "Content type (metadata, page 17694733, 'Content Type Code'): HOSPITAL-VISIT is the only value seen in the official samples, so it is sent for every document.",
  "Class code for the Operative Note: the Document Metadata page (15892543) says REPORT, the official ITI-41 sample says REPORTS. REPORT is sent.",
  "Author role (page 15859954, 'KSA Individual Provider Type'): 100000003 Medicine and Surgery is from the official samples. Its code system is written as 2.16.840.1.113883.3.3731.1.202.1, as in the medication samples; the CDA sample labels it SNOMED CT.",
  "Author specialty (page 15859954, 'Healthcare Specialty Identifier'): DEMO-SPEC codes are sent with the real code system 2.16.840.1.113883.3.3731.1.202.5.",
  "Vital signs (page 17694890, 'LOINC codes' value set): the table is not published. 8480-6, 8462-4 and 8867-4 are in the official sample. 8310-5, 59408-5, 9279-1 and 29463-7 are standard LOINC codes (the sample uses 3141-9 for weight).",
  "Apgar (page 17597275, 'LOINC Codes 2' value set): the table is not published. 9272-6 (1 minute), 9274-2 (5 minutes) and 9271-8 (10 minutes) are standard LOINC codes. The official sample uses 9273-4 for 5 minutes.",
  "Mode of delivery (page 17695325, 'Method of Delivery'): code 1 Vaginal - non-instrumental is from the official sample. Other modes use DEMO-MODE codes.",
  "Pregnancy history (page 17695143): the chart holds one baby per delivery record, so one observation is sent: 45371-2 Multiple pregnancy = false. Earlier pregnancies are not in the chart.",
  "Medications entries (page 16745055) carry the demo drug and dose form codes of the pharmacy catalogue. Structured dosage is not written; dose, route and frequency are in the narrative.",
  "A required medication section with no medicines is sent as narrative only. The 'no medication' entry needs a code from the 'Qualifier of Detection' value set (page 16745055), which is not published.",
  "Allergy substance (page 17629252): sent only when the chart holds a SNOMED CT code for it. An allergy with no type is sent as a drug allergy (DALG).",
  "Document ids, the set id and the visit number use the organisation OID from reference-data (ORG_OID), a demo value. Organisation id and provider ids are demo values too.",
  "City and postal code are not held in the chart. They are sent with nullFlavor UNK, which the address page (15859889) allows.",
  "nphies:documentStatus is written like the official sample, with the FHIR DiagnosticReport status code system. A replacement is sent as 'amended'.",
  "Document metadata lists serviceStartTime and serviceStopTime as 'Not present' per type, although the optionality table says R2. The per-type table is followed.",
  "The legal authenticator is the attending doctor and the e-signature is simulated.",
  "The registry response is simulated. No network call is made.",
];
