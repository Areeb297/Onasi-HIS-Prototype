import * as React from "react";
import { AlertTriangle, Check, ChevronRight, Info, Play, X } from "lucide-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { Badge, Button, Card, Empty, cn } from "@/components/ui/primitives";
import { quickSend } from "@/lib/actions";
import { AGENTS, AGENT_BY_ID, needsDecision, runAgent, type AgentId, type AgentRun, type Proposal } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { audit } from "@/lib/audit";
import { buildOutbox, sendRow } from "@/lib/nphies-outbox";
import { DOCTORS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/**
 * Onasi AI agents. The left side is the roster: six agents, each with one job. The right side is the worksheet
 * of the agent you picked: the steps it took, then what it proposes. Nothing happens until a person approves.
 */

type Decision = "approved" | "dismissed" | "failed";

const doctorName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "the attending doctor";
};

/** Carries out one approved proposal. Returns false when the action could not be done. */
function carryOut(p: Proposal): boolean {
  const a = p.action;
  if (!a) return true;
  switch (a.kind) {
    case "send-row": {
      const row = buildOutbox().find((r) => r.key === a.rowKey);
      return !!row && sendRow(row) === "accepted";
    }
    case "send-update":
      quickSend("A08", a.visit);
      return true;
    case "open":
      navigate(a.path, a.params);
      return true;
    case "notify":
      pushToast({ tone: "ok", text: `${doctorName(a.to)} notified.`, detail: a.message });
      return true;
    case "copy":
      void navigator.clipboard?.writeText(a.text).catch(() => undefined);
      pushToast({ tone: "ok", text: "Copied." });
      return true;
  }
}

const LEVEL = {
  high: { word: "Urgent", icon: AlertTriangle, cls: "text-destructive" },
  medium: { word: "Soon", icon: AlertTriangle, cls: "text-warn" },
  info: { word: "For your information", icon: Info, cls: "text-muted-foreground" },
} as const;

function ProposalRow({ p, decision, onApprove, onDismiss }: { p: Proposal; decision?: Decision; onApprove: () => void; onDismiss: () => void }) {
  const L = LEVEL[p.level];
  const opens = p.action?.kind === "open" || p.action?.kind === "copy";
  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3.5", decision && "bg-muted/40")}>
      <L.icon className={cn("mt-0.5 size-4 shrink-0", L.cls)} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-72">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{p.patient}</span>
          {p.visit && <span className="font-mono text-xs text-muted-foreground">{p.visit}</span>}
          <span className={cn("text-xs font-medium", L.cls)}>{L.word}</span>
        </div>
        <p className={cn("mt-0.5 text-sm", decision === "dismissed" && "text-muted-foreground line-through")}>{p.text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Why: {p.why}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {decision === "approved" && <Badge tone="ok">Done</Badge>}
        {decision === "dismissed" && <Badge tone="neutral">Dismissed</Badge>}
        {decision === "failed" && <Badge tone="danger">Did not go through</Badge>}
        {!decision && p.action && (
          <>
            <Button size="sm" variant={opens ? "secondary" : "primary"} onClick={onApprove}>
              {opens ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              {opens ? p.action.label : `Approve: ${p.action.label}`}
            </Button>
            {!opens && (
              <Button size="sm" variant="ghost" onClick={onDismiss} aria-label={`Dismiss the proposal for ${p.patient}`}>
                <X className="size-3.5" aria-hidden="true" /> Dismiss
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function AgentsPage() {
  useSession();
  const [runs, setRuns] = React.useState<Partial<Record<AgentId, AgentRun>>>({});
  const [picked, setPicked] = React.useState<AgentId>("discharge");
  const [decisions, setDecisions] = React.useState<Record<string, Decision>>({});
  const [shown, setShown] = React.useState(0); // steps revealed so far, so the trace reads as work being done
  const run = runs[picked];
  const def = AGENT_BY_ID[picked];

  React.useEffect(() => {
    if (!run || shown >= run.steps.length) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(run.steps.length); return; }
    const t = window.setTimeout(() => setShown((n) => n + 1), 320);
    return () => window.clearTimeout(t);
  }, [run, shown]);

  if (!can("ai.use")) return <Card><Empty>Your role cannot use {ASSISTANT_NAME}.</Empty></Card>;

  function start(id: AgentId, quiet = false) {
    const r = runAgent(id);
    audit("ai-suggest", `Agent: ${AGENT_BY_ID[id].name}`, { detail: `${r.proposals.length} proposals. ${r.headline}` });
    setRuns((x) => ({ ...x, [id]: r }));
    setDecisions((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !r.proposals.some((p) => p.id === k))));
    if (!quiet) { setPicked(id); setShown(0); }
  }

  function startAll() {
    for (const a of AGENTS) start(a.id, true);
    setShown(0);
  }

  function decide(p: Proposal, approve: boolean) {
    if (!approve) {
      audit("ai-reject", `Agent proposal: ${p.text}`, { patient: p.patient, detail: AGENT_BY_ID[picked].name });
      setDecisions((d) => ({ ...d, [p.id]: "dismissed" }));
      return;
    }
    const ok = carryOut(p);
    audit("ai-accept", `Agent proposal: ${p.action?.label ?? p.text}`, { patient: p.patient, detail: `${AGENT_BY_ID[picked].name}. ${p.text}` });
    if (p.action?.kind !== "open") setDecisions((d) => ({ ...d, [p.id]: ok ? "approved" : "failed" }));
  }

  const open = run ? run.proposals.filter((p) => !decisions[p.id] && p.action && p.action.kind !== "open" && p.action.kind !== "copy" && p.level !== "info") : [];
  const done = !!run && shown >= run.steps.length;

  return (
    <div>
      <header className="mb-5 overflow-hidden rounded-xl bg-[var(--brand-deep)] text-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[var(--brand-mint)]">
            <OnasiAiMark size={30} thinking={!!run && !done} />
          </span>
          <div className="min-w-0 flex-1 basis-80">
            <h1 className="text-xl font-semibold tracking-tight">{ASSISTANT_NAME} Agents</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/80">
              Each agent has one job across the whole hospital. It shows the steps it took and what it proposes. Nothing is done until you approve it, and every decision goes to the audit trail.
            </p>
          </div>
          <button
            type="button"
            onClick={startAll}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand-mint)] px-4 text-sm font-semibold text-[var(--brand-deep)] transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Play className="size-4" aria-hidden="true" /> Run The Morning Round
          </button>
        </div>
        <p className="border-t border-white/10 px-6 py-2 text-xs text-white/70">Simulated with fixed rules. Not a medical device. Confidential charts stay closed unless you broke the glass.</p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
        <nav aria-label="Agents" className="overflow-hidden rounded-xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {AGENTS.map((a) => {
              const r = runs[a.id];
              const n = r ? needsDecision(r) : 0;
              const on = a.id === picked;
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { setPicked(a.id); setShown(runs[a.id]?.steps.length ?? 0); }}
                    aria-current={on ? "true" : undefined}
                    className={cn("flex w-full items-start gap-3 border-l-4 px-4 py-3.5 text-left transition-colors", on ? "border-l-primary bg-accent/50" : "border-l-transparent hover:bg-muted/60")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{a.name}</span>
                        {r && (n ? <Badge tone="warn">{n} to review</Badge> : <Badge tone="ok">Clear</Badge>)}
                      </div>
                      <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">{r ? r.headline : a.job}</p>
                    </div>
                    <ChevronRight className={cn("mt-1 size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-label={`${def.name} worksheet`} className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 flex-1 basis-72">
              <h2 className="text-lg font-semibold">{def.name}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{def.job}</p>
              <dl className="mt-2.5 grid gap-x-6 gap-y-1 text-[0.8125rem] sm:grid-cols-2">
                <div><dt className="inline text-muted-foreground">For: </dt><dd className="inline">{def.forWhom}</dd></div>
                <div><dt className="inline text-muted-foreground">May do, once approved: </dt><dd className="inline">{def.canDo}</dd></div>
              </dl>
            </div>
            <Button variant="primary" onClick={() => start(picked)}>
              <Play className="size-4" aria-hidden="true" /> {run ? "Run Again" : "Run This Agent"}
            </Button>
          </div>

          {!run ? (
            <Empty>This agent has not run yet. Run it, or run the morning round to start all six.</Empty>
          ) : (
            <>
              <div className="border-b border-border bg-muted/30 px-5 py-4">
                <h3 className="text-xs font-semibold text-muted-foreground">What it did</h3>
                <ol className="mt-2 space-y-0">
                  {run.steps.slice(0, shown).map((s, i) => (
                    <li key={i} className="relative flex gap-3 pb-2.5 last:pb-0">
                      {i < run.steps.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-border" aria-hidden="true" />}
                      <span className="relative z-10 mt-0.5 flex size-[19px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" aria-hidden="true" /></span>
                      <span className="text-sm">{s.did} <span className="text-muted-foreground">({s.found})</span></span>
                    </li>
                  ))}
                  {!done && <li className="flex items-center gap-3 text-sm text-muted-foreground"><OnasiAiMark size={19} thinking /> Working</li>}
                </ol>
              </div>

              {done && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <p className="text-[0.9375rem] font-semibold">{run.headline}</p>
                    {open.length > 1 && (
                      <Button size="sm" onClick={() => open.forEach((p) => decide(p, true))}>
                        <Check className="size-3.5" aria-hidden="true" /> Approve All {open.length}
                      </Button>
                    )}
                  </div>
                  {run.proposals.length ? (
                    <ul className="divide-y divide-border border-t border-border">
                      {run.proposals.map((p) => (
                        <ProposalRow key={p.id} p={p} decision={decisions[p.id]} onApprove={() => decide(p, true)} onDismiss={() => decide(p, false)} />
                      ))}
                    </ul>
                  ) : (
                    <Empty>Nothing to propose. Everything this agent checks is in order.</Empty>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
