import * as React from "react";
import { BadgeCheck, CalendarPlus, FolderOpen, GitMerge, History, IdCard, PenLine, Printer, ShieldCheck, UserPlus, Users } from "lucide-react";
import { IconBed, IconCalendarPlus, IconDoorExit, IconStethoscope } from "@tabler/icons-react";
import { Dialog } from "@/components/Dialog";
import { DataTable, ListPage, ListToolbar, StatFilters, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { fmtDate } from "@/components/list/format";
import { Badge, Button } from "@/components/ui/primitives";
import { PatientFlagBadges, PatientNameAr } from "@/components/PatientBanner";
import { WristbandDialog } from "@/components/Wristband";
import { useVisitActions } from "@/components/VisitActions";
import { CoverageDialog } from "@/components/patient/CoverageDialog";
import { EligibilityDialog } from "@/components/patient/EligibilityDialog";
import { MergePatientsDialog } from "@/components/patient/MergePatientsDialog";
import { audit } from "@/lib/audit";
import { coverageLabel, coveragesOf, latestEligibility, primaryCoverage, useCoverages, type EligibilityAnswer } from "@/lib/coverage";
import { useDevMode } from "@/lib/devmode";
import type { Encounter, Patient } from "@/lib/model";
import { ageLabel, arabicName, fetchHealthId, listName } from "@/lib/registration";
import { navigate, useRoute } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { bedLabel, nowLocal, useHis } from "@/lib/store";
import { visitStatus } from "@/pages/WorklistPage";

/** National Health ID: the Health ID on file, and a check against the national registry with the ID number and date of birth. */
function HealthIdDialog({ patient, onClose }: { patient: Patient | undefined; onClose: () => void }) {
  const [answer, setAnswer] = React.useState<ReturnType<typeof fetchHealthId> | null>(null);
  React.useEffect(() => setAnswer(null), [patient?.id]);
  if (!patient) return null;
  const idNumber = patient.extra?.idNumber || patient.nationalId;
  const name = listName(patient, hasGlass(patient.id));
  function check() {
    const a = fetchHealthId(idNumber, patient!.dob, nowLocal().slice(0, 10));
    setAnswer(a);
    audit("view", "National registry Health ID lookup", { patient: name, detail: a.ok ? (a.healthId === patient!.healthId ? "Matches the file" : "Differs from the file") : a.message });
  }
  return (
    <Dialog open onClose={onClose} title="National Health ID" subtitle={`${name}, ${patient.mrn}`} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Health ID</dt><dd className="font-mono font-semibold">{patient.healthId || "None"}</dd>
        <dt className="text-muted-foreground">ID Number</dt><dd className="font-mono">{idNumber || "None"}</dd>
        <dt className="text-muted-foreground">Date of Birth</dt><dd>{fmtDate(patient.dob) || "Not known"}</dd>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">The Health ID is issued by the NHIC patient registry. Every message to the national platform carries it.</p>
      <Button className="mt-3" onClick={check} disabled={!idNumber || !patient.dob}><ShieldCheck className="size-4" />Check With The Registry</Button>
      {answer && (
        <p role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm ${answer.ok && answer.healthId === patient.healthId ? "border-ok/40 bg-ok/10" : "border-warn/50 bg-warn/10"}`}>
          {!answer.ok ? answer.message : answer.healthId === patient.healthId
            ? "The registry returned the same Health ID. The file is correct."
            : `The registry returned ${answer.healthId}, which differs from the file. Correct it with Update Identity.`}
        </p>
      )}
    </Dialog>
  );
}

const CLASS_TEXT: Record<string, string> = { I: "Inpatient", O: "Outpatient", E: "Emergency", P: "Pre-Admit" };

/** Where the patient is now, for the stat chips and the filter. */
type Where = "inpatient" | "outpatient" | "preadmit" | "discharged" | "none";
function whereOf(e: Encounter | undefined): Where {
  if (!e) return "none";
  if (e.status === "preadmit") return "preadmit";
  if (e.status === "discharged") return "discharged";
  if (e.status === "active") return e.cls === "I" ? "inpatient" : "outpatient";
  return "none";
}

function EligibilityPill({ answer, insured }: { answer?: EligibilityAnswer; insured: boolean }) {
  if (!insured) return <span className="text-muted-foreground">Cash</span>;
  if (!answer) return <span className="text-muted-foreground">Not Checked</span>;
  const warn = answer.eligible && answer.kind !== "covered";
  return (
    <span title={`${answer.title}. ${answer.text} Checked ${fmtDate(answer.at)}.`}>
      <Badge tone={answer.eligible ? (warn ? "warn" : "ok") : "danger"}>{answer.eligible ? (warn ? "Eligible, Limited" : "Eligible") : "Not Eligible"}</Badge>
    </span>
  );
}

export function PatientsPage() {
  const state = useHis();
  const covers = useCoverages();
  useSession();
  const dev = useDevMode();
  const route = useRoute();
  const { openRegister, dialogs } = useVisitActions();
  /** Set when another screen opens one patient, for example from the duplicate check at registration. */
  const only = route.params.get("patient");
  const [band, setBand] = React.useState<string | null>(null);
  const [coverageFor, setCoverageFor] = React.useState<string | null>(null);
  const [eligibilityFor, setEligibilityFor] = React.useState<string | null>(null);
  const [healthIdFor, setHealthIdFor] = React.useState<string | null>(null);
  const [merge, setMerge] = React.useState(false);
  const today = nowLocal().slice(0, 10);
  const mayRegister = can("patient.register");

  const all = state.patients
    .filter((p) => !p.mergedInto)
    .filter((p) => !only || p.id === only)
    .map((p) => {
      const encs = state.encounters.filter((e) => e.patientId === p.id && e.status !== "cancelled");
      const latest = [...encs].reverse().find((e) => e.status === "active" || e.status === "preadmit") ?? encs[encs.length - 1];
      const list = coveragesOf(p.id, covers, state.patients);
      const primary = primaryCoverage(list, today);
      const opened = hasGlass(p.id);
      return { p, latest, primary, eligibility: latestEligibility(list), opened, hidden: !!p.confidential && !opened, where: whereOf(latest) };
    });
  type Row = (typeof all)[number];

  const filters: FilterDef<Row>[] = [
    { id: "where", label: "Current Visit", options: [
      { value: "inpatient", label: "Inpatient" }, { value: "outpatient", label: "Outpatient Or Emergency" }, { value: "preadmit", label: "Pre-Admit" },
      { value: "discharged", label: "Discharged" }, { value: "none", label: "No Visit" },
    ], test: (r, v) => r.where === v },
    { id: "coverage", label: "Coverage", quick: true, options: [{ value: "insured", label: "Insurance" }, { value: "cash", label: "Cash" }], test: (r, v) => (v === "cash") === !r.primary },
    { id: "elig", label: "Eligibility", quick: true, options: [
      { value: "eligible", label: "Eligible" }, { value: "not", label: "Not Eligible" }, { value: "unchecked", label: "Not Checked" },
    ], test: (r, v) => (v === "unchecked" ? !!r.primary && !r.eligibility : v === "eligible" ? !!r.eligibility?.eligible : !!r.eligibility && !r.eligibility.eligible) },
    { id: "sex", label: "Sex", options: [{ value: "M", label: "Male" }, { value: "F", label: "Female" }], test: (r, v) => r.p.sex === v },
    { id: "flag", label: "Record", options: [{ value: "confidential", label: "Confidential" }, { value: "newborn", label: "Newborn" }],
      test: (r, v) => (v === "confidential" ? !!r.p.confidential : !!r.p.extra?.newborn) },
  ];

  const columns: Column<Row>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (r) => listName(r.p, r.opened),
      cell: (r) => (
        <div className="min-w-44">
          <div className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground">
            {listName(r.p, r.opened)}
            {r.p.confidential && <Badge tone="warn">Confidential</Badge>}
            {r.p.extra?.newborn && <Badge tone="info">Newborn</Badge>}
            <PatientFlagBadges patient={r.p} />
          </div>
          {!r.hidden && <PatientNameAr patient={r.p} className="text-start text-xs leading-tight in-data-[list-density=compact]:hidden" />}
        </div>
      ),
    },
    { id: "mrn", header: "MRN", value: (r) => r.p.mrn, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.p.mrn}</span> },
    { id: "healthId", header: "Health ID", value: (r) => r.p.healthId, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.p.healthId || "None"}</span> },
    {
      id: "age", header: "Age And Sex", value: (r) => r.p.dob ? -new Date(r.p.dob).getTime() : undefined, csv: (r) => `${ageLabel(r.p.dob)}, ${r.p.sex === "M" ? "Male" : "Female"}`,
      cell: (r) => <span className="whitespace-nowrap">{ageLabel(r.p.dob) || "Not known"}, {r.p.sex === "M" ? "Male" : "Female"}</span>,
    },
    { id: "phone", header: "Phone", defaultHidden: true, value: (r) => (r.hidden ? "" : r.p.extra?.mobile ?? ""), cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.hidden ? "Hidden" : r.p.extra?.mobile || "None"}</span> },
    {
      id: "coverage", header: "Coverage", value: (r) => coverageLabel(r.primary),
      cell: (r) => r.primary
        ? <span className="block max-w-48 truncate" title={`${coverageLabel(r.primary)}, member ${r.primary.memberId}`}>{coverageLabel(r.primary)}</span>
        : <span className="text-muted-foreground">Cash</span>,
    },
    {
      id: "elig", header: "Eligibility", value: (r) => (!r.primary ? "Cash" : !r.eligibility ? "Not Checked" : r.eligibility.eligible ? "Eligible" : "Not Eligible"),
      cell: (r) => <EligibilityPill answer={r.eligibility} insured={!!r.primary} />,
    },
    { id: "class", header: "Class", value: (r) => (r.latest ? CLASS_TEXT[r.latest.cls] : ""), cell: (r) => (r.latest ? CLASS_TEXT[r.latest.cls] : <span className="text-muted-foreground">None</span>) },
    {
      id: "status", header: "Visit Status", value: (r) => (r.latest ? visitStatus(r.latest).label : "No Visit"),
      cell: (r) => {
        if (!r.latest) return <span className="text-muted-foreground">No Visit</span>;
        const st = visitStatus(r.latest);
        const bed = r.latest.status === "active" && r.latest.bedId ? bedLabel(r.latest.bedId) : "";
        return <span title={[r.latest.visitNumber, bed].filter(Boolean).join(", ")}><Badge tone={st.tone}>{st.label}</Badge></span>;
      },
    },
    { id: "visit", header: "Visit", defaultHidden: true, value: (r) => r.latest?.visitNumber, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.latest?.visitNumber ?? "None"}</span> },
  ];

  const list = useList({
    id: "patients",
    title: "Patients",
    rows: all,
    columns,
    getId: (r) => r.p.id,
    filters,
    unit: ["patient", "patients"],
    search: (r) => r.hidden
      // A confidential patient is found by nick name, file number or Health ID, not by the real name, until the record is opened.
      ? `${r.p.extra?.nickName ?? ""} ${r.p.mrn} ${r.p.healthId}`
      : `${r.p.given} ${r.p.family} ${r.p.extra?.nickName ?? ""} ${r.p.mrn} ${r.p.nationalId} ${r.p.extra?.idNumber ?? ""} ${r.p.healthId} ${r.p.extra?.mobile ?? ""} ${arabicName(r.p)}`,
  });

  const openChart = (r: Row) => r.latest && navigate("/chart", { visit: r.latest.visitNumber });
  const active = (r: Row) => r.latest?.status === "active" || r.latest?.status === "preadmit";

  const actions = (r: Row): RowAction[] => {
    const out: RowAction[] = [];
    // One step on the row: open the chart of a visit that is running, or start a visit for someone who has none.
    if (active(r)) out.push({ id: "chart", label: "Open Chart", icon: <FolderOpen />, onClick: () => openChart(r) });
    else if (mayRegister) out.push({ id: "visit", label: "Register Visit", icon: <CalendarPlus />, onClick: () => openRegister("A04", { patientId: r.p.id }) });
    else if (r.latest) out.push({ id: "chart", label: "Open Chart", icon: <FolderOpen />, onClick: () => openChart(r) });
    if (r.latest && out[0]?.id !== "chart") out.push({ id: "chart", label: "Open Last Chart", icon: <FolderOpen />, onClick: () => openChart(r) });
    out.push(
      { id: "coverage", label: "Patient Coverage", icon: <ShieldCheck />, onClick: () => setCoverageFor(r.p.id) },
      { id: "elig", label: "Eligibility Request", icon: <BadgeCheck />, onClick: () => setEligibilityFor(r.p.id) },
      { id: "band", label: "Print Wristband", icon: <Printer />, onClick: () => setBand(r.p.id) },
      { id: "hid", label: "National Health ID", icon: <IdCard />, onClick: () => setHealthIdFor(r.p.id) },
    );
    if (dev) {
      out.push({ id: "identity", label: "Update Identity", icon: <PenLine />, separate: true, onClick: () => navigate("/event/A31", { patient: r.p.id, enc: r.latest?.visitNumber }) });
      if (r.latest) out.push({ id: "timeline", label: "View Timeline", icon: <History />, onClick: () => navigate("/encounters", { visit: r.latest!.visitNumber }) });
    }
    return out;
  };

  const count = (w: Where) => all.filter((r) => r.where === w).length;
  const stats = [
    { id: "inpatient", label: "Inpatients", value: count("inpatient"), icon: <IconBed stroke={1.75} /> },
    { id: "outpatient", label: "Outpatients", value: count("outpatient"), icon: <IconStethoscope stroke={1.75} /> },
    { id: "preadmit", label: "Pre-Admits", value: count("preadmit"), icon: <IconCalendarPlus stroke={1.75} /> },
    { id: "discharged", label: "Discharged", value: count("discharged"), icon: <IconDoorExit stroke={1.75} /> },
  ];

  return (
    <ListPage
      title="Patients"
      subtitle="Every patient file. Open a row to go to the chart."
      primary={mayRegister ? { label: "Register Patient", icon: <UserPlus className="size-4" aria-hidden="true" />, onClick: () => navigate("/registration") } : undefined}
      more={[mayRegister && { label: "Merge Patients", icon: <GitMerge className="size-4" />, onClick: () => setMerge(true) }]}
      kpis={<StatFilters label="Patients by current visit" items={stats} value={list.filterValues.where ?? ""} onChange={(v) => list.setFilter("where", v)} />}
    >
      {only && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#03c1ac]/40 bg-[#39edd5]/10 px-3 py-2 text-sm">
          <span>Showing one patient.</span>
          <Button size="sm" onClick={() => navigate("/patients")}>Show All Patients</Button>
        </div>
      )}
      <ListToolbar list={list} placeholder="Name, MRN, ID or phone" />
      <DataTable
        list={list}
        label="Patients"
        rowLabel={(r) => listName(r.p, r.opened)}
        onRowClick={(r) => (r.latest ? openChart(r) : mayRegister ? openRegister("A04", { patientId: r.p.id }) : setCoverageFor(r.p.id))}
        actions={actions}
        inline={1}
        card={(r) => {
          const st = r.latest && visitStatus(r.latest);
          return {
            title: <span className="flex flex-wrap items-center gap-1.5">{listName(r.p, r.opened)}{r.p.confidential && <Badge tone="warn">Confidential</Badge>}</span>,
            aside: st ? <Badge tone={st.tone}>{st.label}</Badge> : <span className="text-xs text-muted-foreground">No Visit</span>,
            lines: [
              <span key="a" className="flex flex-wrap gap-x-3"><span className="font-mono text-xs leading-5">{r.p.mrn}</span><span>{ageLabel(r.p.dob) || "Age not known"}, {r.p.sex === "M" ? "Male" : "Female"}</span></span>,
              <span key="b" className="flex flex-wrap items-center gap-1.5">{r.primary ? coverageLabel(r.primary) : "Cash"} <EligibilityPill answer={r.eligibility} insured={!!r.primary} /></span>,
            ],
          };
        }}
        empty={{
          icon: <Users />,
          title: "No Patients Yet",
          text: "Patients appear here once they are registered. Enter the ID number first, and the HIS looks the patient up.",
          action: mayRegister ? { label: "Register Patient", icon: <UserPlus className="size-4" aria-hidden="true" />, onClick: () => navigate("/registration") } : undefined,
        }}
      />
      <WristbandDialog patientId={band} onClose={() => setBand(null)} />
      <CoverageDialog patientId={coverageFor} onClose={() => setCoverageFor(null)} />
      <EligibilityDialog patientId={eligibilityFor} onClose={() => setEligibilityFor(null)} />
      <HealthIdDialog patient={state.patients.find((p) => p.id === healthIdFor)} onClose={() => setHealthIdFor(null)} />
      <MergePatientsDialog open={merge} onClose={() => setMerge(false)} />
      {dialogs}
    </ListPage>
  );
}
