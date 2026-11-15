import { Money } from "@/components/Money";
import { cn } from "@/components/ui/primitives";
import type { AgeingRow, Bucket } from "@/lib/rcm-cases";

/**
 * Outstanding money by age, one column per bucket, insurance (dark green) stacked under patient (cyan), with the money
 * on top of each column.
 * Each column is a button that filters the worklist to that bucket.
 */
export function AgeingChart({ rows, active, onPick }: { rows: AgeingRow[]; active: Bucket | ""; onPick: (b: Bucket | "") => void }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  const total = rows.reduce((n, r) => n + r.total, 0);
  return (
    <section className="glass-panel rounded-2xl px-4 pb-3 pt-3.5 sm:px-5" aria-label="Outstanding money by age">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-[0.9375rem] font-semibold">Ageing</h2>
          <p className="text-xs text-muted-foreground">Days since the claim was sent or the invoice was finished. Select a column to filter the list.</p>
        </div>
        <ul className="flex gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-[#032c26] dark:bg-[#03c1ac]" />Insurance</li>
          <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm bg-[#39edd5]" />Patient</li>
        </ul>
      </header>
      <div className="mt-3 grid grid-cols-5 items-end gap-2 sm:gap-4">
        {rows.map((r) => {
          const on = active === r.bucket;
          const share = total ? Math.round((r.total / total) * 100) : 0;
          return (
            <button key={r.bucket} type="button" aria-pressed={on} onClick={() => onPick(on ? "" : r.bucket)}
              aria-label={`${r.bucket} days: ${Math.round(r.total)} SAR in ${r.cases} cases, insurance ${Math.round(r.insurance)}, patient ${Math.round(r.patient)}`}
              className={cn("group flex min-w-0 flex-col items-stretch rounded-xl px-1 pb-1.5 pt-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring", on && "bg-[#39edd5]/12 ring-1 ring-[#03c1ac]")}>
              <span className="truncate text-center text-[0.75rem] font-semibold sm:text-[0.8125rem]"><Money value={r.total} /></span>
              <span className="flex h-28 flex-col justify-end sm:h-32" aria-hidden="true">
                <span className="mx-auto flex w-full max-w-24 flex-col overflow-hidden rounded-t-md" style={{ height: `${Math.max(r.total ? 4 : 0, (r.total / max) * 100)}%` }}>
                  <span className="bg-[#39edd5]" style={{ flexGrow: r.patient }} />
                  <span className="bg-[#032c26] dark:bg-[#03c1ac]" style={{ flexGrow: r.insurance }} />
                </span>
              </span>
              <span className="mt-1.5 border-t border-border pt-1.5 text-center text-xs font-medium">{r.bucket} days</span>
              <span className="text-center text-[0.6875rem] text-muted-foreground">{r.cases} {r.cases === 1 ? "case" : "cases"}, {share}%</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
