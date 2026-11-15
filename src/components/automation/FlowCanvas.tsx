import * as React from "react";
import { IconAlertTriangle, IconFocusCentered, IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import { cn } from "@/components/ui/primitives";
import {
  GRID, KINDS, NODE_H, NODE_W, PORT_LABEL, connect, flowBounds, nodeDetail, nodeTitle, snap, updateNode,
  type Flow, type FlowEdge, type FlowNode, type Port, type StepStatus,
} from "@/lib/automations";
import { KIND_STYLE, STEP_TONE } from "./node-style";

/**
 * The flowchart canvas, drawn by hand: nodes are positioned HTML, connections are SVG curves with arrowheads, both
 * inside one transformed layer so pan and zoom move them together. Pointer events only, so mouse, pen and touch
 * (one finger pans or drags, two fingers pinch) all work. Every action has a key as well.
 */

export interface CanvasApi {
  fit: () => void;
  zoomBy: (f: number) => void;
  /** Canvas point at the middle of the visible area. */
  center: () => { x: number; y: number };
  /** Canvas point under a screen point, or null when the point is outside the canvas. */
  toWorld: (clientX: number, clientY: number) => { x: number; y: number } | null;
  focusNode: (id: string) => void;
  /**
   * Moves the view, without moving focus, so a step is clear of what covers the canvas: the test run panel at the
   * bottom (`bottom`, a share of the height) or the settings panel on the right (`right`, in pixels).
   */
  reveal: (id: string, opts?: { right?: number; bottom?: number }) => void;
}

interface View { x: number; y: number; k: number }

export interface FlowCanvasProps {
  flow: Flow;
  selected: string | null;
  selectedEdge: string | null;
  onSelect: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  /** `record` true: keep the flow before this change for Undo. */
  onChange: (next: Flow, record: boolean) => void;
  onDelete: (id: string) => void;
  issues?: Record<string, "error" | "warning">;
  /** Status of each node in the run being played, by node id. */
  lit?: Record<string, StepStatus>;
  activeNode?: string | null;
  readOnly?: boolean;
  label: string;
  className?: string;
}

const MIN_K = 0.3, MAX_K = 2;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export function portPoint(n: FlowNode, port: Port) {
  const fx = port === "yes" ? 0.27 : port === "no" ? 0.73 : 0.5;
  return { x: n.x + NODE_W * fx, y: n.y + NODE_H };
}
const inPoint = (n: FlowNode) => ({ x: n.x + NODE_W / 2, y: n.y });

/** A smooth curve from an exit to an entry. A connection that goes back up loops out to the side. */
export function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dy = b.y - a.y;
  if (dy >= 24) {
    const c = Math.max(36, dy / 2);
    return `M${a.x},${a.y} C${a.x},${a.y + c} ${b.x},${b.y - c} ${b.x},${b.y}`;
  }
  const side = (b.x >= a.x ? 1 : -1) * (NODE_W / 2 + 60);
  return `M${a.x},${a.y} C${a.x},${a.y + 90} ${a.x + side},${a.y + 90} ${(a.x + b.x) / 2 + side},${(a.y + b.y) / 2} S${b.x},${b.y - 90} ${b.x},${b.y}`;
}

const prefersReduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const FlowCanvas = React.forwardRef<CanvasApi, FlowCanvasProps>(function FlowCanvas(
  { flow, selected, selectedEdge, onSelect, onSelectEdge, onChange, onDelete, issues = {}, lit, activeNode, readOnly = false, label, className },
  ref,
) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>({ x: 0, y: 40, k: 1 });
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const flowRef = React.useRef(flow);
  flowRef.current = flow;
  const [size, setSize] = React.useState({ w: 800, h: 600 });
  const [linking, setLinking] = React.useState<{ from: string; port: Port; x: number; y: number; over: string | null } | null>(null);
  const [dragging, setDragging] = React.useState<string | null>(null);
  const gesture = React.useRef<
    | { type: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { type: "node"; id: string; sx: number; sy: number; nx: number; ny: number; moved: boolean }
    | { type: "link" }
    | { type: "pinch"; d: number; k: number; mx: number; my: number; vx: number; vy: number }
    | null
  >(null);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());

  React.useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = React.useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const w = el.clientWidth, h = el.clientHeight;
    const b = flowBounds(flowRef.current);
    // Room at the bottom for the zoom buttons and the minimap.
    const pad = 40, bottom = 72;
    const k = clampK(Math.min((w - pad * 2) / b.w, (h - pad - bottom) / b.h, 1.05));
    setView({ k, x: (w - b.w * k) / 2 - b.x * k, y: pad + (h - pad - bottom - b.h * k) / 2 - b.y * k });
  }, []);

  const zoomAt = React.useCallback((f: number, px: number, py: number) => {
    setView((v) => {
      const k = clampK(v.k * f);
      const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
      return { k, x: px - wx * k, y: py - wy * k };
    });
  }, []);

  const toLocal = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top, inside: clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom };
  };
  const worldOf = (clientX: number, clientY: number) => {
    const l = toLocal(clientX, clientY);
    const v = viewRef.current;
    return { x: (l.x - v.x) / v.k, y: (l.y - v.y) / v.k, inside: l.inside };
  };

  React.useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (f) => zoomAt(f, size.w / 2, size.h / 2),
    center: () => ({ x: (size.w / 2 - viewRef.current.x) / viewRef.current.k, y: (size.h / 2 - viewRef.current.y) / viewRef.current.k }),
    toWorld: (cx, cy) => { const w = worldOf(cx, cy); return w.inside ? { x: w.x, y: w.y } : null; },
    focusNode: (id) => {
      const n = flowRef.current.nodes.find((x) => x.id === id);
      const el = wrap.current;
      if (n && el) {
        const v = viewRef.current;
        const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
        if (sx < 0 || sy < 0 || sx + NODE_W * v.k > el.clientWidth || sy + NODE_H * v.k > el.clientHeight) {
          setView({ ...v, x: el.clientWidth / 2 - (n.x + NODE_W / 2) * v.k, y: el.clientHeight / 2 - (n.y + NODE_H / 2) * v.k });
        }
      }
      el?.querySelector<HTMLElement>(`[data-node-id="${id}"]`)?.focus({ preventScroll: true });
    },
    reveal: (id, opts = {}) => {
      const n = flowRef.current.nodes.find((x) => x.id === id);
      const el = wrap.current;
      if (!n || !el) return;
      const v = viewRef.current;
      const sx = n.x * v.k + v.x, sy = n.y * v.k + v.y;
      const w = el.clientWidth - (opts.right ?? 0);
      const h = el.clientHeight * (1 - (opts.bottom ?? 0));
      if (sx < 8 || sy < 8 || sx + NODE_W * v.k > w - 8 || sy + NODE_H * v.k > h - 8) {
        setView({ ...v, x: w / 2 - (n.x + NODE_W / 2) * v.k, y: h * 0.5 - (n.y + NODE_H / 2) * v.k });
      }
    },
  }), [fit, zoomAt, size.w, size.h]);

  // Fit once the canvas has its size.
  const fitted = React.useRef(false);
  React.useEffect(() => {
    if (!fitted.current && size.w > 100) { fitted.current = true; fit(); }
  }, [size.w, fit]);

  // Wheel zoom needs a listener that may cancel the page scroll.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const l = toLocal(e.clientX, e.clientY);
      if (e.shiftKey) { setView((v) => ({ ...v, x: v.x - e.deltaY, y: v.y - e.deltaX })); return; }
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), l.x, l.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ---------- pointer gestures ---------- */

  function onPointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const l = toLocal((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      gesture.current = { type: "pinch", d: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: view.k, mx: l.x, my: l.y, vx: view.x, vy: view.y };
      setLinking(null); setDragging(null);
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const handle = target.closest<HTMLElement>("[data-handle]");
    const nodeEl = target.closest<HTMLElement>("[data-node-id]");
    if (target.closest("[data-ui]")) return;
    wrap.current?.setPointerCapture(e.pointerId);
    if (handle && !readOnly) {
      const w = worldOf(e.clientX, e.clientY);
      gesture.current = { type: "link" };
      setLinking({ from: handle.dataset.from!, port: handle.dataset.handle as Port, x: w.x, y: w.y, over: null });
      e.stopPropagation();
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.nodeId!;
      onSelect(id);
      onSelectEdge(null);
      const n = flow.nodes.find((x) => x.id === id)!;
      if (!readOnly) gesture.current = { type: "node", id, sx: e.clientX, sy: e.clientY, nx: n.x, ny: n.y, moved: false };
      return;
    }
    if (!target.closest("[data-edge]")) { onSelect(null); onSelectEdge(null); }
    gesture.current = { type: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    wrap.current?.focus({ preventScroll: true });
  }

  function onPointerMove(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const k = clampK(g.k * (d / g.d));
      const wx = (g.mx - g.vx) / g.k, wy = (g.my - g.vy) / g.k;
      setView({ k, x: g.mx - wx * k, y: g.my - wy * k });
    } else if (g.type === "pan") {
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
    } else if (g.type === "node") {
      const dx = (e.clientX - g.sx) / view.k, dy = (e.clientY - g.sy) / view.k;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      const x = snap(g.nx + dx), y = snap(g.ny + dy);
      const n = flow.nodes.find((q) => q.id === g.id);
      if (n && (n.x !== x || n.y !== y)) onChange(updateNode(flow, g.id, { x, y }), !g.moved);
      if (!g.moved) setDragging(g.id);
      g.moved = true;
    } else if (g.type === "link") {
      const w = worldOf(e.clientX, e.clientY);
      const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
      setLinking((l) => (l ? { ...l, x: w.x, y: w.y, over } : l));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.type === "link" && linking) {
      const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
      if (over && over !== linking.from) {
        const next = connect(flow, linking.from, linking.port, over);
        if (next !== flow) onChange(next, true);
      }
      setLinking(null);
    }
    if (g?.type === "pinch" && pointers.current.size === 1) {
      const [p] = [...pointers.current.values()];
      gesture.current = { type: "pan", sx: p.x, sy: p.y, vx: viewRef.current.x, vy: viewRef.current.y };
      return;
    }
    setDragging(null);
    gesture.current = null;
  }

  /* ---------- keys ---------- */

  function onKeyDown(e: React.KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select")) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const n = selected ? flow.nodes.find((x) => x.id === selected) : undefined;
      if (n && !readOnly) onChange(updateNode(flow, n.id, { x: n.x + dx * step, y: n.y + dy * step }), true);
      else setView((v) => ({ ...v, x: v.x - dx * 60, y: v.y - dy * 60 }));
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && !readOnly) {
      e.preventDefault();
      if (selectedEdge) { onChange({ ...flow, edges: flow.edges.filter((x) => x.id !== selectedEdge) }, true); onSelectEdge(null); }
      else if (selected) onDelete(selected);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAt(1.2, size.w / 2, size.h / 2); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAt(1 / 1.2, size.w / 2, size.h / 2); }
    else if (e.key === "0" || e.key.toLowerCase() === "f") { e.preventDefault(); fit(); }
    else if (e.key === "Escape") { onSelect(null); onSelectEdge(null); wrap.current?.focus({ preventScroll: true }); }
  }

  /* ---------- drawing ---------- */

  const byId = React.useMemo(() => new Map(flow.nodes.map((n) => [n.id, n])), [flow.nodes]);
  const playing = !!lit;
  const edgeLit = (e: FlowEdge) => {
    const a = lit?.[e.from], b = lit?.[e.to];
    if (!a || !b) return false;
    return e.port === "yes" ? a === "yes" : e.port === "no" ? a === "no" : true;
  };
  const reduced = prefersReduced();

  return (
    <div
      ref={wrap}
      role="application"
      aria-roledescription="flowchart canvas"
      aria-label={label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        gesture.current?.type === "pan" ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      style={{
        backgroundColor: "var(--glass-solid, #fff)",
        backgroundImage: "radial-gradient(circle, rgba(3,44,38,0.16) 1px, transparent 1.3px)",
        backgroundSize: `${GRID * view.k}px ${GRID * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" aria-hidden="true">
          <defs>
            <marker id="af-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill="#546259" />
            </marker>
            <marker id="af-arrow-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill="#03C1AC" />
            </marker>
            <marker id="af-arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" fill="#00A671" />
            </marker>
          </defs>
          {flow.edges.map((e) => {
            const a = byId.get(e.from), b = byId.get(e.to);
            if (!a || !b) return null;
            const p = portPoint(a, e.port), q = inPoint(b);
            const d = edgePath(p, q);
            const on = playing && edgeLit(e);
            const sel = selectedEdge === e.id;
            return (
              <g key={e.id} data-edge={e.id}>
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} className={readOnly ? "" : "cursor-pointer"}
                  onPointerDown={(ev) => { if (readOnly) return; ev.stopPropagation(); onSelectEdge(e.id); onSelect(null); wrap.current?.focus({ preventScroll: true }); }} />
                <path d={d} fill="none" strokeLinecap="round"
                  stroke={sel ? "#00A671" : on ? "#03C1AC" : "#546259"} strokeOpacity={playing && !on ? 0.3 : sel || on ? 1 : 0.7}
                  strokeWidth={sel || on ? 2.4 : 1.6} markerEnd={`url(#${sel ? "af-arrow-sel" : on ? "af-arrow-on" : "af-arrow"})`}
                  strokeDasharray={on && !reduced ? "6 5" : undefined} className={on && !reduced ? "[animation:af-dash_0.9s_linear_infinite]" : undefined} />
                {e.port !== "out" && (
                  <g transform={`translate(${p.x},${p.y + 16})`} pointerEvents="none">
                    <rect x={-15} y={-9} width={30} height={18} rx={9} fill={e.port === "yes" ? "#DEEFE5" : "#DEEFE5"} stroke={e.port === "yes" ? "#00A671" : "#819689"} strokeOpacity={0.45} />
                    <text textAnchor="middle" dy="0.35em" fontSize="11" fontWeight={600} fill={e.port === "yes" ? "#016D48" : "#546259"}>{PORT_LABEL[e.port]}</text>
                  </g>
                )}
              </g>
            );
          })}
          {linking && (() => {
            const a = byId.get(linking.from);
            if (!a) return null;
            return <path d={edgePath(portPoint(a, linking.port), { x: linking.x, y: linking.y })} fill="none" stroke="#03C1AC" strokeWidth={2} strokeDasharray="5 4" markerEnd="url(#af-arrow-on)" />;
          })()}
        </svg>

        {flow.nodes.map((n) => {
          const style = KIND_STYLE[n.kind];
          const issue = issues[n.id];
          const sel = selected === n.id;
          const status = lit?.[n.id];
          const active = activeNode === n.id;
          const title = nodeTitle(n);
          return (
            <div
              key={n.id}
              data-node-id={n.id}
              role="button"
              tabIndex={0}
              aria-pressed={sel}
              aria-label={`${KINDS[n.kind].label}: ${title}. ${nodeDetail(n)}${issue ? ` Has ${issue === "error" ? "a problem" : "a warning"}.` : ""}${status ? ` Run: ${STEP_TONE[status].label}.` : ""}`}
              onFocus={() => { if (selected !== n.id) { onSelect(n.id); onSelectEdge(null); } }}
              className={cn(
                "group absolute flex rounded-xl border bg-white text-left shadow-[0_1px_2px_rgba(16,24,22,0.06),0_10px_24px_-16px_rgba(16,24,22,0.35)] outline-none transition-[box-shadow,opacity] dark:bg-[#032C26]",
                readOnly ? "cursor-default" : dragging === n.id ? "cursor-grabbing" : "cursor-pointer",
                sel ? "border-[#035D53] ring-2 ring-[#39EDD5]" : "border-[rgba(20,32,28,0.12)] focus-visible:ring-2 focus-visible:ring-ring",
                issue === "error" && !sel && "border-destructive/70",
                linking?.over === n.id && linking.from !== n.id && "ring-2 ring-[#03C1AC]",
                playing && !status && "opacity-45",
                status && !sel && (status === "blocked" || status === "failed" || status === "declined" ? "ring-2 ring-destructive" : "ring-2 ring-[#39EDD5]"),
                active && !reduced && "shadow-[0_0_0_6px_rgba(57,237,213,0.28),0_10px_24px_-16px_rgba(16,24,22,0.35)]",
              )}
              style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}
            >
              <span aria-hidden="true" className="w-1.5 shrink-0 rounded-l-[11px]" style={{ background: style.edge }} />
              <div className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pl-2.5 pr-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border" style={{ color: style.ink, borderColor: `${style.edge}55`, background: style.tint }}>
                  <style.Icon className="size-[1.05rem]" stroke={1.75} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[0.6875rem] font-semibold leading-4 tracking-wide" style={{ color: style.ink }}>
                    {KINDS[n.kind].label}
                    {status && <span className={cn("rounded px-1 py-px text-[0.625rem] font-semibold leading-3", STEP_TONE[status].cls)}>{STEP_TONE[status].label}</span>}
                  </p>
                  <p className="line-clamp-2 text-[0.8125rem] font-semibold leading-[1.15rem] text-[#032C26] dark:text-foreground">{title}</p>
                </div>
              </div>
              {issue && (
                <span className={cn("absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full text-white shadow", issue === "error" ? "bg-destructive" : "bg-[#C98A12]")} aria-hidden="true">
                  <IconAlertTriangle className="size-3" stroke={2.25} />
                </span>
              )}
              {n.kind !== "trigger" && <span aria-hidden="true" className="absolute -top-[5px] left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-white bg-[#819689] dark:border-[#032C26]" />}
              {!readOnly && KINDS[n.kind].ports.map((port) => {
                const fx = port === "yes" ? 0.27 : port === "no" ? 0.73 : 0.5;
                return (
                  <span
                    key={port}
                    data-handle={port}
                    data-from={n.id}
                    title={`Drag to connect ${port === "out" ? "the next step" : `the ${PORT_LABEL[port]} path`}`}
                    aria-hidden="true"
                    className="absolute -bottom-[9px] z-10 flex size-[18px] -translate-x-1/2 cursor-crosshair items-center justify-center rounded-full"
                    style={{ left: NODE_W * fx }}
                  >
                    <span className="size-3 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-125 dark:border-[#032C26]" style={{ background: port === "no" ? "#819689" : port === "yes" ? "#00A671" : "#03C1AC" }} />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>

      <div data-ui className="glass-pill absolute bottom-3 left-3 flex items-center gap-0.5 p-1">
        <button type="button" className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-[#032C26]/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => zoomAt(1 / 1.2, size.w / 2, size.h / 2)} aria-label="Zoom out" title="Zoom out (-)"><IconZoomOut className="size-4" aria-hidden="true" /></button>
        <span className="w-11 text-center text-xs font-medium tabular-nums text-foreground" aria-live="polite">{Math.round(view.k * 100)}%</span>
        <button type="button" className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-[#032C26]/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => zoomAt(1.2, size.w / 2, size.h / 2)} aria-label="Zoom in" title="Zoom in (+)"><IconZoomIn className="size-4" aria-hidden="true" /></button>
        <button type="button" className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-[#032C26]/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={fit} aria-label="Zoom to fit" title="Zoom to fit (0)"><IconFocusCentered className="size-4" aria-hidden="true" /></button>
      </div>

      <Minimap flow={flow} view={view} size={size} onCenter={(x, y) => setView((v) => ({ ...v, x: size.w / 2 - x * v.k, y: size.h / 2 - y * v.k }))} lit={lit} />
      <style>{"@keyframes af-dash { to { stroke-dashoffset: -11; } }"}</style>
    </div>
  );
});

/** A small map of the whole flow with the visible area marked. Press or drag on it to move there. */
function Minimap({ flow, view, size, onCenter, lit }: { flow: Flow; view: View; size: { w: number; h: number }; onCenter: (x: number, y: number) => void; lit?: Record<string, StepStatus> }) {
  const W = 132, H = 88;
  const b = flowBounds(flow);
  const vw = { x: -view.x / view.k, y: -view.y / view.k, w: size.w / view.k, h: size.h / view.k };
  const x0 = Math.min(b.x, vw.x) - 40, y0 = Math.min(b.y, vw.y) - 40;
  const x1 = Math.max(b.x + b.w, vw.x + vw.w) + 40, y1 = Math.max(b.y + b.h, vw.y + vw.h) + 40;
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const down = React.useRef(false);
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onCenter((e.clientX - r.left - ox) / s + x0, (e.clientY - r.top - oy) / s + y0);
  };
  if (size.w < 520) return null;
  return (
    <div data-ui className="glass-pill absolute bottom-3 right-3 overflow-hidden rounded-xl p-1" style={{ borderRadius: 12 }}>
      <svg
        width={W} height={H} role="img" aria-label="Minimap of the whole flow. Press to move the view there." className="block cursor-pointer"
        onPointerDown={(e) => { down.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
        onPointerMove={(e) => down.current && move(e)}
        onPointerUp={() => { down.current = false; }}
      >
        {flow.nodes.map((n) => (
          <rect key={n.id} x={ox + (n.x - x0) * s} y={oy + (n.y - y0) * s} width={NODE_W * s} height={NODE_H * s} rx={2}
            fill={lit && !lit[n.id] ? "#C6DACD" : KIND_STYLE[n.kind].edge} fillOpacity={lit?.[n.id] ? 1 : 0.75} />
        ))}
        <rect x={ox + (vw.x - x0) * s} y={oy + (vw.y - y0) * s} width={vw.w * s} height={vw.h * s} fill="rgba(57,237,213,0.12)" stroke="#035D53" strokeWidth={1.25} rx={3} />
      </svg>
    </div>
  );
}
