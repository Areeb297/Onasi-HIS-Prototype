import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { useDevMode } from "@/lib/devmode";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ---------- Button ---------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:pointer-events-none disabled:opacity-45",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-primary text-primary-foreground shadow-sm hover:brightness-110",
        variant === "secondary" && "border border-border bg-card text-foreground hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        variant === "danger" && "border border-destructive/50 bg-card text-destructive hover:bg-destructive/10",
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

/* ---------- Inputs ---------- */

/**
 * What a Field tells the control inside it: whether it has an error, and the ids of its help or error text.
 * Input, Select and Textarea read it, so a field inside a Field is marked invalid and described without extra props.
 */
export const FieldContext = React.createContext<{ invalid: boolean; describedBy?: string } | null>(null);

/** aria-invalid and aria-describedby from the Field around a control, unless the control sets them itself. */
export function useFieldAria(props: { "aria-invalid"?: React.AriaAttributes["aria-invalid"]; "aria-describedby"?: string }) {
  const ctx = React.useContext(FieldContext);
  return {
    "aria-invalid": props["aria-invalid"] ?? (ctx?.invalid ? true : undefined),
    "aria-describedby": [props["aria-describedby"], ctx?.describedBy].filter(Boolean).join(" ") || undefined,
  };
}

/*
 * Height comes from --field-h. A Field sets it to 2.5rem, so form fields are comfortable to read and click, while
 * search boxes and filters outside a Field stay at 2.25rem and line up with the buttons next to them.
 * A disabled field is shown as read-only: muted fill, quiet border, text still at full reading contrast.
 */
export const inputBase =
  "h-[var(--field-h,2.25rem)] w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs transition-[border-color,box-shadow] dark:bg-background dark:[color-scheme:dark] " +
  "placeholder:text-muted-foreground/80 hover:border-foreground/45 " +
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:hover:border-destructive " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-foreground/85 disabled:opacity-100 disabled:shadow-none dark:disabled:bg-muted";

/** The outline of an input that carries a unit, drawn on a wrapper so the unit sits inside the box. */
const groupBase =
  "flex h-[var(--field-h,2.25rem)] w-full min-w-0 items-center rounded-lg border border-input bg-card text-sm text-foreground shadow-xs transition-[border-color,box-shadow] dark:bg-background " +
  "hover:border-foreground/45 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring " +
  "has-[input[aria-invalid=true]]:border-destructive has-[input:disabled]:border-border has-[input:disabled]:bg-muted has-[input:disabled]:shadow-none";

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  /** A unit shown inside the box after the value, for example mmHg, kg or SAR. */
  suffix?: React.ReactNode;
  /** Text shown inside the box before the value, for example +966. */
  prefix?: React.ReactNode;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, suffix, prefix, ...props }, ref) => {
  const aria = useFieldAria(props);
  if (suffix === undefined && prefix === undefined) return <input ref={ref} className={cn(inputBase, className)} {...props} {...aria} />;
  return (
    <div className={cn(groupBase, className)}>
      {prefix !== undefined && <span className="shrink-0 ps-3 text-sm text-muted-foreground" aria-hidden="true">{prefix}</span>}
      <input
        ref={ref}
        className="h-full w-full min-w-0 flex-1 rounded-lg bg-transparent px-3 text-inherit outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:text-foreground/85 dark:[color-scheme:dark]"
        {...props}
        {...aria}
      />
      {suffix !== undefined && <span className="shrink-0 pe-3 text-sm whitespace-nowrap text-muted-foreground">{suffix}</span>}
    </div>
  );
});
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    const aria = useFieldAria(props);
    return (
      <select ref={ref} className={cn(inputBase, "pr-7", className)} {...props} {...aria}>
        {children}
      </select>
    );
  },
);
Select.displayName = "Select";

/** Multi-line text with the same outline, fill and focus ring as Input. */
export const textareaBase =
  "min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground shadow-xs transition-[border-color,box-shadow] dark:bg-background " +
  "placeholder:text-muted-foreground/80 hover:border-foreground/45 " +
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:opacity-100";

/** Shows which HL7 field a form field maps to. Only visible in Developer View. */
export function Hl7Tag({ children }: { children: React.ReactNode }) {
  const dev = useDevMode();
  if (!dev) return null;
  return (
    <span className="rounded bg-update/14 px-1.5 py-0.5 font-mono text-xs font-medium leading-none text-update" title="HL7 field">
      {children}
    </span>
  );
}

/** A small warning mark for field errors. Drawn here so the primitives do not need an icon package. */
function ErrorMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-px size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.6v4" strokeLinecap="round" />
      <circle cx="8" cy="11.2" r=".55" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * A form field: the label above, then the control, then help text in muted type. When there is an error, it takes
 * the place of the help text, in red with a mark, and the control inside is marked invalid.
 * `name` puts data-field on the field, so an error summary can jump to it. `group` is for a row of buttons, such as
 * yes or no: a <label> would pass a click on the gaps to the first button, so the field becomes a labelled group.
 */
export function Field({
  label,
  hint,
  hl7,
  required,
  error,
  name,
  group,
  className,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  hl7?: string;
  /** Marks the label with an asterisk, and says "required" to screen readers. */
  required?: boolean;
  /** The problem with the value. Shown in place of the hint. */
  error?: string;
  name?: string;
  group?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const msgId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const labelId = `${id}-label`;
  const head = (
    <span id={labelId} className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-foreground">
      <span>
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      {hl7 && <Hl7Tag>{hl7}</Hl7Tag>}
    </span>
  );
  const foot = error ? (
    <span id={msgId} className="flex items-start gap-1.5 text-xs font-medium leading-snug text-destructive">
      <ErrorMark />
      <span>{error}</span>
    </span>
  ) : hint ? (
    <span id={msgId} className="text-xs leading-snug text-muted-foreground">{hint}</span>
  ) : null;
  const box = cn("flex min-w-0 flex-col gap-1.5 [--field-h:2.5rem]", className);
  return (
    <FieldContext.Provider value={{ invalid: !!error, describedBy: msgId }}>
      {group ? (
        <div role="group" aria-labelledby={labelId} aria-describedby={msgId} data-field={name} data-invalid={error ? "true" : undefined} className={box}>
          {head}
          {children}
          {foot}
        </div>
      ) : (
        <label data-field={name} data-invalid={error ? "true" : undefined} className={box}>
          {head}
          {children}
          {foot}
        </label>
      )}
    </FieldContext.Provider>
  );
}

/** One line that explains the asterisk. Put it at the top of a form that has required fields. */
export function RequiredNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Fields marked <span className="font-semibold text-destructive">*</span> are required.
    </p>
  );
}

/* ---------- Switch ---------- */

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* ---------- Badge ---------- */

type Tone = "neutral" | "primary" | "ok" | "warn" | "danger" | "info" | "admit" | "move" | "update" | "cancel" | "merge";

const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-accent text-accent-foreground",
  ok: "bg-ok/14 text-ok",
  warn: "bg-warn/16 text-warn",
  danger: "bg-destructive/12 text-destructive",
  info: "bg-move/12 text-move",
  admit: "bg-admit/14 text-admit",
  move: "bg-move/12 text-move",
  update: "bg-update/12 text-update",
  cancel: "bg-cancel/12 text-cancel",
  merge: "bg-merge/14 text-merge",
};

/** A short status label. It has a dot as well as a color, so the meaning never depends on color alone. */
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  const dot = tone !== "neutral" && tone !== "primary";
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap", toneClass[tone], className)}>
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ---------- Card ---------- */

/**
 * The app's card: the light glass panel of the dashboards (white, a little translucent, soft neutral border, white top
 * highlight, soft neutral shadow, no tint). Written as utilities rather than the .glass-panel class so a page can still
 * override the background or border with its own classes. No backdrop blur: the page behind is flat, and a blur would
 * make the card the containing block for the fixed dialogs rendered inside it.
 */
export const cardSurface =
  "rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg-strong)] text-card-foreground shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow)]";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn(cardSurface, className)}>{children}</section>;
}

export function CardHeader({ title, subtitle, right, tag }: { title: string; subtitle?: string; right?: React.ReactNode; tag?: string }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold">
          {title}
          {tag && <Hl7Tag>{tag}</Hl7Tag>}
        </h2>
        {subtitle && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

export function PageHeader({ title, subtitle, right, mark }: { title: string; subtitle?: string; right?: React.ReactNode; mark?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">{mark}<h1 className="text-xl font-semibold tracking-tight">{title}</h1></div>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/* ---------- Data table (styled after the 21st.dev data table pattern) ---------- */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

/** `numeric` right-aligns the heading so it sits over right-aligned numbers in its column. Use the same flag on the cells. */
export function Th({ children, className, numeric }: { children?: React.ReactNode; className?: string; numeric?: boolean }) {
  return (
    <th className={cn("border-b border-border bg-muted px-3 py-2.5 text-xs font-semibold whitespace-nowrap text-foreground", numeric ? "text-right" : "text-left", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan, numeric }: { children?: React.ReactNode; className?: string; colSpan?: number; numeric?: boolean }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-border/70 px-3 py-[var(--row-py,0.6rem)] align-middle text-foreground", numeric && "text-right tabular-nums", className)}>
      {children}
    </td>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}
