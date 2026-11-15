import { ChevronRight } from "lucide-react";
import { BRAND_BTN } from "@/components/ai/chat-parts";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { TaskRow, timeOf } from "@/components/ai/TaskRow";
import { cn } from "@/components/ui/primitives";
import { isPaused, progressOf, useAgentWork, waitingTasks } from "@/lib/ai/agent-work";
import { AGENTS } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { navigate } from "@/lib/router";

/** A cell in the progress row: a label, the number, and an optional bar. */
function Stat({ label, value, pct }: { label: string; value: string; pct?: number }) {
  return (
    <div className="glass-row min-w-0 rounded-xl px-3.5 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={"mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-[#032C26] dark:text-foreground"}>{value}</dd>
      {pct !== undefined && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#032C26]/[0.07] dark:bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${label}: ${pct}%`}>
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#03C1AC,#39EDD5)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

/** The agents' work at a glance, for the dashboard: progress today and the most urgent tasks waiting for a person. */
export function AgentWorkCard() {
  const work = useAgentWork();
  const waiting = waitingTasks(work);
  const all = progressOf(undefined, new Date(), work);
  const watching = AGENTS.filter((a) => !isPaused(a.id, work)).length;
  const lastAt = Object.values(work.last).map((l) => l!.at).sort().pop();
  const pct = all.total ? Math.round((all.done / all.total) * 100) : 0;

  return (
    <section className="glass-panel glass-hover mt-4 overflow-hidden rounded-2xl" aria-labelledby="ai-at-work">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 pb-3 pt-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#032C26]"><OnasiAiMark size={24} /></span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="ai-at-work" className="text-base font-semibold text-[#032C26] dark:text-foreground">{ASSISTANT_NAME} At Work</h2>
          <p className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
            <span className={cn("size-1.5 rounded-full", watching ? "bg-[#0CE69F]" : "bg-muted-foreground/50")} aria-hidden="true" />
            {watching} of {AGENTS.length} agents watching{lastAt ? `, last check ${timeOf(lastAt)}` : ""}
          </p>
        </div>
        <button type="button" className={cn(BRAND_BTN, "h-9 px-3.5 text-sm")} onClick={() => navigate("/agents")}>
          {waiting.length ? `Review ${waiting.length} ${waiting.length === 1 ? "Task" : "Tasks"}` : "Open Agents"}
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <dl className="grid grid-cols-3 gap-2 px-5 pb-4">
        <Stat label="Done Today" value={all.total ? `${all.done}/${all.total}` : "0"} pct={pct} />
        <Stat label="Waiting" value={String(all.waiting)} />
        <Stat label="By Agents" value={String(all.doneByAgent)} />
      </dl>
      {waiting.length > 0 && (
        <ul className="divide-y divide-[rgba(20,32,28,0.07)] border-t border-[rgba(20,32,28,0.07)] px-5 dark:divide-white/5 dark:border-white/5">
          {waiting.slice(0, 3).map((t) => <TaskRow key={t.id} task={t} compact />)}
        </ul>
      )}
    </section>
  );
}
