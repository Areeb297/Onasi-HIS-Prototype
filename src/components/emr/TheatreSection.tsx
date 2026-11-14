import * as React from "react";
import { CheckCircle2, Circle, CircleDot, FileText, Lock, Plus } from "lucide-react";
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
  ANAESTHETISTS, RECOVERY_DESTINATIONS, SURGEONS, THEATRE_NURSES, addRecoveryScore, allCases, casesForVisit, closeCase, confirmPhase, dischargeFromRecovery,
  isDoctor, requestSurgery, saveAssessment, saveOpNote, savePreOp, saveSchedule, useTheatre, type Result,
} from "@/lib/theatre";
import {
  ALDRETE_ITEMS, ALDRETE_PASS, ANAESTHESIA_TYPES, ASA_CLASSES, ASSESSMENT_RESULTS, PREOP_ITEMS, SAFETY_PHASES, SIDES, STEPS, THEATRE_ROOMS, URGENCIES,
  aldreteTotal, caseStage, closeGate, currentStep, fitForSurgery, nextAction, preOpMissing, preOpNaAllowed, readyForOperativeNote, recoveryDischargeGate, scheduleEnd,
  stepDone, stepGate, validateAssessment, validateOpNote, validatePhase, validateRequest, validateSchedule,
  type AldreteScores, type AssessmentResult, type CaseStage, type CloseOutcome, type Gate, type PhaseId, type PreOpAnswer, type Stamp, type StepId, type SurgeryCase,
} from "@/lib/theatre-logic";
import { pushToast } from "@/lib/toast";

/* ---------- small shared pieces ---------- */

export const STAGE_TONE: Record<CaseStage, "neutral" | "ok" | "warn" | "danger" | "info" | "admit" | "update"> = {
  "Waiting For Assessment": "warn", "Not Cleared": "danger", "To Schedule": "info", Scheduled: "info", "In Theatre": "admit",
  "Note Needed": "warn", "In Recovery": "update", "Ready To Close": "ok", Closed: "neutral",
};

const whenIso = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const whenLocal = (local: string) => (local ? whenIso(local) : "");

const textareaClass =
  "min-h-20 rounded-lg border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/80 " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring md:text-sm dark:bg-background";
const chip = (on: boolean) =>
  cn(
    "min-h-9 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
    on ? "border-admit bg-admit/14 font-semibold text-admit ring-1 ring-admit" : "border-input bg-card text-foreground hover:bg-muted dark:bg-background",
  );

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

/** Footer of every step dialog: what is still missing, then Cancel and the save button. */
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

type DialogProps = { c: SurgeryCase; enc: Encounter; onClose: () => void; report: (r: Result) => void };

/* ---------- step dialogs ---------- */

function RequestDialog({ enc, onClose, report }: Omit<DialogProps, "c">) {
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
          <Select value={f.side} onChange={set("side")}><option value="">Select</option>{SIDES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Surgeon" required>
          <Select value={f.surgeon} onChange={set("surgeon")}><option value="">Select</option>{SURGEONS.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
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
    <Dialog open wide onClose={onClose} title="Pre-anaesthesia Assessment" subtitle={`Step 2. ${c.request.procedure}`}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Save Assessment" onSave={() => result && report(saveAssessment(c.id, { ...data, result }))} />}>
      <RequiredNote className="mb-3" />
      <p className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Allergies in the chart:</span> {allergyText(enc.allergies)}</p>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="Result" required className="sm:col-span-2" hint="Only Fit and Fit With High Risk let the case be scheduled.">
          <Choice label="Result" value={result} onChange={setResult} options={ASSESSMENT_RESULTS.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="ASA Class" hint="American Society of Anesthesiologists physical status. I is healthy, V is not expected to survive without the operation.">
          <Select value={asa} onChange={(e) => setAsa(e.target.value)}><option value="">Select</option>{ASA_CLASSES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Planned Anaesthesia">
          <Select value={anaesthesia} onChange={(e) => setAnaesthesia(e.target.value)}><option value="">Select</option>{ANAESTHESIA_TYPES.map((s) => <option key={s}>{s}</option>)}</Select>
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
  const problem = validateSchedule(f, allCases(), c.id);
  const pick = (list: readonly string[]) => <><option value="">Select</option>{list.map((x) => <option key={x}>{x}</option>)}</>;
  return (
    <Dialog open wide onClose={onClose} title="Schedule" subtitle={`Step 3. ${c.request.procedure}. Surgeon: ${c.request.surgeon}`}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Save Schedule" onSave={() => report(saveSchedule(c.id, { ...f, assistant: f.assistant || undefined }))} />}>
      <RequiredNote className="mb-3" />
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

function PreOpDialog({ c, enc, onClose, report }: DialogProps) {
  const [answers, setAnswers] = React.useState<Record<string, PreOpAnswer>>(c.preop?.answers ?? {});
  const left = preOpMissing(answers, c.request.side);
  const toggle = (key: string, a: PreOpAnswer) => setAnswers((x) => {
    const n = { ...x };
    if (n[key] === a) delete n[key];
    else n[key] = a;
    return n;
  });
  return (
    <Dialog open wide onClose={onClose} title="Pre-operative Checklist" subtitle={`Step 4. ${c.request.procedure}, side: ${c.request.side}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs" role="status">{left.length ? `${left.length} of ${PREOP_ITEMS.length} items are still open. Sign In stays locked until all are answered.` : "Every item is answered. Saving completes the checklist."}</p>
          <span className="flex shrink-0 gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => report(savePreOp(c.id, answers))}>{left.length ? "Save Progress" : "Complete Checklist"}</Button>
          </span>
        </div>
      }>
      <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">Allergies in the chart:</span> {allergyText(enc.allergies)}</p>
      <ul className="divide-y divide-border">
        {PREOP_ITEMS.map((i) => {
          const na = preOpNaAllowed(i, c.request.side);
          return (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0 flex-1 text-sm">
                {i.label}
                {!na && <span className="ms-1.5 text-xs text-muted-foreground">(always needed)</span>}
              </span>
              <span className="flex shrink-0 gap-1.5" role="group" aria-label={i.label}>
                <button type="button" aria-pressed={answers[i.key] === "yes"} onClick={() => toggle(i.key, "yes")} className={chip(answers[i.key] === "yes")}>Yes, Done</button>
                {na && <button type="button" aria-pressed={answers[i.key] === "na"} onClick={() => toggle(i.key, "na")} className={chip(answers[i.key] === "na")}>Does Not Apply</button>}
              </span>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function PhaseDialog({ c, enc, phase, patient, onClose, report }: DialogProps & { phase: PhaseId; patient: string }) {
  const def = SAFETY_PHASES[phase];
  const team: Record<string, string> = {
    Surgeon: c.request.surgeon, Anaesthetist: c.schedule?.anaesthetist ?? "", "Circulating Nurse": c.schedule?.circulatingNurse ?? "", "Scrub Nurse": c.schedule?.scrubNurse ?? "",
  };
  const [checked, setChecked] = React.useState<string[]>([]);
  const [role, setRole] = React.useState<string>(def.lead);
  const data = { checked, confirmedRole: role, confirmedName: team[role] ?? "" };
  const problem = validatePhase(phase, data);
  return (
    <Dialog open wide onClose={onClose} title={`${def.label}: ${def.when}`} subtitle="Surgical safety checklist. Read each check aloud and tick it when the team agrees."
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel={`Confirm ${def.label}`} onSave={() => report(confirmPhase(c.id, phase, data))} />}>
      <dl className="mb-3 grid gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm sm:grid-cols-2">
        <div><dt className="inline font-medium">Patient: </dt><dd className="inline">{patient}</dd></div>
        <div><dt className="inline font-medium">Operation: </dt><dd className="inline">{c.request.procedure}</dd></div>
        <div><dt className="inline font-medium">Side: </dt><dd className="inline">{c.request.side}</dd></div>
        <div><dt className="inline font-medium">Room: </dt><dd className="inline">{c.schedule?.room}</dd></div>
        <div className="sm:col-span-2"><dt className="inline font-medium">Allergies in the chart: </dt><dd className="inline">{allergyText(enc.allergies)}</dd></div>
      </dl>
      <ul className="space-y-1">
        {def.items.map((i) => (
          <li key={i.key}>
            <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted/60">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={checked.includes(i.key)}
                onChange={(e) => setChecked((x) => (e.target.checked ? [...x, i.key] : x.filter((k) => k !== i.key)))} />
              {i.label}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-x-4 gap-y-4 border-t border-border pt-4 sm:grid-cols-2">
        <Field label="Confirmed By (Role)" required>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>{def.roles.map((r) => <option key={r}>{r}</option>)}</Select>
        </Field>
        <Field label="Name" hint="From the team on the schedule."><Input readOnly disabled value={team[role] ?? ""} /></Field>
      </div>
    </Dialog>
  );
}

function OpNoteDialog({ c, onClose, report }: DialogProps) {
  const n = c.opNote;
  const [f, setF] = React.useState({
    start: n?.start ?? (c.schedule ? `${c.schedule.date}T${c.schedule.start}` : ""), end: n?.end ?? "", procedureDone: n?.procedureDone ?? c.request.procedure,
    findings: n?.findings ?? "", anaesthesia: n?.anaesthesia ?? c.assessment?.anaesthesia ?? "", bloodLoss: n?.bloodLossMl === undefined ? "" : String(n.bloodLossMl),
    specimens: n?.specimens ?? "", complications: n?.complications ?? "", plan: n?.plan ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const data = {
    start: f.start, end: f.end, procedureDone: f.procedureDone, findings: f.findings, anaesthesia: f.anaesthesia || undefined,
    bloodLossMl: f.bloodLoss === "" ? undefined : Number(f.bloodLoss), specimens: f.specimens || undefined, complications: f.complications || undefined, plan: f.plan || undefined,
  };
  const problem = validateOpNote(data);
  return (
    <Dialog open wide onClose={onClose} title="Operative Note" subtitle={`Step 8. Surgeon: ${c.request.surgeon}`}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel="Save Operative Note" onSave={() => report(saveOpNote(c.id, data))} />}>
      <RequiredNote className="mb-3" />
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="Operation Started" required hl7="encompassingEncounter/effectiveTime/low"><Input type="datetime-local" value={f.start} onChange={set("start")} /></Field>
        <Field label="Operation Ended" required hl7="encompassingEncounter/effectiveTime/high"><Input type="datetime-local" value={f.end} onChange={set("end")} /></Field>
        <Field label="Operation Done" required className="sm:col-span-2"><Input value={f.procedureDone} onChange={set("procedureDone")} /></Field>
        <Field label="Findings" required className="sm:col-span-2"><Textarea rows={3} className={textareaClass} value={f.findings} onChange={set("findings")} /></Field>
        <Field label="Anaesthesia Given">
          <Select value={f.anaesthesia} onChange={set("anaesthesia")}><option value="">Select</option>{ANAESTHESIA_TYPES.map((s) => <option key={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Estimated Blood Loss In mL"><Input type="number" min={0} value={f.bloodLoss} onChange={set("bloodLoss")} /></Field>
        <Field label="Specimens Sent"><Input value={f.specimens} onChange={set("specimens")} placeholder="Gallbladder to histology, or none" /></Field>
        <Field label="Complications"><Input value={f.complications} onChange={set("complications")} placeholder="None" /></Field>
        <Field label="Plan After The Operation" className="sm:col-span-2"><Textarea rows={2} className={textareaClass} value={f.plan} onChange={set("plan")} /></Field>
      </div>
    </Dialog>
  );
}

function RecoveryScoreDialog({ c, onClose, report }: DialogProps) {
  const [scores, setScores] = React.useState<AldreteScores>({});
  const total = aldreteTotal(scores);
  const answered = ALDRETE_ITEMS.filter((i) => scores[i.key] !== undefined).length;
  return (
    <Dialog open wide onClose={onClose} title="Recovery Score" subtitle="Aldrete score. Five items, 0 to 2 points each. The total is added for you."
      footer={<StepFooter problem={total === null ? `${ALDRETE_ITEMS.length - answered} of 5 items are not scored.` : null} onCancel={onClose} saveLabel="Save Score" onSave={() => report(addRecoveryScore(c.id, scores))} />}>
      <div className="space-y-4">
        {ALDRETE_ITEMS.map((i) => (
          <Field key={i.key} label={i.label} required>
            <Choice label={i.label} value={scores[i.key]} onChange={(v) => setScores((x) => ({ ...x, [i.key]: v }))} options={[2, 1, 0].map((n) => ({ value: n, label: `${n}: ${i.options[n]}` }))} />
          </Field>
        ))}
      </div>
      <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" role="status">
        <span className="font-semibold">Total: {total === null ? `${answered} of 5 items scored` : `${total} of 10`}</span>
        {total !== null && (total >= ALDRETE_PASS ? ". The patient can leave recovery." : `. Below ${ALDRETE_PASS}: the patient stays in recovery, unless a doctor overrides with a reason.`)}
      </p>
    </Dialog>
  );
}

function RecoveryDischargeDialog({ c, onClose, report }: DialogProps) {
  const last = c.recovery?.scores[c.recovery.scores.length - 1];
  const low = !!last && last.total < ALDRETE_PASS;
  const doctor = isDoctor();
  const [destination, setDestination] = React.useState("");
  const [reason, setReason] = React.useState("");
  const gate = recoveryDischargeGate(last?.total, low ? { reason, isDoctor: doctor } : undefined);
  const problem = !gate.ok ? gate.reason : !destination ? "Choose where the patient goes." : null;
  return (
    <Dialog open onClose={onClose} title="Discharge From Recovery" subtitle={`Last Aldrete score: ${last ? `${last.total} of 10` : "none"}. ${ALDRETE_PASS} or more is needed.`}
      footer={<StepFooter problem={problem} onCancel={onClose} saveLabel={low ? "Override And Discharge" : "Discharge From Recovery"} onSave={() => report(dischargeFromRecovery(c.id, destination, low ? reason : undefined))} />}>
      <RequiredNote className="mb-3" />
      <div className="space-y-4">
        <Field label="Patient Goes To" required>
          <Select value={destination} onChange={(e) => setDestination(e.target.value)}><option value="">Select</option>{RECOVERY_DESTINATIONS.map((d) => <option key={d}>{d}</option>)}</Select>
        </Field>
        {low && (
          <div className="rounded-lg border border-warn/50 bg-warn/10 p-3">
            <p className="mb-3 text-sm">The score is below {ALDRETE_PASS}. Only a doctor can let the patient leave, and must give a reason. The override is recorded with the doctor's name.</p>
            <Field label="Reason For The Doctor Override" required hint={doctor ? undefined : "You are not signed in as a doctor, so you cannot override."}>
              <Textarea rows={2} className={textareaClass} value={reason} disabled={!doctor} onChange={(e) => setReason(e.target.value)} placeholder="Planned transfer to intensive care on a ventilator" />
            </Field>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function CloseDialog({ c, onClose, report }: DialogProps) {
  const outcomes: { id: CloseOutcome; label: string; help: string }[] = [
    { id: "Completed", label: "Completed", help: "Every step is done and the patient has left recovery." },
    { id: "Cancelled", label: "Cancelled", help: "The operation will not happen. Only before Sign In." },
    { id: "Incomplete", label: "Incomplete", help: "The case started but was stopped before the end." },
  ];
  const firstOpen = outcomes.find((o) => closeGate(c, o.id, "x").ok)?.id;
  const [outcome, setOutcome] = React.useState<CloseOutcome | undefined>(firstOpen);
  const [reason, setReason] = React.useState("");
  const gate = outcome ? closeGate(c, outcome, reason) : { ok: false, reason: "Choose how the case ended." };
  return (
    <Dialog open onClose={onClose} title="Close Case" subtitle={c.request.procedure}
      footer={<StepFooter problem={gate.ok ? null : gate.reason} onCancel={onClose} saveLabel="Close Case" onSave={() => outcome && report(closeCase(c.id, outcome, reason))} />}>
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
    </Dialog>
  );
}

/* ---------- the stepper ---------- */

type DialogId = StepId | "new" | "recoveryDischarge";

function StepRow({ n, c, step, canWrite, open }: { n: number; c: SurgeryCase; step: (typeof STEPS)[number]; canWrite: boolean; open: (d: DialogId) => void }) {
  const done = stepDone(c, step.id);
  const isNext = currentStep(c) === step.id;
  const noRole: Gate = { ok: false, reason: "Your role cannot record surgery steps." };
  const gateOf = (id: StepId): Gate => (canWrite ? stepGate(c, id) : noRole);
  const gate = gateOf(step.id);
  const lastScore = c.recovery?.scores[c.recovery.scores.length - 1];

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
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open("assessment")}>Record Assessment</GateButton>;
      else if (gate.ok) actions = <GateButton primary={!fitForSurgery(c.assessment?.result)} gate={gate} onClick={() => open("assessment")}>Assess Again</GateButton>;
      break;
    case "schedule":
      stamp = c.schedule?.done;
      summary = c.schedule && <>{c.schedule.room} · {c.schedule.date}, {c.schedule.start} to {scheduleEnd(c.schedule)} · Anaesthetist {c.schedule.anaesthetist} · Scrub nurse {c.schedule.scrubNurse} · Circulating nurse {c.schedule.circulatingNurse}</>;
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open("schedule")}>Schedule Case</GateButton>;
      else if (gate.ok) actions = <GateButton gate={gate} onClick={() => open("schedule")}>Change Schedule</GateButton>;
      break;
    case "preop": {
      stamp = c.preop?.done;
      const left = preOpMissing(c.preop?.answers, c.request.side).length;
      summary = c.preop && <>{PREOP_ITEMS.length - left} of {PREOP_ITEMS.length} items answered{left ? `. Still open: ${preOpMissing(c.preop.answers, c.request.side).map((i) => i.label).join("; ")}` : ""}</>;
      if (!done || gate.ok) actions = <GateButton primary={!done} gate={gate} onClick={() => open("preop")}>{done ? "Change Checklist" : c.preop ? "Continue Checklist" : "Start Checklist"}</GateButton>;
      break;
    }
    case "signIn":
    case "timeOut":
    case "signOut": {
      const p = c[step.id];
      stamp = p?.done;
      summary = p && <>All {p.checked.length} checks done. Confirmed by {p.confirmedRole}: {p.confirmedName}</>;
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open(step.id)}>Start {step.label}</GateButton>;
      break;
    }
    case "opNote":
      stamp = c.opNote?.done;
      summary = c.opNote && <>{c.opNote.procedureDone} · {whenLocal(c.opNote.start)} to {whenLocal(c.opNote.end)}{c.opNote.bloodLossMl !== undefined ? ` · Blood loss ${c.opNote.bloodLossMl} mL` : ""}</>;
      if (!done) actions = <GateButton primary gate={gate} onClick={() => open("opNote")}>Write Operative Note</GateButton>;
      else if (gate.ok) actions = <GateButton gate={gate} onClick={() => open("opNote")}>Change Operative Note</GateButton>;
      break;
    case "recovery": {
      stamp = c.recovery?.discharge?.done;
      const d = c.recovery?.discharge;
      summary = c.recovery && (
        <span className="block space-y-1">
          {c.recovery.scores.map((s, i) => (
            <span key={i} className="flex flex-wrap items-center gap-2">
              <Badge tone={s.total >= ALDRETE_PASS ? "ok" : "warn"}>Aldrete {s.total} of 10</Badge>
              <span className="text-xs text-muted-foreground">{s.stamp.by} on {whenIso(s.stamp.at)}</span>
            </span>
          ))}
          {d && <span className="block">Left recovery for {d.destination} with a score of {d.score}.{d.override ? ` Doctor override by ${d.override.doctor}: ${d.override.reason}` : ""}</span>}
        </span>
      );
      if (!done) {
        const leave: Gate = !gate.ok ? gate : !lastScore ? recoveryDischargeGate(undefined) : lastScore.total >= ALDRETE_PASS || isDoctor() ? { ok: true, reason: "" } : recoveryDischargeGate(lastScore.total);
        actions = (
          <>
            <GateButton primary={!lastScore || lastScore.total < ALDRETE_PASS} gate={gate} onClick={() => open("recovery")}>{lastScore ? "Score Again" : "Record Recovery Score"}</GateButton>
            <GateButton primary={!!lastScore && lastScore.total >= ALDRETE_PASS} gate={leave} onClick={() => open("recoveryDischarge")}>
              {lastScore && lastScore.total < ALDRETE_PASS ? "Override And Discharge" : "Discharge From Recovery"}
            </GateButton>
          </>
        );
      }
      break;
    }
    case "close":
      stamp = c.closed?.done;
      summary = c.closed && <>{c.closed.outcome}{c.closed.reason ? `: ${c.closed.reason}` : ""}</>;
      if (!done) actions = <GateButton primary={isNext} gate={canWrite ? { ok: true, reason: "" } : noRole} onClick={() => open("close")}>{isNext ? "Close Case" : "Cancel Or Close Case"}</GateButton>;
      break;
  }

  const state = done ? "Done" : c.closed ? "Not Done" : isNext ? "Next" : "Waiting";
  const Icon = done ? CheckCircle2 : isNext ? CircleDot : Circle;
  return (
    <li className={cn("grid gap-x-4 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto]", isNext && "bg-move/5")} aria-current={isNext ? "step" : undefined}>
      <div className="flex min-w-0 gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", done ? "text-ok" : isNext ? "text-move" : "text-muted-foreground")} aria-hidden="true" />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{n}. {step.label}</h3>
            {step.when && <span className="text-xs text-muted-foreground">{step.when}</span>}
            <Badge tone={done ? "ok" : state === "Next" ? "info" : "neutral"}>{state}</Badge>
          </div>
          {summary && <div className="text-sm">{summary}</div>}
          {stamp && <Signed stamp={stamp} verb={step.id === "request" ? "Requested" : step.id === "close" ? "Closed" : "Completed"} />}
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
  const props = c ? { c, enc, onClose: close, report } : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Surgery Case"
          subtitle="From the request to the closed case. Each step opens when the one before it is done."
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
                {!c.closed && <span className="text-sm">Next: <span className="font-medium">{nextAction(c)}</span></span>}
              </div>
            </div>
            <ol className="divide-y divide-border" aria-label="Surgery steps">
              {STEPS.map((s, i) => <StepRow key={s.id} n={i + 1} c={c} step={s} canWrite={canWrite} open={setDialog} />)}
            </ol>
          </>
        )}
      </Card>

      {c && readyForOperativeNote(c) && (
        <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
          <FileText className="size-5 shrink-0 text-move" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm">
            The operation start and end times are recorded. The Operative Note can now be created and published to NPHIES from Clinical Documents.
            {dev && <span className="text-muted-foreground"> The document reads the times from the linked Operation Request record.</span>}
          </p>
          <Button onClick={() => navigate("/chart", { visit: enc.visitNumber, s: "documents" })}>Open Clinical Documents</Button>
        </Card>
      )}

      {dialog === "new" && <RequestDialog enc={enc} onClose={close} report={report} />}
      {props && dialog === "assessment" && <AssessmentDialog {...props} />}
      {props && dialog === "schedule" && <ScheduleDialog {...props} />}
      {props && dialog === "preop" && <PreOpDialog {...props} />}
      {props && (dialog === "signIn" || dialog === "timeOut" || dialog === "signOut") && <PhaseDialog {...props} phase={dialog} patient={patientName(patient)} />}
      {props && dialog === "opNote" && <OpNoteDialog {...props} />}
      {props && dialog === "recovery" && <RecoveryScoreDialog {...props} />}
      {props && dialog === "recoveryDischarge" && <RecoveryDischargeDialog {...props} />}
      {props && dialog === "close" && <CloseDialog {...props} />}
    </div>
  );
}
