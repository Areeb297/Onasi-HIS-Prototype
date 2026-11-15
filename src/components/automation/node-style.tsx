import { IconArrowsSplit2, IconBolt, IconFlag3, IconHelpHexagon, IconHourglass, IconSend, IconUserCheck, type Icon } from "@tabler/icons-react";
import type { NodeKind, StepStatus } from "@/lib/automations";

/**
 * How each kind of step looks: an outlined icon and a coloured left edge. The colours come from the Onasi palette
 * (dark green, cyan, mint and the neutral greens). Wait stays amber because it is a warning status, so the seven kinds stay apart side by side.
 * Colour is never the only cue: each kind has its own icon and its name on the node.
 */
export const KIND_STYLE: Record<NodeKind, { edge: string; ink: string; tint: string; Icon: Icon }> = {
  trigger: { edge: "#032C26", ink: "#032C26", tint: "rgba(3,44,38,0.07)", Icon: IconBolt },
  condition: { edge: "#00A671", ink: "#016D48", tint: "rgba(0,166,113,0.08)", Icon: IconHelpHexagon },
  action: { edge: "#03C1AC", ink: "#035D53", tint: "rgba(57,237,213,0.14)", Icon: IconSend },
  // Standard warning amber, kept on purpose: a wait is a status the user must notice.
  wait: { edge: "#C98A12", ink: "#84540B", tint: "rgba(201,138,18,0.10)", Icon: IconHourglass },
  approval: { edge: "#4A554E", ink: "#4A554E", tint: "rgba(74,85,78,0.08)", Icon: IconUserCheck },
  branch: { edge: "#035D53", ink: "#035D53", tint: "rgba(3,93,83,0.08)", Icon: IconArrowsSplit2 },
  end: { edge: "#819689", ink: "#546259", tint: "rgba(84,98,89,0.08)", Icon: IconFlag3 },
};

export function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const { Icon, ink, tint } = KIND_STYLE[kind];
  return (
    <span aria-hidden="true" className={className ?? "flex size-8 shrink-0 items-center justify-center rounded-lg"} style={{ color: ink, background: tint }}>
      <Icon className="size-[1.05rem]" stroke={1.75} />
    </span>
  );
}

/** Run step colours, for the run log and the lit nodes. */
export const STEP_TONE: Record<StepStatus, { label: string; cls: string }> = {
  done: { label: "Done", cls: "bg-[#39EDD5]/20 text-[#035D53]" },
  yes: { label: "Yes", cls: "bg-[#00A671]/10 text-[#016D48]" },
  no: { label: "No", cls: "bg-muted text-muted-foreground" },
  waiting: { label: "Waiting", cls: "bg-warn/16 text-warn" },
  approval: { label: "Needs Approval", cls: "bg-[#4A554E]/10 text-[#4A554E]" },
  approved: { label: "Approved", cls: "bg-ok/14 text-ok" },
  declined: { label: "Declined", cls: "bg-destructive/12 text-destructive" },
  blocked: { label: "Blocked", cls: "bg-destructive/12 text-destructive" },
  failed: { label: "Failed", cls: "bg-destructive/12 text-destructive" },
  simulated: { label: "Test Only", cls: "bg-[#39EDD5]/20 text-[#035D53]" },
  end: { label: "End", cls: "bg-muted text-muted-foreground" },
};
