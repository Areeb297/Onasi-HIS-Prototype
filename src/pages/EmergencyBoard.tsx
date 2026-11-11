import * as React from "react";
import { IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { AlertTriangle, Clock, FolderOpen, Plus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { useVisitActions } from "@/components/VisitActions";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Card, Field, Input, PageHeader, Select, cn } from "@/components/ui/primitives";
import { quickSend } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import {
  AREAS, ARRIVAL_MODES, CTAS, DISPOSITIONS, DISPOSITION_CODE, DISPOSITION_EVENT, STAGES, clockOf, ctasInfo, defaultArea,
  doorToDoctor, saveTriage, setDisposition, setStage, stageOf, startTreatment, suggestCtas, type EdStage,
} from "@/lib/ed";
import type { CtasLevel, EdData, Encounter } from "@/lib/model";
import { COMPLAINT_SAMPLES, DOCTORS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { can, currentUser, hasGlass, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { recordFromTriage } from "@/lib/vitals";
import { WorklistPage } from "@/pages/WorklistPage";

function useNow(ms: number) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const age = (dob: string) => Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));

function CtasBadge({ level, size = "md" }: { level?: CtasLevel; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "size-10 text-lg" : "size-7 text-sm";
  if (!level) return <span className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border font-semibold text-muted-foreground", dim)} title="Not triaged">?</span>;
  const info = ctasInfo(level);
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-white dark:text-[#0b1f23]", info.bg, dim, level === 3 && "text-[#1a1a1a] dark:text-[#1a1a1a]")} title={`CTAS ${level}, ${info.label}`} aria-label={`CTAS ${level}, ${info.label}`}>
      {level}
    </span>
  );
}

/* ---------- triage sheet ---------- */

function TriageSheet({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const ed = enc.ed!;
  const [ctas, setCtas] = React.useState<CtasLevel | undefined>(ed.ctas);
  const [mode, setMode] = React.useState<EdData["arrivalMode"]>(ed.arrivalMode);
  const [complaint, setComplaint] = React.useState(ed.complaint ?? enc.reason ?? "");
  const [bp, setBp] = React.useState(enc.vitals?.bp ?? "");
  const [hr, setHr] = React.useState(enc.vitals?.pulse ?? "");
  const [rr, setRr] = React.useState(enc.vitals?.rr ?? "");
  const [temp, setTemp] = React.useState(enc.vitals?.temp ?? "");
  const [spo2, setSpo2] = React.useState(enc.vitals?.spo2 ?? "");
  const [gcs, setGcs] = React.useState(ed.gcs !== undefined ? String(ed.gcs) : "");
  const [pain, setPain] = React.useState(ed.pain !== undefined ? String(ed.pain) : "");
  const [area, setArea] = React.useState<NonNullable<EdData["area"]>>(ed.area ?? "Triage");

  const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));
  const hint = suggestCtas({ spo2: num(spo2), sbp: num(bp.split("/")[0]), hr: num(hr), rr: num(rr), gcs: num(gcs), pain: num(pain), temp: num(temp) });
  const tooLow = hint && ctas && ctas > hint.level;

  function save() {
    saveTriage(enc.visitNumber, { ctas, arrivalMode: mode, complaint, gcs: num(gcs), pain: num(pain), area, triageNurse: currentUser().name }, { bp, pulse: hr, temp, spo2, rr });
    audit("update", `Triage CTAS ${ctas}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}` });
    recordFromTriage(enc.visitNumber, { bp, pulse: hr, temp, spo2, rr });
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Triage</SheetTitle>
          <SheetDescription>Pick the CTAS level. The clock for the doctor starts when you save.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">CTAS level</div>
            <div className="grid gap-2" role="radiogroup" aria-label="CTAS level">
              {CTAS.map((c) => {
                const on = ctas === c.level;
                return (
                  <button key={c.level} role="radio" aria-checked={on} onClick={() => { setCtas(c.level); if (area === "Triage") setArea(defaultArea(c.level)); }}
                    className={cn("flex items-center gap-3 rounded-lg border-2 px-3 py-2 text-left transition-colors", on ? `${c.ring} bg-muted` : "border-border hover:bg-muted/60")}>
                    <CtasBadge level={c.level} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{c.label}</span>
                      <span className="block text-xs text-muted-foreground">{c.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {hint && (
              <p className={cn("mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs", tooLow ? "border-destructive/50 bg-destructive/10" : "border-warn/40 bg-warn/10")}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>Consider CTAS {hint.level} or higher: {hint.why}. This is an aid only. The triage nurse decides.</span>
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Arrival mode" hl7="ZPV1-18">
              <Select value={mode} onChange={(e) => setMode(e.target.value as EdData["arrivalMode"])}>{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
            <Field label="Area">
              <Select value={area} onChange={(e) => setArea(e.target.value as NonNullable<EdData["area"]>)}>{AREAS.map((a) => <option key={a}>{a}</option>)}</Select>
            </Field>
            <Field label="Chief complaint" className="sm:col-span-2" hl7="PV2-3">
              <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Type or tap one below" />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setComplaint(c.text)} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent">{c.text}</button>)}
              </div>
            </Field>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Vital signs</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="BP (mmHg)"><Input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="120/80" /></Field>
              <Field label="Heart rate"><Input value={hr} onChange={(e) => setHr(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Resp rate"><Input value={rr} onChange={(e) => setRr(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Temp (°C)"><Input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" /></Field>
              <Field label="SpO2 (%)"><Input value={spo2} onChange={(e) => setSpo2(e.target.value)} inputMode="numeric" /></Field>
              <Field label="GCS (3 to 15)"><Input value={gcs} onChange={(e) => setGcs(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Pain (0 to 10)"><Input value={pain} onChange={(e) => setPain(e.target.value)} inputMode="numeric" /></Field>
            </div>
          </div>
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ctas} onClick={save}>Save Triage</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- disposition ---------- */

function DispositionDialog({ enc, onClose, onDone }: { enc: Encounter; onClose: () => void; onDone: (d: NonNullable<EdData["disposition"]>) => void }) {
  const [d, setD] = React.useState<NonNullable<EdData["disposition"]>>("Discharged");
  const dev = useDevMode();
  return (
    <Dialog open onClose={onClose} title="ED Disposition" subtitle={dev ? "Goes in ZPV1-20. Admit sends A06 and picks a bed. Every other choice sends A03." : "How does this emergency visit end?"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onDone(d)}>{d === "Admitted" ? "Choose A Bed" : "Complete Visit"}</Button></>}>
      <div className="grid gap-2" role="radiogroup" aria-label="Disposition">
        {DISPOSITIONS.map((x) => (
          <button key={x} role="radio" aria-checked={d === x} onClick={() => setD(x)} className={cn("rounded-lg border px-3 py-2 text-left text-sm", d === x ? "border-admit bg-admit/10 font-medium" : "border-border hover:bg-muted")}>
            {x}
            {dev && <span className="ms-2 font-mono text-xs text-muted-foreground">{DISPOSITION_EVENT[x]}</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ---------- cards ---------- */

function Card1({ enc, now, onTriage, onDispose, onChart }: { enc: Encounter; now: number; onTriage: () => void; onDispose: () => void; onChart: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const ed = enc.ed!;
  const stage = stageOf(ed);
  const p = state.patients.find((x) => x.id === enc.patientId);
  const clock = clockOf(ed, now);
  const info = ed.ctas ? ctasInfo(ed.ctas) : undefined;
  const allergic = enc.allergies.length > 0;
  const masked = !!p?.confidential && !hasGlass(p.id);
  const canWrite = can("emr.write");
  const v = enc.vitals;
  const flags: string[] = [];
  if (v && parseFloat(v.spo2) < 94) flags.push(`SpO2 ${v.spo2}`);
  if (v && parseFloat(v.temp) >= 38) flags.push(`Temp ${v.temp}`);
  if (v && parseFloat(v.pulse) > 100) flags.push(`HR ${v.pulse}`);
  const edFields = [ed.arrivalAt, ed.arrivalMode, ed.seenAt, ed.disposition, ed.triageAt, ed.ctas].filter((x) => x !== undefined).length;

  return (
    <div className={cn("rounded-lg border border-border border-l-4 bg-card p-3 shadow-sm", info ? info.ring : "border-l-border")}>
      <div className="flex items-start gap-2.5">
        <CtasBadge level={ed.ctas} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button onClick={onChart} className="truncate text-sm font-semibold text-move hover:underline">{masked ? "Confidential patient" : patientName(p)}</button>
            <span title={allergic ? `Allergies: ${enc.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"} className={allergic ? "text-destructive" : "text-ok"}>
              {allergic ? <IconShieldExclamation className="size-4" stroke={1.75} /> : <IconShieldCheck className="size-4" stroke={1.75} />}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{p && !masked ? `${age(p.dob)} y, ${p.sex === "M" ? "Male" : "Female"}` : ""} {ed.arrivalMode !== "Walk-in" && <Badge tone="info">{ed.arrivalMode}</Badge>}</div>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{masked ? "Restricted" : ed.complaint || enc.reason || "No complaint entered"}</p>
      {flags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{flags.map((f) => <Badge key={f} tone="danger">{f}</Badge>)}</div>}
      <div className={cn("mt-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium", clock.overdue ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground")}>
        <Clock className="size-3.5" />{clock.text}
        {stage === "waiting-doctor" && info && info.targetMin > 0 && <span className="ms-auto font-normal">target {info.targetMin} min</span>}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{ed.area ?? "Triage"}</span>
        {doorToDoctor(ed) !== undefined && <span>Door to doctor {doorToDoctor(ed)} min</span>}
      </div>
      {dev && <div className="mt-1 text-xs text-update">ZPV1 ED fields: {edFields} of 6</div>}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {stage === "waiting-triage" && <Button size="sm" variant="primary" disabled={!canWrite} onClick={onTriage}>Triage</Button>}
        {stage === "waiting-doctor" && (
          <>
            <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => startTreatment(enc.visitNumber, defaultArea(ed.ctas ?? 3), DOCTORS[0].id)}>Start Treatment</Button>
            <Button size="sm" disabled={!canWrite} onClick={onTriage}>Re-Triage</Button>
          </>
        )}
        {stage === "treatment" && (
          <>
            <Button size="sm" disabled={!canWrite} onClick={() => setStage(enc.visitNumber, "results")}>Awaiting Results</Button>
            <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => setStage(enc.visitNumber, "ready")}>Ready For Disposition</Button>
          </>
        )}
        {stage === "results" && (
          <>
            <Button size="sm" disabled={!canWrite} onClick={() => setStage(enc.visitNumber, "treatment")}>Back To Treatment</Button>
            <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => setStage(enc.visitNumber, "ready")}>Ready For Disposition</Button>
          </>
        )}
        {stage === "ready" && <Button size="sm" variant="primary" disabled={!can("adt.send")} onClick={onDispose}>Disposition</Button>}
        <Button size="sm" variant="ghost" onClick={onChart} aria-label="Open chart" title="Open Chart"><FolderOpen className="size-4" /></Button>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export function EmergencyBoard() {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const { act, dialogs } = useVisitActions();
  const now = useNow(30_000);
  const [view, setView] = React.useState<"board" | "list">("board");
  const [triage, setTriage] = React.useState<string | null>(null);
  const [dispose, setDispose] = React.useState<string | null>(null);

  const active = state.encounters.filter((e) => e.cls === "E" && e.status === "active" && e.ed);
  const byStage = (s: EdStage) =>
    active
      .filter((e) => stageOf(e.ed!) === s)
      .sort((a, b) => (a.ed!.ctas ?? 0) - (b.ed!.ctas ?? 0) || a.ed!.arrivalAt.localeCompare(b.ed!.arrivalAt));

  const overdue = active.filter((e) => clockOf(e.ed!, now).overdue && stageOf(e.ed!) !== "treatment");
  const seenToday = state.encounters.filter((e) => e.cls === "E" && e.ed?.seenAt && now - new Date(e.ed.arrivalAt).getTime() < 24 * 3600_000);
  const d2d = seenToday.map((e) => doorToDoctor(e.ed!)).filter((x): x is number => x !== undefined);
  const avgD2d = d2d.length ? Math.round(d2d.reduce((a, b) => a + b, 0) / d2d.length) : undefined;
  const longest = active.reduce((m, e) => Math.max(m, clockOf(e.ed!, now).waited), 0);
  const triageEnc = triage ? state.encounters.find((e) => e.visitNumber === triage) : undefined;
  const disposeEnc = dispose ? state.encounters.find((e) => e.visitNumber === dispose) : undefined;

  function complete(enc: Encounter, d: NonNullable<EdData["disposition"]>) {
    setDispose(null);
    setDisposition(enc.visitNumber, d);
    if (DISPOSITION_EVENT[d] === "A06") {
      act("A06", enc.visitNumber);
    } else if (enc.dx.length > 0) {
      quickSend("A03", enc.visitNumber, (f) => { f.disposition = DISPOSITION_CODE[d]; });
    } else {
      act("A03", enc.visitNumber); // asks for a diagnosis first, A03 needs DG1
    }
  }

  return (
    <div>
      <PageHeader
        title="Emergency Department"
        subtitle="Triage board by CTAS level. Patients wait against the CTAS time to see a doctor. Red clocks are over target."
        right={
          <div className="flex gap-2">
            <div role="group" aria-label="View" className="flex rounded-md border border-border bg-muted p-0.5">
              {(["board", "list"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={cn("rounded px-3 py-1 text-xs font-medium", view === v ? "bg-card shadow-sm" : "text-muted-foreground")}>{v === "board" ? "Board" : "List"}</button>
              ))}
            </div>
            <Button variant="primary" disabled={!can("patient.register")} onClick={() => navigate("/registration", { cls: "E" })}><Plus className="size-4" />Register Emergency Patient</Button>
          </div>
        }
      />

      {/* Level strip */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-8">
        {CTAS.map((c) => {
          const n = active.filter((e) => e.ed!.ctas === c.level).length;
          const late = active.filter((e) => e.ed!.ctas === c.level && clockOf(e.ed!, now).overdue && stageOf(e.ed!) === "waiting-doctor").length;
          return (
            <div key={c.level} className={cn("rounded-xl border border-border border-t-4 bg-card px-3 py-2", c.ring)}>
              <div className="flex items-center gap-2"><CtasBadge level={c.level} /><span className="text-2xl font-semibold tabular-nums">{n}</span></div>
              <div className="mt-0.5 text-xs font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.targetMin === 0 ? "Immediate" : `Target ${c.targetMin} min`}{late > 0 && <span className="ms-1 font-semibold text-destructive">{late} late</span>}</div>
            </div>
          );
        })}
        <div className="rounded-xl border border-border border-t-4 border-t-ctas-5 bg-card px-3 py-2"><div className="text-2xl font-semibold tabular-nums">{byStage("waiting-triage").length}</div><div className="mt-0.5 text-xs font-medium">Not Triaged</div><div className="text-xs text-muted-foreground">Target 10 min</div></div>
        <div className="rounded-xl border border-border border-t-4 border-t-update bg-card px-3 py-2"><div className="text-2xl font-semibold tabular-nums">{avgD2d ?? "None"}</div><div className="mt-0.5 text-xs font-medium">Door To Doctor</div><div className="text-xs text-muted-foreground">Average minutes today</div></div>
        <div className="rounded-xl border border-border border-t-4 border-t-destructive bg-card px-3 py-2"><div className="text-2xl font-semibold tabular-nums">{overdue.length}</div><div className="mt-0.5 text-xs font-medium">Over Target</div><div className="text-xs text-muted-foreground">Longest wait {longest} min</div></div>
      </div>

      {view === "list" ? (
        <WorklistPage mode="er" embedded />
      ) : (
        <div className="grid gap-3 lg:grid-cols-5">
          {STAGES.map((s) => {
            const items = byStage(s.id);
            return (
              <section key={s.id} aria-label={s.label} className="min-w-0 rounded-xl border border-border bg-muted/30 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold text-muted-foreground">{s.label}<Badge tone="neutral">{items.length}</Badge></h2>
                <div className="space-y-2">
                  {items.length === 0 && <p className="px-1 py-6 text-center text-xs text-muted-foreground">No patients</p>}
                  {items.map((e) => (
                    <Card1 key={e.visitNumber} enc={e} now={now} onTriage={() => setTriage(e.visitNumber)} onDispose={() => setDispose(e.visitNumber)} onChart={() => navigate("/chart", { visit: e.visitNumber })} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {dev && <p className="mt-4 text-xs text-muted-foreground">Assumptions: CTAS time targets are the standard published ones. The ED codes sent in ZPV1-18, 20 and 22 are placeholders, because the value sets (CS-Adm-EDArrivalMode, CS-Adm-EDDisposition, CS-Adm-TriageCategory) are not in the guide pages read. ZPV1-17 to 22 go out in the CNHI discharge update (A08).</p>}
      {triageEnc && <TriageSheet enc={triageEnc} onClose={() => setTriage(null)} />}
      {disposeEnc && <DispositionDialog enc={disposeEnc} onClose={() => setDispose(null)} onDone={(d) => complete(disposeEnc, d)} />}
      {dialogs}
    </div>
  );
}
