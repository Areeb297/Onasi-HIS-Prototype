import * as React from "react";
import { ChevronDown, Columns2 } from "lucide-react";
import { ChartMenu } from "@/components/ChartMenu";
import { Select, cn } from "@/components/ui/primitives";
import { consultsOf, unbookedFollowUps, useCareRequests } from "@/lib/care-requests";
import { EMR_FORM_BY_ID, fitsSex } from "@/lib/emr-forms";
import { EMR_TABS, type EmrTab, type TabId } from "@/lib/emr-menu";
import { ageYears, fitsAge } from "@/lib/flowsheet";
import { useLab } from "@/lib/lab";
import { buildLabGrid, historyOrders } from "@/lib/lab-grid";
import type { Encounter, Patient } from "@/lib/model";
import { useRad } from "@/lib/radiology";
import { getFormRecords, useRecords } from "@/lib/records";
import { useHis } from "@/lib/store";
import { paneOf, type Pane, type Split } from "./split";

/**
 * The chart's module tabs, as in Epic: one row of tabs over the full-width chart, and under a tab that holds several
 * sections a lighter row of sub-tabs, so every section is at most two clicks away. Orders shows how many orders are
 * still open; Results shows a red dot when this visit's newest result of any test is abnormal. The specialty and
 * general forms sit under More, grouped, with a search box. Left and Right move between tabs, Enter or Space opens one.
 * On a phone the tab row scrolls sideways and the sub-tabs become a select.
 *
 * Two sections can be shown side by side: Ctrl+click or Shift+click a second tab, or right-click it and choose
 * Open Side By Side. Both tabs then show as open, the second with a split mark, and each pane carries its own sub-tabs.
 */

export const CHART_PANEL_ID = "chart-tabpanel";
export const chartTabDomId = (id: TabId) => `chart-tab-${id}`;

const TAB =
  "relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const ON = "bg-[var(--glass-solid)] font-semibold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#39EDD5]";
const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-45";
const OFF = "text-muted-foreground hover:bg-[var(--glass-solid)]/60 hover:text-foreground";

/** Arrow keys move focus along a row of tabs; Home and End jump to the ends. Opening stays with Enter, Space or a click. */
function onArrows(e: React.KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!step && e.key !== "Home" && e.key !== "End") return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  e.preventDefault();
  tabs[e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + step! + tabs.length) % tabs.length].focus();
}

/** Forms made for the other sex or age group are hidden, unless one already has records or is an open section. */
export function useFits(enc: Encounter, patient: Patient, open: string[]): (id: string) => boolean {
  useRecords();
  return (id) => {
    const form = EMR_FORM_BY_ID[id];
    return open.includes(id) || (fitsAge(form, ageYears(patient.dob)) && fitsSex(form, patient.sex)) || getFormRecords(enc.visitNumber, id).length > 0;
  };
}

/** The sections of one tab: a row of sub-tabs, or a select on a phone. Nothing when the tab has a single section. */
export function SubTabs({ tab, section, visit, fits, onPick, className }: { tab: EmrTab; section: string; visit: string; fits: (id: string) => boolean; onPick: (section: string) => void; className?: string }) {
  const subs = tab.items.filter((i) => fits(i.id));
  if (subs.length < 2) return null;
  return (
    <div className={className}>
      <div role="tablist" aria-label={`${tab.label} sections`} onKeyDown={onArrows} className="hidden flex-wrap gap-1 sm:flex">
        {subs.map((i) => {
          const on = i.id === section;
          const count = EMR_FORM_BY_ID[i.id] ? getFormRecords(visit, i.id).length : 0;
          return (
            <button
              key={i.id} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onPick(i.id)}
              className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.8125rem] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                on ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {i.label}
              {count > 0 && <span className="rounded bg-admit/15 px-1.5 text-xs font-medium text-admit">{count}</span>}
            </button>
          );
        })}
      </div>
      <Select className="sm:hidden" aria-label={`${tab.label} sections`} value={section} onChange={(e) => onPick(e.target.value)}>
        {subs.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
      </Select>
    </div>
  );
}

export function ChartTabs({ enc, patient, split, canSplit, onPick, onBeside }: {
  enc: Encounter; patient: Patient; split: Split;
  /** False on a phone: one pane only. */
  canSplit: boolean;
  /** Open in the pane the user is working in. */
  onPick: (pane: Pane) => void;
  /** Open beside the first pane. */
  onBeside: (pane: Pane) => void;
}) {
  const tab = EMR_TABS.find((t) => t.id === split.left.tab)!;
  const section = split.left.section;
  const second = split.right;
  const [menu, setMenu] = React.useState<{ tab: TabId; x: number; y: number } | null>(null);
  useCareRequests();
  const lab = useLab();
  const rad = useRad();
  const his = useHis();
  const [moreOpen, setMoreOpen] = React.useState(false);
  const more = React.useRef<HTMLDivElement>(null);
  const strip = React.useRef<HTMLDivElement>(null);
  const visit = enc.visitNumber;

  // On a phone the tab row scrolls sideways: bring the open tab into view, without moving the page.
  React.useEffect(() => {
    const on = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (strip.current && on) strip.current.scrollLeft = on.offsetLeft - strip.current.offsetLeft - 24;
  }, [tab.id]);

  React.useEffect(() => {
    if (!moreOpen && !menu) return;
    const away = (e: MouseEvent) => {
      if (!more.current?.contains(e.target as Node)) setMoreOpen(false);
      if (!(e.target as HTMLElement).closest?.("[data-tab-menu]")) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setMoreOpen(false); setMenu(null); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [moreOpen, menu]);

  const fits = useFits(enc, patient, [section, ...(second ? [second.section] : [])]);
  /** The pane a tab opens: its section that is already open, else its first section that fits the patient. */
  const paneFor = (t: EmrTab): Pane =>
    [split.left, second].find((p) => p?.tab === t.id) ?? paneOf(t.items.find((i) => fits(i.id))!.id, t.id)!;

  const openOrders =
    lab.orders.filter((o) => o.visitNumber === visit && (o.status === "received" || o.status === "collected" || o.status === "in-progress")).length +
    rad.orders.filter((o) => o.visitNumber === visit && (o.status === "received" || o.status === "performed")).length +
    consultsOf(visit).filter((c) => c.status === "requested" || c.status === "accepted").length +
    unbookedFollowUps(visit).length;
  const abnormal = React.useMemo(
    () => buildLabGrid([...lab.orders, ...historyOrders(his.patients, his.encounters)], patient.id).rows.some((r) => r.latest.abnormal && r.latest.visitNumber === visit),
    [lab.orders, his.patients, his.encounters, patient.id, visit],
  );

  const moreTab = EMR_TABS.find((t) => t.id === "more")!;
  const moreIds = new Set(moreTab.items.map((i) => i.id).filter(fits));
  const morePane = [split.left, second].find((p) => p?.tab === "more");
  const activeLabel = moreTab.items.find((i) => i.id === morePane?.section)?.label;
  const menuTab = menu && EMR_TABS.find((t) => t.id === menu.tab);

  return (
    <div className="glass-card mt-3 rounded-2xl">
      <div className="flex items-end">
        <div ref={strip} role="tablist" aria-label="Chart modules" onKeyDown={onArrows} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1.5 pt-1.5 [scrollbar-width:none]">
          {EMR_TABS.filter((t) => t.id !== "more").map((t) => {
            const beside = second?.tab === t.id;
            const on = t.id === tab.id || beside;
            return (
              <button
                key={t.id} id={chartTabDomId(t.id)} type="button" role="tab" aria-selected={on} tabIndex={t.id === tab.id ? 0 : -1}
                title={canSplit ? "Ctrl+click or right-click to open side by side" : undefined}
                onClick={(e) => ((e.ctrlKey || e.metaKey || e.shiftKey) && canSplit ? onBeside(paneFor(t)) : onPick(paneFor(t)))}
                onContextMenu={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setMenu({ tab: t.id, x: e.clientX || r.left, y: e.clientY || r.bottom }); }}
                className={cn(TAB, on ? ON : OFF)}
              >
                {t.label}
                {beside && <Columns2 className="size-3.5 text-move" role="img" aria-label="Open in the second pane" />}
                {t.id === "orders" && openOrders > 0 && (
                  <span className="rounded-full bg-warn/16 px-1.5 text-xs font-semibold tabular-nums text-warn" aria-label={`${openOrders} open`}>{openOrders}</span>
                )}
                {t.id === "results" && abnormal && <span className="size-1.5 rounded-full bg-destructive" role="img" aria-label="Abnormal result in this visit" />}
              </button>
            );
          })}
        </div>
        <div ref={more} className="shrink-0 px-1.5 pt-1.5 sm:relative">
          <button
            id={chartTabDomId("more")} type="button" aria-haspopup="true" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}
            className={cn(TAB, morePane ? ON : OFF)}
          >
            <span className="max-w-40 truncate">{activeLabel ?? "More"}</span>
            <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {moreOpen && (
            <div className="absolute inset-x-2 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-[var(--glass-solid)] shadow-xl sm:inset-x-auto sm:right-1.5 sm:w-[min(46rem,calc(100vw-22rem))]">
              <ChartMenu ids={moreIds} active={morePane?.section ?? ""} visit={visit} onPick={(id) => { setMoreOpen(false); onPick({ section: id, tab: "more" }); }} />
            </div>
          )}
        </div>
      </div>

      {!second && tab.id !== "more" && (
        <SubTabs className="border-t border-border bg-[var(--glass-solid)] px-2 py-1.5 empty:hidden" tab={tab} section={section} visit={visit} fits={fits} onPick={(id) => onPick({ section: id, tab: tab.id })} />
      )}

      {menu && menuTab && (
        <div data-tab-menu role="menu" aria-label={`${menuTab.label} tab`} style={{ left: Math.min(menu.x, window.innerWidth - 240), top: menu.y + 4 }}
          className="fixed z-40 w-56 rounded-lg border border-border bg-[var(--glass-solid)] p-1 text-sm shadow-xl">
          <button type="button" role="menuitem" autoFocus className={MENU_ITEM} onClick={() => { setMenu(null); onPick(paneFor(menuTab)); }}>Open</button>
          <button type="button" role="menuitem" disabled={!canSplit} className={MENU_ITEM} onClick={() => { setMenu(null); onBeside(paneFor(menuTab)); }}>
            <Columns2 className="size-4" aria-hidden="true" /> Open Side By Side
          </button>
          {!canSplit && <p className="px-2.5 py-1.5 text-xs text-muted-foreground">Side by side needs a wider screen.</p>}
        </div>
      )}
    </div>
  );
}
