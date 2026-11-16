import * as React from "react";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { IconArrowsExchange, IconFileDollar, IconFileInvoice, IconLayoutDashboard, IconUser, IconUserShield } from "@tabler/icons-react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Copy, List, MonitorX, Pencil, Pin, PinOff, ShieldAlert, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { invoiceOf, useInvoices } from "@/lib/invoice";
import { NAV } from "@/lib/nav";
import { caseOf, useFinancial } from "@/lib/nphies-financial";
import { RouteProvider, routeOf } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { getState, patientName, useHis } from "@/lib/store";
import { patientMarker, type PatientMarker } from "@/lib/patient-marker";
import { answerPatientCheck, notePatientActivity, usePatientCheck } from "@/lib/wrong-patient";
import { switchToOther, useItHere, type BlockReason } from "@/lib/single-session";
import {
  activeTab, canDuplicate, CHART_LIMIT, chartsOldestFirst, getTabs, kindOf, loadTabs, requestNewTab, splitRoute, syncRoute, tabActions, tabsUser, useTabs,
  type WorkspaceTab,
} from "@/lib/workspace-tabs";

/**
 * Workspace tabs under the top bar (Epic style). See src/lib/workspace-tabs.ts for the rules.
 * - useWorkspace(): keeps the tabs and the address in step, loads each user's tabs, and adds the keyboard shortcuts.
 * - <WorkspaceTabs />: the tab strip.
 * - <TabPanels render={...} />: the pages. Recently used tabs stay mounted (hidden), so a list keeps its filters and
 *   a form keeps what was typed; each page reads its own tab's route.
 */

const KEEP_MOUNTED = 6;

/* ---------- titles and icons ---------- */

const LABEL_BY_PATH = new Map<string, { label: string; icon: React.ElementType }>();
for (const g of NAV) for (const p of g.pages) if (!LABEL_BY_PATH.has(p.path)) LABEL_BY_PATH.set(p.path, { label: p.label === "Worklist" ? `${g.label} Worklist` : p.label, icon: g.icon });
const EXTRA_LABELS: Record<string, string> = {
  "/automations/builder": "Automation Builder", "/rule-engine/upload": "Rule Upload", "/patients": "Patients",
};
const words = (path: string) => path.split("/").filter(Boolean).pop()?.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Dashboard";

export interface TabLook { title: string; icon: React.ElementType; masked?: boolean; marker?: PatientMarker; mrn?: string }

export function useTabLook(tab: WorkspaceTab): TabLook {
  const his = useHis();
  useSession();
  useInvoices();
  useFinancial();
  const { path, params } = splitRoute(tab.route);
  const kind = kindOf(tab.route);
  const auto = ((): TabLook => {
    const visit = params.get("visit") ?? "";
    if (kind === "chart") {
      const enc = his.encounters.find((e) => e.visitNumber === visit);
      const p = enc && his.patients.find((x) => x.id === enc.patientId);
      if (!p) return { title: `Chart ${visit}`, icon: IconUser };
      if (p.confidential && !hasGlass(p.id)) return { title: "Confidential patient", icon: IconUserShield, masked: true, marker: patientMarker(p, true), mrn: p.mrn };
      return { title: patientName(p), icon: IconUser, marker: patientMarker(p, false), mrn: p.mrn };
    }
    if (kind === "claim") return { title: `Claim ${caseOf(visit).claim?.claimNumber ?? visit}`, icon: IconFileDollar };
    if (kind === "invoice") {
      const inv = invoiceOf(visit);
      return { title: inv ? `Invoice ${inv.number}` : `Invoice ${visit}`, icon: IconFileInvoice };
    }
    if (kind === "transaction") return { title: `Transaction ${params.get("id") ?? ""}`.trim(), icon: IconArrowsExchange };
    const nav = LABEL_BY_PATH.get(path);
    return { title: nav?.label ?? EXTRA_LABELS[path] ?? words(path), icon: nav?.icon ?? IconLayoutDashboard };
  })();
  // A typed name never replaces the masking of a confidential chart.
  return tab.title && !auto.masked ? { ...auto, title: tab.title } : auto;
}

/* ---------- keeping the address, the user and the tabs in step ---------- */

const currentHash = () => (typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, ""));
const showRoute = (route: string) => {
  if (currentHash() !== route) window.location.replace(`#${route}`);
};

export function useWorkspace(): void {
  const { user } = useSession();
  // First load: before the first paint (nothing listens yet), opening the address the page was loaded with.
  if (!tabsUser() && typeof window !== "undefined") {
    const hash = currentHash();
    loadTabs(user.id, hash || "/dashboard");
    if (hash) syncRoute(hash);
  }
  // A user switch: the new user gets their own saved tabs, or a dashboard. Never the page the last user had open.
  React.useLayoutEffect(() => {
    if (tabsUser() && tabsUser() !== user.id) loadTabs(user.id, "/dashboard");
  }, [user.id]);
  const s = useTabs();
  const active = activeTab(s);

  React.useEffect(() => {
    showRoute(active.route);
  }, [active.id, active.route]);

  React.useEffect(() => {
    const onHash = () => {
      const r = currentHash();
      if (!r) return showRoute(activeTab(getTabs()).route);
      // When a chart has to wait for the close-a-chart dialog, the address goes back to the tab still showing.
      const want = syncRoute(r);
      if (want !== r) showRoute(want);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Wrong-patient check: record which patient the user is working on (the chart tab shown, and clicks and keys in it).
  React.useEffect(() => {
    const pid = chartPatientId(active.route);
    if (pid) notePatientActivity(pid);
    const onUse = () => {
      const id = chartPatientId(activeTab(getTabs()).route);
      if (id) notePatientActivity(id);
    };
    const panel = document.getElementById("workspace-panel");
    panel?.addEventListener("pointerdown", onUse, true);
    panel?.addEventListener("keydown", onUse, true);
    return () => { panel?.removeEventListener("pointerdown", onUse, true); panel?.removeEventListener("keydown", onUse, true); };
  }, [active.route]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const id = activeTab(getTabs()).id;
      // Browsers keep Ctrl+W, Ctrl+Tab and Ctrl+1..9 for themselves outside full screen, so Alt versions work too.
      if ((mod && k.toLowerCase() === "w") || (e.altKey && k.toLowerCase() === "w")) { e.preventDefault(); tabActions.close(id); return; }
      if (mod && k === "Tab") { e.preventDefault(); tabActions.cycle(e.shiftKey ? -1 : 1); return; }
      if (e.altKey && (k === "PageDown" || k === "PageUp")) { e.preventDefault(); tabActions.cycle(k === "PageDown" ? 1 : -1); return; }
      if ((mod || e.altKey) && !e.shiftKey && /^[1-9]$/.test(k)) { e.preventDefault(); tabActions.jump(Number(k)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** The patient of a chart route, or "" for any other page. */
function chartPatientId(route: string): string {
  if (kindOf(route) !== "chart") return "";
  const visit = splitRoute(route).params.get("visit");
  return getState().encounters.find((e) => e.visitNumber === visit)?.patientId ?? "";
}

/** For links and menus: a Ctrl+click or a middle click opens the target in a new tab. Call before navigating. */
export function wantsNewTab(e: { ctrlKey?: boolean; metaKey?: boolean; button?: number }): boolean {
  const yes = !!(e.ctrlKey || e.metaKey || e.button === 1);
  if (yes) requestNewTab();
  return yes;
}

/* ---------- the pages ---------- */

function Panel({ route, hidden, render }: { route: string; hidden: boolean; render: () => React.ReactNode }) {
  const value = React.useMemo(() => routeOf(route), [route]);
  return (
    <div hidden={hidden} className={hidden ? undefined : "contents"}>
      <RouteProvider value={value}>{render()}</RouteProvider>
    </div>
  );
}

export function TabPanels({ render, scroller }: { render: () => React.ReactNode; scroller: React.RefObject<HTMLElement | null> }) {
  const s = useTabs();
  const active = activeTab(s);
  const recent = React.useRef<string[]>([]);
  recent.current = [active.id, ...recent.current.filter((id) => id !== active.id && s.tabs.some((t) => t.id === id))].slice(0, KEEP_MOUNTED);

  // Remember where each tab was scrolled, and put it back when the tab is shown again.
  React.useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => tabActions.scroll(active.id, el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); el.removeEventListener("scroll", onScroll); };
  }, [active.id, scroller]);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = active.scroll;
    // Only when the tab changes; scrolling inside a tab must not jump back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id]);

  return (
    <>
      {s.tabs.filter((t) => recent.current.includes(t.id)).map((t) => (
        <Panel key={t.id} route={t.route} hidden={t.id !== active.id} render={render} />
      ))}
    </>
  );
}

/* ---------- the strip ---------- */

function TabMenuItems({ tab, onRename }: { tab: WorkspaceTab; onRename: () => void }) {
  return (
    <>
      <DropdownMenuItem onSelect={onRename}><Pencil className="size-4" aria-hidden="true" />Rename</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => tabActions.togglePin(tab.id)}>
        {tab.pinned ? <><PinOff className="size-4" aria-hidden="true" />Unpin</> : <><Pin className="size-4" aria-hidden="true" />Pin</>}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canDuplicate(getTabs(), tab.id)} onSelect={() => tabActions.duplicate(tab.id)}>
        <Copy className="size-4" aria-hidden="true" />Duplicate{!canDuplicate(getTabs(), tab.id) && <span className="ms-auto text-xs">{CHART_LIMIT} charts open</span>}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => tabActions.close(tab.id)}><X className="size-4" aria-hidden="true" />Close<span className="ms-auto text-xs text-muted-foreground">Alt+W</span></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => tabActions.closeOthers(tab.id)}>Close Others</DropdownMenuItem>
    </>
  );
}

function Tab({ tab, index, active, focusId, setFocusId, onKeyNav }: {
  tab: WorkspaceTab; index: number; active: boolean; focusId: string; setFocusId: (id: string) => void;
  onKeyNav: (e: React.KeyboardEvent, id: string) => void;
}) {
  const look = useTabLook(tab);
  const Icon = look.icon;
  const [renaming, setRenaming] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const drag = useDraggable({ id: tab.id });
  const drop = useDroppable({ id: tab.id });
  const ref = React.useCallback((el: HTMLDivElement | null) => { drag.setNodeRef(el); drop.setNodeRef(el); }, [drag, drop]);
  const style = drag.transform ? { transform: `translate3d(${drag.transform.x}px,0,0)`, zIndex: 20 } : undefined;
  const shortcut = index < 8 ? ` (Alt+${index + 1})` : "";

  return (
    <div
      ref={ref}
      style={style}
      role="presentation"
      data-active={active || undefined}
      onContextMenu={(e) => { e.preventDefault(); setMenu(true); }}
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); tabActions.close(tab.id); } }}
      onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
      className={cn(
        "group relative flex h-9 min-w-[7.5rem] max-w-[13rem] shrink-0 items-center gap-1 rounded-t-lg border border-b-0 ps-2.5 pe-1 text-[0.8125rem] transition-colors",
        active
          ? "border-[color:var(--border)] bg-white text-[#032C26] shadow-[0_-1px_0_#39EDD5_inset,0_2px_0_#39EDD5_inset] dark:bg-card dark:text-foreground"
          : "border-transparent text-muted-foreground hover:bg-white/70 hover:text-foreground dark:hover:bg-card/60",
        drop.isOver && !active && "bg-white/80",
        drag.isDragging && "opacity-80 shadow-md",
      )}
    >
      {renaming ? (
        <input
          autoFocus
          defaultValue={tab.title ?? look.title}
          aria-label="Tab name"
          className="h-6 min-w-0 flex-1 rounded border border-input bg-white px-1.5 text-[0.8125rem] text-[#032C26] focus-visible:outline-2 focus-visible:outline-ring"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { tabActions.rename(tab.id, e.currentTarget.value); setRenaming(false); }
            if (e.key === "Escape") setRenaming(false);
            e.stopPropagation();
          }}
          onBlur={(e) => { tabActions.rename(tab.id, e.currentTarget.value); setRenaming(false); }}
        />
      ) : (
        <button
          type="button"
          role="tab"
          id={`wtab-${tab.id}`}
          aria-selected={active}
          aria-controls="workspace-panel"
          tabIndex={focusId === tab.id ? 0 : -1}
          title={`${look.title}${tab.pinned ? ", pinned" : ""}${shortcut}. Double-click to rename.`}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => tabActions.focus(tab.id)}
          onDoubleClick={() => setRenaming(true)}
          onFocus={() => setFocusId(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "F2") { e.preventDefault(); setRenaming(true); return; }
            if (e.key === "Delete") { e.preventDefault(); tabActions.close(tab.id); return; }
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); setMenu(true); return; }
            onKeyNav(e, tab.id);
          }}
          {...drag.listeners}
        >
          {tab.pinned && <Pin className="size-3 shrink-0 text-[#032C26]/60 dark:text-foreground/60" aria-hidden="true" />}
          {look.marker ? <Marker m={look.marker} /> : <Icon className={cn("size-4 shrink-0", active ? "text-[#032C26] dark:text-foreground" : "")} stroke={1.75} aria-hidden="true" />}
          <span className={cn("truncate", active && "font-medium")}>{look.title}</span>
        </button>
      )}
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger
          tabIndex={-1}
          aria-label={`Options for ${look.title}`}
          className={cn("flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            active || menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
        >
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <TabMenuItems tab={tab} onRename={() => setTimeout(() => setRenaming(true), 0)} />
        </DropdownMenuContent>
      </DropdownMenu>
      {!tab.pinned && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${look.title}`}
          title="Close (Alt+W, or middle click)"
          onClick={(e) => { e.stopPropagation(); tabActions.close(tab.id); }}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function ListMenuRow({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const look = useTabLook(tab);
  const Icon = look.icon;
  return (
    <DropdownMenuItem onSelect={() => tabActions.focus(tab.id)}>
      <Icon className="size-4" stroke={1.75} aria-hidden="true" />
      <span className={cn("truncate", active && "font-semibold")}>{look.title}</span>
      {tab.pinned && <Pin className="ms-auto size-3 text-muted-foreground" aria-hidden="true" />}
    </DropdownMenuItem>
  );
}

export function WorkspaceTabs() {
  const s = useTabs();
  const active = activeTab(s);
  const [focusId, setFocusId] = React.useState(active.id);
  const strip = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  React.useEffect(() => setFocusId(active.id), [active.id]);

  const measure = React.useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);
  React.useEffect(() => {
    measure();
    const el = strip.current;
    el?.querySelector(`[data-active]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const ro = new ResizeObserver(measure);
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [measure, s.tabs.length, active.id]);

  const keyNav = (e: React.KeyboardEvent, id: string) => {
    const i = s.tabs.findIndex((t) => t.id === id);
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % s.tabs.length;
    if (e.key === "ArrowLeft") to = (i - 1 + s.tabs.length) % s.tabs.length;
    if (e.key === "Home") to = 0;
    if (e.key === "End") to = s.tabs.length - 1;
    if (to < 0) return;
    e.preventDefault();
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      tabActions.move(id, s.tabs[to].id);
      requestAnimationFrame(() => document.getElementById(`wtab-${id}`)?.focus());
      return;
    }
    setFocusId(s.tabs[to].id);
    document.getElementById(`wtab-${s.tabs[to].id}`)?.focus();
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) tabActions.move(String(e.active.id), String(e.over.id));
  };
  const nudge = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * 240, behavior: "smooth" });

  return (
    <div className="flex h-[2.375rem] items-end gap-1 border-b border-border bg-white/45 px-2 backdrop-blur-sm dark:bg-card/30 sm:px-4">
      {edges.left && (
        <button type="button" onClick={() => nudge(-1)} aria-label="Scroll tabs left" className="mb-1.5 hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white sm:flex">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div
          ref={strip}
          role="tablist"
          aria-label="Open pages"
          onScroll={measure}
          className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {s.tabs.map((t, i) => (
            <Tab key={t.id} tab={t} index={i} active={t.id === active.id} focusId={focusId} setFocusId={setFocusId} onKeyNav={keyNav} />
          ))}
        </div>
      </DndContext>
      {edges.right && (
        <button type="button" onClick={() => nudge(1)} aria-label="Scroll tabs right" className="mb-1.5 hidden size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-white sm:flex">
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`All open tabs, ${s.tabs.length}`} title="All open tabs" className="mb-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-white hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-card">
          <List className="size-4" aria-hidden="true" /><span className="tabular-nums">{s.tabs.length}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
          <DropdownMenuLabel>Open Tabs</DropdownMenuLabel>
          {s.tabs.map((t) => <ListMenuRow key={t.id} tab={t} active={t.id === active.id} />)}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => tabActions.closeOthers(active.id)}>Close Others</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tabActions.closeAll()}>Close All</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); tabActions.setNewTabOnClick(!s.newTabOnClick); }} aria-checked={s.newTabOnClick} role="menuitemcheckbox">
            <span className="flex size-4 items-center justify-center">{s.newTabOnClick && <Check className="size-4" aria-hidden="true" />}</span>
            Open Pages In New Tabs
          </DropdownMenuItem>
          <p className="px-2 pb-1.5 pt-0.5 text-xs text-muted-foreground">Off: a page replaces the current tab unless it is pinned. Ctrl+click or middle click always opens a new tab.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* ---------- patient safety: markers, the chart limit, the wrong-patient check ---------- */

/** The patient's colour and initials. A confidential patient shows a neutral marker with a shield. */
export function Marker({ m, size = "sm" }: { m: PatientMarker; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none ring-1 ring-black/10",
        size === "sm" ? "size-[1.125rem] text-[0.625rem]" : "size-7 text-xs")}
      style={{ background: m.bg, color: m.fg }}
    >
      {m.masked ? <ShieldAlert className={size === "sm" ? "size-3" : "size-4"} /> : m.initials}
    </span>
  );
}

/** A thin band in the active patient's colour across the top of the chart, matching the marker on its tab. */
export function PatientBand() {
  const s = useTabs();
  const look = useTabLook(activeTab(s));
  if (!look.marker) return null;
  return (
    <div className="-mt-2 mb-3 flex items-center gap-2" data-patient-band="">
      <div className="h-1.5 flex-1 rounded-full shadow-[inset_0_0_0_1px_rgba(3,44,38,0.3)]" style={{ background: look.marker.bg }} aria-hidden="true" />
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Marker m={look.marker} />
        <span>{look.title}{look.mrn ? `, MRN ${look.mrn}` : ""}</span>
      </span>
    </div>
  );
}

function ChartRow({ tab, onPick }: { tab: WorkspaceTab; onPick: () => void }) {
  const look = useTabLook(tab);
  const opened = new Date(tab.openedAt);
  return (
    <li>
      <button type="button" onClick={onPick} className="flex w-full items-center gap-3 rounded-lg border border-border bg-white px-3 py-2 text-left hover:border-[#39EDD5] hover:bg-[#f2fbf8] focus-visible:outline-2 focus-visible:outline-ring dark:bg-card">
        {look.marker && <Marker m={look.marker} size="md" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{look.title}</span>
          <span className="block text-xs text-muted-foreground">{look.mrn ? `MRN ${look.mrn}, ` : ""}opened {String(opened.getHours()).padStart(2, "0")}:{String(opened.getMinutes()).padStart(2, "0")}</span>
        </span>
        <span className="shrink-0 text-xs font-medium text-[#016b5f] dark:text-primary">Close This Chart</span>
      </button>
    </li>
  );
}

/** Opening one chart more than CHART_LIMIT asks which open chart to close. Nothing closes without the user's choice. */
export function ChartLimitDialog() {
  const s = useTabs();
  const pending = s.pendingChart;
  const waiting = useTabLook({ id: "pending", route: pending ?? "/dashboard", pinned: false, openedAt: 0, usedAt: 0, scroll: 0 });
  return (
    <Dialog open={!!pending} onOpenChange={(o) => { if (!o) tabActions.cancelChart(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>{CHART_LIMIT} Patient Charts Are Open</DialogTitle>
        <DialogDescription>
          To open {waiting.title}, close one of these charts first. Keeping few charts open helps avoid working on the wrong patient.
        </DialogDescription>
        <ul className="mt-1 space-y-2">
          {chartsOldestFirst(s).map((t) => <ChartRow key={t.id} tab={t} onPick={() => tabActions.resolveChart(t.id)} />)}
        </ul>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => tabActions.cancelChart()}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const nameFor = (id: string) => {
  const p = getState().patients.find((x) => x.id === id);
  if (!p) return { name: "this patient", mrn: "", marker: undefined as PatientMarker | undefined };
  const masked = !!p.confidential && !hasGlass(p.id);
  return { name: masked ? "Confidential patient" : patientName(p), mrn: p.mrn, marker: patientMarker(p, masked) };
};

/** The wrong-patient question raised by confirmPatient(). */
export function PatientCheckDialog() {
  const check = usePatientCheck();
  useHis();
  if (!check) return null;
  const target = nameFor(check.patientId);
  const other = nameFor(check.otherId);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) answerPatientCheck(false); }}>
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogTitle className="flex items-center gap-2">{target.marker && <Marker m={target.marker} size="md" />}Check The Patient</DialogTitle>
        <DialogDescription className="text-sm text-foreground">
          You are about to sign for <strong>{target.name}</strong>{target.mrn ? <>, MRN <span className="font-mono">{target.mrn}</span></> : null}.
          You were just working on <strong>{other.name}</strong>. Continue?
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => answerPatientCheck(false)}>Cancel</Button>
          <Button variant="primary" autoFocus onClick={() => answerPatientCheck(true)}>Continue For {target.name}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- one copy per browser ---------- */

/** Shown instead of the app when Onasi HIS is active in another tab or window of this browser. */
export function SessionNotice({ reason }: { reason: BlockReason | null }) {
  const [asked, setAsked] = React.useState(false);
  const text = reason === "taken-over"
    ? "Onasi HIS is now in use in another tab. This tab has stopped so the two cannot overwrite each other."
    : reason === "other-closed"
      ? "The other Onasi HIS tab was closed. You can use it here now."
      : "Using two copies at once can mix up patients and overwrite saved work, so only one copy can be used at a time.";
  return (
    <div className="flex min-h-full items-center justify-center bg-background p-4">
      <div role="alertdialog" aria-labelledby="session-title" aria-describedby="session-text" className="w-full max-w-md rounded-2xl border border-[color:var(--glass-border)] bg-white/90 p-6 shadow-[var(--glass-shadow)] backdrop-blur dark:bg-card">
        <img src="/brand/onasi-logo.png" alt="Onasi" className="mb-4 h-8 w-auto" />
        <div className="flex items-start gap-3">
          <MonitorX className="mt-0.5 size-6 shrink-0 text-[#016b5f] dark:text-primary" aria-hidden="true" />
          <div>
            <h1 id="session-title" className="text-lg font-semibold">{reason === "other-closed" ? "The Other Tab Was Closed" : "Onasi HIS Is Already Open In Another Tab"}</h1>
            <p id="session-text" className="mt-1 text-sm text-muted-foreground">{text}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {reason !== "other-closed" && <Button onClick={() => { switchToOther(); setAsked(true); }}>Switch To That Tab</Button>}
          <Button variant="primary" onClick={useItHere}>Use It Here Instead</Button>
        </div>
        {asked && <p className="mt-3 text-xs text-muted-foreground">If your browser did not switch, click the other Onasi HIS tab in the browser's tab bar. Browsers do not always let a page bring another tab to the front.</p>}
      </div>
    </div>
  );
}
