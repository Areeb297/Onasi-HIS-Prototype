import * as React from "react";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button, cn } from "@/components/ui/primitives";

/**
 * The frame of a list page: title, one short line, the main action on the right and everything else in a More menu.
 * Onasi brand: Dark Green #032C26 for the title and the main action, Cyan #39EDD5 with #03C1AC and #035D53 for accents.
 */

/** The Onasi Dark Green main action. Cyan on dark. */
export const BRAND_BUTTON =
  "border-transparent bg-[#032c26] text-white shadow-[0_6px_16px_-8px_rgba(3,44,38,0.55)] hover:bg-[#035d53] hover:brightness-100 dark:bg-[#39edd5] dark:text-[#032c26] dark:hover:bg-[#03c1ac]";

export interface PageAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is turned off, or what it does. */
  title?: string;
  danger?: boolean;
  /** Draws a line above this item in the More menu. */
  separate?: boolean;
}

export function ListPage({ title, subtitle, mark, primary, more, aside, kpis, children, className }: {
  title: string;
  /** One line. Longer text is cut with an ellipsis and shown in full on hover. */
  subtitle?: string;
  mark?: React.ReactNode;
  primary?: PageAction;
  more?: (PageAction | false | null | undefined)[];
  /** Small controls that sit left of the actions, for example a Developer View switch. */
  aside?: React.ReactNode;
  /** A KpiStrip under the title. */
  kpis?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const menu = (more ?? []).filter(Boolean) as PageAction[];
  return (
    // No glass-backdrop here: its isolation would trap the app's fixed dialogs under the sticky top bar.
    <div className={className}>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex min-w-0 items-center gap-3">
            {mark}
            <h1 className="truncate text-[1.375rem] font-semibold leading-tight tracking-tight text-[#032c26] dark:text-foreground">{title}</h1>
          </div>
          {subtitle && <p className="mt-1 truncate text-sm text-muted-foreground" title={subtitle}>{subtitle}</p>}
        </div>
        {(primary || menu.length > 0 || aside) && (
          <div className="flex flex-wrap items-center gap-2">
            {aside}
            {menu.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button aria-label={`More actions for ${title}`}>More <ChevronDown className="size-4" aria-hidden="true" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  {menu.map((a, i) => (
                    <React.Fragment key={a.label}>
                      {a.separate && i > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem disabled={a.disabled} title={a.title} variant={a.danger ? "destructive" : "default"} onClick={a.onClick} className="gap-3 py-2">
                        {a.icon}
                        {a.label}
                      </DropdownMenuItem>
                    </React.Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {primary && (
              <Button variant="primary" className={BRAND_BUTTON} disabled={primary.disabled} title={primary.title} onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            )}
          </div>
        )}
      </header>
      {kpis && <div className="mb-4">{kpis}</div>}
      {children}
    </div>
  );
}
