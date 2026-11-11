/**
 * Shown in Developer View as "Assumptions": what the app does and where that comes from in the NPHIES guide,
 * followed by the points the guide does not settle ("Open question").
 */

/**
 * Shared by the laboratory and radiology documents. The first lines say what the live guide and its official sample
 * bundles state (Confluence page ids in brackets). Lines that start with "Open question" need an answer from NPHIES.
 */
export const COMMON_ASSUMPTIONS: string[] = [
  "Entry fullUrl is urn:uuid:<id>, as in every official sample bundle (pages 358776855 and 358514693). References are Type/<GUID> with the target identifier copied in, as the pages ask.",
  "A PractitionerRole has no identifier of its own (page 67993867). A reference to a role repeats the Practitioner's provider id, as the official samples do. Observation and DiagnosticReport carry an identifier from the organization root OID so that references to them can repeat it.",
  "Practitioner.identifier is the id from the national provider directory (page 68026521). The ids in this demo are made-up. The app never sends its own user id.",
  "Composition.confidentiality is N. The KSA Confidentiality Code value set has N (normal) and R (restricted) (page 23168947).",
  "An amendment keeps the same Composition.identifier (the document set), raises the version number extension, gets a new Bundle id and identifier, and sets Composition status to amended, corrected or cancelled (pages 351797257 and 67993636). The pages have no relatesTo element, so none is sent. The new version must carry a later date and time than the stored one (Error Handling Guide, page 58687511, item 7.1.0).",
  "Encounter.class uses urn:oid:2.16.840.1.113883.18.5 with E, I, O or D (page 67961103). Any other class is sent as O. The old pre-admit class P is never sent, because P means primary care in the NPHIES Patient Class value set (page 23134851).",
  "Open question, confirm with a test send: the form of the LOINC, UCUM and ICD-10-AM code systems. The pages name the value sets but not the system. Every official sample uses the OID form (urn:oid:2.16.840.1.113883.6.1, ...6.8 and ...6.135), so the app sends that. One setting, CODE_SYSTEM_FORM in common.ts, switches all three to the URL form. Composition.type and DiagnosticReport.code always use http://loinc.org because the pages fix it.",
  "Open question: the samples write the organization root OID and other identifier systems without the urn:oid: prefix and put identifiers inside references as a list. The app sends valid FHIR: urn:oid: plus the OID, and one identifier object.",
  "Encounter.status is sent because FHIR R4 needs it and the samples have it, although the Encounter page does not list it.",
  "The 'view in the provider portal' steps (x.x.3) are manual. The tester ticks them. This app has no real portal.",
];

/**
 * Laboratory. Same layout: what the guide states first, then the open questions.
 */
export const LAB_ASSUMPTIONS: string[] = [
  "Section codes are LOINC codes from the Laboratory Department value set, for example 18723-7 Hematology Studies and 18725-2 Microbiology (page 23234312).",
  "Specimen types are SNOMED CT codes from the Specimen Type value set, CS-Lab-SpecimenType v2.0 (page 30736696).",
  "Units are UCUM codes from the KSA Laboratory Observation Units value set (page 23135664). The validator holds the full list. A number that has no unit, such as urine specific gravity, is sent as a value alone, because the unit '1' is not in the list.",
  "Observation, DiagnosticReport and Composition status is one of final, amended, corrected, cancelled, entered-in-error (pages 23234342, 67993689, 67993636). A ServiceRequest is active in an order, also in a cancelled one, and completed in a report (pages 358580229 and 67993727).",
  "Each ordered test gets its placer order number when it is ordered and keeps it in every amendment and in the report. Order and report are linked by that number (page 358580229).",
  "Observation.performer is the person who entered or last changed that result, not the person who publishes the document (page 67993712). A result can be published only by a user who has a provider id.",
  "The ServiceRequest in a report links its Specimen when the specimen is known (page 67993727).",
  "Test codes, names and susceptibility codes are LOINC and were checked against the LOINC table. Organisms are SNOMED CT codes that are in the KSA Organism value set (page 31719435). Susceptibility results use S, I and R (page 31653921).",
  "A whole laboratory report cannot be withdrawn (status cancelled or entered-in-error) from this app yet. Single results can be cancelled in an amendment.",
  "Open question: the 'nphies Observation Interpretation' value set is not published. The app sends N, H, L, HH, LL, A, POS and NEG from HL7 v3 ObservationInterpretation; the samples show only N and H.",
  "Open question: the 'KSA Laboratory Orders and Results' and 'Principal Diagnosis' value sets are on the NHIC website, not in the guide (pages 23234115 and 23200575). The catalogue is LOINC, but membership of each code in the national list was not checked.",
  "Open question: Additional Order Information. The bundle page says at least one is mandatory (page 351698947), the Composition page says send if known (page 351797257). The app always sends the patient age, plus the first diagnosis, weight and fasting state when known.",
  "Open question: a cancelled observation keeps its last value. The page makes the value mandatory unless the observation is a panel and does not say what a cancelled result should hold (page 67993712).",
  "Open question: a panel Observation gets referenceRange.text 'undefined' because the page makes the range mandatory (page 67993712). The panel Observations in the official samples have no reference range.",
  "Open question: microbiology. The pages do not say how to send an organism with its susceptibilities. The app sends the organism as the culture result and each antibiotic as its own Observation in the Microbiology section.",
  "Open question: SNOMED CT on specimen type and organism is sent as http://snomed.info/sct. The pages use the OID form (urn:oid:2.16.840.1.113883.6.96) only for Additional Order Information and for 'incomplete result'. The samples use HL7 table codes for specimen type, which are not in the value set.",
  "Open question: Additional Order Information is sent with effectiveDateTime (the FHIR spelling). The page and the samples spell it effectivedateTime (page 359432193).",
  "Filler order numbers and specimen ids use made-up sub-OIDs of the participant OID. The real ones are assigned at onboarding (pages 67993727 and 67993763).",
];

/**
 * Radiology. The first lines say what the live guide states (Confluence page ids in brackets).
 * The lines that start with "Open question" are the points the guide does not settle; they need an answer from NPHIES.
 */
export const RAD_ASSUMPTIONS: string[] = [
  "Procedure codes come from the KSA Imaging Procedure value set, CS-Rad-Procedure v2.0 (page 23168870). Every code in the order pad was looked up in that list. Modality and report title per procedure are taken from the same list.",
  "Modality uses the Modalities value set with system urn:oid:1.2.840.10008.2.16.4 (page 39780455). Body site uses one of the 11 KSA Body Regions with system urn:oid:2.16.840.1.113883.6.96 (page 39846061).",
  "Section codes, displays and titles are fixed by the guide: one page per section under the Composition pages (391020558 for the order, 414547978 for the report). Section text uses portal tags such as <paragraph>, with no <div> and no XHTML.",
  "The report title is one of twelve fixed titles, for example X-Ray Report or CT Report (page 414547978).",
  "The reason for the exam is mandatory in this app, because NPHIES rejects an order without the Procedure Indications sub-section (Error Handling Guide, page 58687511, item 1.1.7).",
  "A critical result that was called to the clinician is sent in the Communication sub-section under Impressions (page 414613515).",
  "A reference to a PractitionerRole repeats the practitioner's provider id, and the role has no identifier of its own, as in the official samples (pages 387481602 and 414089220). The role page lists no identifier (page 45023260).",
  "Radiology documents are sent only for emergency, inpatient, outpatient and day case visits: Encounter.class must be E, I, O or D (page 414875649).",
  "The ImagingStudy and Endpoint come as a pair. With 'images available' off, neither is sent and the Imaging Study section is a narrative (page 414154754).",
  "A radiology order bundle holds exactly one ServiceRequest, so ordering three procedures makes three orders (page 387383323).",
  "Only the structured report form is built. The embedded PDF form is not. A published report cannot be withdrawn (status cancelled or entered-in-error) from this app yet.",
  "Open question: the procedure code system. The app sends urn:oid:2.16.840.1.113883.3.3731.1.204.15, as the official order sample does. The report sample uses ...1.204.15.1 and the value set workbook lists 1.2.840.10008.6.1.1437 for most codes.",
  "Open question: patient and practitioner details. The pages linked from the radiology guide make Patient name, gender and birth date, Practitioner address and telecom, PractitionerRole code and specialty, and Organization name mandatory (pages 45056002, 45023239, 45023260, 45121621). The official radiology samples send identifiers only. The app sends identifiers plus the practitioner name.",
  "Open question: body region for multi-area exams. The value set workbook files some procedures (for example CT Abdomen and pelvis w/C) under 'Multi Area' or 'Nonspecific', which are not among the 11 KSA Body Regions. The app sends Abdomen for that exam.",
  "Open question: Additional Order Information. The bundle page says at least one is mandatory (page 387383323), the Composition page says send if known (page 391020558). The app always sends the patient age, plus the first diagnosis and weight when known.",
  "Open question: references to the ServiceRequest in a report. The guide asks for 'exactly the same Identifier'; the request has two (placer and accession) and a FHIR reference holds one. The app repeats the placer number.",
  "Open question: code systems seen only in the samples. Units use urn:oid:2.16.840.1.113883.6.8 and the diagnosis uses urn:oid:2.16.840.1.113883.6.135 as the order sample does; the pages name the value sets but not the system form.",
  "Open question: the accession number uses a made-up sub-OID of the participant OID as the filler namespace. The samples use the organization root OID for both placer and accession numbers.",
];
