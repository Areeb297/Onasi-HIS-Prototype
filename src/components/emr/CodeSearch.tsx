import * as React from "react";
import { Search } from "lucide-react";
import { Input, cn } from "@/components/ui/primitives";
import { looksLikeCode, searchCodes } from "@/lib/chart-entries";
import type { CodedTerm } from "@/lib/reference-data";

/**
 * Search box over a code list. Type three letters of the name, or the start of a code, then pick with the mouse
 * or with the arrow keys and Enter. The list closes with Escape.
 */
export function CodeSearch<T extends CodedTerm>({
  items,
  onPick,
  exclude,
  placeholder = "Type three letters or a code",
  label,
  meta,
  autoFocus,
  invalid,
  onBlur,
  "aria-invalid": ariaInvalid,
  "aria-describedby": describedBy,
}: {
  items: T[];
  onPick: (item: T) => void;
  /** Codes already chosen. They are left out of the results. */
  exclude?: string[];
  placeholder?: string;
  /** Accessible name of the search box. */
  label: string;
  /** Extra words shown on the right of a result, for example the allergen group. */
  meta?: (item: T) => string | undefined;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Called when the box is left, so the form can show a missing value. */
  onBlur?: () => void;
  /** Set by FormField when the field has an error. */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const id = React.useId();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const results = React.useMemo(() => searchCodes(items, q, 30).filter((t) => !exclude?.includes(t.code)), [items, q, exclude]);
  const tooShort = q.trim().length > 0 && q.trim().length < 3 && !looksLikeCode(q.trim());
  const show = open && q.trim().length > 0;

  const pick = (t: T) => {
    onPick(t);
    setQ("");
    setOpen(false);
    setActive(0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { if (show && results[active]) { e.preventDefault(); pick(results[active]); } }
    else if (e.key === "Escape") { if (show) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={show && results[active] ? `${id}-${active}` : undefined}
        aria-invalid={invalid || ariaInvalid || undefined}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        className="pl-8"
        value={q}
        placeholder={placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { window.setTimeout(() => setOpen(false), 150); onBlur?.(); }}
        onKeyDown={onKey}
      />
      {show && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={`${label} results`}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
        >
          {tooShort && <li className="px-3 py-2 text-muted-foreground">Type at least three letters, or the start of a code.</li>}
          {!tooShort && results.length === 0 && <li className="px-3 py-2 text-muted-foreground">No match found.</li>}
          {results.map((t, i) => (
            <li
              key={t.code}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(t); }}
              onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-9 cursor-pointer items-baseline gap-2 px-3 py-2", i === active && "bg-accent text-accent-foreground")}
            >
              <span className="w-20 shrink-0 font-mono text-xs font-semibold">{t.code}</span>
              <span className="min-w-0 flex-1">{t.text}</span>
              {meta?.(t) && <span className="shrink-0 text-xs text-muted-foreground">{meta(t)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Small helpers shared by the chart list sections. */
export const fmtWhen = (local?: string) =>
  local ? new Date(local).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not recorded";

export function Checkbox({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", disabled && "opacity-60")}>
      <input
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-ring"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** A two-option choice shown as radio buttons in a row. */
export function RadioRow<V extends string>({ name, value, options, onChange, label }: { name: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name={name} className="size-4 accent-primary" checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ProblemList({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
      {problems.map((p) => <li key={p}>{p}</li>)}
    </ul>
  );
}
