import * as React from "react";
import { RotateCcw } from "lucide-react";
import { STAGE_TONE } from "@/components/emr/TheatreSection";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { navigate } from "@/lib/router";
import { useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { resetTheatre, useTheatre } from "@/lib/theatre";
import { STEPS, caseStage, nextAction, scheduleEnd, stepDone, type SurgeryCase } from "@/lib/theatre-logic";

type FilterId = "action" | "today" | "theatre" | "recovery" | "closed" | "all";

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const FILTERS: { id: FilterId; label: string; test: (c: SurgeryCase) => boolean }[] = [
  { id: "action", label: "Needs Action", test: (c) => !c.closed },
  { id: "today", label: "Today", test: (c) => (c.schedule?.date ?? c.request.plannedDate) === today() },
  { id: "theatre", label: "In Theatre", test: (c) => ["In Theatre", "Note Needed"].includes(caseStage(c)) },
  { id: "recovery", label: "In Recovery", test: (c) => caseStage(c) === "In Recovery" },
  { id: "closed", label: "Closed", test: (c) => !!c.closed },
  { id: "all", label: "All", test: () => true },
];

/** When the case is due: the booked slot, or the planned date while it is not booked yet. */
const sortKey = (c: SurgeryCase) => (c.schedule ? `${c.schedule.date}T${c.schedule.start}` : `${c.request.plannedDate}T99:99`);

/** Every surgery case in the hospital, one row each, with the step that is waiting. */
export function TheatreListPage() {
  const theatre = useTheatre();
  const his = useHis();
  const dev = useDevMode();
  useSession();
  const [filter, setFilter] = React.useState<FilterId>("action");
  const [q, setQ] = React.useState("");

  const active = FILTERS.find((f) => f.id === filter)!;
  const query = q.trim().toLowerCase();
  const rows = theatre.cases
    .filter(active.test)
    .filter((c) => {
      if (!query) return true;
      const p = his.patients.find((x) => x.id === c.patientId);
      return `${patientName(p)} ${p?.mrn ?? ""} ${c.visit} ${c.id} ${c.request.procedure} ${c.request.surgeon} ${c.schedule?.room ?? ""}`.toLowerCase().includes(query);
    })
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  return (
    <div>
      <PageHeader
        title="Theatre List"
        subtitle="Every surgery case and the step it is waiting for. A step opens only when the one before it is done. Open a case to work on it in the patient chart."
        right={dev ? (
          <Button variant="ghost" size="sm" onClick={resetTheatre} title="Brings back the demo cases and removes the others">
            <RotateCcw className="size-4" />
            Reset Theatre Demo Data
          </Button>
        ) : undefined}
      />

      <Card className="mb-4 px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Case filter">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                {f.label} <span className="opacity-70">{theatre.cases.filter(f.test).length}</span>
              </button>
            ))}
          </div>
          <Field label="Search" className="ml-auto w-full sm:w-64">
            <Input placeholder="Patient, procedure, surgeon or room" value={q} onChange={(e) => setQ(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Procedure</Th>
              <Th>Surgeon</Th>
              <Th>Room And Time</Th>
              <Th>Stage</Th>
              <Th>Next Step</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={7}><Empty>{theatre.cases.length === 0 ? "No surgery cases yet. A case starts with a surgery request in the patient chart, under Surgery Case." : "No cases match this filter."}</Empty></Td></tr>
            )}
            {rows.map((c) => {
              const p = his.patients.find((x) => x.id === c.patientId);
              const stage = caseStage(c);
              const doneCount = STEPS.filter((s) => stepDone(c, s.id)).length;
              return (
                <tr key={c.id} className="hover:bg-muted/40">
                  <Td>
                    <div className="font-semibold">{patientName(p)}</div>
                    <div className="text-xs text-muted-foreground">{p?.mrn} · Visit {c.visit}{dev ? ` · ${c.id}` : ""}</div>
                  </Td>
                  <Td>
                    <div className="font-medium">{c.request.procedure}</div>
                    <div className="text-xs text-muted-foreground">Side: {c.request.side} · {c.request.urgency}</div>
                  </Td>
                  <Td>{c.request.surgeon}</Td>
                  <Td>
                    {c.schedule ? (
                      <>
                        <div className="font-medium">{c.schedule.room}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">{c.schedule.date}, {c.schedule.start} to {scheduleEnd(c.schedule)}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-muted-foreground">Not scheduled</div>
                        <div className="text-xs tabular-nums text-muted-foreground">Planned {c.request.plannedDate}</div>
                      </>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={STAGE_TONE[stage]}>{c.closed ? `Closed: ${c.closed.outcome}` : stage}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">{doneCount} of {STEPS.length} steps done</div>
                  </Td>
                  <Td className="max-w-[240px]">{nextAction(c)}</Td>
                  <Td>
                    <Button size="sm" variant={c.closed ? "secondary" : "primary"} onClick={() => navigate("/chart", { visit: c.visit, s: "surgery", case: c.id })}>Open Case</Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
