import { IconMessageChatbot } from "@tabler/icons-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { TaskRow, timeOf } from "@/components/ai/TaskRow";
import { Button, Card } from "@/components/ui/primitives";
import { isPaused, progressOf, useAgentWork, waitingTasks } from "@/lib/ai/agent-work";
import { AGENTS } from "@/lib/ai/agents";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { navigate } from "@/lib/router";

/** The agents' work at a glance, for the dashboard: what they finished today and the most urgent tasks waiting for a person. */
export function AgentWorkCard() {
  const work = useAgentWork();
  const waiting = waitingTasks(work);
  const all = progressOf(undefined, new Date(), work);
  const watching = AGENTS.filter((a) => !isPaused(a.id, work)).length;
  const lastAt = Object.values(work.last).map((l) => l!.at).sort().pop();
  const pct = all.total ? Math.round((all.done / all.total) * 100) : 0;

  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-deep)] text-[var(--brand-mint)]"><OnasiAiMark size={24} /></span>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-base font-semibold">{ASSISTANT_NAME} At Work</h2>
          <p className="text-[0.8125rem] text-muted-foreground">
            {watching} of {AGENTS.length} agents watching{lastAt ? `, last check ${timeOf(lastAt)}` : ""}. {all.doneByAgent} {all.doneByAgent === 1 ? "step" : "steps"} finished by agents today, {all.doneByStaff} by staff.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button onClick={() => navigate("/agents", { tab: "ask" })}><IconMessageChatbot className="size-4" aria-hidden="true" />Ask {ASSISTANT_NAME}</Button>
          <Button variant="primary" onClick={() => navigate("/agents")}>{waiting.length ? `Review ${waiting.length} ${waiting.length === 1 ? "Task" : "Tasks"}` : "Open Agents"}</Button>
        </div>
      </div>
      <div className="px-5 pb-1">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Agent tasks done today">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">{all.total ? `${all.done} of ${all.total} tasks done today, ${all.waiting} waiting for a person.` : "No tasks raised today."}</p>
      </div>
      {waiting.length > 0 && <ul className="mt-2 divide-y divide-border border-t border-border px-5">{waiting.slice(0, 3).map((t) => <TaskRow key={t.id} task={t} compact />)}</ul>}
      {waiting.length === 0 && <div className="pb-3" />}
    </Card>
  );
}
