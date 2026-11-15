import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui/primitives";
import { KINDS, NODE_KINDS, type NodeKind } from "@/lib/automations";
import { KIND_STYLE } from "./node-style";

/**
 * The step palette. Press a step (or Enter on it) to add it: under the selected step and joined to it, or in the
 * middle of the view. Or drag it onto the canvas with a mouse, pen or finger.
 */
export function NodePalette({ onAdd, onDrop, compact = false }: {
  onAdd: (kind: NodeKind) => void;
  /** Returns false when the drop point is not on the canvas. */
  onDrop: (kind: NodeKind, clientX: number, clientY: number) => boolean;
  compact?: boolean;
}) {
  const [ghost, setGhost] = React.useState<{ kind: NodeKind; x: number; y: number } | null>(null);
  const press = React.useRef<{ kind: NodeKind; x: number; y: number; dragging: boolean } | null>(null);
  const suppress = React.useRef(false);

  return (
    <nav aria-label="Steps you can add" className="flex min-h-0 flex-col">
      {!compact && <p className="px-1 pb-2 text-xs leading-snug text-muted-foreground">Press a step to add it under the selected one, or drag it onto the canvas.</p>}
      <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
        {NODE_KINDS.map((kind) => {
          const k = KINDS[kind];
          const st = KIND_STYLE[kind];
          return (
            <li key={kind}>
              <button
                type="button"
                title={compact ? `${k.label}: ${k.hint}` : undefined}
                aria-label={`Add ${k.label}. ${k.hint}`}
                onClick={() => { if (suppress.current) { suppress.current = false; return; } onAdd(kind); }}
                onPointerDown={(e) => { press.current = { kind, x: e.clientX, y: e.clientY, dragging: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => {
                  const p = press.current;
                  if (!p) return;
                  if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
                  p.dragging = true;
                  setGhost({ kind, x: e.clientX, y: e.clientY });
                }}
                onPointerUp={(e) => {
                  const p = press.current;
                  press.current = null;
                  setGhost(null);
                  if (p?.dragging) { suppress.current = true; onDrop(kind, e.clientX, e.clientY); window.setTimeout(() => { suppress.current = false; }, 0); }
                }}
                onPointerCancel={() => { press.current = null; setGhost(null); }}
                className={cn(
                  "group relative flex w-full touch-none items-center overflow-hidden rounded-xl border border-[rgba(20,32,28,0.10)] bg-white text-left transition-colors hover:border-[#03C1AC]/60 hover:bg-[#FFFFFF] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:bg-white/5",
                  compact ? "size-11 justify-center" : "gap-2.5 py-2 pl-3 pr-2.5",
                )}
              >
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: st.edge }} />
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-lg border" style={{ color: st.ink, borderColor: `${st.edge}55`, background: st.tint }}>
                  <st.Icon className="size-4" stroke={1.75} />
                </span>
                {!compact && (
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-semibold leading-tight text-[#032C26] dark:text-foreground">{k.label}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{k.hint}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {ghost && createPortal(
        <div aria-hidden="true" className="pointer-events-none fixed z-[70] flex items-center gap-2 rounded-xl border border-[#035D53]/40 bg-white/95 px-3 py-2 text-[0.8125rem] font-semibold text-[#032C26] shadow-lg" style={{ left: ghost.x + 8, top: ghost.y + 8 }}>
          {React.createElement(KIND_STYLE[ghost.kind].Icon, { className: "size-4", stroke: 1.75, style: { color: KIND_STYLE[ghost.kind].ink } })}
          {KINDS[ghost.kind].label}
        </div>,
        document.body,
      )}
    </nav>
  );
}
