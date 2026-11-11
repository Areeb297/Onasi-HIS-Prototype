import { cn } from "@/components/ui/primitives";

/**
 * The Saudi riyal symbol (Unicode U+20C1, added in 2025). Many fonts do not have the character yet,
 * so it is drawn as an icon that takes the text colour and size. Screen readers hear "Saudi riyals".
 */
export function RiyalSign({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 1124.14 1256.39" className={cn("inline-block h-[0.78em] w-auto shrink-0 fill-current align-baseline", className)} aria-hidden="true">
      <path d="M699.62,1113.02h0c-20.06,44.48-33.32,92.75-38.4,143.37l424.51-90.24c20.06-44.47,33.31-92.75,38.4-143.37l-424.51,90.24Z" />
      <path d="M1085.73,895.8c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.33v-135.2l292.27-62.11c20.06-44.47,33.32-92.75,38.4-143.37l-330.68,70.27V66.13c-50.67,28.45-95.67,66.32-132.25,110.99v403.35l-132.25,28.11V0c-50.67,28.44-95.67,66.32-132.25,110.99v525.69l-295.91,62.88c-20.06,44.47-33.33,92.75-38.42,143.37l334.33-71.05v170.26l-358.3,76.14c-20.06,44.47-33.32,92.75-38.4,143.37l375.04-79.7c30.53-6.35,56.77-24.4,73.83-49.24l68.78-101.97v-.02c7.14-10.55,11.3-23.27,11.3-36.97v-149.98l132.25-28.11v270.4l424.53-90.28Z" />
    </svg>
  );
}

/** An amount in Saudi riyals: the symbol, then the number. */
export function Money({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-[0.18em] whitespace-nowrap tabular-nums", className)}>
      <RiyalSign />
      <span>{Math.round(value).toLocaleString("en-US")}</span>
      <span className="sr-only"> Saudi riyals</span>
    </span>
  );
}
