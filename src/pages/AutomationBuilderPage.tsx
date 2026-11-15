import * as React from "react";
import {
  IconAlertTriangle, IconArrowBackUp, IconArrowForwardUp, IconArrowLeft, IconCircleCheck, IconDeviceTablet, IconDeviceFloppy, IconHistory, IconPlayerPause,
  IconPlayerPlay, IconRefresh, IconShieldCheck, IconSitemap, IconX,
} from "@tabler/icons-react";
import { FlowCanvas, type CanvasApi } from "@/components/automation/FlowCanvas";
import { KIND_STYLE } from "@/components/automation/node-style";
import { NodePalette } from "@/components/automation/NodePalette";
import { NodeSettingsPanel } from "@/components/automation/NodeSettingsPanel";
import { RunLog } from "@/components/automation/RunLog";
import { GLASS_BTN, ICON_BTN } from "@/components/ai/chat-parts";
import { Badge, Button, Empty, Field, Input, cn } from "@/components/ui/primitives";
import { useAudit } from "@/lib/audit";
import { recentEvents, testRun } from "@/lib/automation-engine";
import {
  GRID, KINDS, NODE_H, NODE_W, STATUS_LABEL, TRIGGER_BY_ID, addNode, autoLayout, automationById, connect, freePort, removeEdge, removeNode,
  saveAutomation, setAutomationStatus, triggerOf, updateNode, useAutomations, validateFlow,
  type Automation, type Flow, type NodeKind, type Run, type StepStatus,
} from "@/lib/automations";
import { navigate, useRoute } from "@/lib/router";
import { pushToast } from "@/lib/toast";
import { fmtTime } from "@/lib/format";

/**
 * The automation builder: palette on the left, the canvas in the middle, the settings of the selected step on the right.
 * Changes stay on this screen until Save. Test Run replays recent HIS events through the flow and lights the steps
 * up one by one; it changes nothing. On a phone the flow is view only.
 */

function useMedia(q: string): boolean {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;
  const [m, setM] = React.useState(get);
  React.useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    on();
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

const STATUS_TONE = { active: "ok", paused: "warn", draft: "neutral" } as const;
const same = (a: Flow, b: Flow) => JSON.stringify(a) === JSON.stringify(b);

export function AutomationBuilderPage() {
  const route = useRoute();
  const id = route.params.get("id") ?? "";
  const store = useAutomations();
  const auto = automationById(id, store);
  if (!auto) {
    return (
      <div className="glass-panel rounded-2xl">
        <Empty>
          This automation was not found. It may have been deleted.
          <div className="mt-3"><Button onClick={() => navigate("/automations")}>Back To Automations</Button></div>
        </Empty>
      </div>
    );
  }
  // A new key for each automation: opening another one starts with a clean screen.
  return <Builder key={auto.id} auto={auto} autoTest={route.params.get("test") === "1"} />;
}

function Builder({ auto, autoTest }: { auto: Automation; autoTest: boolean }) {
  const phone = useMedia("(max-width: 767px)");
  const wide = useMedia("(min-width: 1280px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const entries = useAudit();

  const [flow, setFlow] = React.useState<Flow>(auto.flow);
  const [name, setName] = React.useState(auto.name);
  const [description, setDescription] = React.useState(auto.description);
  // Undo and Redo stacks live in refs so the Undo in a toast always sees the current lists.
  const undoRef = React.useRef<Flow[]>([]);
  const redoRef = React.useRef<Flow[]>([]);
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  const undo = undoRef.current, redo = redoRef.current;
  const lastKey = React.useRef<{ key: string; at: number } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [test, setTest] = React.useState<{ runs: Run[]; pick: number; shown: number } | null>(null);
  const canvas = React.useRef<CanvasApi>(null);
  const flowRef = React.useRef(flow);
  flowRef.current = flow;

  const dirty = (!same(flow, auto.flow) || name !== auto.name || description !== auto.description);
  const issues = React.useMemo(() => validateFlow(flow), [flow]);
  const errors = issues.filter((i) => i.level === "error");
  const marks = React.useMemo(() => {
    const m: Record<string, "error" | "warning"> = {};
    if (!checked) return m;
    for (const i of issues) if (i.nodeId && m[i.nodeId] !== "error") m[i.nodeId] = i.level;
    return m;
  }, [issues, checked]);
  const trigger = triggerOf(flow);
  const node = selected ? flow.nodes.find((n) => n.id === selected) : undefined;
  const readOnly = phone;

  /** Change the flow. With `record`, the flow before goes on the Undo list; `key` folds quick edits of one field into one step. */
  const apply = React.useCallback((next: Flow, record = true, key?: string) => {
    const prev = flowRef.current;
    if (next === prev) return;
    if (record) {
      const now = Date.now();
      const fold = key && lastKey.current?.key === key && now - lastKey.current.at < 1500;
      lastKey.current = key ? { key, at: now } : null;
      if (!fold) { undoRef.current = [...undoRef.current.slice(-79), prev]; redoRef.current = []; }
    }
    setFlow(next);
    setTest(null);
  }, []);

  const doUndo = React.useCallback(() => {
    const u = undoRef.current;
    if (!u.length) return;
    redoRef.current = [...redoRef.current, flowRef.current];
    undoRef.current = u.slice(0, -1);
    lastKey.current = null;
    setFlow(u[u.length - 1]);
    bump();
  }, []);
  const doRedo = React.useCallback(() => {
    const r = redoRef.current;
    if (!r.length) return;
    undoRef.current = [...undoRef.current, flowRef.current];
    redoRef.current = r.slice(0, -1);
    lastKey.current = null;
    setFlow(r[r.length - 1]);
    bump();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || readOnly) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doRedo(); }
      else if (k === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ---------- test run playback ---------- */

  React.useEffect(() => {
    if (!test) return;
    const steps = test.runs[test.pick].steps.length;
    if (test.shown >= steps) return;
    const t = window.setTimeout(() => setTest((x) => (x ? { ...x, shown: x.shown + 1 } : x)), 650);
    return () => window.clearTimeout(t);
  }, [test]);

  const playing = test?.runs[test.pick];
  const lit = React.useMemo(() => {
    if (!test || !playing) return undefined;
    const m: Record<string, StepStatus> = {};
    for (const s of playing.steps.slice(0, test.shown)) if (s.nodeId) m[s.nodeId] = s.status;
    return m;
  }, [test, playing]);
  const activeStep = test && playing ? playing.steps[test.shown - 1] : undefined;

  function startTest() {
    if (!trigger) { pushToast({ tone: "warn", text: "Choose a trigger first.", detail: "A test run replays recent events for the trigger." }); return; }
    const runs = testRun({ id: auto.id, name, flow }, recentEvents(trigger, entries));
    setSelected(null);
    setTest({ runs, pick: 0, shown: reduced ? runs[0].steps.length : 1 });
  }

  // Opened from the list with Test Run: play once the canvas has its size.
  React.useEffect(() => {
    if (!autoTest) return;
    const t = window.setTimeout(startTest, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the step being played in view, above the test run panel.
  React.useEffect(() => {
    if (activeStep?.nodeId) canvas.current?.reveal(activeStep.nodeId, { bottom: 0.5 });
  }, [activeStep?.nodeId]);

  // On a tablet the settings panel covers the right of the canvas: keep the selected step clear of it.
  React.useEffect(() => {
    if (selected && !wide && !phone) canvas.current?.reveal(selected, { right: 352 });
  }, [selected, wide, phone]);

  /* ---------- editing ---------- */

  function place(kind: NodeKind, at?: { x: number; y: number }) {
    if (readOnly) return;
    if (kind === "trigger" && flow.nodes.some((n) => n.kind === "trigger")) {
      pushToast({ tone: "warn", text: "A flow has one Trigger.", detail: "Change the trigger in its settings, or start a new automation for another event." });
      return;
    }
    const sel = node;
    const port = sel ? freePort(flow, sel) : null;
    let x: number, y: number;
    if (at) { x = at.x - NODE_W / 2; y = at.y - NODE_H / 2; }
    else if (sel && port) {
      x = sel.x + (port === "yes" ? -(NODE_W / 2 + 24) : port === "no" ? NODE_W / 2 + 24 : 0);
      y = sel.y + NODE_H + 64;
    } else { const c = canvas.current?.center() ?? { x: 0, y: 0 }; x = c.x - NODE_W / 2; y = c.y - NODE_H / 2; }
    const hit = (px: number, py: number) => flow.nodes.some((n) => Math.abs(n.x - px) < NODE_W && Math.abs(n.y - py) < NODE_H + 8);
    let guard = 0;
    while (hit(Math.round(x / GRID) * GRID, Math.round(y / GRID) * GRID) && guard++ < 30) y += NODE_H + 24;
    let { flow: next, id: newId } = addNode(flow, kind, x, y);
    if (!at && sel && port) next = connect(next, sel.id, port, newId);
    apply(next);
    setSelected(newId);
    setSelectedEdge(null);
    window.setTimeout(() => canvas.current?.focusNode(newId), 40);
  }

  function del(id: string) {
    const n = flow.nodes.find((x) => x.id === id);
    if (!n || readOnly) return;
    apply(removeNode(flow, id));
    setSelected(null);
    pushToast({ tone: "ok", text: `${KINDS[n.kind].label} deleted.`, undo: { label: "Undo", run: doUndo } });
  }

  function layout() {
    apply(autoLayout(flow));
    window.setTimeout(() => canvas.current?.fit(), 40);
  }

  function validate() {
    setChecked(true);
    setSelected(null);
    if (!errors.length) pushToast({ tone: "ok", text: "The flow is ready.", detail: issues.length ? `${issues.length} warning${issues.length === 1 ? "" : "s"} to look at.` : "No loose ends, no loops without a wait, every setting filled in." });
    else pushToast({ tone: "warn", text: `${errors.length} problem${errors.length === 1 ? "" : "s"} to fix.`, detail: "They are marked on the steps and listed on the right." });
  }

  function save(): boolean {
    if (readOnly) return false;
    const r = saveAutomation(auto.id, { name, description, flow });
    if (!r.ok) { pushToast({ tone: "warn", text: r.errors[0] }); return false; }
    if (auto.status === "active" && r.value.status === "paused") { setChecked(true); pushToast({ tone: "warn", text: "Saved and paused.", detail: "An active automation with problems is paused until they are fixed." }); }
    else pushToast({ tone: "ok", text: "Saved." });
    return true;
  }

  function activate() {
    const wasDirty = dirty;
    if (wasDirty) {
      const saved = saveAutomation(auto.id, { name, description, flow });
      if (!saved.ok) { pushToast({ tone: "warn", text: saved.errors[0] }); return; }
    }
    const r = setAutomationStatus(auto.id, "active");
    if (!r.ok) { setChecked(true); pushToast({ tone: "warn", text: `${wasDirty ? "Saved, but not activated. " : ""}Fix the problems first.`, detail: r.errors[0] }); return; }
    pushToast({ tone: "ok", text: wasDirty ? "Saved and activated." : "Activated.", detail: `It now runs on each new ${TRIGGER_BY_ID[trigger!].label} event.` });
  }

  function pause() {
    setAutomationStatus(auto.id, "paused");
    pushToast({ tone: "ok", text: "Paused.", detail: "Runs already waiting keep their place. No new runs start." });
  }

  const panel = node ? (
    <NodeSettingsPanel
      flow={flow}
      node={node}
      trigger={trigger}
      issues={issues.filter((i) => i.nodeId === node.id)}
      readOnly={readOnly}
      onPatch={(patch, key) => apply(updateNode(flow, node.id, patch), true, key)}
      onConnect={(port, to) => apply(connect(flow, node.id, port, to))}
      onRemoveEdge={(eid) => apply(removeEdge(flow, eid))}
      onDelete={() => del(node.id)}
      onClose={wide ? undefined : () => setSelected(null)}
    />
  ) : (
    <FlowPanel
      name={name} description={description} setDescription={setDescription} trigger={trigger} issues={issues} checked={checked}
      onPick={(nid) => { setSelected(nid); canvas.current?.focusNode(nid); }} readOnly={readOnly}
    />
  );

  return (
    <div className="flex h-[calc(100dvh-7rem)] min-h-[560px] flex-col gap-3">
      {/* Toolbar */}
      <div className="glass-panel flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5">
        <button type="button" className={ICON_BTN} onClick={() => navigate("/automations")} aria-label="Back to automations" title="Back to automations"><IconArrowLeft className="size-4" aria-hidden="true" /></button>
        <div className="flex min-w-[min(19rem,100%)] flex-1 items-center gap-2.5">
          <label className="sr-only" htmlFor="auto-name">Automation Name</label>
          <input
            id="auto-name" value={name} onChange={(e) => setName(e.target.value)} readOnly={readOnly}
            className="min-w-[9rem] max-w-[26rem] flex-1 truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-[1.0625rem] font-semibold tracking-tight text-[#032C26] hover:border-[rgba(20,32,28,0.12)] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground"
          />
          <Badge tone={STATUS_TONE[auto.status]}>{STATUS_LABEL[auto.status]}</Badge>
          {dirty && <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-warn" title="Unsaved changes"><span aria-hidden="true" className="size-2 rounded-full bg-warn" /><span className="sr-only 2xl:not-sr-only">Unsaved Changes</span></span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!readOnly && (
            <>
              <button type="button" className={ICON_BTN} onClick={doUndo} disabled={!undo.length} aria-label="Undo" title="Undo (Ctrl+Z)"><IconArrowBackUp className="size-4" aria-hidden="true" /></button>
              <button type="button" className={ICON_BTN} onClick={doRedo} disabled={!redo.length} aria-label="Redo" title="Redo (Ctrl+Y)"><IconArrowForwardUp className="size-4" aria-hidden="true" /></button>
              <span className="mx-1 hidden h-5 w-px bg-[rgba(20,32,28,0.12)] sm:block" aria-hidden="true" />
              <button type="button" className={cn(GLASS_BTN, "h-9 px-3 text-sm")} onClick={layout}><IconSitemap className="size-4" aria-hidden="true" /><WideLabel text="Auto Layout" /></button>
              <button type="button" className={cn(GLASS_BTN, "h-9 px-3 text-sm")} onClick={validate}>
                <IconShieldCheck className="size-4" aria-hidden="true" /><WideLabel text="Validate" />
                {checked && <span className={cn("rounded-full px-1.5 text-xs font-semibold tabular-nums", errors.length ? "bg-destructive/12 text-destructive" : "bg-ok/14 text-ok")}>{errors.length}</span>}
              </button>
            </>
          )}
          <button type="button" className={cn(GLASS_BTN, "h-9 px-3 text-sm")} onClick={startTest}><IconPlayerPlay className="size-4" aria-hidden="true" />Test Run</button>
          <button type="button" className={cn(GLASS_BTN, "h-9 px-3 text-sm")} onClick={() => navigate("/automations/history", { automation: auto.id })} title="Run History"><IconHistory className="size-4" aria-hidden="true" /><WideLabel text="Run History" at="2xl" /></button>
          {!readOnly && <Button variant="secondary" onClick={() => save()} disabled={!dirty} title="Save (Ctrl+S)"><IconDeviceFloppy className="size-4" aria-hidden="true" /><WideLabel text="Save" at="2xl" /></Button>}
          {!readOnly && (auto.status === "active"
            ? <Button variant="secondary" onClick={pause}><IconPlayerPause className="size-4" aria-hidden="true" />Pause</Button>
            : <Button variant="primary" className="bg-[#032C26] hover:brightness-125" onClick={activate}><IconCircleCheck className="size-4" aria-hidden="true" />Activate</Button>)}
        </div>
      </div>

      {phone && (
        <p className="flex items-start gap-2 rounded-xl border border-[#035D53]/20 bg-white px-3 py-2 text-[0.8125rem] text-[#035D53]">
          <IconDeviceTablet className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          On a phone the flow is view only. Open it on a tablet or a computer to change it. Test Run still works.
        </p>
      )}

      <div className={cn("grid min-h-0 flex-1 gap-3", phone ? "grid-cols-1" : wide ? "grid-cols-[13.5rem_minmax(0,1fr)_21rem]" : "grid-cols-[3.75rem_minmax(0,1fr)]")}>
        {!phone && (
          <aside className="glass-panel min-h-0 overflow-y-auto rounded-2xl p-2.5">
            <NodePalette compact={!wide} onAdd={(k) => place(k)} onDrop={(k, cx, cy) => { const w = canvas.current?.toWorld(cx, cy); if (!w) return false; place(k, w); return true; }} />
          </aside>
        )}

        <div className="relative min-h-0 overflow-hidden rounded-2xl border border-[rgba(20,32,28,0.10)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_-14px_rgba(16,24,22,0.16)]">
          <FlowCanvas
            ref={canvas}
            className="size-full"
            label={`${name}. ${flow.nodes.length} steps. Tab to move between steps, arrow keys move the selected step, Delete removes it, plus and minus zoom, 0 fits the flow.`}
            flow={flow}
            selected={selected}
            selectedEdge={selectedEdge}
            onSelect={setSelected}
            onSelectEdge={setSelectedEdge}
            onChange={(next, record) => apply(next, record)}
            onDelete={del}
            issues={marks}
            lit={lit}
            activeNode={activeStep?.nodeId}
            readOnly={readOnly}
          />
          {selectedEdge && !readOnly && (
            <div className="glass-pill absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-[0.8125rem]">
              Connection selected
              <button type="button" className="rounded-md px-2 py-0.5 font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { apply(removeEdge(flow, selectedEdge)); setSelectedEdge(null); }}>Delete</button>
            </div>
          )}
          {!wide && !phone && node && (
            <aside className="glass-panel absolute inset-y-2 right-2 z-20 flex w-[min(21rem,calc(100%-1rem))] flex-col overflow-hidden rounded-2xl" aria-label="Step settings">{panel}</aside>
          )}
          {test && playing && <TestDrawer test={test} setTest={setTest} onPick={(nid) => { setSelected(nid); canvas.current?.focusNode(nid); }} />}
        </div>

        {wide && <aside className="glass-panel flex min-h-0 flex-col overflow-hidden rounded-2xl" aria-label={node ? "Step settings" : "Flow details"}>{panel}</aside>}
      </div>
    </div>
  );
}

/** A button word shown on a wide screen; below that the button is an icon and the word is read to screen readers. */
function WideLabel({ text, at = "xl" }: { text: string; at?: "xl" | "2xl" }) {
  return at === "xl"
    ? <><span className="hidden xl:inline">{text}</span><span className="sr-only xl:hidden">{text}</span></>
    : <><span className="hidden 2xl:inline">{text}</span><span className="sr-only 2xl:hidden">{text}</span></>;
}

/* ---------- side panel when nothing is selected ---------- */

function FlowPanel({ name, description, setDescription, trigger, issues, checked, onPick, readOnly }: {
  name: string; description: string; setDescription: (v: string) => void; trigger?: string; issues: ReturnType<typeof validateFlow>; checked: boolean;
  onPick: (id: string) => void; readOnly: boolean;
}) {
  const errors = issues.filter((i) => i.level === "error");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[rgba(20,32,28,0.08)] px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">Flow</p>
        <h2 className="truncate text-[0.9375rem] font-semibold text-[#032C26] dark:text-foreground">{name || "Untitled"}</h2>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Field label="What It Does">
          <textarea value={description} readOnly={readOnly} onChange={(e) => setDescription(e.target.value)}
            className="min-h-[4.5rem] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-background" />
        </Field>
        <div className="text-[0.8125rem]">
          <p className="font-medium">Starts On</p>
          <p className="mt-0.5 text-muted-foreground">{trigger ? `${TRIGGER_BY_ID[trigger as keyof typeof TRIGGER_BY_ID].label}. ${TRIGGER_BY_ID[trigger as keyof typeof TRIGGER_BY_ID].from}` : "No trigger chosen yet."}</p>
        </div>
        <section aria-label="Problems" className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {checked ? (errors.length ? <IconAlertTriangle className="size-4 text-destructive" aria-hidden="true" /> : <IconCircleCheck className="size-4 text-ok" aria-hidden="true" />) : <IconRefresh className="size-4 text-muted-foreground" aria-hidden="true" />}
            {checked ? (errors.length ? `${errors.length} Problem${errors.length === 1 ? "" : "s"}` : "Ready To Activate") : "Not Validated Yet"}
          </h3>
          {checked ? (
            issues.length ? (
              <ul className="space-y-1.5">
                {issues.map((i, n) => (
                  <li key={n}>
                    <button type="button" disabled={!i.nodeId} onClick={() => i.nodeId && onPick(i.nodeId)}
                      className={cn("w-full rounded-lg border px-2.5 py-2 text-left text-[0.8125rem] leading-snug focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-white", i.level === "error" ? "border-destructive/25 text-destructive" : "border-[#C98A12]/30 text-warn")}>
                      {i.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[0.8125rem] text-muted-foreground">No loose ends, no loops without a wait, every setting is filled in, and every record change waits for approval.</p>
          ) : <p className="text-[0.8125rem] text-muted-foreground">Press Validate to check for loose ends, loops without a wait, missing settings and record changes without approval.</p>}
        </section>
        <section aria-label="How to build" className="space-y-1.5 border-t border-[rgba(20,32,28,0.08)] pt-4 text-[0.8125rem] text-muted-foreground">
          <h3 className="text-sm font-semibold text-foreground">Keys</h3>
          <p>Tab moves between steps. Arrow keys move the selected step, Shift moves it further.</p>
          <p>Drag from the dot under a step to connect it, or pick the next step in its settings.</p>
          <p>Delete removes the selected step or connection. Ctrl+Z undoes, Ctrl+Y redoes, Ctrl+S saves.</p>
          <p>Plus and minus zoom. 0 fits the whole flow. Drag the background to move around.</p>
        </section>
        <section aria-label="Step colours" className="space-y-1.5 border-t border-[rgba(20,32,28,0.08)] pt-4">
          <h3 className="text-sm font-semibold">Steps</h3>
          <ul className="grid grid-cols-2 gap-1.5 text-[0.8125rem]">
            {(Object.keys(KINDS) as NodeKind[]).map((k) => {
              const st = KIND_STYLE[k];
              return <li key={k} className="flex items-center gap-2"><span className="h-3.5 w-1 rounded-full" style={{ background: st.edge }} aria-hidden="true" /><st.Icon className="size-4" style={{ color: st.ink }} stroke={1.75} aria-hidden="true" />{KINDS[k].label}</li>;
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

/* ---------- test run drawer ---------- */

function TestDrawer({ test, setTest, onPick }: {
  test: { runs: Run[]; pick: number; shown: number };
  setTest: React.Dispatch<React.SetStateAction<{ runs: Run[]; pick: number; shown: number } | null>>;
  onPick: (nodeId: string) => void;
}) {
  const run = test.runs[test.pick];
  const done = test.shown >= run.steps.length;
  const listRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [test.shown]);
  return (
    <section aria-label="Test run" className="glass-panel absolute inset-x-2 bottom-2 z-30 flex max-h-[46%] flex-col overflow-hidden rounded-2xl sm:left-auto sm:w-[27rem]">
      <header className="flex items-start gap-3 border-b border-[rgba(20,32,28,0.08)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold text-[#032C26] dark:text-foreground">Test Run</h2>
          <p className="text-xs text-muted-foreground">
            {run.event.source === "sample" ? "No recent event of this kind, so a sample from today's patients." : `Replaying a real event from ${fmtTime(run.event.at)}.`} Nothing is changed.
          </p>
        </div>
        <button type="button" className={ICON_BTN} onClick={() => setTest(null)} aria-label="Close the test run"><IconX className="size-4" aria-hidden="true" /></button>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgba(20,32,28,0.08)] px-4 py-2">
        {test.runs.length > 1 && (
          <div role="group" aria-label="Event to replay" className="flex flex-wrap gap-1">
            {test.runs.map((r, i) => (
              <button key={r.id} type="button" aria-pressed={i === test.pick} onClick={() => setTest({ ...test, pick: i, shown: 1 })}
                className={cn("rounded-full border px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring", i === test.pick ? "border-[#035D53] bg-[#032C26] text-white" : "border-[rgba(20,32,28,0.12)] bg-white text-foreground hover:border-[#03C1AC]")}>
                {r.event.patient}
              </button>
            ))}
          </div>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{run.event.patient}{run.event.visit ? `, ${run.event.visit}` : ""}. {run.event.summary}.</span>
        <button type="button" className={cn(GLASS_BTN, "h-8 px-2.5 text-xs")} onClick={() => setTest({ ...test, shown: done ? 1 : run.steps.length })}>
          {done ? <><IconRefresh className="size-3.5" aria-hidden="true" />Replay</> : "Show All Steps"}
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2" aria-live="polite">
        <RunLog run={run} shown={test.shown} activeIndex={test.shown - 1} onPick={(s) => onPick(s.nodeId)} />
      </div>
    </section>
  );
}
