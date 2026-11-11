import type { Allergy, Dx, Pr, Vitals } from "../model";
import { LOINC, SNOMED } from "./docspec";
import { el, guid, hl7Time, tag, txt } from "./xml";

/**
 * Coded entries. Only diagnoses, allergies, vital signs, procedures and delivery observations are coded.
 * Template ids come from the entry pages (Problem Concern 43/44, Allergy Concern 51/52, Vital Signs 54/55, Surgery 53,
 * Delivery live birth 60, still birth 61, gestational age 62, Apgar 63).
 */

const T = (n: number) => `2.16.840.1.113883.3.3731.1.210.100.${n}`;
const tids = (...ids: string[]) => ids.map((r) => tag("templateId", { root: r }));
const xsiType = (t: string) => ({ "xsi:type": t });

/** Assumption: ICD-10-AM has no OID in the snapshot. The ICD-10 OID is used. Procedure codes use a demo OID. */
export const ICD_OID = "2.16.840.1.113883.6.3";
export const ACHI_DEMO_OID = "2.16.840.1.113883.3.3731.9999.1.1";

const interval = (low?: string, high?: string, unk = true) =>
  el("effectiveTime", {}, [
    low ? tag("low", { value: hl7Time(low) }) : unk ? tag("low", { nullFlavor: "UNK" }) : undefined,
    high ? tag("high", { value: hl7Time(high) }) : undefined,
  ]);

export function problemEntry(seed: string, dx: Dx, refId: string, low: string | undefined, high: string | undefined, active: boolean): string {
  const obs = el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(T(44), "1.3.6.1.4.1.19376.1.5.3.1.4.5", "2.16.840.1.113883.10.20.1.28"),
    tag("id", { root: guid(`${seed}:obs`) }),
    tag("code", { code: "282291009", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "Diagnosis" }),
    el("text", {}, [tag("reference", { value: `#${refId}` })]),
    tag("statusCode", { code: "completed" }),
    interval(low, high),
    tag("value", { ...xsiType("CD"), code: dx.code, codeSystem: ICD_OID, codeSystemName: "ICD-10-AM", displayName: dx.text }),
  ]);
  const act = el("act", { classCode: "ACT", moodCode: "EVN" }, [
    ...tids(T(43), "1.3.6.1.4.1.19376.1.5.3.1.4.5.1", "1.3.6.1.4.1.19376.1.5.3.1.4.5.2", "2.16.840.1.113883.10.20.1.27"),
    tag("id", { root: guid(`${seed}:act`) }),
    tag("code", { nullFlavor: "NA" }),
    tag("statusCode", { code: active ? "active" : "completed" }),
    interval(low, high),
    el("entryRelationship", { typeCode: "SUBJ", inversionInd: "false" }, [obs]),
  ]);
  return el("entry", { typeCode: "DRIV" }, [act]);
}

export function allergyEntry(seed: string, a: Allergy | null, refId: string, low: string | undefined): string {
  const none = a === null;
  const obs = el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(T(52), "1.3.6.1.4.1.19376.1.5.3.1.4.5", "1.3.6.1.4.1.19376.1.5.3.1.4.6", "2.16.840.1.113883.10.20.1.18"),
    tag("id", { root: guid(`${seed}:obs`) }),
    tag("code", { code: none ? "ALG" : "DALG", codeSystem: "2.16.840.1.113883.5.4", displayName: none ? "Allergy" : "Drug allergy" }),
    el("text", {}, [tag("reference", { value: `#${refId}` })]),
    tag("statusCode", { code: "completed" }),
    interval(low),
    none
      ? tag("value", { ...xsiType("CD"), code: "160244002", codeSystem: SNOMED, codeSystemName: "SNOMED CT", displayName: "No known allergies" })
      : tag("value", { ...xsiType("CD"), nullFlavor: "NA" }),
    a &&
      el("participant", { typeCode: "CSM" }, [
        el("participantRole", { classCode: "MANU" }, [
          el("playingEntity", { classCode: "MMAT" }, [
            // Assumption: the KSA Drug Allergy value set is not in the snapshot, so the substance goes in as text.
            el("code", { nullFlavor: "OTH" }, [txt("originalText", {}, a.text)]),
          ]),
        ]),
      ]),
  ]);
  const act = el("act", { classCode: "ACT", moodCode: "EVN" }, [
    ...tids(T(51), "1.3.6.1.4.1.19376.1.5.3.1.4.5.1", "1.3.6.1.4.1.19376.1.5.3.1.4.5.3", "2.16.840.1.113883.10.20.1.27"),
    tag("id", { root: guid(`${seed}:act`) }),
    tag("code", { nullFlavor: "NA" }),
    tag("statusCode", { code: "active" }),
    interval(low),
    el("entryRelationship", { typeCode: "SUBJ", inversionInd: "false" }, [obs]),
  ]);
  return el("entry", { typeCode: "DRIV" }, [act]);
}

interface Vit {
  code: string;
  name: string;
  value: number;
  unit: string;
  ref: string;
}

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
        el("code", { code: x.code, codeSystem: LOINC, codeSystemName: "LOINC", displayName: x.name }, [el("originalText", {}, [tag("reference", { value: `#vs-${x.ref}` })])]),
        el("text", {}, [tag("reference", { value: `#vs-${x.ref}` })]),
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

export function surgeryEntry(seed: string, pr: Pr, refId: string, date: string): string {
  const proc = el("procedure", { classCode: "PROC", moodCode: "EVN" }, [
    ...tids(T(53), "1.3.6.1.4.1.19376.1.5.3.1.4.19", "2.16.840.1.113883.10.20.1.29"),
    tag("id", { root: guid(`${seed}:proc`) }),
    el("code", { code: pr.code, codeSystem: ACHI_DEMO_OID, codeSystemName: "ACHI", displayName: pr.text }, [el("originalText", {}, [tag("reference", { value: `#${refId}` })])]),
    el("text", {}, [tag("reference", { value: `#${refId}` })]),
    tag("statusCode", { code: "completed" }),
    date ? tag("effectiveTime", { value: hl7Time(date.length === 10 ? `${date}T00:00` : date) }) : tag("effectiveTime", { nullFlavor: "UNK" }),
  ]);
  return el("entry", { typeCode: "DRIV" }, [proc]);
}

/** Simple observation used for delivery counts, Apgar and gestational age. */
export function simpleObs(
  seed: string,
  templateId: string,
  code: string,
  display: string,
  value: { type: "INT"; v: number } | { type: "PQ"; v: number; unit: string },
  refId: string,
  extraTids: string[] = ["1.3.6.1.4.1.19376.1.5.3.1.4.13"],
): string {
  const obs = el("observation", { classCode: "OBS", moodCode: "EVN" }, [
    ...tids(templateId, ...extraTids),
    tag("id", { root: guid(seed) }),
    el("code", { code, codeSystem: LOINC, codeSystemName: "LOINC", displayName: display }, [el("originalText", {}, [tag("reference", { value: `#${refId}` })])]),
    el("text", {}, [tag("reference", { value: `#${refId}` })]),
    tag("statusCode", { code: "completed" }),
    value.type === "INT" ? tag("value", { ...xsiType("INT"), value: value.v }) : tag("value", { ...xsiType("PQ"), value: value.v, unit: value.unit }),
  ]);
  return el("entry", { typeCode: "DRIV" }, [obs]);
}

export const DELIVERY_TIDS = { live: T(60), still: T(61), ga: T(62), apgar: T(63) };
