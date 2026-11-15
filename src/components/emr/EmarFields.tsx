import * as React from "react";
import { Check } from "lucide-react";
import { Field, Input, Select, cn } from "@/components/ui/primitives";
import { COMPLICATIONS, SITE_REGIONS, SITE_ROUTES, regionOf, type MarOrder } from "@/lib/emar";

/** Shared inputs of the medication chart: administration site, quantity given and wasted, complications. */

/** Body region first, then the site inside it. A plain picker in place of the HIS body drawing. */
export function SitePicker({ value, onChange, route, idPrefix }: { value: string; onChange: (v: string) => void; route?: string; idPrefix: string }) {
  const [region, setRegion] = React.useState(() => (value ? regionOf(value) ?? "" : ""));
  const sites = SITE_REGIONS.find((r) => r.region === region)?.sites ?? [];
  const usual = route ? SITE_ROUTES.has(route) : false;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Body Region" hint={usual ? "Usually recorded for this route." : "Optional for this route."}>
        <Select id={`${idPrefix}-region`} value={region} onChange={(e) => { setRegion(e.target.value); onChange(""); }}>
          <option value="">Not recorded</option>
          {SITE_REGIONS.map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
        </Select>
      </Field>
      <Field label="Site">
        <Select id={`${idPrefix}-site`} value={value} disabled={!region} onChange={(e) => onChange(e.target.value)}>
          <option value="">{region ? "Choose the site" : "Choose a region first"}</option>
          {sites.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
    </div>
  );
}

/** Quantity given against the dose due. The wasted part follows by itself and can be changed. */
export function QuantityFields({ order, given, wasted, onChange }: { order: Pick<MarOrder, "doseQty" | "unit">; given: string; wasted: string; onChange: (given: string, wasted: string) => void }) {
  const left = (g: string) => {
    const n = parseFloat(g);
    return Number.isFinite(n) ? String(Math.max(0, Math.round((order.doseQty - n) * 100) / 100)) : "";
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Dose Due">
        <Input value={`${order.doseQty} ${order.unit}`} disabled readOnly />
      </Field>
      <Field label={`Quantity Given (${order.unit})`} required>
        <Input type="number" inputMode="decimal" min={0} step="any" max={order.doseQty} value={given} onChange={(e) => onChange(e.target.value, left(e.target.value))} />
      </Field>
      <Field label={`Quantity Wasted (${order.unit})`} hint="Given and wasted must add up to the dose due.">
        <Input type="number" inputMode="decimal" min={0} step="any" value={wasted} onChange={(e) => onChange(given, e.target.value)} />
      </Field>
    </div>
  );
}

/** Pick any number of complications. Each one is a toggle button, so it works with the keyboard. */
export function ComplicationsPicker({ value, onChange, label = "Complications" }: { value: string[]; onChange: (v: string[]) => void; label?: string }) {
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label} <span className="font-normal text-muted-foreground">(choose any that apply)</span></legend>
      <div className="flex flex-wrap gap-1.5">
        {COMPLICATIONS.map((c) => {
          const on = value.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-warn/60 bg-warn/14 text-warn" : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              {on && <Check className="size-3" aria-hidden="true" />} {c}
            </button>
          );
        })}
      </div>
      {value.length === 0 && <p className="mt-1 text-xs text-muted-foreground">None chosen means no complications.</p>}
    </fieldset>
  );
}

/** Parse a typed quantity. Empty text means "left out". */
export const qty = (s: string): number | undefined => {
  if (!s.trim()) return undefined;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};
