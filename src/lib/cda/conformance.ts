import type { DocType } from "./types";

/**
 * Maps the "Clinical Notes Summary" steps of the Seha conformance sheet (4.1 to 4.3 and the Operative Note flows)
 * to what has happened on this visit. Pure, so it is easy to test.
 */

export type StepState = "done" | "todo" | "na" | "fail";

export interface StepDoc {
  type: DocType;
  version: number;
  status: "draft" | "published" | "deprecated";
  /** Registry answered Success. */
  accepted: boolean;
  replaces?: boolean;
  publishedAt?: string;
}

export interface StepFacts {
  docs: StepDoc[];
  deathRecorded: boolean;
  stillbirth: boolean;
  cesarean: boolean;
  hasDelivery: boolean;
}

export interface Step {
  id: string;
  flow: string;
  text: string;
  expected: string;
  state: StepState;
  hint: string;
}

const pub = (f: StepFacts, t: DocType) => f.docs.filter((d) => d.type === t && (d.status === "published" || d.status === "deprecated") && d.accepted);
const amended = (f: StepFacts, t: DocType) => f.docs.some((d) => d.type === t && d.replaces && d.status === "published" && d.accepted);
const first = (f: StepFacts, t: DocType) => pub(f, t).map((d) => d.publishedAt ?? "").sort()[0];

export function conformanceSteps(f: StepFacts): Step[] {
  const S = (id: string, flow: string, text: string, expected: string, done: boolean, hint: string, na = false, fail = false): Step => ({
    id, flow, text, expected, hint, state: na ? "na" : fail ? "fail" : done ? "done" : "todo",
  });
  const ACC = "XDDOCS message accepted by the participant input communication point";
  const RES = "Success response received";
  const op = pub(f, "outpatient").length > 0;
  const dis = pub(f, "discharge").length > 0;
  const mat = pub(f, "maternal").length > 0;
  const nbn = pub(f, "newborn").length > 0;
  const opn = pub(f, "operative").length > 0;
  const nonDelivery = !f.hasDelivery;
  const anyPublished = f.docs.some((d) => d.status !== "draft" && d.accepted);
  const mFirst = first(f, "maternal");
  const oFirst = first(f, "operative");
  return [
    S("4.1.1", "4.1 Outpatient Encounter, main flow", "Send Outpatient Encounter document to nphies.", ACC, op, "Open an outpatient visit that has ended, generate the Outpatient Encounter Summary, then publish."),
    S("4.1.2", "4.1 Outpatient Encounter, main flow", "Receive a successful response from nphies.", RES, op, "Shown on the Response tab after publishing."),
    S("4.1.4", "4.1 Alternative flow: Amended Report", "Send an amendment to the existing Outpatient Encounter to deprecate the original.", ACC, amended(f, "outpatient"), "Use Amend on the published Outpatient Encounter Summary."),
    S("4.1.5", "4.1 Alternative flow: Amended Report", "Receive a successful response from nphies.", RES, amended(f, "outpatient"), "Shown on the Response tab of the new version."),
    S("4.2.1", "4.2 Discharge Summary, main flow", "Send Discharge summary document to nphies.", ACC, dis, "Discharge an inpatient visit, generate the Discharge Summary, then publish."),
    S("4.2.2", "4.2 Discharge Summary, main flow", "Receive a successful response from nphies.", RES, dis, "Shown on the Response tab after publishing."),
    S("4.2.4", "4.2 Alternative flow: Amended Report", "Send an amendment to the existing Discharge Summary to deprecate the original.", ACC, amended(f, "discharge"), "Use Amend on the published Discharge Summary."),
    S("4.2.5", "4.2 Alternative flow: Amended Report", "Receive a successful response from nphies.", RES, amended(f, "discharge"), "Shown on the Response tab of the new version."),
    S("4.2.7", "4.2 Exception flow: Patient Death", "No document is published to nphies. Patient death reporting is not published to nphies.", "Nothing should be published.", f.deathRecorded && !anyPublished, "Use Record Patient Death. Generate and Publish are then blocked.", false, f.deathRecorded && anyPublished),
    S("4.3.1", "4.3 Maternal and Newborn Discharge, normal delivery", "After a normal delivery send the Maternal Discharge and Newborn Discharge documents.", ACC, mat && nbn, "Record the delivery on the Delivery Outcomes form, discharge, then publish both documents.", nonDelivery),
    S("4.3.2", "4.3 Maternal and Newborn Discharge, normal delivery", "Receive a successful response from nphies.", RES, mat && nbn, "Shown on the Response tab.", nonDelivery),
    S("4.3.4", "4.3 Alternative flow 1: Cesarean section", "On completion of the cesarean section send the Operative Note document.", ACC, opn, "Add the procedure, generate the Operative Note, publish.", nonDelivery || !f.cesarean),
    S("4.3.5", "4.3 Alternative flow 1: Cesarean section", "Send the Maternal Discharge and Newborn Discharge documents.", ACC, mat && nbn && !!oFirst && !!mFirst && mFirst >= oFirst, "Publish both after the Operative Note.", nonDelivery || !f.cesarean),
    S("4.3.6", "4.3 Alternative flow 1: Cesarean section", "Receive a successful response from nphies.", RES, mat && nbn && opn, "Shown on the Response tab.", nonDelivery || !f.cesarean),
    S("4.3.8", "4.3 Alternative flow 2: Non-hospital delivery", "After a delivery outside the hospital and an emergency admission evaluation, send the Maternal and Newborn Discharge documents.", ACC, mat && nbn, "Use an emergency visit with a Delivery Outcomes record. The steps are the same as 4.3.1.", nonDelivery),
    S("4.3.9", "4.3 Alternative flow 2: Non-hospital delivery", "Receive a successful response from nphies.", RES, mat && nbn, "Shown on the Response tab.", nonDelivery),
    S("4.3.11", "4.3 Alternative flow 3: Delivery with complications", "After a baby is delivered surgically, send the Operative Note document.", ACC, opn, "Generate and publish the Operative Note for the surgery.", nonDelivery),
    S("4.3.12", "4.3 Alternative flow 3: Delivery with complications", "Send the Maternal Discharge and Newborn Discharge documents.", ACC, mat && nbn, "Publish both.", nonDelivery),
    S("4.3.13", "4.3 Alternative flow 3: Delivery with complications", "Receive a successful response from nphies.", RES, mat && nbn && opn, "Shown on the Response tab.", nonDelivery),
    S("4.3.15", "4.3 Exception: Stillborn birth", "No Newborn Discharge summary is created.", RES, f.stillbirth && !nbn, "Record Stillbirth on Delivery Outcomes. Generate is blocked for the Newborn Discharge Summary.", !f.stillbirth, f.stillbirth && nbn),
    S("4.3.16", "4.3 Exception: Stillborn birth", "Send the Maternal Discharge document to nphies.", ACC, f.stillbirth && mat, "Publish the Maternal Discharge Summary.", !f.stillbirth),
    S("4.3.17", "4.3 Exception: Stillborn birth", "Receive a successful response from nphies.", RES, f.stillbirth && mat, "Shown on the Response tab.", !f.stillbirth),
    S("4.3.19", "Operative Note, main flow: Surgery", "On completion of the surgery send the Operative Note document.", ACC, opn, "Generate and publish one Operative Note for each surgery."),
    S("4.3.20", "Operative Note, main flow: Surgery", "Receive a successful response from nphies.", RES, opn, "Shown on the Response tab."),
    S("4.1.1*", "Operative Note, alternative flow: Clinical Note Amendment", "Send an amendment to the existing Operative Note.", ACC, amended(f, "operative"), "Use Amend on the published Operative Note. The sheet numbers this step 4.1.1 again."),
    S("4.1.2*", "Operative Note, alternative flow: Clinical Note Amendment", "Receive a successful response from nphies.", RES, amended(f, "operative"), "Shown on the Response tab of the new version. The sheet numbers this step 4.1.2 again."),
  ];
}
