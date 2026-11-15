import * as React from "react";
import { IconHistory, IconId, IconMessage2, IconPaperclip, IconPill } from "@tabler/icons-react";
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, Info } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, Table, Td, Th, cn } from "@/components/ui/primitives";
import { PatientJourney } from "@/components/emr/PatientJourney";
import { quickSend } from "@/lib/actions";
import {
  CLASS_LABEL, STATUS_LABEL, activeMedicines, attachmentsOf, demographics, encounterDetails, latestHistory, patientVisits, type DetailRow,
} from "@/lib/chart-overview";
import { attentionFor, sbarFor, sbarText, type Attention } from "@/lib/chart-review";
import { useCareRequests } from "@/lib/care-requests";
import { useDocs } from "@/lib/docs";
import { useEmar } from "@/lib/emar";
import { useLab } from "@/lib/lab";
import type { Encounter, Patient } from "@/lib/model";
import { useRad } from "@/lib/radiology";
import { useRx } from "@/lib/rx";
import { useTheatre } from "@/lib/theatre";
import { navigate } from "@/lib/router";
import { useRecords } from "@/lib/records";
import { DOCTORS, SERVICES } from "@/lib/reference-data";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

/**
 * The first screen of a chart. It answers, in order: what needs me now, what do I tell the next person, who is this
 * patient and what is this visit, what has the patient had before, and what happened. Everything on it is computed from
 * the chart; nothing is typed twice.
 */

function AttentionList({ items, onGo, onFix }: { items: Attention[]; onGo: (section: string) => void; onFix: (a: Attention) => void }) {
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-sm text-ok">
        <CheckCircle2 className="size-4" aria-hidden="true" /> Nothing needs attention right now.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {items.map((a) => {
        const high = a.level === "high";
        const Icon = a.level === "info" ? Info : AlertTriangle;
        return (
          <li key={a.id} className={cn("flex items-start gap-3 px-4 py-2.5", high && "bg-destructive/6")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", high ? "text-destructive" : a.level === "medium" ? "text-warn" : "text-muted-foreground")} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="text-sm">{a.text}</div>
              <div className="mt-0.5 text-xs font-medium text-muted-foreground">
                {high ? "Urgent" : a.level === "medium" ? "Soon" : "For your information"}
              </div>
            </div>
            {a.action ? (
              <Button size="sm" variant="primary" onClick={() => onFix(a)}>{a.actionLabel}</Button>
            ) : (
              <Button size="sm" onClick={() => onGo(a.section)}>Open <ChevronRight className="size-3.5" aria-hidden="true" /></Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Handoff({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const sbar = sbarFor(enc, patient);
  const rows: [string, string, string][] = [
    ["S", "Situation", sbar.situation],
    ["B", "Background", sbar.background],
    ["A", "Assessment", sbar.assessment],
    ["R", "Recommendation", sbar.recommendation],
  ];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sbarText(sbar));
      pushToast({ tone: "ok", text: "Handoff copied" });
    } catch {
      pushToast({ tone: "warn", text: "Could not copy. Select the text and copy it." });
    }
  };
  return (
    <>
      <dl className="divide-y divide-border">
        {rows.map(([letter, name, text]) => (
          <div key={letter} className="flex gap-3 px-4 py-2.5">
            <dt className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-sm font-semibold text-primary" aria-label={name}>{letter}</dt>
            <dd className="min-w-0 flex-1">
              <div className="text-xs font-medium text-muted-foreground">{name}</div>
              <div className="whitespace-pre-line text-sm">{text}</div>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span className="text-xs text-muted-foreground">Written from the chart. Check it before you read it out.</span>
        <Button size="sm" onClick={copy}><Copy className="size-3.5" aria-hidden="true" /> Copy</Button>
      </div>
    </>
  );
}

function DetailList({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{r.label}</dt>
          <dd className={cn("mt-0.5 break-words", r.known ? "font-medium" : "text-muted-foreground")}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const doctorName = (id: string) => { const d = DOCTORS.find((x) => x.id === id); return d ? `Dr. ${d.given} ${d.family}` : "None"; };
const shortDate = (s?: string) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set");

function EncounterHistory({ visits, current }: { visits: Encounter[]; current: string }) {
  return (
    <Table>
      <thead><tr><Th>Visit</Th><Th>Date</Th><Th>Service</Th><Th>Doctor</Th><Th>Status</Th></tr></thead>
      <tbody>
        {visits.map((v) => {
          const here = v.visitNumber === current;
          return (
            <tr key={v.visitNumber} className={cn(here && "bg-move/6")}>
              <Td>
                {here ? (
                  <span className="font-mono text-sm font-medium">{v.visitNumber}</span>
                ) : (
                  <button type="button" onClick={() => navigate("/chart", { visit: v.visitNumber, s: "overview" })} className="font-mono text-sm font-medium text-move underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open the chart of visit ${v.visitNumber}`}>
                    {v.visitNumber}
                  </button>
                )}
                <div className="mt-0.5 flex flex-wrap gap-1">
                  <Badge tone="neutral">{CLASS_LABEL[v.cls]}</Badge>
                  {here && <Badge tone="primary">Current</Badge>}
                </div>
              </Td>
              <Td className="whitespace-nowrap text-xs">{shortDate(v.admitAt ?? v.expectedAdmitAt)}</Td>
              <Td className="text-xs">{SERVICES.find((x) => x.code === v.service)?.label ?? v.service}</Td>
              <Td className="text-xs">{doctorName(v.attending)}</Td>
              <Td><Badge tone={v.status === "active" ? "info" : v.status === "discharged" ? "ok" : v.status === "cancelled" ? "neutral" : "warn"}>{STATUS_LABEL[v.status]}</Badge></Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function SummaryCard({ title, icon: Icon, count, onOpen, openLabel, children }: { title: string; icon: React.ElementType; count: number; onOpen: () => void; openLabel: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} right={<span className="flex items-center gap-2"><Badge tone={count ? "info" : "neutral"}>{count}</Badge><Icon className="size-4 text-muted-foreground" aria-hidden="true" /></span>} />
      <div className="flex-1">{children}</div>
      <div className="border-t border-border px-4 py-2">
        <Button size="sm" variant="ghost" onClick={onOpen}>{openLabel} <ChevronRight className="size-3.5" aria-hidden="true" /></Button>
      </div>
    </Card>
  );
}

export function ChartOverview({ enc, patient, children }: { enc: Encounter; patient: Patient; children?: React.ReactNode }) {
  // Re-render when any source store changes.
  const state = useHis(); useLab(); useRad(); const rx = useRx(); useDocs(); useVitals(); useEmar(); useCareRequests(); useTheatre(); useRecords();
  const go = (s: string) => navigate("/chart", { visit: enc.visitNumber, s });
  const attention = attentionFor(enc, patient);
  const urgent = attention.filter((a) => a.level === "high").length;
  const visits = patientVisits(state, patient.id);
  const visitIds = visits.map((v) => v.visitNumber);
  const meds = activeMedicines(enc.visitNumber, rx);
  const history = latestHistory(visitIds);
  const files = attachmentsOf(visitIds);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader
            title="Needs Attention"
            subtitle="Found by checking this chart against the rules. Most urgent first."
            right={urgent ? <Badge tone="danger">{urgent} urgent</Badge> : attention.length ? <Badge tone="neutral">{attention.length} to review</Badge> : <Badge tone="ok">All clear</Badge>}
          />
          <AttentionList items={attention} onGo={go} onFix={(a) => { if (a.action === "send-update") quickSend("A08", enc.visitNumber); }} />
        </Card>
        <Card>
          <CardHeader title="Handoff (SBAR)" subtitle="Situation, Background, Assessment, Recommendation." right={<IconMessage2 className="size-4 text-muted-foreground" aria-hidden="true" />} />
          <Handoff enc={enc} patient={patient} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Encounter Details" subtitle={`Visit ${enc.visitNumber}. A detail the hospital does not hold says Not recorded.`} />
          <DetailList rows={encounterDetails(enc)} />
        </Card>
        <Card>
          <CardHeader title="Demographics" right={<IconId className="size-4 text-muted-foreground" aria-hidden="true" />} />
          <DetailList rows={demographics(patient)} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Encounter History" subtitle={`All ${visits.length} visit${visits.length === 1 ? "" : "s"} of this patient, newest first. Open a visit to see its chart.`} />
        <EncounterHistory visits={visits} current={enc.visitNumber} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard title="Active Medicines" icon={IconPill} count={meds.length} onOpen={() => go("prescription")} openLabel="Open Prescriptions">
          {meds.length === 0 ? <Empty>No active medicines on this visit.</Empty> : (
            <ul className="divide-y divide-border">
              {meds.slice(0, 6).map((m) => (
                <li key={m.id} className="px-4 py-2">
                  <div className="text-sm font-medium">{m.drug}</div>
                  <div className="text-xs text-muted-foreground">{m.detail}</div>
                </li>
              ))}
              {meds.length > 6 && <li className="px-4 py-2 text-xs text-muted-foreground">And {meds.length - 6} more.</li>}
            </ul>
          )}
        </SummaryCard>
        <SummaryCard title="History" icon={IconHistory} count={history ? history.lines.length : 0} onOpen={() => go("medical-history")} openLabel="Open Medical History">
          {!history ? <Empty>No medical history recorded on any visit.</Empty> : (
            <>
              <dl className="divide-y divide-border">
                {history.lines.slice(0, 5).map(([k, v]) => (
                  <div key={k} className="px-4 py-2">
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="line-clamp-2 text-sm">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="px-4 pb-2 text-xs text-muted-foreground">By {history.author} on {shortDate(history.at)}{history.visit !== enc.visitNumber ? `, visit ${history.visit}` : ""}.</p>
            </>
          )}
        </SummaryCard>
        <SummaryCard title="Attachments" icon={IconPaperclip} count={files.length} onOpen={() => go("attachments")} openLabel="Open Attachments">
          {files.length === 0 ? <Empty>No attachments on any visit.</Empty> : (
            <ul className="divide-y divide-border">
              {files.slice(0, 5).map((f) => (
                <li key={f.id} className="px-4 py-2">
                  <div className="truncate text-sm font-medium" title={f.name}>{f.name}</div>
                  <div className="text-xs text-muted-foreground">{[f.type, f.date, f.visit !== enc.visitNumber ? `visit ${f.visit}` : ""].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
              {files.length > 5 && <li className="px-4 py-2 text-xs text-muted-foreground">And {files.length - 5} more.</li>}
            </ul>
          )}
        </SummaryCard>
      </div>

      <Card>
        <PatientJourney enc={enc} patient={patient} />
      </Card>
      {children}
    </div>
  );
}
