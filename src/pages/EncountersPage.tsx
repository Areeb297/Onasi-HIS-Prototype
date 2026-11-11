import * as React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { ClassBadge, StatusBadge } from "@/components/badges";
import { CodeBlock } from "@/components/ui/code-block";
import { Card, CardHeader, Empty, PageHeader, cn } from "@/components/ui/primitives";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { useDevMode } from "@/lib/devmode";
import { visitMessages } from "@/lib/visitMessages";
import { pretty } from "@/lib/hl7";
import { navigate, useRoute } from "@/lib/router";
import { bedLabel, patientName, useHis } from "@/lib/store";
import { EVENT_BY_ID } from "@/lib/spec";

export function EncountersPage() {
  const state = useHis();
  const dev = useDevMode();
  const route = useRoute();
  const wanted = route.params.get("visit");

  const list = [...state.encounters].reverse();
  const selected = state.encounters.find((e) => e.visitNumber === wanted) ?? list[0];

  const visitMsgs = React.useMemo(() => (selected ? visitMessages(state, selected) : []), [state, selected]);

  const events: TimelineEvent[] = visitMsgs.map((m) => {
    const spec = EVENT_BY_ID[m.eventId];
    return {
      id: String(m.seq),
      at: m.sentAt,
      actor: m.trigger,
      title: spec.name,
      meta: `${m.controlId}${m.errors ? `, ${m.errors} error${m.errors > 1 ? "s" : ""}` : ""}${m.warnings ? `, ${m.warnings} warning${m.warnings > 1 ? "s" : ""}` : ""}`,
      tone: m.errors ? "danger" : m.warnings ? "warn" : "success",
      icon: m.errors ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />,
      detail: dev ? <CodeBlock filename={`${m.controlId}_${m.trigger}.hl7`} code={pretty(m.message)} /> : undefined,
    };
  });

  const patient = selected && state.patients.find((p) => p.id === selected.patientId);

  return (
    <div>
      <PageHeader
        title="Encounters"
        subtitle="The feed NPHIES receives is an event history for each visit. Pick a visit to see every message sent for it."
      />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="max-h-[calc(100vh-11rem)] overflow-y-auto">
          <CardHeader title="Visits" subtitle={`${state.encounters.length} in total`} />
          <ul>
            {list.length === 0 && <Empty>No visits yet.</Empty>}
            {list.map((e) => {
              const p = state.patients.find((x) => x.id === e.patientId);
              const active = selected?.visitNumber === e.visitNumber;
              return (
                <li key={e.visitNumber}>
                  <button
                    onClick={() => navigate("/encounters", { visit: e.visitNumber })}
                    className={cn(
                      "flex w-full flex-col gap-1.5 border-b border-border/70 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                      active && "bg-accent/40",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{patientName(p)}</span>
                      <StatusBadge status={e.status} />
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{e.visitNumber}</span>
                      <ClassBadge cls={e.cls} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {selected ? (
          <Card>
            <CardHeader
              title={`${patientName(patient)} · ${selected.visitNumber}`}
              subtitle={`${selected.status === "active" ? bedLabel(selected.bedId) : "No bed"} · ${selected.reason || "No reason entered"}`}
              right={
                <div className="flex gap-1.5">
                  <ClassBadge cls={selected.cls} />
                  <StatusBadge status={selected.status} />
                </div>
              }
            />
            <div className="grid gap-x-6 gap-y-3 border-b border-border px-4 py-3 text-sm sm:grid-cols-3">
              <Info label="Admitted" value={selected.admitAt?.replace("T", " ") ?? "Not yet"} />
              <Info label="Discharged" value={selected.dischargeAt?.replace("T", " ") ?? "Not yet"} />
              <Info label="Diagnoses" value={selected.dx.map((d) => d.code).join(", ") || "None"} />
            </div>
            <div className="p-4">
              {events.length === 0 ? (
                <Empty>
                  No messages for this visit yet. Use the Events menu to send one.
                </Empty>
              ) : (
                <Timeline events={events} label={`Messages for visit ${selected.visitNumber}`} />
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <Empty>Pick a visit on the left.</Empty>
          </Card>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
