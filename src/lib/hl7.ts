import type { Check, Encounter, HisState, Patient, ScenarioForm } from "./model";
import { ADDRESS_PATTERN, BED_BY_ID, DOCTORS, FACILITY, OID } from "./reference-data";
import { EVENT_BY_ID, STANDARD_SEGMENTS, Z_SEGMENTS, type EventId, type EventSpec, type SegId } from "./spec";

export interface Seg {
  id: SegId;
  /** 1-based field number to value. Component text is already escaped. */
  f: Record<number, string>;
}

/** One order for every message. For A45 and A50 this puts MRG before PV1 (the MERGE_INFO group). */
export const SEGMENT_ORDER: SegId[] = ["MSH", "EVN", "PID", "PD1", "MRG", "PV1", "PV2", "AL1", "DG1", "PR1", "ZPV1", "ZDG1", "ZPR1"];

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

/** PID segment. PID-3 carries the Health ID only: nphies does not support alternate identifiers. Shared by ADT and ORU. */
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
  if (p.nationality) f[28] = esc(p.nationality);
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

/** "2026-11-11T09:30" -> "20261111093000+0300". Empty or bad input gives "". */
export function ts(local: string | undefined): string {
  if (!local) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(local);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}${m[4] ?? "00"}${m[5] ?? "00"}00+0300`;
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

/** Assumed codes. See the note in buildSegments. */
export const ED_ARRIVAL_CODE: Record<string, string> = { "Walk-in": "1", Ambulance: "2", Referral: "3", Police: "4", Other: "9" };
export const ED_DISPOSITION_CODE: Record<string, string> = {
  Discharged: "1", Admitted: "2", Transferred: "3", "Left Without Being Seen": "4", "Left Against Advice": "5", Died: "6",
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
  if (!d) return id ? esc(id) : "";
  return `${esc(d.id)}^${esc(d.family)}^${esc(d.given)}^^^Dr^^^&${OID.provider}&ISO`;
}

/** Patient: NHIC Health ID with the Health ID assigning authority. nphies rejects the message without it. */
export function healthCx(p: Patient): string {
  return p.healthId ? `${esc(p.healthId)}^^^&${OID.healthId}&ISO` : "";
}

/** Visit number with the participant OID as assigning authority. */
export function visitCx(v: string): string {
  return v ? `${esc(v)}^^^&${OID.participant}&ISO^VN` : "";
}

function locationPl(bedId: string | undefined, cls: string, service: string): string {
  if (bedId && BED_BY_ID[bedId]) {
    const b = BED_BY_ID[bedId];
    return comp(b.ward, b.room, b.bed, FACILITY);
  }
  if (cls === "O" || cls === "E") return comp(service || "OPD", "", "", FACILITY);
  return "";
}

/* ---------- segment builders ---------- */

export interface BuildContext {
  state: HisState;
  event: EventSpec;
  form: ScenarioForm;
  controlId: string;
}

export interface BuiltMessage {
  /** Every segment this screen can produce, by id. */
  all: Partial<Record<SegId, Seg[]>>;
  /** Which segments are in the message by default. */
  defaults: Record<SegId, boolean>;
}

function findPatient(state: HisState, id: string): Patient | undefined {
  return state.patients.find((p) => p.id === id);
}

function findEncounter(state: HisState, visit: string): Encounter | undefined {
  return state.encounters.find((e) => e.visitNumber === visit);
}

export function buildSegments(ctx: BuildContext): BuiltMessage {
  const { state, event, form, controlId } = ctx;
  const trigger = event.trigger;
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
      3: hd(`${OID.participant}`),
      4: hd(FACILITY),
      5: hd(OID.nphiesApp),
      7: eventTs,
      9: comp("ADT", trigger, event.structure),
      10: controlId,
      11: "T",
      12: "2.5.1",
    },
  };

  const evn: Seg = { id: "EVN", f: { 1: trigger, 2: eventTs, 6: eventTs } };

  const pid: Seg = pidSegment(p);

  const pd1: Seg = { id: "PD1", f: { 3: `^^${esc(FACILITY)}^^^&${OID.nphiesApp}&ISO`, 4: doctorXcn(form.attending) } };

  // Location rules. A02 and A12 also carry the prior location in PV1-6.
  const priorBed = (event.id === "A02" || event.id === "A12") && enc ? enc.bedId : undefined;
  const cls = event.id === "A01" || event.id === "A06" || event.id === "A13" ? form.cls : form.cls;
  const bedForPv1 = event.id === "A07" || event.id === "A38" ? undefined : form.bedId || undefined;

  const pv1F: Record<number, string> = { 1: "1", 2: cls };
  const loc = locationPl(bedForPv1, cls, form.service);
  if (loc) pv1F[3] = loc;
  if (priorBed) pv1F[6] = locationPl(priorBed, cls, form.service);
  if (form.attending) pv1F[7] = doctorXcn(form.attending);
  // Referring doctor is valued when registering (A04) or pre-registering (A05).
  if (form.referring && (trigger === "A04" || trigger === "A05")) pv1F[8] = doctorXcn(form.referring);
  if (form.service) pv1F[10] = esc(form.service);
  if (visitNumber) pv1F[19] = visitCx(visitNumber);
  if (trigger === "A03" && form.disposition) pv1F[36] = esc(form.disposition);
  const admit = ts(form.admitAt);
  if (admit && trigger !== "A05" && trigger !== "A38") pv1F[44] = admit;
  const disch = ts(form.dischargeAt);
  if (disch && (trigger === "A03" || event.id === "A08-CNHI")) pv1F[45] = disch;
  const pv1: Seg = { id: "PV1", f: pv1F };

  const pv2F: Record<number, string> = {};
  if (form.reason) pv2F[3] = comp("", form.reason);
  const expAdmit = ts(form.expectedAdmitAt);
  if (expAdmit) pv2F[8] = expAdmit;
  const expDisch = ts(form.expectedDischargeAt);
  if (expDisch) pv2F[9] = expDisch;
  const pv2: Seg = { id: "PV2", f: Object.keys(pv2F).length ? pv2F : { 1: "" } };

  const al1: Seg[] = (form.allergies.length ? form.allergies : [{ text: "", severity: "MI" as const, reaction: "" }]).map(
    (a, i) => ({
      id: "AL1" as const,
      f: { 1: String(i + 1), 2: "DA", 3: a.text ? comp("", a.text) : "", 4: a.text ? a.severity : "", 5: esc(a.reaction) },
    }),
  );

  const dg1: Seg[] = (form.dx.length ? form.dx : [{ code: "", text: "", type: "W" as const }]).map((d, i) => ({
    id: "DG1" as const,
    f: {
      1: String(i + 1),
      2: "I10",
      3: d.code ? comp(d.code, d.text, "I10") : "",
      4: esc(d.text),
      5: eventTs,
      6: d.type,
    },
  }));

  const pr1: Seg[] = (form.pr.length ? form.pr : [{ code: "", text: "" }]).map((r, i) => ({
    id: "PR1" as const,
    f: { 1: String(i + 1), 2: "ACHI", 3: r.code ? comp(r.code, r.text, "ACHI") : "", 4: esc(r.text), 5: eventTs },
  }));

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

  const zseg = (id: "ZPV1" | "ZDG1" | "ZPR1"): Seg => {
    const vals = form.z[id] ?? [];
    const f: Record<number, string> = { 1: "1" };
    vals.forEach((v, i) => {
      if (v) f[i + 2] = esc(v);
    });
    // Emergency fields of ZPV1 (fields 17 to 22). Codes for the three IS fields are assumptions: the value sets
    // (CS-Adm-EDArrivalMode, CS-Adm-EDDisposition, CS-Adm-TriageCategory) are not in the guide pages read.
    if (id === "ZPV1" && enc?.ed && enc.cls === "E") {
      const ed = enc.ed;
      if (ed.arrivalAt) f[17] = ts(ed.arrivalAt);
      f[18] = ED_ARRIVAL_CODE[ed.arrivalMode] ?? "9";
      if (ed.seenAt) f[19] = ts(ed.seenAt);
      if (ed.disposition) f[20] = ED_DISPOSITION_CODE[ed.disposition];
      if (ed.triageAt) f[21] = ts(ed.triageAt);
      if (ed.ctas) f[22] = String(ed.ctas);
    }
    return { id, f };
  };

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
  if (event.id === "A08-CNHI") {
    all.ZPV1 = [zseg("ZPV1")];
    all.ZDG1 = [zseg("ZDG1")];
    all.ZPR1 = [zseg("ZPR1")];
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
  if (event.id === "A08-CNHI") {
    defaults.ZPV1 = true;
    defaults.ZDG1 = true;
    defaults.ZPR1 = true;
  }
  return { all, defaults };
}

export function assemble(built: BuiltMessage, include: Record<SegId, boolean>): Seg[] {
  const out: Seg[] = [];
  for (const id of SEGMENT_ORDER) {
    if (include[id]) out.push(...(built.all[id] ?? []));
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
    for (const id of Z_SEGMENTS) rows.push({ id, req: "Z", present: present.has(id), ok: present.has(id) });
  }
  return rows;
}

function first(segs: Seg[], id: SegId): Seg | undefined {
  return segs.find((s) => s.id === id);
}

export function validate(event: EventSpec, segs: Seg[]): Check[] {
  const checks: Check[] = [];
  const err = (text: string) => checks.push({ level: "error", text });
  const warn = (text: string) => checks.push({ level: "warn", text });
  const ok = (text: string) => checks.push({ level: "ok", text });

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
    if (s.req === "Z" && !s.present) {
      tableOk = false;
      warn(`${s.id} is part of the CNHI variant but it is missing.`);
    }
  }
  if (tableOk) ok(`Segments match the ${event.trigger} table.`);

  // 2. Order
  const order = segs.map((s) => SEGMENT_ORDER.indexOf(s.id));
  let orderOk = true;
  for (let i = 1; i < order.length; i++) {
    if (order[i] < order[i - 1]) {
      orderOk = false;
      err(`${segs[i].id} is out of order. It must come before ${segs[i - 1].id}.`);
    }
  }
  const mrgIdx = segs.findIndex((s) => s.id === "MRG");
  if (mrgIdx >= 0 && segs[mrgIdx + 1]?.id !== "PV1") {
    orderOk = false;
    err("In the MERGE_INFO group, PV1 must come directly after MRG.");
  }
  if (orderOk) ok("Segment order is correct.");

  // 3. Field checks
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
  }
  const pid = first(segs, "PID");
  if (pid) {
    f(!!pid.f[3], "error", "PID-3 Patient Identifier List is empty. The NHIC Health ID is required.");
    f(!pid.f[3] || pid.f[3].includes(OID.healthId), "error", `PID-3 must be the Health ID with assigning authority ${OID.healthId}.`);
    f(!!pid.f[7], "error", "PID-7 Date of Birth is required.");
    f(!!pid.f[8], "warn", "PID-8 Administrative Sex is required if known.");
    f(!pid.f[11] || ADDRESS_PATTERN.test(pid.f[11]), "warn", "PID-11 must be a Saudi Post short address: 4 letters then 4 digits.");
    f(!!pid.f[16], "warn", "PID-16 Marital Status is required if known.");
    f(!!pid.f[28], "warn", "PID-28 Nationality is required if known. Use 999 for unknown.");
  }
  const pv1 = first(segs, "PV1");
  if (pv1) {
    f(!!pv1.f[2], "error", "PV1-2 Patient Class is empty.");
    f(!!pv1.f[19], "error", "PV1-19 Visit Number is empty. NPHIES keeps an event history per visit.");
    f(!pv1.f[19] || pv1.f[19].includes("&ISO"), "warn", "PV1-19 Visit Number should carry the participant OID as assigning authority.");
    if (event.trigger === "A04" || event.trigger === "A05") {
      f(!!pv1.f[8], "warn", "PV1-8 Referring Doctor is expected when registering (A04) or pre-registering (A05).");
    }
    if (event.trigger === "A04") f(!!pv1.f[44], "warn", "PV1-44 Admit Date/Time should hold the registration time.");
    if (["A01", "A06", "A02", "A12", "A13"].includes(event.trigger) && pv1.f[2] === "I") {
      f(!!pv1.f[3], "warn", "PV1-3 Assigned Patient Location is empty for an inpatient.");
    }
    if (event.trigger === "A02" || event.trigger === "A12") {
      f(!!pv1.f[6], "warn", "PV1-6 Prior Patient Location is empty.");
    }
    if (event.trigger === "A03" || event.id === "A08-CNHI") {
      f(!!pv1.f[45], "warn", "PV1-45 Discharge Date/Time is empty.");
    }
  }
  if (event.trigger === "A05") {
    const pv2 = first(segs, "PV2");
    f(!!pv2?.f[8], "warn", "PV2-8 Expected Admit Date/Time is empty for a pre-admit.");
  }
  const zpv1 = first(segs, "ZPV1");
  if (zpv1 && pv1?.f[2] === "E") {
    const need: [number, string][] = [
      [17, "ED Arrival Date/Time"], [18, "ED Arrival Mode"], [19, "ED Service Commencement Date/Time"],
      [20, "ED Disposition"], [21, "Triage Date/Time"], [22, "Triage Category"],
    ];
    for (const [n, name] of need) f(!!zpv1.f[n], "warn", `ZPV1-${n} ${name} is required if known for an Emergency visit.`);
  }
  const mrg = first(segs, "MRG");
  if (mrg) {
    f(!!mrg.f[1], "error", "MRG-1 Prior Patient Identifier List is empty.");
    f(!!mrg.f[5], "error", "MRG-5 Prior Visit Number is empty.");
  }
  const dg1 = first(segs, "DG1");
  if (dg1) f(segs.filter((s) => s.id === "DG1").every((s) => !!s.f[3]), "warn", "DG1-3 Diagnosis Code is empty.");
  if (fieldsOk) ok("Key fields are filled in.");

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
