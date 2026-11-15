import * as React from "react";
import { BedDouble, FlaskConical, FolderOpen, Siren, Stethoscope, Users } from "lucide-react";
import { CellSub, DataTable, ListPage, ListToolbar, StatFilters, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { Badge, Select } from "@/components/ui/primitives";
import { fmtShort } from "@/lib/format";
import { useLab } from "@/lib/lab";
import { GROUP_LABEL, doctorIdOf, groupOf, resultsOf, type PatientGroup } from "@/lib/my-patients";
import { useRad } from "@/lib/radiology";
import { DOCTORS, SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { bedLabel, nowLocal, patientName, useHis } from "@/lib/store";
import { visitStatus } from "@/pages/WorklistPage";

/**
 * My Patients: the doctor's landing view. One table of the signed-in doctor's current patients (inpatients, today's
 * clinic, emergency) with location, status, new results and alerts. One click on a row opens the chart.
 * Staff who are not doctors choose whose list to see.
 */

const GROUP_TONE: Record<PatientGroup, "ok" | "move" | "danger"> = { inpatient: "ok", clinic: "move", emergency: "danger" };
const ageOf = (dob: string) => Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));
const docName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "Not assigned";
};

export function MyPatientsPage() {
  const his = useHis();
  const labs = useLab().orders;
  const rads = useRad().orders;
  const { user } = useSession();
  const mine = doctorIdOf(user.name);
  const [doctor, setDoctor] = React.useState<string>(mine ?? "all");
  React.useEffect(() => setDoctor(mine ?? "all"), [mine]);
  const [group, setGroup] = React.useState("");
  const today = nowLocal().slice(0, 10);

  const all = his.encounters.flatMap((enc) => {
    const g = groupOf(enc, today);
    if (!g || (doctor !== "all" && enc.attending !== doctor)) return [];
    const p = his.patients.find((x) => x.id === enc.patientId);
    if (!p) return [];
    const hidden = !!p.confidential && !hasGlass(p.id);
    const res = resultsOf(enc.visitNumber, labs, rads);
    const allergies = hidden ? [] : enc.allergies.map((a) => a.text);
    return [{
      enc, p, g, hidden, res, allergies,
      name: hidden ? "Confidential Patient" : patientName(p),
      location: g === "inpatient" ? bedLabel(enc.bedId) : SERVICES.find((s) => s.code === enc.service)?.label ?? (g === "emergency" ? "Emergency" : "Clinic"),
      status: visitStatus(enc),
      since: enc.admitAt ?? enc.expectedAdmitAt ?? "",
      dx: hidden ? "" : enc.dx[0] ? `${enc.dx[0].code} ${enc.dx[0].text}` : enc.reason,
      alerts: res.critical + (allergies.length ? 1 : 0),
    }];
  });
  type Row = (typeof all)[number];
  const rows = group ? all.filter((r) => r.g === group) : all;
  const count = (g: PatientGroup) => all.filter((r) => r.g === g).length;

  const filters: FilterDef<Row>[] = [
    { id: "results", label: "Results", quick: true, options: [{ value: "new", label: "New Results" }, { value: "critical", label: "Critical" }, { value: "pending", label: "Waiting For Results" }], test: (r, v) => (v === "new" ? r.res.fresh > 0 : v === "critical" ? r.res.critical > 0 : r.res.pending > 0) },
  ];

  const columns: Column<Row>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (r) => r.name,
      cell: (r) => (
        <div>
          <div className="font-semibold whitespace-nowrap text-[#032c26] dark:text-foreground">{r.name}</div>
          <CellSub>{r.hidden ? "Details hidden" : `${ageOf(r.p.dob)} years, ${r.p.sex === "F" ? "Female" : "Male"}, MRN ${r.p.mrn}`}</CellSub>
        </div>
      ),
    },
    { id: "group", header: "List", value: (r) => GROUP_LABEL[r.g], cell: (r) => <Badge tone={GROUP_TONE[r.g]}>{GROUP_LABEL[r.g]}</Badge> },
    { id: "location", header: "Location", value: (r) => r.location, cell: (r) => <span className="whitespace-nowrap">{r.location}</span> },
    { id: "status", header: "Status", value: (r) => r.status.label, cell: (r) => <div><Badge tone={r.status.tone}>{r.status.label}</Badge><CellSub>Since {fmtShort(r.since)}</CellSub></div> },
    { id: "dx", header: "Diagnosis Or Reason", value: (r) => r.dx, cell: (r) => <span className="line-clamp-2 min-w-40">{r.dx || "Not recorded"}</span> },
    {
      id: "results", header: "New Results", value: (r) => r.res.fresh,
      cell: (r) => r.res.fresh > 0 ? (
        <div>
          <Badge tone="info">{r.res.fresh} New</Badge>
          <CellSub>{r.res.abnormal > 0 ? `${r.res.abnormal} abnormal, ` : ""}latest {fmtShort(r.res.latest)}</CellSub>
        </div>
      ) : <span className="text-muted-foreground">{r.res.pending > 0 ? `${r.res.pending} waiting` : "None"}</span>,
    },
    {
      id: "alerts", header: "Alerts", value: (r) => r.alerts,
      cell: (r) => r.alerts === 0 ? <span className="text-muted-foreground">None</span> : (
        <div className="flex flex-wrap gap-1">
          {r.res.critical > 0 && <Badge tone="danger">{r.res.critical} Critical {r.res.critical === 1 ? "Result" : "Results"}</Badge>}
          {r.allergies.length > 0 && <span title={r.allergies.join(", ")}><Badge tone="warn">{r.allergies.length === 1 ? `Allergy: ${r.allergies[0]}` : `${r.allergies.length} Allergies`}</Badge></span>}
        </div>
      ),
    },
    { id: "doctor", header: "Doctor", defaultHidden: doctor !== "all", value: (r) => docName(r.enc.attending), cell: (r) => <span className="whitespace-nowrap">{docName(r.enc.attending)}</span> },
    { id: "visit", header: "Visit", defaultHidden: true, value: (r) => r.enc.visitNumber, cell: (r) => <span className="font-mono text-xs">{r.enc.visitNumber}</span> },
  ];

  const list = useList({
    id: "my-patients",
    title: "My Patients",
    rows,
    columns,
    getId: (r) => r.enc.visitNumber,
    filters,
    initialSort: { key: "alerts", dir: "desc" },
    unit: ["patient", "patients"],
    search: (r) => `${r.name} ${r.hidden ? "" : r.p.mrn} ${r.enc.visitNumber} ${r.location}`,
  });

  const open = (r: Row, s?: string) => navigate("/chart", s ? { visit: r.enc.visitNumber, s } : { visit: r.enc.visitNumber });
  const actions = (r: Row): RowAction[] => [
    { id: "chart", label: "Open Chart", icon: <FolderOpen />, emphasis: true, onClick: () => open(r) },
    { id: "results", label: "Laboratory Results", icon: <FlaskConical />, onClick: () => open(r, "laboratory") },
  ];

  const whose = doctor === "all" ? "All doctors" : doctor === mine ? "Your" : docName(doctor);
  return (
    <ListPage
      title="My Patients"
      subtitle={`${whose} current patients: inpatients, today's clinic and emergency. Select a row to open the chart.`}
      aside={
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Doctor</span>
          <Select className="w-56" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label="Whose patients to show">
            <option value="all">All Doctors</option>
            {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}{d.id === mine ? " (You)" : ""}</option>)}
          </Select>
        </label>
      }
    >
      <StatFilters
        label="Patient lists"
        value={group}
        onChange={setGroup}
        items={[
          { id: "inpatient", label: "Inpatients", value: count("inpatient"), icon: <BedDouble /> },
          { id: "clinic", label: "Today's Clinic", value: count("clinic"), icon: <Stethoscope /> },
          { id: "emergency", label: "Emergency", value: count("emergency"), icon: <Siren />, alert: true },
        ]}
      />
      <ListToolbar list={list} placeholder="Name, MRN, visit or bed" exportable={false} />
      <DataTable
        list={list}
        label="My patients"
        rowLabel={(r) => r.name}
        onRowClick={(r) => open(r)}
        actions={actions}
        card={(r) => ({
          title: r.name,
          aside: <Badge tone={GROUP_TONE[r.g]}>{GROUP_LABEL[r.g]}</Badge>,
          lines: [
            <span key="a">{r.location}, {r.status.label}</span>,
            <span key="b">{r.res.fresh > 0 ? `${r.res.fresh} new results` : "No new results"}{r.res.critical > 0 ? `, ${r.res.critical} critical` : ""}{r.allergies.length ? `, allergy: ${r.allergies.join(", ")}` : ""}</span>,
          ],
        })}
        empty={{
          icon: <Users />,
          title: "No Current Patients",
          text: doctor === "all" ? "No patient is admitted, in today's clinic or in emergency right now." : "This doctor has no inpatients, clinic patients today or emergency patients. Choose All Doctors to see everyone.",
        }}
      />
    </ListPage>
  );
}
