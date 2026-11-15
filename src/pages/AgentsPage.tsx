import * as React from "react";
import { IconChecks, IconCopy, IconEye, IconHourglassHigh, IconMessageChatbot, IconPlayerPause, IconPlayerPlay, IconRefresh, IconRobot } from "@tabler/icons-react";
import { Check, ChevronDown } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { GLASS_BTN, ICON_BTN, MarkTile } from "@/components/ai/chat-parts";
import { TaskRow, timeOf } from "@/components/ai/TaskRow";
import { GlassBackdrop, GlassCard, GlassPillSwitch, GlassStagger, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Card, Empty, cn } from "@/components/ui/primitives";
import { checkNow, isPaused, myDoctorId, progressOf, setPaused, tasksOfDoctor, useAgentWork, waitingTasks, type FeedItem } from "@/lib/ai/agent-work";
import { AGENTS, AGENT_BY_ID, runAgent, type AgentDef } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { openAssistant } from "@/lib/ai/launcher";
import { useRoute } from "@/lib/router";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * Onasi AI Agents: the agents for the ward doctor. They read the record and point at what needs the doctor; they change
 * nothing in the record. Progress on top, one card per agent, then the tasks waiting for a person and today's activity.
 */

const FEED_WORD: Record<FeedItem["kind"], string> = { found: "Found", done: "Done", dismissed: "Dismissed", failed: "Failed", resolved: "Closed", setting: "Setting" };
const HAIR = "border-[rgba(20,32,28,0.07)] dark:border-white/5";

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
    pushToast({ tone: "ok", text: "Handoff sheet copied." });
  }

  return (
    <GlassCard as="article" className="flex flex-col" aria-label={def.name}>
      <div className="flex items-start gap-3 px-5 pt-5">
        <AgentIcon agent={def.id} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[0.9375rem] font-semibold leading-tight text-[#032C26] dark:text-foreground">{def.name}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cn("size-1.5 rounded-full", paused ? "bg-muted-foreground/50" : "bg-[#0CE69F]")} aria-hidden="true" />
            <span className={paused ? "text-muted-foreground" : "font-medium text-[#032C26] dark:text-foreground"}>{paused ? "Paused" : "Watching"}</span>
            {!paused && last && <span className="text-muted-foreground">{timeOf(last.at)}</span>}
          </p>
        </div>
        <button type="button" className={ICON_BTN} onClick={() => setPaused(def.id, !paused)} aria-label={paused ? `Resume ${def.name}` : `Pause ${def.name}`} title={paused ? "Resume" : "Pause"}>
          {paused ? <IconPlayerPlay className="size-4" aria-hidden="true" /> : <IconPlayerPause className="size-4" aria-hidden="true" />}
        </button>
      </div>

      <p className="px-5 pt-3 text-[0.8125rem] leading-snug text-muted-foreground">{def.job}</p>

      <div className="mt-auto px-5 pb-4 pt-4">
        {isSheet ? (
          <button type="button" className={cn(GLASS_BTN, "h-9 px-3 text-sm")} onClick={copySheet} disabled={paused}><IconCopy className="size-4" aria-hidden="true" />Copy Handoff Sheet</button>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="tabular-nums text-muted-foreground">{prog.total ? `${prog.done} of ${prog.total} done today` : "No tasks today"}</span>
              {prog.waiting > 0 && <span className="font-semibold text-[#032C26] dark:text-foreground">{prog.waiting} waiting</span>}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#032C26]/[0.07] dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${def.name}: tasks done today`}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#03C1AC,#39EDD5)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
            </div>
          </>
        )}
      </div>

      <details className={cn("group border-t", HAIR)}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-2.5 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          What It Checks
          <ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="space-y-2 px-5 pb-4 text-[0.8125rem]">
          <p className="text-muted-foreground">{def.watches}. {def.autoText ?? "It changes nothing in the record."}</p>
          {last && (
            <ol className="space-y-1">
              {last.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-[#03C1AC]" aria-hidden="true" /><span>{s.did} <span className="text-muted-foreground">{s.found}</span></span></li>
              ))}
            </ol>
          )}
          <button type="button" onClick={onAsk} className="inline-flex items-center gap-1.5 text-left font-medium text-[#035D53] hover:underline dark:text-[#52FCE3]"><IconMessageChatbot className="size-4 shrink-0" aria-hidden="true" />{def.ask}</button>
        </div>
      </details>
    </GlassCard>
  );
}

const WHOSE = ["My Patients", "All Patients"] as const;

function WorkBoard({ onAsk }: { onAsk: (q: string) => void }) {
  const work = useAgentWork();
  useHis();
  const me = myDoctorId();
  const [whose, setWhose] = React.useState<(typeof WHOSE)[number]>("My Patients");
  const [checking, setChecking] = React.useState(false);
  const [showAll, setShowAll] = React.useState(false);
  const now = new Date();
  const everyone = waitingTasks(work);
  const own = me ? tasksOfDoctor(everyone, me) : everyone;
  const mine = !!me && whose === "My Patients";
  const listed = mine ? own : everyone;
  const all = progressOf(undefined, now, work);
  const watching = AGENTS.filter((a) => !isPaused(a.id, work)).length;
  const lastAt = Object.values(work.last).map((l) => l!.at).sort().pop();
  const today = work.feed.filter((f) => new Date(f.at).toDateString() === now.toDateString());
  const SHOWN = 6;

  function check() {
    setChecking(true);
    checkNow();
    window.setTimeout(() => setChecking(false), 700);
  }

  return (
    <div className="space-y-5">
      <KpiStrip label="Agent progress today" className="grid-cols-2 lg:grid-cols-4">
        <KpiTile icon={<IconChecks stroke={1.75} />} label="Done Today" value={all.total ? `${all.done} of ${all.total}` : "0"} note={all.total ? `${Math.round((all.done / all.total) * 100)}% of today's tasks` : "No tasks yet"} />
        <KpiTile icon={<IconHourglassHigh stroke={1.75} />} label="Waiting For You" value={String(all.waiting)} note={all.waiting ? "Needs a person" : "All clear"} />
        <KpiTile icon={<IconRobot stroke={1.75} />} label="Done By Agents" value={String(all.doneByAgent)} note={`${all.doneByStaff} by staff`} />
        <KpiTile icon={<IconEye stroke={1.75} />} label="Agents Watching" value={`${watching} of ${AGENTS.length}`} note={lastAt ? `Last check ${timeOf(lastAt)}` : "Starting"} />
      </KpiStrip>

      <GlassStagger className="grid gap-4 md:grid-cols-3" label="Agents">
        {AGENTS.map((a) => <AgentCard key={a.id} def={a} onAsk={() => onAsk(a.ask)} />)}
      </GlassStagger>

      <GlassCard solid lift={false} aria-labelledby="needs-you">
        <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-5 py-4", HAIR)}>
          <h2 id="needs-you" className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap text-base font-semibold text-[#032C26] dark:text-foreground">
            Needs Your Attention <span className="rounded-full bg-[#39EDD5]/15 px-2 py-0.5 text-xs font-medium tabular-nums text-[#035D53] dark:text-[#52FCE3]">{listed.length}</span>
          </h2>
          {me && <GlassPillSwitch size="sm" label="Whose patients" value={whose} options={WHOSE} onChange={setWhose} />}
          <button type="button" className={cn(GLASS_BTN, "h-8 px-3 text-[0.8125rem]")} onClick={check} disabled={checking}>
            <IconRefresh className={cn("size-4", checking && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />{checking ? "Checking" : "Check Now"}
          </button>
        </div>
        {listed.length ? (
          <>
            <ul className="divide-y divide-[rgba(20,32,28,0.07)] dark:divide-white/5">{(showAll ? listed : listed.slice(0, SHOWN)).map((t) => <TaskRow key={t.id} task={t} />)}</ul>
            {listed.length > SHOWN && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className={cn("w-full border-t px-5 py-3 text-left text-[0.8125rem] font-medium text-[#035D53] hover:bg-white/50 dark:text-[#52FCE3] dark:hover:bg-white/5", HAIR)}>
                {showAll ? "Show Fewer" : `Show All ${listed.length}`}
              </button>
            )}
          </>
        ) : (
          <Empty>{mine && everyone.length ? "Nothing waiting for your patients." : "Nothing needs attention now."}</Empty>
        )}
      </GlassCard>

      <details className="glass-panel group overflow-hidden rounded-2xl">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 [&::-webkit-details-marker]:hidden">
          <span className="text-base font-semibold text-[#032C26] dark:text-foreground">Activity Today <span className="ms-1 text-sm font-normal tabular-nums text-muted-foreground">{today.length}</span></span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        {today.length ? (
          <ol className={cn("divide-y divide-[rgba(20,32,28,0.07)] border-t dark:divide-white/5", HAIR)}>
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
          <div className={cn("border-t", HAIR)}><Empty>No activity yet today.</Empty></div>
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
    <GlassBackdrop>
      <header className="mb-5 flex items-center gap-3.5">
        <MarkTile size="lg" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[#032C26] dark:text-foreground">{ASSISTANT_NAME} Agents</h1>
          <p className="text-sm text-muted-foreground">They point at what needs you. They change nothing in the record.</p>
        </div>
      </header>

      <WorkBoard onAsk={(question) => openAssistant(question)} />

      <p className="mt-6 text-xs text-muted-foreground">Fixed rules on the hospital's own data. Not a medical device.</p>
    </GlassBackdrop>
  );
}
