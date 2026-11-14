import * as React from "react";
import { ChevronDown, Minus, Plus, Search } from "lucide-react";
import { Input, cn } from "@/components/ui/primitives";
import { EMR_FORM_BY_ID } from "@/lib/emr-forms";
import { EMR_GROUPS, EMR_MENU, type EmrGroup } from "@/lib/emr-menu";
import { useDevMode } from "@/lib/devmode";
import { ageYears, fitsAge } from "@/lib/flowsheet";
import { getFormRecords, useRecords } from "@/lib/records";
import { useHis } from "@/lib/store";

/**
 * The chart's left menu: grouped sections, page search, Expand All and Collapse All.
 * The group that holds the open page stays open.
 */
export function ChartMenu({ active, visit, onPick }: { active: string; visit: string; onPick: (id: string) => void }) {
  useRecords();
  const his = useHis();
  const dev = useDevMode();
  const activeItem = EMR_MENU.find((i) => i.id === active);
  const [open, setOpen] = React.useState<Set<EmrGroup>>(new Set<EmrGroup>(["General", ...(activeItem ? [activeItem.group] : [])]));
  const [q, setQ] = React.useState("");

  const toggle = (g: EmrGroup) => setOpen((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });
  const query = q.trim().toLowerCase();
  // Age-appropriate tools only: a tool made for the other age group is hidden, unless it already has records.
  const enc = his.encounters.find((e) => e.visitNumber === visit);
  const dob = his.patients.find((p) => p.id === enc?.patientId)?.dob;
  const forAge = (id: string) => !dob || fitsAge(EMR_FORM_BY_ID[id], ageYears(dob)) || getFormRecords(visit, id).length > 0;

  return (
    <nav aria-label="Chart sections" className="h-fit max-h-[calc(100vh-14rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 lg:sticky lg:top-44">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="h-9 pl-8" placeholder="Search pages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chart pages" />
      </div>
      <div className="mb-2 flex gap-1.5">
        <button onClick={() => setOpen(new Set(EMR_GROUPS))} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1 text-xs hover:bg-muted"><Plus className="size-3" />Expand All</button>
        <button onClick={() => setOpen(new Set())} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border py-1 text-xs hover:bg-muted"><Minus className="size-3" />Collapse All</button>
      </div>
      {EMR_GROUPS.map((g) => {
        const items = EMR_MENU.filter((i) => i.group === g && (!query || i.label.toLowerCase().includes(query)) && (i.id === active || forAge(i.id)));
        if (items.length === 0) return null;
        const isOpen = query ? true : open.has(g);
        return (
          <div key={g} className="mb-1 rounded-lg border border-border/70">
            <button onClick={() => toggle(g)} aria-expanded={isOpen} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold">
              {g}
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
              <ul className="px-1 pb-1.5">
                {items.map((i) => {
                  const count = i.kind === "form" ? getFormRecords(visit, i.id).length : 0;
                  const missing = i.kind === "form" && !EMR_FORM_BY_ID[i.id];
                  return (
                    <li key={i.id}>
                      <button
                        onClick={() => onPick(i.id)}
                        aria-current={active === i.id ? "page" : undefined}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                          active === i.id ? "bg-move/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{i.label}</span>
                        {count > 0 && <span className="rounded bg-admit/15 px-1.5 text-xs font-medium text-admit">{count}</span>}
                        {dev && missing && <span className="text-xs text-warn">no form</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
