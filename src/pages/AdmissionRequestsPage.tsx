import * as React from "react";
import { Ban, CheckCircle2, Plus, RotateCcw, XCircle } from "lucide-react";
import { AdmissionRequestForm } from "@/components/admission/AdmissionRequestForm";
import { ApproveDialog } from "@/components/admission/ApproveDialog";
import { DecisionDialog } from "@/components/admission/DecisionDialog";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { IconBan, IconCalendarPlus, IconCircleCheck, IconCircleX, IconHourglass } from "@tabler/icons-react";
import {
  ADMITTING_DEPARTMENTS, STATUSES, STATUS_LABEL, STATUS_TONE, admissionTypeLabel, canDecideAdmission, canRequestAdmission,
  departmentLabel, doctorLabel, useAdmissionRequests, type AdmissionRequest, type RequestStatus,
} from "@/lib/admission-requests";
import { useDevMode } from "@/lib/devmode";
import { navigate, useRoute } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { bedLabel, patientName, toLocalInput, useHis } from "@/lib/store";

type Dlg =
  | { kind: "new"; patientId?: string; visit?: string }
  | { kind: "approve"; id: string }
  | { kind: "reject"; id: string }
  | { kind: "cancel"; id: string };

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

  const [status, setStatus] = React.useState<RequestStatus | "">("pending");
  const [dept, setDept] = React.useState("");
  const [start, setStart] = React.useState("");
  const [end, setEnd] = React.useState("");
  const [q, setQ] = React.useState("");
  const [dlg, setDlg] = React.useState<Dlg | null>(null);

  // A link with new=1 opens the form once, then the params are cleared so a refresh does not open it again.
  const wantsNew = route.params.get("new") === "1";
  React.useEffect(() => {
    if (!wantsNew) return;
    if (canRequestAdmission()) setDlg({ kind: "new", patientId: route.params.get("patient") ?? undefined, visit: route.params.get("visit") ?? undefined });
    navigate(route.path);
  }, [wantsNew, route]);

  const nameOf = (pid: string) => {
    const p = his.patients.find((x) => x.id === pid);
    return p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
  };

  const rows = requests
    .filter((r) => !status || r.status === status)
    .filter((r) => !dept || r.department === dept)
    .filter((r) => {
      const d = toLocalInput(new Date(r.requestedAt)).slice(0, 10);
      return (!start || d >= start) && (!end || d <= end);
    })
    .filter((r) => {
      if (!q.trim()) return true;
      const p = his.patients.find((x) => x.id === r.patientId);
      return `${nameOf(r.patientId)} ${p?.mrn ?? ""} ${r.id}`.toLowerCase().includes(q.trim().toLowerCase());
    })
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

  const STATUS_ICON: Record<RequestStatus, React.ReactNode> = {
    pending: <IconHourglass stroke={1.75} />, approved: <IconCircleCheck stroke={1.75} />, preadmitted: <IconCalendarPlus stroke={1.75} />,
    rejected: <IconCircleX stroke={1.75} />, cancelled: <IconBan stroke={1.75} />,
  };
  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const mayDecide = canDecideAdmission();
  const current = dlg && dlg.kind !== "new" ? requests.find((r) => r.id === dlg.id) : undefined;

  function reset() {
    setStatus("pending");
    setDept("");
    setStart("");
    setEnd("");
    setQ("");
  }

  return (
    <div>
      <PageHeader
        title="Admission Requests"
        subtitle="A doctor requests the admission. The approving doctor approves it with a bed, approves it as a pre-admission, or rejects it. Approval admits the patient and sends the message to NPHIES."
        right={
          <Button variant="primary" disabled={!canRequestAdmission()} title={canRequestAdmission() ? undefined : "Needs chart write access"} onClick={() => setDlg({ kind: "new" })}>
            <Plus className="size-4" />New Admission Request
          </Button>
        }
      />

      <KpiStrip label="Requests by status" className="mb-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {STATUSES.map((s, i) => {
          const n = requests.filter((r) => r.status === s).length;
          return (
            <KpiTile key={s} icon={STATUS_ICON[s]} label={STATUS_LABEL[s]} value={n.toLocaleString("en-US")}
              note={status === s ? "Shown below" : `Show ${STATUS_LABEL[s].toLowerCase()}`} tone={status === s ? "ok" : undefined}
              accent={s === "pending" && n > 0 ? "warn" : "brand"}
              className={cn(status === s && "ring-2 ring-[#03C1AC]/60", i === STATUSES.length - 1 && "col-span-2 sm:col-span-1")}
              onClick={() => setStatus(status === s ? "" : s)} />
          );
        })}
      </KpiStrip>

      <Card className="mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              <option value="">All</option>
            </Select>
          </Field>
          <Field label="Department">
            <Select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All</option>
              {ADMITTING_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </Select>
          </Field>
          <Field label="Requested From"><Input type="date" value={start} max={end || undefined} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Requested To"><Input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Patient"><Input placeholder="Name, MRN or request" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <div className="flex items-end">
            <Button onClick={reset} aria-label="Reset filters"><RotateCcw className="size-4" />Reset</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-lg font-semibold">Admission Approval Worklist</h2>
          <div className="flex gap-2">
            <Badge tone="warn">{pendingCount} pending</Badge>
            <Badge tone="neutral">{rows.length} shown</Badge>
          </div>
        </div>
        {!mayDecide && (
          <p className="px-4 pt-2 text-sm text-muted-foreground">Your role can see requests. Approving, rejecting and cancelling need the right to send admissions.</p>
        )}
        {/* Phone and small tablet: one card per request, so the actions are never off the side of the screen. */}
        <ul className="mt-3 divide-y divide-border border-t border-border lg:hidden" aria-label="Admission requests">
          {rows.length === 0 && <li><Empty>No admission requests match these filters.</Empty></li>}
          {rows.map((r) => (
            <RequestCard key={r.id} r={r} name={nameOf(r.patientId)} mrn={his.patients.find((p) => p.id === r.patientId)?.mrn ?? ""} dev={dev} mayDecide={mayDecide} onAct={(kind) => setDlg({ kind, id: r.id })} />
          ))}
        </ul>
        <Table className="mt-3 hidden lg:block">
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Doctors</Th>
              <Th>Department</Th>
              <Th>Type And Condition</Th>
              <Th>Requested</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={7}><Empty>No admission requests match these filters.</Empty></Td></tr>
            )}
            {rows.map((r) => (
              <Row key={r.id} r={r} name={nameOf(r.patientId)} mrn={his.patients.find((p) => p.id === r.patientId)?.mrn ?? ""} dev={dev} mayDecide={mayDecide} onAct={(kind) => setDlg({ kind, id: r.id })} />
            ))}
          </tbody>
        </Table>
      </Card>

      {dlg?.kind === "new" && <AdmissionRequestForm patientId={dlg.patientId} visit={dlg.visit} onClose={() => setDlg(null)} onSaved={() => setStatus("pending")} />}
      {dlg?.kind === "approve" && current && <ApproveDialog request={current} onClose={() => setDlg(null)} />}
      {(dlg?.kind === "reject" || dlg?.kind === "cancel") && current && <DecisionDialog request={current} kind={dlg.kind} onClose={() => setDlg(null)} />}
    </div>
  );
}

interface RowProps {
  r: AdmissionRequest;
  name: string;
  mrn: string;
  dev: boolean;
  mayDecide: boolean;
  onAct: (kind: "approve" | "reject" | "cancel") => void;
}

/** Short date and time for the worklist, for example "15 Nov 2026, 13:57". */
const shortDate = (local: string | undefined) =>
  local ? new Date(local).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "None";

/** The pieces of a request that the table row and the phone card both show. */
function useRequestParts({ r, name, dev, mayDecide, onAct }: RowProps) {
  const his = useHis();
  const visit = r.approval ? his.encounters.find((e) => e.visitNumber === r.approval!.visitNumber) : undefined;
  const chartVisit = r.approval?.visitNumber ?? r.fromVisit;
  const patient = chartVisit ? (
    <button onClick={() => navigate("/chart", { visit: chartVisit })} className="rounded text-left text-sm font-semibold text-move hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{name}</button>
  ) : (
    <span className="text-sm font-semibold">{name}</span>
  );
  const status = (
    <>
      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
      {r.approval && (
        <div className="mt-1 text-xs text-muted-foreground">
          {r.approval.bedId ? bedLabel(r.approval.bedId) : "No bed"}{dev ? ` · ${r.approval.eventId} ${r.approval.visitNumber}` : ""}
          {visit?.status === "cancelled" && <div className="text-destructive">The visit was cancelled after approval.</div>}
        </div>
      )}
      {r.decisionReason && <div className="mt-1 max-w-48 text-xs text-muted-foreground">{r.decisionReason}</div>}
    </>
  );
  const actions = r.status === "pending" && mayDecide ? (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" variant="primary" onClick={() => onAct("approve")} aria-label={`Approve request ${r.id} for ${name}`}><CheckCircle2 className="size-4" />Approve</Button>
      <Button size="sm" variant="danger" onClick={() => onAct("reject")} aria-label={`Reject request ${r.id} for ${name}`}><XCircle className="size-4" />Reject</Button>
      <Button size="sm" onClick={() => onAct("cancel")} aria-label={`Cancel request ${r.id} for ${name}`}><Ban className="size-4" />Cancel</Button>
    </div>
  ) : (
    <span className="text-xs text-muted-foreground">{r.decidedBy ? `${r.decidedBy}, ${shortDate(r.decidedAt)}` : "None"}</span>
  );
  const idLine = `${r.id}${r.dx ? ` · ${r.dx.code}` : ""}${dev && r.fromVisit ? ` · from ${r.fromVisit}` : ""}`;
  return { patient, status, actions, idLine };
}

function Row(props: RowProps) {
  const { r, mrn } = props;
  const { patient, status, actions, idLine } = useRequestParts(props);
  return (
    <tr className="align-top hover:bg-muted/40">
      <Td>
        {patient}
        <div className="font-mono text-xs text-muted-foreground">{mrn}</div>
        <div className="text-xs text-muted-foreground">{idLine}</div>
      </Td>
      <Td>
        <div>{r.requestedBy}</div>
        <div className="text-xs text-muted-foreground">Admitting: {doctorLabel(r.admittingDoctor)}</div>
        <div className="text-xs text-muted-foreground">Approving: {doctorLabel(r.approvingDoctor)}</div>
      </Td>
      <Td>
        <div>{departmentLabel(r.department)}</div>
        {r.subDepartment && <div className="text-xs text-muted-foreground">{r.subDepartment}</div>}
      </Td>
      <Td>
        <div>{admissionTypeLabel(r.admissionType)}</div>
        <div className="text-xs text-muted-foreground">Condition: {r.condition || "None"}</div>
      </Td>
      <Td className="whitespace-nowrap">{shortDate(r.requestedAt)}</Td>
      <Td>{status}</Td>
      <Td className="min-w-48">{actions}</Td>
    </tr>
  );
}

function RequestCard(props: RowProps) {
  const { r, mrn } = props;
  const { patient, status, actions, idLine } = useRequestParts(props);
  const fact = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {patient}
          <div className="text-xs text-muted-foreground"><span className="font-mono">{mrn}</span> · {idLine}</div>
        </div>
        <div className="shrink-0 text-right">{status}</div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
        {fact("Requested By", r.requestedBy)}
        {fact("Approving Doctor", doctorLabel(r.approvingDoctor))}
        {fact("Department", <>{departmentLabel(r.department)}{r.subDepartment ? `, ${r.subDepartment}` : ""}</>)}
        {fact("Type", admissionTypeLabel(r.admissionType))}
        {fact("Condition", r.condition || "None")}
        {fact("Requested", shortDate(r.requestedAt))}
      </dl>
      <div className="mt-3">{actions}</div>
    </li>
  );
}
