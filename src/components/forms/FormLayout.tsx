import * as React from "react";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { Button, cardSurface, cn } from "@/components/ui/primitives";
import { attentionText, firstErrorKey, visibleErrors, type Errors } from "./validation";

/* ---------- Finding and focusing a field ---------- */

/**
 * Brings a field into view and puts the cursor in it. A field inside a folded section opens the section first.
 * Fields are found by their data-field attribute (Field's `name`).
 */
export function focusField(key: string, root: ParentNode = document): boolean {
  const sel = `[data-field="${typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key}"]`;
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) return false;
  // Open every folded section around the field.
  let s = el.closest<HTMLElement>("[data-form-section]");
  while (s) {
    if (s.dataset.open === "false") s.dispatchEvent(new CustomEvent("form-reveal"));
    s = s.parentElement?.closest<HTMLElement>("[data-form-section]") ?? null;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const target = root.querySelector<HTMLElement>(sel) ?? el;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    const control = target.matches("input, select, textarea, button")
      ? target
      : target.querySelector<HTMLElement>("input:not([type=hidden]):not([type=file]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex='0']");
    control?.focus({ preventScroll: true });
  }));
  return true;
}

/**
 * Error display for a form: errors show after the user changes a field and leaves it, or after a save attempt.
 * Put `bind` on the element around the fields. Call `attempt()` on save: it returns true when there is nothing to fix,
 * otherwise it shows every error and takes the user to the first one.
 */
export function useFormErrors(errors: Errors, order: readonly string[], opts: { reveal?: (key: string) => void } = {}) {
  const [touched, setTouched] = React.useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = React.useState(false);
  const edited = React.useRef(new Set<string>());
  const keyOf = (t: EventTarget | null) => (t instanceof HTMLElement ? t.closest<HTMLElement>("[data-field]")?.dataset.field : undefined);
  const mark = (e: React.SyntheticEvent) => { const k = keyOf(e.target); if (k) edited.current.add(k); };
  const bind = {
    onInputCapture: mark,
    onChangeCapture: mark,
    onClickCapture: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("button")) mark(e); },
    onBlurCapture: (e: React.FocusEvent) => {
      const k = keyOf(e.target);
      if (!k || !edited.current.has(k)) return;
      // Moving between two inputs of the same field (date and time) is not leaving it.
      if (keyOf(e.relatedTarget) === k) return;
      setTouched((t) => (t.has(k) ? t : new Set(t).add(k)));
    },
  };
  const shown = visibleErrors(errors, touched, submitted);
  const go = (key: string) => {
    opts.reveal?.(key);
    // A step change renders the field first, so wait a frame before looking for it.
    requestAnimationFrame(() => focusField(key));
  };
  const attempt = (): boolean => {
    setSubmitted(true);
    const first = firstErrorKey(errors, order);
    if (!first) return true;
    go(first);
    return false;
  };
  const reset = () => { setSubmitted(false); setTouched(new Set()); edited.current.clear(); };
  return { shown, submitted, bind, attempt, reset, go };
}

/* ---------- Section ---------- */

/**
 * A titled group of fields on a glass card. The header can show how much is filled in, as a count and a thin bar,
 * and how many fields need attention. Collapsible sections fold away; a field inside is kept on the page, so typed
 * values are never lost and the error summary can still open the section and jump to the field.
 */
export function FormSection({
  title, help, filled, total, attention = 0, collapsible = false, defaultOpen = true, open: openProp, onOpenChange, plain, id, right, className, children,
}: {
  title: string;
  /** One short line under the title. */
  help?: React.ReactNode;
  filled?: number;
  total?: number;
  /** Fields in this section that need attention now. */
  attention?: number;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** No card: a heading and a hairline, for use inside a dialog that is already a card. */
  plain?: boolean;
  id?: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const uid = React.useId();
  const [own, setOwn] = React.useState(defaultOpen);
  const open = openProp ?? own;
  const setOpen = React.useCallback((o: boolean) => { setOwn(o); onOpenChange?.(o); }, [onOpenChange]);
  const ref = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => setOpen(true);
    el.addEventListener("form-reveal", reveal);
    return () => el.removeEventListener("form-reveal", reveal);
  }, [setOpen]);

  const counted = total !== undefined && total > 0 && filled !== undefined;
  const done = counted && filled! >= total!;
  const status = (
    <span className="flex shrink-0 items-center gap-2">
      {attention > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
          <CircleAlert className="size-3.5" aria-hidden="true" />{attention} to fix
        </span>
      )}
      {counted && (
        <span className={cn("inline-flex items-center gap-1 text-xs tabular-nums", done ? "font-semibold text-[#035D53] dark:text-[#39EDD5]" : "text-muted-foreground")}>
          {done && <Check className="size-3.5" aria-hidden="true" />}
          {filled} of {total}
          <span className="sr-only"> filled</span>
        </span>
      )}
      {right}
    </span>
  );
  const titleBlock = (
    <span className="min-w-0 flex-1">
      <span className="block text-[0.9375rem] font-semibold leading-6 text-foreground">{title}</span>
      {help && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{help}</span>}
    </span>
  );
  const bar = counted && (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] bg-transparent">
      <span className="block h-full bg-[#03C1AC] transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((filled! / total!) * 100)}%` }} />
    </span>
  );

  if (plain) {
    return (
      <section ref={ref} id={id} data-form-section data-open={String(open)} className={cn("min-w-0", className)}>
        <header className="relative mb-4 flex items-start gap-3 border-b border-border pb-2">
          {collapsible ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`${uid}-b`} className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden="true" />
              {titleBlock}
            </button>
          ) : <h3 className="contents">{titleBlock}</h3>}
          {status}
          {bar}
        </header>
        <div id={`${uid}-b`} hidden={!open}>{children}</div>
      </section>
    );
  }

  return (
    <section ref={ref} id={id} data-form-section data-open={String(open)} className={cn(cardSurface, "min-w-0 scroll-mt-4", className)}>
      <header className={cn("relative flex items-start gap-3 px-4 py-3 sm:px-5", open && "border-b border-border")}>
        {collapsible ? (
          <h3 className="flex min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-controls={`${uid}-b`}
              className="-mx-2 -my-1 flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2 py-1 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown className={cn("mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden="true" />
              {titleBlock}
            </button>
          </h3>
        ) : (
          <h3 className="flex min-w-0 flex-1">{titleBlock}</h3>
        )}
        {status}
        {bar}
      </header>
      <div id={`${uid}-b`} hidden={!open} className="px-4 pb-5 pt-4 sm:px-5">{children}</div>
    </section>
  );
}

/* ---------- Grid ---------- */

/**
 * Fields in columns that follow the space the form has, not the screen: one column when narrow (a phone), two from
 * about 450px (a tablet or a side sheet), three from about 770px (a wide page). Put `col-span-full` on long text.
 */
export function FormGrid({ cols = 3, className, children }: { cols?: 2 | 3 | 4; className?: string; children: React.ReactNode }) {
  return (
    <div className="@container min-w-0">
      <div className={cn("grid grid-cols-1 gap-x-4 gap-y-5 @md:grid-cols-2", cols >= 3 && "@3xl:grid-cols-3", cols === 4 && "@5xl:grid-cols-4", className)}>{children}</div>
    </div>
  );
}

/* ---------- Error summary ---------- */

/** The list at the top after a save attempt: how many fields need attention, each a link to the field. */
export const ErrorSummary = React.forwardRef<HTMLDivElement, { items: { key: string; text: string }[]; onJump: (key: string) => void; className?: string }>(
  ({ items, onJump, className }, ref) => {
    if (!items.length) return null;
    return (
      <div ref={ref} tabIndex={-1} role="alert" className={cn("rounded-xl border border-destructive/35 border-l-4 border-l-destructive bg-destructive/[0.06] px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
        <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {attentionText(items.length)}
        </p>
        <ul className="mt-1.5 space-y-0.5 ps-6 text-sm">
          {items.map((i) => (
            <li key={i.key}>
              <button type="button" onClick={() => onJump(i.key)} className="rounded text-start text-foreground underline decoration-destructive/50 underline-offset-2 hover:decoration-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {i.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  },
);
ErrorSummary.displayName = "ErrorSummary";

/* ---------- Actions ---------- */

/** A button that, when disabled, says why on hover and on keyboard focus. */
export function ReasonButton({ reason, children, ...props }: React.ComponentProps<typeof Button> & { reason?: string }) {
  const id = React.useId();
  if (!reason) return <Button {...props}>{children}</Button>;
  return (
    <span tabIndex={0} aria-describedby={id} className="group relative inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Button {...props} disabled tabIndex={-1}>{children}</Button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-max max-w-[16rem] rounded-lg bg-[#032C26] px-2.5 py-1.5 text-xs leading-snug font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {reason}
      </span>
    </span>
  );
}

/**
 * Save, Save As Draft and Cancel. `sticky` pins the bar to the bottom of the page while a long form scrolls.
 * `status` is shown on the left: a count of fields to fix, a progress line or a score.
 */
export function FormActions({
  onSave, saveLabel = "Save", saveIcon, onCancel, cancelLabel = "Cancel", onDraft, draftLabel = "Save As Draft", disabledReason, status, extra, sticky, reserveEnd, saveVariant = "primary", className,
}: {
  onSave?: () => void;
  saveLabel?: React.ReactNode;
  saveIcon?: React.ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  onDraft?: () => void;
  draftLabel?: string;
  /** Set when Save cannot be used, with the reason in plain words. */
  disabledReason?: string;
  status?: React.ReactNode;
  extra?: React.ReactNode;
  sticky?: boolean;
  /** Leave room on the right for the floating assistant button. */
  reserveEnd?: boolean;
  saveVariant?: "primary" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-[color:var(--glass-solid)] px-4 py-3",
        // On a phone the floating assistant button sits at the bottom right: keep the buttons clear of it.
        sticky && "sticky bottom-0 z-20 rounded-t-2xl border border-b-0 border-[color:var(--glass-border)] shadow-[0_-8px_24px_-16px_rgba(16,24,22,0.28)] max-sm:pe-16",
        reserveEnd && "sm:pe-44",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-48 text-sm text-muted-foreground">{status}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {extra}
        {onCancel && <Button onClick={onCancel}>{cancelLabel}</Button>}
        {onDraft && <Button onClick={onDraft}>{draftLabel}</Button>}
        {onSave && (
          <ReasonButton variant={saveVariant} onClick={onSave} reason={disabledReason}>
            {saveIcon}{saveLabel}
          </ReasonButton>
        )}
      </div>
    </div>
  );
}

/** "3 fields need attention" as a link to the first one, for the status slot of FormActions. */
export function AttentionLink({ count, onClick }: { count: number; onClick: () => void }) {
  if (!count) return null;
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 rounded font-medium text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CircleAlert className="size-4" aria-hidden="true" />{attentionText(count)}
    </button>
  );
}

/* ---------- Stepper ---------- */

export interface Step {
  id: string;
  label: string;
  /** A short line under the label, for example the coverage result. */
  note?: React.ReactNode;
  /** Fields on this step that need attention. */
  attention?: number;
  done?: boolean;
}

/**
 * Steps of a multi-step form. Every step can be opened at any time; typed values are kept when the user moves
 * between steps. The current step has a dark bar, finished steps a cyan tick, steps with problems a red count.
 */
export function Stepper({ steps, current, onSelect, label = "Steps" }: { steps: Step[]; current: string; onSelect: (id: string) => void; label?: string }) {
  return (
    <nav aria-label={label}>
      <ol className="grid gap-2" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => {
          const on = s.id === current;
          const bad = (s.attention ?? 0) > 0;
          return (
            <li key={s.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-current={on ? "step" : undefined}
                className="group flex w-full min-w-0 flex-col items-stretch gap-2 rounded-lg pb-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-1 rounded-full transition-colors",
                    on ? "bg-[#032C26] dark:bg-[#39EDD5]" : bad ? "bg-destructive" : s.done ? "bg-[#03C1AC]" : "bg-border group-hover:bg-foreground/25",
                  )}
                />
                <span className="flex min-w-0 items-start gap-2">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      on ? "bg-[#032C26] text-white dark:bg-[#39EDD5] dark:text-[#032C26]"
                        : bad ? "bg-destructive/12 text-destructive"
                          : s.done ? "bg-[#39EDD5]/25 text-[#035D53] dark:text-[#39EDD5]"
                            : "border border-border bg-card text-muted-foreground",
                    )}
                  >
                    {s.done && !on && !bad ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-xs leading-snug font-semibold sm:text-sm", on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                      {s.label}
                    </span>
                    {bad ? (
                      <span className="hidden text-xs font-medium text-destructive sm:block">{s.attention} to fix</span>
                    ) : s.note ? (
                      <span className="hidden text-xs text-muted-foreground sm:block">{s.note}</span>
                    ) : null}
                    <span className="sr-only">{on ? ", current step" : s.done ? ", done" : ""}{bad ? `, ${s.attention} to fix` : ""}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
