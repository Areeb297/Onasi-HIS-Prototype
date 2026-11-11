import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Plus } from "lucide-react";
import { ChecksList } from "@/components/MessagePanel";
import { VitalsSheet, newsTone } from "@/components/emr/VitalsSheet";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { pretty } from "@/lib/hl7";
import type { Encounter, Patient } from "@/lib/model";
import { can } from "@/lib/session";
import { useHis } from "@/lib/store";
import {
  buildOru, cancelPanel, cancelReading, claimReadiness, claimVitalsJson, ensureSeedSends, needsSend, obsValue, panelsOf, scenarioCoverage,
  sendHistorical, sendPanel, setVitalsRejectNext, useVitals, validateOru, type VitalPanel,
} from "@/lib/vitals";
import { CONTEXTS, ROUTINE_INTERVAL_HOURS, VITALS, VITAL_BY_KEY, flagFor, news2, type VitalKey } from "@/lib/vitals-spec";

const ageOf = (p: Patient) => Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000));
const fmt = (local: string) => new Date(local).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const ctxLabel = (id: string) => CONTEXTS.find((c) => c.id === id)?.label ?? id;

function Spark({ points, flags, label, unit, last }: { points: (number | undefined)[]; flags: boolean[]; label: string; unit: string; last?: number }) {
  const vals = points.filter((x): x is number => x !== undefined);
  if (vals.length < 2) return (
    <div className="rounded-lg border border-border p-2.5"><div className="text-xs text-muted-foreground">{label}</div><div className="text-lg font-semibold tabular-nums">{last ?? "--"} <span className="text-xs font-normal text-muted-foreground">{unit}</span></div><div className="text-xs text-muted-foreground">Need two readings for a trend</div></div>
  );
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const W = 120, H = 34;
  const xy = points.map((v, i) => (v === undefined ? null : [(i / (points.length - 1)) * (W - 8) + 4, H - 5 - ((v - min) / span) * (H - 10)] as const));
  const line = xy.filter(Boolean).map((p) => p!.join(",")).join(" ");
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-lg font-semibold tabular-nums">{last ?? "--"} <span className="text-xs font-normal text-muted-foreground">{unit}</span></div>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label} trend`}>
          <polyline points={line} fill="none" stroke="var(--move)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
          {xy.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={flags[i] ? 3 : 2} fill={flags[i] ? "var(--destructive)" : "var(--move)"} />)}
        </svg>
      </div>
    </div>
  );
}

function nphiesState(p: VitalPanel): { label: string; tone: "ok" | "warn" | "danger" | "neutral" } {
  const last = p.sends[p.sends.length - 1];
  if (!last) return { label: "Not sent", tone: "neutral" };
  if (!last.accepted) return { label: "Rejected", tone: "danger" };
  if (last.version < p.version) return { label: "Needs resend", tone: "warn" };
  return { label: "Accepted", tone: "ok" };
}

function PanelRow({ p, enc, patient, dev, open, onToggle, onCorrect }: { p: VitalPanel; enc: Encounter; patient: Patient; dev: boolean; open: boolean; onToggle: () => void; onCorrect: () => void }) {
  const st = nphiesState(p);
  const age = ageOf(patient);
  const v = (k: VitalKey) => obsValue(p, k);
  const cell = (k: VitalKey) => { const x = v(k); const f = x !== undefined ? flagFor(VITAL_BY_KEY[k], x, age) : ""; return <span className={cn("tabular-nums", f && "font-semibold text-destructive")}>{x ?? "--"}</span>; };
  const preview = React.useMemo(() => (open && dev ? buildOru([p], patient, enc, "PREVIEW") : null), [open, dev, p, patient, enc]);
  const write = can("emr.write");
  return (
    <>
      <tr className={cn("hover:bg-muted/40", p.status === "X" && "opacity-60")}>
        <td className="px-3 py-2.5 whitespace-nowrap text-sm">{fmt(p.at)}</td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground">{ctxLabel(p.context)}</td>
        <td className="px-3 py-2.5">{v("sbp") !== undefined ? <>{cell("sbp")}/{cell("dbp")}</> : "--"}</td>
        <td className="px-3 py-2.5">{cell("pulse")}</td>
        <td className="px-3 py-2.5">{cell("rr")}</td>
        <td className="px-3 py-2.5">{cell("temp")}</td>
        <td className="px-3 py-2.5">{cell("spo2")}</td>
        <td className="px-3 py-2.5">
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={p.status === "F" ? "neutral" : p.status === "C" ? "warn" : "danger"}>{p.status === "F" ? "Final" : p.status === "C" ? "Corrected" : "Cancelled"}</Badge>
            <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="inline-flex items-center gap-1">
            {needsSend(p) && <Button size="sm" variant="primary" disabled={!can("adt.send")} onClick={() => sendPanel(p.id)}>{p.status === "X" ? "Send Cancellation" : p.sends.length ? "Send Correction" : "Send"}</Button>}
            <button onClick={onToggle} aria-expanded={open} aria-label="Details" className="rounded p-1 text-muted-foreground hover:bg-muted"><ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} /></button>
          </span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-muted/30 px-4 py-3">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Readings in this panel (version {p.version}, business id {p.businessId})</div>
                <ul className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
                  {p.obs.map((o) => (
                    <li key={o.key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span>{VITAL_BY_KEY[o.key].label}</span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{o.value !== undefined ? `${o.value} ${VITAL_BY_KEY[o.key].display}` : `Not obtained: ${o.absence?.label}`}</span>
                        {dev && <span className="font-mono text-xs text-update">OBX-11 {o.status}</span>}
                        {(o.status === "D" || o.status === "W") && <Badge tone="danger">Removed</Badge>}
                        {write && p.status !== "X" && o.status !== "D" && o.status !== "W" && <button onClick={() => cancelReading(p.id, o.key, "W")} className="text-xs text-destructive hover:underline">Remove</button>}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" disabled={!write || p.status === "X"} onClick={onCorrect}>Correct</Button>
                  <Button size="sm" variant="danger" disabled={!write || p.status === "X"} onClick={() => confirm("Cancel this whole panel? It was entered in error.") && cancelPanel(p.id, "W")}>Cancel Panel</Button>
                </div>
                {p.note && <p className="mt-2 text-xs text-muted-foreground">Note: {p.note}</p>}
              </div>
              {dev && preview && (
                <div className="space-y-2">
                  <CodeBlock filename={`ORU_${p.businessId}_v${p.version}.hl7`} code={pretty(preview.message)} maxHeight={220} />
                  <ChecksList checks={validateOru(preview.segs)} />
                  {p.sends.length > 0 && (
                    <div className="rounded-lg border border-border bg-card p-2 text-xs">
                      <div className="mb-1 font-medium">Send history</div>
                      {p.sends.map((s, i) => (
                        <div key={i} className="mb-1.5">
                          <div>{fmt(s.at)} · {s.kind} v{s.version} · <span className={s.accepted ? "text-ok" : "text-destructive"}>{s.accepted ? "AA accepted" : "AE rejected"}</span> · <span className="font-mono">{s.controlId}</span></div>
                          <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">{pretty(s.ack)}</pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function VitalsSection({ enc }: { enc: Encounter }) {
  const st = useHis();
  const vs = useVitals();
  const dev = useDevMode();
  const patient = st.patients.find((p) => p.id === enc.patientId)!;
  const [sheet, setSheet] = React.useState<{ panel?: VitalPanel } | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  React.useEffect(() => ensureSeedSends(), []);

  const panels = panelsOf(enc.visitNumber, vs);
  const live = panels.filter((p) => p.status !== "X");
  const newest = live[0];
  const claim = claimReadiness(enc.visitNumber);
  const age = ageOf(patient);
  const trend = [...live].slice(0, 12).reverse();
  const series = (k: VitalKey) => trend.map((p) => obsValue(p, k));
  const flagsOf = (k: VitalKey) => trend.map((p) => { const x = obsValue(p, k); return x !== undefined && flagFor(VITAL_BY_KEY[k], x, age) !== ""; });
  const nums = newest ? Object.fromEntries(VITALS.map((d) => [d.key, obsValue(newest, d.key)]).filter(([, x]) => x !== undefined)) : {};
  const score = newest ? news2(nums, newest.onOxygen, newest.consciousness) : null;
  const write = can("emr.write");

  const dueMin = enc.cls === "I" && enc.status === "active" && newest ? Math.round((new Date(newest.at).getTime() + ROUTINE_INTERVAL_HOURS * 3_600_000 - Date.now()) / 60_000) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Vital Signs"
          tag={dev ? "ORU R01" : undefined}
          subtitle="Record once. The panel goes to NPHIES as an ORU message, and the same readings fill the claim."
          right={<Button variant="primary" disabled={!write} title={write ? undefined : "Your role cannot record vital signs"} onClick={() => setSheet({})}><Plus className="size-4" />Record Vitals</Button>}
        />
        {/* Claim readiness */}
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Ready for the claim</span>
            <Badge tone={claim.ready === claim.total ? "ok" : "warn"}>{claim.ready} of {claim.total}</Badge>
            <span className="text-xs text-muted-foreground">Insurers need these eight vitals and the chief complaint, each as a value or a reason it was not obtained.</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {claim.lines.map((l) => (
              <li key={l.key} title={l.state === "absent" ? l.reason : l.value} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 text-xs", l.state === "measured" ? "border-ok/40 bg-ok/10" : l.state === "absent" ? "border-move/40 bg-move/10" : "border-destructive/40 bg-destructive/10 text-destructive")}>
                {l.state === "measured" ? <CheckCircle2 className="size-3.5 text-ok" /> : l.state === "absent" ? <CircleDashed className="size-3.5 text-move" /> : <AlertTriangle className="size-3.5" />}
                {l.label}
                {l.state === "absent" && <span className="text-muted-foreground">not obtained</span>}
              </li>
            ))}
          </ul>
          {dev && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium text-update">Claim supportingInfo for these vitals (CHI rules BV-00763 to BV-00780)</summary>
              <CodeBlock filename="claim_vital_signs.json" className="mt-1" code={JSON.stringify(claimVitalsJson(enc.visitNumber), null, 2)} maxHeight={260} />
            </details>
          )}
        </div>

        {/* Latest */}
        {newest ? (
          <div className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Latest: {fmt(newest.at)}, {ctxLabel(newest.context)}</span>
              {dueMin !== undefined && <Badge tone={dueMin < 0 ? "danger" : dueMin < 30 ? "warn" : "ok"}>{dueMin < 0 ? `Overdue by ${-dueMin} min` : `Next due in ${Math.floor(dueMin / 60)} h ${dueMin % 60} min`}</Badge>}
              {dev && dueMin !== undefined && <span>(policy example: every {ROUTINE_INTERVAL_HOURS} hours)</span>}
              {score && <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", newsTone(score.band))} title={score.note}>NEWS2 {score.total}{score.complete ? "" : " (partial)"}</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Spark label="Pulse" unit="/min" last={obsValue(newest, "pulse")} points={series("pulse")} flags={flagsOf("pulse")} />
              <Spark label="Systolic BP" unit="mmHg" last={obsValue(newest, "sbp")} points={series("sbp")} flags={flagsOf("sbp")} />
              <Spark label="Respiratory rate" unit="/min" last={obsValue(newest, "rr")} points={series("rr")} flags={flagsOf("rr")} />
              <Spark label="Temperature" unit="°C" last={obsValue(newest, "temp")} points={series("temp")} flags={flagsOf("temp")} />
              <Spark label="Oxygen saturation" unit="%" last={obsValue(newest, "spo2")} points={series("spo2")} flags={flagsOf("spo2")} />
              <Spark label="Diastolic BP" unit="mmHg" last={obsValue(newest, "dbp")} points={series("dbp")} flags={flagsOf("dbp")} />
              <Spark label="Weight" unit="kg" last={obsValue(newest, "weight")} points={series("weight")} flags={flagsOf("weight")} />
              <Spark label="Height" unit="cm" last={obsValue(newest, "height")} points={series("height")} flags={flagsOf("height")} />
            </div>
          </div>
        ) : (
          <Empty>No vital signs yet. Use Record Vitals.</Empty>
        )}
      </Card>

      <Card>
        <CardHeader title="Readings" subtitle={`${panels.length} panel${panels.length === 1 ? "" : "s"} for visit ${enc.visitNumber}`} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>{["Time", "Why", "BP", "Pulse", "Resp", "Temp", "SpO2", "Status", ""].map((h) => <th key={h} className="border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody>
              {panels.length === 0 && <tr><td colSpan={9}><Empty>Nothing recorded.</Empty></td></tr>}
              {panels.map((p) => (
                <PanelRow key={p.id} p={p} enc={enc} patient={patient} dev={dev} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)} onCorrect={() => setSheet({ panel: p })} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {dev && (
        <Card>
          <CardHeader
            title="NPHIES Requirements: Vital Signs"
            subtitle="The example scenarios of the ORU guide. Each turns done when an accepted message exists for it."
            right={
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={vs.rejectNext} onChange={(e) => setVitalsRejectNext(e.target.checked)} className="accent-[var(--primary)]" />Reject the next send</label>
                <Button size="sm" disabled={live.length < 2 || !can("adt.send")} onClick={() => sendHistorical(enc.visitNumber)}>Send All Panels In One Message</Button>
              </div>
            }
          />
          <ul className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-4">
            {scenarioCoverage(enc.visitNumber, vs).map((s) => (
              <li key={s.id} className={cn("rounded-lg border px-3 py-2 text-sm", s.done ? "border-ok/40 bg-ok/10" : "border-border")}>
                <div className="flex items-center gap-1.5 font-medium">{s.done ? <CheckCircle2 className="size-4 text-ok" /> : <CircleDashed className="size-4 text-muted-foreground" />}{s.id}) {s.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.hint}</div>
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Assumptions: the value sets for OBR-25, OBX-11 and the abnormal flags could not be opened, so F, C, X, D, W and H, L, HH, LL are taken from the workflow text and HL7 practice. Temperature absence reasons were not readable, so two codes are assumed. Units follow the ORU value set (temperature "cel") in the message and the claim rules ("Cel") in claims. Flags and ranges are adult demo values, not clinical policy.
          </p>
        </Card>
      )}

      {sheet && <VitalsSheet enc={enc} patient={patient} panel={sheet.panel} hasPanels={panels.length > 0} onClose={() => setSheet(null)} />}
    </div>
  );
}
