import { cn } from "@/components/ui/primitives";

/**
 * The Onasi AI mark is the Onasi logo itself, so the assistant reads as part of the product and not a separate tool.
 * While it works, the logo breathes. The size is the height in pixels.
 */
export function OnasiAiMark({ size = 24, thinking = false, className }: { size?: number; thinking?: boolean; className?: string }) {
  return (
    <img
      src="/brand/onasi-icon.png"
      alt=""
      aria-hidden="true"
      width={Math.round(size * 0.92)}
      height={size}
      style={{ height: size, width: "auto" }}
      className={cn("onasi-mark inline-block shrink-0 select-none", thinking && "animate-pulse motion-reduce:animate-none", className)}
      draggable={false}
    />
  );
}
