import * as React from "react";
import { AlertTriangle, CheckCircle2, Circle, Play, RotateCcw, StepForward } from "lucide-react";
import { EventBadge } from "@/components/badges";
import { ChecksList } from "@/components/MessagePanel";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, PageHeader, cn } from "@/components/ui/primitives";
import { pretty } from "@/lib/hl7";
import type { LogEntry, ScenarioForm } from "@/lib/model";
import { DX_SAMPLES, PR_SAMPLES } from "@/lib/reference-data";
import { EVENT_BY_ID, eventLabel, type EventId } from "@/lib/spec";
import {
  addPatient, emptyForm, firstFreeBed, formFromEncounter, getState, nowLocal, send, useHis,
} from "@/lib/store";
import type { HisState } from "@/lib/model";

interface Ctx {
  pid: string;
  pid2?: string;
  visit?: string;
}

interface Step {
  event: EventId;
  note: string;
  build: (s: HisState, c: Ctx) => ScenarioForm;
  /** Update the context after the step ran. */
  after?: (c: Ctx, f: ScenarioForm) => void;
}

interface Flow {
  id: string;
  title: string;
  summary: string;
  patients: 1 | 2;
  steps: Step[];
}

const visitOf = (s: HisState, c: Ctx) => s.encounters.find((e) => e.visitNumber === c.visit)!;

const newVisit = (event: EventId, patch: (f: ScenarioForm, s: HisState) => void = () => {}) => (s: HisState, c: Ctx) => {
  const f = emptyForm(s, event);
  f.patientId = c.pid;
  patch(f, s);
  return f;
};

const onVisit = (event: EventId, patch: (f: ScenarioForm, s: HisState) => void = () => {}) => (s: HisState, c: Ctx) => {
  const f = formFromEncounter(s, event, visitOf(s, c), emptyForm(s, event));
  patch(f, s);
  return f;
};

const remember = (c: Ctx, f: ScenarioForm) => {
  c.visit = f.encounterId || f.visitNumber;
};

const FLOWS: Flow[] = [
  {
    id: "planned-stay",
    title: "Planned Inpatient Stay",
    summary: "Pre-admit, admit, move, discharge, then reverse the discharge.",
    patients: 1,
    steps: [
      { event: "A05", note: "Staff enter pre-admission data with an expected admit date.", build: newVisit("A05", (f) => { f.expectedAdmitAt = nowLocal(60 * 24); f.reason = "Planned surgery"; f.dx = [{ ...DX_SAMPLES[2], type: "W" }]; }), after: remember },
      { event: "A01", note: "The patient arrives. Admission starts from the pre-admit and a bed is assigned.", build: onVisit("A01", (f, s) => { f.cls = "I"; f.bedId = firstFreeBed(s); f.admitAt = nowLocal(); f.expectedAdmitAt = ""; }) },
      { event: "A02", note: "The patient moves to another bed.", build: onVisit("A02", (f, s) => { f.bedId = firstFreeBed(s, f.bedId); }) },
      { event: "A03", note: "The physician enters the discharge order. DG1 is required.", build: onVisit("A03", (f) => { f.pr = [{ ...PR_SAMPLES[0] }]; }) },
      { event: "A13", note: "The discharge was a mistake. It is reversed and the patient is an inpatient again.", build: onVisit("A13", (f, s) => { f.bedId = firstFreeBed(s); }) },
      { event: "A03", note: "The patient is discharged again, correctly this time.", build: onVisit("A03") },
    ],
  },
  {
    id: "op-to-ip",
    title: "Outpatient To Inpatient And Back",
    summary: "Register, admit, then change back to outpatient.",
    patients: 1,
    steps: [
      { event: "A04", note: "The front desk registers a same-day visit.", build: newVisit("A04", (f) => { f.cls = "O"; f.service = "RAD"; f.attending = "D1004"; f.reason = "Imaging"; }), after: remember },
      { event: "A06", note: "The clinician decides to admit. The class changes to inpatient.", build: onVisit("A06", (f, s) => { f.bedId = firstFreeBed(s); f.dx = [{ ...DX_SAMPLES[0] }]; }) },
      { event: "A07", note: "After reassessment the patient is changed back to outpatient.", build: onVisit("A07") },
      { event: "A03", note: "The outpatient visit ends.", build: onVisit("A03", (f) => { f.dx = [{ ...DX_SAMPLES[0], type: "F" }]; }) },
    ],
  },
  {
    id: "cancel-admit",
    title: "Admit Sent In Error",
    summary: "Admit a patient, then cancel the admission.",
    patients: 1,
    steps: [
      { event: "A01", note: "An admission is sent.", build: newVisit("A01", (f, s) => { f.bedId = firstFreeBed(s); }), after: remember },
      { event: "A11", note: "The admission was wrong. Staff cancel it and the bed is freed.", build: onVisit("A11") },
    ],
  },
  {
    id: "cancel-transfer",
    title: "Wrong Transfer",
    summary: "Admit, move, cancel the move, then discharge.",
    patients: 1,
    steps: [
      { event: "A01", note: "An admission is sent.", build: newVisit("A01", (f, s) => { f.bedId = firstFreeBed(s); f.dx = [{ ...DX_SAMPLES[1] }]; }), after: remember },
      { event: "A02", note: "The patient is moved to another bed.", build: onVisit("A02", (f, s) => { f.bedId = firstFreeBed(s, f.bedId); }) },
      { event: "A12", note: "The move was wrong. The patient goes back to the prior bed. PV1-6 holds the wrong location.", build: onVisit("A12") },
      { event: "A03", note: "The patient is discharged.", build: onVisit("A03") },
    ],
  },
  {
    id: "cancel-preadmit",
    title: "Pre-Admit Cancelled",
    summary: "Pre-admit a patient, then delete the pre-admission.",
    patients: 1,
    steps: [
      { event: "A05", note: "Staff enter a pre-admission.", build: newVisit("A05", (f) => { f.expectedAdmitAt = nowLocal(60 * 48); f.reason = "Planned stay"; }), after: remember },
      { event: "A38", note: "The pre-admission was made in error. It is removed.", build: onVisit("A38") },
    ],
  },
  {
    id: "updates",
    title: "Updates, Identity And CNHI Discharge",
    summary: "Admit, update data, change identity, discharge, then send the CNHI A08.",
    patients: 1,
    steps: [
      { event: "A01", note: "An admission is sent.", build: newVisit("A01", (f, s) => { f.bedId = firstFreeBed(s); }), after: remember },
      { event: "A08", note: "Staff add a diagnosis and a procedure.", build: onVisit("A08", (f) => { f.dx = [{ ...DX_SAMPLES[3] }]; f.pr = [{ ...PR_SAMPLES[3] }]; }) },
      { event: "A31", note: "The master record changes the family name.", build: onVisit("A31", (f) => { f.family = `${f.family}-Updated`; }) },
      { event: "A03", note: "The patient is discharged.", build: onVisit("A03") },
      { event: "A08-CNHI", note: "After discharge, the customised A08 with the Z-segments is sent for CNHI reporting.", build: onVisit("A08-CNHI", (f) => { f.z = { ZPV1: ["CNHI_1", "", ""], ZDG1: ["CNHI_2", "", ""], ZPR1: ["CNHI_3", "", ""] }; }) },
    ],
  },
  {
    id: "move-visit",
    title: "Visit On The Wrong Person",
    summary: "A visit is on the wrong patient. HIM moves it to the right one (A45).",
    patients: 2,
    steps: [
      { event: "A04", note: "A visit is registered on the wrong patient.", build: newVisit("A04"), after: remember },
      { event: "A45", note: "HIM moves the visit. PID is the right patient. The MERGE_INFO group has MRG then PV1.", build: (s, c) => { const f = onVisit("A45")(s, c); f.correctPatientId = c.pid2!; return f; } },
    ],
  },
  {
    id: "change-visit",
    title: "Change The Visit Number",
    summary: "Admit, then change the visit number (A50).",
    patients: 1,
    steps: [
      { event: "A01", note: "An admission is sent.", build: newVisit("A01", (f, s) => { f.bedId = firstFreeBed(s); }), after: remember },
      { event: "A50", note: "The visit number changes. MRG-5 holds the old number and PV1-19 the new one.", build: onVisit("A50"), after: (c, f) => { c.visit = f.newVisitNumber; } },
    ],
  },
];

type StepResult = { entry: LogEntry } | null;

export function RunnerPage() {
  const state = useHis();
  const [flowId, setFlowId] = React.useState(FLOWS[0].id);
  const flow = FLOWS.find((f) => f.id === flowId)!;
  const [ctx, setCtx] = React.useState<Ctx | null>(null);
  const [results, setResults] = React.useState<StepResult[]>([]);
  const [open, setOpen] = React.useState<number | null>(null);

  function pickFlow(id: string) {
    setFlowId(id);
    setCtx(null);
    setResults([]);
    setOpen(null);
  }

  function runStep(i: number, c: Ctx | null, res: StepResult[]): { ctx: Ctx; results: StepResult[] } {
    // Fresh patients are made the first time a flow runs.
    let context = c;
    if (!context) {
      const p = addPatient();
      const p2 = flow.patients === 2 ? addPatient() : undefined;
      context = { pid: p.id, pid2: p2?.id };
    }
    // New visits for A45 are on the first patient (the "wrong" one). Keep the order stable.
    const step = flow.steps[i];
    const s = getState();
    const form = step.build(s, context);
    const entry = send(step.event, form, { source: "runner" });
    step.after?.(context, form);
    // Steps that start from "after" may skip when visit not set (A01 from build sets visit via remember).
    const next = [...res];
    next[i] = { entry };
    return { ctx: { ...context }, results: next };
  }

  const done = results.filter(Boolean).length;
  const finished = done === flow.steps.length;

  function runNext() {
    const r = runStep(done, ctx, results);
    setCtx(r.ctx);
    setResults(r.results);
    setOpen(done);
  }

  function runAll() {
    let c = ctx;
    let res = results;
    for (let i = done; i < flow.steps.length; i++) {
      const r = runStep(i, c, res);
      c = r.ctx;
      res = r.results;
    }
    setCtx(c);
    setResults(res);
    setOpen(null);
  }

  const totalErrors = results.reduce((n, r) => n + (r?.entry.errors ?? 0), 0);
  const patientLabel = ctx ? state.patients.find((p) => p.id === ctx.pid) : undefined;

  return (
    <div>
      <PageHeader
        title="Scenario Runner"
        subtitle="Walk a full flow, one message at a time or all at once. Each flow uses new made-up patients, so you can run it as often as you like. Every message goes to the log."
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Flows" subtitle={`${FLOWS.length} flows cover all ${new Set(FLOWS.flatMap((f) => f.steps.map((s) => s.event))).size} events`} />
          <ul>
            {FLOWS.map((f) => (
              <li key={f.id}>
                <button
                  onClick={() => pickFlow(f.id)}
                  className={cn(
                    "w-full border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    f.id === flowId && "bg-accent/40",
                  )}
                >
                  <div className="text-sm font-medium">{f.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{f.summary}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {f.steps.map((s, i) => (
                      <EventBadge key={i} id={s.event} />
                    ))}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title={flow.title}
            subtitle={patientLabel ? `Patient: ${patientLabel.given} ${patientLabel.family} (${patientLabel.mrn})` : flow.summary}
            right={
              <div className="flex flex-wrap gap-1.5">
                <Button variant="primary" onClick={runNext} disabled={finished}>
                  <StepForward className="size-4" />
                  Run Next Step
                </Button>
                <Button onClick={runAll} disabled={finished}>
                  <Play className="size-4" />
                  Run All Steps
                </Button>
                <Button variant="ghost" onClick={() => pickFlow(flow.id)} disabled={done === 0}>
                  <RotateCcw className="size-4" />
                  Start Over
                </Button>
              </div>
            }
          />
          {done > 0 && (
            <div className="border-b border-border px-4 py-2 text-sm">
              {finished ? "Flow finished. " : `${done} of ${flow.steps.length} steps done. `}
              {totalErrors ? <Badge tone="danger">{totalErrors} errors in total</Badge> : <Badge tone="ok">No errors</Badge>}
            </div>
          )}
          <ol className="p-2">
            {flow.steps.map((step, i) => {
              const r = results[i];
              const isNext = i === done;
              return (
                <li key={i} className="rounded-lg">
                  <button
                    onClick={() => r && setOpen(open === i ? null : i)}
                    disabled={!r}
                    className={cn("flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left", r && "hover:bg-muted/50", isNext && !r && "bg-accent/30")}
                  >
                    <span className="mt-0.5">
                      {!r ? <Circle className="size-5 text-muted-foreground" /> : r.entry.errors ? <AlertTriangle className="size-5 text-destructive" /> : <CheckCircle2 className="size-5 text-ok" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <EventBadge id={step.event} />
                        <span className="text-sm font-medium">{EVENT_BY_ID[step.event].name}</span>
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{step.note}</span>
                    </span>
                    {r && <span className="font-mono text-xs text-muted-foreground">{r.entry.controlId}</span>}
                  </button>
                  {r && open === i && (
                    <div className="space-y-3 px-3 pb-4 pl-11">
                      <CodeBlock filename={`${r.entry.controlId}_${r.entry.trigger}.hl7`} code={pretty(r.entry.message)} />
                      <ChecksList checks={r.entry.checks} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
