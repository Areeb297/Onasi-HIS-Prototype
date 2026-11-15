import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { FieldContext, Input, Select, cn, inputBase, useFieldAria } from "@/components/ui/primitives";

export interface Opt<T extends string = string> {
  value: T;
  label: string;
  /** A second line, for example the doctor's department. */
  hint?: string;
}

/** Strings or options, as options. */
export function toOpts<T extends string = string>(list: readonly (T | Opt<T>)[]): Opt<T>[] {
  return list.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

/** Moves the choice with the arrow keys, as a native radio group does. */
function arrowKeys<T extends string>(opts: Opt<T>[], value: T | undefined, onChange: (v: T) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl" && (e.key === "ArrowRight" || e.key === "ArrowLeft");
    const i = Math.max(0, opts.findIndex((o) => o.value === value));
    const next = opts[(i + (rtl ? -dir : dir) + opts.length) % opts.length];
    onChange(next.value);
    requestAnimationFrame(() => e.currentTarget.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus());
  };
}

/* ---------- Segmented: yes or no, and other short single choices ---------- */

/**
 * Two to four short choices side by side, one of them on. Used for yes or no, sex and the like, in place of small
 * radio buttons. The chosen segment is filled in Onasi Dark Green.
 */
export function SegmentedControl<T extends string>({
  options, value, onChange, label, disabled, className, size = "md",
}: {
  options: readonly (T | Opt<T>)[];
  value: T | undefined | "";
  onChange: (v: T) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const opts = toOpts(options);
  const ctx = React.useContext(FieldContext);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-invalid={ctx?.invalid || undefined}
      onKeyDown={arrowKeys(opts, (value || undefined) as T | undefined, onChange)}
      className={cn(
        "inline-flex w-full max-w-full rounded-lg border border-input bg-card p-0.5 shadow-xs sm:w-auto dark:bg-background",
        ctx?.invalid && "border-destructive",
        disabled && "opacity-60",
        className,
      )}
    >
      {opts.map((o, i) => {
        const on = value === o.value;
        const focusable = on || (!value && i === 0);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-value={o.value}
            tabIndex={focusable ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-w-0 flex-1 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors sm:flex-none",
              size === "sm" ? "h-8" : "h-[calc(var(--field-h,2.5rem)-0.375rem)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              on ? "bg-[#032C26] text-white shadow-sm dark:bg-[#39EDD5] dark:text-[#032C26]" : "text-foreground hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** True when a set of choices fits a segmented control: two to four short labels. */
export function fitsSegmented(options: readonly (string | Opt)[]): boolean {
  const opts = toOpts(options);
  return opts.length >= 2 && opts.length <= 4 && opts.every((o) => o.label.length <= 16) && opts.reduce((n, o) => n + o.label.length, 0) <= 40;
}

/* ---------- Chips: many choices ---------- */

const chipClass = (on: boolean) =>
  cn(
    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-left text-sm leading-snug transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    on
      ? "border-[#03C1AC] bg-[#39EDD5]/16 font-medium text-[#035D53] dark:text-[#39EDD5]"
      : "border-input bg-card text-foreground hover:border-foreground/45 hover:bg-muted dark:bg-background",
  );

/** Pick any number: each choice is a chip with a tick when on. */
export function ChipMulti<T extends string>({ options, value, onChange, label, disabled }: { options: readonly (T | Opt<T>)[]; value: readonly T[]; onChange: (v: T[]) => void; label?: string; disabled?: boolean }) {
  const opts = toOpts(options);
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {opts.map((o) => {
        const on = value.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} className={chipClass(on)}>
            {on && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pick one from more choices than a segmented control holds. */
export function ChipSingle<T extends string>({ options, value, onChange, label, disabled }: { options: readonly (T | Opt<T>)[]; value: T | undefined | ""; onChange: (v: T) => void; label?: string; disabled?: boolean }) {
  const opts = toOpts(options);
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" onKeyDown={arrowKeys(opts, (value || undefined) as T | undefined, onChange)}>
      {opts.map((o, i) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} data-value={o.value} tabIndex={on || (!value && i === 0) ? 0 : -1} disabled={disabled} onClick={() => onChange(o.value)} className={chipClass(on)}>
            {on && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Tick row ---------- */

/** A tick box with its sentence, as one large row that is easy to hit. */
export function CheckRow({ checked, onChange, children, hint, disabled, tone = "neutral", className }: {
  checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; hint?: React.ReactNode; disabled?: boolean; tone?: "neutral" | "danger" | "warn"; className?: string;
}) {
  const aria = useFieldAria({});
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
        checked
          ? tone === "danger" ? "border-destructive/50 bg-destructive/[0.05]" : tone === "warn" ? "border-warn/50 bg-warn/[0.07]" : "border-[#03C1AC] bg-[#39EDD5]/10"
          : "border-input bg-card hover:border-foreground/45 dark:bg-background",
        aria["aria-invalid"] && "border-destructive",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-[#035D53] focus-visible:outline-none" {...aria} />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{children}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/* ---------- Select with search ---------- */

/** Lists longer than this get a search box. */
export const SEARCH_FROM = 12;

/**
 * A select with a search box, for long lists such as nationalities or doctors. Type to filter, arrow keys to move,
 * Enter to choose. Opens in a layer above dialogs and side sheets.
 */
export function SearchSelect<T extends string>({
  options, value, onChange, placeholder = "Select", label, disabled, emptyLabel, className, id,
}: {
  options: readonly (T | Opt<T>)[];
  value: T | "";
  onChange: (v: T | "") => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  /** Adds a first choice that clears the value, for example "None". */
  emptyLabel?: string;
  className?: string;
  id?: string;
}) {
  const opts = toOpts(options);
  const all: Opt<T | "">[] = emptyLabel ? [{ value: "", label: emptyLabel }, ...opts] : opts;
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const aria = useFieldAria({});
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((o) => words.every((w) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(w)));
  const current = all.find((o) => o.value === value);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (open) { setQ(""); setActive(Math.max(0, all.findIndex((o) => o.value === value))); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (v: T | "") => { onChange(v); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); const o = shown[active]; if (o) pick(o.value); }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-label={label}
          {...aria}
          className={cn(inputBase, "flex items-center gap-2 text-left", className)}
        >
          <span className={cn("min-w-0 flex-1 truncate", !current?.label && "text-muted-foreground/90")}>{current?.label || placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.querySelector("input")?.focus(); }}
          className="z-[60] w-[max(var(--radix-popover-trigger-width),16rem)] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-[color:var(--glass-border)] bg-[color:var(--glass-solid)] text-card-foreground shadow-[var(--glass-shadow-hover)]"
        >
          <div className="border-b border-border p-2">
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
              prefix={<Search className="size-4" />}
              placeholder="Type to search"
              aria-label={`Search ${label ?? "options"}`}
              aria-controls={listId}
              aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
              className="[--field-h:2.25rem]"
            />
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto p-1">
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches "{q}".</li>}
            {shown.map((o, i) => {
              const on = o.value === value;
              return (
                <li
                  key={o.value || "__empty"}
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o.value)}
                  className={cn("flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-sm", i === active && "bg-muted", on && "font-semibold")}
                >
                  <Check className={cn("mt-0.5 size-4 shrink-0 text-[#035D53] dark:text-[#39EDD5]", !on && "invisible")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block">{o.label}</span>
                    {o.hint && <span className="block text-xs font-normal text-muted-foreground">{o.hint}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The right select for the length of the list: the native select for a short list, the search select for a long one.
 */
export function ChoiceSelect<T extends string>(props: {
  options: readonly (T | Opt<T>)[];
  value: T | "";
  onChange: (v: T | "") => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  const opts = toOpts(props.options);
  if (opts.length > SEARCH_FROM) return <SearchSelect {...props} />;
  const blank = props.emptyLabel ?? props.placeholder;
  return (
    <Select value={props.value} onChange={(e) => props.onChange(e.target.value as T | "")} aria-label={props.label} disabled={props.disabled} className={props.className}>
      {blank !== undefined && <option value="">{blank}</option>}
      {props.value && !opts.some((o) => o.value === props.value) && <option value={props.value}>{props.value}</option>}
      {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}

/* ---------- Date and time ---------- */

/**
 * A date and a time side by side, stored together as "YYYY-MM-DDTHH:mm" like a datetime-local input.
 * Picking a date with no time yet fills in the time now, so the value is always complete.
 */
export function DateTimeInput({ value, onChange, min, max, label, disabled }: { value: string; onChange: (v: string) => void; min?: string; max?: string; label?: string; disabled?: boolean }) {
  const [d = "", t = ""] = (value ?? "").split("T");
  const time = t.slice(0, 5);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const now = () => { const x = new Date(); return `${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const today = () => { const x = new Date(); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,0.7fr)] gap-2">
      <Input
        type="date"
        value={d}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        disabled={disabled}
        aria-label={label ? `${label}, date` : "Date"}
        onChange={(e) => onChange(e.target.value ? `${e.target.value}T${time || now()}` : "")}
      />
      <Input
        type="time"
        value={time}
        disabled={disabled}
        aria-label={label ? `${label}, time` : "Time"}
        onChange={(e) => onChange(d ? `${d}T${e.target.value || "00:00"}` : e.target.value ? `${today()}T${e.target.value}` : "")}
      />
    </div>
  );
}
