import { CalendarPlus, FolderOpen, Route } from "lucide-react";
import { CellSub, DataTable, ListPage, ListToolbar, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { Badge } from "@/components/ui/primitives";
import { useAdmissionRequests } from "@/lib/admission-requests";
import { dayLabel, doctorName, useAppointments } from "@/lib/appointments";
import { useDevMode } from "@/lib/devmode";
import { fmtDateTime } from "@/lib/format";
import { SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { bedLabel, patientName, useHis } from "@/lib/store";
import { visitStatus } from "@/pages/WorklistPage";
import { appointmentLabel, appointmentTone, followUpAfter, isOpenAppointment, reclassifiedVisits, subDepartmentOf } from "@/lib/worklist";

/**
 * Reclassified To Outpatient: inpatient stays changed to outpatient with A07. These patients usually need a clinic slot.
 * A follow-up after a normal discharge is an ordinary appointment and does not show here.
 */
export function ReclassifiedVisitsPage() {
  const state = useHis();
  const { appointments } = useAppointments();
  const { requests } = useAdmissionRequests();
  const dev = useDevMode();
  useSession();

  const rows = reclassifiedVisits(state).map(({ enc, at, fromBed }) => {
    const p = state.patients.find((x) => x.id === enc.patientId);
    const appt = followUpAfter(enc.patientId, at, appointments);
    return {
      enc, at, fromBed, p, appt,
      booked: !!appt && isOpenAppointment(appt),
      name: p?.confidential && !hasGlass(p.id) ? "Confidential Patient" : patientName(p),
      dept: SERVICES.find((s) => s.code === enc.service),
      status: visitStatus(enc),
    };
  });
  type Row = (typeof rows)[number];

  const filters: FilterDef<Row>[] = [
    { id: "follow", label: "Follow-Up", quick: true, options: [{ value: "booked", label: "Booked" }, { value: "none", label: "Not Booked" }], test: (r, v) => (v === "booked") === r.booked },
    { id: "dept", label: "Department", quick: true, options: SERVICES.map((s) => ({ value: s.code, label: s.label })), test: (r, v) => r.enc.service === v },
  ];

  const columns: Column<Row>[] = [
    { id: "patient", header: "Patient", hideable: false, value: (r) => r.name, cell: (r) => <span className="flex items-center gap-2 whitespace-nowrap"><span className="font-semibold text-[#032c26] dark:text-foreground">{r.name}</span><span className="font-mono text-xs text-muted-foreground">{r.p?.mrn}</span></span> },
    { id: "visit", header: "Visit", value: (r) => r.enc.visitNumber, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.enc.visitNumber}</span> },
    { id: "dept", header: "Department", value: (r) => r.dept?.label ?? r.enc.service, cell: (r) => <div><div className="whitespace-nowrap">{r.dept?.label ?? r.enc.service}</div><CellSub>{subDepartmentOf(r.enc, requests, appointments)}</CellSub></div> },
    { id: "doctor", header: "Doctor", value: (r) => doctorName(r.enc.attending), cell: (r) => <span className="whitespace-nowrap">{doctorName(r.enc.attending)}</span> },
    { id: "at", header: "Reclassified On", value: (r) => r.at, csv: (r) => fmtDateTime(r.at), cell: (r) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(r.at)}{dev && <span className="ms-1 font-mono text-xs text-muted-foreground">A07</span>}</span> },
    { id: "bed", header: "Previous Bed", value: (r) => (r.fromBed ? bedLabel(r.fromBed) : ""), cell: (r) => <span className="whitespace-nowrap">{r.fromBed ? bedLabel(r.fromBed) : "None"}</span> },
    { id: "status", header: "Visit Status", defaultHidden: true, value: (r) => r.status.label, cell: (r) => <Badge tone={r.status.tone}>{r.status.label}</Badge> },
    {
      id: "follow", header: "Follow-Up", value: (r) => (r.appt ? appointmentLabel(r.appt) : "Not Booked"),
      cell: (r) => r.appt
        ? <span className="whitespace-nowrap" title={`${dayLabel(r.appt.date)}, ${r.appt.start}`}><Badge tone={appointmentTone(r.appt)}>{appointmentLabel(r.appt)}</Badge> <span className="text-xs text-muted-foreground">{dayLabel(r.appt.date)}, {r.appt.start}</span></span>
        : <Badge tone="warn">Not Booked</Badge>,
    },
  ];

  const list = useList({
    id: "reclassified",
    title: "Reclassified To Outpatient",
    rows,
    columns,
    getId: (r) => r.enc.visitNumber,
    filters,
    initialSort: { key: "at", dir: "desc" },
    unit: ["visit", "visits"],
    search: (r) => `${r.name} ${r.p?.mrn ?? ""} ${r.enc.visitNumber}`,
  });

  const actions = (r: Row): RowAction[] => [
    ...(!r.booked ? [{ id: "book", label: "Book Follow-Up", icon: <CalendarPlus />, emphasis: true, onClick: () => navigate("/appointments") }] : []),
    { id: "chart", label: "Open Chart", icon: <FolderOpen />, onClick: () => navigate("/chart", { visit: r.enc.visitNumber }) },
  ];

  return (
    <ListPage title="Reclassified To Outpatient" subtitle="Inpatient stays changed to outpatient. Book each patient a clinic follow-up.">
      <ListToolbar list={list} placeholder="Name, MRN or visit" />
      <DataTable
        list={list}
        label="Reclassified visits"
        rowLabel={(r) => r.name}
        onRowClick={(r) => navigate("/chart", { visit: r.enc.visitNumber })}
        actions={actions}
        card={(r) => ({
          title: r.name,
          aside: r.booked && r.appt ? <Badge tone={appointmentTone(r.appt)}>{appointmentLabel(r.appt)}</Badge> : <Badge tone="warn">Not Booked</Badge>,
          lines: [<span key="a">{r.dept?.label ?? r.enc.service}, {doctorName(r.enc.attending)}</span>, <span key="b" className="tabular-nums">Reclassified {fmtDateTime(r.at)}</span>],
        })}
        empty={{
          icon: <Route />,
          title: "No Reclassified Visits",
          text: "Inpatient stays changed to outpatient (A07) appear here. A follow-up after a normal discharge is an ordinary appointment and is not listed.",
        }}
      />
    </ListPage>
  );
}
