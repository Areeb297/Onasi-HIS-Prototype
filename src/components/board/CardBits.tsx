import * as React from "react";
import { IconBroadcast } from "@tabler/icons-react";
import { Flag } from "lucide-react";
import { TONE } from "./tone";
import type { BoardTone } from "./types";
import { Badge, Button } from "@/components/ui/primitives";
import { ageSex } from "./board-util";
import type { Patient } from "@/lib/model";
import { hasGlass } from "@/lib/session";
import { patientName } from "@/lib/store";

/** Patient name (opens the order), age and sex. Confidential patients are masked until break the glass. */
export function PatientLine({ patient, onOpen, dev, extra, now }: { patient?: Patient; onOpen?: () => void; dev: boolean; extra?: string; now?: number }) {
  const masked = !!patient?.confidential && !hasGlass(patient.id);
  const name = masked ? "Confidential patient" : patientName(patient);
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold text-move hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {name}
        </button>
      ) : (
        <div className="truncate text-sm font-semibold">{name}</div>
      )}
      <div className="truncate text-xs text-muted-foreground">
        {patient && !masked ? ageSex(patient, now) : "Details hidden"}
        {dev && extra && <span className="ml-1.5 font-mono">{extra}</span>}
      </div>
    </div>
  );
}

/** Small NPHIES status pill. */
export function NphiesChip({ label, tone }: { label: string; tone: "neutral" | "ok" | "warn" | "danger" }) {
  return (
    <Badge tone={tone} className="gap-1">
      <IconBroadcast className="size-3" stroke={1.75} aria-hidden="true" />
      {label}
    </Badge>
  );
}

/** The main button on a card. A role without permission sees it disabled with a tooltip that says why. */
export function CardAction({
  label, onClick, allowed, reason, variant = "primary", icon,
}: {
  label: string;
  onClick: () => void;
  allowed: boolean;
  reason: string;
  variant?: "primary" | "secondary";
  icon?: React.ReactNode;
}) {
  return (
    <span className="inline-flex" title={allowed ? undefined : reason}>
      <Button size="sm" variant={variant} disabled={!allowed} onClick={onClick} className="h-8 px-2.5 text-xs">
        {icon}
        {label}
      </Button>
    </span>
  );
}

/**
 * A small tag with an icon, like the priority and category tags on the 21st.dev kanban cards.
 * The label always says the thing in words, so colour is never the only signal.
 */
export function Tag({ tone = "muted", icon, children, title }: { tone?: BoardTone; icon?: React.ReactNode; children: React.ReactNode; title?: string }) {
  const t = TONE[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium leading-5 whitespace-nowrap ${t.soft} ${t.text}`}>
      {icon}
      {children}
    </span>
  );
}

/** Priority tag: a flag and the word. */
export function PriorityTag({ tone, label }: { tone: BoardTone; label: string }) {
  return <Tag tone={tone} icon={<Flag className="size-3" aria-hidden="true" />}>{label}</Tag>;
}

/** What the order is, in plain words, under the patient name. */
export function CardSubject({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[0.8125rem] leading-snug text-foreground/80">{children}</p>;
}

/** Divider and footer row: status on the left, the one action on the right. */
export function CardFoot({ children }: { children: React.ReactNode }) {
  return <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-t border-border/70 pt-2.5">{children}</div>;
}

/** A small ring and a number, for "2 of 4 results" style progress. */
export function ProgressRing({ done, total, label }: { done: number; total: number; label: string }) {
  const R = 7;
  const C = 2 * Math.PI * R;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" role="img" aria-label={`${label}: ${done} of ${total}`}>
      <svg viewBox="0 0 18 18" className="size-4 -rotate-90" aria-hidden="true">
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2" className="stroke-border" />
        <circle cx="9" cy="9" r={R} fill="none" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${ratio * C} ${C}`} className="stroke-admit" />
      </svg>
      <span className="tabular-nums">{done} of {total} {label}</span>
    </span>
  );
}
