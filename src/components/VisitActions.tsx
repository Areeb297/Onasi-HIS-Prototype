import * as React from "react";
import { BedDouble, Check, Clock, ShieldAlert, ShieldCheck, TriangleAlert, UserPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Hl7Tag, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import {
  checkIn, dischargePatient, quickCreate, quickSend, recordLeftWard, sendWithReason, setBedOutOfService, setClearance,
} from "@/lib/actions";
import { OUT_OF_SERVICE_REASONS, availableBeds, bedInfos, bedProblem, bedStateLabel, heldBedOf, reservedBedFor, unavailableLabel, type BedInfo } from "@/lib/beds";
import { useDevMode } from "@/lib/devmode";
import {
  CANCEL_REASONS, OUTCOMES, OVERRIDE_MIN, TRANSFER_REASONS, TRANSPORT_MODES, canGiveClearance, clearanceLabel, clearanceList, departureGap,
  emptyDeath, emptyTransfer, gapText, missingClearances, needsClearances, niceDate, outcomeDef, outcomeProblems, overrideOk, reasonProblem,
} from "@/lib/discharge";
import type { DischargeOutcome, Dx, Encounter, Patient } from "@/lib/model";
import { ADMISSION_METHODS, BED_BY_ID, COMPLAINT_SAMPLES, DOCTORS, DX_SAMPLES, SERVICES, WARDS, defaultAdmissionMethod } from "@/lib/reference-data";
import type { EventId } from "@/lib/spec";
import { navigate } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { bedLabel, getState, nowLocal, patientName, useHis } from "@/lib/store";

type BedDlg = { kind: "bed"; event: "A01" | "A02" | "A06"; visit?: string; patientId?: string };
type DischargeDlg = { kind: "discharge"; visit: string };
type RegisterDlg = { kind: "register"; type: "A04" | "A01" | "A05"; patientId?: string; bedId?: string };
type ReasonDlg = { kind: "reason"; event: "A11" | "A38" | "A12" | "A07"; visit: string };
type ClearanceDlg = { kind: "clearances"; visit: string };
type LeftDlg = { kind: "left"; visit: string };
type BedServiceDlg = { kind: "bed-service"; bedId: string };
type Dlg = BedDlg | DischargeDlg | RegisterDlg | ReasonDlg | ClearanceDlg | LeftDlg | BedServiceDlg;

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
    if (eventId === "A02" || eventId === "A06") return setDlg({ kind: "bed", event: eventId, visit });
    if (eventId === "A01") return setDlg({ kind: "bed", event: "A01", visit, patientId: enc.patientId });
    if (eventId === "A03") return setDlg({ kind: "discharge", visit });
    if (eventId === "A11" || eventId === "A38" || eventId === "A12" || eventId === "A07") return setDlg({ kind: "reason", event: eventId, visit });
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
      {dlg?.kind === "discharge" && <DischargeDialog dlg={dlg} onClose={close} />}
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
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-foreground">
        <span>
          {label}
          {required && (
            <>
              <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </span>
        {hl7 && <Hl7Tag>{hl7}</Hl7Tag>}
      </span>
      {children}
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

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
    <div className="mt-4 rounded-lg border border-move/40 bg-move/8 px-3 py-2.5" role="note" aria-label="What will happen">
      <div className="text-sm font-semibold">What will happen</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {list.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

/** Problems that stop the confirm button, listed so the user knows what is missing. */
function StillNeeded({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm" role="status">
      <div className="flex items-center gap-1.5 font-semibold text-warn"><TriangleAlert className="size-4" aria-hidden="true" /> Still needed</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

function ReasonFields({ reasons, reason, setReason, note, setNote }: { reasons: string[]; reason: string; setReason: (v: string) => void; note: string; setNote: (v: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Reason" required>
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
          <option value="">Choose a reason</option>
          {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
      <Field label="More Detail" required={reason === "Other"} hint={reason === "Other" ? "Say what the reason is." : "Optional."}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a few words" />
      </Field>
    </div>
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
};

/* ---------- Bed picker: admit to a bed, transfer ---------- */

const WARD_TEXT: Record<string, string> = { "3A": "text-move", "4B": "text-update", ICU: "text-cancel" };

/** Every bed by ward. Free beds can be picked. The others say why they cannot. */
function BedGrid({ infos, who, value, onPick }: { infos: BedInfo[]; who: { visit?: string; patientId?: string }; value: string; onPick: (bedId: string) => void }) {
  const state = useHis();
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Bed">
      {WARDS.map((w) => (
        <div key={w.ward}>
          <div className={cn("mb-1.5 text-xs font-semibold", WARD_TEXT[w.ward])}>{w.name}</div>
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
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
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

function BedDialog({ dlg, onClose }: { dlg: BedDlg; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = dlg.visit ? state.encounters.find((e) => e.visitNumber === dlg.visit) : undefined;
  const patientId = dlg.patientId ?? enc?.patientId ?? "";
  const patient = state.patients.find((p) => p.id === patientId);
  const who = { visit: dlg.visit, patientId };
  const reserved = dlg.event === "A01" ? reservedBedFor(state, patientId) : undefined;
  const [bedId, setBedId] = React.useState(reserved ?? "");
  const titles = { A02: "Transfer Patient", A06: "Admit To Inpatient", A01: "Admit Patient" } as const;
  const title = titles[dlg.event];
  const from = enc?.bedId;
  const ok = !!bedId && bedId !== from && !bedProblem(state, bedId, who);
  const name = patientName(patient);

  function confirm() {
    onClose();
    if (dlg.event === "A01") {
      quickCreate("A01", { patientId, attending: enc?.attending ?? DOCTORS[0].id, service: enc?.service ?? "MED", reason: enc?.reason ?? "", bedId });
    } else {
      quickSend(dlg.event, dlg.visit!, (f) => { f.bedId = bedId; });
    }
  }

  const effects =
    dlg.event === "A02"
      ? [`${name} moves from ${bedLabel(from)} to ${bedLabel(bedId)}.`, from && `Bed ${bedLabel(from)} becomes free.`, `Bed ${bedLabel(bedId)} becomes occupied.`]
      : dlg.event === "A06"
        ? ["The visit changes to an inpatient stay.", `Bed ${bedLabel(bedId)} becomes occupied.`]
        : ["The planned admission becomes an inpatient stay.", `Bed ${bedLabel(bedId)} becomes occupied.`, reserved && reserved !== bedId && `The reserved bed ${bedLabel(reserved)} becomes free.`];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={title}
      subtitle={dev ? `Sends ${dlg.event}. Only a free bed, or the bed reserved for this patient, can be picked.` : "Pick a bed, check what will happen, then confirm."}
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <Button variant="primary" disabled={!ok} onClick={confirm}>{title}</Button>
        </>
      }
    >
      <PatientStrip patient={patient} enc={enc} />
      {enc && <NowStrip enc={enc} />}
      <Group label={dlg.event === "A02" ? "New Bed" : "Bed"} hl7="PV1-3" required>
        <BedGrid infos={bedInfos(state)} who={who} value={bedId} onPick={setBedId} />
      </Group>
      {bedId ? (
        <WhatWillHappen items={[...effects, NPHIES_NOTE[dlg.event], "You can undo this from the message that appears."]} />
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Pick a bed to see what will happen.</p>
      )}
    </Dialog>
  );
}

/* ---------- Cancel visit, cancel pre-admission, cancel transfer, change to outpatient ---------- */

function ReasonDialog({ dlg, onClose }: { dlg: ReasonDlg; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === dlg.visit);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const inpatient = enc.cls === "I";
  const title = { A11: inpatient ? "Cancel Admission" : "Cancel Visit", A38: "Cancel Pre-Admission", A12: "Cancel Transfer", A07: "Change To Outpatient" }[dlg.event];
  const back = enc.transfers[enc.transfers.length - 1];
  // Going back needs the earlier bed to still be free.
  const backProblem = dlg.event === "A12" ? (back ? bedProblem(state, back, { visit: enc.visitNumber }) : "There is no earlier bed to go back to.") : null;
  const problems = [reasonProblem(reason, note), backProblem && `${backProblem} Use Transfer to pick another bed.`].filter((x): x is string => !!x);

  const effects: (string | false | undefined)[] =
    dlg.event === "A11"
      ? [inpatient ? "The admission is cancelled and the visit closes." : "The visit is cancelled and closes.", enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`]
      : dlg.event === "A38"
        ? ["The planned admission is cancelled.", enc.reservedBedId && `The reserved bed ${bedLabel(enc.reservedBedId)} becomes free.`]
        : dlg.event === "A12"
          ? [`${patientName(patient)} goes back to bed ${bedLabel(back)}.`, enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`]
          : ["The stay changes from inpatient to outpatient. The visit stays open.", enc.bedId && `Bed ${bedLabel(enc.bedId)} becomes free.`];

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={title}
      subtitle={dev ? `Sends ${dlg.event}. The reason stays in the HIS and the audit log.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <Button
            variant={dlg.event === "A07" ? "primary" : "danger"}
            disabled={problems.length > 0}
            onClick={() => {
              onClose();
              sendWithReason(dlg.event, dlg.visit, reason, note);
            }}
          >
            {title}
          </Button>
        </>
      }
    >
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={enc.status === "preadmit" ? [["Expected Admit Date", niceDate(enc.expectedAdmitAt)], ["Reserved Bed", enc.reservedBedId ? bedLabel(enc.reservedBedId) : "None"]] : undefined} />
      <RequiredNote className="mb-2" />
      <ReasonFields reasons={CANCEL_REASONS[dlg.event]} reason={reason} setReason={setReason} note={note} setNote={setNote} />
      <WhatWillHappen items={[...effects, NPHIES_NOTE[dlg.event], "The reason is saved in the audit log."]} />
      <StillNeeded items={problems} />
    </Dialog>
  );
}

/* ---------- Discharge ---------- */

const ED_OUTCOME: Partial<Record<string, DischargeOutcome>> = { Transferred: "transfer", "Left Against Advice": "ama", Died: "died", "Dead On Arrival": "died" };

function DischargeDialog({ dlg, onClose }: { dlg: DischargeDlg; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const enc = state.encounters.find((e) => e.visitNumber === dlg.visit);
  const [outcome, setOutcome] = React.useState<DischargeOutcome | "">(() => (enc?.ed?.disposition ? ED_OUTCOME[enc.ed.disposition] ?? "home" : ""));
  const [picked, setPicked] = React.useState<Dx[]>([]);
  const [transfer, setTransfer] = React.useState(emptyTransfer);
  const [death, setDeath] = React.useState(() => ({ ...emptyDeath(), at: nowLocal(), certifiedBy: enc?.attending ?? "" }));
  const [override, setOverride] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  if (!enc) return null;
  const patient = state.patients.find((p) => p.id === enc.patientId);
  const coded = enc.dx.filter((d) => d.code);
  const toggle = (d: Dx) => setPicked((p) => (p.some((x) => x.code === d.code) ? p.filter((x) => x.code !== d.code) : [...p, d]));
  const clearances = needsClearances(enc);
  const missing = missingClearances(enc);
  const bedId = enc.cls === "I" ? enc.bedId : undefined;

  const problems: string[] = [];
  if (!outcome) problems.push("Choose the outcome.");
  else problems.push(...outcomeProblems({ outcome, transfer, death }, { admitAt: enc.admitAt, now: nowLocal() }));
  if (coded.length === 0 && picked.length === 0) problems.push("Choose a final diagnosis.");
  if (missing.length && !override) problems.push(`Waiting for these clearances: ${missing.map(clearanceLabel).join(", ")}.`);
  if (missing.length && override && !overrideOk(overrideReason)) problems.push(`Type the reason for the override (at least ${OVERRIDE_MIN} characters).`);

  function confirm() {
    if (!outcome) return;
    onClose();
    dischargePatient(dlg.visit, { outcome, dx: picked, transfer, death, overrideReason: missing.length && override ? overrideReason : undefined });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Discharge Patient"
      subtitle={dev ? "Sends A03. The outcome sets PV1-36. A03 needs at least one diagnosis (DG1)." : "Choose the outcome first, then check what will happen."}
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <Button variant="primary" disabled={problems.length > 0} onClick={confirm}>Discharge Patient</Button>
        </>
      }
    >
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} />
      <RequiredNote className="mb-2" />
      <div className="space-y-4">
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
                  className={cn("rounded-lg border px-3 py-2 text-left transition-colors", on ? "border-admit bg-admit/12" : "border-border hover:bg-muted")}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {on && <Check className="size-4 text-admit" aria-hidden="true" />}
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
          <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
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
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4 accent-primary" checked={transfer.consent} onChange={(e) => setTransfer({ ...transfer, consent: e.target.checked })} />
              <span>The patient or family agreed to the transfer<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span><span className="sr-only"> (required)</span></span>
            </label>
            {dev && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Developer note: the transfer request is recorded in the HIS and not sent. There is no Ihalati integration.
              </p>
            )}
          </div>
        )}

        {outcome === "died" && (
          <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <Field label="Date And Time Of Death" required>
              <Input type="datetime-local" value={death.at} max={nowLocal()} onChange={(e) => setDeath({ ...death, at: e.target.value })} />
            </Field>
            <Field label="Certifying Doctor" required>
              <Select value={death.certifiedBy} onChange={(e) => setDeath({ ...death, certifiedBy: e.target.value })}>
                <option value="">Choose a doctor</option>
                {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
              </Select>
            </Field>
            <Field label="Cause Of Death" required className="sm:col-span-2">
              <Input value={death.cause} onChange={(e) => setDeath({ ...death, cause: e.target.value })} placeholder="Cause as written by the certifying doctor" />
            </Field>
          </div>
        )}

        {coded.length > 0 ? (
          <div>
            <div className="text-sm font-medium">Final Diagnosis</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {coded.map((d) => <Badge key={d.code} tone="neutral"><span className="font-mono">{d.code}</span> {d.text}</Badge>)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Taken from the chart. Change it in the chart before discharge if it is wrong.</p>
          </div>
        ) : (
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
                    className={cn("rounded-lg border px-3 py-1.5 text-left text-xs transition-colors", on ? "border-admit bg-admit/12 text-admit" : "border-border hover:bg-muted")}
                  >
                    <span className="font-mono font-semibold">{d.code}</span> {d.text}
                  </button>
                );
              })}
            </div>
          </Group>
        )}

        {clearances && (
          <div>
            <div className="text-sm font-medium">Discharge Clearances</div>
            <div className="mt-1.5"><ClearanceChips enc={enc} /></div>
            {missing.length > 0 && (
              <div className="mt-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2.5 text-sm">
                <div className="flex items-center gap-1.5 font-semibold text-warn"><TriangleAlert className="size-4" aria-hidden="true" /> Discharge is blocked</div>
                <p className="mt-1">Still waiting for:</p>
                <ul className="list-disc pl-5">
                  {clearanceList(enc).filter((c) => !c.done).map((c) => <li key={c.key}>{c.label} clearance, given by the {c.who.toLowerCase()}</li>)}
                </ul>
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" className="size-4 accent-primary" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                  <span>Discharge without these clearances</span>
                </label>
                {override && (
                  <Field label="Reason For Override" required className="mt-2" hint="Your name, the missing clearances and this reason are written to the audit log.">
                    <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why the patient must be discharged now" />
                  </Field>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {outcome && (
        <WhatWillHappen
          items={[
            `The visit closes with the outcome: ${outcomeDef(outcome).label}.`,
            bedId && `Bed ${bedLabel(bedId)} is not free yet. It stays held until the nurse records that the patient left the ward, then it goes to cleaning.`,
            outcome === "transfer" && "The transfer details are saved in the patient record.",
            outcome === "died" && "The death details are saved in the patient record.",
            missing.length > 0 && override && "The override and your reason are written to the audit log.",
            NPHIES_NOTE.A03,
            "You can undo this from the message that appears.",
          ]}
        />
      )}
      <StillNeeded items={problems} />
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
                <Button size="sm" variant={c.done ? "secondary" : "primary"} disabled={!allowed} onClick={() => setClearance(enc.visitNumber, c.key, !c.done)}>
                  {c.done ? `Withdraw ${c.label} Clearance` : `Give ${c.label} Clearance`}
                </Button>
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
          <Button
            variant="primary"
            disabled={!!problem}
            onClick={() => {
              onClose();
              recordLeftWard(dlg.visit, at);
            }}
          >
            Record Patient Left
          </Button>
        </>
      }
    >
      <PatientStrip patient={patient} enc={enc} />
      <NowStrip enc={enc} extra={[["Discharged", niceDate(ordered)], ["Outcome", enc.discharge ? outcomeDef(enc.discharge.outcome).label : "None"]]} />
      <Field label="Time The Patient Left" required>
        <Input type="datetime-local" value={at} min={ordered} max={nowLocal()} onChange={(e) => setAt(e.target.value)} />
      </Field>
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
          <Button
            variant="danger"
            disabled={!!problem}
            onClick={() => {
              onClose();
              setBedOutOfService(dlg.bedId, reason, note);
            }}
          >
            Take Out Of Service
          </Button>
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

  const patient = state.patients.find((p) => p.id === patientId);
  const pre = dlg.type === "A01" ? state.encounters.find((e) => e.patientId === patientId && e.status === "preadmit") : undefined;
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
  const ready = !!patientId && (!needBed || !!bedId) && (!(needBed || holdBed) || bedOk) && (dlg.type !== "A05" || !!expected);

  function pickPatient(id: string) {
    setPatientId(id);
    // The bed held for this patient's planned admission is offered first.
    const held = dlg.type === "A01" ? reservedBedFor(state, id) : undefined;
    if (held && !dlg.bedId) setBedId(held);
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

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={titles[dlg.type]}
      subtitle={dev ? subs[dlg.type] : undefined}
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {titles[dlg.type]}
          </Button>
        </>
      }
    >
      <PatientStrip patient={patient} />
      {pre && <NowStrip enc={pre} extra={[["Expected Admit Date", niceDate(pre.expectedAdmitAt)], ["Reserved Bed", pre.reservedBedId ? bedLabel(pre.reservedBedId) : "None"]]} />}
      <RequiredNote className="mb-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient" hl7="PID-3" required className="sm:col-span-2">
          <div className="flex gap-2">
            <Select value={patientId} onChange={(e) => pickPatient(e.target.value)} aria-label="Patient">
              <option value="">Select a patient</option>
              {state.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} ({p.mrn})
                </option>
              ))}
            </Select>
            <Button onClick={onNewPatient} title="Register a new patient">
              <UserPlus className="size-4" />
              New Patient
            </Button>
          </div>
        </Field>
        <Field label="Doctor" hl7="PV1-7" required>
          <Select value={attending} onChange={(e) => setAttending(e.target.value)}>
            {DOCTORS.map((d) => (
              <option key={d.id} value={d.id}>
                Dr. {d.given} {d.family}
              </option>
            ))}
          </Select>
        </Field>
        {dlg.type === "A04" && (
          <Field label="Department" hl7="PV1-10" required>
            <Select value={service} onChange={(e) => setService(e.target.value)}>
              {SERVICES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {dlg.type !== "A04" && (
          <Field label="Patient Class" hl7="PV1-2" required>
            <Select value={admitClass} onChange={(e) => setAdmitClass(e.target.value as "I" | "O")} aria-label="Patient class">
              <option value="I">Inpatient</option>
              <option value="O">Outpatient</option>
            </Select>
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
          <Field label="Expected Admit Date" hl7="PV2-8" required>
            <Input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        )}
        <Field label="Reason for Visit" hl7="PV2-12" className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type a reason, or tap one below" />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COMPLAINT_SAMPLES.map((c) => (
              <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent">
                {c.text}
              </button>
            ))}
          </div>
        </Field>
      </div>
      {patientId && <WhatWillHappen items={[...effects, NPHIES_NOTE[dlg.type], "You can undo this from the message that appears."]} />}
      <StillNeeded items={[!patientId && "Choose the patient.", needBed && !bedId && "Choose a bed.", !bedOk && "The chosen bed is not available. Choose another bed."].filter((x): x is string => !!x)} />
    </Dialog>
  );
}
