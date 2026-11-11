import type { EncounterStatus, PatientClass } from "@/lib/model";
import { EVENT_BY_ID, eventLabel, type EventGroup, type EventId } from "@/lib/spec";
import { Badge } from "./ui/primitives";

export function StatusBadge({ status }: { status: EncounterStatus }) {
  const map = {
    active: { tone: "ok", label: "Active" },
    preadmit: { tone: "info", label: "Pre-Admit" },
    discharged: { tone: "neutral", label: "Discharged" },
    cancelled: { tone: "danger", label: "Cancelled" },
  } as const;
  const m = map[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function ClassBadge({ cls }: { cls: PatientClass }) {
  const label = { I: "Inpatient", O: "Outpatient", E: "Emergency", P: "Pre-Admit" }[cls];
  const tone = { I: "admit", O: "move", E: "cancel", P: "merge" }[cls] as "admit" | "move" | "cancel" | "merge";
  return <Badge tone={tone}>{label}</Badge>;
}

export function ReqChip({ req }: { req: "R" | "O" | "-" | "I" | "Z" }) {
  const map = {
    R: { tone: "primary", label: "R" },
    O: { tone: "neutral", label: "O" },
    "-": { tone: "danger", label: "-" },
    I: { tone: "warn", label: "I" },
    Z: { tone: "info", label: "Z" },
  } as const;
  const m = map[req];
  return <Badge tone={m.tone} className="min-w-6 justify-center font-mono">{m.label}</Badge>;
}

export const GROUP_TONE: Record<EventGroup, "admit" | "move" | "update" | "cancel" | "merge"> = {
  "Admit and Visit": "admit",
  "Move and End": "move",
  Updates: "update",
  Cancels: "cancel",
  "Merge and Move": "merge",
};

/** Event code badge, colored by event group. */
export function EventBadge({ id, className }: { id: EventId; className?: string }) {
  return (
    <Badge tone={GROUP_TONE[EVENT_BY_ID[id].group]} className={`font-mono ${className ?? ""}`}>
      {eventLabel(id)}
    </Badge>
  );
}
