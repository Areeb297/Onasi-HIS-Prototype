import * as React from "react";
import { ArrowRight, BedDouble, Check, Clock, Plus, Search, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, UserPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { DiagnosisSearch } from "@/components/admission/parts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, Field, Input, RequiredNote, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { CheckRow, ChoiceSelect, DateTimeInput, FormGrid, ReasonButton, SegmentedControl, isDirty, useUnsavedChangesGuard } from "@/components/forms";
import {
  changeToOutpatient, checkIn, convertToInpatient, dischargePatient, moveVisit, quickCreate, quickSend, recordLeftWard, sendWithReason,
  setBedOutOfService, setClearance, transferPatient,
} from "@/lib/actions";
import { ACTIVITY_LEVELS, ADMISSION_TYPES, ADMITTING_DEPARTMENTS, PATIENT_CONDITIONS, RELATIONS, SUB_DEPARTMENTS, WARD_OF } from "@/lib/admission-requests";
import { OUT_OF_SERVICE_REASONS, availableBeds, bedInfos, bedProblem, heldBedOf, reservedBedFor, unavailableLabel, type BedInfo } from "@/lib/beds";
import { CLINICS, VISIT_TYPE_LABEL, followUpTarget, type VisitType } from "@/lib/care-requests";
import { useDevMode } from "@/lib/devmode";
import { fmtDate } from "@/lib/format";
import {
  APPROVAL_ROLES, ATTENDANT_ID_TYPES, ATTENDANT_RELATIONS, CANCEL_REASONS, DISCHARGE_CONDITIONS, OUTCOMES, OVERRIDE_MIN, TRANSFER_REASONS,
  TRANSPORT_MODES, canGiveClearance, clearanceLabel, clearanceList, departureGap, detailProblems, emptyApproval, emptyAttendant, emptyDeath,
  emptySummary, emptyTransfer, gapText, missingClearances, needsClearances, niceDate, outcomeDef, outcomeProblems, overrideOk, reasonProblem,
} from "@/lib/discharge";
import { expand, testByCode, useLab } from "@/lib/lab";
import type { DischargeApproval, DischargeAttendant, DischargeDetails, DischargeOutcome, DischargeSummary, Dx, Encounter, Patient } from "@/lib/model";
import { procByCode, useRad } from "@/lib/radiology";
import { ADMISSION_METHODS, BED_BY_ID, COMPLAINT_SAMPLES, DOCTORS, DX_SAMPLES, SERVICES, WARDS, defaultAdmissionMethod } from "@/lib/reference-data";
import { rxForVisit, useRx } from "@/lib/rx";
import { DRUG_BY_ID, FREQ_BY_ID } from "@/lib/rx-catalogue";
import type { EventId } from "@/lib/spec";
import { navigate } from "@/lib/router";
import { USERS, can, hasGlass, useSession } from "@/lib/session";
import { bedLabel, getState, nowLocal, patientName, useHis } from "@/lib/store";
import {
  CONVERSION_REASON_MIN, MOVE_REASONS, WARD_TRANSFER_REASONS, conversionProblems, emptyExtras, extrasFrom, extrasProblems, extrasToAdmission,
  freeBedsByFloor, moveVisitProblem, type AdmissionExtras,
} from "@/lib/visit-forms";

type BedDlg = { kind: "bed"; event: "A01"; visit?: string; patientId?: string };
type TransferDlg = { kind: "transfer"; visit: string };
type ConvertDlg = { kind: "convert"; visit: string };
type OutpatientDlg = { kind: "outpatient"; visit: string };
type MoveDlg = { kind: "move"; visit: string };
type DischargeDlg = { kind: "discharge"; visit: string };
type RegisterDlg = { kind: "register"; type: "A04" | "A01" | "A05"; patientId?: string; bedId?: string };
type ReasonDlg = { kind: "reason"; event: "A11" | "A38" | "A12"; visit: string };
type ClearanceDlg = { kind: "clearances"; visit: string };
type LeftDlg = { kind: "left"; visit: string };
type BedServiceDlg = { kind: "bed-service"; bedId: string };
type Dlg = BedDlg | TransferDlg | ConvertDlg | OutpatientDlg | MoveDlg | DischargeDlg | RegisterDlg | ReasonDlg | ClearanceDlg | LeftDlg | BedServiceDlg;

/**
 * One place for every HIS action. A button calls act(event, visit). The hook opens a dialog when the staff member
 * must choose or confirm something (which bed, which outcome, why), and runs the ADT event when they confirm.
 */
export function useVisitActions() {
  const [dlg, setDlg] = React.useState<Dlg | null>(null);
  const close = React.useCallback(() => setDlg(null), []);

  function act(eventId: EventId | "CHECKIN", visit: string) {
    const enc = getState().encounters.find((e) => e.visitNumber === visit);
    if (!enc) return;
    if (eventId === "CHECKIN") return checkIn(visit);
    if (eventId === "A02") return setDlg({ kind: "transfer", visit });
    if (eventId === "A06") return setDlg({ kind: "convert", visit });
    if (eventId === "A07") return setDlg({ kind: "outpatient", visit });
    if (eventId === "A45") return setDlg({ kind: "move", visit });
    if (eventId === "A01") return setDlg({ kind: "bed", event: "A01", visit, patientId: enc.patientId });
    if (eventId === "A03") return setDlg({ kind: "discharge", visit });
    if (eventId === "A11" || eventId === "A38" || eventId === "A12") return setDlg({ kind: "reason", event: eventId, visit });
    quickSend(eventId, visit);
  }

  const openRegister = (type: "A04" | "A01" | "A05", opts: { patientId?: string; bedId?: string } = {}) =>
    setDlg({ kind: "register", type, ...opts });
  /** Full patient registration is its own page, with the ID lookup and card retrieval. */
  const openPatient = (cls: "O" | "E" = "O") => navigate("/registration", { cls: cls === "E" ? "E" : undefined });
  const openClearances = (visit: string) => setDlg({ kind: "clearances", visit });
  const openLeftWard = (visit: string) => setDlg({ kind: "left", visit });
  const openBedService = (bedId: string) => setDlg({ kind: "bed-service", bedId });

  const dialogs = (
    <>
      {dlg?.kind === "bed" && <BedDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "transfer" && <TransferDialog visit={dlg.visit} onClose={close} />}
      {dlg?.kind === "convert" && <ConvertDialog visit={dlg.visit} onClose={close} />}
      {dlg?.kind === "outpatient" && <OutpatientDialog visit={dlg.visit} onClose={close} />}
      {dlg?.kind === "move" && <MoveVisitDialog visit={dlg.visit} onClose={close} />}
      {dlg?.kind === "discharge" && <DischargeDialog visit={dlg.visit} onClose={close} />}
      {dlg?.kind === "register" && <RegisterDialog dlg={dlg} onClose={close} onNewPatient={() => openPatient()} />}
      {dlg?.kind === "reason" && <ReasonDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "clearances" && <ClearancesDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "left" && <LeftWardDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "bed-service" && <BedServiceDialog dlg={dlg} onClose={close} />}
    </>
  );
  return { act, openRegister, openPatient, openClearances, openLeftWard, openBedService, dialogs };
}

/* ---------- Shared dialog parts ---------- */

function ageOf(dob: string): number {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));
}

const doctorName = (id: string | undefined): string => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "None";
};

/** Who the patient is. Shown at the top of every dialog: name, MRN, age and sex, and allergies. */
export function PatientStrip({ patient, enc }: { patient: Patient | undefined; enc?: Encounter }) {
  const state = useHis();
  useSession();
  if (!patient) return null;
  // Allergies are kept on the visit. Without a visit, the patient's latest visit is used.
  const source = enc ?? [...state.encounters].reverse().find((e) => e.patientId === patient.id && e.status !== "cancelled");
  const allergies = (source?.allergies ?? []).filter((a) => a.text);
  const hidden = !!patient.confidential && !hasGlass(patient.id);
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5" role="group" aria-label="Patient">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{hidden ? "Confidential patient" : patientName(patient)}</span>
        <span className="text-xs text-muted-foreground">
          MRN {patient.mrn} · {ageOf(patient.dob)} years · {patient.sex === "M" ? "Male" : "Female"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        {allergies.length ? (
          <>
            <span className="flex items-center gap-1 font-semibold text-destructive">
              <ShieldAlert className="size-4" aria-hidden="true" /> Allergies
            </span>
            {allergies.map((a, i) => <Badge key={i} tone="danger">{a.text}</Badge>)}
          </>
        ) : (
          <span className="flex items-center gap-1 font-medium text-ok">
            <ShieldCheck className="size-4" aria-hidden="true" /> No allergies recorded
          </span>
        )}
      </div>
    </div>
  );
}

/** A labelled group of buttons. Field is a <label>, which would pass a click on the gaps to the first button. */
function Group({ label, hl7, required, hint, children }: { label: string; hl7?: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  const dev = useDevMode();
  return <Field group label={label} hl7={dev ? hl7 : undefined} required={required} hint={hint}>{children}</Field>;
}

/**
 * The body of a long dialog scrolls on its own, so the header and the confirm buttons stay in view.
 * The Dialog pads its body; this takes the padding over so the scroll bar sits at the edge.
 */
function DialogScroll({ children }: { children: React.ReactNode }) {
  return <div className="-mx-5 -my-4 max-h-[calc(100dvh-15rem)] overflow-y-auto overscroll-contain px-5 py-4 sm:max-h-[calc(100dvh-16rem)]">{children}</div>;
}

/** Closing a dialog with changes asks first. Returns the close to use for Cancel, Escape and the close button. */
function useGuardedClose(snapshot: unknown, onClose: () => void) {
  const [start] = React.useState(snapshot);
  const { guard, dialog } = useUnsavedChangesGuard(isDirty(start, snapshot), { what: "You have entered details in this window that are not saved." });
  return { close: () => guard(onClose), guardDialog: dialog };
}

/** The confirm button: when something is still needed, it is disabled and says what on hover. */
function ConfirmButton({ problems, onClick, children, variant = "primary" }: { problems: string[]; onClick: () => void; children: React.ReactNode; variant?: "primary" | "danger" }) {
  const reason = problems.length === 0 ? undefined : problems.length === 1 ? problems[0] : `${problems.length} things are still needed. See the list above the buttons.`;
  return <ReasonButton variant={variant} reason={reason} onClick={onClick}>{children}</ReasonButton>;
}

const doctorOptions = () => DOCTORS.map((d) => ({ value: d.id, label: `Dr. ${d.given} ${d.family}` }));

/** Where the patient is now, shown above the new values. */
function NowStrip({ enc, extra }: { enc: Encounter; extra?: [string, string][] }) {
  const bedId = enc.bedId ?? heldBedOf(enc);
  const bed = bedId ? BED_BY_ID[bedId] : undefined;
  const dept = SERVICES.find((x) => x.code === enc.service)?.label ?? enc.service;
  const place: [string, string][] = bed || enc.cls === "I"
    ? [["Ward", bed?.wardName ?? "No ward"], ["Bed", bed ? `${bed.room}-${bed.bed}` : "No bed"]]
    : [["Department", dept], ["Bed", "No bed"]];
  const items: [string, string][] = [
    ...place,
    ["Doctor", doctorName(enc.attending)],
    ...(extra ?? []),
  ];
  return (
    <div className="mb-4 rounded-lg border border-border px-3 py-2.5" role="group" aria-label="Now">
      <div className="text-xs font-semibold text-muted-foreground">Now</div>
      <dl className="mt-1 grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The consequences in plain words, shown before the confirm button. */
function WhatWillHappen({ items }: { items: (string | false | undefined)[] }) {
  const list = items.filter((x): x is string => !!x);
  if (!list.length) return null;
  return (
    <div className="mt-5 rounded-xl border border-[#03C1AC]/50 border-l-4 border-l-[#03C1AC] bg-card px-4 py-3" role="note" aria-label="What will happen">
      <div className="text-sm font-semibold">What Will Happen</div>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm">
        {list.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

/** What is still missing before the confirm button can be used: a short checklist, not an alarm. */
function StillNeeded({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-5 rounded-xl border border-border bg-card px-4 py-3 text-sm" role="status">
      <div className="flex items-center gap-1.5 font-semibold text-foreground"><TriangleAlert className="size-4 text-warn" aria-hidden="true" /> To Finish</div>
      <ul className="mt-1.5 space-y-1">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full border-2 border-warn" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReasonFields({ reasons, reason, setReason, note, setNote, label = "Reason" }: { reasons: string[]; reason: string; setReason: (v: string) => void; note: string; setNote: (v: string) => void; label?: string }) {
  return (
    <FormGrid cols={2}>
      <Field label={label} required>
        <ChoiceSelect options={reasons} value={reason} onChange={setReason} placeholder="Choose a reason" label={label} />
      </Field>
      <Field label="More Detail" required={reason === "Other"} hint={reason === "Other" ? "Say what the reason is." : "Optional."}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a few words" />
      </Field>
    </FormGrid>
  );
}

const NPHIES_NOTE: Record<string, string> = {
  A01: "An admission message is sent to NPHIES.",
  A02: "A transfer message is sent to NPHIES.",
  A03: "A discharge message is sent to NPHIES.",
  A04: "A visit registration message is sent to NPHIES.",
  A05: "A pre-admission message is sent to NPHIES.",
  A06: "A change-to-inpatient message is sent to NPHIES.",
  A07: "A change-to-outpatient message is sent to NPHIES.",
  A11: "A cancellation message is sent to NPHIES.",
  A12: "A transfer cancellation message is sent to NPHIES.",
  A38: "A pre-admission cancellation message is sent to NPHIES.",
  A45: "A move visit message is sent to NPHIES.",
};

const serviceLabel = (code: string | undefined): string => SERVICES.find((s) => s.code === code)?.label ?? code ?? "None";

/** Departments that take inpatients, plus the visit's own when it is another one. */
function departmentsWith(current: string | undefined) {
  const list = [...ADMITTING_DEPARTMENTS];
  const extra = SERVICES.find((s) => s.code === current);
  if (extra && !list.some((d) => d.code === extra.code)) list.push(extra);
  return list;
}

/** Consulting doctor, expected days, activity level, condition, attendant and notes. Kept in the HIS; the consulting doctor is PV1-9. */
function AdmissionExtrasFields({ value, onChange }: { value: AdmissionExtras; onChange: (v: AdmissionExtras) => void }) {
  const set = <K extends keyof AdmissionExtras>(k: K, v: AdmissionExtras[K]) => onChange({ ...value, [k]: v });
  return (
    <FormGrid cols={2}>
      <Field label="Consulting Doctor" hl7="PV1-9">
        <ChoiceSelect options={doctorOptions()} value={value.consulting} onChange={(v) => set("consulting", v)} emptyLabel="None" label="Consulting Doctor" />
      </Field>
      <Field label="Expected Stay" hint="How long the stay is expected to last.">
        <Input type="number" inputMode="numeric" min={1} max={365} value={value.expectedDays} onChange={(e) => set("expectedDays", e.target.value)} suffix="days" />
      </Field>
      <Field label="Activity Level">
        <Select value={value.activityLevel} onChange={(e) => set("activityLevel", e.target.value)}>
          <option value="">Choose a level</option>
          {ACTIVITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Patient Condition">
        <Select value={value.condition} onChange={(e) => set("condition", e.target.value)}>
          <option value="">Choose a condition</option>
          {PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="Attendant Name">
        <Input value={value.attendantName} onChange={(e) => set("attendantName", e.target.value)} placeholder="Name" autoComplete="off" />
      </Field>
      <Field label="Contact Number">
        <Input type="tel" inputMode="tel" value={value.attendantPhone} onChange={(e) => set("attendantPhone", e.target.value)} placeholder="05XXXXXXXX" />
      </Field>
      <Field label="Relation">
        <Select value={value.attendantRelation} onChange={(e) => set("attendantRelation", e.target.value)}>
          <option value="">Choose a relation</option>
          {RELATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </Field>
      <Field label="General Notes" className="col-span-full">
        <Textarea rows={2} value={value.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything the ward should know" />
      </Field>
    </FormGrid>
  );
}

/** A heading with a hairline that starts a group of fields inside a dialog. */
function SectionTitle({ children, help }: { children: React.ReactNode; help?: string }) {
  return (
    <div className="mb-3 mt-6 border-b border-border pb-2 first:mt-0">
      <h3 className="text-[0.9375rem] font-semibold text-foreground">{children}</h3>
      {help && <p className="mt-0.5 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/* ---------- Bed picker: admit to a bed, transfer ---------- */

const WARD_TEXT: Record<string, string> = { "3A": "text-move", "4B": "text-update", ICU: "text-cancel" };

/** Every bed by ward, the department's ward first. Free beds can be picked. The others say why they cannot. */
function BedGrid({ infos, who, value, onPick, firstWard }: { infos: BedInfo[]; who: { visit?: string; patientId?: string }; value: string; onPick: (bedId: string) => void; firstWard?: string }) {
  const state = useHis();
  const wards = [...WARDS].sort((a, b) => Number(b.ward === firstWard) - Number(a.ward === firstWard));
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Bed">
      {wards.map((w) => (
        <div key={w.ward}>
          <div className={cn("mb-1.5 text-xs font-semibold", WARD_TEXT[w.ward])}>{w.name}{firstWard && w.ward === firstWard ? " (this department)" : ""}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {infos.filter((i) => i.bed.ward === w.ward).map((i) => {
              const current = !!who.visit && i.state === "occupied" && i.enc?.visitNumber === who.visit;
              const why = current ? "Current bed" : bedProblem(state, i.bed.id, who, i) ? unavailableLabel(i, who) : "";
              const on = value === i.bed.id;
              const mine = !why && i.state === "reserved";
              return (
                <button
                  key={i.bed.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!!why}
                  onClick={() => onPick(i.bed.id)}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    why ? "cursor-not-allowed border-border bg-muted text-muted-foreground" : on ? "border-admit bg-admit/12" : "border-border bg-background hover:border-admit hover:bg-admit/10",
                  )}
                >
                  <BedDouble className={cn("mt-0.5 size-4 shrink-0", why ? "text-muted-foreground" : "text-admit")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{i.bed.room}-{i.bed.bed}{on ? " (chosen)" : ""}</span>
                    <span className="block text-xs">{why || (mine ? "Reserved for this patient" : "Free")}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Admit a pre-admission into a bed (A01), with the admission details the HIS records. */
function BedDialog({ dlg, onClose }: { dlg: BedDlg; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = dlg.visit ? state.encounters.find((e) => e.visitNumber === dlg.visit) : undefined;
  const patientId = dlg.patientId ?? enc?.patientId ?? "";
  const patient = state.patients.find((p) => p.id === patientId);
  const who = { visit: dlg.visit, patientId };
  const reserved = reservedBedFor(state, patientId);
  const [bedId, setBedId] = React.useState(reserved ?? "");
  const [extras, setExtras] = React.useState<AdmissionExtras>(() => extrasFrom(enc));
  const ok = !!bedId && !bedProblem(state, bedId, who);
  const problems = [...(bedId ? [] : ["Pick a bed."]), ...extrasProblems(extras)];

  function confirm() {
    onClose();
    quickCreate("A01", {
      patientId, attending: enc?.attending ?? DOCTORS[0].id, service: enc?.service ?? "MED", reason: enc?.reason ?? "", bedId,
      consulting: extras.consulting || undefined, admission: extrasToAdmission(extras),
    });
  }

  const effects = ["The planned admission becomes an inpatient stay.", `Bed ${bedLabel(bedId)} becomes occupied.`, reserved && reserved !== bedId && `The reserved bed ${bedLabel(reserved)} becomes free.`];
  const { close, guardDialog } = useGuardedClose({ bedId, extras }, onClose);
  const blockers = [...problems, ...(bedId && !ok ? ["Pick a bed that is free."] : [])];

  return (
    <Dialog
      open
      onClose={close}
      wide
      title="Admit Patient"
      subtitle={dev ? "Sends A01. Only a free bed, or the bed reserved for this patient, can be picked." : "Pick a bed, check the details, then confirm."}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={blockers} onClick={confirm}>Admit Patient</ConfirmButton>
        </>
      }
    >
      <DialogScroll>
        <PatientStrip patient={patient} enc={enc} />
        {enc && <NowStrip enc={enc} extra={enc.status === "preadmit" ? [["Expected Admit Date", niceDate(enc.expectedAdmitAt)], ["Reserved Bed", enc.reservedBedId ? bedLabel(enc.reservedBedId) : "None"]] : undefined} />}
        <RequiredNote className="mb-3" />
        <SectionTitle help="The department's ward is listed first. Beds that cannot be used say why.">Bed</SectionTitle>
        <Group label="Bed" hl7="PV1-3" required>
          <BedGrid infos={bedInfos(state)} who={who} value={bedId} onPick={setBedId} firstWard={WARD_OF[enc?.service ?? ""]} />
        </Group>
        <SectionTitle>Admission Details</SectionTitle>
        <AdmissionExtrasFields value={extras} onChange={setExtras} />
        {bedId && blockers.length === 0 ? (
          <WhatWillHappen items={[...effects, NPHIES_NOTE.A01, "The admission details are saved in the HIS.", "You can undo this from the message that appears."]} />
        ) : (
          <StillNeeded items={blockers} />
        )}
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Transfer (A02) ---------- */

export function TransferDialog({ visit, onClose }: { visit: string; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const [service, setService] = React.useState(enc?.service ?? "MED");
  const [sub, setSub] = React.useState(enc?.subDepartment ?? "");
  const [bedId, setBedId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const { close, guardDialog } = useGuardedClose({ service, sub, bedId, reason, note }, onClose);
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const who = { visit, patientId: enc.patientId };
  const from = enc.bedId;
  const subs = SUB_DEPARTMENTS[service] ?? [];
  const problems = [
    !bedId && "Pick the new bed.",
    bedId && bedId === from && "Pick a different bed from the current one.",
    bedId && bedId !== from && bedProblem(state, bedId, who),
    reasonProblem(reason, note) === "Choose a reason." ? "Choose the reason for the transfer." : reasonProblem(reason, note),
  ].filter((x): x is string => !!x);
  const changesDept = service !== enc.service;

  function pickService(code: string) {
    setService(code);
    setSub(code === enc!.service ? enc!.subDepartment ?? "" : "");
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Transfer Patient"
      subtitle={dev ? "Sends A02. PV1-3 is the new bed and PV1-10 the new department. The reason stays in the HIS and the audit log." : "Choose the new department and bed, say why, then confirm."}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={problems} onClick={() => { onClose(); transferPatient(visit, { bedId, service, subDepartment: sub, reason, note }); }}>Transfer Patient</ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={[["Department", serviceLabel(enc.service)], ...(enc.subDepartment ? [["Sub-Department", enc.subDepartment] as [string, string]] : [])]} />
      <RequiredNote className="mb-3" />
      <SectionTitle>New Department</SectionTitle>
      <FormGrid cols={2}>
        <Field label="New Department" hl7="PV1-10" required>
          <Select value={service} onChange={(e) => pickService(e.target.value)}>
            {departmentsWith(enc.service).map((d) => <option key={d.code} value={d.code}>{d.label}{d.code === enc.service ? " (current)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="New Sub-Department">
          <Select value={sub} onChange={(e) => setSub(e.target.value)} disabled={!subs.length && !sub}>
            <option value="">{subs.length ? "None" : "No sub-departments"}</option>
            {sub && !subs.includes(sub) && <option value={sub}>{sub}</option>}
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </FormGrid>
      <SectionTitle help="The new department's ward is listed first.">New Bed</SectionTitle>
      <Group label="New Bed" hl7="PV1-3" required>
        <BedGrid infos={bedInfos(state)} who={who} value={bedId} onPick={setBedId} firstWard={WARD_OF[service]} />
      </Group>
      <SectionTitle>Reason</SectionTitle>
      <ReasonFields reasons={WARD_TRANSFER_REASONS} reason={reason} setReason={setReason} note={note} setNote={setNote} label="Reason For Transfer" />
      {problems.length === 0 ? (
        <WhatWillHappen
          items={[
            `${patientName(patient)} moves from ${bedLabel(from)} to ${bedLabel(bedId)}.`,
            changesDept && `The department changes from ${serviceLabel(enc.service)} to ${serviceLabel(service)}.`,
            from && `Bed ${bedLabel(from)} becomes free.`,
            `Bed ${bedLabel(bedId)} becomes occupied.`,
            NPHIES_NOTE.A02,
            "The reason is saved with the visit and in the audit log.",
            "You can undo this from the message that appears.",
          ]}
        />
      ) : (
        <StillNeeded items={problems} />
      )}
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Change to inpatient (A06) ---------- */

/** Free beds grouped by floor and then room, as the HIS shows them. Only a bed this patient can take is listed. */
function FloorBedPicker({ value, onPick, who, firstWard }: { value: string; onPick: (bedId: string) => void; who: { visit?: string; patientId?: string }; firstWard?: string }) {
  const state = useHis();
  const groups = freeBedsByFloor(state, who, firstWard);
  const count = groups.reduce((n, g) => n + g.rooms.reduce((m, r) => m + r.beds.length, 0), 0);
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">{count} {count === 1 ? "bed" : "beds"} free</p>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">No bed is free. Free a bed on the bed board first.</p>
      ) : (
        <div className="space-y-3" role="radiogroup" aria-label="Bed">
          {groups.map((g) => (
            <div key={g.floor} className="rounded-lg border border-border p-2.5">
              <div className="mb-2 text-xs font-semibold text-foreground">{g.floor}</div>
              <div className="space-y-2">
                {g.rooms.map((r) => (
                  <div key={r.room}>
                    <div className={cn("mb-1 text-xs font-medium", WARD_TEXT[r.beds[0]?.bed.ward ?? ""])}>Room {r.room}, {r.wardName}{firstWard && r.beds[0]?.bed.ward === firstWard ? " (this department)" : ""}</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {r.beds.map((i) => {
                        const on = value === i.bed.id;
                        return (
                          <button
                            key={i.bed.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={`Bed ${i.bed.room}-${i.bed.bed}, ${g.floor}${i.state === "reserved" ? ", reserved for this patient" : ""}`}
                            onClick={() => onPick(i.bed.id)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              on ? "border-admit bg-admit/12 font-medium" : "border-border bg-background hover:border-admit hover:bg-admit/10",
                            )}
                          >
                            <BedDouble className="size-4 shrink-0 text-admit" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block">Bed {i.bed.bed}{on ? " (chosen)" : ""}</span>
                              {i.state === "reserved" && <span className="block text-xs text-muted-foreground">Reserved for this patient</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConvertDialog({ visit, onClose }: { visit: string; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const doc = DOCTORS.find((d) => d.id === enc?.attending);
  const startDept = ADMITTING_DEPARTMENTS.some((d) => d.code === enc?.service) ? enc!.service : doc && ADMITTING_DEPARTMENTS.some((d) => d.code === doc.service) ? doc.service : "MED";
  const [service, setService] = React.useState(startDept);
  const [sub, setSub] = React.useState("");
  const [admissionType, setAdmissionType] = React.useState(enc?.cls === "E" ? "02" : "03");
  const [condition, setCondition] = React.useState("");
  const [at, setAt] = React.useState(nowLocal());
  const [reason, setReason] = React.useState("");
  const [activityLevel, setActivityLevel] = React.useState("");
  const [bedId, setBedId] = React.useState("");
  const { close, guardDialog } = useGuardedClose({ service, sub, admissionType, condition, reason, activityLevel, bedId }, onClose);
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const who = { visit, patientId: enc.patientId };
  const input = { bedId, service, subDepartment: sub, admissionType, condition, at, reason, activityLevel };
  const problems = [...conversionProblems(input, { visitStart: enc.admitAt, now: nowLocal() }), ...(bedId ? [bedProblem(state, bedId, who)].filter((x): x is string => !!x) : [])];
  const subs = SUB_DEPARTMENTS[service] ?? [];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Admit To Inpatient"
      subtitle={dev ? "Sends A06. PV1-2 becomes I, PV1-3 the bed, PV1-4 the admission type, PV1-10 the department. Condition, activity level and reason stay in the HIS." : "Change this visit to an inpatient stay. Fill in the admission, pick a bed, then confirm."}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={problems} onClick={() => { onClose(); convertToInpatient(visit, input); }}>Admit Patient</ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={[["Visit", enc.cls === "E" ? "Emergency" : "Outpatient"]]} />
      <RequiredNote className="mb-3" />
      <SectionTitle>Patient Admission</SectionTitle>
      <FormGrid cols={2}>
        <Field label="Department" hl7="PV1-10" required>
          <Select value={service} onChange={(e) => { setService(e.target.value); setSub(""); setBedId(""); }}>
            {ADMITTING_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Sub-Department">
          <Select value={sub} onChange={(e) => setSub(e.target.value)}>
            <option value="">None</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Admission Type" hl7="PV1-4" required>
          <Select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)}>
            {ADMISSION_TYPES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Patient Condition" required>
          <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Choose a condition</option>
            {PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field group label="Date And Time" hl7="PV1-44" required>
          <DateTimeInput value={at} min={enc.admitAt} max={nowLocal()} onChange={setAt} label="Admission date and time" />
        </Field>
        <Field label="Activity Level">
          <Select value={activityLevel} onChange={(e) => setActivityLevel(e.target.value)}>
            <option value="">Choose a level</option>
            {ACTIVITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Reason" required className="col-span-full" hint={`Why this patient needs an inpatient bed. At least ${CONVERSION_REASON_MIN} characters.`}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: needs IV antibiotics and oxygen" />
        </Field>
      </FormGrid>
      <SectionTitle help="Only beds this patient can take are listed.">Bed</SectionTitle>
      <Group label="Bed" hl7="PV1-3" required>
        <FloorBedPicker value={bedId} onPick={setBedId} who={who} firstWard={WARD_OF[service]} />
      </Group>
      {problems.length === 0 ? (
        <WhatWillHappen
          items={[
            `The ${enc.cls === "E" ? "emergency" : "outpatient"} visit changes to an inpatient stay in ${serviceLabel(service)}.`,
            `Bed ${bedLabel(bedId)} becomes occupied.`,
            NPHIES_NOTE.A06,
            "The condition, activity level and reason are saved in the HIS and the audit log.",
            "You can undo this from the message that appears.",
          ]}
        />
      ) : (
        <StillNeeded items={problems} />
      )}
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Change to outpatient (A07), with an optional follow-up request ---------- */

export function OutpatientDialog({ visit, onClose }: { visit: string; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [withFollowUp, setWithFollowUp] = React.useState(true);
  const [amount, setAmount] = React.useState("1");
  const [unit, setUnit] = React.useState<"days" | "weeks">("weeks");
  const [clinic, setClinic] = React.useState(CLINICS[0]);
  const [doctorId, setDoctorId] = React.useState(enc?.attending ?? "");
  const [visitType, setVisitType] = React.useState<VisitType>("in-person");
  const [instructions, setInstructions] = React.useState("");
  const { close, guardDialog } = useGuardedClose({ reason, note, withFollowUp, amount, unit, clinic, doctorId, visitType, instructions }, onClose);
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const n = Number(amount);
  const problems = [
    reasonProblem(reason, note),
    withFollowUp && (!Number.isInteger(n) || n < 1 || n > 365) && "Enter the follow-up as a whole number of days or weeks, 1 or more.",
    withFollowUp && !clinic && "Choose the clinic for the follow-up.",
  ].filter((x): x is string => !!x);

  function confirm() {
    onClose();
    changeToOutpatient(visit, reason, note, withFollowUp ? { amount: n, unit, clinic, doctorId, visitType, instructions } : undefined);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Change To Outpatient"
      subtitle={dev ? "Sends A07. The follow-up request is HIS only: it goes to the appointments desk, no message is sent for it." : "The visit stays open as an outpatient visit. You can request the clinic follow-up at the same time."}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={problems} onClick={confirm}>Change To Outpatient</ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} />
      <RequiredNote className="mb-3" />
      <SectionTitle>Reason</SectionTitle>
      <ReasonFields reasons={CANCEL_REASONS.A07} reason={reason} setReason={setReason} note={note} setNote={setNote} label="Clinical Reason" />
      <SectionTitle>Follow-Up</SectionTitle>
      <CheckRow checked={withFollowUp} onChange={setWithFollowUp} hint="The appointments desk books the clinic visit and tells the patient.">Request Outpatient Follow-Up</CheckRow>
      {withFollowUp && (
        <div className="mt-4">
          <FormGrid cols={2}>
            <Field group label="Follow Up In" required hint={Number.isInteger(n) && n > 0 && n <= 365 ? `To be seen by ${fmtDate(followUpTarget(n, unit))}.` : "A whole number, 1 or more."}>
              <div className="grid grid-cols-[minmax(0,6rem)_auto] gap-2">
                <Input type="number" inputMode="numeric" min={1} max={365} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="How many" className="tabular-nums" />
                <SegmentedControl options={[{ value: "days" as const, label: "Days" }, { value: "weeks" as const, label: "Weeks" }]} value={unit} onChange={setUnit} label="Days or weeks" className="w-auto" />
              </div>
            </Field>
            <Field label="Clinic" required>
              <ChoiceSelect options={CLINICS} value={clinic} onChange={(v) => v && setClinic(v)} label="Clinic" />
            </Field>
            <Field label="Doctor">
              <ChoiceSelect options={doctorOptions()} value={doctorId} onChange={setDoctorId} emptyLabel="Any doctor in the clinic" label="Doctor" />
            </Field>
            <Field label="Visit Type">
              <Select value={visitType} onChange={(e) => setVisitType(e.target.value as VisitType)}>
                {(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((k) => <option key={k} value={k}>{VISIT_TYPE_LABEL[k]}</option>)}
              </Select>
            </Field>
            <Field label="Instructions" className="col-span-full">
              <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: bring the blood test results" />
            </Field>
          </FormGrid>
        </div>
      )}
      <WhatWillHappen
        items={[
          "The stay changes from inpatient to outpatient. The visit stays open.",
          enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`,
          NPHIES_NOTE.A07,
          withFollowUp && `A follow-up request goes to the appointments desk for the ${clinic}.`,
          "The reason is saved in the audit log.",
        ]}
      />
      <StillNeeded items={problems} />
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Cancel visit, cancel pre-admission, cancel transfer ---------- */

function ReasonDialog({ dlg, onClose }: { dlg: ReasonDlg; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === dlg.visit);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const { close, guardDialog } = useGuardedClose({ reason, note }, onClose);
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const inpatient = enc.cls === "I";
  const title = { A11: inpatient ? "Cancel Admission" : "Cancel Visit", A38: "Cancel Pre-Admission", A12: "Cancel Transfer" }[dlg.event];
  const back = enc.transfers[enc.transfers.length - 1];
  // Going back needs the earlier bed to still be free.
  const backProblem = dlg.event === "A12" ? (back ? bedProblem(state, back, { visit: enc.visitNumber }) : "There is no earlier bed to go back to.") : null;
  const problems = [reasonProblem(reason, note), backProblem && `${backProblem} Use Transfer to pick another bed.`].filter((x): x is string => !!x);
  // The transfer being cancelled, when it was recorded with its department.
  const live = (enc.transferLog ?? []).filter((t) => !t.cancelledAt);
  const lastMove = live[live.length - 1];
  const deptBack = dlg.event === "A12" && lastMove && lastMove.toBed === enc.bedId && lastMove.fromService !== enc.service ? lastMove.fromService : undefined;

  const effects: (string | false | undefined)[] =
    dlg.event === "A11"
      ? [inpatient ? "The admission is cancelled and the visit closes." : "The visit is cancelled and closes.", enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`]
      : dlg.event === "A38"
        ? ["The planned admission is cancelled.", enc.reservedBedId && `The reserved bed ${bedLabel(enc.reservedBedId)} becomes free.`]
        : [`${patientName(patient)} goes back to bed ${bedLabel(back)}.`, deptBack && `The department goes back to ${serviceLabel(deptBack)}.`, enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={title}
      subtitle={dev ? `Sends ${dlg.event}. The reason stays in the HIS and the audit log.` : undefined}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton variant="danger" problems={problems} onClick={() => { onClose(); sendWithReason(dlg.event, dlg.visit, reason, note); }}>
            {title}
          </ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={enc.status === "preadmit" ? [["Expected Admit Date", niceDate(enc.expectedAdmitAt)], ["Reserved Bed", enc.reservedBedId ? bedLabel(enc.reservedBedId) : "None"]] : undefined} />
      <RequiredNote className="mb-3" />
      <ReasonFields reasons={CANCEL_REASONS[dlg.event]} reason={reason} setReason={setReason} note={note} setNote={setNote} />
      <WhatWillHappen items={[...effects, NPHIES_NOTE[dlg.event], "The reason is saved in the audit log."]} />
      <StillNeeded items={problems} />
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Discharge ---------- */

const ED_OUTCOME: Partial<Record<string, DischargeOutcome>> = { Transferred: "transfer", "Left Against Advice": "ama", Died: "died", "Dead On Arrival": "died" };

const LAB_STATUS: Record<string, string> = { received: "Ordered", collected: "Collected", "in-progress": "In Progress", resulted: "Resulted", amended: "Amended", cancelled: "Cancelled" };
const RAD_STATUS: Record<string, string> = { received: "Ordered", performed: "Performed", resulted: "Reported", amended: "Amended", cancelled: "Cancelled" };
const RX_STATUS: Record<string, string> = { active: "Active", "on-hold": "On Hold", stopped: "Stopped", cancelled: "Cancelled", completed: "Completed" };
const RX_USAGE: Record<string, string> = { outpatient: "Outpatient", inpatient: "Inpatient", discharge: "Discharge", community: "Community" };

const shortDate = (iso: string | undefined): string => (iso ? niceDate(iso) : "None");

/** Staff who can teach the patient before discharge: the doctors, nurses and pharmacists. */
const EDUCATORS: string[] = [...new Set([
  ...DOCTORS.map((d) => doctorName(d.id)),
  ...USERS.filter((u) => ["physician", "nurse", "pharmacist"].includes(u.role)).map((u) => u.name),
])];

const TAB_IDS = ["disposition", "clinical", "diagnostics", "followup"] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_LABEL: Record<TabId, string> = {
  disposition: "Disposition And Attendant",
  clinical: "Clinical Summary",
  diagnostics: "Diagnostics And Medicines",
  followup: "Follow-Up And Instructions",
};

/** The visit's lab and imaging orders and prescriptions, read from their own stores. Nothing here can be changed. */
export function DiagnosticsTab({ visit }: { visit: string }) {
  const lab = useLab();
  const rad = useRad();
  const rx = useRx();
  const labs = lab.orders.filter((o) => o.visitNumber === visit);
  const rads = rad.orders.filter((o) => o.visitNumber === visit);
  const items = rxForVisit(rx, visit).flatMap((p) => p.items.map((i) => ({ p, i })));
  const testNames = (codes: string[]) => codes.map((c) => testByCode(c)?.short ?? c).join(", ");
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Read only. Orders and prescriptions are changed in the chart.</p>
      <section aria-label="Lab orders">
        <div className="mb-1.5 text-sm font-medium">Lab Orders</div>
        {labs.length === 0 ? <p className="text-sm text-muted-foreground">No lab orders on this visit.</p> : (
          <Table className="rounded-lg border border-border">
            <thead><tr><Th>Order</Th><Th>Tests</Th><Th>Ordered</Th><Th>Status</Th></tr></thead>
            <tbody>
              {labs.map((o) => (
                <tr key={o.id}>
                  <Td className="font-mono text-xs">{o.id}</Td>
                  <Td>{testNames(o.codes)}<span className="block text-xs text-muted-foreground">{expand(o.codes).length} {expand(o.codes).length === 1 ? "test" : "tests"}</span></Td>
                  <Td className="whitespace-nowrap text-xs">{shortDate(o.orderedAt)}</Td>
                  <Td><Badge tone={o.status === "resulted" || o.status === "amended" ? "ok" : o.status === "cancelled" ? "neutral" : "warn"}>{LAB_STATUS[o.status] ?? o.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section aria-label="Imaging orders">
        <div className="mb-1.5 text-sm font-medium">Imaging And Radiology</div>
        {rads.length === 0 ? <p className="text-sm text-muted-foreground">No imaging orders on this visit.</p> : (
          <Table className="rounded-lg border border-border">
            <thead><tr><Th>Order</Th><Th>Procedure</Th><Th>Ordered</Th><Th>Status</Th></tr></thead>
            <tbody>
              {rads.map((o) => (
                <tr key={o.id}>
                  <Td className="font-mono text-xs">{o.id}</Td>
                  <Td>{procByCode(o.procCode)?.short ?? o.procCode}{o.indication && <span className="block text-xs text-muted-foreground">{o.indication}</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{shortDate(o.orderedAt)}</Td>
                  <Td><Badge tone={o.status === "resulted" || o.status === "amended" ? "ok" : o.status === "cancelled" ? "neutral" : "warn"}>{RAD_STATUS[o.status] ?? o.status}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section aria-label="Prescriptions">
        <div className="mb-1.5 text-sm font-medium">Prescriptions</div>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">No prescriptions on this visit.</p> : (
          <Table className="rounded-lg border border-border">
            <thead><tr><Th>Medicine</Th><Th>Dose</Th><Th>How Often</Th><Th>Route</Th><Th>Days</Th><Th>Use</Th><Th>Status</Th></tr></thead>
            <tbody>
              {items.map(({ p, i }) => {
                const d = DRUG_BY_ID[i.drugId];
                return (
                  <tr key={i.id}>
                    <Td>{d ? `${d.generic} ${d.strengthValue} ${d.strengthUnit}` : i.drugId}<span className="block text-xs text-muted-foreground">{p.number}</span></Td>
                    <Td className="whitespace-nowrap">{i.dose} {d?.unit ?? ""}</Td>
                    <Td>{FREQ_BY_ID[i.frequencyId]?.label ?? i.frequencyId}{i.asNeeded ? ", as needed" : ""}</Td>
                    <Td>{i.route}</Td>
                    <Td>{i.durationDays}</Td>
                    <Td>{RX_USAGE[p.usage] ?? p.usage}</Td>
                    <Td><Badge tone={i.status === "active" ? "ok" : "neutral"}>{RX_STATUS[i.status] ?? i.status}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

/** The outcome buttons, and the transfer or death details the outcome needs. */
function OutcomeFields({ outcome, setOutcome, transfer, setTransfer, death, setDeath, dev }: {
  outcome: DischargeOutcome | ""; setOutcome: (o: DischargeOutcome) => void;
  transfer: ReturnType<typeof emptyTransfer>; setTransfer: (t: ReturnType<typeof emptyTransfer>) => void;
  death: ReturnType<typeof emptyDeath>; setDeath: (d: ReturnType<typeof emptyDeath>) => void;
  dev: boolean;
}) {
  return (
    <>
      <Group label="Outcome" hl7="PV1-36" required>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outcome">
          {OUTCOMES.map((o) => {
            const on = outcome === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setOutcome(o.id)}
                className={cn(
                  "rounded-xl border-2 bg-card px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  on ? "border-[#032C26] dark:border-[#39EDD5]" : "border-border hover:border-foreground/30",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {on && <Check className="size-4 text-[#035D53] dark:text-[#39EDD5]" aria-hidden="true" />}
                  {o.label}
                </span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
                {dev && <span className="mt-0.5 block font-mono text-xs text-update">{o.code}</span>}
              </button>
            );
          })}
        </div>
      </Group>

      {outcome === "transfer" && (
        <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 text-sm font-semibold">Transfer To Another Hospital</div>
        <FormGrid cols={2}>
          <Field label="Receiving Hospital" required>
            <Input value={transfer.hospital} onChange={(e) => setTransfer({ ...transfer, hospital: e.target.value })} placeholder="Hospital name" />
          </Field>
          <Field label="Reason For Transfer" required>
            <Select value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })}>
              <option value="">Choose a reason</option>
              {TRANSFER_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label="Accepting Doctor" required hint="The doctor at the receiving hospital who agreed to take the patient.">
            <Input value={transfer.acceptingDoctor} onChange={(e) => setTransfer({ ...transfer, acceptingDoctor: e.target.value })} placeholder="Doctor name" />
          </Field>
          <Field label="Transport" required>
            <Select value={transfer.transport} onChange={(e) => setTransfer({ ...transfer, transport: e.target.value })}>
              <option value="">Choose the transport</option>
              {TRANSPORT_MODES.map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field group label="Agreement" required className="col-span-full">
            <CheckRow checked={transfer.consent} onChange={(v) => setTransfer({ ...transfer, consent: v })}>The patient or family agreed to the transfer</CheckRow>
          </Field>
          {dev && (
            <p className="col-span-full text-xs text-muted-foreground">
              Developer note: the transfer request is recorded in the HIS and not sent. There is no Ihalati integration.
            </p>
          )}
        </FormGrid>
        </div>
      )}

      {outcome === "died" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Death Details</div>
          <FormGrid cols={2}>
            <Field group label="Date And Time Of Death" required>
              <DateTimeInput value={death.at} max={nowLocal()} onChange={(v) => setDeath({ ...death, at: v })} label="Date and time of death" />
            </Field>
            <Field label="Certifying Doctor" required>
              <ChoiceSelect options={doctorOptions()} value={death.certifiedBy} onChange={(v) => setDeath({ ...death, certifiedBy: v })} placeholder="Choose a doctor" label="Certifying Doctor" />
            </Field>
            <Field label="Cause Of Death" required className="col-span-full">
              <Input value={death.cause} onChange={(e) => setDeath({ ...death, cause: e.target.value })} placeholder="Cause as written by the certifying doctor" />
            </Field>
          </FormGrid>
        </div>
      )}
    </>
  );
}

/** Condition On Discharge and the discharge date and time. */
function ConditionAndTime({ outcome, condition, setCondition, at, setAt, admitAt }: {
  outcome: DischargeOutcome | ""; condition: string; setCondition: (v: string) => void; at: string; setAt: (v: string) => void; admitAt?: string;
}) {
  return (
    <FormGrid cols={2}>
      {outcome !== "died" && (
        <Field label="Condition On Discharge" required>
          <ChoiceSelect options={DISCHARGE_CONDITIONS} value={condition} onChange={setCondition} placeholder="Choose a condition" label="Condition On Discharge" />
        </Field>
      )}
      <Field group label="Discharge Date And Time" hl7="PV1-45" required>
        <DateTimeInput value={at} min={admitAt} max={nowLocal()} onChange={setAt} label="Discharge date and time" />
      </Field>
    </FormGrid>
  );
}

function FinalDiagnosis({ coded, picked, toggle }: { coded: Dx[]; picked: Dx[]; toggle: (d: Dx) => void }) {
  if (coded.length > 0) {
    return (
      <div>
        <div className="text-sm font-medium">Final Diagnosis</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {coded.map((d) => <Badge key={d.code} tone="neutral"><span className="font-mono">{d.code}</span> {d.text}</Badge>)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Taken from the chart. Change it in the chart before discharge if it is wrong.</p>
      </div>
    );
  }
  return (
    <Group label="Final Diagnosis" hl7="DG1" required hint="This visit has no diagnosis yet. Choose at least one.">
      <div className="flex flex-wrap gap-2">
        {DX_SAMPLES.map((d) => {
          const on = picked.some((x) => x.code === d.code);
          return (
            <button
              key={d.code}
              type="button"
              onClick={() => toggle(d)}
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                on ? "border-[#03C1AC] bg-[#39EDD5]/16 font-medium text-[#035D53] dark:text-[#39EDD5]" : "border-input bg-card hover:border-foreground/45 hover:bg-muted",
              )}
            >
              {on && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              <span className="font-mono text-xs font-semibold">{d.code}</span> {d.text}
            </button>
          );
        })}
      </div>
    </Group>
  );
}

/** The attendant who takes the patient home. */
function AttendantFields({ value, onChange }: { value: DischargeAttendant; onChange: (v: DischargeAttendant) => void }) {
  const set = <K extends keyof DischargeAttendant>(k: K, v: DischargeAttendant[K]) => onChange({ ...value, [k]: v });
  return (
    <FormGrid cols={2}>
      <Field label="Attendant Name">
        <Input value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Full name" autoComplete="off" />
      </Field>
      <Field label="Contact Number">
        <Input type="tel" inputMode="tel" value={value.phone} onChange={(e) => set("phone", e.target.value)} placeholder="05XXXXXXXX" />
      </Field>
      <Field label="Relationship">
        <Select value={value.relation} onChange={(e) => set("relation", e.target.value)}>
          <option value="">Choose a relationship</option>
          {ATTENDANT_RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="ID Type">
        <Select value={value.idType} onChange={(e) => set("idType", e.target.value)}>
          <option value="">Choose an ID type</option>
          {ATTENDANT_ID_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="ID Number" className="col-span-full" hint="National ID, Iqama or passport number of the attendant.">
        <Input value={value.idNumber} onChange={(e) => set("idNumber", e.target.value)} inputMode={value.idType === "Passport" ? "text" : "numeric"} autoComplete="off" className="font-mono" />
      </Field>
    </FormGrid>
  );
}

/** One or more doctors who approved the discharge. */
function ApprovalsFields({ value, onChange, defaultDoctor }: { value: DischargeApproval[]; onChange: (v: DischargeApproval[]) => void; defaultDoctor?: string }) {
  const set = (i: number, patch: Partial<DischargeApproval>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const add = () => {
    const used = new Set(value.map((a) => a.doctor));
    onChange([...value, emptyApproval(nowLocal(), defaultDoctor && !used.has(defaultDoctor) ? defaultDoctor : "")]);
  };
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">Doctor Approvals</div>
          <p className="text-xs text-muted-foreground">The doctors who approved this discharge. Optional.</p>
        </div>
        <Button size="sm" onClick={add}><Plus className="size-4" />Add Approval</Button>
      </div>
      {value.length === 0 && <p className="mt-2 rounded-lg border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground">No approvals added yet.</p>}
      <div className="mt-2 space-y-2">
        {value.map((a, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4" role="group" aria-label={`Approval ${i + 1}`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Approval {i + 1}</span>
              <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove approval ${i + 1}`}><Trash2 className="size-4" />Remove</Button>
            </div>
            <FormGrid cols={2}>
              <Field label="Approving Doctor" required>
                <ChoiceSelect options={doctorOptions()} value={a.doctor} onChange={(v) => set(i, { doctor: v })} placeholder="Choose a doctor" label="Approving Doctor" />
              </Field>
              <Field label="Doctor Role" required>
                <Select value={a.role} onChange={(e) => set(i, { role: e.target.value })}>
                  {APPROVAL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
              <Field group label="Approval Date And Time" required>
                <DateTimeInput value={a.at} max={nowLocal()} onChange={(v) => set(i, { at: v })} label="Approval date and time" />
              </Field>
              <Field label="Remarks">
                <Input value={a.remarks} onChange={(e) => set(i, { remarks: e.target.value })} placeholder="Optional note" />
              </Field>
            </FormGrid>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The summary as the doctor finds it: reason, admitting diagnosis and procedures from the chart. */
function summaryFromChart(enc: Encounter): DischargeSummary {
  const admitting = enc.dx.filter((d) => d.kind === "AD" || d.type === "A");
  return {
    ...emptySummary(),
    reasonForAdmission: enc.reason ?? "",
    admittingDiagnosis: admitting.map((d) => `${d.code} ${d.text}`.trim()).join("; "),
    procedures: enc.pr.map((p) => `${p.code ? `${p.code} ` : ""}${p.text}`).join("; "),
  };
}

export function DischargeDialog({ visit, onClose }: { visit: string; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const [outcome, setOutcome] = React.useState<DischargeOutcome | "">(() => (enc?.ed?.disposition ? ED_OUTCOME[enc.ed.disposition] ?? "home" : ""));
  const [picked, setPicked] = React.useState<Dx[]>([]);
  const [transfer, setTransfer] = React.useState(emptyTransfer);
  const [death, setDeath] = React.useState(() => ({ ...emptyDeath(), at: nowLocal(), certifiedBy: enc?.attending ?? "" }));
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [condition, setCondition] = React.useState("");
  const [at, setAt] = React.useState(nowLocal());
  const [attendant, setAttendant] = React.useState<DischargeAttendant>(() => ({
    ...emptyAttendant(), name: enc?.admission?.attendantName ?? "", phone: enc?.admission?.attendantPhone ?? "",
    relation: enc?.admission?.attendantRelation && ATTENDANT_RELATIONS.includes(enc.admission.attendantRelation) ? enc.admission.attendantRelation : "",
  }));
  const [summary, setSummary] = React.useState<DischargeSummary>(() => (enc ? summaryFromChart(enc) : emptySummary()));
  const [instructions, setInstructions] = React.useState("");
  const [educatedBy, setEducatedBy] = React.useState("");
  const [ambulance, setAmbulance] = React.useState(false);
  const [approvals, setApprovals] = React.useState<DischargeApproval[]>([]);
  const [tab, setTab] = React.useState<TabId>("disposition");
  const { close, guardDialog } = useGuardedClose(
    { outcome, picked, transfer, death: { ...death, at: "" }, override, overrideReason, condition, attendant, summary, instructions, educatedBy, ambulance, approvals },
    onClose,
  );
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const inpatient = enc.cls === "I";
  const coded = enc.dx.filter((d) => d.code);
  const toggle = (d: Dx) => setPicked((p) => (p.some((x) => x.code === d.code) ? p.filter((x) => x.code !== d.code) : [...p, d]));
  const clearances = needsClearances(enc);
  const missing = missingClearances(enc);
  const bedId = inpatient ? enc.bedId : undefined;
  const now = nowLocal();

  const details: DischargeDetails = inpatient
    ? { condition: outcome === "died" ? undefined : condition, dischargeAt: at, attendant, summary, instructions, educatedBy, ambulance, approvals }
    : { condition: outcome === "died" ? undefined : condition, dischargeAt: at, instructions };

  const first: string[] = [];
  if (!outcome) first.push("Choose the outcome.");
  else first.push(...outcomeProblems({ outcome, transfer, death }, { admitAt: enc.admitAt, now }));
  const detail = detailProblems(details, { outcome, admitAt: enc.admitAt, now });
  const approvalIssues = detail.filter((p) => p.startsWith("Approval"));
  first.push(...detail.filter((p) => !p.startsWith("Approval")));
  if (coded.length === 0 && picked.length === 0) first.push("Choose a final diagnosis.");
  if (missing.length && !override) first.push(`Waiting for these clearances: ${missing.map(clearanceLabel).join(", ")}.`);
  if (missing.length && override && !overrideOk(overrideReason)) first.push(`Type the reason for the override (at least ${OVERRIDE_MIN} characters).`);
  const problems = [...first, ...approvalIssues];
  const tabIssues: Partial<Record<TabId, number>> = { disposition: first.length, followup: approvalIssues.length };

  function confirm() {
    if (!outcome) return;
    onClose();
    dischargePatient(visit, { outcome, dx: picked, transfer, death, overrideReason: missing.length && override ? overrideReason : undefined, details });
  }

  const clearanceBlock = clearances && (
    <div>
      <SectionTitle help="All four are needed before an inpatient can go home.">Discharge Clearances</SectionTitle>
      <ClearanceChips enc={enc} />
      {missing.length > 0 && (
        <div className="mt-3 rounded-xl border border-warn/50 border-l-4 border-l-warn bg-card px-4 py-3 text-sm">
          <div className="flex items-center gap-1.5 font-semibold text-warn"><TriangleAlert className="size-4" aria-hidden="true" /> Discharge Is Blocked</div>
          <p className="mt-1">Still waiting for:</p>
          <ul className="list-disc ps-5">
            {clearanceList(enc).filter((c) => !c.done).map((c) => <li key={c.key}>{c.label} clearance, given by the {c.who.toLowerCase()}</li>)}
          </ul>
          <CheckRow className="mt-3" tone="warn" checked={override} onChange={setOverride} hint="Only when the patient must leave now.">Discharge without these clearances</CheckRow>
          {override && (
            <Field label="Reason For Override" required className="mt-3" hint={`Your name, the missing clearances and this reason are written to the audit log. At least ${OVERRIDE_MIN} characters.`}>
              <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why the patient must be discharged now" />
            </Field>
          )}
        </div>
      )}
    </div>
  );

  const outcomeFields = <OutcomeFields outcome={outcome} setOutcome={setOutcome} transfer={transfer} setTransfer={setTransfer} death={death} setDeath={setDeath} dev={dev} />;
  const conditionFields = <ConditionAndTime outcome={outcome} condition={condition} setCondition={setCondition} at={at} setAt={setAt} admitAt={enc.admitAt} />;
  const setSum = <K extends keyof DischargeSummary>(k: K, v: string) => setSummary((s) => ({ ...s, [k]: v }));

  const tabDone: Partial<Record<TabId, boolean>> = {
    disposition: first.length === 0,
    clinical: !!(summary.reasonForAdmission || summary.course || summary.findings),
    followup: approvalIssues.length === 0 && !!(instructions || educatedBy),
  };
  const tabIndex = TAB_IDS.indexOf(tab);

  return (
    <Dialog
      open
      onClose={close}
      wide
      title="Discharge Patient"
      subtitle={dev ? "Sends A03. The outcome sets PV1-36 and the discharge time PV1-45. A03 needs at least one diagnosis (DG1). Everything else is kept in the HIS." : inpatient ? "Work through the four tabs, check what will happen, then confirm." : "Choose the outcome first, then check what will happen."}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={problems} onClick={confirm}>Discharge Patient</ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} />
      <RequiredNote className="mb-3" />

      {!inpatient ? (
        <div>
          <SectionTitle>Outcome</SectionTitle>
          <div className="space-y-4">{outcomeFields}</div>
          <SectionTitle>Discharge</SectionTitle>
          {conditionFields}
          <div className="mt-5"><FinalDiagnosis coded={coded} picked={picked} toggle={toggle} /></div>
          <Field label="Discharge Instructions" className="mt-5" hint="Optional. What the patient should do at home and when to come back.">
            <Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: rest, drink fluids, come back if the fever lasts more than three days" />
          </Field>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-4" aria-label="Discharge sections">
            {TAB_IDS.map((id, i) => (
              <TabsTrigger key={id} value={id} className="h-auto min-h-9 justify-start gap-1.5 whitespace-normal rounded-lg px-2.5 py-1.5 text-left text-xs leading-snug sm:text-[0.8125rem]">
                <span className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold tabular-nums",
                  tabIssues[id] ? "bg-warn/20 text-warn" : tabDone[id] ? "bg-[#39EDD5]/25 text-[#035D53] dark:text-[#39EDD5]" : "bg-card text-muted-foreground",
                )}>
                  {tabIssues[id] ? tabIssues[id] : tabDone[id] ? <Check className="size-3" aria-hidden="true" /> : i + 1}
                </span>
                <span className="min-w-0">{TAB_LABEL[id]}</span>
                {!!tabIssues[id] && <span className="sr-only">, {tabIssues[id]} still needed</span>}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="disposition" className="pt-3">
            <SectionTitle>Outcome</SectionTitle>
            <div className="space-y-4">{outcomeFields}</div>
            <SectionTitle>Discharge</SectionTitle>
            {conditionFields}
            <div className="mt-5"><FinalDiagnosis coded={coded} picked={picked} toggle={toggle} /></div>
            <SectionTitle help="The person who takes the patient home. Optional.">Patient Attendant</SectionTitle>
            <AttendantFields value={attendant} onChange={setAttendant} />
            {clearanceBlock}
          </TabsContent>

          <TabsContent value="clinical" className="pt-3">
            <SectionTitle help="Filled from the chart where it can be. Edit before you discharge.">Clinical Summary</SectionTitle>
            <div className="space-y-5">
              <Field label="Reason For Admission">
                <Textarea rows={2} value={summary.reasonForAdmission} onChange={(e) => setSum("reasonForAdmission", e.target.value)} placeholder="The presenting complaints at admission" />
              </Field>
              <Field label="Admitting Diagnosis">
                <Textarea rows={2} value={summary.admittingDiagnosis} onChange={(e) => setSum("admittingDiagnosis", e.target.value)} placeholder="The diagnosis recorded at admission" />
              </Field>
              <Field label="Procedures Done">
                <Textarea rows={2} value={summary.procedures} onChange={(e) => setSum("procedures", e.target.value)} placeholder="Surgical or diagnostic procedures during the stay" />
              </Field>
              <Field label="Key Results And Findings">
                <Textarea rows={2} value={summary.findings} onChange={(e) => setSum("findings", e.target.value)} placeholder="Important lab and imaging results" />
              </Field>
              <Field label="Hospital Course">
                <Textarea rows={3} value={summary.course} onChange={(e) => setSum("course", e.target.value)} placeholder="How the stay went and the treatment given" />
              </Field>
            </div>
          </TabsContent>

          <TabsContent value="diagnostics" className="pt-3">
            <DiagnosticsTab visit={visit} />
          </TabsContent>

          <TabsContent value="followup" className="pt-3">
            <SectionTitle>Instructions</SectionTitle>
            <div className="space-y-5">
              <Field label="Discharge Instructions" hint="Next visits, activities to avoid and warning signs.">
                <Textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: no heavy lifting for two weeks, come back if the wound is red or the fever returns" />
              </Field>
              <Field label="Education Given By" hint="The staff member who explained the instructions to the patient or attendant.">
                <ChoiceSelect options={EDUCATORS} value={educatedBy} onChange={setEducatedBy} placeholder="Choose a staff member" label="Education Given By" />
              </Field>
              <CheckRow checked={ambulance} onChange={setAmbulance} hint="Tick when the patient needs assisted transport to go home.">Request Ambulance Transport</CheckRow>
            </div>
            <SectionTitle>Approvals</SectionTitle>
            <ApprovalsFields value={approvals} onChange={setApprovals} defaultDoctor={enc.attending} />
          </TabsContent>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            {tabIndex > 0 ? <Button size="sm" onClick={() => setTab(TAB_IDS[tabIndex - 1])}>← Back: {TAB_LABEL[TAB_IDS[tabIndex - 1]]}</Button> : <span />}
            {tabIndex < TAB_IDS.length - 1 && <Button size="sm" onClick={() => setTab(TAB_IDS[tabIndex + 1])}>Next: {TAB_LABEL[TAB_IDS[tabIndex + 1]]} →</Button>}
          </div>
        </Tabs>
      )}

      {outcome && (
        <WhatWillHappen
          items={[
            `The visit closes with the outcome: ${outcomeDef(outcome).label}.`,
            bedId && `Bed ${bedLabel(bedId)} is not free yet. It stays held until the nurse records that the patient left the ward, then it goes to cleaning.`,
            outcome === "transfer" && "The transfer details are saved in the patient record.",
            outcome === "died" && "The death details are saved in the patient record.",
            inpatient && ambulance && "The ambulance request is saved with the discharge.",
            inpatient && "The discharge details are saved in the HIS and the audit log.",
            missing.length > 0 && override && "The override and your reason are written to the audit log.",
            NPHIES_NOTE.A03,
            "You can undo this from the message that appears.",
          ]}
        />
      )}
      <StillNeeded items={problems} />
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Discharge clearances ---------- */

/** The four clearances as chips. Grey with a clock means waiting. Green with a tick means done. */
export function ClearanceChips({ enc, onOpen }: { enc: Encounter; onOpen?: () => void }) {
  const list = clearanceList(enc);
  const done = list.filter((c) => c.done).length;
  const chips = list.map((c) => (
    <span
      key={c.key}
      title={c.done ? `${c.label}: given by ${c.done.by} (${c.done.role}), ${niceDate(c.done.at)}` : `${c.label}: waiting for the ${c.who.toLowerCase()}`}
      className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium leading-none whitespace-nowrap", c.done ? "bg-ok/14 text-ok" : "bg-muted text-muted-foreground")}
    >
      {c.done ? <Check className="size-3.5" aria-hidden="true" /> : <Clock className="size-3.5" aria-hidden="true" />}
      {c.label}
      <span className="sr-only">{c.done ? ": done" : ": waiting"}</span>
    </span>
  ));
  if (!onOpen) return <span className="flex flex-wrap gap-1">{chips}</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Discharge clearances, ${done} of ${list.length} done. Open to give or withdraw.`}
      className="flex flex-wrap gap-1 rounded-md p-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {chips}
    </button>
  );
}

function ClearancesDialog({ dlg, onClose }: { dlg: ClearanceDlg; onClose: () => void }) {
  const state = useHis();
  const { role } = useSession();
  const enc = state.encounters.find((e) => e.visitNumber === dlg.visit);
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const open = enc.status === "active" && enc.cls === "I";
  const missing = missingClearances(enc);
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Discharge Clearances"
      subtitle="All four are needed before an inpatient can be discharged."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} />
      <ul className="divide-y divide-border rounded-lg border border-border">
        {clearanceList(enc).map((c) => {
          const allowed = canGiveClearance(c.key, role.permissions);
          return (
            <li key={c.key} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.label}
                  <Badge tone={c.done ? "ok" : "neutral"}>{c.done ? "Done" : "Waiting"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.done ? `Given by ${c.done.by} (${c.done.role}), ${niceDate(c.done.at)}` : c.meaning}
                </div>
                {!allowed && <div className="text-xs text-muted-foreground">Only a {c.who.toLowerCase()} can {c.done ? "withdraw" : "give"} this.</div>}
              </div>
              {open && (
                <ReasonButton size="sm" variant={c.done ? "secondary" : "primary"} reason={allowed ? undefined : `Only a ${c.who.toLowerCase()} can ${c.done ? "withdraw" : "give"} this clearance.`} onClick={() => setClearance(enc.visitNumber, c.key, !c.done)}>
                  {c.done ? `Withdraw ${c.label} Clearance` : `Give ${c.label} Clearance`}
                </ReasonButton>
              )}
            </li>
          );
        })}
      </ul>
      <WhatWillHappen
        items={[
          missing.length ? `Discharge stays blocked until these are given: ${missing.map(clearanceLabel).join(", ")}.` : "All four clearances are done. The patient can be discharged.",
          "Each clearance records who gave it and when, in the audit log.",
          "No message is sent to NPHIES for a clearance.",
        ]}
      />
    </Dialog>
  );
}

/* ---------- Patient left the ward ---------- */

function LeftWardDialog({ dlg, onClose }: { dlg: LeftDlg; onClose: () => void }) {
  const state = useHis();
  const enc = state.encounters.find((e) => e.visitNumber === dlg.visit);
  const [at, setAt] = React.useState(nowLocal());
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const bedId = heldBedOf(enc);
  const ordered = enc.discharge?.orderedAt ?? "";
  const problem = !bedId ? "This patient is not waiting to leave a bed." : !at ? "Enter the time the patient left." : at < ordered ? "The patient cannot leave before the discharge." : at > nowLocal() ? "The leaving time cannot be in the future." : "";
  const gap = at && ordered && at >= ordered ? Math.round((new Date(at).getTime() - new Date(ordered).getTime()) / 60_000) : undefined;
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Patient Left The Ward"
      subtitle="Record when the discharged patient left. The bed is held until then."
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <ConfirmButton problems={problem ? [problem] : []} onClick={() => { onClose(); recordLeftWard(dlg.visit, at); }}>
            Record Patient Left
          </ConfirmButton>
        </>
      }
    >
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={[["Discharged", niceDate(ordered)], ["Outcome", enc.discharge ? outcomeDef(enc.discharge.outcome).label : "None"]]} />
      <FormGrid cols={2}>
        <Field group label="Time The Patient Left" required>
          <DateTimeInput value={at} min={ordered} max={nowLocal()} onChange={setAt} label="Time the patient left" />
        </Field>
      </FormGrid>
      <WhatWillHappen
        items={[
          bedId && `Bed ${bedLabel(bedId)} goes to cleaning. It is free after someone marks it ready.`,
          gap !== undefined && `The wait from discharge to leaving is saved: ${gapText(gap)}.`,
          "No message is sent to NPHIES for this step.",
        ]}
      />
      <StillNeeded items={problem ? [problem] : []} />
    </Dialog>
  );
}

/* ---------- Take a bed out of service ---------- */

function BedServiceDialog({ dlg, onClose }: { dlg: BedServiceDlg; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const bed = BED_BY_ID[dlg.bedId];
  const problem = reasonProblem(reason, note);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Take Bed Out Of Service"
      subtitle="No patient is in this bed."
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <ConfirmButton variant="danger" problems={problem ? [problem] : []} onClick={() => { onClose(); setBedOutOfService(dlg.bedId, reason, note); }}>
            Take Out Of Service
          </ConfirmButton>
        </>
      }
    >
      <div className="mb-4 rounded-lg border border-border px-3 py-2.5" role="group" aria-label="Now">
        <div className="text-xs font-semibold text-muted-foreground">Now</div>
        <dl className="mt-1 grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Ward</dt><dd className="text-sm font-medium">{bed?.wardName}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Bed</dt><dd className="text-sm font-medium">{bed?.room}-{bed?.bed}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Patient</dt><dd className="text-sm font-medium">None</dd></div>
        </dl>
      </div>
      <RequiredNote className="mb-2" />
      <ReasonFields reasons={OUT_OF_SERVICE_REASONS} reason={reason} setReason={setReason} note={note} setNote={setNote} />
      <WhatWillHappen
        items={[
          `Bed ${bedLabel(dlg.bedId)} cannot be used for admissions or transfers until it is returned to service.`,
          "The reason is shown on the bed board and saved in the audit log.",
        ]}
      />
      <StillNeeded items={problem ? [problem] : []} />
    </Dialog>
  );
}

/* ---------- Discharge progress for a worklist row or the chart ---------- */

/**
 * Where an inpatient stay is on the way out: the four clearances while admitted, then the wait between the
 * discharge and the patient leaving the ward. Shows nothing for visits it does not apply to.
 */
export function DischargeProgress({ enc, onClearances, onLeftWard }: { enc: Encounter; onClearances: (visit: string) => void; onLeftWard: (visit: string) => void }) {
  useSession();
  if (enc.cls !== "I") return null;
  if (enc.status === "active") return <ClearanceChips enc={enc} onOpen={() => onClearances(enc.visitNumber)} />;
  if (enc.status !== "discharged") return null;
  const gap = departureGap(enc, nowLocal());
  const outcome = enc.discharge ? outcomeDef(enc.discharge.outcome).label : undefined;
  if (!gap) return outcome ? <span className="text-xs text-muted-foreground">Outcome: {outcome}</span> : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div>
        <div className="text-xs text-muted-foreground">{gap.left ? "Discharge to leaving" : "Waiting to leave"}</div>
        <div className={cn("text-base font-semibold tabular-nums leading-tight", !gap.left && "text-warn")}>{gapText(gap.minutes)}</div>
        {outcome && <div className="text-xs text-muted-foreground">Outcome: {outcome}</div>}
      </div>
      {!gap.left && (
        <Button size="sm" disabled={!can("emr.write") && !can("adt.send")} onClick={() => onLeftWard(enc.visitNumber)}>
          Patient Left The Ward
        </Button>
      )}
    </div>
  );
}

/** The same progress with its own dialogs. Used in the chart's visit actions. */
export function VisitDischargeProgress({ enc }: { enc: Encounter }) {
  const { openClearances, openLeftWard, dialogs } = useVisitActions();
  if (enc.cls !== "I" || (enc.status !== "active" && !(enc.status === "discharged" && enc.discharge))) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{enc.status === "active" ? "Discharge clearances" : "Discharge"}</span>
      <DischargeProgress enc={enc} onClearances={openClearances} onLeftWard={openLeftWard} />
      {dialogs}
    </span>
  );
}

/* ---------- Register, admit, pre-admit ---------- */

function RegisterDialog({ dlg, onClose, onNewPatient }: { dlg: RegisterDlg; onClose: () => void; onNewPatient: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const [patientId, setPatientId] = React.useState(dlg.patientId ?? "");
  const [attending, setAttending] = React.useState(DOCTORS[0].id);
  const [service, setService] = React.useState(dlg.type === "A04" ? "OPD" : "MED");
  const [reason, setReason] = React.useState("");
  const [bedId, setBedId] = React.useState(dlg.bedId ?? (dlg.type === "A01" && dlg.patientId ? reservedBedFor(state, dlg.patientId) ?? "" : ""));
  const [admitClass, setAdmitClass] = React.useState<"I" | "O">("I");
  const [method, setMethod] = React.useState(defaultAdmissionMethod(dlg.type === "A04" ? "O" : "I"));
  const [expected, setExpected] = React.useState(() => {
    const t = new Date(Date.now() + 86_400_000);
    t.setHours(8, 0, 0, 0);
    return nowLocal((t.getTime() - Date.now()) / 60_000);
  });
  const [extras, setExtras] = React.useState<AdmissionExtras>(() =>
    dlg.type === "A01" && dlg.patientId ? extrasFrom(state.encounters.find((e) => e.patientId === dlg.patientId && e.status === "preadmit")) : emptyExtras());
  const [dx, setDx] = React.useState<{ code: string; text: string } | undefined>();

  const patient = state.patients.find((p) => p.id === patientId);
  const pre = dlg.type === "A01" ? state.encounters.find((e) => e.patientId === patientId && e.status === "preadmit") : undefined;
  const admit = dlg.type !== "A04";
  const extraIssues = admit ? extrasProblems(extras) : [];
  const who = { patientId };
  const infos = bedInfos(state);
  const open = new Set(availableBeds(state, who).map((b) => b.id));
  const titles = { A04: "Register Visit", A01: "Admit Patient", A05: "Pre-Admit Patient" } as const;
  const subs = {
    A04: "Outpatient or same-day visit. Sends A04.",
    A01: "Inpatient admission with a bed. Sends A01.",
    A05: "Planned admission with an expected date. Sends A05. A reserved bed is kept in the HIS only.",
  } as const;
  const needBed = dlg.type === "A01" && admitClass === "I";
  const holdBed = dlg.type === "A05" && admitClass === "I";
  const bedOk = !bedId || open.has(bedId);
  const ready = !!patientId && (!needBed || !!bedId) && (!(needBed || holdBed) || bedOk) && (dlg.type !== "A05" || !!expected) && extraIssues.length === 0;

  function pickPatient(id: string) {
    setPatientId(id);
    // The bed held for this patient's planned admission is offered first.
    const held = dlg.type === "A01" ? reservedBedFor(state, id) : undefined;
    if (held && !dlg.bedId) setBedId(held);
    // A pre-admission's details are offered again when the patient is admitted.
    const planned = dlg.type === "A01" ? state.encounters.find((e) => e.patientId === id && e.status === "preadmit") : undefined;
    setExtras(planned ? extrasFrom(planned) : emptyExtras());
  }

  function submit() {
    const d = DOCTORS.find((x) => x.id === attending);
    onClose();
    quickCreate(dlg.type, {
      patientId,
      attending,
      service: dlg.type === "A04" ? service : (d?.service ?? service),
      reason,
      bedId: needBed ? bedId : "",
      expectedAdmitAt: expected,
      admitClass: dlg.type === "A04" ? undefined : admitClass,
      admissionMethod: method,
      reserveBedId: holdBed && bedId ? bedId : undefined,
      consulting: admit && extras.consulting ? extras.consulting : undefined,
      dx: admit && dx ? [{ code: dx.code, text: dx.text, type: "A", kind: "AD" }] : undefined,
      admission: admit ? extrasToAdmission(extras) : undefined,
    });
  }

  const effects: (string | false | undefined)[] =
    dlg.type === "A04"
      ? ["A new outpatient visit opens for this patient."]
      : dlg.type === "A01"
        ? [
            pre ? "The planned admission becomes an active stay." : `A new ${admitClass === "I" ? "inpatient stay" : "outpatient visit"} opens for this patient.`,
            needBed && bedId && `Bed ${bedLabel(bedId)} becomes occupied.`,
            pre?.reservedBedId && needBed && bedId && pre.reservedBedId !== bedId && `The reserved bed ${bedLabel(pre.reservedBedId)} becomes free.`,
          ]
        : ["A planned admission is saved with the expected date.", holdBed && bedId ? `Bed ${bedLabel(bedId)} is reserved for this patient until the admission or its cancellation.` : "No bed is reserved."];

  const bedOptions = infos.map((i) => {
    const ok = open.has(i.bed.id);
    const mine = ok && i.state === "reserved";
    return (
      <option key={i.bed.id} value={i.bed.id} disabled={!ok}>
        {i.bed.wardName}, {i.bed.room}-{i.bed.bed} ({ok ? (mine ? "Reserved for this patient" : "Free") : unavailableLabel(i, who)})
      </option>
    );
  });

  const stillNeeded = [!patientId && "Choose the patient.", needBed && !bedId && "Choose a bed.", !bedOk && "The chosen bed is not available. Choose another bed.", dlg.type === "A05" && !expected && "Enter the expected admit date.", ...extraIssues].filter((x): x is string => !!x);
  const { close, guardDialog } = useGuardedClose({ patientId, attending, service, reason, bedId, admitClass, method, extras, dx }, onClose);

  return (
    <Dialog
      open
      onClose={close}
      wide
      title={titles[dlg.type]}
      subtitle={dev ? subs[dlg.type] : undefined}
      footer={
        <>
          <Button onClick={close}>Go Back</Button>
          <ConfirmButton problems={ready ? [] : stillNeeded.length ? stillNeeded : ["Check the details above."]} onClick={submit}>
            {titles[dlg.type]}
          </ConfirmButton>
        </>
      }
    >
      <DialogScroll>
      <PatientStrip patient={patient} />
      {pre && <NowStrip enc={pre} extra={[["Expected Admit Date", niceDate(pre.expectedAdmitAt)], ["Reserved Bed", pre.reservedBedId ? bedLabel(pre.reservedBedId) : "None"]]} />}
      <RequiredNote className="mb-3" />
      <FormGrid cols={2}>
        <Field group label="Patient" hl7="PID-3" required className="col-span-full" hint="Type a name or file number to search.">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1 basis-56">
              <ChoiceSelect options={state.patients.map((p) => ({ value: p.id, label: `${patientName(p)} (${p.mrn})` }))} value={patientId} onChange={pickPatient} placeholder="Select a patient" label="Patient" />
            </div>
            <Button className="h-10" onClick={onNewPatient} title="Register a new patient">
              <UserPlus className="size-4" />
              New Patient
            </Button>
          </div>
        </Field>
        <Field label="Doctor" hl7="PV1-7" required>
          <ChoiceSelect options={doctorOptions()} value={attending} onChange={(v) => v && setAttending(v)} label="Doctor" />
        </Field>
        {dlg.type === "A04" && (
          <Field label="Department" hl7="PV1-10" required>
            <ChoiceSelect options={SERVICES.map((s) => ({ value: s.code, label: s.label }))} value={service} onChange={(v) => v && setService(v)} label="Department" />
          </Field>
        )}
        {dlg.type !== "A04" && (
          <Field group label="Patient Class" hl7="PV1-2" required>
            <SegmentedControl options={[{ value: "I" as const, label: "Inpatient" }, { value: "O" as const, label: "Outpatient" }]} value={admitClass} onChange={setAdmitClass} label="Patient class" />
          </Field>
        )}
        <Field label="Admission Method" hl7="PV1-4" required>
          <Select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Admission method">
            {ADMISSION_METHODS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {needBed && (
          <Field label="Bed" hl7="PV1-3" required hint="Only free beds can be picked. The others say why they are not available.">
            <Select value={bedId} onChange={(e) => setBedId(e.target.value)} aria-label="Bed" aria-invalid={!bedOk}>
              <option value="">Select a bed</option>
              {bedOptions}
            </Select>
          </Field>
        )}
        {holdBed && (
          <Field label="Reserve Bed" hint="Optional. The bed is held for this patient until the admission.">
            <Select value={bedId} onChange={(e) => setBedId(e.target.value)} aria-label="Reserve bed" aria-invalid={!bedOk}>
              <option value="">Do not reserve a bed</option>
              {bedOptions}
            </Select>
          </Field>
        )}
        {dlg.type === "A05" && (
          <Field group label="Expected Admit Date" hl7="PV2-8" required>
            <DateTimeInput value={expected} onChange={setExpected} label="Expected admit date" />
          </Field>
        )}
        <Field label="Reason For Visit" hl7="PV2-12" className="col-span-full">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type a reason, or tap one below" />
        </Field>
        <div className="col-span-full -mt-3 flex flex-wrap gap-1.5">
          {COMPLAINT_SAMPLES.map((c) => (
            <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground/45 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {c.text}
            </button>
          ))}
        </div>
        {admit && (
          <div className="col-span-full">
            <Group label="Admitting Diagnosis" hl7="DG1" hint={pre?.dx.length ? `The pre-admission already has ${pre.dx.map((d) => d.code).join(", ")}. A new code is added to it.` : "Optional. ICD-10-AM. It goes in the message."}>
              <DiagnosisSearch value={dx} onChange={setDx} />
            </Group>
          </div>
        )}
      </FormGrid>
      {admit && (
        <>
          <SectionTitle>Admission Details</SectionTitle>
          <AdmissionExtrasFields value={extras} onChange={setExtras} />
        </>
      )}
      {patientId && <WhatWillHappen items={[...effects, admit && dx && `The admitting diagnosis ${dx.code} is sent in the message.`, NPHIES_NOTE[dlg.type], admit && "The admission details are saved in the HIS.", "You can undo this from the message that appears."]} />}
      <StillNeeded items={stillNeeded} />
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}

/* ---------- Move visit to the right patient (A45) ---------- */

const CLS_LABEL: Record<string, string> = { I: "Inpatient", O: "Outpatient", E: "Emergency" };
const STATUS_LABEL: Record<string, string> = { active: "Open", preadmit: "Pre-admission", discharged: "Discharged", cancelled: "Cancelled" };

/** One patient file, shown side by side with the other so the clerk can compare them. */
function PatientCard({ patient, title, tone }: { patient: Patient | undefined; title: string; tone: "from" | "to" }) {
  const state = useHis();
  const hidden = !!patient?.confidential && !hasGlass(patient.id);
  const open = patient ? state.encounters.filter((e) => e.patientId === patient.id && (e.status === "active" || e.status === "preadmit")).length : 0;
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2.5", tone === "from" ? "border-cancel/40 bg-cancel/6" : "border-admit/50 bg-admit/8")} role="group" aria-label={title}>
      <div className={cn("text-xs font-semibold", tone === "from" ? "text-cancel" : "text-admit")}>{title}</div>
      {patient ? (
        <>
          <div className="mt-0.5 truncate text-sm font-semibold">{hidden ? "Confidential patient" : patientName(patient)}</div>
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div><dt className="text-muted-foreground">MRN</dt><dd className="font-medium">{patient.mrn}</dd></div>
            <div><dt className="text-muted-foreground">National ID</dt><dd className="font-medium">{hidden ? "Hidden" : patient.nationalId}</dd></div>
            <div><dt className="text-muted-foreground">Date Of Birth</dt><dd className="font-medium">{hidden ? "Hidden" : `${patient.dob} (${ageOf(patient.dob)} years)`}</dd></div>
            <div><dt className="text-muted-foreground">Sex</dt><dd className="font-medium">{patient.sex === "M" ? "Male" : "Female"}</dd></div>
            <div><dt className="text-muted-foreground">Health ID</dt><dd className="font-medium">{hidden ? "Hidden" : patient.healthId || "None"}</dd></div>
            <div><dt className="text-muted-foreground">Open Visits</dt><dd className="font-medium">{open}</dd></div>
          </dl>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Search and choose the patient who should own this visit.</p>
      )}
    </div>
  );
}

export function MoveVisitDialog({ visit, onClose }: { visit: string; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const [query, setQuery] = React.useState("");
  const [toId, setToId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [review, setReview] = React.useState(false);
  const listId = React.useId();
  const { close, guardDialog } = useGuardedClose({ toId, reason, note }, onClose);
  if (!enc) return null;
  const from = state.patients.find((p) => p.id === enc.patientId);
  const to = state.patients.find((p) => p.id === toId);
  const allowed = can("adt.send");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? state.patients.filter((p) => p.id !== enc.patientId && !p.mergedInto).filter((p) => {
        const hidden = !!p.confidential && !hasGlass(p.id);
        const hay = `${hidden ? "" : `${p.given} ${p.family} ${p.nationalId} ${p.extra?.mobile ?? ""}`} ${p.mrn}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }).slice(0, 6)
    : [];
  const problems = [
    !allowed && "Your role cannot move a visit.",
    moveVisitProblem(state, visit, toId),
    reasonProblem(reason, note),
  ].filter((x): x is string => !!x);
  const counts = [
    enc.dx.length && `${enc.dx.length} ${enc.dx.length === 1 ? "diagnosis" : "diagnoses"}`,
    enc.pr.length && `${enc.pr.length} ${enc.pr.length === 1 ? "procedure" : "procedures"}`,
    enc.allergies.length && `${enc.allergies.length} ${enc.allergies.length === 1 ? "allergy" : "allergies"}`,
    enc.notes.length && `${enc.notes.length} ${enc.notes.length === 1 ? "note" : "notes"}`,
  ].filter(Boolean).join(", ");

  return (
    <Dialog
      open
      onClose={close}
      wide
      title="Move Visit"
      subtitle={dev ? "Sends A45 (ADT_A45). PID is the correct patient; MRG carries the wrong patient's identifiers; PV1 the visit. Audited." : "Use this when the visit was opened on the wrong patient. The visit and everything in it moves to the right file."}
      footer={
        review ? (
          <>
            <Button onClick={() => setReview(false)}>Back To Edit</Button>
            <ConfirmButton variant="danger" problems={problems} onClick={() => { onClose(); moveVisit(visit, toId, reason, note); }}>Move Visit</ConfirmButton>
          </>
        ) : (
          <>
            <Button onClick={close}>Go Back</Button>
            <ConfirmButton problems={problems} onClick={() => setReview(true)}>Review Move</ConfirmButton>
          </>
        )
      }
    >
      <DialogScroll>
      <div className="mb-4 rounded-lg border border-border px-3 py-2.5 text-sm" role="group" aria-label="Visit">
        <div className="text-xs font-semibold text-muted-foreground">Visit</div>
        <div className="mt-0.5 font-medium">
          {enc.visitNumber}, {CLS_LABEL[enc.cls] ?? enc.cls}, {STATUS_LABEL[enc.status] ?? enc.status}
        </div>
        <div className="text-xs text-muted-foreground">
          {serviceLabel(enc.service)}, {doctorName(enc.attending)}, started {niceDate(enc.admitAt ?? enc.expectedAdmitAt)}{enc.bedId ? `, bed ${bedLabel(enc.bedId)}` : ""}
        </div>
      </div>

      {!review && (
        <>
          <RequiredNote className="mb-2" />
          <Group label="Find The Correct Patient" required hint="Search by name, MRN, national ID or mobile number.">
            <div className="relative [--field-h:2.5rem]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="For example Alharbi or MRN0000105" aria-label="Search patients" aria-controls={listId} />
            </div>
            {words.length > 0 && (
              <ul id={listId} className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-border" aria-label="Matching patients">
                {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No patient matches. Try other words.</li>}
                {hits.map((p) => {
                  const hidden = !!p.confidential && !hasGlass(p.id);
                  const on = p.id === toId;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => { setToId(p.id); setQuery(""); }}
                        className={cn("flex w-full flex-wrap items-baseline justify-between gap-x-3 border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", on && "bg-admit/10")}
                      >
                        <span className="font-medium">{hidden ? "Confidential patient" : patientName(p)}</span>
                        <span className="text-xs text-muted-foreground">{p.mrn} · {ageOf(p.dob)} years · {p.sex === "M" ? "Male" : "Female"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Group>
        </>
      )}

      <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
        <PatientCard patient={from} title="Wrong Patient (Now)" tone="from" />
        <div className="flex items-center justify-center text-muted-foreground" aria-hidden="true">
          <ArrowRight className="size-5 rotate-90 sm:rotate-0" />
        </div>
        <PatientCard patient={to} title="Correct Patient" tone="to" />
      </div>
      {toId && !review && (
        <div className="mt-1.5 text-right">
          <Button size="sm" variant="ghost" onClick={() => setToId("")}>Choose Another Patient</Button>
        </div>
      )}

      {!review ? (
        <div className="mt-4">
          <ReasonFields reasons={MOVE_REASONS} reason={reason} setReason={setReason} note={note} setNote={setNote} label="Reason For The Move" />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2.5 text-sm" role="alert">
          <div className="flex items-center gap-1.5 font-semibold text-destructive"><TriangleAlert className="size-4" aria-hidden="true" /> Check before you move</div>
          <p className="mt-1">
            Visit {enc.visitNumber} and its chart{counts ? ` (${counts})` : ""} move from {patientName(from)} ({from?.mrn}) to {patientName(to)} ({to?.mrn}).
          </p>
          <p className="mt-1">Lab, imaging and pharmacy orders already sent keep the patient they were sent for. Check them in those worklists.</p>
          <p className="mt-1">Reason: {reason}{note.trim() ? `: ${note.trim()}` : ""}</p>
        </div>
      )}

      {problems.length === 0 ? (
        <WhatWillHappen
          items={[
            `The visit moves to ${patientName(to)} (${to?.mrn}). It no longer shows on ${patientName(from)}'s file.`,
            enc.reservedBedId && enc.status === "preadmit" && `The reserved bed ${bedLabel(enc.reservedBedId)} stays with the visit.`,
            NPHIES_NOTE.A45,
            "Your name, both files and the reason are written to the audit log.",
            "There is no undo. If this is wrong, move the visit back the same way.",
          ]}
        />
      ) : (
        <StillNeeded items={problems} />
      )}
      </DialogScroll>
      {guardDialog}
    </Dialog>
  );
}
