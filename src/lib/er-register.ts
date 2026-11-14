import { quickCreate } from "./actions";
import { defaultArea, saveTriage, startEd } from "./ed";
import type { CtasLevel, EdData, PatientExtra } from "./model";
import { DOCTORS } from "./reference-data";
import { findDuplicates } from "./registration";
import { canSetTriage, currentUser } from "./session";
import { lookupById } from "./registry";
import { getState, nextHealthId, nowLocal, registerPatient, updateEncounter } from "./store";

/**
 * Quick emergency registration. At the door the patient may be unconscious, without papers, or in no state to answer 40 fields.
 * This registers only what a visit needs, then the nurse triages at once. Details are completed later.
 *
 * Assumptions (the NPHIES ADT pages do not cover them):
 *  - A patient who is not in the national registry gets a made-up test Health ID, because every ADT message needs one in PID-3.
 *    A real HIS would use the temporary or unidentified patient process of the national registry.
 *  - Nationality is "999" (unknown) and marital status is "U" (unknown, the HL7 value) when we do not know them.
 *  - Emergency care does not wait for consent or insurance, so neither is asked here.
 *  - A registry patient who already has a file here (same ID number or Health ID) keeps that file. The visit is added to it
 *    without stopping the clerk, because the door does not wait for a duplicate question.
 */

export type ErIdentity =
  | { kind: "registry"; idNumber: string }
  | { kind: "known"; given: string; family: string; sex: "M" | "F"; dob?: string; ageYears?: number }
  | { kind: "unknown"; sex: "M" | "F"; ageYears?: number; ageMonths?: number };

export interface ErRegistration {
  identity: ErIdentity;
  arrivalMode: EdData["arrivalMode"];
  complaint: string;
  /** Emergency doctor id. Defaults to the first doctor. */
  attending?: string;
  /** Doctor who sent the patient, if any. PV1-8. NPHIES expects it on A04 and warns when it is empty. */
  referring?: string;
  /** CTAS level chosen at the door. The full triage assessment can confirm or change it later. */
  ctas?: CtasLevel;
}

export type ErResult = { ok: true; visit: string; patientId: string; temporary: boolean; /** The visit was added to a file the patient already had. */ existing?: boolean } | { ok: false; message: string };

/** The file a registry person already has here, matched on the ID number or the Health ID only. */
export function existingFileFor(idNumber: string, patients = getState().patients) {
  const p = lookupById(idNumber);
  if (!p) return undefined;
  return findDuplicates({ idNumber: p.idNumber, healthId: p.healthId }, patients)[0]?.patient;
}

/** Birth date from an approximate age. The middle of the year, so the age is right for about six months either way. */
export function dobFromAge(ageYears: number | undefined, ageMonths: number | undefined, now = new Date()): string {
  if (ageMonths !== undefined && (ageYears === undefined || ageYears === 0)) {
    const d = new Date(now.getFullYear(), now.getMonth() - ageMonths, 15);
    return d.toISOString().slice(0, 10);
  }
  const y = now.getFullYear() - (ageYears ?? 40);
  return `${y}-07-01`;
}

export function registerEmergency(r: ErRegistration): ErResult {
  const s = getState();
  const attending = r.attending ?? DOCTORS[0].id;
  let patientId = "";
  let temporary = true;
  let existing = false;

  if (r.identity.kind === "registry") {
    const p = lookupById(r.identity.idNumber);
    if (!p) return { ok: false, message: "That ID number is not in the national registry." };
    temporary = false;
    const onFile = existingFileFor(p.idNumber, s.patients);
    if (onFile) { patientId = onFile.id; existing = true; }
    const extra: PatientExtra = {
      secondName: p.second, thirdName: p.third, nameAr: { first: p.firstAr, second: p.secondAr, third: p.thirdAr, family: p.familyAr },
      religion: p.religion, bloodGroup: p.bloodGroup, idType: p.idType, idNumber: p.idNumber, mobile: p.mobile, occupation: p.occupation,
      visitPayType: p.insurance && p.insurance.status === "Active" ? "Insurance" : "Cash", insurance: p.insurance, fileStatus: "Regular File",
    };
    if (!onFile) patientId = registerPatient({
      healthId: p.healthId, given: p.first, family: p.family, dob: p.dob, sex: p.sex, nationality: p.nationality, maritalStatus: p.maritalStatus,
      address: p.address, consentAt: undefined, extra,
    }).id;
  } else if (r.identity.kind === "known") {
    const i = r.identity;
    if (!i.given.trim() || !i.family.trim()) return { ok: false, message: "Enter the first and family names." };
    if (!i.dob && i.ageYears === undefined) return { ok: false, message: "Enter the date of birth or an approximate age." };
    patientId = registerPatient({
      healthId: nextHealthId(), given: i.given.trim(), family: i.family.trim(), dob: i.dob || dobFromAge(i.ageYears, undefined), sex: i.sex,
      nationality: "999", maritalStatus: "U", address: "", extra: { fileStatus: "Temporary File", visitPayType: "Cash" },
    }).id;
  } else {
    const i = r.identity;
    if (i.ageYears === undefined && i.ageMonths === undefined) return { ok: false, message: "Enter an approximate age." };
    const n = s.patients.filter((p) => p.given === "Unknown").length + 1;
    patientId = registerPatient({
      healthId: nextHealthId(), given: "Unknown", family: `${i.sex === "M" ? "Male" : "Female"} ${n}`, dob: dobFromAge(i.ageYears, i.ageMonths), sex: i.sex,
      nationality: "999", maritalStatus: "U", address: "", extra: { fileStatus: "Temporary File", visitPayType: "Cash" },
    }).id;
  }

  const out = quickCreate("A04", { patientId, attending, service: "ER", reason: r.complaint.trim(), cls: "E", referring: r.referring });
  const visit = out.entry?.visitNumber;
  if (!out.ok || !visit) return { ok: false, message: "The visit could not be registered." };
  startEd(visit, r.arrivalMode);
  updateEncounter(visit, (e) => {
    if (e.ed) e.ed = { ...e.ed, complaint: r.complaint.trim() || undefined, temporaryId: temporary || undefined, arrivalAt: e.ed.arrivalAt ?? nowLocal() };
  }, { touch: false });
  // A level sent by someone who may not triage is dropped: the patient waits for the triage nurse.
  if (r.ctas && canSetTriage()) {
    saveTriage(visit, { ctas: r.ctas, ctasWhy: "Level chosen at registration", arrivalMode: r.arrivalMode, complaint: r.complaint.trim() || undefined, area: defaultArea(r.ctas), triageNurse: currentUser().name }, undefined, "Quick triage at registration");
  }
  return { ok: true, visit, patientId, temporary, existing: existing || undefined };
}
