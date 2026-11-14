import { IconAmbulance, IconClipboardText, IconDoorExit, IconSend, IconShieldCheck, IconUrgent, type Icon } from "@tabler/icons-react";
import { cn } from "@/components/ui/primitives";
import type { AgentId } from "@/lib/ai/agents";

/** One icon and one colour per agent, so a task or a log line shows at a glance which agent it came from. */
const LOOK: Record<AgentId, { icon: Icon; tint: string }> = {
  critical: { icon: IconUrgent, tint: "bg-destructive/10 text-destructive" },
  discharge: { icon: IconDoorExit, tint: "bg-admit/10 text-admit" },
  "ed-flow": { icon: IconAmbulance, tint: "bg-warn/10 text-warn" },
  clearance: { icon: IconSend, tint: "bg-move/10 text-move" },
  "claim-guard": { icon: IconShieldCheck, tint: "bg-update/10 text-update" },
  handoff: { icon: IconClipboardText, tint: "bg-muted text-foreground" },
};

export function AgentIcon({ agent, size = "md", className }: { agent: AgentId; size?: "sm" | "md" | "lg"; className?: string }) {
  const L = LOOK[agent];
  const box = size === "lg" ? "size-11 rounded-xl" : size === "sm" ? "size-6 rounded-md" : "size-9 rounded-lg";
  const glyph = size === "lg" ? "size-6" : size === "sm" ? "size-3.5" : "size-5";
  return (
    <span className={cn("flex shrink-0 items-center justify-center", box, L.tint, className)} aria-hidden="true">
      <L.icon className={glyph} stroke={1.75} />
    </span>
  );
}
