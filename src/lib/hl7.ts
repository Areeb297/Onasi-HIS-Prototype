import type { Check, EdData, Encounter, HisState, Patient, ScenarioForm } from "./model";
import { VS } from "./nphies-valuesets";
import {
  ADDRESS_PATTERN, ADT_APP_OID, ALLERGY_SEVERITIES, BED_BY_ID, CNHI_DISPOSITIONS, DOCTORS, DX_TYPES, OID, ORG_ID, ORG_OID, PR_SYSTEMS,
  cnhiAdmissionMethod, countryCode, defaultAdmissionMethod, unitCodeOf,
} from "./reference-data";
import { EVENT_BY_ID, STANDARD_SEGMENTS, Z_SEGMENTS, type EventId, type EventSpec, type SegId } from "./spec";
import { bmiOf } from "./vitals-spec";

export interface Seg {
  id: SegId;
  /** 1-based field number to value. Component text is already escaped. */
  f: Record<number, string>;
}

/**
 * One order for every message, as in the guide's event structure tables.
 * For A45 and A50 this puts MRG before PV1 (the MERGE_INFO group).
 * In the A08 discharge update ZPV1 follows PV1, each ZDG1 follows its DG1 and each ZPR1 follows its PR1.
 */
export const SEGMENT_ORDER: SegId[] = ["MSH", "EVN", "PID", "PD1", "MRG", "PV1", "ZPV1", "PV2", "AL1", "DG1", "ZDG1", "PR1", "ZPR1"];

/** Position of a segment for the order check. A Z-segment shares the rank of the segment it follows, because they alternate. */
const ORDER_RANK: Record<SegId, number> = {
  MSH: 0, EVN: 1, PID: 2, PD1: 3, MRG: 4, PV1: 5, ZPV1: 6, PV2: 7, AL1: 8, DG1: 9, ZDG1: 9, PR1: 10, ZPR1: 10,
};

export const SEGMENT_TITLES: Record<SegId, string> = {
  MSH: "Message Header",
  EVN: "Event Type",
  PID: "Patient Identification",
  PD1: "Patient Additional Demographic",
  PV1: "Patient Visit",
  PV2: "Patient Visit, Additional",
  AL1: "Patient Allergy",
  DG1: "Diagnosis",
  PR1: "Procedures",
  MRG: "Merge Patient Information",
  ZPV1: "Custom Visit (CNHI)",
  ZDG1: "Custom Diagnosis (CNHI)",
  ZPR1: "Custom Procedure (CNHI)",
};

/* ---------- small helpers ---------- */

/**
 * PID segment. PID-3 carries the Health ID only: nphies does not support alternate identifiers. Shared by ADT and ORU.
 * PID-28 is sent as a CS-Adm-Country code. A value that is not in the published list is left out.
 */
export function pidSegment(p: Patient): Seg {
  const f: Record<number, string> = {
    1: "1",
    3: healthCx(p),
    5: comp(p.family, p.given, [p.extra?.secondName, p.extra?.thirdName].filter(Boolean).join(" ")),
    7: dateOnly(p.dob),
    8: p.sex,
  };
  if (p.address) f[11] = esc(p.address);
  if (p.maritalStatus) f[16] = esc(p.maritalStatus);
  const nat = countryCode(p.nationality);
  if (nat) f[28] = nat;
  return { id: "PID", f };
}

export function esc(s: string): string {
  return s
    .replace(/\\/g, "\\E\\")
    .replace(/\|/g, "\\F\\")
    .replace(/\^/g, "\\S\\")
    .replace(/&/g, "\\T\\")
    .replace(/~/g, "\\R\\");
}

/** Join components with ^ and drop empty ones at the end. */
export function comp(...parts: (string | undefined)[]): string {
  const escaped = parts.map((p) => esc(p ?? ""));
  while (escaped.length && escaped[escaped.length - 1] === "") escaped.pop();
  return escaped.join("^");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "2026-11-11T09:30" -> "20261111093000+0300". Empty or bad input gives "".
 * The offset is the real zone offset of this machine at that local time (+0300 in Saudi Arabia), not a fixed text.
 */
export function ts(local: string | undefined): string {
  if (!local) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${m[1]}${m[2]}${m[3]}${m[4] ?? "00"}${m[5] ?? "00"}00${sign}${pad2(Math.floor(abs / 60))}${pad2(abs % 60)}`;
}

/** Local date-time text for "now", in the shape the forms use. */
function nowLocalText(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** HL7 time stamp with offset to milliseconds. NaN when it does not match YYYYMMDDHHMMSS+/-ZZZZ. */
export function hl7Ms(v: string | undefined): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([+-])(\d{2})(\d{2})$/.exec(v ?? "");
  if (!m) return NaN;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  const off = (Number(m[8]) * 60 + Number(m[9])) * 60_000;
  return m[7] === "+" ? utc - off : utc + off;
}

export function dateOnly(d: string): string {
  return d.replace(/-/g, "");
}

export function segToString(s: Seg): string {
  const keys = Object.keys(s.f).map(Number);
  const max = keys.length ? Math.max(...keys) : 1;
  const start = s.id === "MSH" ? 2 : 1;
  const parts: string[] = [];
  for (let i = start; i <= max; i++) parts.push(s.f[i] ?? "");
  return `${s.id}|${parts.join("|")}`;
}

export const SEG_SEP = "\r";

/**
 * ZPV1-18, from CS-Adm-EDArrivalMode (Confluence page 526909458).
 * The published list has no code for a patient who walks in. Assumed: "Walk-in" is sent as 88 (Other).
 * The older HIS values "Ambulance" and "Referral" do not say which vehicle, so they are sent as 99 (Not stated).
 */
export const ED_ARRIVAL_CODE: Record<EdData["arrivalMode"], string> = {
  "Ground EMS Ambulance": "1", "Ground MOH Ambulance": "2", "Ground Civil Defense Ambulance": "3", "Ground Military Ambulance": "4",
  "Ground Private Ambulance": "5", "EMS Air Ambulance": "6", "Air Civil Defense Ambulance": "7", "Air Military Ambulance": "8",
  "Police Vehicle": "9", "Other Government Vehicles": "10", "Personal Vehicle": "11", Other: "88", "Not Stated": "99",
  "Walk-in": "88", Ambulance: "99", Referral: "99", Police: "9",
};

/**
 * ZPV1-20, from CS-Adm-EDDisposition (Confluence page 527335436).
 * The list has no code for leaving against medical advice. Assumed: the patient was seen and then left, so it is sent
 * as 2 (Discharged), and PV1-36 carries 225928004 to say it was against advice.
 */
export const ED_DISPOSITION_CODE: Record<NonNullable<EdData["disposition"]>, string> = {
  Admitted: "1", Discharged: "2", "Left Without Being Seen": "3", "Dead On Arrival": "4", Transferred: "5", Died: "6", "Left Against Advice": "2",
};

export function messageToString(segs: Seg[]): string {
  return segs.map(segToString).join(SEG_SEP);
}

/** Message text with line breaks for display. */
export function pretty(message: string): string {
  return message.split(/\r|\n/).filter(Boolean).join("\n");
}

/** Hierarchic designator with only the universal ID: ^OID^ISO */
export function hd(universalId: string): string {
  return `^${universalId}^ISO`;
}

/** Provider: National Provider ID, with the provider directory OID as assigning authority (XCN.9). */
export function doctorXcn(id: string): string {
  const d = DOCTORS.find((x) => x.id === id);
  if (!d) return id ? `${esc(id)}^^^^^^^^&${OID.provider}&ISO` : "";
  return `${esc(d.id)}^${esc(d.family)}^${esc(d.given)}^^^Dr^^^&${OID.provider}&ISO`;
}

/** Patient: NHIC Health ID with the Health ID assigning authority. nphies rejects the message without it. */
export function healthCx(p: Patient): string {
  return p.healthId ? `${esc(p.healthId)}^^^&${OID.healthId}&ISO` : "";
}

/** Visit number with the National Organization OID as assigning authority. The same text goes in ADT and ORU. */
export function visitCx(v: string): string {
  return v ? `${esc(v)}^^^&${ORG_OID}&ISO^VN` : "";
}

/** PL for a bed: point of care ^ room ^ bed ^ facility, where the facility is the NHIC Organization ID as universal ID. */
function locationPl(bedId: string | undefined): string {
  if (!bedId || !BED_BY_ID[bedId]) return "";
  const b = BED_BY_ID[bedId];
  return `${esc(b.ward)}^${esc(b.room)}^${esc(b.bed)}^&${ORG_ID}`;
}

/** Coded element: identifier ^ text ^ coding system OID. */
const coded = (code: string, text: string, system: string) => `${esc(code)}^${esc(text)}^${system}`;

const prOid = (system: string | undefined) => PR_SYSTEMS.find((s) => s.code === (system ?? "ACHI"))?.oid ?? OID.achi;
const PR_OIDS = new Set(PR_SYSTEMS.map((s) => s.oid));

/* ---------- segment builders ---------- */

export interface BuildContext {
  state: HisState;
  event: EventSpec;
  form: ScenarioForm;
  controlId: string;
  /** When the message is created (local date-time). Goes in MSH-7. Now when empty. */
  messageAt?: string;
}

export interface BuiltMessage {
  /** Every segment this screen can produce, by id. */
  all: Partial<Record<SegId, Seg[]>>;
  /** Which segments are in the message by default. */
  defaults: Record<SegId, boolean>;
  /** A08 discharge update: the ZDG1 that follows each DG1 and the ZPR1 that follows each PR1, by position. null when there is nothing to send. */
  paired?: { ZDG1: (Seg | null)[]; ZPR1: (Seg | null)[] };
}

function findPatient(state: HisState, id: string): Patient | undefined {
  return state.patients.find((p) => p.id === id);
}

function findEncounter(state: HisState, visit: string): Encounter | undefined {
  return state.encounters.find((e) => e.visitNumber === visit);
}

/** BMI from the height and weight on the chart, for ZPV1-16. */
function bmiText(enc: Encounter | undefined): string {
  const w = Number(enc?.vitals?.weight);
  const h = Number(enc?.vitals?.height);
  if (!enc?.vitals?.weight || !enc.vitals.height || Number.isNaN(w) || Number.isNaN(h)) return "";
  const b = bmiOf(w, h);
  return b === undefined ? "" : String(b);
}

export function buildSegments(ctx: BuildContext): BuiltMessage {
  const { state, event, form, controlId } = ctx;
  const trigger = event.trigger;
  const cnhi = event.id === "A08-CNHI";
  const enc = form.encounterId ? findEncounter(state, form.encounterId) : undefined;
  // For A45 the PID is the patient who should own the visit.
  const pidPatient = findPatient(state, event.id === "A45" ? form.correctPatientId : form.patientId);
  const patientForPid: Patient = pidPatient ?? {
    id: "", mrn: "", nationalId: "", family: "", given: "", dob: "", sex: "M", healthId: "", nationality: "", maritalStatus: "", address: "",
  };
  // A31 sends the new identity.
  const p: Patient =
    event.id === "A31"
      ? { ...patientForPid, family: form.family, given: form.given, dob: form.dob, sex: form.sex }
      : patientForPid;

  const visitNumber = event.id === "A50" ? form.newVisitNumber : form.encounterId || form.visitNumber;
  const eventTs = ts(form.eventAt);

  const msh: Seg = {
    id: "MSH",
    f: {
      2: "^~\\&",
      3: hd(ADT_APP_OID),
      4: hd(ORG_ID),
      5: hd(OID.nphiesApp),
      // MSH-7 is when the message is created. The event time is in EVN-2 and EVN-6.
      7: ts(ctx.messageAt ?? nowLocalText()),
      9: comp("ADT", trigger, event.structure),
      10: controlId,
      11: "T",
      12: "2.5.1",
    },
  };

  const evn: Seg = { id: "EVN", f: { 1: trigger, 2: eventTs, 6: eventTs } };

  const pid: Seg = pidSegment(p);

  const pd1: Seg = { id: "PD1", f: { 3: `^^${esc(ORG_ID)}^^^&${OID.nphiesApp}&ISO`, 4: doctorXcn(form.attending) } };

  // Location rules. PV1-3 is valued for a patient in a bed. A02 and A12 also carry the prior location in PV1-6.
  const priorBed = (event.id === "A02" || event.id === "A12") && enc ? enc.bedId : undefined;
  const cls = form.cls;
  const bedForPv1 = event.id === "A07" || event.id === "A38" ? undefined : form.bedId || undefined;

  const pv1F: Record<number, string> = { 1: "1", 2: cls };
  const loc = locationPl(bedForPv1);
  if (loc) pv1F[3] = loc;
  // PV1-4 is required. The A08 discharge update accepts only 14 (Elective) and 15 (Emergency).
  const method = form.admissionMethod || defaultAdmissionMethod(cls);
  pv1F[4] = cnhi ? cnhiAdmissionMethod(method) : method;
  if (priorBed) pv1F[6] = locationPl(priorBed);
  if (form.attending) pv1F[7] = doctorXcn(form.attending);
  // Referring doctor is valued when registering (A04) or pre-registering (A05).
  if (form.referring && (trigger === "A04" || trigger === "A05")) pv1F[8] = doctorXcn(form.referring);
  if (form.consulting) pv1F[9] = doctorXcn(form.consulting);
  // PV1-10 is a CS-Adm-MedicalUnitIdentifier code. In the discharge update it is sent for outpatients only.
  const unit = unitCodeOf(form.service);
  if (unit && (!cnhi || cls === "O")) pv1F[10] = unit;
  if (visitNumber) pv1F[19] = visitCx(visitNumber);
  if ((trigger === "A03" || cnhi) && form.disposition) pv1F[36] = esc(form.disposition);
  const admit = ts(form.admitAt);
  if (admit && trigger !== "A05" && trigger !== "A38") pv1F[44] = admit;
  const disch = ts(form.dischargeAt);
  if (disch && (trigger === "A03" || cnhi)) pv1F[45] = disch;
  const pv1: Seg = { id: "PV1", f: pv1F };

  // PV2-3 needs a code and a coding system. A reason in words goes in PV2-12 (visit description).
  const pv2F: Record<number, string> = {};
  if (form.reasonCode) pv2F[3] = coded(form.reasonCode, form.reason, OID.icd10am);
  else if (form.reason) pv2F[12] = esc(form.reason);
  const expAdmit = ts(form.expectedAdmitAt);
  if (expAdmit) pv2F[8] = expAdmit;
  const expDisch = ts(form.expectedDischargeAt);
  if (expDisch) pv2F[9] = expDisch;
  const pv2: Seg = { id: "PV2", f: Object.keys(pv2F).length ? pv2F : { 1: "" } };

  const al1: Seg[] = (form.allergies.length ? form.allergies : [{ text: "", severity: "MI" as const, reaction: "" }]).map((a, i) => {
    const f: Record<number, string> = { 1: String(i + 1), 2: a.type ?? "DALG" };
    // Coded allergen: identifier, text and SNOMED CT. Free text: the text component only.
    f[3] = a.code ? coded(a.code, a.text, OID.snomed) : a.text ? `^${esc(a.text)}` : "";
    if (a.text || a.code) f[4] = coded(a.severity, ALLERGY_SEVERITIES.find((s) => s.code === a.severity)?.label ?? "", OID.allergySeverity);
    if (a.reaction) f[5] = esc(a.reaction);
    return { id: "AL1" as const, f };
  });

  const dxList = form.dx.length ? form.dx : [{ code: "", text: "", type: "W" as const }];
  const dg1: Seg[] = dxList.map((d, i) => {
    const f: Record<number, string> = { 1: String(i + 1), 3: d.code ? coded(d.code, d.text, OID.icd10am) : "" };
    if ("at" in d && d.at) f[5] = ts(d.at);
    f[6] = `${d.type}^${DX_TYPES.find((t) => t.code === d.type)?.label ?? ""}`;
    // DG1-15: the first diagnosis is the primary one, the rest are ranked secondary.
    f[15] = i === 0 ? "1" : "2";
    return { id: "DG1" as const, f };
  });

  const prList = form.pr.length ? form.pr : [{ code: "", text: "" }];
  const pr1: Seg[] = prList.map((r, i) => {
    const f: Record<number, string> = { 1: String(i + 1), 3: r.code ? coded(r.code, r.text, prOid("system" in r ? r.system : undefined)) : "" };
    if (r.text) f[4] = esc(r.text);
    // PR1-5 is when the procedure started, not when the message is sent.
    f[5] = "at" in r ? ts(r.at) : "";
    if ("type" in r && r.type) f[6] = r.type;
    if ("surgeon" in r && r.surgeon) f[11] = doctorXcn(r.surgeon);
    return { id: "PR1" as const, f };
  });

  // MRG (A45, A50)
  const mrgF: Record<number, string> = {};
  if (event.id === "A45") {
    const wrong = findPatient(state, form.patientId);
    if (wrong) {
      mrgF[1] = healthCx(wrong);
      mrgF[5] = visitCx(form.encounterId);
      mrgF[7] = comp(wrong.family, wrong.given);
    }
  } else {
    const old = findPatient(state, form.oldPatientId || form.patientId);
    if (old) {
      mrgF[1] = healthCx(old);
      mrgF[5] = visitCx(form.encounterId);
      mrgF[7] = comp(old.family, old.given);
    }
  }
  const mrg: Seg = { id: "MRG", f: Object.keys(mrgF).length ? mrgF : { 1: "" } };

  const all: Partial<Record<SegId, Seg[]>> = {
    MSH: [msh],
    EVN: [evn],
    PID: [pid],
    PD1: [pd1],
    PV1: [pv1],
    PV2: [pv2],
    AL1: al1,
    DG1: dg1,
    PR1: pr1,
    MRG: [mrg],
  };

  let paired: BuiltMessage["paired"];
  if (cnhi) {
    // ZPV1. Field 8 marks the message as a discharge update. Fields are sent only when the HIS holds the data.
    const z: Record<number, string> = { 8: "UPDATE" };
    // ZPV1-16 BMI: inpatient and outpatient visits (the guide lists day case, inpatient, outpatient and primary care).
    const bmi = cls === "I" || cls === "O" ? bmiText(enc) : "";
    if (bmi) z[16] = bmi;
    // ZPV1-17 to 22: emergency visits only.
    if (enc?.ed && cls === "E") {
      const ed = enc.ed;
      if (ed.arrivalAt) z[17] = ts(ed.arrivalAt);
      z[18] = ED_ARRIVAL_CODE[ed.arrivalMode] ?? "99";
      if (ed.seenAt) z[19] = ts(ed.seenAt);
      const disp = ed.disposition ? ED_DISPOSITION_CODE[ed.disposition] : "";
      if (disp) z[20] = disp;
      if (ed.triageAt) z[21] = ts(ed.triageAt);
      if (ed.ctas) z[22] = String(ed.ctas);
    }
    all.ZPV1 = [{ id: "ZPV1", f: z }];
    // ZDG1-3 (condition onset) and ZPR1-3 (procedure end) are for admitted patients. One Z-segment per DG1 or PR1 that has the data.
    const zdg1 = form.dx.map((d): Seg | null => (cls === "I" && d.onset ? { id: "ZDG1", f: { 3: d.onset } } : null));
    const zpr1 = form.pr.map((r): Seg | null => (r.endAt && r.at ? { id: "ZPR1", f: { 3: ts(r.endAt) } } : null));
    paired = { ZDG1: zdg1, ZPR1: zpr1 };
    all.ZDG1 = zdg1.filter((s): s is Seg => !!s);
    all.ZPR1 = zpr1.filter((s): s is Seg => !!s);
  }

  const defaults = {} as Record<SegId, boolean>;
  for (const s of [...STANDARD_SEGMENTS, ...Z_SEGMENTS]) defaults[s] = false;
  for (const s of STANDARD_SEGMENTS) {
    const req = event.segments[s];
    if (req === "R") defaults[s] = true;
    else if (req === "O") {
      if (s === "PV2") defaults[s] = Object.keys(pv2F).length > 0;
      if (s === "AL1") defaults[s] = form.allergies.length > 0;
      if (s === "DG1") defaults[s] = form.dx.length > 0;
      if (s === "PR1") defaults[s] = form.pr.length > 0;
    }
  }
  if (cnhi) {
    defaults.ZPV1 = true;
    defaults.ZDG1 = (all.ZDG1?.length ?? 0) > 0;
    defaults.ZPR1 = (all.ZPR1?.length ?? 0) > 0;
  }
  return { all, defaults, paired };
}

export function assemble(built: BuiltMessage, include: Record<SegId, boolean>): Seg[] {
  const out: Seg[] = [];
  for (const id of SEGMENT_ORDER) {
    if (id === "ZDG1" || id === "ZPR1") continue; // placed right after their DG1 or PR1 below
    if (!include[id]) continue;
    const list = built.all[id] ?? [];
    if (id === "DG1" || id === "PR1") {
      const zId = id === "DG1" ? "ZDG1" : "ZPR1";
      list.forEach((s, i) => {
        out.push(s);
        const z = built.paired?.[zId][i];
        if (z && include[zId]) out.push(z);
      });
    } else out.push(...list);
  }
  return out;
}

/* ---------- validation ---------- */

export type SegmentStatus = { id: SegId; req: "R" | "O" | "-" | "I" | "Z"; present: boolean; ok: boolean };

export function segmentStatuses(event: EventSpec, segs: Seg[]): SegmentStatus[] {
  const present = new Set(segs.map((s) => s.id));
  const rows: SegmentStatus[] = STANDARD_SEGMENTS.map((id) => {
    const req = event.segments[id];
    const has = present.has(id);
    return { id, req, present: has, ok: req === "R" ? has : req === "-" ? !has : true };
  });
  if (event.id === "A08-CNHI") {
    // ZPV1 carries the discharge update flag, so it must be there. ZDG1 and ZPR1 are sent only when there is data for them.
    for (const id of Z_SEGMENTS) rows.push({ id, req: "Z", present: present.has(id), ok: id === "ZPV1" ? present.has(id) : true });
  }
  return rows;
}

function first(segs: Seg[], id: SegId): Seg | undefined {
  return segs.find((s) => s.id === id);
}

const TS_FULL = /^\d{14}[+-]\d{4}$/;
const part = (v: string | undefined, n: number) => (v ?? "").split("^")[n] ?? "";

export function validate(event: EventSpec, segs: Seg[]): Check[] {
  const checks: Check[] = [];
  const err = (text: string) => checks.push({ level: "error", text });
  const warn = (text: string) => checks.push({ level: "warn", text });
  const ok = (text: string) => checks.push({ level: "ok", text });
  const cnhi = event.id === "A08-CNHI";

  // 1. Table checks
  let tableOk = true;
  for (const s of segmentStatuses(event, segs)) {
    if (s.req === "R" && !s.present) {
      tableOk = false;
      err(`${s.id} is required for ${event.trigger} but it is missing.`);
    }
    if (s.req === "-" && s.present) {
      tableOk = false;
      err(`${s.id} must not be present in ${event.trigger}.`);
    }
    if (s.req === "I" && s.present) {
      ok(`${s.id} is ignored by nphies for ${event.trigger}. It is allowed but has no effect.`);
    }
    if (s.req === "Z" && s.id === "ZPV1" && !s.present) {
      tableOk = false;
      err("ZPV1 is missing. Without ZPV1-8 = UPDATE nphies cannot tell this A08 is a discharge update.");
    }
  }
  if (tableOk) ok(`Segments match the ${event.trigger} table.`);

  // 2. Order
  let orderOk = true;
  for (let i = 1; i < segs.length; i++) {
    if (ORDER_RANK[segs[i].id] < ORDER_RANK[segs[i - 1].id]) {
      orderOk = false;
      err(`${segs[i].id} is out of order. It must come before ${segs[i - 1].id}.`);
    }
    if (segs[i].id === "ZDG1" && segs[i - 1].id !== "DG1") { orderOk = false; err("ZDG1 must come directly after the DG1 it belongs to."); }
    if (segs[i].id === "ZPR1" && segs[i - 1].id !== "PR1") { orderOk = false; err("ZPR1 must come directly after the PR1 it belongs to."); }
  }
  const mrgIdx = segs.findIndex((s) => s.id === "MRG");
  if (mrgIdx >= 0 && segs[mrgIdx + 1]?.id !== "PV1") {
    orderOk = false;
    err("In the MERGE_INFO group, PV1 must come directly after MRG.");
  }
  if (orderOk) ok("Segment order is correct.");

  // 3. Field checks. Coded fields are checked against the value sets published in the integration guide.
  let fieldsOk = true;
  const f = (cond: boolean, level: "error" | "warn", text: string) => {
    if (!cond) {
      fieldsOk = false;
      level === "error" ? err(text) : warn(text);
    }
  };
  const msh = first(segs, "MSH");
  if (msh) {
    const want = comp("ADT", event.trigger, event.structure);
    f(msh.f[9] === want, "error", `MSH-9 should be ${want}.`);
    f(msh.f[12] === "2.5.1", "error", "MSH-12 should be 2.5.1.");
    f(TS_FULL.test(msh.f[7] ?? ""), "error", "MSH-7 needs a date, a time and a time zone offset.");
  }
  const pid = first(segs, "PID");
  if (pid) {
    f(!!pid.f[3], "error", "PID-3 Patient Identifier List is empty. The NHIC Health ID is required.");
    f(!pid.f[3] || pid.f[3].includes(OID.healthId), "error", `PID-3 must be the Health ID with assigning authority ${OID.healthId}.`);
    f(!!pid.f[7], "error", "PID-7 Date of Birth is required.");
    f(!!pid.f[8], "warn", "PID-8 Administrative Sex is required if known.");
    f(!pid.f[8] || VS.gender.has(pid.f[8]), "error", `PID-8 "${pid.f[8]}" is not in the CS-Adm-Gender value set.`);
    f(!pid.f[11] || ADDRESS_PATTERN.test(pid.f[11]), "warn", "PID-11 must be a Saudi Post short address: 4 letters then 4 digits.");
    f(!!pid.f[16], "warn", "PID-16 Marital Status is required if known.");
    f(!pid.f[16] || VS.maritalStatus.has(part(pid.f[16], 0)), "error", `PID-16 "${pid.f[16]}" is not in the CS-Adm-MaritalStatus value set.`);
    f(!!pid.f[28], "warn", "PID-28 Nationality is required if known. Use 999 for unknown.");
    f(!pid.f[28] || VS.country.has(part(pid.f[28], 0)), "error", `PID-28 "${pid.f[28]}" is not in the CS-Adm-Country value set (three-letter country code, or 999).`);
  }
  const pv1 = first(segs, "PV1");
  const cls = pv1?.f[2] ?? "";
  if (pv1) {
    f(!!cls, "error", "PV1-2 Patient Class is empty.");
    f(!cls || (VS.patientClass.has(cls) && cls !== "VR" && cls !== "HH"), "error", `PV1-2 "${cls}" is not allowed. Use a CS-Adm-PatientClass code (VR and HH are not accepted).`);
    f(!!pv1.f[4], "error", "PV1-4 Admission Type is required.");
    f(!pv1.f[4] || VS.admissionMethod.has(pv1.f[4]), "error", `PV1-4 "${pv1.f[4]}" is not in the CS-Adm-AdmissionMethod value set.`);
    if (cnhi) f(!pv1.f[4] || pv1.f[4] === "14" || pv1.f[4] === "15", "error", "PV1-4 in the discharge update must be 14 (Elective) or 15 (Emergency).");
    f(!pv1.f[10] || VS.medicalUnit.has(pv1.f[10]), "error", `PV1-10 "${pv1.f[10]}" is not in the CS-Adm-MedicalUnitIdentifier value set.`);
    if (cnhi) f(!pv1.f[10] || cls === "O" || cls === "P", "error", "PV1-10 must not be sent in the discharge update unless the visit is outpatient or primary care.");
    if (event.trigger === "A01" || event.trigger === "A03") f(!!pv1.f[10], "warn", "PV1-10 Hospital Service is empty.");
    f(!!pv1.f[19], "error", "PV1-19 Visit Number is empty. NPHIES keeps an event history per visit.");
    f(!pv1.f[19] || pv1.f[19].includes("&ISO"), "warn", "PV1-19 Visit Number should carry the organisation OID as assigning authority.");
    if (event.trigger === "A04" || event.trigger === "A05") {
      f(!!pv1.f[8], "warn", "PV1-8 Referring Doctor is expected when registering (A04) or pre-registering (A05).");
    }
    for (const n of [7, 8, 9]) f(!pv1.f[n] || pv1.f[n].includes(`&${OID.provider}&ISO`), "error", `PV1-${n} needs the National Provider ID with assigning authority ${OID.provider}.`);
    if (event.trigger === "A04") f(!!pv1.f[44], "warn", "PV1-44 Admit Date/Time should hold the registration time.");
    if (["A01", "A06", "A02", "A12", "A13"].includes(event.trigger) && cls === "I") {
      f(!!pv1.f[3], "warn", "PV1-3 Assigned Patient Location is empty for an inpatient.");
    }
    if (event.trigger === "A03" || cnhi) {
      f(!!pv1.f[45], "warn", "PV1-45 Discharge Date/Time is empty.");
      f(!!pv1.f[36], "warn", "PV1-36 Discharge Disposition is required if known.");
    }
    f(!pv1.f[36] || VS.dischargeDisposition.has(pv1.f[36]), "error", `PV1-36 "${pv1.f[36]}" is not in the CS-Adm-DischargeDisposition value set.`);
    if (cnhi) f(!pv1.f[36] || CNHI_DISPOSITIONS.has(pv1.f[36]), "error", `PV1-36 "${pv1.f[36]}" is not one of the nine codes the discharge update accepts.`);
    for (const n of [44, 45]) f(!pv1.f[n] || TS_FULL.test(pv1.f[n]), "error", `PV1-${n} needs a date, a time and a time zone offset.`);
    const a = hl7Ms(pv1.f[44]);
    const d = hl7Ms(pv1.f[45]);
    if (!Number.isNaN(a) && !Number.isNaN(d)) f(d >= a, "error", "PV1-45 Discharge Date/Time is before PV1-44 Admit Date/Time.");
  }
  const pv2 = first(segs, "PV2");
  if (pv2?.f[3]) {
    f(!!part(pv2.f[3], 0) && part(pv2.f[3], 2) === OID.icd10am, "error", `PV2-3 Admit Reason needs a code and the coding system ${OID.icd10am}. Put a reason in words in PV2-12.`);
  }
  if (event.trigger === "A05") {
    f(!!pv2?.f[8], "warn", "PV2-8 Expected Admit Date/Time is empty for a pre-admit.");
  }

  for (const [i, s] of segs.filter((x) => x.id === "AL1").entries()) {
    const n = `AL1 ${i + 1}`;
    f(VS.allergyType.has(part(s.f[2], 0)), "error", `${n}: AL1-2 "${s.f[2] ?? ""}" is not in the CS-Allergy-Type value set (DALG, FALG, ALG).`);
    f(!!s.f[3], "error", `${n}: AL1-3 Allergen is empty.`);
    if (part(s.f[3], 0)) f(!!part(s.f[3], 2), "error", `${n}: a coded allergen in AL1-3 needs the coding system.`);
    f(!s.f[4] || !part(s.f[4], 0) || VS.allergySeverity.has(part(s.f[4], 0)), "error", `${n}: AL1-4 "${part(s.f[4], 0)}" is not in the CS-Allergy-Severity value set.`);
  }

  const dg1s = segs.filter((x) => x.id === "DG1");
  for (const [i, s] of dg1s.entries()) {
    const n = `DG1 ${i + 1}`;
    f(!!part(s.f[3], 0), "error", `${n}: DG1-3 Diagnosis Code is empty.`);
    if (part(s.f[3], 0)) f(part(s.f[3], 2) === OID.icd10am, "error", `${n}: DG1-3 coding system must be ${OID.icd10am}.`);
    f(!s.f[5] || /^\d{8}$/.test(s.f[5]) || TS_FULL.test(s.f[5]), "error", `${n}: DG1-5 needs a time zone offset when it has a time.`);
    f(!s.f[6] || ["A", "W", "F"].includes(part(s.f[6], 0)), "error", `${n}: DG1-6 must be A, W or F.`);
    f(!s.f[15] || /^\d+$/.test(s.f[15]), "error", `${n}: DG1-15 Diagnosis Priority must be a number.`);
  }
  if (dg1s.length) f(dg1s.filter((s) => s.f[15] === "1").length <= 1, "error", "Only one diagnosis may be the primary one (DG1-15 = 1).");
  if (cnhi && cls === "I") f(dg1s.some((s) => !!part(s.f[3], 0)), "error", "The discharge update of an inpatient needs a coded diagnosis in DG1-3.");

  const admitMs = hl7Ms(pv1?.f[44]);
  const dischMs = hl7Ms(pv1?.f[45]);
  for (const [i, s] of segs.filter((x) => x.id === "PR1").entries()) {
    const n = `PR1 ${i + 1}`;
    f(!!part(s.f[3], 0), "error", `${n}: PR1-3 Procedure Code is empty.`);
    if (part(s.f[3], 0)) f(PR_OIDS.has(part(s.f[3], 2)), "error", `${n}: PR1-3 coding system must be the ACHI, ADA or Imaging Procedure OID.`);
    f(!!s.f[5], "error", `${n}: PR1-5 Procedure Date/Time is required. Record when the procedure started.`);
    if (s.f[5]) {
      f(TS_FULL.test(s.f[5]), "error", `${n}: PR1-5 needs a date, a time and a time zone offset.`);
      const at = hl7Ms(s.f[5]);
      if (!Number.isNaN(at) && !Number.isNaN(admitMs)) f(at >= admitMs, "error", `${n}: PR1-5 is before the admit time in PV1-44.`);
      if (!Number.isNaN(at) && !Number.isNaN(dischMs)) f(at <= dischMs, "error", `${n}: PR1-5 is after the discharge time in PV1-45.`);
    }
    f(!s.f[6] || ["A", "D", "I", "P"].includes(s.f[6]), "error", `${n}: PR1-6 must be A, D, I or P.`);
    f(!s.f[11] || s.f[11].includes(`&${OID.provider}&ISO`), "error", `${n}: PR1-11 Surgeon needs the National Provider ID with its assigning authority.`);
  }

  const zpv1 = first(segs, "ZPV1");
  if (zpv1) {
    f(zpv1.f[8] === "UPDATE", "error", "ZPV1-8 must be UPDATE.");
    if (cls === "E") {
      const need: [number, string][] = [
        [17, "ED Arrival Date/Time"], [18, "ED Arrival Mode"], [19, "ED Service Commencement Date/Time"],
        [20, "ED Disposition"], [21, "Triage Date/Time"], [22, "Triage Category"],
      ];
      for (const [n, name] of need) f(!!zpv1.f[n], "warn", `ZPV1-${n} ${name} is required if known for an Emergency visit.`);
      f(!zpv1.f[18] || VS.edArrivalMode.has(zpv1.f[18]), "error", `ZPV1-18 "${zpv1.f[18]}" is not in the CS-Adm-EDArrivalMode value set.`);
      f(!zpv1.f[20] || VS.edDisposition.has(zpv1.f[20]), "error", `ZPV1-20 "${zpv1.f[20]}" is not in the CS-Adm-EDDisposition value set.`);
      f(!zpv1.f[22] || VS.triageCategory.has(zpv1.f[22]), "error", `ZPV1-22 "${zpv1.f[22]}" is not in the CS-Adm-TriageCategory value set.`);
      for (const n of [17, 19, 21]) f(!zpv1.f[n] || TS_FULL.test(zpv1.f[n]), "error", `ZPV1-${n} needs a date, a time and a time zone offset.`);
      const arr = hl7Ms(zpv1.f[17]);
      if (!Number.isNaN(arr) && !Number.isNaN(admitMs)) f(arr <= admitMs, "warn", "ZPV1-17 ED Arrival must not be later than the admit time in PV1-44.");
    } else {
      for (const n of [17, 18, 19, 20, 21, 22]) f(!zpv1.f[n], "error", `ZPV1-${n} is for Emergency visits only.`);
    }
    f(!zpv1.f[16] || /^\d{1,3}(\.\d)?$/.test(zpv1.f[16]), "error", "ZPV1-16 BMI must be a number of at most 5 characters.");
  }
  for (const s of segs.filter((x) => x.id === "ZDG1")) f(!s.f[3] || ["1", "2", "9"].includes(s.f[3]), "error", "ZDG1-3 must be 1, 2 or 9 (CS-Clinical-ConditionOnsetFlag).");
  for (const s of segs.filter((x) => x.id === "ZPR1")) f(!s.f[3] || TS_FULL.test(s.f[3]), "error", "ZPR1-3 needs a date, a time and a time zone offset.");

  const mrg = first(segs, "MRG");
  if (mrg) {
    f(!!mrg.f[1], "error", "MRG-1 Prior Patient Identifier List is empty.");
    f(!mrg.f[1] || mrg.f[1].includes(OID.healthId), "error", `MRG-1 must be a Health ID with assigning authority ${OID.healthId}.`);
    f(!!mrg.f[5], "error", "MRG-5 Prior Visit Number is empty.");
  }
  if (fieldsOk) ok("Key fields are filled in and coded values are in the published value sets.");

  return checks;
}

export function countChecks(checks: Check[]): { errors: number; warnings: number } {
  return {
    errors: checks.filter((c) => c.level === "error").length,
    warnings: checks.filter((c) => c.level === "warn").length,
  };
}

export function eventSpec(id: EventId): EventSpec {
  return EVENT_BY_ID[id];
}
