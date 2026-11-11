import { cn } from "@/components/ui/primitives";

/**
 * The Onasi AI mark: the "O" of Onasi as a ring, with a pulse line inside that ends in a writing cursor.
 * It reads the chart (the pulse) and writes the draft (the cursor). While it works, the pulse draws itself
 * and the cursor blinks.
 */
export function OnasiAiMark({ size = 24, thinking = false, className }: { size?: number; thinking?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(thinking && "nabd-thinking", className)}
    >
      <circle cx="16" cy="16" r="12.5" stroke="currentColor" strokeWidth="2" />
      <path className="nabd-pulse" d="M7.5 17h4l2-5.5 3 9.5 2.2-7H22" stroke="currentColor" strokeWidth="1.9" />
      <path className="nabd-caret" d="M25 13v8" stroke="var(--admit)" strokeWidth="2.2" />
    </svg>
  );
}
