import * as React from "react";
import { Check, Copy, Download, Ellipsis, Eye, FolderOpen, Pencil, Printer, Send, Trash2, X, type LucideIcon } from "lucide-react";
import { Button, cn } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RowAction } from "@/components/list/DataTable";

/**
 * The standard row and record actions (CLAUDE.md, UI standards): the same icon for the same action on every page,
 * an icon-only button with a tooltip and an aria-label, one size and one hover style. Delete is red and always asks
 * first. Matches the HIS IconAction: a 28px button, a Dark Green tooltip chip, a mint wash on hover.
 *
 *   <ActionIcon kind="edit" name={patientName} onClick={...} />
 *   actions={(r) => [rowAction("chart", () => open(r)), rowAction("delete", () => remove(r))]}
 */

export type ActionKind = "view" | "chart" | "edit" | "print" | "download" | "delete" | "duplicate" | "send" | "approve" | "reject" | "more";

export const ACTIONS: Record<ActionKind, { label: string; Icon: LucideIcon; danger?: boolean }> = {
  view: { label: "View", Icon: Eye },
  chart: { label: "Open Chart", Icon: FolderOpen },
  edit: { label: "Edit", Icon: Pencil },
  print: { label: "Print", Icon: Printer },
  download: { label: "Download", Icon: Download },
  delete: { label: "Delete", Icon: Trash2, danger: true },
  duplicate: { label: "Duplicate", Icon: Copy },
  send: { label: "Send", Icon: Send },
  approve: { label: "Approve", Icon: Check },
  reject: { label: "Reject", Icon: X, danger: true },
  more: { label: "More Actions", Icon: Ellipsis },
};

/** The icon alone, for menus and RowAction.icon. */
export function actionIcon(kind: ActionKind, className = "size-4"): React.ReactNode {
  const { Icon } = ACTIONS[kind];
  return <Icon className={className} aria-hidden="true" />;
}

/* ---------- asking before a destructive action ---------- */

export interface ConfirmSpec { title: string; text: string; confirmLabel: string; run: () => void }

/** A small "are you sure" dialog: Cancel (ghost) on the left, the red action on the right. */
export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  return (
    <Dialog open={!!spec} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogTitle>{spec?.title}</DialogTitle>
        <DialogDescription>{spec?.text}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" autoFocus onClick={() => { spec?.run(); onClose(); }}>{spec?.confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** `ask(spec)` opens the confirm dialog; render `dialog` once in the component. */
export function useConfirm(): [(spec: ConfirmSpec) => void, React.ReactNode] {
  const [spec, setSpec] = React.useState<ConfirmSpec | null>(null);
  return [setSpec, <ConfirmDialog key="confirm" spec={spec} onClose={() => setSpec(null)} />];
}

/** The question a delete asks when the caller gives none. */
export const deleteQuestion = (label: string, name?: string) => ({
  title: `${label}${name ? ` ${name}` : ""}?`,
  text: "This cannot be undone.",
  confirmLabel: label,
});

/* ---------- the button ---------- */

const BASE =
  "relative inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0";
const TONE = {
  default: "text-[#035d53] hover:bg-[#39edd5]/15 dark:text-[#39edd5]",
  danger: "text-destructive hover:bg-destructive/10",
  muted: "text-muted-foreground hover:bg-muted hover:text-foreground",
};

export interface ActionIconProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  kind?: ActionKind;
  /** Overrides the standard label, for an action outside the set (with `icon`). */
  label?: string;
  icon?: React.ReactNode;
  /** What the action is for, read out after the label: "Edit, Saad Almutairi". */
  name?: string;
  /** Extra tooltip line, for example why the action is turned off. */
  hint?: string;
  danger?: boolean;
  /**
   * Destructive actions ask first. A delete always asks unless the caller already shows its own dialog
   * (`confirm={false}`). Give a spec to change the question.
   */
  confirm?: false | Partial<Omit<ConfirmSpec, "run">>;
  /** Shows a small amber dot, for example when changes are not sent yet. */
  dot?: boolean;
}

export const ActionIcon = React.forwardRef<HTMLButtonElement, ActionIconProps>(
  ({ kind, label, icon, name, hint, danger, confirm, dot, className, onClick, disabled, ...props }, ref) => {
    const def = kind ? ACTIONS[kind] : undefined;
    const text = label ?? def?.label ?? "Action";
    const red = danger ?? def?.danger ?? false;
    const [ask, dialog] = useConfirm();
    const asks = confirm !== false && (kind === "delete" || (red && confirm !== undefined));
    const button = (
      <button
        ref={ref}
        type="button"
        aria-label={name ? `${text}, ${name}` : text}
        disabled={disabled}
        className={cn(BASE, kind === "more" ? TONE.muted : red ? TONE.danger : TONE.default, className)}
        onClick={(e) => {
          if (!asks) return onClick?.(e);
          const q = deleteQuestion(text, name);
          ask({ ...q, ...(confirm || {}), run: () => onClick?.(e) });
        }}
        {...props}
      >
        {icon ?? (def ? <def.Icon aria-hidden="true" /> : null)}
        {dot && <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-warn ring-2 ring-card" aria-label="Changes not sent" />}
      </button>
    );
    return (
      <>
        <TooltipProvider delayDuration={250} skipDelayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent sideOffset={6} className="bg-[#032C26] font-medium text-white [&_svg]:bg-[#032C26] [&_svg]:fill-[#032C26]">
              {text}
              {hint && <span className="mt-0.5 block font-normal opacity-80">{hint}</span>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {asks && dialog}
      </>
    );
  },
);
ActionIcon.displayName = "ActionIcon";

/** A standard action for the shared DataTable (src/components/list). A delete asks first unless `confirm: false`. */
export function rowAction(kind: ActionKind, onClick: () => void, opts: Partial<RowAction> = {}): RowAction {
  const def = ACTIONS[kind];
  return {
    id: kind, label: def.label, icon: actionIcon(kind), onClick, danger: def.danger,
    ...(kind === "delete" ? { confirm: deleteQuestion(def.label) } : {}),
    ...opts,
  };
}
