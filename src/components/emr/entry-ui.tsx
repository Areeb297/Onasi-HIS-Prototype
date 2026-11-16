import * as React from "react";
import { AlertCircle, MoreHorizontal, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FormGrid as SharedGrid, FormSection as SharedSection, SegmentedControl } from "@/components/forms";
import { Button, Field, Switch, cn, textareaBase, useFieldAria } from "@/components/ui/primitives";
import { ASK_BEFORE_LEAVING } from "@/components/forms/unsaved";

/**
 * The data-entry pattern of the chart sections: a side sheet with a pinned save bar, labels above inputs, help and
 * errors under the field, segmented buttons for short choices, an actions menu on each entry and an empty state that
 * names the next step. The fields, sections, grid and segmented buttons are the shared form system (src/components/forms and
 * ui/primitives); this file adds what a chart section needs on top: the side sheet, the entry list and the menu.
 */

/* ---------- validation: errors show after the field is left, or after Save is pressed ---------- */

export function useValidation<K extends string>(errors: Partial<Record<K, string | undefined | null | false>>) {
  const [touched, setTouched] = React.useState<Partial<Record<K, boolean>>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const all = (Object.keys(errors) as K[]).filter((k) => !!errors[k]).map((k) => errors[k] as string);
  return {
    /** The message to show under field `k`, if any yet. */
    error: (k: K): string | undefined => ((submitted || touched[k]) && errors[k] ? (errors[k] as string) : undefined),
    /** Put on a field's onBlur. */
    blur: (k: K) => () => setTouched((t) => (t[k] ? t : { ...t, [k]: true })),
    /** Call when Save is pressed. True when nothing is wrong. */
    submit: (): boolean => { setSubmitted(true); return all.length === 0; },
    /** Every message, once Save was pressed. For the summary at the top of the form. */
    summary: submitted ? all : [],
    reset: () => { setTouched({}); setSubmitted(false); },
  };
}

/* ---------- side sheet ---------- */

/**
 * The add or edit form of a chart section. Opens from the right, full width on a phone. The body scrolls; the footer
 * with the buttons stays in view. With `dirty`, closing asks before the typed values are lost.
 */
export function EntrySheet({
  open = true, onClose, title, subtitle, children, footer, dirty, size = "md",
}: {
  open?: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** The buttons, primary action last. */
  footer?: React.ReactNode;
  /** Something was typed. Closing asks first. */
  dirty?: boolean;
  size?: "md" | "lg";
}) {
  const [asking, setAsking] = React.useState(false);
  React.useEffect(() => { if (!dirty || !open) setAsking(false); }, [dirty, open]);
  const tryClose = () => {
    if (!dirty || !ASK_BEFORE_LEAVING) onClose();
    else setAsking((a) => !a);
  };
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) tryClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className={cn("w-full gap-0 border-border bg-card p-0 text-card-foreground", size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl")}
        // Escape first closes an open search list inside the form, not the form.
        onEscapeKeyDown={(e) => { if ((e.target as HTMLElement | null)?.getAttribute?.("aria-expanded") === "true") e.preventDefault(); }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
            <SheetDescription className={cn("mt-0.5 text-[0.8125rem] text-muted-foreground", !subtitle && "sr-only")}>{subtitle ?? title}</SheetDescription>
          </div>
          <Button size="sm" variant="ghost" aria-label="Close" onClick={tryClose}><X className="size-4" /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {asking ? (
          <footer role="alertdialog" aria-label="Unsaved changes" className="flex flex-wrap items-center justify-between gap-2 border-t border-warn/50 bg-warn/10 px-5 py-3">
            <p className="text-sm font-medium">Close without saving? What you typed will be lost.</p>
            <div className="flex gap-2">
              <Button autoFocus onClick={() => setAsking(false)}>Keep Editing</Button>
              <Button variant="danger" onClick={onClose}>Discard Changes</Button>
            </div>
          </footer>
        ) : footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-5 py-3">{footer}</footer>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/* ---------- form layout ---------- */

/** A titled group of fields inside a sheet: the shared FormSection without its card. */
export function FormSection({ title, description, right, className, children }: { title: string; description?: string; right?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <SharedSection plain title={title} help={description} right={right} className={className}><div className="space-y-4">{children}</div></SharedSection>;
}

export function FormGrid({ cols = 2, className, children }: { cols?: 1 | 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  if (cols === 1) return <div className={cn("grid gap-y-5", className)}>{children}</div>;
  return <SharedGrid cols={cols} className={className}>{children}</SharedGrid>;
}

/**
 * One field: label above, the control, then the error in red or the help text. Inputs inside are 40px high.
 * `group` is for controls that are not one input (segmented buttons, chips): the label names the group instead of
 * pointing at an input. This is the shared Field; `help` is its hint.
 */
export function FormField({
  label, required, help, error, hl7, group, className, children,
}: {
  label: string;
  required?: boolean;
  help?: React.ReactNode;
  error?: string;
  hl7?: string;
  group?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return <Field label={label} required={required} hint={help} error={error} hl7={hl7} group={group} className={className}>{children}</Field>;
}

/** A multi-line input styled like the single-line ones. */
export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => {
    const aria = useFieldAria(props);
    return <textarea ref={ref} rows={rows} className={cn(textareaBase, className)} {...props} {...aria} />;
  },
);
TextArea.displayName = "TextArea";

/** Shows a unit (kg, days, mg) at the end of an input. Give the input `className="pe-14"` so text does not run under it. */
export function WithUnit({ unit, children }: { unit: string; children: React.ReactNode }) {
  return (
    <span className="relative block">
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs font-medium text-muted-foreground">{unit}</span>
    </span>
  );
}

/* ---------- segmented buttons ---------- */

export interface SegOption<V extends string> { value: V; label: string; disabled?: boolean; title?: string }

/** A short choice (two to five options) as a row of buttons. One is always pressed. Arrow keys move between them. */
export function Segmented<V extends string>({
  value, options, onChange, label, disabled, className, full,
}: {
  value: V | "";
  options: readonly SegOption<V>[];
  onChange: (v: V) => void;
  /** Accessible name. Inside a FormField with `group`, the field label already names it. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** Stretch the buttons over the full width. */
  full?: boolean;
}) {
  if (!options.some((o) => o.disabled || o.title)) {
    return <SegmentedControl label={label} value={value} options={options.map((o) => ({ value: o.value, label: o.label }))} onChange={onChange} disabled={disabled} className={cn(full ? "sm:w-full [&>button]:sm:flex-1" : "sm:self-start", className)} />;
  }
  // Same look as the shared control, with single options that can be switched off.
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex w-full max-w-full rounded-lg border border-input bg-card p-0.5 shadow-xs dark:bg-background", full ? "sm:w-full" : "sm:w-auto sm:self-start", disabled && "opacity-60", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled || o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-[calc(var(--field-h,2.5rem)-0.375rem)] min-w-0 flex-1 rounded-md px-3.5 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              !full && "sm:flex-none",
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

const YES_NO: SegOption<"yes" | "no">[] = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

/** A yes or no answer as two buttons. */
export function YesNo({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return <Segmented label={label} value={value ? "yes" : "no"} options={YES_NO} disabled={disabled} onChange={(v) => onChange(v === "yes")} />;
}

/* ---------- errors at the top of a form ---------- */

/** What stops the save, in a list. It scrolls into view when it appears. */
export function ErrorSummary({ problems, title }: { problems: string[]; title?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const key = problems.join("|");
  React.useEffect(() => { if (key) ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [key]);
  if (!problems.length) return null;
  return (
    <div ref={ref} role="alert" className="rounded-xl border border-destructive/35 border-l-4 border-l-destructive bg-destructive/[0.06] px-4 py-3 text-sm text-destructive">
      <p className="flex items-center gap-1.5 font-semibold"><AlertCircle className="size-4 shrink-0" aria-hidden="true" />{title ?? (problems.length === 1 ? "Fix 1 item to save" : `Fix ${problems.length} items to save`)}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-6 text-foreground">
        {problems.map((p) => <li key={p}>{p}</li>)}
      </ul>
    </div>
  );
}

/* ---------- the list of entries ---------- */

export interface MenuAction {
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Why it is off, shown as a tooltip. */
  title?: string;
  /** A line above this item. */
  separated?: boolean;
}

/** The "More" button of an entry. `label` names the entry for screen readers, for example "Actions for J18.9". */
export function RowMenu({ label, items }: { label: string; items: (MenuAction | false | null | undefined)[] }) {
  const list = items.filter((x): x is MenuAction => !!x);
  if (!list.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={label} title="Actions" className="w-8 px-0"><MoreHorizontal className="size-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {list.map((a) => (
          <React.Fragment key={a.label}>
            {a.separated && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={a.disabled} title={a.title} onSelect={a.onSelect} className={cn("gap-2.5 py-2 text-sm", a.danger && "text-destructive focus:text-destructive")}>
              {a.icon}
              {a.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EntryList({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <ul aria-label={label} className={cn("divide-y divide-border/70", className)}>{children}</ul>;
}

/**
 * One entry of a chart list. Title on the left with its badges, small facts under it, the controls on the right.
 * It wraps on a phone, so no sideways scrolling.
 */
export function EntryRow({ title, code, badges, meta, muted, right, children }: {
  title: React.ReactNode;
  /** A code shown before the title in monospace. */
  code?: string;
  badges?: React.ReactNode;
  /** Small facts as [label, value]. Empty values are left out. */
  meta?: ([string, React.ReactNode] | false | null | undefined)[];
  /** An inactive entry. */
  muted?: boolean;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const facts = (meta ?? []).filter((m): m is [string, React.ReactNode] => !!m && m[1] !== undefined && m[1] !== null && m[1] !== "");
  return (
    <li className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3", muted && "bg-muted/30")}>
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {code && <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold">{code}</span>}
          <span className={cn("text-sm font-medium", muted && "text-muted-foreground")}>{title}</span>
          {badges}
        </div>
        {facts.length > 0 && (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
            {facts.map(([k, v]) => (
              <div key={k} className="flex gap-1">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className={cn(muted && "text-muted-foreground")}>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
      {right && <div className="ms-auto flex shrink-0 items-center gap-2">{right}</div>}
    </li>
  );
}

/** The Active or Inactive switch of an entry, with the word next to it. */
export function ActiveToggle({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <span className="flex items-center gap-2">
      <Switch checked={on} disabled={disabled} label={label} onChange={onChange} />
      <span className="w-12 text-xs text-muted-foreground">{on ? "Active" : "Inactive"}</span>
    </span>
  );
}

/** Nothing here yet: what this list is for, and the button that starts it. */
export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon && <span aria-hidden="true" className="glass-icon flex size-10 items-center justify-center rounded-xl [&_svg]:size-5">{icon}</span>}
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className="max-w-md text-[0.8125rem] text-muted-foreground">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A picked code shown in place of the search box, with a button to change it. */
export function PickedCode({ code, text, onChange, changeLabel }: { code?: string; text: string; onChange?: () => void; changeLabel: string }) {
  return (
    <div className="flex min-h-10 items-center gap-2 rounded-lg border border-primary/40 bg-accent/40 px-3 py-1.5 text-sm">
      {code && <span className="font-mono text-xs font-semibold">{code}</span>}
      <span className="min-w-0 flex-1">{text}</span>
      {onChange && <Button size="sm" variant="ghost" aria-label={changeLabel} title="Change" onClick={onChange}><X className="size-4" /></Button>}
    </div>
  );
}
