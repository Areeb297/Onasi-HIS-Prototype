import * as React from "react";
import {
  IconArrowBackUp, IconArrowsExchange, IconBed, IconCircleX, IconEdit, IconFolderOpen, IconLogout, IconUserCheck, IconWalk,
} from "@tabler/icons-react";
import { ChevronDown } from "lucide-react";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDevMode } from "@/lib/devmode";
import { can, useSession } from "@/lib/session";
import type { Encounter } from "@/lib/model";
import type { EventId } from "@/lib/spec";

export type ActionKey = EventId | "CHECKIN" | "CHART";

export interface ActionDef {
  key: ActionKey;
  label: string;
  icon: React.ReactNode;
  /** Shows a dot, for example when the EMR has changes that are not sent yet. */
  dot?: boolean;
}

const ic = (Icon: typeof IconBed, color: string) => <Icon className={cn("size-[18px]", color)} stroke={1.75} />;

/** Which buttons a visit gets. Only the events that make sense for its state are shown. */
export function actionsFor(enc: Encounter): ActionDef[] {
  const out: ActionDef[] = [{ key: "CHART", label: "Open Chart", icon: ic(IconFolderOpen, "text-move") }];
  const inpatient = enc.cls === "I";
  if (enc.status === "active") {
    if (!inpatient && !enc.checkedIn) out.push({ key: "CHECKIN", label: "Check In", icon: ic(IconUserCheck, "text-admit") });
    if (inpatient) out.push({ key: "A02", label: "Transfer", icon: ic(IconArrowsExchange, "text-admit") });
    if (inpatient && enc.transfers.length) out.push({ key: "A12", label: "Cancel Transfer", icon: ic(IconArrowBackUp, "text-merge") });
    if (!inpatient) out.push({ key: "A06", label: "Admit To Inpatient", icon: ic(IconBed, "text-ok") });
    if (inpatient) out.push({ key: "A07", label: "Change To Outpatient", icon: ic(IconWalk, "text-move") });
    out.push({ key: "A08", label: "Send Update", icon: ic(IconEdit, "text-update"), dot: enc.dirty });
    out.push({ key: "A03", label: "Discharge", icon: ic(IconLogout, "text-cancel") });
    out.push({ key: "A11", label: inpatient ? "Cancel Admission" : "Cancel Visit", icon: ic(IconCircleX, "text-cancel") });
  }
  if (enc.status === "discharged") {
    out.push({ key: "A08", label: "Send Update", icon: ic(IconEdit, "text-update"), dot: enc.dirty });
    out.push({ key: "A13", label: "Undo Discharge", icon: ic(IconArrowBackUp, "text-update") });
  }
  if (enc.status === "preadmit") {
    out.push({ key: "A01", label: "Admit", icon: ic(IconBed, "text-ok") });
    out.push({ key: "A38", label: "Cancel Pre-Admit", icon: ic(IconCircleX, "text-cancel") });
  }
  return out;
}

/** The one step most likely to come next. It gets the colored button. Everything else goes in the More menu. */
function suggested(enc: Encounter, list: ActionDef[]): ActionDef | undefined {
  const has = (k: ActionKey) => list.find((a) => a.key === k);
  if (enc.dirty) return has("A08");
  if (enc.status === "preadmit") return has("A01");
  if (enc.status === "active") {
    if (enc.cls === "I") return has("A02");
    if (!enc.checkedIn && enc.cls !== "E") return has("CHECKIN");
    return has("A03");
  }
  return undefined;
}

const DANGER: ActionKey[] = ["A11", "A38"];

export function RowActions({ enc, onAct }: { enc: Encounter; onAct: (k: ActionKey) => void }) {
  const dev = useDevMode();
  useSession();
  const allowed = can("adt.send");
  const all = actionsFor(enc).filter((a) => allowed || a.key === "CHART");
  const chart = all.find((a) => a.key === "CHART");
  const rest = all.filter((a) => a.key !== "CHART");
  const next = suggested(enc, rest);
  const more = rest.filter((a) => a !== next);
  const code = (a: ActionDef) => (dev && a.key !== "CHART" && a.key !== "CHECKIN" ? ` (${a.key})` : "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chart && <Button size="sm" onClick={() => onAct("CHART")}>Open Chart</Button>}
      {next && (
        <Button size="sm" variant="primary" onClick={() => onAct(next.key)} title={`${next.label}${code(next)}`}>
          <span className="flex [&_svg]:!text-current">{next.icon}</span>
          {next.label}
          {next.dot && <span className="size-2 rounded-full bg-warn ring-2 ring-primary" aria-label="Unsent changes" />}
        </Button>
      )}
      {more.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" aria-label={`More actions for ${enc.visitNumber}`}>
              More <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {more.map((a, i) => (
              <React.Fragment key={`${a.key}-${a.label}`}>
                {i > 0 && DANGER.includes(a.key) && !DANGER.includes(more[i - 1].key) && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => onAct(a.key)} className={cn("gap-3 py-2 text-sm", DANGER.includes(a.key) && "text-destructive focus:text-destructive")}>
                  {a.icon}
                  <span className="flex-1">{a.label}{code(a)}</span>
                  {a.dot && <Badge tone="warn">Unsent</Badge>}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** Legend for Developer View: which button sends which ADT event. */
export function ActionLegend() {
  const dev = useDevMode();
  if (!dev) return null;
  const items: [string, React.ReactNode, string][] = [
    ["Check In", ic(IconUserCheck, "text-admit"), "No message"],
    ["Admit To Inpatient", ic(IconBed, "text-ok"), "A06 (A01 from pre-admit)"],
    ["Transfer", ic(IconArrowsExchange, "text-admit"), "A02"],
    ["Cancel Transfer", ic(IconArrowBackUp, "text-merge"), "A12"],
    ["Change To Outpatient", ic(IconWalk, "text-move"), "A07"],
    ["Send Update", ic(IconEdit, "text-update"), "A08"],
    ["Discharge", ic(IconLogout, "text-cancel"), "A03"],
    ["Undo Discharge", ic(IconArrowBackUp, "text-update"), "A13"],
    ["Cancel Visit or Admission", ic(IconCircleX, "text-cancel"), "A11"],
    ["Cancel Pre-Admit", ic(IconCircleX, "text-cancel"), "A38"],
  ];
  return (
    <div className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Which button sends which message</div>
      <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, icon, code]) => (
          <li key={label} className="flex items-center gap-2 text-xs">
            {icon}
            <span className="flex-1">{label}</span>
            <Badge tone={code === "No message" ? "neutral" : "update"} className="font-mono">{code}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
