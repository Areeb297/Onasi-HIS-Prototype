import * as React from "react";
import { LabTrend } from "@/components/emr/lab-grid/LabTrend";
import { Empty, Input, cn } from "@/components/ui/primitives";
import { INTERP_TEXT, refTextFor, unitText } from "@/lib/fhir/lab-catalog";
import { fmtDateTime } from "@/lib/format";
import { useLab } from "@/lib/lab";
import { CATEGORIES, buildLabGrid, cellTitle, columnForDate, historyOrders, rowsIn, trendOf, visitKind, type CategoryId, type GridRow } from "@/lib/lab-grid";
import type { Patient } from "@/lib/model";
import { useHis } from "@/lib/store";

/**
 * Lab results the way doctors read them in Epic: categories on the left, one spreadsheet on the right with analytes
 * as rows and collections as columns, newest next to the names, over every visit. A red exclamation mark flags an
 * abnormal value. Double-click a value, or press Enter on it, for the trend. There is no export on purpose.
 * On a phone the categories become a strip above the grid, and the grid keeps its sticky first column.
 */

const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const dayMonthYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit" });
const hourMinute = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const thisYear = new Date().getFullYear();

// The sticky cells need a solid fill, so the zebra stripe is a colour, not a see-through wash.
const ROW = "[--row:var(--glass-solid)] even:[--row:color-mix(in_srgb,var(--muted)_45%,var(--glass-solid))]";
const LINE = "border-b border-r border-border/70";
const HEAD = "sticky z-20 bg-[color-mix(in_srgb,var(--muted)_80%,var(--glass-solid))]";
const FIRST = "sticky left-0 z-10 w-36 min-w-36 sm:w-52 sm:min-w-52";

export function LabGridView({ patient, currentVisit }: { patient: Patient; currentVisit: string }) {
  const lab = useLab();
  const his = useHis();
  const [category, setCategory] = React.useState<CategoryId | "all">("all");
  const [focus, setFocus] = React.useState<[number, number]>([0, 0]);
  const [jumped, setJumped] = React.useState<string | null>(null);
  const [trendRow, setTrendRow] = React.useState<GridRow | null>(null);
  const scroller = React.useRef<HTMLDivElement>(null);

  const grid = React.useMemo(
    () => buildLabGrid([...lab.orders, ...historyOrders(his.patients, his.encounters)], patient.id),
    [lab.orders, his.patients, his.encounters, patient.id],
  );
  const rows = rowsIn(grid, category);

  // The chart keeps the patient header (and the app bar) stuck to the top of the page. The grid scrolls in its own box
  // sized to the space under them (--stuck), and when the page is scrolled so the box starts under them, the date
  // header moves down by the hidden part (--under), so it is never covered. Measured, because the header height changes.
  React.useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    let frame = 0;
    const measure = () => {
      let stuck = 0, bottom = 0;
      for (const el of document.querySelectorAll<HTMLElement>('header.sticky, [aria-label="Patient header"]')) {
        const cs = getComputedStyle(el);
        if (cs.position !== "sticky") continue;
        stuck = Math.max(stuck, (parseFloat(cs.top) || 0) + el.offsetHeight);
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
      }
      box.style.setProperty("--stuck", `${stuck}px`);
      box.style.setProperty("--under", `${Math.max(0, Math.round(bottom - box.getBoundingClientRect().top))}px`);
    };
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    document.addEventListener("scroll", queue, { capture: true, passive: true });
    window.addEventListener("resize", queue);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("scroll", queue, { capture: true }); window.removeEventListener("resize", queue); };
  }, [grid.rows.length === 0]);
  const { columns } = grid;
  const visitLabel = (v: string) => (v === currentVisit ? "This Visit" : `Earlier ${visitKind(v, his.encounters) || "Visit"} ${v}`);

  // Runs of neighbouring columns from one visit, for the top header line.
  const groups: { visit: string; span: number }[] = [];
  for (const c of columns) {
    const g = groups[groups.length - 1];
    if (g?.visit === c.visitNumber) g.span += 1;
    else groups.push({ visit: c.visitNumber, span: 1 });
  }
  const startsVisit = (i: number) => i > 0 && columns[i].visitNumber !== columns[i - 1].visitNumber;

  function jump(ymd: string) {
    const i = columnForDate(columns, ymd);
    const box = scroller.current;
    const th = box?.querySelector<HTMLElement>(`[data-col="${i}"]`);
    const first = box?.querySelector<HTMLElement>("[data-first]");
    if (!box || !th || !first) return;
    box.scrollTo({ left: th.offsetLeft - first.offsetWidth, behavior: "auto" });
    setJumped(columns[i].key);
  }

  const open = (row: GridRow) => { if (trendOf(row, columns, patient.sex).points.length) setTrendRow(row); };

  function onKey(e: React.KeyboardEvent, r: number, c: number) {
    const move: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key === "Enter") { e.preventDefault(); open(rows[r]); return; }
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    const nr = Math.min(rows.length - 1, Math.max(0, r + d[0])), nc = Math.min(columns.length - 1, Math.max(0, c + d[1]));
    scroller.current?.querySelector<HTMLElement>(`[data-cell="${nr}-${nc}"]`)?.focus();
  }

  if (grid.rows.length === 0) return <Empty>No released lab results for this patient yet. Results appear here when the laboratory releases them.</Empty>;

  return (
    <div className="grid min-w-0 lg:grid-cols-[13.5rem_minmax(0,1fr)]">
      <nav aria-label="Result categories" className="flex gap-1 overflow-x-auto border-b border-border p-2 [scrollbar-width:thin] lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r">
        {[{ id: "all" as const, label: "All Results" }, ...CATEGORIES].map((c) => {
          const n = grid.counts[c.id];
          return (
            <button
              key={c.id} type="button" aria-pressed={category === c.id} disabled={n.rows === 0}
              onClick={() => { setCategory(c.id); setFocus([0, 0]); }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] whitespace-nowrap transition-colors lg:whitespace-normal",
                "focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-45",
                category === c.id ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="min-w-0 flex-1">{c.label}</span>
              {n.abnormal && <span className="size-1.5 shrink-0 rounded-full bg-destructive" role="img" aria-label="Newest results include abnormal values" />}
              <span className="shrink-0 tabular-nums text-xs text-muted-foreground">{n.rows}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            {columns.length} {columns.length === 1 ? "collection" : "collections"} over {groups.length === 1 ? "1 visit" : `${new Set(columns.map((c) => c.visitNumber)).size} visits`}, newest first.
            {" "}<span className="font-bold text-destructive">!</span> marks an abnormal value. Double-click a value for its trend.
          </p>
          <label className="flex items-center gap-2 text-xs font-medium">
            Jump To Date
            <Input type="date" className="h-8 w-40" min={columns[columns.length - 1].at.slice(0, 10)} onChange={(e) => jump(e.target.value)} />
          </label>
        </div>

        <div ref={scroller} className="isolate max-h-[max(20rem,calc(100vh-var(--stuck,8rem)-5.5rem))] overflow-auto bg-[var(--glass-solid)]">
          <table className="w-max min-w-full border-separate border-spacing-0 text-[0.8125rem]">
            <thead>
              <tr>
                <th data-first rowSpan={2} scope="col" className={cn(HEAD, LINE, FIRST, "top-[var(--under,0px)] z-30 px-3 text-left align-bottom text-xs font-semibold")}>
                  <span className="block pb-1.5">Test</span>
                </th>
                {groups.map((g, i) => (
                  <th key={`${g.visit}-${i}`} colSpan={g.span} scope="colgroup" title={visitLabel(g.visit)}
                    className={cn(HEAD, LINE, "top-[var(--under,0px)] h-6 max-w-0 truncate px-2 text-left text-[0.6875rem] font-medium text-muted-foreground", i > 0 && "border-l border-l-foreground/25", g.visit === currentVisit && "text-foreground")}>
                    {g.span === 1 ? (g.visit === currentVisit ? "This Visit" : `Earlier ${visitKind(g.visit, his.encounters) || "Visit"}`) : visitLabel(g.visit)}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((c, i) => {
                  const d = new Date(c.at);
                  return (
                    <th key={c.key} data-col={i} scope="col" title={`Collected ${fmtDateTime(c.at)}. ${visitLabel(c.visitNumber)}`}
                      className={cn(HEAD, LINE, "top-[calc(var(--under,0px)+1.5rem)] min-w-[4.75rem] px-2 py-1 text-right text-xs font-semibold tabular-nums", startsVisit(i) && "border-l border-l-foreground/25", jumped === c.key && "bg-accent text-accent-foreground")}>
                      <span className="block">{(d.getFullYear() === thisYear ? dayMonth : dayMonthYear).format(d)}</span>
                      <span className="block font-normal text-muted-foreground">{hourMinute.format(d)}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => {
                const unit = unitText(row.test);
                const heading = category === "all" && (r === 0 || rows[r - 1].category !== row.category);
                return (
                  <React.Fragment key={row.test.code}>
                    {heading && (
                      <tr>
                        <th scope="colgroup" className={cn(LINE, FIRST, "h-6 bg-[var(--glass-solid)] px-3 text-left text-[0.6875rem] font-semibold text-muted-foreground")}>
                          {CATEGORIES.find((c) => c.id === row.category)!.label}
                        </th>
                        <td colSpan={columns.length} className="h-6 border-b border-border/70 bg-[var(--glass-solid)]" />
                      </tr>
                    )}
                    <tr className={ROW}>
                      <th scope="row" title={`${row.test.display}. Reference: ${refTextFor(row.test, patient.sex)}`} onDoubleClick={() => open(row)}
                        className={cn(LINE, FIRST, "h-8 bg-[var(--row)] px-3 text-left font-medium")}>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate">{row.test.short}</span>
                          {unit && <span className="shrink-0 text-[0.6875rem] font-normal text-muted-foreground">{unit}</span>}
                        </span>
                      </th>
                      {columns.map((c, ci) => {
                        const cell = row.cells[c.key];
                        return (
                          <td
                            key={c.key} data-cell={`${r}-${ci}`} tabIndex={focus[0] === r && focus[1] === ci ? 0 : -1}
                            title={cell ? cellTitle(row.test, cell, patient.sex) : undefined}
                            onFocus={() => setFocus([r, ci])} onKeyDown={(e) => onKey(e, r, ci)} onDoubleClick={() => cell && open(row)}
                            className={cn(LINE, "h-8 cursor-default bg-[var(--row)] py-0 pl-2 pr-1 text-right tabular-nums whitespace-nowrap outline-none focus:shadow-[inset_0_0_0_2px_var(--ring)]", startsVisit(ci) && "border-l border-l-foreground/25")}
                          >
                            {cell && (
                              <>
                                <span className={cn("inline-block max-w-28 truncate align-bottom", cell.critical && "font-semibold text-destructive")}>{cell.value}</span>
                                <span aria-hidden="true" className={cn("inline-block w-3 text-center font-bold text-destructive", cell.critical && "font-black")}>{cell.abnormal ? "!" : ""}</span>
                                {cell.abnormal && <span className="sr-only">{INTERP_TEXT[cell.interp]}</span>}
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {trendRow && <LabTrend row={trendRow} trend={trendOf(trendRow, columns, patient.sex)} sex={patient.sex} visitLabel={visitLabel} onClose={() => setTrendRow(null)} />}
    </div>
  );
}
