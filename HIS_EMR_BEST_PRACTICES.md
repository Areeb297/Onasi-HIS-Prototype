# HIS and EMR Best Practices

Best practices for clinical EMRs and hospital information systems, drawn from US guidance and systems (Epic, Oracle Health / Cerner), Saudi cloud HIS vendors (OASIS and others), and NPHIES. Written for the Onasi EMR Prototype team.

## How to read this file

- **Source-backed** means I read the source page. The link is in the section.
- **General practice** means it is widely accepted in clinical informatics, but I did not find a single page to cite for it in this research. Treat it as a design principle, not a quote.
- Epic and Oracle Health details come from public tip sheets, hospital training pages and third-party articles. They are not vendor product documents. Check anything you plan to copy exactly.
- Vendor claims (market share, bed counts) are marketing statements. They are listed as claims.

---

## 1. Safety foundations (US)

**Source-backed.** The US ONC "SAFER Guides" were updated in 2025 into eight guides in three groups. They are the best single checklist for a safe EMR. ([healthit.gov SAFER Guides](https://healthit.gov/clinical-quality-and-safety/safer-guides/))

| Group | Guide | What it covers |
|---|---|---|
| Foundational | High Priority Practices | 16 recommendations picked from the other guides |
| Foundational | Organizational Responsibilities | Who owns EHR safety. New in 2025: governance of AI-enabled features |
| Infrastructure | Contingency Planning | Planned and unplanned downtime, when staff cannot reach the EHR |
| Infrastructure | System Management | Configuration, validation, maintenance, hardware, APIs |
| Clinical process | Patient Identification | Making sure information is tied to the right person |
| Clinical process | CPOE with Decision Support | Order structure, order libraries, alerts and warnings |
| Clinical process | Test Results Reporting and Follow-Up | Sending results and making sure someone acts on them |
| Clinical process | Clinician Communication | Messages, care transitions such as discharge and referral |

**Practices to adopt**
1. Treat EMR safety as an ongoing programme with named owners, not a go-live task.
2. Plan downtime before go-live: read-only access, paper forms, and a way to back-load data.
3. Test with safety scenarios, not only happy paths (wrong patient, duplicate order, missing result).
4. Govern AI features the same way as any other clinical tool: owner, validation, monitoring.

## 2. Usability problems that cause harm

**Source-backed.** A 2018 report by the AMA, Pew and MedStar Health, summarised by the AMA, found seven repeating problems in 557 safety reports. ([AMA summary](https://www.ama-assn.org/practice-management/digital-health/7-ehr-usability-safety-challenges-and-how-overcome-them))

| Problem | Example from the report | Design response |
|---|---|---|
| Data entry | Option order changed, so the wrong frequency was chosen | Keep list order stable. Show the full selected value after entry |
| Alerting | Allergy was on file but no alert fired | Test alerts with real scenarios. Missing alerts are a safety risk too |
| Interoperability | Lab results held in another part of the hospital were not visible | One patient record view across departments |
| Visual display | 3.125 mg dose in small print under a 6.25 mg item | Make the exact dose and unit unmissable. No small print for critical values |
| Availability of information | Order details were stored where the lab could not see them | Put data where the next role looks for it |
| Automation and defaults | Start date silently defaulted to tomorrow | Show every default. Never default silently on clinical values |
| Workflow support | Instructions typed in a field the lab never saw | Confirm who can see a field. Do not offer fields nobody reads |

Other points from the same report: justify every customization with a use case, let clinicians and subject experts shape usability testing, and test at each stage of the product life cycle. It also quotes a study in which, for every 8 hours of scheduled patient time, office doctors spent more than 5 hours in the EHR. Reducing clicks is a safety and burnout issue, not only convenience.

## 3. The patient header (Epic "Storyboard", Oracle banner)

**Source-backed (training pages).**
- Epic's Storyboard is always visible in the left column. It shows demographics, allergies, problems, medications and social factors in summary form, whatever part of the chart is open. ([Connect Care glossary](https://ehealth.connect-care.ca/epic-systems/epic-modules/storyboard))
- At one US hospital it replaced the old header and banner. Its content depends on the user's role and the encounter type. There are about 68 variants. "Hover to discover" expands detail, and a click edits it. It cuts scrolling, clicks and page jumps. ([Johns Hopkins tip sheet, 2020](https://medicine-matters.blogs.hopkinsmedicine.org/2020/06/epic-tip-of-the-week-june-26-2020/))

**Practices to adopt**
1. Keep one patient header on screen at all times. Never let the user lose sight of who the patient is.
2. Show name, age, sex, two identifiers (MRN and DOB or national ID), location, visit, allergies.
3. Show allergies in red. Show "no allergies recorded" in a calm colour, so absence is also visible.
4. Vary the header by role and visit type (outpatient, inpatient, emergency).
5. Summaries first, detail on demand.

## 4. Configurable chart views (Oracle Health MPages)

**Source-backed (third-party article).** MPages are chart views built from a library of components. They give summary, orders, results and workflow views inside PowerChart. Organizations can pick standard ones or build custom ones. The same article lists the cost: learning curve, upkeep, and compatibility work. ([EHR Enhancify](https://ehrenhancify.com/oracle-health-mpages/))

**Practices to adopt**
1. Build views from reusable components (vitals, diagnoses, allergies, results) so a new view is cheap.
2. Let departments have a tailored view, but limit custom views. Each one has a maintenance cost.
3. Put the information a task needs on one screen, so users do not click around.

## 5. Decision support and alerts (Epic at Cleveland Clinic)

**Source-backed.** ([Cleveland Clinic ConsultQD](https://consultqd.clevelandclinic.org/fighting-alert-fatigue-to-improve-patient-safety-and-standardization-of-care))
- Before a governance group existed, clinicians saw over 3 million Epic Best Practice Advisory alerts per month. Too many alerts teach people to ignore all alerts.
- Decision support is not only pop-ups. Questions inside an order, grouped orders, note-template prompts and the order of items in a list are all decision support.
- Their rule is the "five rights": right information, to the right person, at the right time, in the right place, format and channel.
- A multi-disciplinary group reviews new alert requests, retires old alerts, and checks that approved alerts met their goal.
- Example: a request for an "overdue test" alert was solved by adding the test to an existing care-gap checklist. No interruption was needed.

**Practices to adopt**
1. Prefer passive guidance (checklists, defaults, inline banners) over pop-ups.
2. Every interruptive alert needs an owner, a goal and a measure of success.
3. Review alerts on a schedule and turn off those that do not work.
4. Put the safe choice at the top of a list. People pick from the top.

## 6. Orders, results and follow-up

**General practice, with the SAFER "CPOE with Decision Support" and "Test Results Reporting and Follow-Up" guides as the reference.**
1. Orders use coded catalogues (not free text) so results can be matched and reported to NPHIES.
2. Every result has an owner who must acknowledge it. Abnormal results are flagged by colour and text.
3. Show the reference range and unit next to every value.
4. Amendments keep history. The old result stays visible as "replaced".
5. Link orders, results and the visit with one visit number. NPHIES requires this (see section 9).

## 7. Documentation speed

**Source-backed (training pages and Epic tip sheet).**
- Add a diagnosis from anywhere in the visit with one control, not by going to a different screen. ([Hopkins tip sheet](https://medicine-matters.blogs.hopkinsmedicine.org/2020/06/epic-tip-of-the-week-june-26-2020/))
- Diagnosis search should forgive typos and alternative spellings (same source).

**General practice**
1. One-tap common items (chips) for complaints, diagnoses, allergies. Free text is the fallback.
2. Structured data first, because NPHIES needs codes (ICD-10-AM, SNOMED CT, LOINC).
3. Pre-fill from the chart, and show what was pre-filled.

## 8. Saudi cloud HIS and EMR landscape

**Vendor claims, not independent findings.**
- **OASIS** (Al Murjan Holding, Jeddah). Company site describes OASIS+ as a web-based, modular HIS where modules can run alone or share one central database. It also lists OASIS Practice (cloud app for clinics and polyclinics, with billing and a patient portal) and OASIS-Tele (virtual visits and remote monitoring). It claims about 26% of the local market and more than seventy hospitals. ([oasissys.com](https://oasissys.com/))
- A 2021 partner announcement said OASIS was active in 41 Saudi hospitals with 10,000 beds and that a library of 12,000 clinical decision support tools would be embedded in its EMR. ([Think Research](https://www.thinkresearch.com/ca/2021/05/27/think-research-saudi-arabia-oasis/))
- Other Saudi vendors market cloud or in-Kingdom hosting with NPHIES integration. Examples: AndroHealth (listed on Alibaba Cloud Marketplace via SCCC by stc, "hosted in-Kingdom") ([ahhis.com](https://ahhis.com/en/blog/andromeda-itc-nphies-implementation-guide-contributors)), and others found in search (icenna, Steady Solutions, Cloud Solutions). I did not review these in depth.
- A Saudi HIS buyer's checklist titled on the same site covers core modules, NPHIES and ZATCA compliance, cloud, security and support. I saw the title and summary only, not the full text.

**Practices to adopt (Saudi context)**
1. Host in the Kingdom and plan for national data rules.
2. Modular design: run a clinic with a few modules, a hospital with all of them, one patient record underneath.
3. Build NPHIES in from the start: ADT, labs, radiology, prescriptions, dispense, clinical summaries.
4. Support Arabic and English, right-to-left layout, and Hijri and Gregorian dates.
5. Support virtual care and home monitoring as first-class visit types.

## 9. NPHIES requirements the EMR must respect

**Source-backed.** From the NPHIES-CS Integration Guide pages (ADT, segment pages) and the Seha conformance workbook.

1. **One visit number everywhere.** The same visit ID must be used across ADT, laboratory report, radiology order, medication prescription and dispense. NPHIES links them by it.
2. **Patient identity.** PID-3 must carry the NHIC Health ID first, with assigning authority OID `2.16.840.1.113883.3.3731.1.1.100.1`. Without it the message is rejected. NPHIES does not process or store demographics.
3. **Provider identity.** Doctors are sent with the National Provider ID and assigning authority OID `2.16.840.1.113883.3.3731.1.2.1`.
4. **AL1 on A03 is ignored.** The "I" in the segment table means "ignored". It is not an error to send it, but it has no effect.
5. **Discharge needs a diagnosis (DG1).** Procedures (PR1) need a start date/time. Mark one diagnosis as primary.
6. **CNHI discharge update (A08).** Uses Z-segments ZPV1, ZDG1, ZPR1 with CNHI fields. Required when the visit has lab, radiology or medication data.
7. **Every message gets an acknowledgment.** Show sent, accepted and rejected states, and let staff fix and resend.
8. **Amendments and cancellations are normal flows.** Support them with history, not by editing in place.

## 10. Clinical communication and transitions

**SAFER "Clinician Communication" guide and general practice.**
1. Discharge produces a clinical summary. Send it to NPHIES as a document.
2. Show who needs to act next (result to review, order to sign, summary to send).
3. Every hand-off has a visible owner.

## 11. Contingency and trust

1. Show system status honestly (sent, accepted, failed, retrying).
2. Keep an audit trail: who did what, when, from where.
3. Allow undo for reversible actions by sending the proper cancel event, never by silently deleting.
4. Lock a chart or field while someone edits it, to avoid conflicting entries. (Epic training material mentions chart locking for this purpose. I saw this as a search snippet only.)

---

## What the Onasi EMR Prototype applies

| Practice | Where in the prototype | Status |
|---|---|---|
| Always-visible patient header with identifiers and allergies | Chart page header, sticky while scrolling | Applied |
| Allergies red, "no allergies" calm | Patient header, worklist shield icon | Applied |
| Role view: HIS View and Developer View | Switch at the top right | Applied |
| One-click actions with undo as a cancel event | Worklist icons and toast Undo (A02 to A12, A03 to A13, A01 to A11 and so on) | Applied |
| Passive guidance, no interruptive pop-ups | "Changes not sent" banner and badge, discharge checklist | Applied |
| Chips for one-tap entry | Complaints, diagnoses, procedures, allergies | Applied |
| Show every default | Dialogs show the chosen bed, doctor, disposition before sending | Applied |
| Patient name in every confirmation | Toasts include the patient name | Applied |
| Message status and checks | Message log, validation, View HL7 | Applied |
| A03 AL1 treated as ignored | Segment table and validator | Applied |
| Configurable views from components | Chart sections are separate components | Partly |
| Downtime mode | Not built | Not applied |
| Acknowledgment and resend states | Not built (no connection to NPHIES yet) | Not applied |
| Lab, radiology, e-prescribe, e-dispense, clinical summary | Planned | Not applied |
| Audit trail by user | Not built (single demo user) | Not applied |
| Arabic and right-to-left | Not built | Not applied |

## Sources

- ONC SAFER Guides: https://healthit.gov/clinical-quality-and-safety/safer-guides/
- AMA, 7 EHR usability and safety challenges: https://www.ama-assn.org/practice-management/digital-health/7-ehr-usability-safety-challenges-and-how-overcome-them
- Cleveland Clinic, fighting alert fatigue: https://consultqd.clevelandclinic.org/fighting-alert-fatigue-to-improve-patient-safety-and-standardization-of-care
- Epic Storyboard glossary: https://ehealth.connect-care.ca/epic-systems/epic-modules/storyboard
- Johns Hopkins Epic tip sheet: https://medicine-matters.blogs.hopkinsmedicine.org/2020/06/epic-tip-of-the-week-june-26-2020/
- Oracle Health MPages: https://ehrenhancify.com/oracle-health-mpages/
- OASIS: https://oasissys.com/
- Think Research and OASIS: https://www.thinkresearch.com/ca/2021/05/27/think-research-saudi-arabia-oasis/
- Andromeda ITC / AndroHealth: https://ahhis.com/en/blog/andromeda-itc-nphies-implementation-guide-contributors
- NPHIES-CS Integration Guide, ADT pages: https://nphies.atlassian.net/wiki/spaces/NPHIES/pages/7766284/ADT
- Seha All Use Cases conformance template (local workbook)
