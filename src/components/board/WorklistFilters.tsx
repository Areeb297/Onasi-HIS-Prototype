import { RotateCcw } from "lucide-react";
import { Button, Card, Field, Input, Select } from "@/components/ui/primitives";
import { toLocalInput } from "@/lib/store";

export interface OrderFilter {
  from: string;
  to: string;
  priority: string;
  q: string;
}

export const EMPTY_FILTER: OrderFilter = { from: "", to: "", priority: "all", q: "" };

export const filterIsEmpty = (f: OrderFilter): boolean => !f.from && !f.to && f.priority === "all" && !f.q.trim();

/** The local calendar day an ISO time falls on, as YYYY-MM-DD. */
export const dayOf = (iso: string): string => toLocalInput(new Date(iso)).slice(0, 10);

/** True when the order passes the date range and priority parts of the filter. The search text is checked by the page, which knows the patient. */
export function passesDateAndPriority(f: OrderFilter, orderedAt: string, priority: string): boolean {
  const day = dayOf(orderedAt);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.priority !== "all") {
    const lane = priority === "stat" ? "stat" : priority === "routine" ? "routine" : "urgent";
    if (lane !== f.priority) return false;
  }
  return true;
}

/** From and to dates, priority, search and Reset: the filter row the HIS worklists have. Used by the laboratory and radiology worklists. */
export function WorklistFilters({
  value, onChange, searchLabel = "Patient", placeholder, shown, total,
}: { value: OrderFilter; onChange: (f: OrderFilter) => void; searchLabel?: string; placeholder: string; shown: number; total: number }) {
  const set = (patch: Partial<OrderFilter>) => onChange({ ...value, ...patch });
  const bad = !!value.from && !!value.to && value.from > value.to;
  return (
    <Card className="mb-4 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)_auto]">
        <Field label="Ordered From"><Input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} aria-invalid={bad} /></Field>
        <Field label="Ordered To"><Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} aria-invalid={bad} /></Field>
        <Field label="Priority">
          <Select value={value.priority} onChange={(e) => set({ priority: e.target.value })}>
            <option value="all">All Priorities</option>
            <option value="stat">STAT</option>
            <option value="urgent">Urgent And ASAP</option>
            <option value="routine">Routine</option>
          </Select>
        </Field>
        <Field label={searchLabel}><Input placeholder={placeholder} value={value.q} onChange={(e) => set({ q: e.target.value })} /></Field>
        <div className="flex items-end">
          <Button variant="secondary" disabled={filterIsEmpty(value)} onClick={() => onChange(EMPTY_FILTER)}>
            <RotateCcw className="size-4" />Reset
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" role="status">
        {bad ? "The From date is after the To date, so nothing can match." : `Showing ${shown} of ${total} ${total === 1 ? "order" : "orders"}.`}
      </p>
    </Card>
  );
}
