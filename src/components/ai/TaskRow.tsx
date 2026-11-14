import { Check, ChevronRight, X } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { approveTask, dismissTask, isShortcut, type Task } from "@/lib/ai/agent-work";
import { AGENT_BY_ID } from "@/lib/ai/agents";

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** One task an agent raised. A step that changes a record shows Approve. A step that only opens a page shows the page name. */
export function TaskRow({ task: t, compact }: { task: Task; compact?: boolean }) {
  const opens = isShortcut(t.action);
  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2", compact ? "py-2.5" : "px-5 py-3.5")}>
      <AgentIcon agent={t.agent} size={compact ? "sm" : "md"} className="mt-0.5" />
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{t.patient}</span>
          {t.level === "high" ? <Badge tone="danger">Urgent</Badge> : <Badge tone="warn">Soon</Badge>}
          {!compact && <span className="text-xs text-muted-foreground">{AGENT_BY_ID[t.agent].name}, found {timeOf(t.foundAt)}</span>}
        </div>
        <p className="mt-0.5 text-sm">{t.text}</p>
        {!compact && <p className="mt-0.5 text-xs text-muted-foreground">Why: {t.why}</p>}
      </div>
      {t.status === "waiting" && t.action && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant={opens ? "secondary" : "primary"} onClick={() => approveTask(t.id)}>
            {opens ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            {opens ? t.action.label : `Approve: ${t.action.label}`}
          </Button>
          {!compact && (
            <Button size="sm" variant="ghost" onClick={() => dismissTask(t.id)} aria-label={`Dismiss the task for ${t.patient}`}>
              <X className="size-3.5" aria-hidden="true" /> Dismiss
            </Button>
          )}
        </div>
      )}
      {t.status === "done-user" && <Badge tone="ok">Approved</Badge>}
      {t.status === "done-agent" && <Badge tone="ok">Done By The Agent</Badge>}
      {t.status === "resolved" && <Badge tone="ok">Fixed</Badge>}
      {t.status === "dismissed" && <Badge tone="neutral">Dismissed</Badge>}
      {t.status === "failed" && <Badge tone="danger">Did Not Go Through</Badge>}
    </li>
  );
}
