/**
 * Compliance map: what each framework asks for, how this app addresses it, and an honest status.
 * This is a design aid for the HIS team. It is not a certification and not legal advice.
 * Framework details were checked against public sources where noted. CBAHI and HIMSS EMRAM criteria are
 * licensed documents, so those rows are mapped by theme and must be verified against the licensed text.
 */

export type Status = "Applied" | "Partial" | "Not applied" | "Needs backend";

export interface Control {
  id: string;
  requirement: string;
  how: string;
  status: Status;
  /** Route to see it, if any. */
  where?: string;
}

export interface Framework {
  id: string;
  name: string;
  scope: string;
  /** How sure we are about the content of this framework mapping. */
  confidence: string;
  source?: string;
  controls: Control[];
}

export const FRAMEWORKS: Framework[] = [
  {
    id: "nphies",
    name: "NPHIES UHR (Unified Health Record)",
    scope: "Saudi national exchange: ADT, laboratory, radiology, medication, clinical documents.",
    confidence: "High. Read from the NPHIES-CS Integration Guide pages and the Seha conformance workbook.",
    source: "nphies.atlassian.net NPHIES-CS Integration Guide",
    controls: [
      { id: "nphies-adt", requirement: "ADT HL7 v2.5.1 events A01 to A50 with the segment table, Health ID in PID-3, provider OIDs, visit number in PV1-19", how: "All 15 events plus the CNHI A08 variant, validated against the table. A03 AL1 treated as ignored.", status: "Applied", where: "/spec" },
      { id: "nphies-visit", requirement: "One visit number across ADT, lab, radiology, medication, documents", how: "Every order, result, prescription and document carries the encounter visit number.", status: "Partial", where: "/chart" },
      { id: "nphies-lab", requirement: "FHIR laboratory order and result bundles, amendments", how: "Lab workflow with bundle builder, validator and conformance panel.", status: "Partial", where: "/lab" },
      { id: "nphies-rad", requirement: "FHIR radiology order and report bundles, amendments", how: "Radiology workflow with bundle builder, validator and conformance panel.", status: "Partial", where: "/radiology" },
      { id: "nphies-rx", requirement: "Raqeeb prescription and dispense (FF, FFP, FFC, N/C/R reference id)", how: "E-prescribe in the chart and a pharmacy dispense worklist.", status: "Partial", where: "/pharmacy/dispense" },
      { id: "nphies-docs", requirement: "CDA clinical documents over ITI-41 (discharge, outpatient, operative, maternal, newborn)", how: "Document generation, preview, amendment and the death exception.", status: "Partial" },
      { id: "nphies-ed", requirement: "Emergency visits in the CNHI discharge update: ZPV1-17 to 22 (arrival time and mode, doctor start, disposition, triage time, triage category)", how: "The ED board captures them with CTAS levels and clocks, and the A08 CNHI fills them. The codes for mode, disposition and category are placeholders.", status: "Partial", where: "/er" },
      { id: "nphies-vitals", requirement: "Vital Signs ORU^R01: panel with OBR (business id, code 85353-1, time, status F/C/X) and OBX readings from the value set; amend, cancel panel, cancel reading, historical batch", how: "Vital signs tab records panels, builds and validates the ORU, simulates AA / AE, and tracks the eight example scenarios.", status: "Partial", where: "/chart" },
      { id: "chi-vitals", requirement: "CHI claims and authorizations: systolic, diastolic, pulse, temperature, height, respiratory rate, weight, oxygen saturation and chief complaint, each a value or an absence reason", how: "A claim readiness strip shows what is missing. Readings or absence reasons feed the claim supportingInfo preview. The full claim is not built.", status: "Partial", where: "/chart" },
      { id: "nphies-ack", requirement: "Acknowledgments and error handling for every message", how: "Responses are simulated in the app. There is no live connection.", status: "Needs backend" },
      { id: "nphies-conn", requirement: "HTTPS connection, onboarding OIDs and certificates", how: "Placeholders and demo OIDs only.", status: "Needs backend" },
    ],
  },
  {
    id: "hipaa",
    name: "HIPAA Security Rule, technical safeguards (45 CFR 164.312)",
    scope: "US law. Not binding in Saudi Arabia, included because it is a common benchmark.",
    confidence: "High for the five standards. They are access control, audit controls, integrity, person or entity authentication, and transmission security.",
    source: "hhs.gov Summary of the HIPAA Security Rule; eCFR 164.312",
    controls: [
      { id: "hipaa-access", requirement: "Access control: unique user identification, emergency access procedure, automatic logoff, encryption", how: "Role based permissions, break-the-glass with a reason for confidential records, idle screen lock. Encryption needs a server.", status: "Partial", where: "/access" },
      { id: "hipaa-audit", requirement: "Audit controls: record and examine activity in systems with patient data", how: "Audit trail of views, changes, sends, denials, break-the-glass and AI actions.", status: "Applied", where: "/audit" },
      { id: "hipaa-integrity", requirement: "Integrity: protect data from improper change or destruction", how: "Amendments replace with history, cancel events instead of deletes. Hashing and tamper evidence need a server.", status: "Partial" },
      { id: "hipaa-auth", requirement: "Person or entity authentication", how: "Demo user switcher only. Real sign-in, multi-factor and single sign-on need a server.", status: "Needs backend" },
      { id: "hipaa-transmission", requirement: "Transmission security", how: "No transmission in the app.", status: "Needs backend" },
      { id: "hipaa-min", requirement: "Minimum necessary", how: "Menus and actions follow the role. Pharmacy sees prescriptions, lab sees lab, billing sees billing.", status: "Partial", where: "/access" },
    ],
  },
  {
    id: "himss",
    name: "HIMSS EMRAM (stages 0 to 7)",
    scope: "Electronic Medical Record Adoption Model. An eight stage model of EMR maturity.",
    confidence: "Medium. Stage themes are general knowledge. The scored criteria are licensed by HIMSS, so verify there. An app like this cannot be certified.",
    source: "himss.org/maturity-models/emram",
    controls: [
      { id: "himss-1", requirement: "Stage 1: ancillary systems (laboratory, radiology, pharmacy)", how: "Lab, radiology and pharmacy workflows with worklists.", status: "Partial", where: "/lab" },
      { id: "himss-2", requirement: "Stage 2: clinical data repository, controlled vocabulary, basic decision support, health information exchange", how: "Coded data (ICD-10-AM, SNOMED CT, LOINC), one chart, NPHIES exchange. Basic rule checks.", status: "Partial" },
      { id: "himss-3", requirement: "Stage 3: nursing documentation, electronic medication administration record, decision support error checking", how: "Nursing forms are built. No electronic medication administration record yet.", status: "Partial", where: "/chart" },
      { id: "himss-4", requirement: "Stage 4: computerized provider order entry with decision support", how: "Order entry for lab, radiology and drugs with allergy and duplicate checks.", status: "Partial" },
      { id: "himss-5", requirement: "Stage 5: closed loop medication administration with barcode checks", how: "Barcode scan simulation at dispense only. Not at the bedside.", status: "Not applied" },
      { id: "himss-6", requirement: "Stage 6: structured physician documentation, full decision support", how: "Structured forms and SOAP notes. Decision support is basic.", status: "Partial" },
      { id: "himss-7", requirement: "Stage 7: complete EMR, data analytics, continuity of care across organizations", how: "Document exchange with NPHIES is modelled. No analytics layer.", status: "Partial" },
    ],
  },
  {
    id: "cbahi",
    name: "CBAHI (Saudi Central Board for Accreditation of Healthcare Institutions)",
    scope: "National hospital accreditation. Mapped by theme.",
    confidence: "Low to medium. The standards manual is licensed and I did not have it. Themes are general. Check each row against the licensed CBAHI manual and cite standard numbers there.",
    controls: [
      { id: "cbahi-id", requirement: "Patient identification with two identifiers before care", how: "Patient header shows name, age, sex, Health ID and MRN on every chart. Confirmation toasts name the patient.", status: "Partial", where: "/chart" },
      { id: "cbahi-im", requirement: "Information management: authorized access, record completeness, timeliness, confidentiality", how: "Roles, break-the-glass, audit trail, discharge needs a diagnosis, unsent changes are flagged.", status: "Partial", where: "/audit" },
      { id: "cbahi-med", requirement: "Medication management: ordering, high-alert and controlled drugs, allergy checks, dispensing verification", how: "Prescribing with allergy and duplicate checks, controlled drug flow, dispense verification.", status: "Partial", where: "/pharmacy/dispense" },
      { id: "cbahi-vitals", requirement: "Monitoring and early detection of deterioration with documented vital signs", how: "Vitals trend, abnormal flags, a NEWS2 score and a next-due clock for inpatients. No public CBAHI text on vitals was found, so frequencies are examples.", status: "Partial", where: "/chart" },
      { id: "cbahi-crit", requirement: "Critical test result reporting", how: "Critical values are highlighted in lab results. Call-back documentation is not built.", status: "Partial", where: "/lab" },
      { id: "cbahi-risk", requirement: "Risk assessments: falls, pressure ulcers, pain, restraints", how: "Humpty Dumpty falls scale, pressure ulcer chart, pain scales and restraint monitoring forms.", status: "Applied", where: "/chart" },
      { id: "cbahi-handoff", requirement: "Hand-off and discharge communication", how: "Discharge summary and clinical documents.", status: "Partial" },
      { id: "cbahi-consent", requirement: "Patient rights and consent", how: "Consent to use and share the record is captured at registration and time stamped. Treatment consents are not built.", status: "Partial", where: "/registration" },
      { id: "cbahi-down", requirement: "Downtime and business continuity", how: "No downtime mode.", status: "Not applied" },
    ],
  },
  {
    id: "pdpl",
    name: "Saudi Personal Data Protection Law (PDPL)",
    scope: "Law issued by SDAIA. Applies to personal data of people in the Kingdom, including health data and AI systems that use it.",
    confidence: "Medium. The law text is on the SDAIA site. This row list is a design summary, not legal advice.",
    source: "sdaia.gov.sa Personal Data Protection Law",
    controls: [
      { id: "pdpl-purpose", requirement: "Purpose limitation and data minimization", how: "NPHIES receives only the segments it needs. Demographics are not stored by NPHIES.", status: "Partial" },
      { id: "pdpl-consent", requirement: "Lawful basis and consent where needed", how: "Consent to use and share data is captured at registration. Withdrawal and purpose-specific consent are not built.", status: "Partial", where: "/registration" },
      { id: "pdpl-rights", requirement: "Data subject rights: access, correction, deletion", how: "Not built.", status: "Not applied" },
      { id: "pdpl-account", requirement: "Accountability and records of processing", how: "Audit trail records who used which record and why.", status: "Partial", where: "/audit" },
      { id: "pdpl-transfer", requirement: "Rules for transferring data outside the Kingdom", how: "All data stays in the browser. A real deployment must host in the Kingdom.", status: "Needs backend" },
      { id: "pdpl-breach", requirement: "Breach notification", how: "Not built.", status: "Not applied" },
    ],
  },
  {
    id: "nca",
    name: "NCA cybersecurity controls (Essential Cybersecurity Controls, Cloud Cybersecurity Controls)",
    scope: "Saudi National Cybersecurity Authority. Applies to the hosting and operation of the real system.",
    confidence: "Low to medium. I did not read the control text. Rows are themes.",
    controls: [
      { id: "nca-iam", requirement: "Identity and access management, least privilege", how: "Roles and permissions model. No real identity provider.", status: "Partial", where: "/access" },
      { id: "nca-log", requirement: "Logging and monitoring", how: "Audit trail. No central log or alerting.", status: "Partial", where: "/audit" },
      { id: "nca-session", requirement: "Session management and timeouts", how: "Idle lock after a set time.", status: "Applied", where: "/access" },
      { id: "nca-crypto", requirement: "Cryptography for data at rest and in transit", how: "Needs a server.", status: "Needs backend" },
      { id: "nca-cloud", requirement: "Cloud hosting rules, in-Kingdom hosting", how: "Deployment decision.", status: "Needs backend" },
    ],
  },
  {
    id: "ai",
    name: "AI governance (SDAIA AI Ethics Principles, SFDA software and AI guidance)",
    scope: "SDAIA published AI ethics principles in 2023. They are not binding legislation. SFDA regulates software that works as a medical device.",
    confidence: "Medium. See the AI Governance page for the use case register.",
    source: "sdaia.gov.sa AI Ethics Principles and Controls",
    controls: [
      { id: "ai-human", requirement: "Human in the loop: AI output is a draft that a clinician accepts, edits or rejects", how: "Every AI output has Accept, Edit and Reject, and is audited.", status: "Applied", where: "/ai-governance" },
      { id: "ai-transparency", requirement: "Transparency: say it is AI, show what data it used", how: "Labels and a sources list on every output.", status: "Applied", where: "/ai-governance" },
      { id: "ai-sim", requirement: "Validation and clinical safety evidence", how: "The assistant is simulated with rules. It has not been clinically validated.", status: "Not applied" },
      { id: "ai-sfda", requirement: "SFDA classification if the software acts as a medical device", how: "Not assessed. This app is not a certified medical device.", status: "Not applied" },
      { id: "ai-privacy", requirement: "Privacy: no use of patient data to train models without a lawful basis", how: "No model and no network calls in the app.", status: "Applied" },
    ],
  },
];

export function summarize(f: Framework): Record<Status, number> {
  const out: Record<Status, number> = { Applied: 0, Partial: 0, "Not applied": 0, "Needs backend": 0 };
  for (const c of f.controls) out[c.status] += 1;
  return out;
}
