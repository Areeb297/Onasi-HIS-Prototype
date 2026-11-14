import * as React from "react";
import { IconCopy, IconMessageChatbot, IconPlayerPause, IconPlayerPlay, IconRefresh } from "@tabler/icons-react";
import { Check } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { TaskRow, timeOf } from "@/components/ai/TaskRow";
import { Button, Card, Empty, cn } from "@/components/ui/primitives";
import { checkNow, isPaused, myDoctorId, progressOf, setPaused, tasksOfDoctor, useAgentWork, waitingTasks, type FeedItem } from "@/lib/ai/agent-work";
import { AGENTS, AGENT_BY_ID, runAgent, type AgentDef } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { openAssistant } from "@/lib/ai/launcher";
import { useRoute } from "@/lib/router";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * Onasi AI, the starting version: three agents for the ward doctor. They read the record and point at what needs the doctor.
 * They change nothing in the record. Agents At Work shows what each one found. Ask Onasi AI answers the same three questions in a chat.
 */

const FEED_WORD: Record<FeedItem["kind"], string> = { found: "Found", done: "Done", dismissed: "Dismissed", failed: "Failed", resolved: "Closed", setting: "Setting" };

function AgentCard({ def, onAsk }: { def: AgentDef; onAsk: () => void }) {
  const work = useAgentWork();
  const paused = isPaused(def.id, work);
  const prog = progressOf(def.id, new Date(), work);
  const last = work.last[def.id];
  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const isSheet = def.id === "handoff";

  function copySheet() {
    const sheet = runAgent("handoff").proposals.find((p) => p.id === "ho-all") ?? runAgent("handoff").proposals[0];
    if (!sheet?.action || sheet.action.kind !== "copy") { pushToast({ tone: "warn", text: "There are no inpatients to hand off." }); return; }
    void navigator.clipboard?.writeText(sheet.action.text).catch(() => undefined);
    pushToast({ tone: "ok", text: "Handoff sheet copied.", detail: "Paste it into the handoff note or a message." });
  }

  return (
    <li className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 px-4 pt-4">
        <AgentIcon agent={def.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.9375rem] font-semibold leading-tight">{def.name}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs font-medium">
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
      {last && !paused && <p className="px-4 pt-2 text-sm font-medium">{last.headline}</p>}

      {!isSheet && (
        <div className="px-4 pt-3">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span>{prog.total ? `${prog.done} of ${prog.total} tasks done today` : "No tasks today"}</span>
            {prog.waiting > 0 && <span className="font-semibold text-warn">{prog.waiting} waiting</span>}
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${def.name}: tasks done today`}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {isSheet && <div className="px-4 pt-3"><Button size="sm" onClick={copySheet} disabled={paused}><IconCopy className="size-4" aria-hidden="true" />Copy Handoff Sheet</Button></div>}

      <p className="px-4 pt-3 text-xs text-muted-foreground">{def.autoText ?? "It points at what needs you. It changes nothing in the record."}</p>

      <details className="group mt-3 border-t border-border">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground">
          What it checks
          <span className="text-xs group-open:hidden">Show</span><span className="hidden text-xs group-open:inline">Hide</span>
        </summary>
        <div className="space-y-2 px-4 pb-3.5 text-[0.8125rem]">
          <p><span className="text-muted-foreground">When: </span>{def.watches}.</p>
          {last && (
            <ol className="space-y-1">
              {last.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden="true" /><span>{s.did} <span className="text-muted-foreground">{s.found}</span></span></li>
              ))}
            </ol>
          )}
          <button type="button" onClick={onAsk} className="inline-flex items-center gap-1.5 text-left font-medium text-move hover:underline"><IconMessageChatbot className="size-4 shrink-0" aria-hidden="true" />Ask: {def.ask}</button>
        </div>
      </details>
    </li>
  );
}

function WorkBoard({ onAsk }: { onAsk: (q: string) => void }) {
  const work = useAgentWork();
  useHis();
  const me = myDoctorId();
  const [mine, setMine] = React.useState(true);
  const [checking, setChecking] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const now = new Date();
  const everyone = waitingTasks(work);
  const own = me ? tasksOfDoctor(everyone, me) : everyone;
  const listed = me && mine ? own : everyone;
  const all = progressOf(undefined, now, work);
  const lastAt = Object.values(work.last).map((l) => l!.at).sort().pop();
  const today = work.feed.filter((f) => new Date(f.at).toDateString() === now.toDateString());
  const SHOWN = 6;

  function check() {
    setChecking(true);
    checkNow();
    window.setTimeout(() => setChecking(false), 700);
  }

  return (
    <div className="space-y-4">
      <ul className="grid gap-3 md:grid-cols-3">
        {AGENTS.map((a) => <AgentCard key={a.id} def={a} onAsk={() => onAsk(a.ask)} />)}
      </ul>

      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3.5">
          <div className="min-w-0 flex-1 basis-60">
            <h2 className="text-base font-semibold">Needs Your Attention <span className="ms-1 font-normal text-muted-foreground">{listed.length}</span></h2>
            <p className="text-xs text-muted-foreground">
              {all.done} done today. {lastAt ? `Last check ${timeOf(lastAt)}, then every minute.` : "Starting the first check."} A task closes by itself when it is fixed in the record.
            </p>
          </div>
          {me && (
            <div role="group" aria-label="Whose patients" className="flex rounded-lg border border-border bg-muted p-0.5">
              {([true, false] as const).map((v) => (
                <button key={String(v)} type="button" aria-pressed={mine === v} onClick={() => setMine(v)} className={cn("rounded-md px-3 py-1 text-[0.8125rem] font-medium transition-colors", mine === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {v ? `My Patients ${own.length}` : `All Patients ${everyone.length}`}
                </button>
              ))}
            </div>
          )}
          <Button size="sm" onClick={check} disabled={checking}><IconRefresh className={cn("size-4", checking && "animate-spin")} aria-hidden="true" />{checking ? "Checking" : "Check Now"}</Button>
        </div>
        {listed.length ? (
          <>
            <ul className="divide-y divide-border">{(showAll ? listed : listed.slice(0, SHOWN)).map((t) => <TaskRow key={t.id} task={t} />)}</ul>
            {listed.length > SHOWN && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full border-t border-border px-5 py-2.5 text-left text-[0.8125rem] font-medium text-move hover:bg-muted/50">
                {showAll ? "Show Fewer" : `Show All ${listed.length}`}
              </button>
            )}
          </>
        ) : (
          <Empty>{me && mine && everyone.length ? "Nothing is waiting for your patients. Choose All Patients to see the rest." : "Nothing needs attention now. The agents keep watching."}</Empty>
        )}
      </Card>

      <details className="group rounded-xl border border-border bg-card">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5">
          <span className="text-base font-semibold">Activity Today <span className="ms-1 font-normal text-muted-foreground">{today.length}</span></span>
          <span className="text-[0.8125rem] font-medium text-muted-foreground group-open:hidden">Show</span><span className="hidden text-[0.8125rem] font-medium text-muted-foreground group-open:inline">Hide</span>
        </summary>
        {today.length ? (
          <ol className="divide-y divide-border border-t border-border">
            {today.slice(0, 30).map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-5 py-2.5">
                <span className="w-16 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{timeOf(f.at)}</span>
                <AgentIcon agent={f.agent} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1 text-[0.8125rem]">
                  <span className="font-semibold">{FEED_WORD[f.kind]}</span>
                  <span className="text-muted-foreground"> by {f.by === "agent" ? AGENT_BY_ID[f.agent]?.name ?? "an agent" : "staff"}{f.patient ? `, ${f.patient}` : ""}</span>
                  <p className="mt-0.5">{f.text}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="border-t border-border"><Empty>No activity yet today.</Empty></div>
        )}
      </details>
    </div>
  );
}

export function AgentsPage() {
  useSession();
  const route = useRoute();
  const q = route.params.get("q") ?? undefined;
  // An old link to the chat tab opens the floating chat instead.
  React.useEffect(() => { if (route.params.get("tab") === "ask") openAssistant(q); }, [route.params, q]);

  if (!can("ai.use")) return <Card><Empty>Your role cannot use {ASSISTANT_NAME}.</Empty></Card>;

  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-[var(--brand-mint)]"><OnasiAiMark size={26} /></span>
        <div className="min-w-0 flex-1 basis-72">
          <h1 className="text-xl font-semibold tracking-tight">{ASSISTANT_NAME} Agents</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">Three agents for the ward doctor. They read the record and point at what needs you. They change nothing in the record.</p>
        </div>
        <Button onClick={() => openAssistant()}><IconMessageChatbot className="size-4" aria-hidden="true" />Ask {ASSISTANT_NAME}</Button>
      </header>

      <WorkBoard onAsk={(question) => openAssistant(question)} />

      <p className="mt-6 text-xs text-muted-foreground">The checks follow fixed rules on the hospital's own data. {ASSISTANT_NAME} is not a medical device. Confidential charts stay closed unless you broke the glass.</p>
    </div>
  );
}
