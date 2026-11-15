import * as React from "react";
import {
  IconActivityHeartbeat, IconClipboardText, IconDoor, IconFileText, IconFlask, IconNotes, IconPill, IconRadar2, IconSend, IconStethoscope,
  IconVaccine, IconWritingSign, IconBandage,
} from "@tabler/icons-react";
import { Printer } from "lucide-react";
import { Badge, Button, CardHeader, Empty, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useAudit } from "@/lib/audit";
import { CLASS_LABEL, STATUS_LABEL } from "@/lib/chart-overview";
import { auditCounts, chartAudit, humanDuration, journeyEvents, journeyPrintHtml, visitMinutes, visitSummaries, type JourneyEvent, type JourneyKind } from "@/lib/journey";
import type { Encounter, Patient } from "@/lib/model";
import { FACILITY_NAME } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { currentUser } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";

/**
 * The patient journey on the chart overview. Timeline: every step of this visit with who did it, their role and the time
 * since the step before. Visit Summary: all of the patient's visits. Audit Trail: who opened or changed this chart.
 */

const KIND: Record<JourneyKind, { label: string; icon: React.ElementType; color: string }> = {
  visit: { label: "Visit", icon: IconDoor, color: "text-admit bg-admit/12" },
  adt: { label: "NPHIES", icon: IconSend, color: "text-move bg-move/12" },
  vitals: { label: "Vitals", icon: IconActivityHeartbeat, color: "text-admit bg-admit/12" },
  dx: { label: "Diagnosis", icon: IconStethoscope, color: "text-update bg-update/12" },
  pr: { label: "Procedures", icon: IconBandage, color: "text-merge bg-merge/12" },
  lab: { label: "Lab", icon: IconFlask, color: "text-update bg-update/12" },
  rad: { label: "Imaging", icon: IconRadar2, color: "text-merge bg-merge/12" },
  rx: { label: "Prescriptions", icon: IconPill, color: "text-ok bg-ok/12" },
  dose: { label: "Doses", icon: IconVaccine, color: "text-ok bg-ok/12" },
  doc: { label: "Documents", icon: IconFileText, color: "text-move bg-move/12" },
  note: { label: "Notes", icon: IconNotes, color: "text-foreground/80 bg-muted" },
  soap: { label: "SOAP", icon: IconWritingSign, color: "text-foreground/80 bg-muted" },
  form: { label: "Forms", icon: IconClipboardText, color: "text-foreground/80 bg-muted" },
};

const TONE_DOT: Record<JourneyEvent["tone"], string> = { ok: "bg-ok", warn: "bg-warn", danger: "bg-destructive", neutral: "bg-muted-foreground/50" };
const fmt = (t: number) => fmtDateTime(t);
const fmtLong = (t: number | string) => fmtDateTime(t);

type Tab = "timeline" | "visits" | "audit";

export function PatientJourney({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const state = useHis();
  const audit = useAudit();
  const [tab, setTab] = React.useState<Tab>("timeline");
  const now = Date.now();
  const events = journeyEvents(enc, state, audit, now);
  const total = visitMinutes(enc, now);
  const visits = tab === "visits" ? visitSummaries(patient.id, enc.visitNumber, state, now) : [];
  const trail = tab === "audit" ? chartAudit(audit, enc, patient, state) : [];

  const print = () => {
    const html = journeyPrintHtml({
      patient, enc, events, visits: visitSummaries(patient.id, enc.visitNumber, state, now), total, hospital: FACILITY_NAME, printedBy: currentUser().name, now,
    });
    const w = typeof window !== "undefined" ? window.open("", "_blank", "width=900,height=700") : null;
    if (!w) { pushToast({ tone: "warn", text: "Could not open the print window. Allow pop-ups for this site." }); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const tabs: { id: Tab; label: string }[] = [{ id: "timeline", label: "Timeline" }, { id: "visits", label: "Visit Summary" }, { id: "audit", label: "Audit Trail" }];

  return (
    <>
      <CardHeader
        title="Patient Journey"
        subtitle="Every step of this visit with who did it, the patient's other visits, and who opened or changed this chart."
        right={<Button size="sm" onClick={print}><Printer className="size-3.5" aria-hidden="true" /> Print</Button>}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2" >
        <div className="flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Journey views">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-sm">
          <span className="text-muted-foreground">Total visit time: </span>
          <span className="font-medium">{total === null ? "Not started" : `${humanDuration(total)}${enc.status === "active" ? " so far" : ""}`}</span>
        </span>
      </div>
      <div role="tabpanel">
        {tab === "timeline" && <JourneyTimeline events={events} onGo={(s) => navigate("/chart", { visit: enc.visitNumber, s })} />}
        {tab === "visits" && <VisitTable visits={visits} />}
        {tab === "audit" && <AuditTable entries={trail} />}
      </div>
    </>
  );
}

function JourneyTimeline({ events, onGo }: { events: JourneyEvent[]; onGo: (section: string) => void }) {
  const kinds = React.useMemo(() => [...new Set(events.map((i) => i.kind))], [events]);
  const [hidden, setHidden] = React.useState<Set<JourneyKind>>(new Set());
  const shown = events.filter((i) => !hidden.has(i.kind));
  const toggle = (k: JourneyKind) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return (
    <>
      <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2.5" role="group" aria-label="Filter the timeline">
        {kinds.map((k) => {
          const on = !hidden.has(k);
          const Icon = KIND[k].icon;
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(k)}
              className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-move/40 bg-move/10 text-move" : "border-border text-muted-foreground line-through")}
            >
              <Icon className="size-3.5" aria-hidden="true" /> {KIND[k].label}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <Empty>{events.length ? "Nothing to show. Turn a filter back on." : "No events for this visit yet."}</Empty>
      ) : (
        <ol className="max-h-[32rem] overflow-y-auto px-4 py-2">
          {shown.map((i) => {
            const Icon = KIND[i.kind].icon;
            return (
              <li key={i.id} className="relative flex gap-3 border-l border-border pb-3 pl-4 last:pb-0">
                <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-2 ring-card", TONE_DOT[i.tone])} aria-hidden="true" />
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", KIND[i.kind].color)} aria-hidden="true"><Icon className="size-4" /></span>
                <button type="button" onClick={() => onGo(i.section)} className="min-w-0 flex-1 rounded-md text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{i.title}</span>
                    <time className="text-xs text-muted-foreground">{fmt(i.at)}</time>
                  </div>
                  {i.detail && <div className={cn("text-[0.8125rem]", i.tone === "danger" ? "font-medium text-destructive" : "text-muted-foreground")}>{i.detail}</div>}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span><span className="font-medium text-foreground/85">{i.staff}</span>{i.role ? `, ${i.role}` : ""}</span>
                    {i.sincePrevMin !== undefined && <span>{humanDuration(i.sincePrevMin)} since the previous step</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function VisitTable({ visits }: { visits: ReturnType<typeof visitSummaries> }) {
  if (!visits.length) return <Empty>No visits found.</Empty>;
  return (
    <Table>
      <thead><tr><Th>Visit</Th><Th>Started</Th><Th>Length</Th><Th>Doctor</Th><Th>Primary Diagnosis</Th><Th className="text-right">Events</Th><Th className="text-right">Orders</Th><Th className="text-right">Medicines</Th><Th className="text-right">Notes</Th></tr></thead>
      <tbody>
        {visits.map((v) => (
          <tr key={v.visitNumber} className={cn(v.current && "bg-move/6")}>
            <Td>
              <button type="button" onClick={() => navigate("/chart", { visit: v.visitNumber, s: "overview" })} className="font-mono text-sm font-medium text-move underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {v.visitNumber}
              </button>
              <div className="mt-0.5 flex flex-wrap gap-1">
                <Badge tone="neutral">{CLASS_LABEL[v.cls]}</Badge>
                <Badge tone={v.status === "active" ? "info" : v.status === "discharged" ? "ok" : "neutral"}>{STATUS_LABEL[v.status]}</Badge>
                {v.current && <Badge tone="primary">This Visit</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">{v.service}</div>
            </Td>
            <Td className="whitespace-nowrap text-xs">{v.start ? fmtLong(v.start) : "Not started"}</Td>
            <Td className="whitespace-nowrap text-xs">{humanDuration(v.minutes)}{v.status === "active" ? " so far" : ""}</Td>
            <Td className="text-xs">{v.doctor}</Td>
            <Td className="max-w-[14rem] text-xs">{v.primaryDx ?? "None"}</Td>
            <Td className="text-right tabular-nums">{v.events}</Td>
            <Td className="text-right tabular-nums">{v.orders}</Td>
            <Td className="text-right tabular-nums">{v.meds}</Td>
            <Td className="text-right tabular-nums">{v.notes}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const ACTION_LABEL: Record<string, string> = {
  create: "Created", update: "Updated", delete: "Deleted", view: "Viewed", "send-adt": "Sent ADT", "send-fhir": "Sent To NPHIES", "send-document": "Sent Document",
  "break-glass": "Break The Glass", denied: "Access Denied", "ai-suggest": "AI Suggested", "ai-accept": "AI Accepted", "ai-reject": "AI Rejected", export: "Exported",
};

function AuditTable({ entries }: { entries: ReturnType<typeof chartAudit> }) {
  const c = auditCounts(entries);
  return (
    <>
      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2.5 text-sm">
        <Badge tone="neutral">{c.total} Total Events</Badge>
        <Badge tone="admit">{c.creations} Creations</Badge>
        <Badge tone="update">{c.edits} Edits And Deletions</Badge>
        <Badge tone="info">{c.views} Views</Badge>
      </div>
      {entries.length === 0 ? (
        <Empty>No audit events for this chart yet.</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <Table>
            <thead><tr><Th>When</Th><Th>Action</Th><Th>What</Th><Th>Who</Th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-xs tabular-nums">{fmtLong(e.at)}</Td>
                  <Td><Badge tone={e.action === "delete" || e.action === "denied" || e.action === "break-glass" ? "danger" : e.action === "create" ? "admit" : e.action === "update" ? "update" : "neutral"}>{ACTION_LABEL[e.action] ?? e.action}</Badge></Td>
                  <Td className="text-xs"><div className="font-medium">{e.target}</div>{e.detail && <div className="text-muted-foreground">{e.detail}</div>}</Td>
                  <Td className="text-xs"><div>{e.user}</div><div className="text-muted-foreground">{e.role}</div></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
