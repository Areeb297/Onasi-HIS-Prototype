# NPHIES ADT HIS Prototype: Brief

Goal: a clickable prototype of a Hospital Information System (HIS) that covers every NPHIES ADT scenario, so the team can test and demonstrate UHR (Unified Health Record) ADT messages while the real HIS has bugs. Build the UI with the 21st.dev MCP (Magic) tools.

Sources:
- `C:\Users\ashafqat\Downloads\NPHIES-ADT Event Use-Cases, Clinical Workflows, and Purposes-081126-131911.pdf` (4 pages, use case, workflow and purpose per event)
- NPHIES Confluence page "ADT": https://nphies.atlassian.net/wiki/spaces/NPHIES/pages/7766284/ADT (the table below was pasted by the user from it)

## What nphies expects

- HL7 v2 ADT messages, sent by the HIS on standard HL7 v2.5.1 event triggers.
- The feed is an encounter event history. PV1 is required in every message.
- Patient demographics are not processed or stored by nphies.
- Where this page gives no detail, follow HL7 v2.5.1 for field function, format and definition.

## Segment table (R = required, O = optional, - = not present)

| Event | Name | MSH | EVN | PID | PD1 | PV1 | PV2 | AL1 | DG1 | PR1 | MRG |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A01 | Admit/Visit Notification | R | R | R | O | R | O | O | O | O | - |
| A02 | Transfer a patient | R | R | R | O | R | O | - | - | - | - |
| A03 | Discharge/end visit | R | R | R | O | R | O | I (as pasted, see below) | R | O | - |
| A04 | Register a patient | R | R | R | O | R | O | O | O | O | - |
| A05 | Pre-admit a patient | R | R | R | O | R | O | O | O | O | - |
| A06 | Change an outpatient to an inpatient | R | R | R | O | R | O | O | O | O | - |
| A07 | Change an inpatient to outpatient | R | R | R | O | R | O | O | O | O | - |
| A08 | Update patient information | R | R | R | O | R | O | O | O | O | - |
| A11 | Cancel admit/visit notification | R | R | R | O | R | O | - | O | - | - |
| A12 | Cancel transfer | R | R | R | O | R | O | - | O | - | - |
| A13 | Cancel discharge/end visit | R | R | R | O | R | O | O | O | O | - |
| A31 | Update person information | R | R | R | O | R | O | O | O | O | - |
| A38 | Cancel pre-admit | R | R | R | O | R | O | - | O | - | - |
| A45 | Move visit information | R | R | R | O | R | - | - | - | - | R |
| A50 | Change visit number | R | R | R | O | R | - | - | - | - | R |

Extra rules from the page:
- A04 and A08 require the PV1 segment.
- A45 and A50 have a MERGE_INFO segment group with MRG then PV1, in that order.

## Scenarios from the PDF (use case, workflow, purpose)

| Event | Use case | Workflow in the HIS | Purpose |
|---|---|---|---|
| A01 | Inpatient admission | Patient arrives, admissions staff register and assign a bed, the HIS sends A01 | A new inpatient encounter started |
| A02 | Move within the same facility | Nurse or coordinator records a room or bed transfer | Everyone knows the current location |
| A03 | Inpatient stay ends | Physician enters discharge order, discharge is processed, A03 | Patient has officially left |
| A04 | Outpatient or same-day registration | Front desk creates a visit (imaging, labs) | Start outpatient workflows |
| A05 | Planned future admission | Staff enter pre-admission data with estimated admit date | Prepare resources in advance |
| A06 | Outpatient becomes inpatient | Clinician decides to admit, status changes | Care level went up |
| A07 | Inpatient becomes outpatient | Care status is updated after reassessment | Correct billing and workflow |
| A08 | Update data (diagnosis, procedures, doctor info) | Staff update the record | Keep connected systems in step |
| A08 (CNHI) | Submit or correct discharge info for CNHI reporting | After discharge the HIS sends a customised A08 limited to discharge updates, with CNHI fields and the Z-segments ZPV1, ZDG1, ZPR1 | Let the receiver tell it apart from a normal A08 |
| A11 | A01 was sent in error | Staff cancel the admission | Reverse an A01 |
| A12 | A02 was wrong | Transfer is cancelled | Revert to the prior location |
| A13 | Discharged in error, or immediate readmit | Discharge is reversed | Restore inpatient status |
| A31 | Change to core identity (name, date of birth) | Master person record is updated | Identity stays consistent |
| A38 | A05 made in error or cancelled | Pre-admission is deleted | Remove the pre-admit record |
| A45 | Visit or account number on the wrong person | HIM moves the visit from the wrong patient to the right one | Correct misassigned visit data |
| A50 | Patient has several identifiers | MPI de-duplication merges records, survivor ID chosen | Old IDs point to the new master ID |

## Things to check with the user before building

1. The pasted table shows AL1 for A03 as "I". Every other cell is R, O or -. It is probably "O". Confirm on the Confluence page.
2. Names differ between the two sources: the table says A45 "Move visit information" and A50 "Change visit number"; the PDF says A45 "Move Account Information" and A50 "Change Patient Identifier List". Use the Confluence names in the UI and show the PDF wording in the help text.
3. The CNHI A08 variant is only in the PDF. Its Z-segment fields (ZPV1, ZDG1, ZPR1) are not defined here. Ask for the field list, or mark them as placeholders.
4. A03 requires DG1 (R). A01, A04 to A08, A13, A31 have DG1 optional.

## Suggested prototype scope (to confirm)

- A small HIS: patient list, bed board, encounter timeline, one screen per scenario above with a form for the fields each event needs.
- A message panel that builds the HL7 v2.5.1 ADT message live (MSH, EVN, PID, PD1, PV1, PV2, AL1, DG1, PR1, MRG as the table allows) and checks it against the table: missing required segments, segments that must be absent.
- A scenario runner that walks the full flows (A05 then A01, A02, A03, then A13; A04 then A06 then A07; the cancel events; A45 and A50 with the MRG group).
- A saved log of sent messages that can be copied or downloaded as .hl7 text files.
- Made-up patients only. No real hospital or patient data.
- No backend at first. Sending to nphies is out of scope until the user says how (endpoint, certificates).

## Rules

- Simple English in UI text and docs. No em dashes. Title Case on buttons.
- Keep this folder outside the OCN Mapping repo. It is a separate product.
