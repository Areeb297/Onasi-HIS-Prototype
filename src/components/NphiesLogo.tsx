import { cn } from "@/components/ui/primitives";

/**
 * The NPHIES logo, the same file the HIS uses. It always sits on a white plate, because the logo is drawn for a white
 * background and must stay readable in dark mode. The height is in pixels.
 */
export function NphiesLogo({ height = 20, className }: { height?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-md bg-white px-2 py-1 ring-1 ring-border", className)}>
      <img src="/brand/nphies-logo.png" alt="NPHIES" style={{ height, width: "auto" }} draggable={false} />
    </span>
  );
}
