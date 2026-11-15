import * as React from "react";
import { CheckCircle2, Circle, CircleDot, FileText, Lock, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { allergyText } from "@/lib/flowsheet";
import type { Encounter } from "@/lib/model";
import { navigate, useRoute } from "@/lib/router";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import {
  ANAESTHETISTS, POSTOP_DIAGNOSES, RECOVERY_DESTINATIONS, RECOVERY_NURSES, SURGEONS, THEATRE_NURSES, THEATRE_STAFF, WARD_NURSES,
  allCases, casesForVisit, closeCase, confirmPhase, confirmSchedule, isDoctor, postponeSchedule, requestSurgery, saveAssessment, saveOpNote, savePhaseDraft,
  savePreOp, saveRecovery, saveSchedule, useTheatre, type Result,
} from "@/lib/theatre";
import {
  ALDRETE_ITEMS, ALDRETE_MAX, ALDRETE_PASS, ANAESTHESIA_TYPES, ASA_CLASSES, ASSESSMENT_RESULTS, DISPOSITIONS, OPERATION_CATEGORIES, PAIN_TOOLS, PREOP_ITEMS,
  PREOP_REVIEWS, PREOP_SECTIONS, RECOVERY_CHECKS, SAFETY_PHASES, SAFETY_SIGNERS, SIDES, STEPS, TEAM_ROLES, THEATRE_ROOMS, URGENCIES,
  aldreteMaxOf, aldreteTotal, caseStage, closeGate, confirmGate, currentStep, fitForSurgery, latestAldrete, nextAction, phaseUnanswered, postponeGate,
  preOpMissing, preOpNaAllowed, preOpProblems, readyForOperativeNote, recoveryDischargeGate, scheduleEnd, scheduleStatus, stepDone, stepGate,
  timingGate, validateAssessment, validateClosure, validateOpNote, validatePhase, validateRecovery, validateRequest, validateSchedule, validateScheduleDraft,
  type AldreteScores, type AssessmentResult, type CaseStage, type CloseOutcome, type CodedDx, type Gate, type OpNoteData, type PhaseId, type PreOpAnswer,
  type PreOpData, type RecoveryData, type SafetyAnswer, type SafetySigners, type ScheduleStatus, type Signer, type Stamp, type StepId, type SurgeryCase,
  type TeamMember,
} from "@/lib/theatre-logic";
import { pushToast } from "@/lib/toast";

/* ---------- small shared pieces ---------- */

export const STAGE_TONE: Record<CaseStage, "neutral" | "ok" | "warn" | "danger" | "info" | "admit" | "update"> = {
  "Waiting For Assessment": "warn", "Not Cleared": "danger", "To Schedule": "info", Postponed: "warn", Scheduled: "info", "In Theatre": "admit",
  "Note Needed": "warn", "In Recovery": "update", "Ready To Close": "ok", Closed: "neutral",
};

export const SCHEDULE_TONE: Record<ScheduleStatus, "neutral" | "ok" | "warn" | "danger" | "info" | "admit"> = {
  Draft: "neutral", Scheduled: "info", Confirmed: "ok", "In Progress": "admit", Completed: "ok", Postponed: "warn", Cancelled: "danger",
};

const whenIso = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const whenLocal = (local: string) => (local ? whenIso(local) : "");
const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nowClock = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const num = (s: string): number | undefined => (s === "" ? undefined : Number(s));
const showAnswer = (a: SafetyAnswer | PreOpAnswer) => (a === "N/A" || a === "na" ? "Not Applicable" : a === "yes" ? "Yes" : a === "no" ? "No" : a);

const textareaClass =
  "min-h-20 rounded-lg border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/80 " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring md:text-sm dark:bg-background";
const chip = (on: boolean) =>
  cn(
    "min-h-9 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "border-admit bg-admit/14 font-semibold text-admit ring-1 ring-admit" : "border-input bg-card text-foreground hover:bg-muted dark:bg-background",
  );
const pick = (list: readonly string[], placeholder = "Select") => <><option value="">{placeholder}</option>{list.map((x) => <option key={x}>{x}</option>)}</>;

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={chip(value === o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A labelled question that is not a single input, so it is not wrapped in a label element. */
function Ask({ label, required, hint, className, children }: { label: string; required?: boolean; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} role="group" aria-label={label}>
      <span className="text-sm font-medium leading-5">
        {label}
        {required && <><span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span><span className="sr-only"> (required)</span></>}
      </span>
      {children}
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

function YesNo({ label, value, onChange, required, hint, className }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void; required?: boolean; hint?: string; className?: string }) {
  const v = value === undefined ? undefined : value ? "yes" : "no";
  return (
    <Ask label={label} required={required} hint={hint} className={className}>
      <Choice label={label} value={v} onChange={(x) => onChange(x === "yes")} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
    </Ask>
  );
}

/** A heading that groups the fields of a long step. */
function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Area({ value, onChange, rows = 2, placeholder, disabled }: { value: string | undefined; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean }) {
  return <Textarea rows={rows} className={textareaClass} value={value ?? ""} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
}

/** One person who signs: choose the name, then mark it signed. A signature that is already saved cannot be changed. */
function SignerRow({ label, people, value, onChange, required }: { label: string; people: readonly string[]; value: Signer | undefined; onChange: (s: Signer | undefined) => void; required?: boolean }) {
  const locked = !!value?.signed && !!value.at;
  const list = value?.name && !people.includes(value.name) ? [value.name, ...people] : people;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {label}
          {required && <><span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span><span className="sr-only"> (required)</span></>}
        </span>
        {locked ? (
          <Badge tone="ok">Signed</Badge>
        ) : (
          <Button size="sm" variant={value?.signed ? "primary" : "secondary"} disabled={!value?.name} aria-pressed={!!value?.signed}
            onClick={() => onChange(value?.name ? { name: value.name, signed: !value.signed } : undefined)}>
            {value?.signed ? "Signed, Click To Undo" : "Mark Signed"}
          </Button>
        )}
      </div>
      <Select aria-label={`${label} name`} value={value?.name ?? ""} disabled={locked} onChange={(e) => onChange(e.target.value ? { name: e.target.value } : undefined)}>{pick(list)}</Select>
      {locked && value?.at && <p className="mt-1 text-xs text-muted-foreground">Signed {whenIso(value.at)}{value.by ? `, recorded by ${value.by}` : ""}</p>}
    </div>
  );
}

/** A button that is always there. When the step cannot start it is disabled and the reason is written under it. */
function GateButton({ gate, onClick, children, primary }: { gate: Gate; onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1 md:items-end">
      <Button size="sm" variant={primary && gate.ok ? "primary" : "secondary"} disabled={!gate.ok} onClick={onClick}>
        {!gate.ok && <Lock className="size-3.5" aria-hidden="true" />}
        {children}
      </Button>
      {!gate.ok && <p className="max-w-[19rem] text-xs leading-snug text-muted-foreground md:text-right">{gate.reason}</p>}
    </div>
  );
}

function Signed({ stamp, verb = "Done" }: { stamp: Stamp; verb?: string }) {
  return <p className="text-xs text-muted-foreground">{verb} by {stamp.by} ({stamp.role}) on {whenIso(stamp.at)}</p>;
}

/** Footer of a single-save step dialog: what is still missing, then Cancel and the save button. */
function StepFooter({ problem, onCancel, onSave, saveLabel }: { problem: string | null; onCancel: () => void; onSave: () => void; saveLabel: string }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <p className={cn("min-w-0 flex-1 text-xs", problem ? "text-foreground" : "text-muted-foreground")} role="status">{problem ? `Cannot save yet: ${problem}` : "Your name and the time are recorded when you save."}</p>
      <span className="flex shrink-0 gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!!problem} onClick={onSave}>{saveLabel}</Button>
      </span>
    </div>
  );
}

/** Footer of a step that can be saved as a draft and completed later, as in the HIS. */
function DraftFooter({ problem, draftProblem, onCancel, onDraft, onComplete, completeLabel, draftLabel = "Save Draft" }: {
  problem: string | null; draftProblem?: string | null; onCancel: () => void; onDraft: () => void; onComplete: () => void; completeLabel: string; draftLabel?: string;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 flex-1 text-xs" role="status">
        {draftProblem ? `Cannot save yet: ${draftProblem}` : problem ? `Save a draft at any time. To complete: ${problem}` : "Ready to complete. Your name and the time are recorded."}
      </p>
      <span className="flex shrink-0 flex-wrap gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={!!draftProblem} onClick={onDraft}>{draftLabel}</Button>
        <Button variant="primary" disabled={!!problem || !!draftProblem} onClick={onComplete}>{completeLabel}</Button>
      </span>
    </div>
  );
}

function CaseFacts({ c, enc, patient }: { c: SurgeryCase; enc: Encounter; patient?: string }) {
  return (
    <dl className="mb-4 grid gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm sm:grid-cols-2">
      {patient && <div><dt className="inline font-medium">Patient: </dt><dd className="inline">{patient}</dd></div>}
      <div><dt className="inline font-medium">Operation: </dt><dd className="inline">{c.request.procedure}</dd></div>
      <div><dt className="inline font-medium">Side: </dt><dd className="inline">{c.request.side}</dd></div>
      {c.schedule && <div><dt className="inline font-medium">Slot: </dt><dd className="inline">{c.schedule.room}, {c.schedule.date} {c.schedule.start}</dd></div>}
      <div className="sm:col-span-2"><dt className="inline font-medium">Allergies in the chart: </dt><dd className="inline">{allergyText(enc.allergies)}</dd></div>
    </dl>
  );
}

type DialogProps = { c: SurgeryCase; enc: Encounter; patient: string; onClose: () => void; report: (r: Result) => void };

/* ---------- step dialogs ---------- */

function RequestDialog({ enc, onClose, report }: Omit<DialogProps, "c" | "patient">) {
  const [f, setF] = React.useState({ procedure: enc.pr[0]?.text ?? "", side: "", surgeon: "", urgency: "Elective", plannedDate: "", preopDiagnosis: enc.dx[0]?.text ?? "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const problem = validateRequest(f);
  return (
    <Dialog open wide onClose={onClose} title="Surgery Request" subtitle="Step 1. The surgeon asks for the operation."
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Save Request" onSave={() => report(requestSurgery(enc.visitNumber, enc.patientId, f))} />}>
      <RequiredNote className="mb-3" />
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="Procedure" required className="sm:col-span-2"><Input value={f.procedure} onChange={set("procedure")} placeholder="Laparoscopic cholecystectomy" /></Field>
        <Field label="Side" required hint="The site is marked before the operation when there is a side.">
          <Select value={f.side} onChange={set("side")}>{pick(SIDES)}</Select>
        </Field>
        <Field label="Surgeon" required><Select value={f.surgeon} onChange={set("surgeon")}>{pick(SURGEONS)}</Select></Field>
        <Field label="Urgency" required>
          <Select value={f.urgency} onChange={set("urgency")}>{URGENCIES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Planned Date" required><Input type="date" value={f.plannedDate} onChange={set("plannedDate")} /></Field>
        <Field label="Diagnosis Before The Operation" className="sm:col-span-2"><Input value={f.preopDiagnosis} onChange={set("preopDiagnosis")} /></Field>
        <Field label="Notes For The Theatre Team" className="sm:col-span-2"><Textarea rows={2} className={textareaClass} value={f.notes} onChange={set("notes")} placeholder="Implants, special equipment, blood to prepare" /></Field>
      </div>
    </Dialog>
  );
}

function AssessmentDialog({ c, enc, onClose, report }: DialogProps) {
  const [result, setResult] = React.useState<AssessmentResult | undefined>(undefined);
  const [asa, setAsa] = React.useState(c.assessment?.asa ?? "");
  const [anaesthesia, setAnaesthesia] = React.useState(c.assessment?.anaesthesia ?? "");
  const [notes, setNotes] = React.useState("");
  const data = { result, asa: asa || undefined, anaesthesia: anaesthesia || undefined, notes };
  const problem = validateAssessment(data);
  const needsNote = !!result && result !== "Fit";
  return (
    <Dialog open wide onClose={onClose} title="Pre-Anesthesia Assessment" subtitle={`Step 2. ${c.request.procedure}`}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Save Assessment" onSave={() => result && report(saveAssessment(c.id, { ...data, result }))} />}>
      <RequiredNote className="mb-3" />
      <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Allergies in the chart:</span> {allergyText(enc.allergies)}</p>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Ask label="Result" required className="sm:col-span-2" hint="Only Fit and Fit With High Risk let the case be scheduled.">
          <Choice label="Result" value={result} onChange={setResult} options={ASSESSMENT_RESULTS.map((r) => ({ value: r, label: r }))} />
        </Ask>
        <Field label="ASA Class" hint="American Society of Anesthesiologists physical status. I is healthy, V is not expected to survive without the operation.">
          <Select value={asa} onChange={(e) => setAsa(e.target.value)}>{pick(ASA_CLASSES)}</Select>
        </Field>
        <Field label="Planned Anaesthesia">
          <Select value={anaesthesia} onChange={(e) => setAnaesthesia(e.target.value)}>{pick(ANAESTHESIA_TYPES)}</Select>
        </Field>
        <Field label={result === "Needs More Tests" ? "Tests needed" : result === "Not Fit" ? "Why the patient is not fit" : result === "Fit With High Risk" ? "The high risk" : "Notes"} required={needsNote} className="sm:col-span-2">
          <Textarea rows={3} className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function ScheduleDialog({ c, onClose, report }: DialogProps) {
  const s = c.schedule;
  const [f, setF] = React.useState({
    room: s?.room ?? "", date: s?.date ?? c.request.plannedDate, start: s?.start ?? "", durationMin: s?.durationMin ?? 60,
    anaesthetist: s?.anaesthetist ?? "", scrubNurse: s?.scrubNurse ?? "", circulatingNurse: s?.circulatingNurse ?? "", assistant: s?.assistant ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: k === "durationMin" ? Number(e.target.value) : e.target.value }));
  const data = { ...f, assistant: f.assistant || undefined };
  const problem = validateSchedule(f, allCases(), c.id);
  const status = scheduleStatus(c);
  return (
    <Dialog open wide onClose={onClose} title="Schedule" subtitle={`Step 3. ${c.request.procedure}. Surgeon: ${c.request.surgeon}`}
      footer={<DraftFooter problem={problem} draftProblem={validateScheduleDraft(f)} onCancel={onClose} completeLabel="Schedule Case"
        onDraft={() => report(saveSchedule(c.id, data, "draft"))} onComplete={() => report(saveSchedule(c.id, data, "schedule"))} />}>
      <RequiredNote className="mb-3" />
      <p className="mb-4 text-sm text-muted-foreground">
        Draft, then Scheduled, then Confirmed by the theatre team before Sign In. A draft does not hold the room.
        {status === "Confirmed" && " This slot is confirmed. A change sends it back to Scheduled, to be confirmed again."}
        {status === "Postponed" && " This case was postponed. Choose a new slot."}
      </p>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="Room" required hint="Two cases cannot be in the same room at the same time."><Select value={f.room} onChange={set("room")}>{pick(THEATRE_ROOMS)}</Select></Field>
        <Field label="Date" required><Input type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Start Time" required><Input type="time" value={f.start} onChange={set("start")} /></Field>
        <Field label="Expected Length In Minutes" required><Input type="number" min={5} step={5} value={f.durationMin || ""} onChange={set("durationMin")} /></Field>
        <Field label="Anaesthetist" required><Select value={f.anaesthetist} onChange={set("anaesthetist")}>{pick(ANAESTHETISTS)}</Select></Field>
        <Field label="Assistant Surgeon"><Select value={f.assistant} onChange={set("assistant")}>{pick(SURGEONS.filter((x) => x !== c.request.surgeon))}</Select></Field>
        <Field label="Scrub Nurse" required><Select value={f.scrubNurse} onChange={set("scrubNurse")}>{pick(THEATRE_NURSES)}</Select></Field>
        <Field label="Circulating Nurse" required><Select value={f.circulatingNurse} onChange={set("circulatingNurse")}>{pick(THEATRE_NURSES)}</Select></Field>
      </div>
    </Dialog>
  );
}

function PostponeDialog({ c, onClose, report }: DialogProps) {
  const [reason, setReason] = React.useState("");
  const gate = postponeGate(c, reason);
  return (
    <Dialog open onClose={onClose} title="Postpone Schedule" subtitle={c.schedule ? `${c.schedule.room}, ${c.schedule.date} ${c.schedule.start} to ${scheduleEnd(c.schedule)}` : undefined}
      footer={<StepFooter problem={gate.ok ? null : gate.reason} onCancel={onClose} saveLabel="Postpone" onSave={() => report(postponeSchedule(c.id, reason))} />}>
      <RequiredNote className="mb-3" />
      <p className="mb-3 text-sm">The room is freed. The case waits until it is scheduled again. To stop the operation for good, use Cancel Or Close Case instead.</p>
      <Field label="Reason For Postponing" required>
        <Textarea rows={3} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Surgeon called to an emergency" />
      </Field>
    </Dialog>
  );
}

/** Drop the stamps a saved record carries, to start a form from it. */
function formOf<T extends object>(x: (T & { done?: Stamp; saved?: Stamp }) | undefined): Partial<T> {
  if (!x) return {};
  const copy = { ...x } as T & { done?: Stamp; saved?: Stamp };
  delete copy.done;
  delete copy.saved;
  return copy;
}

function PreOpDialog({ c, enc, patient, onClose, report }: DialogProps) {
  const [d, setD] = React.useState<PreOpData>(() => ({
    answers: {}, checklistDate: today(),
    theatreNurse: c.schedule?.circulatingNurse ? { name: c.schedule.circulatingNurse } : undefined,
    ...formOf<PreOpData>(c.preop),
  }));
  const side = c.request.side;
  const problems = preOpProblems(d, side);
  const left = preOpMissing(d.answers, side, d.remarks);
  const set = <K extends keyof PreOpData>(k: K, v: PreOpData[K]) => setD((x) => ({ ...x, [k]: v }));
  const setIn = (k: "remarks" | "texts", key: string, v: string) => setD((x) => ({ ...x, [k]: { ...x[k], [key]: v } }));
  const answer = (key: string, a: PreOpAnswer) => setD((x) => {
    const n = { ...x.answers };
    if (n[key] === a) delete n[key];
    else n[key] = a;
    return { ...x, answers: n };
  });
  const problem = problems.length ? `${problems[0]}${problems.length > 1 ? ` (${problems.length - 1} more)` : ""}` : null;
  return (
    <Dialog open wide onClose={onClose} title="Pre-operative Checklist" subtitle={`Step 4. ${left.length} of ${PREOP_ITEMS.length} items still open. Sign In stays locked until the checklist is completed.`}
      footer={<DraftFooter problem={problem} onCancel={onClose} completeLabel="Complete Checklist" onDraft={() => report(savePreOp(c.id, d, "draft"))} onComplete={() => report(savePreOp(c.id, d, "complete"))} />}>
      <CaseFacts c={c} enc={enc} patient={patient} />
      <RequiredNote className="mb-4" />
      <div className="space-y-5">
        <Group title="Clinical Review" hint="Tick each one after reading it in the chart.">
          <div className="grid gap-2 sm:grid-cols-2">
            {PREOP_REVIEWS.map((r) => (
              <label key={r.key} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/60">
                <input type="checkbox" className="size-4 shrink-0 accent-[var(--primary)]" checked={!!d.reviewed?.[r.key]} onChange={(e) => set("reviewed", { ...d.reviewed, [r.key]: e.target.checked })} />
                {r.label}<span aria-hidden="true" className="font-semibold text-destructive">*</span>
              </label>
            ))}
          </div>
        </Group>

        <Group title="Checklist Information">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Checklist Date" required><Input type="date" value={d.checklistDate ?? ""} onChange={(e) => set("checklistDate", e.target.value)} /></Field>
            <Field label="Urine Voided Time"><Input type="time" value={d.urineVoidedTime ?? ""} onChange={(e) => set("urineVoidedTime", e.target.value)} /></Field>
            <Field label="Urine Voided Amount"><Input value={d.urineVoidedAmount ?? ""} onChange={(e) => set("urineVoidedAmount", e.target.value)} placeholder="200 mL" /></Field>
            <Field label="Enema Time"><Input type="time" value={d.enemaTime ?? ""} onChange={(e) => set("enemaTime", e.target.value)} /></Field>
            <Field label="Isolation Precaution" className="sm:col-span-2"><Input value={d.isolationPrecaution ?? ""} onChange={(e) => set("isolationPrecaution", e.target.value)} placeholder="None, or contact precautions for MRSA" /></Field>
            <Field label="Catheter Or Drain Details" className="sm:col-span-2"><Input value={d.catheterOrDrain ?? ""} onChange={(e) => set("catheterOrDrain", e.target.value)} placeholder="Urinary catheter size 14, inserted on the ward" /></Field>
          </div>
        </Group>

        {PREOP_SECTIONS.map((section) => (
          <Group key={section} title={section} hint={section === "Identity And Consent" ? "Answer each item Yes, No or N/A. A No needs a remark. Items marked always needed must be Yes." : undefined}>
            <ul className="divide-y divide-border">
              {PREOP_ITEMS.filter((i) => i.section === section).map((i) => {
                const na = preOpNaAllowed(i, side);
                const a = d.answers[i.key];
                return (
                  <li key={i.key} className="space-y-2 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 text-sm">
                        {i.label}<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
                        {!na && <span className="ms-1.5 text-xs text-muted-foreground">(always needed)</span>}
                      </span>
                      <span className="flex shrink-0 gap-1.5" role="group" aria-label={i.label}>
                        {(["yes", "no", ...(na ? ["na" as const] : [])] as PreOpAnswer[]).map((o) => (
                          <button key={o} type="button" aria-pressed={a === o} onClick={() => answer(i.key, o)} className={chip(a === o)}>{o === "na" ? "N/A" : showAnswer(o)}</button>
                        ))}
                      </span>
                    </div>
                    {a === "no" && !na && <p className="text-xs font-medium text-destructive">This must be Yes before the operation can start.</p>}
                    <div className={cn("grid gap-2", i.textLabel && "sm:grid-cols-2")}>
                      {i.textLabel && <Input aria-label={i.textLabel} placeholder={i.textLabel} value={d.texts?.[i.key] ?? ""} onChange={(e) => setIn("texts", i.key, e.target.value)} />}
                      <Input aria-label={`Remark: ${i.label}`} placeholder={a === "no" ? "Remark (required for No)" : "Remark"} value={d.remarks?.[i.key] ?? ""} onChange={(e) => setIn("remarks", i.key, e.target.value)}
                        className={a === "no" && !(d.remarks?.[i.key] ?? "").trim() ? "border-warn" : undefined} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Group>
        ))}

        <Group title="General Remarks">
          <Area value={d.generalRemarks} onChange={(v) => set("generalRemarks", v)} rows={3} />
        </Group>

        <Group title="Nurse Sign-Off" hint="The ward nurse hands the patient over and the theatre nurse receives the patient. Both sign before the checklist is completed.">
          <div className="grid gap-3 sm:grid-cols-2">
            <SignerRow label="Ward Nurse" required people={WARD_NURSES} value={d.wardNurse} onChange={(s) => set("wardNurse", s)} />
            <SignerRow label="Theatre Nurse" required people={THEATRE_NURSES} value={d.theatreNurse} onChange={(s) => set("theatreNurse", s)} />
          </div>
        </Group>
      </div>
    </Dialog>
  );
}

function PhaseDialog({ c, enc, phase, patient, onClose, report }: DialogProps & { phase: PhaseId }) {
  const def = SAFETY_PHASES[phase];
  const team: Record<string, string> = {
    Surgeon: c.request.surgeon, Anaesthetist: c.schedule?.anaesthetist ?? "", "Circulating Nurse": c.schedule?.circulatingNurse ?? "", "Scrub Nurse": c.schedule?.scrubNurse ?? "",
  };
  const draft = c.phaseDrafts?.[phase];
  const [answers, setAnswers] = React.useState<Record<string, SafetyAnswer>>(draft?.answers ?? {});
  const [texts, setTexts] = React.useState<Record<string, string>>(draft?.texts ?? (phase === "signOut" ? { procedureName: c.opNote?.procedureDone ?? c.request.procedure } : {}));
  const [remarks, setRemarks] = React.useState(draft?.remarks ?? "");
  const [role, setRole] = React.useState<string>(draft?.confirmedRole || def.lead);
  const [signers, setSigners] = React.useState<SafetySigners>(() => ({
    surgeon: { name: c.request.surgeon }, anaesthetist: c.schedule?.anaesthetist ? { name: c.schedule.anaesthetist } : undefined,
    nurse: c.schedule?.circulatingNurse ? { name: c.schedule.circulatingNurse } : undefined, ...c.safetySigners,
  }));
  const data = { answers, texts, remarks: remarks || undefined, confirmedRole: role, confirmedName: team[role] ?? "", signers };
  // Sign In, Time Out and Sign Out wait for the booked slot. A doctor may start early with a reason.
  const [earlyReason, setEarlyReason] = React.useState("");
  const timing = timingGate(c, phase);
  const doctor = isDoctor();
  const early = !timing.ok ? { reason: earlyReason } : undefined;
  const timingProblem = timing.ok ? null : !doctor ? timing.reason : earlyReason.trim() ? null : "Give the reason for starting before the booked time.";
  const problem = timingProblem ?? validatePhase(phase, data);
  const unanswered = phaseUnanswered(phase, data).length;
  const people: Record<string, readonly string[]> = { surgeon: SURGEONS, anaesthetist: ANAESTHETISTS, nurse: THEATRE_NURSES };
  return (
    <Dialog open wide onClose={onClose} title={`${def.label}: ${def.when}`} subtitle={`Surgical safety checklist. ${def.read}`}
      footer={<DraftFooter problem={problem} draftProblem={timingProblem} onCancel={onClose} completeLabel={`Confirm ${def.label}`}
        onDraft={() => report(savePhaseDraft(c.id, phase, data, early))} onComplete={() => report(confirmPhase(c.id, phase, data, early))} />}>
      <CaseFacts c={c} enc={enc} patient={patient} />
      {!timing.ok && (
        <div role="alert" className="mb-4 rounded-lg border border-warn/50 bg-warn/10 p-3">
          <p className="text-sm font-medium">{timing.reason}</p>
          <Field label="Reason For Starting Early" required className="mt-2" hint={doctor ? "Recorded on the case with your name." : "You are not signed in as a doctor, so you cannot start early."}>
            <Textarea rows={2} className={textareaClass} value={earlyReason} disabled={!doctor} onChange={(e) => setEarlyReason(e.target.value)} placeholder="Emergency case needs the room" />
          </Field>
        </div>
      )}
      <RequiredNote className="mb-4" />
      <div className="space-y-5">
        <Group title={`${def.label} Items`} hint={`${unanswered ? `${unanswered} still to answer. ` : ""}A check answered No stops the phase until it is put right.`}>
          <ul className="space-y-3">
            {def.items.map((i) => {
              const required = i.kind !== "text" || i.required;
              if (i.kind === "text") {
                return (
                  <li key={i.key}>
                    <Field label={i.label} required={required}><Area value={texts[i.key]} onChange={(v) => setTexts((x) => ({ ...x, [i.key]: v }))} placeholder={i.placeholder} /></Field>
                  </li>
                );
              }
              const a = answers[i.key];
              return (
                <li key={i.key} className="rounded-lg border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 text-sm">{i.label}<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
                    <span className="flex shrink-0 gap-1.5" role="group" aria-label={i.label}>
                      {(i.options ?? []).map((o) => (
                        <button key={o} type="button" aria-pressed={a === o} onClick={() => setAnswers((x) => ({ ...x, [i.key]: o }))} className={chip(a === o)}>{showAnswer(o)}</button>
                      ))}
                    </span>
                  </div>
                  {i.kind === "check" && a === "No" && <p className="mt-1.5 text-xs font-medium text-destructive">Put this right before {def.label} is confirmed.</p>}
                  {i.kind === "risk" && a === "Yes" && (
                    <Field label={i.detailLabel ?? "Details"} required className="mt-2"><Input value={texts[i.key] ?? ""} placeholder={i.placeholder} onChange={(e) => setTexts((x) => ({ ...x, [i.key]: e.target.value }))} /></Field>
                  )}
                </li>
              );
            })}
          </ul>
          <Field label={`${def.label} Remarks`}><Area value={remarks} onChange={setRemarks} /></Field>
        </Group>

        <Group title="Confirmation">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Confirmed By (Role)" required>
              <Select value={role} onChange={(e) => setRole(e.target.value)}>{def.roles.map((r) => <option key={r}>{r}</option>)}</Select>
            </Field>
            <Field label="Name" hint="From the team on the schedule."><Input readOnly disabled value={team[role] ?? ""} /></Field>
          </div>
        </Group>

        <Group title="Team Signing" hint="The surgeon, the anaesthetist and the nurse sign the whole checklist. All three are needed before Sign Out is confirmed. A saved signature cannot be undone.">
          <div className="grid gap-3 sm:grid-cols-3">
            {SAFETY_SIGNERS.map((s) => (
              <SignerRow key={s.key} label={s.label} required={phase === "signOut"} people={people[s.key]} value={signers[s.key]} onChange={(v) => setSigners((x) => ({ ...x, [s.key]: v }))} />
            ))}
          </div>
        </Group>
      </div>
    </Dialog>
  );
}

function OpNoteDialog({ c, enc, onClose, report }: DialogProps) {
  const s = c.schedule;
  const [f, setF] = React.useState<OpNoteData>(() => {
    if (c.opNote) return formOf<OpNoteData>(c.opNote) as OpNoteData;
    const team: TeamMember[] = [
      { role: "Surgeon", staff: c.request.surgeon, primary: true },
      ...(s?.assistant ? [{ role: "Assistant Surgeon", staff: s.assistant }] : []),
      ...(s ? [{ role: "Anaesthetist", staff: s.anaesthetist, primary: true }, { role: "Scrub Nurse", staff: s.scrubNurse }, { role: "Circulating Nurse", staff: s.circulatingNurse }] : []),
    ];
    return {
      noteDate: s?.date ?? today(), start: s ? `${s.date}T${s.start}` : "", end: "", theatre: s?.room, theatreNurse: s?.circulatingNurse, anaesthetist: s?.anaesthetist,
      anaesthesia: c.assessment?.anaesthesia, procedureDone: c.request.procedure, findings: "", team, signingSurgeon: c.request.surgeon,
    };
  });
  const set = <K extends keyof OpNoteData>(k: K, v: OpNoteData[K]) => setF((x) => ({ ...x, [k]: v }));
  const team = f.team ?? [];
  const setTeam = (t: TeamMember[]) => set("team", t);
  const setRow = (n: number, patch: Partial<TeamMember>) => setTeam(team.map((m, i) => {
    if (i === n) return { ...m, ...patch };
    // One primary per role: ticking a row clears the others of the same role.
    if (patch.primary && m.role === (patch.role ?? team[n].role)) return { ...m, primary: false };
    return m;
  }));
  const dxOptions: CodedDx[] = [...enc.dx.map((x) => ({ code: x.code, text: x.text })), ...POSTOP_DIAGNOSES].filter((x, i, all) => x.code && all.findIndex((y) => y.code === x.code) === i);
  const problem = validateOpNote(f, "complete");
  const draftProblem = validateOpNote(f, "draft");
  return (
    <Dialog open wide onClose={onClose} title="Operative Note" subtitle={`Step 8. ${c.opNote?.status === "Draft" ? "Draft. " : ""}Completing signs the note. It cannot change after that.`}
      footer={<DraftFooter problem={problem} draftProblem={draftProblem} onCancel={onClose} completeLabel="Complete And Sign"
        onDraft={() => report(saveOpNote(c.id, f, "draft"))} onComplete={() => report(saveOpNote(c.id, f, "complete"))} />}>
      <RequiredNote className="mb-4" />
      <div className="space-y-5">
        <Group title="Operation Details">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Note Date" required><Input type="date" value={f.noteDate ?? ""} onChange={(e) => set("noteDate", e.target.value)} /></Field>
            <Field label="Theatre Number"><Select value={f.theatre ?? ""} onChange={(e) => set("theatre", e.target.value || undefined)}>{pick(THEATRE_ROOMS)}</Select></Field>
            <Field label="Operation Started" required hl7="encompassingEncounter/effectiveTime/low"><Input type="datetime-local" value={f.start} onChange={(e) => set("start", e.target.value)} /></Field>
            <Field label="Operation Ended" required hl7="encompassingEncounter/effectiveTime/high"><Input type="datetime-local" value={f.end} onChange={(e) => set("end", e.target.value)} /></Field>
            <Field label="Theatre Nurse"><Select value={f.theatreNurse ?? ""} onChange={(e) => set("theatreNurse", e.target.value || undefined)}>{pick(THEATRE_NURSES)}</Select></Field>
            <Field label="Operation Category"><Select value={f.category ?? ""} onChange={(e) => set("category", e.target.value || undefined)}>{pick(OPERATION_CATEGORIES)}</Select></Field>
            <Field label="Anaesthesia Given"><Select value={f.anaesthesia ?? ""} onChange={(e) => set("anaesthesia", e.target.value || undefined)}>{pick(ANAESTHESIA_TYPES)}</Select></Field>
            <Field label="Anaesthetist"><Select value={f.anaesthetist ?? ""} onChange={(e) => set("anaesthetist", e.target.value || undefined)}>{pick(ANAESTHETISTS)}</Select></Field>
          </div>
        </Group>

        <Group title="Diagnosis And Operation">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Diagnosis Before The Operation"><Input readOnly disabled value={c.request.preopDiagnosis || enc.dx[0]?.text || "Not recorded"} /></Field>
            <Field label="Post-Operative Diagnosis (ICD-10-AM)" hint="The visit's diagnoses come first. Check the code against the ICD-10-AM release.">
              <Select value={f.postopDiagnosis?.code ?? ""} onChange={(e) => set("postopDiagnosis", dxOptions.find((x) => x.code === e.target.value))}>
                <option value="">Select</option>
                {dxOptions.map((x) => <option key={x.code} value={x.code}>{x.code} {x.text}</option>)}
              </Select>
            </Field>
            <Field label="Operation Done" required className="sm:col-span-2"><Input value={f.procedureDone} onChange={(e) => set("procedureDone", e.target.value)} /></Field>
            <Field label="Findings And Procedure Details" required className="sm:col-span-2"><Area rows={4} value={f.findings} onChange={(v) => set("findings", v)} /></Field>
          </div>
        </Group>

        <Group title="Surgical Team" hint="At least one surgeon. Tick Primary for the lead of each role.">
          <ul className="space-y-3">
            {team.map((m, n) => (
              <li key={n} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <Field label="Role" required><Select value={m.role} onChange={(e) => setRow(n, { role: e.target.value })}>{pick(TEAM_ROLES)}</Select></Field>
                <Field label="Staff" required><Select value={m.staff} onChange={(e) => setRow(n, { staff: e.target.value })}>{pick(m.staff && !THEATRE_STAFF.includes(m.staff) ? [m.staff, ...THEATRE_STAFF] : THEATRE_STAFF)}</Select></Field>
                <div className="flex items-center gap-3 pb-1">
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!m.primary} onChange={(e) => setRow(n, { primary: e.target.checked })} />Primary
                  </label>
                  <Button size="sm" variant="ghost" aria-label={`Remove ${m.role || "row"} ${m.staff}`} onClick={() => setTeam(team.filter((_, i) => i !== n))}><Trash2 className="size-4" /></Button>
                </div>
                <Field label="Remarks" className="sm:col-span-3"><Input value={m.remarks ?? ""} onChange={(e) => setRow(n, { remarks: e.target.value || undefined })} /></Field>
              </li>
            ))}
            {team.length === 0 && <li className="text-sm text-muted-foreground">No team members added.</li>}
          </ul>
          <Button size="sm" onClick={() => setTeam([...team, { role: "", staff: "" }])}><Plus className="size-4" />Add Team Member</Button>
        </Group>

        <Group title="Complications, Specimens And Blood">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <YesNo label="Intra-operative Complication" required value={f.complication} onChange={(v) => setF((x) => ({ ...x, complication: v, complications: v ? (x.complications === "None" ? "" : x.complications) : "None" }))} />
            {f.complication ? <Field label="Complication Details" required><Input value={f.complications ?? ""} onChange={(e) => set("complications", e.target.value)} /></Field> : <span className="hidden sm:block" />}
            <YesNo label="Specimen Sent To Pathology" required value={f.specimenToPathology} onChange={(v) => setF((x) => ({ ...x, specimenToPathology: v, specimens: v ? (x.specimens === "None" ? "" : x.specimens) : "None" }))} />
            {f.specimenToPathology ? <Field label="Specimen Type" required><Input value={f.specimens ?? ""} onChange={(e) => set("specimens", e.target.value)} placeholder="Gallbladder to histopathology" /></Field> : <span className="hidden sm:block" />}
            <YesNo label="Transfusion Given" value={f.transfusion} onChange={(v) => setF((x) => ({ ...x, transfusion: v, transfusionMl: v ? x.transfusionMl : undefined }))} />
            {f.transfusion ? <Field label="Transfusion Volume In mL" required><Input type="number" min={0} value={f.transfusionMl ?? ""} onChange={(e) => set("transfusionMl", num(e.target.value))} /></Field> : <span className="hidden sm:block" />}
            <Field label="Estimated Blood Loss In mL"><Input type="number" min={0} value={f.bloodLossMl ?? ""} onChange={(e) => set("bloodLossMl", num(e.target.value))} /></Field>
            <YesNo label="Instrument And Swab Count Correct" required value={f.countCorrect} onChange={(v) => set("countCorrect", v)} />
          </div>
        </Group>

        <Group title="After The Operation">
          <Field label="Post-Operative Instructions" hint="Packs, drains, transfusions, sedation, antibiotics."><Area rows={3} value={f.plan} onChange={(v) => set("plan", v || undefined)} /></Field>
        </Group>

        <Group title="Signing">
          <Field label="Signing Surgeon" required className="sm:max-w-sm"><Select value={f.signingSurgeon ?? ""} onChange={(e) => set("signingSurgeon", e.target.value || undefined)}>{pick(SURGEONS)}</Select></Field>
        </Group>
      </div>
    </Dialog>
  );
}

function RecoveryDialog({ c, onClose, report }: DialogProps) {
  const [d, setD] = React.useState<RecoveryData>(() => c.recovery?.form ?? {
    arrivalTime: c.opNote?.end?.slice(11, 16) || nowClock(), aldrete: {}, vitals: {}, checks: {},
    destination: c.request.urgency.startsWith("Emergency") ? undefined : "Ward",
  });
  const [reason, setReason] = React.useState("");
  const set = <K extends keyof RecoveryData>(k: K, v: RecoveryData[K]) => setD((x) => ({ ...x, [k]: v }));
  const setVital = (k: keyof NonNullable<RecoveryData["vitals"]>, v: string) => setD((x) => ({ ...x, vitals: { ...x.vitals, [k]: num(v) } }));
  const setScore = (when: "admission" | "discharge", k: keyof AldreteScores, v: string) =>
    setD((x) => ({ ...x, aldrete: { ...x.aldrete, [when]: { ...x.aldrete?.[when], [k]: v === "" ? undefined : Number(v) } } }));
  const admission = aldreteTotal(d.aldrete?.admission);
  const discharge = aldreteTotal(d.aldrete?.discharge);
  const low = discharge !== null && discharge < ALDRETE_PASS;
  const doctor = isDoctor();
  const invalid = validateRecovery(d, "complete");
  const gate = discharge === null ? null : recoveryDischargeGate(discharge, low ? { reason, isDoctor: doctor } : undefined);
  const problem = invalid ?? (gate && !gate.ok ? gate.reason : null);
  const vitals: [keyof NonNullable<RecoveryData["vitals"]>, string, string?][] = [
    ["bpSystolic", "BP Systolic", "mmHg"], ["bpDiastolic", "BP Diastolic", "mmHg"], ["pulse", "Pulse", "per minute"], ["temperature", "Temperature", "°C"], ["spo2", "SpO2", "%"], ["respRate", "Respiratory Rate", "per minute"],
  ];
  return (
    <Dialog open wide onClose={onClose} title="Recovery Room Assessment" subtitle={`Step 9. Post-operative nursing assessment. The patient leaves recovery at an Aldrete score of ${ALDRETE_PASS} or more, or with a doctor's override.`}
      footer={<DraftFooter problem={problem} draftProblem={validateRecovery(d, "draft")} onCancel={onClose} completeLabel={low ? "Override And Discharge" : "Complete And Discharge"}
        onDraft={() => report(saveRecovery(c.id, d, "draft"))} onComplete={() => report(saveRecovery(c.id, d, "complete", low ? reason : undefined))} />}>
      <RequiredNote className="mb-4" />
      <div className="space-y-5">
        <Group title="Recovery Details">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-3">
            <Field label="Arrival Time" required><Input type="time" value={d.arrivalTime ?? ""} onChange={(e) => set("arrivalTime", e.target.value)} /></Field>
            <Field label="Time Out" hint="Left blank, the time of discharge is used."><Input type="time" value={d.timeOut ?? ""} onChange={(e) => set("timeOut", e.target.value || undefined)} /></Field>
            <Field label="Responsible Nurse" required><Select value={d.responsibleNurse ?? ""} onChange={(e) => set("responsibleNurse", e.target.value || undefined)}>{pick(RECOVERY_NURSES)}</Select></Field>
          </div>
        </Group>

        <Group title="Recovery Vital Signs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
            {vitals.map(([k, label, unit]) => (
              <Field key={k} label={label} hint={unit}><Input type="number" step={k === "temperature" ? 0.1 : 1} value={d.vitals?.[k] ?? ""} onChange={(e) => setVital(k, e.target.value)} /></Field>
            ))}
          </div>
        </Group>

        <Group title="Airway, Drains And Dressing">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Airway"><Area value={d.airway} onChange={(v) => set("airway", v)} placeholder="Own airway, oxygen by face mask" /></Field>
            <Field label="Drains Or Tubes"><Area value={d.drains} onChange={(v) => set("drains", v)} /></Field>
            <Field label="Dressing"><Area value={d.dressing} onChange={(v) => set("dressing", v)} placeholder="Dry and intact" /></Field>
            <Field label="Skin Condition"><Area value={d.skin} onChange={(v) => set("skin", v)} /></Field>
          </div>
        </Group>

        <Group title="Pain Assessment">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <YesNo label="Is The Patient In Pain?" required value={d.inPain} onChange={(v) => setD((x) => ({ ...x, inPain: v, painIntensity: v ? x.painIntensity : 0, painTool: v ? x.painTool : undefined }))} />
            <Field label="Pain Tool" required={!!d.inPain}><Select value={d.painTool ?? ""} disabled={!d.inPain} onChange={(e) => set("painTool", e.target.value || undefined)}>{pick(PAIN_TOOLS)}</Select></Field>
            <Ask label="Pain Intensity, 0 To 10" required={!!d.inPain} className="sm:col-span-2" hint="0 no pain. 1 to 3 mild. 4 to 6 moderate. 7 to 10 severe.">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Pain intensity">
                {Array.from({ length: 11 }, (_, n) => (
                  <button key={n} type="button" role="radio" aria-checked={d.painIntensity === n} disabled={!d.inPain} onClick={() => set("painIntensity", n)}
                    className={cn(chip(d.painIntensity === n), "min-w-10 text-center disabled:cursor-not-allowed disabled:opacity-50")}>{n}</button>
                ))}
              </div>
            </Ask>
          </div>
        </Group>

        <Group title="Aldrete Score" hint={`Six items, 0 to 2 points each, out of ${ALDRETE_MAX}. Score on arrival and again before the patient leaves.`}>
          <div className="space-y-3">
            {ALDRETE_ITEMS.map((i) => (
              <div key={i.key} className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr] sm:items-end">
                <span className="text-sm font-medium">{i.label}<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
                {(["admission", "discharge"] as const).map((when) => (
                  <Field key={when} label={when === "admission" ? "On Admission" : "At Discharge"}>
                    <Select value={d.aldrete?.[when]?.[i.key] ?? ""} onChange={(e) => setScore(when, i.key, e.target.value)}>
                      <option value="">Select</option>
                      {[2, 1, 0].map((n) => <option key={n} value={n}>{n}: {i.options[n]}</option>)}
                    </Select>
                  </Field>
                ))}
              </div>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Admission Remarks"><Input value={d.aldrete?.admissionRemarks ?? ""} onChange={(e) => setD((x) => ({ ...x, aldrete: { ...x.aldrete, admissionRemarks: e.target.value } }))} /></Field>
              <Field label="Discharge Remarks"><Input value={d.aldrete?.dischargeRemarks ?? ""} onChange={(e) => setD((x) => ({ ...x, aldrete: { ...x.aldrete, dischargeRemarks: e.target.value } }))} /></Field>
            </div>
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" role="status">
              <span className="font-semibold">On admission: {admission === null ? "not complete" : `${admission} of ${ALDRETE_MAX}`}. At discharge: {discharge === null ? "not complete" : `${discharge} of ${ALDRETE_MAX}`}.</span>
              {discharge !== null && (discharge >= ALDRETE_PASS ? " The patient can leave recovery." : ` Below ${ALDRETE_PASS}: the patient stays in recovery, unless a doctor overrides with a reason.`)}
            </p>
          </div>
        </Group>

        <Group title="Recovery Checklist">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            {RECOVERY_CHECKS.map((k) => (
              <YesNo key={k.key} label={k.label} value={d.checks?.[k.key]} onChange={(v) => setD((x) => ({ ...x, checks: { ...x.checks, [k.key]: v } }))} />
            ))}
            {d.checks?.complications && <Field label="Complication Details" required className="sm:col-span-2"><Area value={d.complicationDetails} onChange={(v) => set("complicationDetails", v)} /></Field>}
          </div>
        </Group>

        <Group title="Care Given In Recovery">
          <Field label="Blood Or IV Therapy Given In Recovery"><Area value={d.bloodIv} onChange={(v) => set("bloodIv", v)} /></Field>
          <Field label="Nursing Observations" required><Area rows={3} value={d.observations} onChange={(v) => set("observations", v)} /></Field>
        </Group>

        <Group title="Transfer And Handover">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Condition On Transfer From Recovery" required className="sm:col-span-2"><Area value={d.conditionOnTransfer} onChange={(v) => set("conditionOnTransfer", v)} /></Field>
            <Field label="Patient Goes To" required><Select value={d.destination ?? ""} onChange={(e) => set("destination", e.target.value || undefined)}>{pick(RECOVERY_DESTINATIONS)}</Select></Field>
            <Field label="Received By Ward Nurse"><Select value={d.receivedBy ?? ""} onChange={(e) => set("receivedBy", e.target.value || undefined)}>{pick(WARD_NURSES)}</Select></Field>
            <Field label="Remarks" className="sm:col-span-2"><Area value={d.remarks} onChange={(v) => set("remarks", v)} /></Field>
          </div>
        </Group>

        {low && (
          <div className="rounded-lg border border-warn/50 bg-warn/10 p-3">
            <p className="mb-3 text-sm">The discharge score is below {ALDRETE_PASS}. Only a doctor can let the patient leave, and must give a reason. The override is recorded with the doctor's name.</p>
            <Field label="Reason For The Doctor Override" required hint={doctor ? undefined : "You are not signed in as a doctor, so you cannot override."}>
              <Textarea rows={2} className={textareaClass} value={reason} disabled={!doctor} onChange={(e) => setReason(e.target.value)} placeholder="Planned transfer to intensive care on a ventilator" />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

const DISPOSITION_FROM_DESTINATION: Record<string, string> = { Ward: "Returned To Ward", "Intensive Care Unit": "Admitted To Intensive Care", "Day Surgery Unit": "Day Surgery Unit", Home: "Discharged Home" };

function CloseDialog({ c, onClose, report }: DialogProps) {
  const outcomes: { id: CloseOutcome; label: string; help: string }[] = [
    { id: "Completed", label: "Completed", help: "Every step is done and the patient has left recovery." },
    { id: "Cancelled", label: "Cancelled", help: "The operation will not happen. Only before Sign In." },
    { id: "Incomplete", label: "Incomplete", help: "The case started but was stopped before the end." },
  ];
  const firstOpen = outcomes.find((o) => closeGate(c, o.id, "x").ok)?.id;
  const [outcome, setOutcome] = React.useState<CloseOutcome | undefined>(firstOpen);
  const [reason, setReason] = React.useState("");
  const [details, setDetails] = React.useState({
    date: today(), time: nowClock(), disposition: DISPOSITION_FROM_DESTINATION[c.recovery?.discharge?.destination ?? ""] ?? (c.signIn ? "" : "Returned To Ward"), dispositionRemarks: "",
  });
  const gate = outcome ? closeGate(c, outcome, reason) : { ok: false, reason: "Choose how the case ended." };
  const problem = gate.ok ? validateClosure(details) : gate.reason;
  return (
    <Dialog open wide onClose={onClose} title="Close Case" subtitle={c.request.procedure}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Close Case" onSave={() => outcome && report(closeCase(c.id, outcome, reason, details))} />}>
      <RequiredNote className="mb-3" />
      <div className="space-y-2" role="radiogroup" aria-label="How the case ended">
        {outcomes.map((o) => {
          const g = closeGate(c, o.id, "x");
          return (
            <button key={o.id} type="button" role="radio" aria-checked={outcome === o.id} disabled={!g.ok} onClick={() => setOutcome(o.id)}
              className={cn(chip(outcome === o.id), "block w-full disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground")}>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs font-normal">{g.ok ? o.help : `Not available: ${g.reason}`}</span>
            </button>
          );
        })}
      </div>
      {outcome && outcome !== "Completed" && (
        <Field label="Reason" required className="mt-4">
          <Textarea rows={2} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div className="mt-4 grid gap-x-4 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
        <Field label="Closure Date" required><Input type="date" value={details.date} onChange={(e) => setDetails((x) => ({ ...x, date: e.target.value }))} /></Field>
        <Field label="Closure Time" required><Input type="time" value={details.time} onChange={(e) => setDetails((x) => ({ ...x, time: e.target.value }))} /></Field>
        <Field label="Patient Disposition" required className="sm:col-span-2"><Select value={details.disposition} onChange={(e) => setDetails((x) => ({ ...x, disposition: e.target.value }))}>{pick(DISPOSITIONS)}</Select></Field>
        <Field label="Patient Disposition Remarks" className="sm:col-span-2"><Textarea rows={2} className={textareaClass} value={details.dispositionRemarks} onChange={(e) => setDetails((x) => ({ ...x, dispositionRemarks: e.target.value }))} /></Field>
      </div>
    </Dialog>
  );
}

/* ---------- the stepper ---------- */

type DialogId = StepId | "new" | "postpone";

function phaseSummary(c: SurgeryCase, id: PhaseId): React.ReactNode {
  const p = c[id];
  if (!p) return c.phaseDrafts?.[id] ? <span className="text-muted-foreground">Draft saved by {c.phaseDrafts[id]!.saved.by}. Not confirmed yet.</span> : null;
  if (!p.answers) return <>All {p.checked?.length ?? 0} checks done. Confirmed by {p.confirmedRole}: {p.confirmedName}</>;
  const def = SAFETY_PHASES[id];
  const flagged = def.items.filter((i) => (i.kind === "question" || i.kind === "risk") && p.answers?.[i.key] === "Yes");
  return (
    <>
      All {def.items.filter((i) => i.kind !== "text").length} items answered. Confirmed by {p.confirmedRole}: {p.confirmedName}.
      {flagged.length > 0 && <span className="block">{flagged.map((i) => `${i.label} Yes${p.texts?.[i.key] ? `: ${p.texts[i.key]}` : ""}`).join(". ")}</span>}
      {p.remarks && <span className="block text-muted-foreground">Remarks: {p.remarks}</span>}
    </>
  );
}

function StepRow({ n, c, step, canWrite, open, report }: { n: number; c: SurgeryCase; step: (typeof STEPS)[number]; canWrite: boolean; open: (d: DialogId) => void; report: (r: Result) => void }) {
  const done = stepDone(c, step.id);
  const isNext = currentStep(c) === step.id;
  const noRole: Gate = { ok: false, reason: "Your role cannot record surgery steps." };
  const gateOf = (g: Gate): Gate => (canWrite ? g : noRole);
  const gate = gateOf(stepGate(c, step.id));

  let summary: React.ReactNode = null;
  let stamp: Stamp | undefined;
  let actions: React.ReactNode = null;

  switch (step.id) {
    case "request":
      stamp = c.request.done;
      summary = <>{c.request.procedure} · Side: {c.request.side} · {c.request.surgeon} · {c.request.urgency} · Planned {c.request.plannedDate}</>;
      break;
    case "assessment":
      stamp = c.assessment?.done;
      summary = c.assessment && (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={fitForSurgery(c.assessment.result) ? (c.assessment.result === "Fit" ? "ok" : "warn") : "danger"}>{c.assessment.result}</Badge>
          {c.assessment.asa && <span>ASA class {c.assessment.asa}</span>}
          {c.assessment.anaesthesia && <span>{c.assessment.anaesthesia} anaesthesia</span>}
          {c.assessment.notes && <span className="text-muted-foreground">{c.assessment.notes}</span>}
        </span>
      );
      if (!c.assessment) actions = <GateButton primary gate={gate} onClick={() => open("assessment")}>Record Assessment</GateButton>;
      else if (gate.ok) actions = <GateButton primary={!fitForSurgery(c.assessment?.result)} gate={gate} onClick={() => open("assessment")}>Assess Again</GateButton>;
      break;
    case "schedule": {
      const st = scheduleStatus(c);
      stamp = done ? c.schedule?.done : undefined;
      summary = (c.schedule || c.postponements?.length) && (
        <span className="block space-y-1">
          {c.schedule && (
            <span className="flex flex-wrap items-center gap-2">
              {st && <Badge tone={SCHEDULE_TONE[st]}>{st}</Badge>}
              <span>{c.schedule.room || "No room"} · {c.schedule.date}{c.schedule.start ? `, ${c.schedule.start} to ${scheduleEnd(c.schedule)}` : ""}{c.schedule.anaesthetist ? ` · Anaesthetist ${c.schedule.anaesthetist}` : ""}{c.schedule.scrubNurse ? ` · Scrub nurse ${c.schedule.scrubNurse}` : ""}{c.schedule.circulatingNurse ? ` · Circulating nurse ${c.schedule.circulatingNurse}` : ""}</span>
            </span>
          )}
          {c.schedule?.confirmed && st === "Confirmed" && <Signed stamp={c.schedule.confirmed} verb="Confirmed" />}
          {!done && c.schedule?.status === "Draft" && <span className="block text-xs text-muted-foreground">Draft saved by {c.schedule.done.by}. It does not hold the room yet.</span>}
          {c.postponements?.map((p, i) => (
            <span key={i} className="block text-xs text-muted-foreground">Postponed on {whenIso(p.stamp.at)} by {p.stamp.by}: {p.slot}. Reason: {p.reason}</span>
          ))}
        </span>
      );
      const btns: React.ReactNode[] = [];
      if (!done) btns.push(<GateButton key="s" primary gate={gate} onClick={() => open("schedule")}>{c.schedule?.status === "Draft" ? "Continue Schedule" : c.schedule?.status === "Postponed" ? "Schedule Again" : "Schedule Case"}</GateButton>);
      else if (gate.ok) btns.push(<GateButton key="s" gate={gate} onClick={() => open("schedule")}>Change Schedule</GateButton>);
      if (st === "Scheduled") btns.push(<GateButton key="c" primary gate={gateOf(confirmGate(c))} onClick={() => report(confirmSchedule(c.id))}>Confirm Schedule</GateButton>);
      if (c.schedule && !c.signIn && !c.closed && st !== "Postponed") btns.push(<GateButton key="p" gate={gateOf(postponeGate(c, "x"))} onClick={() => open("postpone")}>Postpone</GateButton>);
      actions = btns.length ? <>{btns}</> : null;
      break;
    }
    case "preop": {
      stamp = c.preop?.done;
      const left = preOpProblems(c.preop, c.request.side);
      const items = preOpMissing(c.preop?.answers, c.request.side, c.preop?.remarks).length;
      summary = c.preop && (
        <span className="block space-y-0.5">
          <span className="block">{PREOP_ITEMS.length - items} of {PREOP_ITEMS.length} items answered{c.preop.checklistDate ? ` · Checklist date ${c.preop.checklistDate}` : ""}</span>
          {(c.preop.wardNurse?.signed || c.preop.theatreNurse?.signed) && (
            <span className="block text-xs text-muted-foreground">
              {[c.preop.wardNurse?.signed && `Ward nurse ${c.preop.wardNurse.name} signed`, c.preop.theatreNurse?.signed && `Theatre nurse ${c.preop.theatreNurse.name} signed`].filter(Boolean).join(" · ")}
            </span>
          )}
          {!done && left.length > 0 && <span className="block text-xs text-muted-foreground">Draft. Still open: {left.slice(0, 3).join(" ")}{left.length > 3 ? ` And ${left.length - 3} more.` : ""}</span>}
        </span>
      );
      if (!done || gate.ok) actions = <GateButton primary={!done} gate={gate} onClick={() => open("preop")}>{done ? "Change Checklist" : c.preop ? "Continue Checklist" : "Start Checklist"}</GateButton>;
      break;
    }
    case "signIn":
    case "timeOut":
    case "signOut":
      stamp = c[step.id]?.done;
      summary = phaseSummary(c, step.id);
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open(step.id)}>{c.phaseDrafts?.[step.id] ? "Continue" : "Start"} {step.label}</GateButton>;
      break;
    case "opNote": {
      const o = c.opNote;
      stamp = done ? o?.done : undefined;
      summary = o && (
        <span className="block space-y-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={done ? "ok" : "neutral"}>{done ? "Completed" : "Draft"}</Badge>
            <span>{o.procedureDone}{o.start && o.end ? ` · ${whenLocal(o.start)} to ${whenLocal(o.end)}` : ""}{o.bloodLossMl !== undefined ? ` · Blood loss ${o.bloodLossMl} mL` : ""}</span>
          </span>
          {o.postopDiagnosis && <span className="block text-xs">After the operation: {o.postopDiagnosis.code} {o.postopDiagnosis.text}</span>}
          {done && o.signingSurgeon && <span className="block text-xs text-muted-foreground">Signed by {o.signingSurgeon}</span>}
          {!done && o.saved && <span className="block text-xs text-muted-foreground">Draft saved by {o.saved.by} on {whenIso(o.saved.at)}</span>}
        </span>
      );
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open("opNote")}>{o ? "Continue Operative Note" : "Write Operative Note"}</GateButton>;
      break;
    }
    case "recovery": {
      const r = c.recovery;
      const d = r?.discharge;
      stamp = d?.done;
      const f = r?.form;
      const adm = aldreteTotal(f?.aldrete?.admission);
      const dis = aldreteTotal(f?.aldrete?.discharge);
      summary = r && (
        <span className="block space-y-1">
          {r.scores.map((s, i) => (
            <span key={i} className="flex flex-wrap items-center gap-2">
              <Badge tone={s.total >= ALDRETE_PASS ? "ok" : "warn"}>Aldrete {s.total} of {aldreteMaxOf(s.scores)}</Badge>
              <span className="text-xs text-muted-foreground">{s.stamp.by} on {whenIso(s.stamp.at)}</span>
            </span>
          ))}
          {(adm !== null || dis !== null) && (
            <span className="flex flex-wrap items-center gap-2">
              {adm !== null && <Badge tone={adm >= ALDRETE_PASS ? "ok" : "warn"}>On admission {adm} of {ALDRETE_MAX}</Badge>}
              {dis !== null && <Badge tone={dis >= ALDRETE_PASS ? "ok" : "warn"}>At discharge {dis} of {ALDRETE_MAX}</Badge>}
            </span>
          )}
          {f && (f.arrivalTime || f.responsibleNurse) && <span className="block text-xs">{f.arrivalTime ? `Arrived ${f.arrivalTime}` : ""}{f.timeOut ? `, out ${f.timeOut}` : ""}{f.responsibleNurse ? ` · Nurse ${f.responsibleNurse}` : ""}{f.inPain !== undefined ? ` · ${f.inPain ? `In pain, ${f.painIntensity ?? "?"} of 10` : "No pain"}` : ""}</span>}
          {!d && r.saved && <span className="block text-xs text-muted-foreground">Draft saved by {r.saved.by} on {whenIso(r.saved.at)}</span>}
          {d && <span className="block">Left recovery for {d.destination} with a score of {d.score}.{d.override ? ` Doctor override by ${d.override.doctor}: ${d.override.reason}` : ""}</span>}
        </span>
      );
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open("recovery")}>{f ? "Continue Recovery Assessment" : "Record Recovery Assessment"}</GateButton>;
      break;
    }
    case "close":
      stamp = c.closed?.done;
      summary = c.closed && (
        <span className="block">
          {c.closed.outcome}{c.closed.reason ? `: ${c.closed.reason}` : ""}
          {c.closed.disposition && <span className="block text-xs">Disposition: {c.closed.disposition}{c.closed.dispositionRemarks ? `. ${c.closed.dispositionRemarks}` : ""}{c.closed.date ? ` · Closed ${c.closed.date} ${c.closed.time ?? ""}` : ""}</span>}
        </span>
      );
      if (!done) actions = <GateButton primary={isNext} gate={canWrite ? { ok: true, reason: "" } : noRole} onClick={() => open("close")}>{isNext ? "Close Case" : "Cancel Or Close Case"}</GateButton>;
      break;
  }

  const draft = !done && !c.closed && ((step.id === "preop" && !!c.preop) || (step.id === "opNote" && !!c.opNote) || (step.id === "recovery" && !!c.recovery?.form)
    || ((step.id === "signIn" || step.id === "timeOut" || step.id === "signOut") && !!c.phaseDrafts?.[step.id]) || (step.id === "schedule" && c.schedule?.status === "Draft"));
  const state = done ? "Done" : c.closed ? "Not Done" : draft ? "Draft" : isNext ? "Next" : "Waiting";
  const Icon = done ? CheckCircle2 : isNext ? CircleDot : Circle;
  return (
    <li className={cn("grid gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto]", isNext && "bg-move/5")} aria-current={isNext ? "step" : undefined}>
      <div className="flex min-w-0 gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", done ? "text-ok" : isNext ? "text-move" : "text-muted-foreground")} aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{n}. {step.label}</h3>
            {step.when && <span className="text-xs text-muted-foreground">{step.when}</span>}
            <Badge tone={done ? "ok" : state === "Draft" ? "warn" : state === "Next" ? "info" : "neutral"}>{state}</Badge>
          </div>
          {summary && <div className="text-sm">{summary}</div>}
          {stamp && <Signed stamp={stamp} verb={step.id === "request" ? "Requested" : step.id === "close" ? "Closed" : step.id === "schedule" ? "Scheduled" : "Completed"} />}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-start gap-2 ps-8 md:justify-end md:ps-0">{actions}</div>}
    </li>
  );
}

/** Chart section: the surgery case of this visit as a stepper. Each step opens only when the one before it is done. */
export function TheatreSection({ enc }: { enc: Encounter }): React.ReactElement {
  useTheatre();
  useSession();
  const his = useHis();
  const dev = useDevMode();
  const route = useRoute();
  const cases = casesForVisit(enc.visitNumber);
  const wanted = route.params.get("case");
  const c = cases.find((x) => x.id === wanted) ?? [...cases].reverse().find((x) => !x.closed) ?? cases[cases.length - 1];
  const [dialog, setDialog] = React.useState<DialogId | null>(null);
  const canWrite = can("emr.write");
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const openCase = cases.find((x) => !x.closed);

  const close = () => setDialog(null);
  const report = (r: Result) => {
    pushToast({ tone: r.ok ? "ok" : "danger", text: r.message });
    if (r.ok) {
      close();
      if (dialog === "new") navigate("/chart", { visit: enc.visitNumber, s: "surgery", case: r.id });
    }
  };
  const newGate: Gate = !canWrite ? { ok: false, reason: "Your role cannot request surgery." }
    : enc.status !== "active" ? { ok: false, reason: "This visit is not active." }
    : openCase ? { ok: false, reason: `Case ${openCase.request.procedure} is still open. Close it before a new request.` } : { ok: true, reason: "" };
  const props: DialogProps | null = c ? { c, enc, patient: patientName(patient), onClose: close, report } : null;
  const latest = c ? latestAldrete(c) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Surgery Case"
          subtitle="From the request to the closed case. Each step opens when the one before it is done. Long steps can be saved as a draft and completed later."
          right={<GateButton primary gate={newGate} onClick={() => setDialog("new")}><Plus className="size-4" />New Surgery Request</GateButton>}
        />
        {cases.length === 0 && <Empty>No surgery case for this visit yet. Start with New Surgery Request.</Empty>}
        {cases.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3" role="tablist" aria-label="Surgery cases of this visit">
            {cases.map((x) => (
              <button key={x.id} role="tab" aria-selected={x.id === c?.id} onClick={() => navigate("/chart", { visit: enc.visitNumber, s: "surgery", case: x.id })}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", x.id === c?.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                {x.request.procedure} ({caseStage(x)})
              </button>
            ))}
          </div>
        )}
        {c && (
          <>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="text-base font-semibold">{c.request.procedure}</div>
                <div className="text-sm text-muted-foreground">Side: {c.request.side} · {c.request.surgeon} · {c.request.urgency}{dev ? ` · ${c.id}` : ""}</div>
              </div>
              <div className="ms-auto flex flex-wrap items-center gap-2">
                <Badge tone={STAGE_TONE[caseStage(c)]}>{c.closed ? `Closed: ${c.closed.outcome}` : caseStage(c)}</Badge>
                {!c.closed && latest && caseStage(c) === "In Recovery" && <Badge tone={latest.total >= ALDRETE_PASS ? "ok" : "warn"}>Aldrete {latest.total} of {latest.max}</Badge>}
                {!c.closed && <span className="text-sm">Next: <span className="font-medium">{nextAction(c)}</span></span>}
              </div>
            </div>
            <ol className="divide-y divide-border" aria-label="Surgery steps">
              {STEPS.map((s, i) => <StepRow key={s.id} n={i + 1} c={c} step={s} canWrite={canWrite} open={setDialog} report={report} />)}
            </ol>
          </>
        )}
      </Card>

      {c && readyForOperativeNote(c) && (
        <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
          <FileText className="size-5 shrink-0 text-move" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">
            The operative note is completed and signed. The Operative Note can now be created and published to NPHIES from Clinical Documents.
            {dev && <span className="text-muted-foreground"> The document reads the times, findings, specimens, complications and blood loss from the linked Operation Request record.</span>}
          </p>
          <Button onClick={() => navigate("/chart", { visit: enc.visitNumber, s: "documents" })}>Open Clinical Documents</Button>
        </Card>
      )}

      {dialog === "new" && <RequestDialog enc={enc} onClose={close} report={report} />}
      {props && dialog === "assessment" && <AssessmentDialog {...props} />}
      {props && dialog === "schedule" && <ScheduleDialog {...props} />}
      {props && dialog === "postpone" && <PostponeDialog {...props} />}
      {props && dialog === "preop" && <PreOpDialog {...props} />}
      {props && (dialog === "signIn" || dialog === "timeOut" || dialog === "signOut") && <PhaseDialog {...props} phase={dialog} />}
      {props && dialog === "opNote" && <OpNoteDialog {...props} />}
      {props && dialog === "recovery" && <RecoveryDialog {...props} />}
      {props && dialog === "close" && <CloseDialog {...props} />}
    </div>
  );
}
