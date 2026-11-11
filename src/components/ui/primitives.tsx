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

/*
 * Height comes from --field-h. A Field sets it to 2.5rem, so form fields are comfortable to read and click, while
 * search boxes and filters outside a Field stay at 2.25rem and line up with the buttons next to them.
 * A disabled field is shown as read-only: muted fill, quiet border, text still at full reading contrast.
 */
const inputBase =
  "h-[var(--field-h,2.25rem)] w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs dark:bg-background dark:[color-scheme:dark] " +
  "placeholder:text-muted-foreground/80 " +
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "aria-[invalid=true]:border-destructive " +
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-foreground/85 disabled:opacity-100 disabled:shadow-none dark:disabled:bg-muted";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(inputBase, className)} {...props} />,
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(inputBase, "pr-7", className)} {...props}>
      {children}
    </select>
  ),
);
Select.displayName = "Select";

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

export function Field({
  label,
  hint,
  hl7,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  hl7?: string;
  /** Marks the label with an asterisk, and says "required" to screen readers. */
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 [--field-h:2.5rem]", className)}>
      <span className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium leading-5 text-foreground">
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
      {children}
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
    </label>
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

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-xl border border-border bg-card text-card-foreground", className)}>{children}</section>;
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

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
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

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("border-b border-border bg-muted px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap text-foreground", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-border/70 px-3 py-[var(--row-py,0.6rem)] align-middle text-foreground", className)}>
      {children}
    </td>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}
