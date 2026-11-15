import * as React from "react";
import { FolderOpen, RotateCcw, Scissors } from "lucide-react";
import { IconCalendarEvent, IconCalendarPause, IconCircleCheck, IconClipboardList, IconHeartbeat, IconScissors } from "@tabler/icons-react";
import { SCHEDULE_TONE, STAGE_TONE } from "@/components/emr/TheatreSection";
import { CellSub, DataTable, ListPage, ListToolbar, StatFilters, useList, type Column, type FilterDef } from "@/components/list";
import { Badge } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { fmtDate } from "@/lib/format";
import { navigate } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { resetTheatre, useTheatre } from "@/lib/theatre";
import { STEPS, caseStage, isBooked, nextAction, scheduleEnd, scheduleStatus, stepDone, type SurgeryCase } from "@/lib/theatre-logic";

type FilterId = "action" | "postponed" | "today" | "theatre" | "recovery" | "closed";

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const STAGES: { id: FilterId; label: string; icon: React.ReactNode; test: (c: SurgeryCase) => boolean }[] = [
  { id: "action", label: "Needs Action", icon: <IconClipboardList stroke={1.75} />, test: (c) => !c.closed },
  { id: "postponed", label: "Postponed", icon: <IconCalendarPause stroke={1.75} />, test: (c) => caseStage(c) === "Postponed" },
  { id: "today", label: "Today", icon: <IconCalendarEvent stroke={1.75} />, test: (c) => (c.schedule?.date ?? c.request.plannedDate) === today() },
  { id: "theatre", label: "In Theatre", icon: <IconScissors stroke={1.75} />, test: (c) => ["In Theatre", "Note Needed"].includes(caseStage(c)) },
  { id: "recovery", label: "In Recovery", icon: <IconHeartbeat stroke={1.75} />, test: (c) => caseStage(c) === "In Recovery" },
  { id: "closed", label: "Closed", icon: <IconCircleCheck stroke={1.75} />, test: (c) => !!c.closed },
];

/** When the case is due: the booked slot, or the planned date while it is not booked yet. */
const sortKey = (c: SurgeryCase) => (c.schedule?.date ? `${c.schedule.date}T${c.schedule.start || "99:99"}` : `${c.request.plannedDate}T99:99`);

/** Every surgery case in the hospital, one row each, with the step that is waiting. */
export function TheatreListPage() {
  const theatre = useTheatre();
  const his = useHis();
  const dev = useDevMode();
  useSession();

  const rows = theatre.cases.map((c) => {
    const p = his.patients.find((x) => x.id === c.patientId);
    return { c, p, name: p?.confidential && !hasGlass(p.id) ? "Confidential Patient" : patientName(p), stage: caseStage(c), sched: scheduleStatus(c) };
  });
  type Row = (typeof rows)[number];

  const filters: FilterDef<Row>[] = [
    { id: "stage", label: "Stage", options: STAGES.map((s) => ({ value: s.id, label: s.label })), test: (r, v) => STAGES.find((s) => s.id === v)!.test(r.c) },
    { id: "surgeon", label: "Surgeon", quick: true, options: [...new Set(theatre.cases.map((c) => c.request.surgeon))].sort().map((s) => ({ value: s, label: s })), test: (r, v) => r.c.request.surgeon === v },
    { id: "room", label: "Room", options: [...new Set(theatre.cases.map((c) => c.schedule?.room).filter(Boolean) as string[])].sort().map((s) => ({ value: s, label: s })), test: (r, v) => r.c.schedule?.room === v },
    { id: "urgency", label: "Urgency", options: [...new Set(theatre.cases.map((c) => c.request.urgency))].sort().map((s) => ({ value: s, label: s })), test: (r, v) => r.c.request.urgency === v },
  ];

  const columns: Column<Row>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (r) => r.name,
      cell: (r) => (
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className="font-semibold text-[#032c26] dark:text-foreground">{r.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{r.p?.mrn}</span>
          {dev && <span className="font-mono text-xs text-muted-foreground">{r.c.id}</span>}
        </span>
      ),
    },
    {
      id: "procedure", header: "Procedure", value: (r) => r.c.request.procedure,
      cell: (r) => <div className="min-w-44"><div className="font-medium">{r.c.request.procedure}</div><CellSub>{r.c.request.side} side, {r.c.request.urgency}</CellSub></div>,
    },
    { id: "surgeon", header: "Surgeon", value: (r) => r.c.request.surgeon, cell: (r) => <span className="whitespace-nowrap">{r.c.request.surgeon}</span> },
    {
      id: "when", header: "Room And Time", value: (r) => sortKey(r.c), csv: (r) => (r.c.schedule ? `${r.c.schedule.room ?? ""} ${r.c.schedule.date} ${r.c.schedule.start ?? ""}` : `Planned ${r.c.request.plannedDate}`),
      cell: (r) => r.c.schedule ? (
        <span className="whitespace-nowrap tabular-nums" title={[r.sched, isBooked(r.c) ? "" : "Does not hold the room"].filter(Boolean).join(". ") || undefined}>
          <span className="font-medium">{r.c.schedule.room || "No Room Yet"}</span>
          <span className="text-muted-foreground">, {fmtDate(r.c.schedule.date)}{r.c.schedule.start ? ` ${r.c.schedule.start} to ${scheduleEnd(r.c.schedule)}` : ""}</span>
        </span>
      ) : (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">Not Scheduled, planned {fmtDate(r.c.request.plannedDate)}</span>
      ),
    },
    {
      id: "stage", header: "Stage", value: (r) => (r.c.closed ? `Closed: ${r.c.closed.outcome}` : r.stage),
      cell: (r) => (
        <div className="whitespace-nowrap">
          <Badge tone={STAGE_TONE[r.stage]}>{r.c.closed ? `Closed: ${r.c.closed.outcome}` : r.stage}</Badge>
          <CellSub className="mt-0.5">{STEPS.filter((s) => stepDone(r.c, s.id)).length} of {STEPS.length} steps done</CellSub>
        </div>
      ),
    },
    { id: "next", header: "Next Step", value: (r) => nextAction(r.c), cell: (r) => <span className="block max-w-72 truncate" title={nextAction(r.c)}>{nextAction(r.c)}</span> },
    { id: "sched", header: "Schedule", defaultHidden: true, value: (r) => r.sched ?? "", cell: (r) => (r.sched ? <Badge tone={SCHEDULE_TONE[r.sched]}>{r.sched}</Badge> : <span className="text-muted-foreground">None</span>) },
  ];

  const list = useList({
    id: "theatre",
    title: "Theatre List",
    rows,
    columns,
    getId: (r) => r.c.id,
    filters,
    initialFilters: { stage: "action" },
    initialSort: { key: "when", dir: "asc" },
    unit: ["case", "cases"],
    search: (r) => `${r.name} ${r.p?.mrn ?? ""} ${r.c.visit} ${r.c.id} ${r.c.request.procedure} ${r.c.request.surgeon} ${r.c.schedule?.room ?? ""} ${r.sched ?? ""}`,
  });
  const openCase = (r: Row) => navigate("/chart", { visit: r.c.visit, s: "surgery", case: r.c.id });

  return (
    <ListPage
      title="Theatre List"
      subtitle="Every surgery case and the step it is waiting for."
      more={[dev && { label: "Reset Theatre Demo Data", icon: <RotateCcw className="size-4" />, title: "Brings back the demo cases and removes the others", onClick: resetTheatre }]}
      kpis={<StatFilters label="Cases by stage" value={list.filterValues.stage ?? ""} onChange={(v) => list.setFilter("stage", v)}
        items={STAGES.map((s) => ({ id: s.id, label: s.label, icon: s.icon, value: theatre.cases.filter(s.test).length }))} />}
    >
      <ListToolbar list={list} placeholder="Patient, procedure or surgeon" />
      <DataTable
        list={list}
        label="Surgery cases"
        rowLabel={(r) => `${r.name}, ${r.c.request.procedure}`}
        onRowClick={openCase}
        actions={(r) => [{ id: "open", label: "Open Case", icon: <FolderOpen />, emphasis: !r.c.closed, onClick: () => openCase(r) }]}
        inline={1}
        card={(r) => ({
          title: r.name,
          aside: <Badge tone={STAGE_TONE[r.stage]}>{r.c.closed ? "Closed" : r.stage}</Badge>,
          lines: [
            <span key="a">{r.c.request.procedure}, {r.c.request.surgeon}</span>,
            <span key="b" className="tabular-nums">{r.c.schedule ? `${r.c.schedule.room || "No room"}, ${fmtDate(r.c.schedule.date)}${r.c.schedule.start ? ` ${r.c.schedule.start}` : ""}` : `Planned ${fmtDate(r.c.request.plannedDate)}`}</span>,
          ],
        })}
        empty={{
          icon: <Scissors />,
          title: "No Surgery Cases Yet",
          text: "A case starts with a surgery request in the patient chart, under Surgery Case. A step opens only when the one before it is done.",
        }}
      />
    </ListPage>
  );
}
