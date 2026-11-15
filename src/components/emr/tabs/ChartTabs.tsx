import * as React from "react";
import { ChevronDown } from "lucide-react";
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

/**
 * The chart's module tabs, as in Epic: one row of tabs over the full-width chart, and under a tab that holds several
 * sections a lighter row of sub-tabs, so every section is at most two clicks away. Orders shows how many orders are
 * still open; Results shows a red dot when this visit's newest result of any test is abnormal. The specialty and
 * general forms sit under More, grouped, with a search box. Left and Right move between tabs, Enter or Space opens one.
 * On a phone the tab row scrolls sideways and the sub-tabs become a select.
 */

export const CHART_PANEL_ID = "chart-tabpanel";
export const chartTabDomId = (id: TabId) => `chart-tab-${id}`;

const TAB =
  "relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors " +
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const ON = "bg-[var(--glass-solid)] font-semibold text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#39EDD5]";
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

export function ChartTabs({ enc, patient, tab, section, onPick }: {
  enc: Encounter; patient: Patient; tab: EmrTab; section: string; onPick: (section: string, tab: TabId) => void;
}) {
  useRecords();
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
    if (!moreOpen) return;
    const away = (e: MouseEvent) => { if (!more.current?.contains(e.target as Node)) setMoreOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [moreOpen]);

  // Forms made for the other sex or age group are hidden, unless one already has records or is the open section.
  const fits = (id: string) => {
    const form = EMR_FORM_BY_ID[id];
    return id === section || (fitsAge(form, ageYears(patient.dob)) && fitsSex(form, patient.sex)) || getFormRecords(visit, id).length > 0;
  };

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
  const subs = tab.id === "more" ? [] : tab.items.filter((i) => fits(i.id));
  const activeLabel = tab.items.find((i) => i.id === section)?.label;

  return (
    <div className="glass-card mt-3 rounded-2xl">
      <div className="flex items-end">
        <div ref={strip} role="tablist" aria-label="Chart modules" onKeyDown={onArrows} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1.5 pt-1.5 [scrollbar-width:none]">
          {EMR_TABS.filter((t) => t.id !== "more").map((t) => {
            const on = t.id === tab.id;
            return (
              <button
                key={t.id} id={chartTabDomId(t.id)} type="button" role="tab" aria-selected={on} aria-controls={CHART_PANEL_ID} tabIndex={on ? 0 : -1}
                onClick={() => onPick(t.items.find((i) => fits(i.id))!.id, t.id)} className={cn(TAB, on ? ON : OFF)}
              >
                {t.label}
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
            className={cn(TAB, tab.id === "more" ? ON : OFF)}
          >
            <span className="max-w-40 truncate">{tab.id === "more" && activeLabel ? activeLabel : "More"}</span>
            <ChevronDown className={cn("size-4 transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
          </button>
          {moreOpen && (
            <div className="absolute inset-x-2 z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-[var(--glass-solid)] shadow-xl sm:inset-x-auto sm:right-1.5 sm:w-[min(46rem,calc(100vw-22rem))]">
              <ChartMenu ids={moreIds} active={section} visit={visit} onPick={(id) => { setMoreOpen(false); onPick(id, "more"); }} />
            </div>
          )}
        </div>
      </div>

      {subs.length > 1 && (
        <div className="border-t border-border bg-[var(--glass-solid)] px-2 py-1.5">
          <div role="tablist" aria-label={`${tab.label} sections`} onKeyDown={onArrows} className="hidden flex-wrap gap-1 sm:flex">
            {subs.map((i) => {
              const on = i.id === section;
              const count = EMR_FORM_BY_ID[i.id] ? getFormRecords(visit, i.id).length : 0;
              return (
                <button
                  key={i.id} type="button" role="tab" aria-selected={on} aria-controls={CHART_PANEL_ID} tabIndex={on ? 0 : -1} onClick={() => onPick(i.id, tab.id)}
                  className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[0.8125rem] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                    on ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  {i.label}
                  {count > 0 && <span className="rounded bg-admit/15 px-1.5 text-xs font-medium text-admit">{count}</span>}
                </button>
              );
            })}
          </div>
          <Select className="sm:hidden" aria-label={`${tab.label} sections`} value={section} onChange={(e) => onPick(e.target.value, tab.id)}>
            {subs.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}
