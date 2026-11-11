import * as React from "react";
import { Badge, Card, CardHeader, Empty, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AI_LABEL } from "@/lib/ai/context";
import { aiUseCase, countStatus, FRAMEWORKS, isAi, REGISTER, usageOf, type Risk, type Status } from "@/lib/ai/governance";
import { useAudit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import { can, useSession } from "@/lib/session";

/** AI governance for the Compliance menu: use case register, live usage from the audit trail, and honest checklists. */

const RISK_TONE: Record<Risk, "ok" | "warn" | "danger"> = { Low: "ok", Medium: "warn", High: "danger" };
const STATUS_TONE: Record<Status, "ok" | "warn" | "danger"> = { Applied: "ok", Partial: "warn", "Not applied": "danger" };
const ACTION_TONE = { "ai-suggest": "info", "ai-accept": "ok", "ai-reject": "danger" } as const;
const ACTION_LABEL = { "ai-suggest": "Suggested", "ai-accept": "Accepted", "ai-reject": "Rejected" } as const;
const pct = (v: number | null) => (v === null ? "No decisions yet" : `${Math.round(v * 100)}%`);

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AiGovernancePage() {
  useSession();
  const dev = useDevMode();
  const audit = useAudit();
  const [action, setAction] = React.useState("all");
  const [useCase, setUseCase] = React.useState("all");

  if (!can("audit.read")) {
    return (
      <div>
        <PageHeader title="AI Governance" />
        <Card><Empty>Your role cannot open the AI governance page.</Empty></Card>
      </div>
    );
  }

  const all = usageOf(audit);
  const log = audit
    .filter(isAi)
    .filter((e) => (action === "all" || e.action === action) && (useCase === "all" || aiUseCase(e) === useCase))
    .slice()
    .reverse()
    .slice(0, 200);

  return (
    <div>
      <PageHeader
        title="AI Governance"
        subtitle="What the AI assistant is for, how it is used, and how it measures up against Saudi guidance. The assistant is a simulated decision-support aid. It is not a certified medical device."
      />

      <div className="mb-4 rounded-xl border border-warn/40 bg-warn/8 p-4 text-sm">
        <p className="font-medium">{AI_LABEL}</p>
        <p className="mt-1 text-muted-foreground">
          There is no AI model here. The assistant follows fixed rules and templates over the open chart, makes no network calls, and has not been clinically validated. SFDA has not assessed it. The same interface could later sit in front of a real model, which would need a new review.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Use Cases</TabsTrigger>
          <TabsTrigger value="log">Usage Log</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Suggestions made" value={all.suggested} />
            <Stat label="Accepted" value={all.accepted} />
            <Stat label="Rejected" value={all.rejected} />
            <Stat label="Acceptance rate" value={pct(all.acceptance)} hint="Accepted out of accepted plus rejected" />
            <Stat label="Edited before accepting" value={all.accepted ? `${Math.round((all.edited / all.accepted) * 100)}%` : "None yet"} hint="A high rate means the drafts need work" />
          </div>
          <Card>
            <CardHeader title="AI Use Case Register" subtitle="Risk is the Onasi team's own rating, not a regulator's class." />
            <Table>
              <thead>
                <tr><Th>Use case</Th><Th>Purpose</Th><Th>Data used</Th><Th>Risk</Th><Th>Human in the loop</Th><Th>Status</Th><Th>Used</Th><Th>Accept rate</Th></tr>
              </thead>
              <tbody>
                {REGISTER.map((r) => {
                  const u = usageOf(audit, r.id);
                  return (
                    <tr key={r.id} className="align-top">
                      <Td className="font-medium">{r.name}{dev && <span className="block font-mono text-xs text-muted-foreground">{r.id}</span>}</Td>
                      <Td className="min-w-48 text-xs">{r.purpose}</Td>
                      <Td className="min-w-48 text-xs text-muted-foreground">{r.data}</Td>
                      <Td><Badge tone={RISK_TONE[r.risk]}>{r.risk}</Badge><span className="mt-1 block max-w-44 text-xs text-muted-foreground">{r.riskWhy}</span></Td>
                      <Td className="min-w-48 text-xs">{r.hitl}</Td>
                      <Td className="min-w-40 text-xs">{r.status}</Td>
                      <Td className="tabular-nums">{u.suggested}</Td>
                      <Td className="whitespace-nowrap text-xs">{pct(u.acceptance)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="log" className="pt-3">
          <Card>
            <CardHeader
              title="Live Usage Log"
              subtitle="Filtered from the audit trail. It records who, what, when and which patient. It stores field names, not the text of the draft."
              right={
                <div className="flex gap-2">
                  <Select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action" className="w-36">
                    <option value="all">All actions</option>
                    <option value="ai-suggest">Suggested</option>
                    <option value="ai-accept">Accepted</option>
                    <option value="ai-reject">Rejected</option>
                  </Select>
                  <Select value={useCase} onChange={(e) => setUseCase(e.target.value)} aria-label="Filter by use case" className="w-44">
                    <option value="all">All use cases</option>
                    {REGISTER.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                </div>
              }
            />
            {log.length === 0 ? (
              <Empty>No AI activity yet. Open a patient chart and use Onasi AI (the tab on the right edge, or Ctrl+J) or Draft With Onasi AI on the SOAP Notes tab.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Time</Th><Th>User</Th><Th>Action</Th><Th>What</Th><Th>Patient</Th><Th>Detail</Th></tr></thead>
                <tbody>
                  {log.map((e) => (
                    <tr key={e.id}>
                      <Td className="whitespace-nowrap font-mono text-xs">{e.at.slice(0, 19).replace("T", " ")}</Td>
                      <Td className="text-xs">{e.user}<span className="block text-muted-foreground">{e.role}</span></Td>
                      <Td><Badge tone={ACTION_TONE[e.action as keyof typeof ACTION_TONE]}>{ACTION_LABEL[e.action as keyof typeof ACTION_LABEL]}</Badge></Td>
                      <Td className="text-xs">{e.target.replace(/^AI /, "")}</Td>
                      <Td className="text-xs">{e.patient ?? ""}</Td>
                      <Td className="max-w-md text-xs text-muted-foreground">{e.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="checklists" className="space-y-4 pt-3">
          {FRAMEWORKS.map((f) => {
            const c = countStatus(f);
            return (
              <Card key={f.id}>
                <CardHeader
                  title={f.name}
                  subtitle={f.note}
                  right={
                    <div className="flex gap-1.5">
                      <Badge tone="ok">{c.Applied} applied</Badge>
                      <Badge tone="warn">{c.Partial} partial</Badge>
                      <Badge tone="danger">{c["Not applied"]} not applied</Badge>
                    </div>
                  }
                />
                <Table>
                  <thead><tr><Th>Requirement</Th><Th>How the app handles it</Th><Th>Status</Th></tr></thead>
                  <tbody>
                    {f.items.map((i) => (
                      <tr key={i.id}>
                        <Td className="min-w-56 font-medium">{i.requirement}</Td>
                        <Td className="text-sm text-muted-foreground">{i.how}</Td>
                        <Td><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
