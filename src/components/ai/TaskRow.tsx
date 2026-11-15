import { Check, ChevronRight, X } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { BRAND_BTN, BrandBadge, GLASS_BTN, ICON_BTN } from "@/components/ai/chat-parts";
import { cn } from "@/components/ui/primitives";
import { approveTask, dismissTask, isShortcut, type Task } from "@/lib/ai/agent-work";
import { AGENT_BY_ID } from "@/lib/ai/agents";

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * One task an agent raised: agent icon, patient and urgency, what to do, and one action on the right.
 * A step that changes a record shows Approve; a step that only opens a page shows the page name.
 * The reason shows on the full row only; the compact row (dashboard) keeps to one line of text.
 */
export function TaskRow({ task: t, compact }: { task: Task; compact?: boolean }) {
  const opens = isShortcut(t.action);
  return (
    <li className={cn("group flex flex-wrap items-center gap-x-3 gap-y-2 transition-colors", compact ? "py-3" : "px-5 py-3.5 hover:bg-white/50 dark:hover:bg-white/[0.03]")}>
      <AgentIcon agent={t.agent} size={compact ? "sm" : "md"} className="self-start" />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-[#032C26] dark:text-foreground">{t.patient}</span>
          {t.level === "high" ? <BrandBadge tone="urgent">Urgent</BrandBadge> : <BrandBadge tone="ink">Soon</BrandBadge>}
          {!compact && <span className="text-xs text-muted-foreground">{timeOf(t.foundAt)}</span>}
        </div>
        <p className={cn("mt-0.5 text-sm", compact && "truncate")} title={compact ? t.text : undefined}>{t.text}</p>
        {!compact && <p className="mt-0.5 text-xs text-muted-foreground" title={AGENT_BY_ID[t.agent].name}>{t.why}</p>}
      </div>
      {t.status === "waiting" && t.action && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className={cn(opens ? GLASS_BTN : BRAND_BTN, "h-8 px-3 text-[0.8125rem]")} onClick={() => approveTask(t.id)}>
            {opens ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            {opens ? t.action.label : `Approve: ${t.action.label}`}
          </button>
          {!compact && (
            <button type="button" className={cn(ICON_BTN, "opacity-60 group-hover:opacity-100 focus-visible:opacity-100")} onClick={() => dismissTask(t.id)} aria-label={`Dismiss the task for ${t.patient}`} title="Dismiss">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {t.status === "done-user" && <BrandBadge>Approved</BrandBadge>}
      {t.status === "done-agent" && <BrandBadge>Done By The Agent</BrandBadge>}
      {t.status === "resolved" && <BrandBadge>Fixed</BrandBadge>}
      {t.status === "dismissed" && <BrandBadge tone="ink">Dismissed</BrandBadge>}
      {t.status === "failed" && <BrandBadge tone="urgent">Did Not Go Through</BrandBadge>}
    </li>
  );
}
