import { IconArrowsExchange } from "@tabler/icons-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TONE } from "./tone";
import type { BoardStage, MoveCheck } from "./types";

/**
 * The non-drag way to move a card. Lists every other stage. Stages the rules refuse are greyed out and say why.
 * Works with keyboard and touch. A role without permission gets a disabled button with a tooltip.
 */
export function MoveMenu({
  label, from, stages, check, locked, hint, dev, onPick,
}: {
  label: string;
  from: string;
  stages: BoardStage[];
  check: (to: string) => MoveCheck;
  locked: MoveCheck;
  hint?: (to: string) => string | undefined;
  dev: boolean;
  onPick: (to: string) => void;
}) {
  const btn = "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40";
  if (!locked.ok) {
    return (
      <span title={locked.reason} className="inline-flex">
        <button type="button" disabled className={btn} aria-label={`Move ${label}. ${locked.reason}`}>
          <IconArrowsExchange className="size-4" stroke={1.75} />
        </button>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={btn} aria-label={`Move ${label} to another stage`} title="Move to another stage">
          <IconArrowsExchange className="size-4" stroke={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Move To</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {stages.map((s) => {
          const here = s.id === from;
          const chk = here ? ({ ok: false, reason: "The card is here now." } as MoveCheck) : check(s.id);
          const h = dev && chk.ok ? hint?.(s.id) : undefined;
          return (
            <DropdownMenuItem
              key={s.id}
              disabled={!chk.ok}
              title={chk.ok ? undefined : chk.reason}
              onSelect={() => chk.ok && onPick(s.id)}
              className="flex-col items-start gap-0.5"
            >
              <span className="flex w-full items-center gap-2 text-sm font-medium">
                <span className={cn("size-2 rounded-full", TONE[s.tone].bg)} aria-hidden="true" />
                {s.label}
                {here && <span className="ml-auto text-xs font-normal text-muted-foreground">Now</span>}
              </span>
              {!chk.ok && !here && <span className="pl-4 text-xs leading-snug text-muted-foreground">{chk.reason}</span>}
              {h && <span className="pl-4 font-mono text-xs leading-snug text-update">{h}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
