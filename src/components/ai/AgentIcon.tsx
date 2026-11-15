import { IconAmbulance, IconClipboardText, IconDoorExit, IconSend, IconShieldCheck, IconUrgent, type Icon } from "@tabler/icons-react";
import { cn } from "@/components/ui/primitives";
import type { AgentId } from "@/lib/ai/agents";

/** One icon per agent, in Onasi brand tints only (red is kept for the critical results agent). */
const LOOK: Record<AgentId, { icon: Icon; tint: string }> = {
  critical: { icon: IconUrgent, tint: "bg-destructive/10 text-destructive" },
  discharge: { icon: IconDoorExit, tint: "bg-[#39EDD5]/15 text-[#035D53] dark:text-[#52FCE3]" },
  "ed-flow": { icon: IconAmbulance, tint: "bg-[#032C26]/[0.07] text-[#032C26] dark:bg-white/10 dark:text-foreground" },
  clearance: { icon: IconSend, tint: "glass-icon" },
  "claim-guard": { icon: IconShieldCheck, tint: "bg-[#39EDD5]/15 text-[#035D53] dark:text-[#52FCE3]" },
  handoff: { icon: IconClipboardText, tint: "bg-[#032C26]/[0.07] text-[#032C26] dark:bg-white/10 dark:text-foreground" },
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
