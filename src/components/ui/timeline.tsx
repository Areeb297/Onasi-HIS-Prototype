"use client";

/**
 * Timeline adapted from 21st.dev (@kuratlielia/timeline): a vertical activity feed grouped by day
 * with expandable rows and a connector line that draws itself. The motion tokens and CSS module
 * of the original were not part of the download, so the styling here uses Tailwind.
 */

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "./primitives";

export interface TimelineEvent {
  id: string;
  at: string | number;
  actor?: string;
  title: string;
  meta?: string;
  detail?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "neutral" | "success" | "danger" | "warn";
}

export interface TimelineProps {
  events: TimelineEvent[];
  label: string;
  maxHeight?: number | string;
  className?: string;
}

const toneRing: Record<NonNullable<TimelineEvent["tone"]>, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-ok/40 bg-ok/12 text-ok",
  danger: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-warn/40 bg-warn/12 text-warn",
};

function dayLabel(t: number): string {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function clock(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function Row({
  ev,
  last,
  expanded,
  onToggle,
}: {
  ev: TimelineEvent & { time: number };
  last: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const reduced = useReducedMotion();
  const tone = ev.tone ?? "neutral";
  const Trigger = ev.detail ? "button" : "div";
  return (
    <li className="relative pl-10">
      <motion.span
        aria-hidden="true"
        initial={reduced ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 22 }}
        className={cn("absolute left-0 top-0.5 flex size-7 items-center justify-center rounded-full border text-xs font-semibold", toneRing[tone])}
      >
        {ev.icon}
      </motion.span>
      {!last && (
        <motion.span
          aria-hidden="true"
          initial={reduced ? false : { scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          style={{ transformOrigin: "top" }}
          className="absolute bottom-0 left-[13.5px] top-8 w-px bg-border"
        />
      )}
      <Trigger
        {...(ev.detail ? { type: "button" as const, onClick: onToggle, "aria-expanded": expanded } : {})}
        className={cn(
          "flex w-full items-start justify-between gap-3 pb-4 text-left",
          ev.detail && "cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="min-w-0">
          <span className="block text-sm">
            {ev.actor && <span className="font-semibold">{ev.actor} </span>}
            {ev.title}
          </span>
          {ev.meta && <span className="mt-0.5 block text-xs text-muted-foreground">{ev.meta}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <time dateTime={new Date(ev.time).toISOString()}>{clock(ev.time)}</time>
          {ev.detail && (
            <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: reduced ? 0 : 0.2 }}>
              <ChevronDown className="size-4" />
            </motion.span>
          )}
        </span>
      </Trigger>
      <AnimatePresence initial={false}>
        {expanded && ev.detail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.22 }}
            className="overflow-hidden"
          >
            <div className="pb-4">{ev.detail}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function Timeline({ events, label, maxHeight, className }: TimelineProps) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const rows = React.useMemo(
    () => [...events].map((e) => ({ ...e, time: new Date(e.at).getTime() })).sort((a, b) => b.time - a.time),
    [events],
  );
  const groups = React.useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = new Date(r.time).toDateString();
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return [...map.values()];
  }, [rows]);

  function toggle(id: string) {
    setOpen((cur) => {
      const n = new Set(cur);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <div role="region" aria-label={label} className={cn("overflow-y-auto", className)} style={{ maxHeight }}>
      {groups.map((g) => (
        <section key={g[0].time} className="mb-2">
          <div className="sticky top-0 z-10 mb-3 flex items-center justify-between bg-card/95 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <span>{dayLabel(g[0].time)}</span>
            <span>
              {g.length} {g.length === 1 ? "message" : "messages"}
            </span>
          </div>
          <ol>
            {g.map((ev, i) => (
              <Row key={ev.id} ev={ev} last={i === g.length - 1} expanded={open.has(ev.id)} onToggle={() => toggle(ev.id)} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
