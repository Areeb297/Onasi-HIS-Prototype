import * as React from "react";
import {
  IconActivityHeartbeat, IconClipboardText, IconFileText, IconFlask, IconMessage2, IconNotes, IconPill, IconRadar2, IconSend,
} from "@tabler/icons-react";
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, Info } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, cn } from "@/components/ui/primitives";
import { quickSend } from "@/lib/actions";
import { attentionFor, buildTimeline, sbarFor, sbarText, type Attention, type TimelineItem, type TimelineKind } from "@/lib/chart-review";
import { useCareRequests } from "@/lib/care-requests";
import { useDocs } from "@/lib/docs";
import { useEmar } from "@/lib/emar";
import { useLab } from "@/lib/lab";
import type { Encounter, Patient } from "@/lib/model";
import { useRad } from "@/lib/radiology";
import { useRx } from "@/lib/rx";
import { useTheatre } from "@/lib/theatre";
import { navigate } from "@/lib/router";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

/**
 * The first screen of a chart. It answers three questions in order: what needs me now, what happened,
 * and what do I tell the next person. Everything on it is computed from the chart; nothing is typed twice.
 */

const KIND: Record<TimelineKind, { label: string; icon: React.ElementType; color: string }> = {
  adt: { label: "NPHIES", icon: IconSend, color: "text-move bg-move/12" },
  vitals: { label: "Vitals", icon: IconActivityHeartbeat, color: "text-admit bg-admit/12" },
  lab: { label: "Lab", icon: IconFlask, color: "text-update bg-update/12" },
  rad: { label: "Imaging", icon: IconRadar2, color: "text-merge bg-merge/12" },
  rx: { label: "Medication", icon: IconPill, color: "text-ok bg-ok/12" },
  doc: { label: "Documents", icon: IconFileText, color: "text-move bg-move/12" },
  note: { label: "Notes", icon: IconNotes, color: "text-foreground/80 bg-muted" },
  form: { label: "Forms", icon: IconClipboardText, color: "text-foreground/80 bg-muted" },
};

const TONE_DOT: Record<TimelineItem["tone"], string> = {
  ok: "bg-ok", warn: "bg-warn", danger: "bg-destructive", neutral: "bg-muted-foreground/50",
};

const fmt = (t: number) =>
  new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

function Timeline({ items, onGo }: { items: TimelineItem[]; onGo: (section: string) => void }) {
  const kinds = React.useMemo(() => [...new Set(items.map((i) => i.kind))], [items]);
  const [hidden, setHidden] = React.useState<Set<TimelineKind>>(new Set());
  const shown = items.filter((i) => !hidden.has(i.kind));
  const toggle = (k: TimelineKind) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
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
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                on ? "border-move/40 bg-move/10 text-move" : "border-border text-muted-foreground line-through",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" /> {KIND[k].label}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <Empty>Nothing to show. Turn a filter back on.</Empty>
      ) : (
        <ol className="max-h-[28rem] overflow-y-auto px-4 py-2">
          {shown.map((i) => {
            const Icon = KIND[i.kind].icon;
            return (
              <li key={i.id} className="relative flex gap-3 border-l border-border pb-3 pl-4 last:pb-0">
                <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-2 ring-card", TONE_DOT[i.tone])} aria-hidden="true" />
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", KIND[i.kind].color)} aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <button type="button" onClick={() => onGo(i.section)} className="min-w-0 flex-1 rounded-md text-left hover:bg-muted/60 focus-visible:bg-muted/60">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{i.title}</span>
                    <time className="text-xs text-muted-foreground">{fmt(i.at)}</time>
                  </div>
                  {i.detail && <div className={cn("text-[0.8125rem]", i.tone === "danger" ? "font-medium text-destructive" : "text-muted-foreground")}>{i.detail}</div>}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </>
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

export function ChartOverview({ enc, patient, children }: { enc: Encounter; patient: Patient; children?: React.ReactNode }) {
  // Re-render when any source store changes.
  useHis(); useLab(); useRad(); useRx(); useDocs(); useVitals(); useEmar(); useCareRequests(); useTheatre();
  const go = (s: string) => navigate("/chart", { visit: enc.visitNumber, s });
  const attention = attentionFor(enc, patient);
  const timeline = buildTimeline(enc);
  const urgent = attention.filter((a) => a.level === "high").length;

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
      <Card>
        <CardHeader title="Everything That Happened" subtitle="One timeline for messages, vital signs, orders, results, notes and documents. Newest first." />
        <Timeline items={timeline} onGo={go} />
      </Card>
      {children}
    </div>
  );
}
