import * as React from "react";
import { Ban, BedDouble, CheckCircle2, FolderOpen, Plus, XCircle } from "lucide-react";
import { IconBan, IconCalendarPlus, IconCircleCheck, IconCircleX, IconHourglass } from "@tabler/icons-react";
import { AdmissionRequestForm } from "@/components/admission/AdmissionRequestForm";
import { ApproveDialog } from "@/components/admission/ApproveDialog";
import { DecisionDialog } from "@/components/admission/DecisionDialog";
import { CellSub, DataTable, ListPage, ListToolbar, StatFilters, inRange, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { Badge } from "@/components/ui/primitives";
import {
  ADMITTING_DEPARTMENTS, STATUSES, STATUS_LABEL, STATUS_TONE, admissionTypeLabel, canDecideAdmission, canRequestAdmission,
  departmentLabel, doctorLabel, useAdmissionRequests, type AdmissionRequest, type RequestStatus,
} from "@/lib/admission-requests";
import { useDevMode } from "@/lib/devmode";
import { fmtDateTime } from "@/lib/format";
import { navigate, useRoute } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { bedLabel, patientName, toLocalInput, useHis } from "@/lib/store";

type Dlg =
  | { kind: "new"; patientId?: string; visit?: string }
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | { kind: "cancel"; id: string };

const STATUS_ICON: Record<RequestStatus, React.ReactNode> = {
  pending: <IconHourglass stroke={1.75} />, approved: <IconCircleCheck stroke={1.75} />, preadmitted: <IconCalendarPlus stroke={1.75} />,
  rejected: <IconCircleX stroke={1.75} />, cancelled: <IconBan stroke={1.75} />,
};

/**
 * Admission requests and the approval worklist in one page, as in the HIS.
 * Route params: `new=1` opens the request form, with `patient` and `visit` to fill it (for a chart or worklist link).
 */
export function AdmissionRequestsPage() {
  const his = useHis();
  const { requests } = useAdmissionRequests();
  const dev = useDevMode();
  useSession();
  const route = useRoute();
  const [dlg, setDlg] = React.useState<Dlg | null>(null);

  // A link with new=1 opens the form once, then the params are cleared so a refresh does not open it again.
  const wantsNew = route.params.get("new") === "1";
  React.useEffect(() => {
    if (!wantsNew) return;
    if (canRequestAdmission()) setDlg({ kind: "new", patientId: route.params.get("patient") ?? undefined, visit: route.params.get("visit") ?? undefined });
    navigate(route.path);
  }, [wantsNew, route]);

  const rows = requests.map((r) => {
    const p = his.patients.find((x) => x.id === r.patientId);
    const name = p?.confidential && !hasGlass(p.id) ? "Confidential Patient" : patientName(p);
    const visit = r.approval ? his.encounters.find((e) => e.visitNumber === r.approval!.visitNumber) : undefined;
    return { r, name, mrn: p?.mrn ?? "", visit, chartVisit: r.approval?.visitNumber ?? r.fromVisit };
  });
  type Row = (typeof rows)[number];

  const filters: FilterDef<Row>[] = [
    { id: "status", label: "Status", options: STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })), test: (x, v) => x.r.status === v },
    { id: "dept", label: "Department", quick: true, options: ADMITTING_DEPARTMENTS.map((d) => ({ value: d.code, label: d.label })), test: (x, v) => x.r.department === v },
    { id: "date", label: "Requested", kind: "dateRange", test: (x, v) => inRange(toLocalInput(new Date(x.r.requestedAt)).slice(0, 10), v) },
  ];

  const columns: Column<Row>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (x) => x.name,
      cell: (x) => (
        <div className="min-w-48">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="font-semibold text-[#032c26] dark:text-foreground">{x.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{x.mrn}</span>
          </div>
          {(x.r.dx || dev) && <CellSub>{[x.r.dx?.code, dev ? x.r.id : ""].filter(Boolean).join(", ")}</CellSub>}
        </div>
      ),
    },
    { id: "dept", header: "Department", value: (x) => departmentLabel(x.r.department), cell: (x) => <div><div className="whitespace-nowrap">{departmentLabel(x.r.department)}</div>{x.r.subDepartment && <CellSub>{x.r.subDepartment}</CellSub>}</div> },
    { id: "type", header: "Type", value: (x) => admissionTypeLabel(x.r.admissionType), cell: (x) => <div><div className="whitespace-nowrap">{admissionTypeLabel(x.r.admissionType)}</div>{x.r.condition && <CellSub>{x.r.condition}</CellSub>}</div> },
    { id: "requestedBy", header: "Requested By", value: (x) => x.r.requestedBy, cell: (x) => <span className="whitespace-nowrap">{x.r.requestedBy}</span> },
    { id: "approving", header: "Approving Doctor", value: (x) => doctorLabel(x.r.approvingDoctor), cell: (x) => <span className="whitespace-nowrap">{doctorLabel(x.r.approvingDoctor)}</span> },
    { id: "admitting", header: "Admitting Doctor", defaultHidden: true, value: (x) => doctorLabel(x.r.admittingDoctor), cell: (x) => <span className="whitespace-nowrap">{doctorLabel(x.r.admittingDoctor)}</span> },
    { id: "requested", header: "Requested", value: (x) => x.r.requestedAt, csv: (x) => fmtDateTime(x.r.requestedAt), cell: (x) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(x.r.requestedAt)}</span> },
    {
      id: "status", header: "Status", value: (x) => STATUS_LABEL[x.r.status],
      cell: (x) => (
        <div className="min-w-28">
          <Badge tone={STATUS_TONE[x.r.status]}>{STATUS_LABEL[x.r.status]}</Badge>
          {x.r.approval && <CellSub className="mt-0.5">{x.r.approval.bedId ? bedLabel(x.r.approval.bedId) : "No bed"}{dev ? `, ${x.r.approval.eventId} ${x.r.approval.visitNumber}` : ""}</CellSub>}
          {x.visit?.status === "cancelled" && <div className="text-xs text-destructive">Visit cancelled after approval</div>}
          {x.r.decisionReason && <CellSub className="max-w-48 truncate"><span title={x.r.decisionReason}>{x.r.decisionReason}</span></CellSub>}
        </div>
      ),
    },
    { id: "decided", header: "Decided By", defaultHidden: true, value: (x) => x.r.decidedBy ?? "", cell: (x) => (x.r.decidedBy ? <span className="text-xs">{x.r.decidedBy}, {fmtDateTime(x.r.decidedAt)}</span> : <span className="text-muted-foreground">None</span>) },
  ];

  const list = useList({
    id: "admission-requests",
    title: "Admission Requests",
    rows,
    columns,
    getId: (x) => x.r.id,
    filters,
    initialFilters: { status: "pending" },
    initialSort: { key: "requested", dir: "desc" },
    unit: ["request", "requests"],
    search: (x) => `${x.name} ${x.mrn} ${x.r.id} ${x.r.requestedBy}`,
  });

  const mayDecide = canDecideAdmission();
  const mayRequest = canRequestAdmission();
  const current = dlg && dlg.kind !== "new" ? requests.find((r) => r.id === dlg.id) : undefined;
  const actions = (x: Row): RowAction[] => {
    const out: RowAction[] = [];
    const r: AdmissionRequest = x.r;
    if (r.status === "pending" && mayDecide) {
      out.push(
        { id: "approve", label: "Approve", icon: <CheckCircle2 />, emphasis: true, onClick: () => setDlg({ kind: "approve", id: r.id }) },
        { id: "reject", label: "Reject", icon: <XCircle />, danger: true, onClick: () => setDlg({ kind: "reject", id: r.id }) },
        { id: "cancel", label: "Cancel Request", icon: <Ban />, onClick: () => setDlg({ kind: "cancel", id: r.id }) },
      );
    }
    if (x.chartVisit) out.push({ id: "chart", label: "Open Chart", icon: <FolderOpen />, separate: out.length > 0, onClick: () => navigate("/chart", { visit: x.chartVisit! }) });
    return out;
  };

  return (
    <ListPage
      title="Admission Requests"
      subtitle={mayDecide ? "Approve each request with a bed, as a pre-admission, or reject it." : "Your role can see requests. Deciding them needs the right to send admissions."}
      primary={mayRequest ? { label: "New Admission Request", icon: <Plus className="size-4" aria-hidden="true" />, onClick: () => setDlg({ kind: "new" }) } : undefined}
      kpis={
        <StatFilters label="Requests by status" value={list.filterValues.status ?? ""} onChange={(v) => list.setFilter("status", v)}
          items={STATUSES.map((s) => ({ id: s, label: STATUS_LABEL[s], value: requests.filter((r) => r.status === s).length, icon: STATUS_ICON[s], alert: s === "pending" }))} />
      }
    >
      <ListToolbar list={list} placeholder="Name, MRN or request" />
      <DataTable
        list={list}
        label="Admission requests"
        rowLabel={(x) => `${x.name}, request ${x.r.id}`}
        onRowClick={(x) => (x.r.status === "pending" && mayDecide ? setDlg({ kind: "approve", id: x.r.id }) : x.chartVisit ? navigate("/chart", { visit: x.chartVisit }) : undefined)}
        actions={actions}
        card={(x) => ({
          title: x.name,
          aside: <Badge tone={STATUS_TONE[x.r.status]}>{STATUS_LABEL[x.r.status]}</Badge>,
          lines: [
            <span key="a">{departmentLabel(x.r.department)}, {admissionTypeLabel(x.r.admissionType)}</span>,
            <span key="b" className="tabular-nums">{fmtDateTime(x.r.requestedAt)}, {x.r.requestedBy}</span>,
          ],
        })}
        empty={{
          icon: <BedDouble />,
          title: "No Admission Requests Yet",
          text: "A doctor requests an admission from the chart or the OPD worklist. Approval admits the patient and sends the message to NPHIES.",
          action: mayRequest ? { label: "New Admission Request", icon: <Plus className="size-4" />, onClick: () => setDlg({ kind: "new" }) } : undefined,
        }}
      />

      {dlg?.kind === "new" && <AdmissionRequestForm patientId={dlg.patientId} visit={dlg.visit} onClose={() => setDlg(null)} onSaved={() => list.setFilter("status", "pending")} />}
      {dlg?.kind === "approve" && current && <ApproveDialog request={current} onClose={() => setDlg(null)} />}
      {(dlg?.kind === "reject" || dlg?.kind === "cancel") && current && <DecisionDialog request={current} kind={dlg.kind} onClose={() => setDlg(null)} />}
    </ListPage>
  );
}
