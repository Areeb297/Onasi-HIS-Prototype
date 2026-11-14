import * as React from "react";
import { IconMessageChatbot, IconPlayerPause, IconPlayerPlay, IconRefresh, IconRobot } from "@tabler/icons-react";
import { Check } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { TaskRow, timeOf } from "@/components/ai/TaskRow";
import { Button, Card, Empty, cn } from "@/components/ui/primitives";
import {
  checkNow, isPaused, modeOf, progressOf, setMode, setPaused, useAgentWork, waitingTasks, type FeedItem, type Mode,
} from "@/lib/ai/agent-work";
import { AGENTS, AGENT_BY_ID, type AgentDef, type AgentId } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { navigate, useRoute } from "@/lib/router";
import { can, useSession } from "@/lib/session";

/**
 * Onasi AI. Two views of the same agents.
 * Agents At Work: the agents check the hospital in the background. This page shows what each one did, what it finished
 * by itself, and what waits for a person. Ask Onasi AI: a chat that runs the same checks on a question.
 */

const TABS = [
  { id: "work", label: "Agents At Work", icon: IconRobot },
  { id: "ask", label: `Ask ${ASSISTANT_NAME}`, icon: IconMessageChatbot },
] as const;
type TabId = (typeof TABS)[number]["id"];

const FEED_WORD: Record<FeedItem["kind"], string> = { found: "Found", done: "Done", dismissed: "Dismissed", failed: "Failed", resolved: "Closed", setting: "Setting" };

function Stat({ label, value, note, live }: { label: string; value: React.ReactNode; note: string; live?: boolean }) {
  return (
    <div className="min-w-0 flex-1 basis-40 px-5 py-4">
      <div className="flex items-center gap-2 text-[0.8125rem] font-medium text-muted-foreground">
        {live && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60 motion-reduce:hidden" /><span className="relative inline-flex size-2 rounded-full bg-ok" /></span>}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>
    </div>
  );
}

function AgentCard({ def, onAsk, onAutomatic }: { def: AgentDef; onAsk: () => void; onAutomatic: () => void }) {
  const work = useAgentWork();
  const paused = isPaused(def.id, work);
  const mode = modeOf(def.id, work);
  const prog = progressOf(def.id, new Date(), work);
  const last = work.last[def.id];
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const canAuto = def.autoKinds.length > 0;

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 px-4 pt-4">
        <AgentIcon agent={def.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.9375rem] font-semibold leading-tight">{def.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs font-medium">
            <span className={cn("size-2 rounded-full", paused ? "bg-muted-foreground/50" : "bg-ok")} aria-hidden="true" />
            <span className={paused ? "text-muted-foreground" : "text-ok"}>{paused ? "Paused" : "Watching"}</span>
            {!paused && last && <span className="font-normal text-muted-foreground">last check {timeOf(last.at)}</span>}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPaused(def.id, !paused)} aria-label={paused ? `Resume ${def.name}` : `Pause ${def.name}`} title={paused ? "Resume" : "Pause"}>
          {paused ? <IconPlayerPlay className="size-4" aria-hidden="true" /> : <IconPlayerPause className="size-4" aria-hidden="true" />}
        </Button>
      </div>

      <p className="px-4 pt-2.5 text-[0.8125rem] leading-snug text-muted-foreground">{def.job}</p>

      <div className="px-4 pt-3">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">{prog.total ? `${prog.done} of ${prog.total} tasks done today` : "No tasks today"}</span>
          {prog.waiting > 0 && <span className="font-semibold text-warn">{prog.waiting} waiting for you</span>}
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${def.name}: tasks done today`}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {last && !paused && <p className="px-4 pt-2.5 text-[0.8125rem]">{last.headline}</p>}

      {canAuto && (
        <div className="px-4 pt-3">
          <div role="radiogroup" aria-label={`How ${def.name} works`} className="flex rounded-lg border border-border bg-muted p-0.5">
            {(["ask", "auto"] as Mode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={paused}
                onClick={() => (m === mode ? undefined : m === "auto" ? onAutomatic() : setMode(def.id, "ask"))}
                className={cn("flex-1 rounded-md px-2 py-1 text-[0.8125rem] font-medium transition-colors disabled:opacity-50", mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                {m === "ask" ? "Ask First" : "Automatic"}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{mode === "auto" ? def.autoText : "It prepares each step and waits for your approval."}</p>
        </div>
      )}
      {!canAuto && <p className="px-4 pt-3 text-xs text-muted-foreground">It raises tasks for staff. It changes nothing by itself.</p>}

      <details className="group mt-3 border-t border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground">
          What it checks
          <span className="text-xs group-open:hidden">Show</span><span className="hidden text-xs group-open:inline">Hide</span>
        </summary>
        <div className="space-y-2 px-4 pb-3.5 text-[0.8125rem]">
          <p><span className="text-muted-foreground">When: </span>{def.watches}.</p>
          <p><span className="text-muted-foreground">For: </span>{def.forWhom}.</p>
          {last && (
            <ol className="space-y-1">
              {last.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden="true" /><span>{s.did} <span className="text-muted-foreground">{s.found}</span></span></li>
              ))}
            </ol>
          )}
          <button type="button" onClick={onAsk} className="inline-flex items-center gap-1.5 font-medium text-move hover:underline"><IconMessageChatbot className="size-4" aria-hidden="true" />Ask: {def.ask}</button>
        </div>
      </details>
    </li>
  );
}

function WorkBoard({ onAsk }: { onAsk: (q: string) => void }) {
  const work = useAgentWork();
  const [confirm, setConfirm] = React.useState<AgentId | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [only, setOnly] = React.useState<AgentId | "all">("all");
  const [showAll, setShowAll] = React.useState(false);
  const now = new Date();
  const waiting = waitingTasks(work);
  const all = progressOf(undefined, now, work);
  const watching = AGENTS.filter((a) => !isPaused(a.id, work)).length;
  const lastAt = Object.values(work.last).map((l) => l!.at).sort().pop();
  const today = work.feed.filter((f) => new Date(f.at).toDateString() === now.toDateString());
  const confirmDef = confirm ? AGENT_BY_ID[confirm] : null;
  const withTasks = AGENTS.filter((a) => waiting.some((t) => t.agent === a.id));
  const filter = only !== "all" && withTasks.some((a) => a.id === only) ? only : "all";
  const listed = waiting.filter((t) => filter === "all" || t.agent === filter);
  const SHOWN = 6;

  function check() {
    setChecking(true);
    checkNow();
    window.setTimeout(() => setChecking(false), 700);
  }

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-stretch divide-border sm:divide-x">
          <Stat live={watching > 0} label="Agents Watching" value={`${watching} of ${AGENTS.length}`} note={lastAt ? `Last check ${timeOf(lastAt)}, then every minute` : "Starting the first check"} />
          <Stat label="Done By Agents Today" value={all.doneByAgent} note="Steps finished without a person" />
          <Stat label="Done By Staff Today" value={all.doneByStaff} note="Approved, or fixed in the record" />
          <Stat label="Waiting For You" value={all.waiting} note={all.waiting ? "Listed below, most urgent first" : "Nothing needs you now"} />
          <div className="flex items-center px-5 py-4">
            <Button onClick={check} disabled={checking}><IconRefresh className={cn("size-4", checking && "animate-spin")} aria-hidden="true" />{checking ? "Checking" : "Check Now"}</Button>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-3.5">
              <h2 className="text-base font-semibold">Waiting For You</h2>
              <p className="text-xs text-muted-foreground">A task closes by itself when the problem is fixed in the record.</p>
            </div>
            {withTasks.length > 1 && (
              <div role="group" aria-label="Show tasks from" className="flex flex-wrap gap-1.5 border-b border-border px-5 py-2.5">
                <button type="button" aria-pressed={filter === "all"} onClick={() => setOnly("all")} className={cn("rounded-full border px-3 py-1 text-[0.8125rem] font-medium", filter === "all" ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>All {waiting.length}</button>
                {withTasks.map((a) => (
                  <button key={a.id} type="button" aria-pressed={filter === a.id} onClick={() => setOnly(a.id)} className={cn("rounded-full border px-3 py-1 text-[0.8125rem] font-medium", filter === a.id ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
                    {a.name} {waiting.filter((t) => t.agent === a.id).length}
                  </button>
                ))}
              </div>
            )}
            {waiting.length ? (
              <>
                <ul className="divide-y divide-border">{(showAll ? listed : listed.slice(0, SHOWN)).map((t) => <TaskRow key={t.id} task={t} />)}</ul>
                {listed.length > SHOWN && (
                  <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-border px-5 py-2.5 text-left text-[0.8125rem] font-medium text-move hover:bg-muted/50">
                    {showAll ? "Show Fewer" : `Show All ${listed.length}`}
                  </button>
                )}
              </>
            ) : (
              <Empty>Nothing is waiting for you. The agents keep watching and will list new tasks here.</Empty>
            )}
          </Card>

          <Card>
            <div className="border-b border-border px-5 py-3.5"><h2 className="text-base font-semibold">Activity Today</h2></div>
            {today.length ? (
              <ol className="divide-y divide-border">
                {today.slice(0, 40).map((f) => (
                  <li key={f.id} className="flex items-start gap-3 px-5 py-2.5">
                    <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{timeOf(f.at)}</span>
                    <AgentIcon agent={f.agent} size="sm" className="mt-0.5" />
                    <div className="min-w-0 flex-1 text-[0.8125rem]">
                      <span className="font-semibold">{FEED_WORD[f.kind]}</span>
                      <span className="text-muted-foreground"> by {f.by === "agent" ? AGENT_BY_ID[f.agent].name : "staff"}{f.patient ? `, ${f.patient}` : `, ${AGENT_BY_ID[f.agent].name}`}</span>
                      <p className="mt-0.5">{f.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No activity yet today.</Empty>
            )}
          </Card>
        </div>

        <section aria-label="Agents">
          <ul className="space-y-3">
            {AGENTS.map((a) => <AgentCard key={a.id} def={a} onAsk={() => onAsk(a.ask)} onAutomatic={() => setConfirm(a.id)} />)}
          </ul>
        </section>
      </div>

      <Dialog
        open={!!confirmDef}
        onClose={() => setConfirm(null)}
        title={confirmDef ? `Set ${confirmDef.name} To Automatic?` : ""}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep Ask First</Button>
            <Button variant="primary" onClick={() => { if (confirm) { setMode(confirm, "auto"); checkNow(); } setConfirm(null); }}>Set To Automatic</Button>
          </>
        }
      >
        {confirmDef && (
          <div className="space-y-2 text-sm">
            <p>{confirmDef.autoText}</p>
            <p>Each step it finishes is listed under Activity Today and written to the audit trail. You can set it back to Ask First at any time.</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function AgentsPage() {
  useSession();
  const route = useRoute();
  const tab: TabId = route.params.get("tab") === "ask" ? "ask" : "work";
  const q = route.params.get("q") ?? undefined;

  if (!can("ai.use")) return <Card><Empty>Your role cannot use {ASSISTANT_NAME}.</Empty></Card>;

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-[var(--brand-mint)]"><OnasiAiMark size={26} /></span>
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold tracking-tight">{ASSISTANT_NAME}</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">Agents watch the hospital in the background and finish routine steps. Anything that changes a record waits for you.</p>
        </div>
        <div role="tablist" aria-label={`${ASSISTANT_NAME} views`} className="flex rounded-xl border border-border bg-muted p-1">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => navigate("/agents", t.id === "ask" ? { tab: "ask" } : undefined)}
              className={cn("inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors", tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <t.icon className="size-[18px]" stroke={1.75} aria-hidden="true" />{t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "work" ? <WorkBoard onAsk={(question) => navigate("/agents", { tab: "ask", q: question })} /> : <AssistantChat firstQuestion={q} />}

      <p className="mt-6 text-xs text-muted-foreground">The checks follow fixed rules on the hospital's own data. {ASSISTANT_NAME} is not a medical device. Confidential charts stay closed unless you broke the glass.</p>
    </div>
  );
}
