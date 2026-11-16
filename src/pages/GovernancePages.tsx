import * as React from "react";
import { FolderOpen, History, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { RegistrationForm } from "@/components/RegistrationForm";
import { DataTable, ListPage, ListToolbar, inRange, useList, type Column, type FilterDef } from "@/components/list";
import { fmtDateTime } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { clearAudit, useAudit, type AuditAction, type AuditEntry } from "@/lib/audit";
import { navigate, useRoute } from "@/lib/router";
import { PERMISSION_LABELS } from "@/lib/permission-labels";
import { IDLE_MAX, IDLE_MIN, ROLES, can, hasGlass, setIdleMinutes, useSession, type Permission } from "@/lib/session";
import { audit } from "@/lib/audit";
import { patientName, useHis } from "@/lib/store";

const actionTone: Partial<Record<AuditAction, "ok" | "warn" | "danger" | "info" | "update" | "neutral">> = {
  "break-glass": "danger", denied: "danger", delete: "warn", lock: "neutral", unlock: "neutral", export: "warn", print: "warn", download: "warn",
  "send-adt": "info", "send-fhir": "info", "send-document": "info", "ai-suggest": "update", "ai-accept": "update", "ai-reject": "update",
};

/** Audit trail: who did what, when, to which patient. */
export function AuditPage() {
  const entries = useAudit();
  useSession();
  // Reading the access log is itself recorded.
  React.useEffect(() => { audit("view", "Audit Trail"); }, []);
  const rows = [...entries].reverse();
  const actions = [...new Set(entries.map((e) => e.action))].sort();
  const users = [...new Set(entries.map((e) => e.user))].sort();

  const filters: FilterDef<AuditEntry>[] = [
    { id: "action", label: "Action", quick: true, options: actions.map((a) => ({ value: a, label: a })), test: (e, v) => e.action === v },
    { id: "user", label: "User", quick: true, options: users.map((u) => ({ value: u, label: u })), test: (e, v) => e.user === v },
    { id: "date", label: "Date", kind: "dateRange", test: (e, v) => inRange(e.at.slice(0, 10), v) },
  ];
  const columns: Column<AuditEntry>[] = [
    { id: "at", header: "Time", hideable: false, value: (e) => e.at, csv: (e) => e.at, cell: (e) => <span className="whitespace-nowrap tabular-nums">{fmtDateTime(e.at)}</span> },
    { id: "user", header: "User", value: (e) => e.user, cell: (e) => <span className="whitespace-nowrap font-medium">{e.user}</span> },
    { id: "role", header: "Role", value: (e) => e.role, cell: (e) => <span className="whitespace-nowrap text-muted-foreground">{e.role}</span> },
    { id: "action", header: "Action", value: (e) => e.action, cell: (e) => <Badge tone={actionTone[e.action] ?? "ok"}>{e.action}</Badge> },
    { id: "target", header: "Target", value: (e) => e.target, cell: (e) => <span className="block max-w-64 truncate" title={e.target}>{e.target}</span> },
    { id: "patient", header: "Patient", value: (e) => e.patient ?? "", csv: (e) => (e.patient ? `${e.patient}${e.mrn ? ` (${e.mrn})` : ""}` : ""),
      cell: (e) => (e.patient ? <span className="whitespace-nowrap">{e.patient}{e.mrn && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{e.mrn}</span>}</span> : <span className="text-muted-foreground">None</span>) },
    { id: "detail", header: "Detail", value: (e) => e.detail ?? "", cell: (e) => <span className="block max-w-80 truncate text-muted-foreground" title={e.detail}>{e.detail ?? ""}</span> },
  ];
  const list = useList({
    id: "audit",
    title: "Audit Trail",
    rows,
    columns,
    getId: (e) => String(e.id),
    filters,
    initialSort: { key: "at", dir: "desc" },
    pageSize: 50,
    unit: ["entry", "entries"],
    search: (e) => `${e.user} ${e.role} ${e.action} ${e.target} ${e.patient ?? ""} ${e.mrn ?? ""} ${e.detail ?? ""}`,
  });

  return (
    <ListPage
      title="Audit Trail"
      subtitle="Every view, change, send, denial, break-the-glass and AI action."
      more={[can("admin") && { label: "Clear Demo Data", icon: <Trash2 className="size-4" />, danger: true, onClick: () => { if (confirm("Clear the demo audit data? The clearing is recorded as the first new entry.")) clearAudit(); } }]}
    >
      <ListToolbar list={list} placeholder="User, patient or detail" />
      <DataTable
        list={list}
        label="Audit entries"
        rowLabel={(e) => `${e.action} by ${e.user}`}
        card={(e) => ({
          title: <span className="flex items-center gap-2">{e.user}<Badge tone={actionTone[e.action] ?? "ok"}>{e.action}</Badge></span>,
          lines: [<span key="a">{e.target}{e.patient ? `, ${e.patient}` : ""}</span>, <span key="b" className="tabular-nums">{fmtDateTime(e.at)}</span>],
        })}
        empty={{ icon: <History />, title: "No Audit Entries Yet", text: "Every chart opened and every message sent is recorded here. In a real system this lives on the server and cannot be edited." }}
      />
    </ListPage>
  );
}

/** Role and permission matrix, and session settings. */
export function AccessPage() {
  const session = useSession();
  const perms = Object.keys(PERMISSION_LABELS) as Permission[];
  return (
    <div className="space-y-4">
      <PageHeader title="Access Matrix" subtitle="What each role may do. Switch the signed-in user at the bottom of the sidebar to see the screens change." />
      <Card>
        <CardHeader title="Roles and permissions" subtitle={`You are signed in as ${session.user.name} (${session.role.label}).`} />
        <Table>
          <thead>
            <tr><Th>Permission</Th>{ROLES.map((r) => <Th key={r.id} className={r.id === session.role.id ? "text-move" : ""}>{r.label}</Th>)}</tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p}>
                <Td><div className="font-medium">{PERMISSION_LABELS[p]}</div><div className="font-mono text-xs text-muted-foreground">{p}</div></Td>
                {ROLES.map((r) => <Td key={r.id} className="text-center">{r.permissions.includes(p) ? <Badge tone="ok">Yes</Badge> : <span className="text-muted-foreground">No</span>}</Td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Session" subtitle="Automatic screen lock after inactivity (NCA session management; HIPAA automatic logoff as best practice). It cannot be switched off." />
        <div className="max-w-xs p-4">
          <Field label={`Lock After (Minutes, ${IDLE_MIN} To ${IDLE_MAX})`}>
            <Input type="number" min={IDLE_MIN} max={IDLE_MAX} value={session.idleMinutes} onChange={(e) => setIdleMinutes(Number(e.target.value))} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/** Confidential patients. Opening a chart needs break-the-glass. */
export function ConfidentialPage() {
  const state = useHis();
  useSession();
  const entries = useAudit();
  const rows = state.patients.filter((p) => p.confidential && !p.mergedInto).map((p) => ({
    p,
    // Older entries stored the patient id; new ones carry the MRN.
    last: [...entries].reverse().find((e) => e.action === "break-glass" && (e.mrn === p.mrn || e.patient === p.id)),
    enc: [...state.encounters].reverse().find((e) => e.patientId === p.id && e.status !== "cancelled"),
    open: hasGlass(p.id),
  }));
  type Row = (typeof rows)[number];
  const columns: Column<Row>[] = [
    { id: "patient", header: "Patient", hideable: false, value: (r) => patientName(r.p), cell: (r) => <span className="flex items-center gap-2 whitespace-nowrap"><span className="font-semibold text-[#032c26] dark:text-foreground">{patientName(r.p)}</span><span className="font-mono text-xs text-muted-foreground">{r.p.mrn}</span></span> },
    { id: "hid", header: "Health ID", value: (r) => r.p.healthId, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.p.healthId}</span> },
    { id: "access", header: "Your Access", value: (r) => (r.open ? "Open" : "Restricted"), cell: (r) => (r.open ? <Badge tone="warn">Open For 30 Min</Badge> : <Badge tone="danger"><Lock className="size-3" />Restricted</Badge>) },
    { id: "last", header: "Last Break-The-Glass", value: (r) => r.last?.at ?? "", csv: (r) => (r.last ? `${r.last.user}, ${fmtDateTime(r.last.at)}. ${r.last.detail ?? ""}` : "Never"),
      cell: (r) => (r.last ? <span className="block max-w-96 truncate" title={r.last.detail}>{r.last.user}, <span className="tabular-nums">{fmtDateTime(r.last.at)}</span>{r.last.detail ? `. ${r.last.detail}` : ""}</span> : <span className="text-muted-foreground">Never</span>) },
  ];
  const list = useList({
    id: "confidential",
    title: "Confidential Patients",
    rows,
    columns,
    getId: (r) => r.p.id,
    unit: ["patient", "patients"],
    search: (r) => `${patientName(r.p)} ${r.p.mrn} ${r.p.healthId}`,
  });
  const openChart = (r: Row) => r.enc && navigate("/chart", { visit: r.enc.visitNumber });
  return (
    <ListPage title="Confidential Patients" subtitle="Opening a chart needs a reason (break-the-glass). Every access is audited.">
      <ListToolbar list={list} placeholder="Name, MRN or Health ID" />
      <DataTable
        list={list}
        label="Confidential patients"
        rowLabel={(r) => patientName(r.p)}
        onRowClick={(r) => openChart(r)}
        actions={(r) => (r.enc ? [{ id: "chart", label: "Open Chart", icon: <FolderOpen />, onClick: () => openChart(r) }] : [])}
        card={(r) => ({
          title: patientName(r.p),
          aside: r.open ? <Badge tone="warn">Open</Badge> : <Badge tone="danger">Restricted</Badge>,
          lines: [<span key="a" className="font-mono text-xs">{r.p.mrn}</span>, <span key="b">{r.last ? `Last opened by ${r.last.user}, ${fmtDateTime(r.last.at)}` : "Never opened with break-the-glass"}</span>],
        })}
        empty={{ icon: <ShieldAlert />, title: "No Confidential Patients", text: "A patient file marked confidential at registration appears here. Opening its chart needs a reason, and every access is audited." }}
      />
    </ListPage>
  );
}

/** Patient registration: the full form, then recent registrations. */
export function RegistrationPage() {
  const state = useHis();
  const route = useRoute();
  const cls = route.params.get("cls") === "E" ? "E" : "O";
  const recent = [...state.log].reverse().filter((m) => m.trigger === "A04").slice(0, 8);
  if (!can("patient.register")) {
    return (
      <div>
        <PageHeader title="Patient Registration" />
        <Card><Empty>Your role cannot register patients.</Empty></Card>
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title={cls === "E" ? "Emergency Registration" : "Patient Registration"}
        subtitle={cls === "E"
          ? "Register at the door with a few answers, then triage. The full details can be completed later."
          : "Enter the ID number first. The HIS looks the patient up, and you can retrieve the insurance card and the ID card."}
      />
      <RegistrationForm key={cls} cls={cls} />
      <Card className="mt-8">
        <CardHeader title="Recent registrations" />
        <Table>
          <thead><tr><Th>Patient</Th><Th>Visit</Th><Th>Message</Th><Th>Sent</Th></tr></thead>
          <tbody>
            {recent.length === 0 && <tr><Td colSpan={4}><Empty>No registrations yet.</Empty></Td></tr>}
            {recent.map((m) => (
              <tr key={m.seq}>
                <Td className="font-medium">{m.patientName}</Td>
                <Td className="font-mono text-xs">{m.visitNumber}</Td>
                <Td><Badge tone="admit" className="font-mono">A04</Badge> <span className="text-xs text-muted-foreground">{m.controlId}</span></Td>
                <Td className="text-xs text-muted-foreground">{fmtDateTime(m.sentAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
