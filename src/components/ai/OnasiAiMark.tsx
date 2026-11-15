import { cn } from "@/components/ui/primitives";

/**
 * The Onasi AI mark is the Onasi logo itself, so the assistant reads as part of the product and not a separate tool.
 * Brand rule: no shadows, glows or motion on the logo itself, so `thinking` only marks the state (data-thinking);
 * the thinking state is shown beside it (dots, progress). The size is the height in pixels.
 */
export function OnasiAiMark({ size = 24, thinking = false, className }: { size?: number; thinking?: boolean; className?: string }) {
  return (
    <img
      src="/brand/onasi-icon-mint.png"
      alt=""
      aria-hidden="true"
      width={Math.round(size * 0.92)}
      height={size}
      style={{ height: size, width: "auto" }}
      className={cn("inline-block shrink-0 select-none", className)}
      data-thinking={thinking || undefined}
      draggable={false}
    />
  );
}
