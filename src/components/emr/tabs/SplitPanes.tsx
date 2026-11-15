import * as React from "react";
import { ArrowLeftRight, Maximize2, X } from "lucide-react";
import { SubTabs } from "@/components/emr/tabs/ChartTabs";
import { cn } from "@/components/ui/primitives";
import { EMR_TABS } from "@/lib/emr-menu";
import { clampRatio, other, type Pane, type Side, type Split } from "./split";

/**
 * Two chart sections side by side. Each pane has a small header (the section, its sub-tabs, Swap, Make Full Width and
 * Close) and scrolls on its own; the patient header above is shared. The bar between them is dragged to set the
 * widths (30 to 70 percent), moved with the arrow keys, and reset with a double-click. Under 1100px the panes stack.
 */

/** True on screens wide enough for two panes. A phone gets one pane. */
export function useCanSplit(): boolean {
  const query = "(min-width: 640px)";
  return React.useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

const ICON = "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function SplitPanes({ visit, split, active, ratio, fits, onRatio, onActive, onPick, onSwap, onClose, render }: {
  visit: string;
  split: Split & { right: Pane };
  active: Side;
  ratio: number;
  fits: (section: string) => boolean;
  onRatio: (ratio: number) => void;
  onActive: (side: Side) => void;
  onPick: (side: Side, pane: Pane) => void;
  onSwap: () => void;
  onClose: (side: Side) => void;
  render: (pane: Pane, side: Side) => React.ReactNode;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const drag = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (dragging && r) onRatio(clampRatio((e.clientX - r.left) / r.width));
  };

  const pane = (side: Side) => {
    const p = split[side];
    const tab = EMR_TABS.find((t) => t.id === p.tab)!;
    const label = tab.items.find((i) => i.id === p.section)?.label ?? p.section;
    const name = side === "left" ? "First" : "Second";
    return (
      <section
        key={side} data-pane={side} tabIndex={-1} aria-label={`${name} pane: ${label}`}
        onFocusCapture={() => onActive(side)} onPointerDownCapture={() => onActive(side)}
        style={{ flex: `${side === "left" ? ratio : 1 - ratio} 1 0%` }}
        className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <header className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-[var(--glass-solid)] px-2.5 py-1.5", active === side && "shadow-[inset_0_3px_0_#39EDD5]")}>
          <h2 className="min-w-0 truncate text-[0.8125rem] font-semibold">
            {tab.items.length > 1 && tab.id !== "more" && <span className="font-normal text-muted-foreground">{tab.label} / </span>}{label}
          </h2>
          <div className="ms-auto flex shrink-0 items-center gap-0.5">
            <button type="button" className={ICON} onClick={onSwap} title="Swap The Two Panes" aria-label="Swap the two panes"><ArrowLeftRight className="size-4" /></button>
            <button type="button" className={ICON} onClick={() => onClose(other(side))} title="Make Full Width" aria-label={`Make ${label} full width`}><Maximize2 className="size-4" /></button>
            <button type="button" className={ICON} onClick={() => onClose(side)} title="Close This Pane" aria-label={`Close ${label}`}><X className="size-4" /></button>
          </div>
          {tab.id !== "more" && <SubTabs className="w-full" tab={tab} section={p.section} visit={visit} fits={fits} onPick={(section) => onPick(side, { section, tab: tab.id })} />}
        </header>
        <div className="max-h-[70vh] min-h-40 overflow-y-auto p-2 min-[1100px]:max-h-[calc(100vh-13rem)]">{render(p, side)}</div>
      </section>
    );
  };

  return (
    <div ref={box} className={cn("mt-4 flex flex-col gap-3 min-[1100px]:flex-row min-[1100px]:items-start min-[1100px]:gap-0", dragging && "select-none")}>
      {pane("left")}
      <div
        role="separator" aria-orientation="vertical" aria-label="Width of the two panes" tabIndex={0}
        aria-valuemin={30} aria-valuemax={70} aria-valuenow={Math.round(ratio * 100)}
        title="Drag to resize. Double-click to reset."
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
        onPointerMove={drag} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => onRatio(0.5)}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -0.02, ArrowRight: 0.02 }[e.key];
          if (step) { e.preventDefault(); onRatio(clampRatio(ratio + step)); }
          if (e.key === "Home" || e.key === "Enter") onRatio(0.5);
        }}
        className="group hidden w-3 shrink-0 cursor-col-resize touch-none justify-center self-stretch outline-none min-[1100px]:flex"
      >
        <span className={cn("w-1 rounded-full bg-border transition-colors group-hover:bg-[#39EDD5] group-focus-visible:bg-ring", dragging && "bg-[#39EDD5]")} />
      </div>
      {pane("right")}
    </div>
  );
}
