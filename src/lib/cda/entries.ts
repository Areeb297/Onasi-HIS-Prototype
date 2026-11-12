import type { Allergy, Dx, Pr, Vitals } from "../model";
import { LOINC, SNOMED } from "./docspec";
import type { MedLine } from "./types";
import { el, guid, hl7Time, tag, txt } from "./xml";

/**
 * Coded entries. Each function follows one entry page of the guide (page id in the comment) and the
 * official sample documents ("Sample Messages" page 125206589, CDA folder).
 * Every text and originalText reference points at a content ID that the section narrative carries.
 */

const T = (n: number) => `2.16.840.1.113883.3.3731.1.210.100.${n}`;
const tids = (...ids: string[]) => ids.map((r) => tag("templateId", { root: r }));
const xsiType = (t: string) => ({ "xsi:type": t });
const refTo = (id: string) => tag("reference", { value: `#${id}` });
const originalText = (id: string) => el("originalText", {}, [refTo(id)]);
const textRef = (id: string) => el("text", {}, [refTo(id)]);

/** ICD-10-AM, as in the official samples and the Additional Order Information page (118063524). */
export const ICD_OID = "2.16.840.1.113883.6.135";
/** ACHI procedures, as in the official samples. */
export const ACHI_OID = "2.16.840.1.113883.3.3731.50.2";
/** KSA Mode of Delivery, as in the official Maternal Discharge Summary sample. */
export const MODE_OF_DELIVERY_OID = "2.16.840.1.113883.3.3731.1.203.22";
/** HL7 ActCode (allergy type). */
const ACT_CODE = "2.16.840.1.113883.5.4";

const interval = (low?: string, high?: string) =>
  el("effectiveTime", {}, [
    low ? tag("low", { value: hl7Time(low) }) : tag("low", { nullFlavor: "UNK" }),
    high ? tag("high", { value: hl7Time(high) }) : undefined,
  ]);
/** For "no current problems": nullFlavor NA with unknown low and high (Problem Entry rows 2.9 to 2.11). */
const noInterval = () => el("effectiveTime", { nullFlavor: "NA" }, [tag("low", { nullFlavor: "UNK" }), tag("high", { nullFlavor: "UNK" })]);

/* ---------- problems (pages 16712147 and 16810620) ---------- */

function concernAct(nphiesTid: string, iheTid: string, status: string, time: string, obs: string): string {
  const act = el("act", { classCode: "ACT", moodCode: "EVN" }, [
    ...tids(nphiesTid, "1.3.6.1.4.1.19376.1.5.3.1.4.5.1", iheTid, "2.16.840.1.113883.10.20.1.27"),
    // The concern act has no id of its own: the problem or allergy is identified in the observation.
    tag("id", { nullFlavor: "NI" }),
    tag("code", { nullFlavor: "NA" }),
    tag("statusCode", { code: status }),
    time,
    el("entryRelationship", { typeCode: "SUBJ", inversionInd: "false" }, [obs]),
  ]);
  return el("entry", { typeCode: "DRIV" }, [act]);
}

function problemObs(seed: string, refId: string, time: string, value: string): string {
  return el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(T(44), "1.3.6.1.4.1.19376.1.5.3.1.4.5", "2.16.840.1.113883.10.20.1.28"),
    tag("id", { root: guid(`${seed}:obs`) }),
    tag("code", { code: "282291009", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "Diagnosis" }),
    textRef(refId),
    tag("statusCode", { code: "completed" }),
    time,
    value,
  ]);
}

export function problemEntry(seed: string, dx: Dx, refId: string, low: string | undefined, high: string | undefined, active: boolean): string {
  const time = interval(low, active ? undefined : high);
  const value = el("value", { ...xsiType("CD"), code: dx.code, codeSystem: ICD_OID, codeSystemName: "ICD10-AM", displayName: dx.text }, [originalText(refId)]);
  return concernAct(T(43), "1.3.6.1.4.1.19376.1.5.3.1.4.5.2", active ? "active" : "completed", time, problemObs(seed, refId, time, value));
}

/** "No current problems or disability" (SNOMED CT 160245001), used when a required diagnosis section has nothing to list. */
export function noProblemEntry(seed: string, refId: string): string {
  const value = el("value", { ...xsiType("CD"), code: "160245001", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "No current problems or disability" }, [originalText(refId)]);
  return concernAct(T(43), "1.3.6.1.4.1.19376.1.5.3.1.4.5.2", "completed", noInterval(), problemObs(seed, refId, noInterval(), value));
}

/* ---------- allergies (pages 17301851 and 17629252) ---------- */

const ALLERGY_TYPE: Record<string, string> = { DALG: "Drug allergy", FALG: "Food allergy", ALG: "Allergy (other than drug or food)" };

/** Pass null for "no known allergies" (value 160244002). */
export function allergyEntry(seed: string, a: Allergy | null, refId: string, low: string | undefined): string {
  const type = a?.type ?? (a ? "DALG" : "ALG");
  const time = interval(low);
  const obs = el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(T(52), "1.3.6.1.4.1.19376.1.5.3.1.4.5", "1.3.6.1.4.1.19376.1.5.3.1.4.6", "2.16.840.1.113883.10.20.1.18"),
    tag("id", { root: guid(`${seed}:obs`) }),
    el("code", { code: type, codeSystem: ACT_CODE, codeSystemName: "HL7 ActCodes", displayName: ALLERGY_TYPE[type] }, [originalText(refId)]),
    textRef(refId),
    tag("statusCode", { code: "completed" }),
    time,
    a
      ? tag("value", { ...xsiType("CD"), nullFlavor: "NA" })
      : el("value", { ...xsiType("CD"), code: "160244002", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "No Known Allergies" }, [originalText(refId)]),
    // The substance is "required if known" and may not be null. It is sent only when the chart holds a SNOMED CT code for it.
    a?.code &&
      el("participant", { typeCode: "CSM" }, [
        el("participantRole", { classCode: "MANU" }, [
          el("playingEntity", { classCode: "MMAT" }, [
            el("code", { code: a.code, codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: a.text }, [originalText(refId)]),
          ]),
        ]),
      ]),
  ]);
  return concernAct(T(51), "1.3.6.1.4.1.19376.1.5.3.1.4.5.3", "active", time, obs);
}

/* ---------- vital signs (pages 17629329 and 17694890) ---------- */

interface Vit {
  code: string;
  name: string;
  value: number;
  unit: string;
  ref: string;
}

/**
 * Vital sign LOINC codes. The value set table ("LOINC codes", page 17694890) is not published on the page.
 * 8480-6, 8462-4 and 8867-4 appear in the official sample. The others are standard LOINC codes and are listed as an assumption.
 */
export function vitalsList(v: Vitals): Vit[] {
  const out: Vit[] = [];
  const num = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
  };
  const bp = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(v.bp);
  if (bp) {
    out.push({ code: "8480-6", name: "Systolic blood pressure", value: +bp[1], unit: "mm[Hg]", ref: "bps" });
    out.push({ code: "8462-4", name: "Diastolic blood pressure", value: +bp[2], unit: "mm[Hg]", ref: "bpd" });
  }
  const add = (code: string, name: string, s: string, unit: string, ref: string) => {
    const n = num(s);
    if (!Number.isNaN(n)) out.push({ code, name, value: n, unit, ref });
  };
  add("8867-4", "Heart rate", v.pulse, "/min", "hr");
  add("8310-5", "Body temperature", v.temp, "Cel", "temp");
  add("59408-5", "Oxygen saturation", v.spo2, "%", "spo2");
  add("9279-1", "Respiratory rate", v.rr, "/min", "rr");
  add("29463-7", "Body weight", v.weight, "kg", "wt");
  return out;
}

export function vitalsEntry(seed: string, v: Vitals, at: string): string {
  const comps = vitalsList(v).map((x) =>
    el("component", { typeCode: "COMP" }, [
      el("observation", { classCode: "OBS", moodCode: "EVN" }, [
        ...tids(T(55), "1.3.6.1.4.1.19376.1.5.3.1.4.13.2", "1.3.6.1.4.1.19376.1.5.3.1.4.13", "2.16.840.1.113883.10.20.1.31"),
        tag("id", { root: guid(`${seed}:${x.ref}`) }),
        el("code", { code: x.code, codeSystem: LOINC, codeSystemName: "LOINC", displayName: x.name }, [originalText(`vs-${x.ref}`)]),
        textRef(`vs-${x.ref}`),
        tag("statusCode", { code: "completed" }),
        tag("effectiveTime", { value: hl7Time(at) }),
        tag("value", { ...xsiType("PQ"), value: x.value, unit: x.unit }),
      ]),
    ]),
  );
  const organizer = el("organizer", { classCode: "CLUSTER", moodCode: "EVN" }, [
    ...tids(T(54), "1.3.6.1.4.1.19376.1.5.3.1.4.13.1", "2.16.840.1.113883.10.20.1.32", "2.16.840.1.113883.10.20.1.35"),
    tag("id", { nullFlavor: "NI" }),
    tag("code", { code: "46680005", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "Vital signs" }),
    tag("statusCode", { code: "completed" }),
    tag("effectiveTime", { value: hl7Time(at) }),
    ...comps,
  ]);
  return el("entry", { typeCode: "DRIV" }, [organizer]);
}

/* ---------- surgery (page 17629267) ---------- */

export function surgeryEntry(seed: string, pr: Pr, refId: string, date: string): string {
  const proc = el("procedure", { classCode: "PROC", moodCode: "EVN" }, [
    ...tids(T(53), "1.3.6.1.4.1.19376.1.5.3.1.4.19", "2.16.840.1.113883.10.20.1.29"),
    tag("id", { root: guid(`${seed}:proc`) }),
    el("code", { code: pr.code, codeSystem: ACHI_OID, codeSystemName: "ACHI", displayName: pr.text }, [originalText(refId)]),
    textRef(refId),
    tag("statusCode", { code: "completed" }),
    // The time interval is "required if known" and may not be null, so it is left out when there is no date.
    // A completed procedure needs an end time; the chart holds a date only, so the end is marked unknown as row 9.11 allows.
    date ? el("effectiveTime", {}, [tag("low", { value: hl7Time(date.length === 10 ? `${date}T00:00` : date) }), tag("high", { nullFlavor: "UNK" })]) : undefined,
  ]);
  return el("entry", { typeCode: "DRIV" }, [proc]);
}

/* ---------- simple observations: delivery counts, Apgar, gestational age, pregnancy ---------- */

type ObsValue = { type: "INT"; v: number } | { type: "PQ"; v: number; unit: string } | { type: "BL"; v: boolean };

/**
 * Simple observation (IHE 1.3.6.1.4.1.19376.1.5.3.1.4.13). Used for the delivery live and still birth counts (pages 17564260,
 * 17629845), gestational age (17629859), Apgar (17597275) and pregnancy observations (17695143).
 * `at` is the delivery or measurement time. It is mandatory on all of these.
 */
export function simpleObs(seed: string, templateIds: string[], code: string, display: string, value: ObsValue, refId: string, at: string): string {
  const obs = el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(...templateIds),
    tag("id", { root: guid(seed) }),
    el("code", { code, codeSystem: LOINC, codeSystemName: "LOINC", displayName: display }, [originalText(refId)]),
    textRef(refId),
    tag("statusCode", { code: "completed" }),
    tag("effectiveTime", { value: hl7Time(at) }),
    value.type === "INT"
      ? tag("value", { ...xsiType("INT"), value: value.v })
      : value.type === "BL"
        ? tag("value", { ...xsiType("BL"), value: String(value.v) })
        : tag("value", { ...xsiType("PQ"), value: value.v, unit: value.unit }),
  ]);
  return el("entry", { typeCode: "DRIV" }, [obs]);
}

const SIMPLE = "1.3.6.1.4.1.19376.1.5.3.1.4.13";
export const OBS_TIDS = {
  live: [T(60), SIMPLE],
  still: [T(61), SIMPLE],
  ga: [T(62), SIMPLE],
  apgar: [T(63), SIMPLE],
  pregnancy: [T(58), "1.3.6.1.4.1.19376.1.5.3.1.4.13.5", SIMPLE],
};

/* ---------- labor and delivery procedure (page 17695325) ---------- */

/**
 * Mode of delivery. Code 1 "Vaginal - non-instrumental" is the only value of the "Method of Delivery" value set shown
 * in the official sample. The other modes get a DEMO- code until the IS0200 list is loaded.
 */
export function deliveryModeCode(mode: string): { code: string; display: string } {
  if (/^spontaneous vaginal/i.test(mode)) return { code: "1", display: "Vaginal - non-instrumental" };
  return { code: `DEMO-MODE-${mode.toUpperCase().replace(/[^A-Z]+/g, "-").replace(/^-|-$/g, "") || "UNKNOWN"}`, display: mode || "Not recorded" };
}

export function deliveryProcedureEntry(seed: string, mode: string, refId: string, at: string): string {
  const c = deliveryModeCode(mode);
  const proc = el("procedure", { classCode: "PROC", moodCode: "EVN" }, [
    ...tids(T(59), "1.3.6.1.4.1.19376.1.5.3.1.4.19", "2.16.840.1.113883.10.20.1.29"),
    tag("id", { root: guid(seed) }),
    el("code", { code: c.code, codeSystem: MODE_OF_DELIVERY_OID, codeSystemName: "KSA Mode of Delivery", displayName: c.display }, [originalText(refId)]),
    textRef(refId),
    tag("statusCode", { code: "completed" }),
    tag("effectiveTime", { value: hl7Time(at) }),
  ]);
  return el("entry", { typeCode: "DRIV" }, [proc]);
}

/* ---------- medications (pages 16745055 and 17597322) ---------- */

/**
 * Medications Entry. `refs` are the content IDs in the section table: the row, the code cell, the form cell and the
 * instructions cell. A medicine typed as free text has no code, so code and form carry nullFlavor UNK (both are usage R).
 * mood INT is an open prescription; EVN is a medicine that was given.
 */
export function medicationEntry(seed: string, m: MedLine, mood: "INT" | "EVN", refs: { row: string; code: string; form: string; instruct: string }): string {
  const strength =
    m.strengthValue !== undefined && m.strengthUnit
      ? el("pharm:ingredient", { classCode: "ACTI" }, [
          el("pharm:quantity", {}, [tag("numerator", { ...xsiType("PQ"), value: m.strengthValue, unit: m.strengthUnit }), tag("denominator", { ...xsiType("INT"), value: 1 })]),
        ])
      : undefined;
  const sa = el("substanceAdministration", { classCode: "SBADM", moodCode: mood }, [
    ...tids(T(45), "1.3.6.1.4.1.19376.1.5.3.1.4.7", "2.16.840.1.113883.10.20.1.24"),
    tag("id", { root: guid(seed) }),
    textRef(refs.row),
    tag("statusCode", { code: "completed" }),
    el("consumable", {}, [
      el("manufacturedProduct", { classCode: "MANU" }, [
        ...tids("1.3.6.1.4.1.19376.1.5.3.1.4.7.2", "2.16.840.1.113883.10.20.1.53"),
        el("manufacturedMaterial", {}, [
          m.code && m.codeSystem
            ? el("code", { code: m.code, codeSystem: m.codeSystem, displayName: m.name }, [originalText(refs.code)])
            : el("code", { nullFlavor: "UNK" }, [originalText(refs.code)]),
          txt("name", {}, m.name),
          m.formCode
            ? el("pharm:formCode", { code: m.formCode, codeSystem: "2.16.840.1.113883.3.3731.1.205.8", codeSystemName: "KSA Medication Pharmaceutical Dose Form", displayName: m.formName }, [originalText(refs.form)])
            : el("pharm:formCode", { nullFlavor: "UNK" }, [originalText(refs.form)]),
          strength,
        ]),
      ]),
    ]),
    el("entryRelationship", { typeCode: "SUBJ", inversionInd: "true" }, [
      el("act", { classCode: "ACT", moodCode: "INT" }, [
        ...tids(T(66), "1.3.6.1.4.1.19376.1.5.3.1.4.3", "2.16.840.1.113883.10.20.1.49"),
        tag("code", { code: "PINSTRUCT", codeSystem: "1.3.6.1.4.1.19376.1.5.3.2", codeSystemName: "IHE ActCode" }),
        textRef(refs.instruct),
        tag("statusCode", { code: "completed" }),
      ]),
    ]),
  ]);
  return el("entry", { typeCode: "DRIV" }, [sa]);
}
