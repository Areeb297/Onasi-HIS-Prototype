/**
 * Places where the NPHIES snapshot is silent or unclear. Shown in Developer View as "Assumptions".
 * Nothing here is claimed to be an NPHIES requirement.
 */

export const COMMON_ASSUMPTIONS: string[] = [
  "Entry fullUrl is urn:uuid:<id>. References are Type/<GUID> with the target identifier copied in, as the pages ask. The pages say fullUrl is 'the UUID in the id element' without giving the form.",
  "PractitionerRole, Observation, DiagnosticReport, Procedure and Endpoint carry an identifier, although the pages list none. Every reference must repeat the target identifier, so they need one.",
  "Composition.confidentiality uses HL7 v3 code N. The KSA Confidentiality Code value set is not in the snapshot.",
  "An amendment keeps the same Composition.identifier (the document set), raises the version number extension, gets a new Bundle id and identifier, and sets Composition status to amended, corrected or cancelled. No relatesTo element is added because the pages do not mention one.",
  "Units use UCUM. The KSA unit value sets are not in the snapshot.",
  "Encounter.status and Observation.subject are sent because FHIR R4 needs or allows them, although the pages do not list them.",
  "The 'view in the provider portal' steps (x.x.3) are manual. The tester ticks them. This app has no real portal.",
];

export const LAB_ASSUMPTIONS: string[] = [
  "Laboratory Department uses HL7 table 0074 codes (HM, CH, MB, SR). Specimen type uses SNOMED CT. The NPHIES value sets are not in the snapshot.",
  "The Observation status set is final, amended, corrected, cancelled, entered-in-error. The 'nphies FHIR Observation Status' value set is not in the snapshot.",
  "A cancelled observation keeps its last value. The page says the value is mandatory unless the observation is a panel.",
  "The bundle page asks for at least one Additional Order Information observation, the Composition page says R2. The app always sends the patient age, plus the first diagnosis, weight and fasting state when known.",
  "Preliminary diagnosis uses the code system URL http://hl7.org/fhir/sid/icd-10-am. The 'Principal Diagnosis' value set is not in the snapshot.",
  "Filler order numbers and specimen ids use made-up sub-OIDs of the participant OID.",
  "A panel Observation gets referenceRange.text 'undefined' because the pages make the range text mandatory.",
  "Microbiology sensitivities are separate Observations in the same section. Their antibiotic codes are made-up (test code).",
  "Order result bundles are sent only once all specimens are collected, so every leaf Observation links its Specimen.",
];

export const RAD_ASSUMPTIONS: string[] = [
  "The imaging procedure code system URL is made-up. The 'KSA Imaging Procedure' value set is not in the snapshot. Codes in the NICIP style are marked (test code) unless they appear in the Mapping Guide.",
  "Modalities use DICOM modality codes, body regions use SNOMED CT body structures. Those value sets are not in the snapshot.",
  "Composition section codes for the radiology report (imaging study, procedures, findings, impression, addendum, clinical information, comparison) are LOINC codes chosen by the app. The snapshot lists the sections but not their codes.",
  "Composition.title for the report is 'Radiology Report'. The snapshot does not show the title row.",
  "The report type list (CT Report, MR Report, X-Ray Report and so on) is in the snapshot without its element name, so it is not sent.",
  "Only the structured report form is built. The embedded PDF form is not.",
  "The ImagingStudy and Endpoint come as a pair. With 'images available' off, neither is sent and the Imaging Study section is a narrative, as the page says.",
  "The bundle page asks for at least one Additional Order Information observation. The app always sends the patient age, plus the first diagnosis and weight when known.",
  "A radiology order bundle holds one ServiceRequest, so ordering three procedures makes three orders.",
];
