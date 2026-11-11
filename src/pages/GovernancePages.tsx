import * as React from "react";
import { Download, Lock, Search } from "lucide-react";
import { RegistrationForm } from "@/components/RegistrationForm";
import { downloadText } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { audit, clearAudit, useAudit, type AuditAction } from "@/lib/audit";
import { navigate, useRoute } from "@/lib/router";
import { PERMISSION_LABELS } from "@/lib/permission-labels";
import { ROLES, can, hasGlass, setIdleMinutes, useSession, type Permission } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";

const actionTone: Partial<Record<AuditAction, "ok" | "warn" | "danger" | "info" | "update" | "neutral">> = {
  "break-glass": "danger", denied: "danger", delete: "warn", lock: "neutral", unlock: "neutral",
  "send-adt": "info", "send-fhir": "info", "send-document": "info", "ai-suggest": "update", "ai-accept": "update", "ai-reject": "update",
};

/** Audit trail: who did what, when, to which patient. */
export function AuditPage() {
  const entries = useAudit();
  const [action, setAction] = React.useState("");
  const [q, setQ] = React.useState("");
  const rows = [...entries].reverse().filter((e) => (!action || e.action === action) && (!q || `${e.user} ${e.target} ${e.patient ?? ""} ${e.detail ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const actions = [...new Set(entries.map((e) => e.action))].sort();

  function exportCsv() {
    audit("export", "Audit trail", { detail: `${rows.length} rows` });
    const head = "time,user,role,action,target,patient,detail";
    const body = rows.map((e) => [e.at, e.user, e.role, e.action, e.target, e.patient ?? "", e.detail ?? ""].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(","));
    downloadText("audit_trail.csv", [head, ...body].join("\n"));
  }

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="Every view, change, send, denial, break-the-glass and AI action. In a real system this lives on the server and cannot be edited."
        right={
          <div className="flex gap-2">
            <Button onClick={exportCsv} disabled={rows.length === 0}><Download className="size-4" />Export CSV</Button>
            <Button variant="danger" disabled={!can("admin")} title={can("admin") ? undefined : "Only an administrator can clear the demo audit data"} onClick={() => confirm("Clear the demo audit data?") && clearAudit()}>Clear Demo Data</Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search user, patient or detail" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit" />
        </div>
        <Select className="w-48" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
          <option value="">All Actions</option>
          {actions.map((a) => <option key={a}>{a}</option>)}
        </Select>
        <span className="self-center text-xs text-muted-foreground">{rows.length} of {entries.length} entries</span>
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Time</Th><Th>User</Th><Th>Action</Th><Th>Target</Th><Th>Patient</Th><Th>Detail</Th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={6}><Empty>No audit entries yet. Open a chart or send a message.</Empty></Td></tr>}
            {rows.slice(0, 300).map((e) => (
              <tr key={e.id} className="hover:bg-muted/40">
                <Td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium" })}</Td>
                <Td><div className="font-medium">{e.user}</div><div className="text-xs text-muted-foreground">{e.role}</div></Td>
                <Td><Badge tone={actionTone[e.action] ?? "ok"}>{e.action}</Badge></Td>
                <Td>{e.target}</Td>
                <Td>{e.patient ?? "None"}</Td>
                <Td className="max-w-[320px] truncate text-muted-foreground"><span title={e.detail}>{e.detail ?? ""}</span></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
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
        <CardHeader title="Session" subtitle="Automatic screen lock after inactivity (HIPAA automatic logoff theme, NCA session management)." />
        <div className="max-w-xs p-4">
          <Field label="Lock after (minutes, 0 is off)">
            <Input type="number" min={0} max={120} value={session.idleMinutes} onChange={(e) => setIdleMinutes(Math.max(0, Number(e.target.value)))} />
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
  const list = state.patients.filter((p) => p.confidential);
  return (
    <div>
      <PageHeader title="Confidential Patient" subtitle="Restricted records. Opening a chart needs a reason (break-the-glass). Every access is audited." />
      <Card>
        <Table>
          <thead><tr><Th>Patient</Th><Th>Health ID</Th><Th>Your access</Th><Th>Last break-the-glass</Th><Th /></tr></thead>
          <tbody>
            {list.length === 0 && <tr><Td colSpan={5}><Empty>No confidential patients.</Empty></Td></tr>}
            {list.map((p) => {
              const last = [...entries].reverse().find((e) => e.action === "break-glass" && e.patient === p.id);
              const enc = [...state.encounters].reverse().find((e) => e.patientId === p.id && e.status !== "cancelled");
              return (
                <tr key={p.id}>
                  <Td className="font-medium">{patientName(p)}</Td>
                  <Td className="font-mono text-xs">{p.healthId}</Td>
                  <Td>{hasGlass(p.id) ? <Badge tone="warn">Open for 30 min</Badge> : <Badge tone="danger"><Lock className="size-3" />Restricted</Badge>}</Td>
                  <Td className="text-xs text-muted-foreground">{last ? `${last.user}, ${new Date(last.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. ${last.detail ?? ""}` : "Never"}</Td>
                  <Td className="text-right">{enc && <Button size="sm" onClick={() => navigate("/chart", { visit: enc.visitNumber })}>Open Chart</Button>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
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
                <Td className="text-xs text-muted-foreground">{new Date(m.sentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
