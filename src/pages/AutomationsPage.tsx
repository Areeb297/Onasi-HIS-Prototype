import * as React from "react";
import {
  IconBell, IconChecks, IconCopy, IconHistory, IconListCheck, IconPlayerPause, IconPlayerPlay, IconPlus, IconRoute, IconTrash, IconUserCheck,
} from "@tabler/icons-react";
import { ChevronDown } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { GLASS_BTN, ICON_BTN } from "@/components/ai/chat-parts";
import { KIND_STYLE } from "@/components/automation/node-style";
import { RunLog, when } from "@/components/automation/RunLog";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Input, PageHeader, Select, cn } from "@/components/ui/primitives";
import { acknowledgeNotice, approveStep, completeTask, declineStep } from "@/lib/automation-engine";
import {
  RUN_STATUS_LABEL, STATUS_LABEL, TEMPLATES, TRIGGER_BY_ID, actsFor, createAutomation, deleteAutomation, duplicateAutomation, lastRun, roleLabel, runsToday,
  setAutomationStatus, triggerOf, useAutomations, waitingApprovals,
  type Automation, type AutomationStatus, type Flow, type Run, type RunStatus, type Template,
} from "@/lib/automations";
import { navigate, useRoute } from "@/lib/router";
import { useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";
import { fmtTime } from "@/lib/format";

/**
 * Automations: the list of flows and their run history. A flow watches one HIS event, then notifies people, adds
 * worklist tasks, or, after a named role approves, asks for a consult, a follow-up or a prior authorization.
 * Nothing in a patient or billing record changes without a person approving it.
 */

const HAIR = "border-[rgba(20,32,28,0.07)] dark:border-white/5";
const STATUS_TONE: Record<AutomationStatus, "ok" | "warn" | "neutral"> = { active: "ok", paused: "warn", draft: "neutral" };
const RUN_TONE: Record<RunStatus, "ok" | "warn" | "neutral" | "danger" | "update"> = { done: "ok", waiting: "warn", approval: "update", running: "neutral", stopped: "danger" };
const FILTERS = ["All", "Active", "Paused", "Draft"] as const;

/** The kinds of step in a flow, top to bottom, as a strip of small coloured marks. */
function StepStrip({ flow, className }: { flow: Flow; className?: string }) {
  const nodes = [...flow.nodes].sort((a, b) => a.y - b.y || a.x - b.x);
  return (
    <span className={cn("flex items-center gap-1", className)} aria-hidden="true">
      {nodes.map((n) => {
        const st = KIND_STYLE[n.kind];
        return <span key={n.id} className="flex size-5 items-center justify-center rounded-md border" style={{ color: st.ink, borderColor: `${st.edge}40`, background: st.tint }}><st.Icon className="size-3" stroke={2} /></span>;
      })}
    </span>
  );
}

function triggerLabel(a: Automation) {
  const t = triggerOf(a.flow);
  return t ? TRIGGER_BY_ID[t].label : "No trigger yet";
}

export function AutomationsPage() {
  const s = useAutomations();
  useSession();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("All");
  const [creating, setCreating] = React.useState<{ template: string } | null>(null);
  const [deleting, setDeleting] = React.useState<Automation | null>(null);
  const now = new Date();

  const list = s.automations.filter((a) => filter === "All" || STATUS_LABEL[a.status] === filter);
  const active = s.automations.filter((a) => a.status === "active").length;
  const today = s.automations.reduce((n, a) => n + runsToday(a.id, now, s), 0);
  const approvals = waitingApprovals(s).length;
  const openTasks = s.tasks.filter((t) => !t.doneAt).length;

  function toggle(a: Automation) {
    const to: AutomationStatus = a.status === "active" ? "paused" : "active";
    const r = setAutomationStatus(a.id, to);
    if (!r.ok) {
      pushToast({ tone: "warn", text: `${a.name} has ${r.errors.length} problem${r.errors.length === 1 ? "" : "s"} to fix first.`, detail: r.errors[0], link: { label: "Open Builder", run: () => navigate("/automations/builder", { id: a.id }) } });
      return;
    }
    pushToast({ tone: "ok", text: `${a.name} ${to === "active" ? "activated" : "paused"}.`, detail: to === "active" ? `It runs on each new ${triggerLabel(a)} event.` : "No new runs start. Runs already waiting keep their place." });
  }

  function duplicate(a: Automation) {
    const r = duplicateAutomation(a.id);
    if (r.ok) pushToast({ tone: "ok", text: "Duplicated as a draft.", detail: r.value.name, link: { label: "Open", run: () => navigate("/automations/builder", { id: r.value.id }) } });
  }

  const actions = (a: Automation) => (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <button type="button" className={cn(GLASS_BTN, "h-8 px-2.5 text-[0.8125rem]")} onClick={() => toggle(a)} aria-label={`${a.status === "active" ? "Pause" : "Activate"} ${a.name}`}>
        {a.status === "active" ? <><IconPlayerPause className="size-4" aria-hidden="true" />Pause</> : <><IconChecks className="size-4" aria-hidden="true" />Activate</>}
      </button>
      <button type="button" className={cn(GLASS_BTN, "h-8 px-2.5 text-[0.8125rem]")} onClick={() => navigate("/automations/builder", { id: a.id, test: "1" })} aria-label={`Test run ${a.name}`}>
        <IconPlayerPlay className="size-4" aria-hidden="true" />Test Run
      </button>
      <button type="button" className={ICON_BTN} onClick={() => duplicate(a)} aria-label={`Duplicate ${a.name}`} title="Duplicate"><IconCopy className="size-4" aria-hidden="true" /></button>
      <button type="button" className={cn(ICON_BTN, "hover:text-destructive")} onClick={() => setDeleting(a)} aria-label={`Delete ${a.name}`} title="Delete"><IconTrash className="size-4" aria-hidden="true" /></button>
    </div>
  );

  const lastCell = (a: Automation) => {
    const r = lastRun(a.id, s);
    return r ? (
      <button type="button" className="text-left text-[0.8125rem] hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => navigate("/automations/history", { automation: a.id })}>
        <span className="block tabular-nums">{when(r.startedAt, now)}</span>
        <span className="block text-xs text-muted-foreground">{RUN_STATUS_LABEL[r.status]}</span>
      </button>
    ) : <span className="text-[0.8125rem] text-muted-foreground">Never</span>;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Automations"
        subtitle="Flows that watch HIS events and alert people, add worklist tasks or ask for approval. No record changes until a person approves."
        right={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/automations/history")}><IconHistory className="size-4" aria-hidden="true" />Run History</Button>
            <Button variant="primary" className="bg-[#032C26] hover:brightness-125" onClick={() => setCreating({ template: "" })}><IconPlus className="size-4" aria-hidden="true" />New Automation</Button>
          </div>
        }
      />

      <KpiStrip label="Automations today" className="grid-cols-2 lg:grid-cols-4">
        <KpiTile icon={<IconRoute stroke={1.75} />} label="Active" value={`${active} of ${s.automations.length}`} note={s.lastCheck ? `Last check ${fmtTime(s.lastCheck)}` : "Checks every minute"} />
        <KpiTile icon={<IconPlayerPlay stroke={1.75} />} label="Runs Today" value={String(today)} note="Test runs not counted" />
        <KpiTile icon={<IconUserCheck stroke={1.75} />} label="Waiting For Approval" value={String(approvals)} note={approvals ? "A person must decide" : "Nothing waiting"} onClick={() => navigate("/automations/history")} />
        <KpiTile icon={<IconListCheck stroke={1.75} />} label="Open Worklist Tasks" value={String(openTasks)} note="Added by automations" onClick={() => navigate("/automations/history")} />
      </KpiStrip>

      <section className="glass-panel overflow-hidden rounded-2xl" aria-labelledby="auto-list">
        <div className={cn("flex flex-wrap items-center gap-3 border-b px-5 py-3.5", HAIR)}>
          <h2 id="auto-list" className="flex min-w-0 flex-1 items-center whitespace-nowrap text-base font-semibold text-[#032C26] dark:text-foreground">
            Automations <span className="ms-1 rounded-full bg-[#39EDD5]/15 px-2 py-0.5 text-xs font-medium tabular-nums text-[#035D53]">{list.length}</span>
          </h2>
          <GlassPillSwitch size="sm" label="Show automations" value={filter} options={FILTERS} onChange={setFilter} />
        </div>

        {list.length === 0 ? (
          <Empty>{s.automations.length ? `No ${filter.toLowerCase()} automations.` : "No automations yet. Start from a template below or press New Automation."}</Empty>
        ) : (
          <>
            {/* Tablet and computer: a table. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-muted-foreground">
                    <th className="px-5 py-2.5 font-semibold">Name</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold">Trigger</th>
                    <th className="px-3 py-2.5 font-semibold">Last Run</th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-right font-semibold">Runs Today</th>
                    <th className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={cn("border-t align-middle", HAIR)}>
                      <td className="max-w-[22rem] px-5 py-3">
                        <button type="button" onClick={() => navigate("/automations/builder", { id: a.id })} className="text-left font-semibold text-[#032C26] hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-foreground">{a.name}</button>
                        {a.description && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{a.description}</p>}
                        <StepStrip flow={a.flow} className="mt-1.5" />
                      </td>
                      <td className="px-3 py-3"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
                      <td className="px-3 py-3 text-[0.8125rem]">{triggerLabel(a)}</td>
                      <td className="px-3 py-3">{lastCell(a)}</td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">{runsToday(a.id, now, s)}</td>
                      <td className="px-5 py-3">{actions(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phone: one card per automation. */}
            <ul className="divide-y divide-[rgba(20,32,28,0.07)] md:hidden">
              {list.map((a) => (
                <li key={a.id} className="space-y-2 px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => navigate("/automations/builder", { id: a.id })} className="min-w-0 text-left font-semibold text-[#032C26] hover:underline focus-visible:outline-2 focus-visible:outline-ring">{a.name}</button>
                    <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div className="col-span-3"><dt className="text-muted-foreground">Trigger</dt><dd className="font-medium">{triggerLabel(a)}</dd></div>
                    <div className="col-span-2"><dt className="text-muted-foreground">Last Run</dt><dd>{lastCell(a)}</dd></div>
                    <div><dt className="text-muted-foreground">Runs Today</dt><dd className="text-sm font-semibold tabular-nums">{runsToday(a.id, now, s)}</dd></div>
                  </dl>
                  <div className="[&>div]:justify-start">{actions(a)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="tpl-head" className="space-y-3">
        <div>
          <h2 id="tpl-head" className="text-base font-semibold text-[#032C26] dark:text-foreground">Start From A Template</h2>
          <p className="text-sm text-muted-foreground">Each template opens as a draft you can change before you activate it.</p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {TEMPLATES.map((t) => <TemplateCard key={t.id} t={t} onUse={() => setCreating({ template: t.id })} />)}
        </ul>
      </section>

      {creating && <NewDialog initial={creating.template} onClose={() => setCreating(null)} />}
      <Dialog open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.name ?? ""}?`} subtitle="Its run history is kept. Runs waiting for a wait or an approval stop."
        footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Keep It</Button><Button variant="danger" onClick={() => { if (deleting) { deleteAutomation(deleting.id); pushToast({ tone: "ok", text: "Automation deleted." }); } setDeleting(null); }}>Delete</Button></>}>
        <p className="text-sm">{deleting?.status === "active" ? "This automation is active. Pausing it keeps the flow if you may need it again." : "The flow is removed from the list."}</p>
      </Dialog>
    </div>
  );
}

function TemplateCard({ t, onUse }: { t: Template; onUse: () => void }) {
  const trig = t.flow.nodes.find((n) => n.kind === "trigger")?.settings.trigger;
  return (
    <li className="glass-card flex flex-col rounded-2xl p-4">
      <p className="text-xs font-medium text-[#035D53] dark:text-[#52FCE3]">{trig ? TRIGGER_BY_ID[trig].label : ""}</p>
      <h3 className="mt-1 text-[0.9375rem] font-semibold leading-snug text-[#032C26] dark:text-foreground">{t.name}</h3>
      <p className="mt-1 flex-1 text-[0.8125rem] leading-snug text-muted-foreground">{t.description}</p>
      <StepStrip flow={t.flow} className="mt-3 flex-wrap" />
      <button type="button" className={cn(GLASS_BTN, "mt-3 h-8 self-start px-3 text-[0.8125rem]")} onClick={onUse} aria-label={`Use the template ${t.name}`}>Use Template</button>
    </li>
  );
}

function NewDialog({ initial, onClose }: { initial: string; onClose: () => void }) {
  const [template, setTemplate] = React.useState(initial);
  const [name, setName] = React.useState("");
  const t = TEMPLATES.find((x) => x.id === template);
  function create() {
    const a = createAutomation({ name, templateId: template || undefined });
    onClose();
    navigate("/automations/builder", { id: a.id });
  }
  return (
    <Dialog open onClose={onClose} title="New Automation" subtitle="It starts as a draft. Nothing runs until you activate it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={create}>Create And Open</Button></>}>
      <div className="space-y-4">
        <Field label="Start From">
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="">A blank flow</option>
            {TEMPLATES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        </Field>
        {t && <p className="text-[0.8125rem] text-muted-foreground">{t.description}</p>}
        <Field label="Name" hint="Optional. Left empty, the template name is used.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t?.name ?? "New Automation"} />
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- run history ---------- */

export function AutomationRunHistoryPage() {
  const s = useAutomations();
  const { user } = useSession();
  const route = useRoute();
  const filter = route.params.get("automation") ?? "";
  const [declining, setDeclining] = React.useState<{ run: Run; index: number } | null>(null);
  const [reason, setReason] = React.useState("");
  const now = new Date();
  const runs = s.runs.filter((r) => !r.test && (!filter || r.automationId === filter)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const approvals = waitingApprovals(s).filter((x) => !filter || x.run.automationId === filter);
  const notices = s.notices.filter((n) => !n.acknowledgedAt && (!filter || s.runs.find((r) => r.id === n.runId)?.automationId === filter)).slice(0, 12);
  const tasks = s.tasks.filter((t) => !t.doneAt && (!filter || s.runs.find((r) => r.id === t.runId)?.automationId === filter)).slice(0, 12);
  const named = filter ? s.automations.find((a) => a.id === filter) ?? { name: runs[0]?.automationName ?? filter } : null;
  const [shown, setShown] = React.useState(20);

  const report = (r: { ok: boolean; errors?: string[] } | { ok: true; value: unknown }, ok: string) => {
    if (r.ok) pushToast({ tone: "ok", text: ok });
    else pushToast({ tone: "warn", text: (r as { errors: string[] }).errors[0] });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={named ? `Run History: ${named.name}` : "Run History"}
        subtitle="Every run, step by step: what started it, what it checked, who approved, and what it did."
        right={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Automation
              <Select value={filter} onChange={(e) => navigate("/automations/history", { automation: e.target.value || undefined })} className="min-w-[14rem]">
                <option value="">All automations</option>
                {s.automations.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </label>
            <Button onClick={() => navigate("/automations")}>Automations</Button>
          </div>
        }
      />

      {approvals.length > 0 && (
        <section className="glass-panel overflow-hidden rounded-2xl" aria-labelledby="h-approvals">
          <h2 id="h-approvals" className={cn("flex items-center gap-2 border-b px-5 py-3.5 text-base font-semibold text-[#032C26] dark:text-foreground", HAIR)}>
            <IconUserCheck className="size-5 text-[#6D28D9]" aria-hidden="true" />Waiting For Approval
            <span className="rounded-full bg-[#6D28D9]/10 px-2 py-0.5 text-xs font-medium tabular-nums text-[#6D28D9]">{approvals.length}</span>
          </h2>
          <ul className="divide-y divide-[rgba(20,32,28,0.07)]">
            {approvals.map(({ run, token, index }) => {
              const mine = actsFor(token.awaiting, user);
              const last = [...run.steps].reverse().find((x) => x.status === "approval");
              return (
                <li key={`${run.id}-${index}`} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{run.automationName}</p>
                    <p className="text-[0.8125rem]">{run.event.patient}{run.event.visit ? `, visit ${run.event.visit}` : ""}. {run.event.summary}.</p>
                    <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{last?.text} Since {when(last?.at ?? run.startedAt, now)}.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!mine && <span className="text-xs text-muted-foreground">Only the {roleLabel(token.awaiting)} can decide.</span>}
                    <Button size="sm" onClick={() => { setDeclining({ run, index }); setReason(""); }} disabled={!mine}>Decline</Button>
                    <Button size="sm" variant="primary" disabled={!mine} onClick={() => report(approveStep(run.id, index), "Approved. The flow went on.")}>Approve</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="glass-panel overflow-hidden rounded-2xl" aria-labelledby="h-msgs">
          <h2 id="h-msgs" className={cn("flex items-center gap-2 border-b px-5 py-3.5 text-base font-semibold text-[#032C26] dark:text-foreground", HAIR)}>
            <IconBell className="size-5 text-[#035D53]" aria-hidden="true" />Messages Not Acknowledged <span className="text-sm font-normal tabular-nums text-muted-foreground">{notices.length}</span>
          </h2>
          {notices.length ? (
            <ul className="divide-y divide-[rgba(20,32,28,0.07)]">
              {notices.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 text-[0.8125rem]">
                    <p><span className="font-semibold">To {n.to}.</span> {n.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{n.automationName}, {when(n.at, now)}</p>
                  </div>
                  <Button size="sm" onClick={() => report(acknowledgeNotice(n.id), "Acknowledged.")}>Acknowledge</Button>
                </li>
              ))}
            </ul>
          ) : <Empty>No messages waiting.</Empty>}
        </section>
        <section className="glass-panel overflow-hidden rounded-2xl" aria-labelledby="h-tasks">
          <h2 id="h-tasks" className={cn("flex items-center gap-2 border-b px-5 py-3.5 text-base font-semibold text-[#032C26] dark:text-foreground", HAIR)}>
            <IconListCheck className="size-5 text-[#035D53]" aria-hidden="true" />Open Worklist Tasks <span className="text-sm font-normal tabular-nums text-muted-foreground">{tasks.length}</span>
          </h2>
          {tasks.length ? (
            <ul className="divide-y divide-[rgba(20,32,28,0.07)]">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 text-[0.8125rem]">
                    <p><span className="font-semibold">{t.worklist}.</span> {t.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t.role ? `${roleLabel(t.role)}, ` : ""}{t.automationName}, {when(t.at, now)}</p>
                  </div>
                  <Button size="sm" onClick={() => report(completeTask(t.id), "Task done.")}>Mark Done</Button>
                </li>
              ))}
            </ul>
          ) : <Empty>No open tasks.</Empty>}
        </section>
      </div>

      <section className="glass-panel overflow-hidden rounded-2xl" aria-labelledby="h-runs">
        <h2 id="h-runs" className={cn("border-b px-5 py-3.5 text-base font-semibold text-[#032C26] dark:text-foreground", HAIR)}>
          Runs <span className="ms-1 text-sm font-normal tabular-nums text-muted-foreground">{runs.length}</span>
        </h2>
        {runs.length ? (
          <ul className="divide-y divide-[rgba(20,32,28,0.07)]">
            {runs.slice(0, shown).map((r) => (
              <li key={r.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-white/50 [&::-webkit-details-marker]:hidden">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{when(r.startedAt, now)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{r.automationName}</span>
                      <span className="block text-[0.8125rem] text-muted-foreground">{r.event.patient}{r.event.visit ? `, ${r.event.visit}` : ""}. {r.event.summary}.</span>
                    </span>
                    <Badge tone={RUN_TONE[r.status]}>{RUN_STATUS_LABEL[r.status]}</Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">{r.steps.length} steps</span>
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
                  </summary>
                  <div className="space-y-3 border-t border-[rgba(20,32,28,0.05)] bg-white/40 px-5 py-3">
                    <RunLog run={r} />
                    {s.automations.some((a) => a.id === r.automationId) && (
                      <button type="button" className={cn(GLASS_BTN, "h-8 px-3 text-[0.8125rem]")} onClick={() => navigate("/automations/builder", { id: r.automationId })}>Open The Flow</button>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : <Empty>No runs yet. An active automation runs when its event happens in the HIS.</Empty>}
        {runs.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 20)} className={cn("w-full border-t px-5 py-3 text-left text-[0.8125rem] font-medium text-[#035D53] hover:bg-white/50", HAIR)}>Show 20 More</button>
        )}
      </section>

      <Dialog open={!!declining} onClose={() => setDeclining(null)} title="Decline This Step" subtitle="The path stops here. Nothing after the approval runs."
        footer={<><Button variant="ghost" onClick={() => setDeclining(null)}>Cancel</Button><Button variant="danger" disabled={!reason.trim()} onClick={() => { if (declining) report(declineStep(declining.run.id, declining.index, reason), "Declined."); setDeclining(null); }}>Decline</Button></>}>
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: already booked by the clinic" autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
