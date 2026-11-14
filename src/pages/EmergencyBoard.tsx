import { PatientFlagBadges } from "@/components/PatientBanner";
import * as React from "react";
import { IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { Clock, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { useVisitActions } from "@/components/VisitActions";
import { LevelDot, TriageSheet } from "@/components/TriageSheet";
import { Badge, Button, PageHeader, cn } from "@/components/ui/primitives";
import { quickSend } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import {
  CTAS, DISPOSITIONS, DISPOSITION_CODE, DISPOSITION_EVENT, STAGES, clockOf, ctasInfo, defaultArea,
  doorToDoctor, fractiles, reassess, reassessOf, setDisposition, setStage, stageOf, startTreatment, type EdStage,
} from "@/lib/ed";
import type { EdData, Encounter } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { navigate, useRoute } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
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
  const re = reassessOf(ed, now);
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
        <LevelDot level={ed.ctas} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button onClick={onChart} className="truncate text-sm font-semibold text-move hover:underline">{masked ? "Confidential patient" : patientName(p)}</button>
            <span title={allergic ? `Allergies: ${enc.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"} className={allergic ? "text-destructive" : "text-ok"}>
              {allergic ? <IconShieldExclamation className="size-4" stroke={1.75} /> : <IconShieldCheck className="size-4" stroke={1.75} />}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{p && !masked ? `${age(p.dob)} y, ${p.sex === "M" ? "Male" : "Female"}` : ""} {ed.arrivalMode !== "Walk-in" && <Badge tone="info">{ed.arrivalMode}</Badge>}</div>
          <PatientFlagBadges patient={p} className="mt-1" />
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-sm">{masked ? "Restricted" : ed.complaint || enc.reason || "No complaint entered"}</p>
      {ed.ctasWhy && !masked && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={ed.ctasWhy}>{ed.ctasWhy}</p>}
      {(flags.length > 0 || ed.ctasOverride || ed.temporaryId) && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {flags.map((f) => <Badge key={f} tone="danger">{f}</Badge>)}
          {ed.ctasOverride && <Badge tone="warn"><span title={ed.ctasOverride}>Lower than modifiers</span></Badge>}
          {ed.temporaryId && <Badge tone="info"><span title="Registered with minimal details. Complete the registration later.">Temporary ID</span></Badge>}
        </div>
      )}
      <div className="mt-2">
        <div className="flex items-center gap-1.5 text-xs">
          <Clock className={cn("size-3.5", clock.overdue ? "text-destructive" : "text-muted-foreground")} />
          <span className={cn("font-medium", clock.overdue ? "text-destructive" : "text-muted-foreground")}>{clock.text}</span>
          {stage === "waiting-doctor" && info && info.targetMin > 0 && !clock.overdue && <span className="ms-auto text-muted-foreground">of {info.targetMin} min</span>}
        </div>
        {stage === "waiting-doctor" && info && info.targetMin > 0 && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Time waited against the CTAS target" aria-valuemin={0} aria-valuemax={info.targetMin} aria-valuenow={Math.min(clock.waited, info.targetMin)}>
            <div className={cn("h-full rounded-full", clock.overdue ? "bg-destructive" : info.bg)} style={{ width: `${Math.min(100, Math.round((clock.waited / info.targetMin) * 100))}%` }} />
          </div>
        )}
        {re && (
          <div className={cn("mt-1.5 flex items-center gap-1.5 text-xs", re.late ? "font-medium text-warn" : "text-muted-foreground")}>
            <RefreshCw className="size-3.5" />{re.text}
          </div>
        )}
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
            <Button size="sm" disabled={!canWrite} onClick={() => reassess(enc.visitNumber)} title="Records that you looked at the patient again and restarts the re-assessment clock">Reassessed</Button>
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
  const route = useRoute();
  const fromRoute = route.params.get("triage");
  const [triageState, setTriage] = React.useState<string | null>(null);
  const triage = triageState ?? fromRoute;
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
  const frac = fractiles(seenToday);
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
          const fr = frac.find((f) => f.level === c.level);
          const late = active.filter((e) => e.ed!.ctas === c.level && clockOf(e.ed!, now).overdue && stageOf(e.ed!) === "waiting-doctor").length;
          return (
            <div key={c.level} className={cn("rounded-xl border border-border border-t-4 bg-card px-3 py-2", c.ring)}>
              <div className="flex items-center gap-2"><LevelDot level={c.level} /><span className="text-2xl font-semibold tabular-nums">{n}</span></div>
              <div className="mt-0.5 text-xs font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.targetMin === 0 ? "Immediate" : `Target ${c.targetMin} min`}{late > 0 && <span className="ms-1 font-semibold text-destructive">{late} late</span>}</div>
              {fr && <div className={cn("text-xs", fr.pct !== undefined && fr.pct < fr.goal ? "font-medium text-destructive" : "text-muted-foreground")}>{fr.pct === undefined ? `Goal ${fr.goal}% in target` : `${fr.pct}% in target, goal ${fr.goal}%`}</div>}
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
      {dev && <p className="mt-4 text-xs text-muted-foreground">Assumptions: CTAS time targets are the standard published ones. The ED codes sent in ZPV1-18, 20 and 22 come from the published value sets (CS-Adm-EDArrivalMode, CS-Adm-EDDisposition, CS-Adm-TriageCategory). ZPV1-17 to 22 go out in the CNHI discharge update (A08).</p>}
      {triageEnc && <TriageSheet key={triageEnc.visitNumber} enc={triageEnc} onClose={() => { setTriage(null); if (fromRoute) navigate("/er"); }} />}
      {disposeEnc && <DispositionDialog enc={disposeEnc} onClose={() => setDispose(null)} onDone={(d) => complete(disposeEnc, d)} />}
      {dialogs}
    </div>
  );
}
