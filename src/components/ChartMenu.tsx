import * as React from "react";
import { Search } from "lucide-react";
import { Input, cn } from "@/components/ui/primitives";
import { EMR_FORM_BY_ID } from "@/lib/emr-forms";
import { EMR_GROUPS, EMR_MENU } from "@/lib/emr-menu";
import { useDevMode } from "@/lib/devmode";
import { getFormRecords, useRecords } from "@/lib/records";

/**
 * The grouped list of chart sections with Find Section. It is the panel behind the "More" tab of the chart: the
 * specialty and general forms, by group. `ids` says which sections to list, already filtered for the patient.
 */
export function ChartMenu({ ids, active, visit, onPick }: { ids: Set<string>; active: string; visit: string; onPick: (id: string) => void }) {
  useRecords();
  const dev = useDevMode();
  const [q, setQ] = React.useState("");
  const box = React.useRef<HTMLInputElement>(null);
  // Focus without scrolling: the page must not jump under the sticky patient header when the panel opens.
  React.useEffect(() => box.current?.focus({ preventScroll: true }), []);
  const query = q.trim().toLowerCase();
  const groups = EMR_GROUPS.map((g) => ({ g, items: EMR_MENU.filter((i) => i.group === g && ids.has(i.id) && (!query || i.label.toLowerCase().includes(query))) })).filter((x) => x.items.length);

  return (
    <nav aria-label="More chart sections">
      <div className="relative border-b border-border p-2">
        <Search className="pointer-events-none absolute left-4.5 top-4.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input ref={box} className="h-9 pl-8" placeholder="Find Section" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a section of this chart" />
      </div>
      <div className="p-2 sm:columns-2 sm:gap-3 lg:columns-3">
        {groups.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">No section matches "{q}".</p>}
        {groups.map(({ g, items }) => (
          <section key={g} className="mb-2 break-inside-avoid">
            <h3 className="px-2 py-1 text-xs font-semibold text-muted-foreground">{g}</h3>
            <ul>
              {items.map((i) => {
                const count = i.kind === "form" ? getFormRecords(visit, i.id).length : 0;
                return (
                  <li key={i.id}>
                    <button
                      type="button" onClick={() => onPick(i.id)} aria-current={active === i.id ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        active === i.id ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted",
                      )}
                    >
                      <span className="min-w-0 truncate">{i.label}</span>
                      {count > 0 && <span className="rounded bg-admit/15 px-1.5 text-xs font-medium text-admit">{count}</span>}
                      {dev && i.kind === "form" && !EMR_FORM_BY_ID[i.id] && <span className="text-xs text-warn">no form</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
