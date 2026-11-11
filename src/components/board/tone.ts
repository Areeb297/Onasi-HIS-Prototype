import type { BoardTone } from "./types";

/** Static class names, so Tailwind can see them. */
export const TONE: Record<BoardTone, { text: string; bg: string; soft: string; softer: string; border: string; outline: string; stripe: string; ring: string }> = {
  admit: { text: "text-admit", bg: "bg-admit", soft: "bg-admit/14", softer: "bg-admit/6", border: "border-admit", outline: "outline-admit/55", stripe: "bg-admit", ring: "ring-admit/50" },
  move: { text: "text-move", bg: "bg-move", soft: "bg-move/14", softer: "bg-move/6", border: "border-move", outline: "outline-move/55", stripe: "bg-move", ring: "ring-move/50" },
  update: { text: "text-update", bg: "bg-update", soft: "bg-update/14", softer: "bg-update/6", border: "border-update", outline: "outline-update/55", stripe: "bg-update", ring: "ring-update/50" },
  merge: { text: "text-merge", bg: "bg-merge", soft: "bg-merge/18", softer: "bg-merge/8", border: "border-merge", outline: "outline-merge/55", stripe: "bg-merge", ring: "ring-merge/50" },
  ok: { text: "text-ok", bg: "bg-ok", soft: "bg-ok/14", softer: "bg-ok/6", border: "border-ok", outline: "outline-ok/55", stripe: "bg-ok", ring: "ring-ok/50" },
  cancel: { text: "text-cancel", bg: "bg-cancel", soft: "bg-cancel/14", softer: "bg-cancel/6", border: "border-cancel", outline: "outline-cancel/55", stripe: "bg-cancel", ring: "ring-cancel/50" },
  muted: { text: "text-muted-foreground", bg: "bg-muted-foreground", soft: "bg-muted", softer: "bg-muted/50", border: "border-border", outline: "outline-border", stripe: "bg-muted-foreground/60", ring: "ring-border" },
};
