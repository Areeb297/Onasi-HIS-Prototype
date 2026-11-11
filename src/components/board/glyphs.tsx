import { cn } from "@/lib/utils";
import { TUBES, type TubeKind } from "./lab-board";

/**
 * Small custom SVG pictures for the cards. Nothing here is an emoji or an icon font.
 * They draw the real thing: a specimen tube with the standard cap colour, a modality machine, a blister strip.
 */

const STROKE = "currentColor";

/** A specimen tube, cup or bottle. `filled` is true once the specimen was collected, before that the outline is dashed and empty. */
export function TubeIcon({ kind, filled, className }: { kind: TubeKind; filled: boolean; className?: string }) {
  const t = TUBES[kind];
  const body = filled ? undefined : "3 2";
  if (t.shape === "cup") {
    return (
      <svg viewBox="0 0 28 32" width="26" height="30" className={cn("shrink-0 text-muted-foreground", className)} role="img" aria-label={t.label}>
        <title>{t.label}</title>
        <path d="M5 9 H23 L21.5 28 Q21.3 30 19.5 30 H8.5 Q6.7 30 6.5 28 Z" fill="var(--card)" stroke={STROKE} strokeWidth="1.2" strokeDasharray={body} />
        {filled && <path d="M5.9 18 H22.1 L21.5 28 Q21.3 30 19.5 30 H8.5 Q6.7 30 6.5 28 Z" fill={t.liquid} opacity="0.9" />}
        <rect x="3" y="3" width="22" height="6.5" rx="2" fill={t.cap} stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
      </svg>
    );
  }
  if (t.shape === "bottle") {
    return (
      <svg viewBox="0 0 22 36" width="20" height="33" className={cn("shrink-0 text-muted-foreground", className)} role="img" aria-label={t.label}>
        <title>{t.label}</title>
        <path d="M8 6 H14 V11 Q19 12 19 17 V31 Q19 34 16 34 H6 Q3 34 3 31 V17 Q3 12 8 11 Z" fill="var(--card)" stroke={STROKE} strokeWidth="1.2" strokeDasharray={body} />
        {filled && <path d="M3.6 21 H18.4 V31 Q18.4 33.4 16 33.4 H6 Q3.6 33.4 3.6 31 Z" fill={t.liquid} opacity="0.9" />}
        <rect x="7" y="1" width="8" height="5.5" rx="1.5" fill={t.cap} stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
        <rect x="6" y="23" width="10" height="6" rx="1" fill="var(--card)" opacity="0.85" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 36" width="13" height="33" className={cn("shrink-0 text-muted-foreground", className)} role="img" aria-label={t.label}>
      <title>{t.label}</title>
      <path d="M2.5 8 H11.5 V28 A4.5 4.5 0 0 1 2.5 28 Z" fill="var(--card)" stroke={STROKE} strokeWidth="1.2" strokeDasharray={body} />
      {filled && <path d="M3.1 17 H10.9 V28 A3.9 3.9 0 0 1 3.1 28 Z" fill={t.liquid} opacity="0.92" />}
      <rect x="1" y="1" width="12" height="7.5" rx="2" fill={t.cap} stroke="rgba(0,0,0,0.25)" strokeWidth="0.6" />
      <path d="M3.5 3.2 H10.5 M3.5 5.6 H10.5" stroke="rgba(255,255,255,0.45)" strokeWidth="0.7" />
    </svg>
  );
}

/** A machine drawn for each imaging modality. 24 by 24, stroke only. */
export function ModalityGlyph({ modality, className }: { modality: string; className?: string }) {
  const common = { fill: "none", stroke: STROKE, strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={cn("size-6 shrink-0", className)} role="img" aria-label={`${modality} scanner`}>
      <title>{modality}</title>
      {modality === "CR" && (
        <g {...common}>
          <rect x="7" y="2.5" width="10" height="5" rx="1.2" />
          <path d="M9 9.5 L5.5 17.5 M15 9.5 L18.5 17.5 M12 9.5 V17.5" strokeDasharray="1.6 2" />
          <rect x="3" y="18.5" width="18" height="3" rx="1" />
        </g>
      )}
      {modality === "CT" && (
        <g {...common}>
          <circle cx="12" cy="10.5" r="8" />
          <circle cx="12" cy="10.5" r="4" />
          <path d="M2.5 21.5 H21.5 M9 10.5 H15" />
        </g>
      )}
      {modality === "MR" && (
        <g {...common}>
          <rect x="2" y="3.5" width="20" height="14" rx="5" />
          <circle cx="12" cy="10.5" r="4" />
          <path d="M5 21 H19 M6.5 7 V14 M17.5 7 V14" />
        </g>
      )}
      {modality === "US" && (
        <g {...common}>
          <path d="M9 2.5 H15 V8 L13.5 11 H10.5 L9 8 Z" />
          <path d="M6 15.5 Q12 11.5 18 15.5 M4 19 Q12 13 20 19" />
          <path d="M12 14 V21" strokeDasharray="1 2" />
        </g>
      )}
      {modality === "MG" && (
        <g {...common}>
          <path d="M4 5.5 H20 M4 19 H20" />
          <path d="M7 19 C7 13 9 9.5 12 9.5 S17 13 17 19" />
          <circle cx="12" cy="14.5" r="1" />
        </g>
      )}
      {modality === "BMD" && (
        <g {...common}>
          <rect x="7" y="2.5" width="10" height="4.5" rx="1.6" />
          <rect x="7" y="9.5" width="10" height="4.5" rx="1.6" />
          <rect x="7" y="16.5" width="10" height="4.5" rx="1.6" />
          <path d="M3.5 4.7 H5.5 M3.5 11.7 H5.5 M3.5 18.7 H5.5 M18.5 4.7 H20.5 M18.5 11.7 H20.5 M18.5 18.7 H20.5" strokeDasharray="0.5 1.5" />
        </g>
      )}
      {!["CR", "CT", "MR", "US", "MG", "BMD"].includes(modality) && (
        <g {...common}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="12" cy="12" r="3.5" />
        </g>
      )}
    </svg>
  );
}

/**
 * A blister strip of eight cells. Cells that were already handed over are empty and dashed, cells still owed hold a capsule.
 * `share` is the part that is still left, 0 to 1.
 */
export function PillStrip({ left, className, label }: { left: number; className?: string; label?: string }) {
  const cells = 8;
  const full = Math.max(0, Math.min(cells, Math.round(left * cells)));
  return (
    <svg viewBox="0 0 72 22" width="72" height="22" className={cn("shrink-0 text-muted-foreground", className)} role="img" aria-label={label ?? `${full} of ${cells} cells still full`}>
      <rect x="1" y="1" width="70" height="20" rx="5" fill="var(--card)" stroke={STROKE} strokeWidth="1.2" />
      {Array.from({ length: cells }, (_, i) => {
        const cx = 8 + i * 8;
        const owed = i >= cells - full;
        return owed ? (
          <g key={i} transform={`rotate(-35 ${cx} 11)`}>
            <rect x={cx - 3} y="6.5" width="6" height="9" rx="3" fill="var(--merge)" opacity="0.9" />
            <rect x={cx - 3} y="11" width="6" height="4.5" rx="2.2" fill="var(--card)" opacity="0.65" />
          </g>
        ) : (
          <circle key={i} cx={cx} cy="11" r="3.4" fill="none" stroke={STROKE} strokeWidth="0.9" strokeDasharray="1.4 1.4" opacity="0.7" />
        );
      })}
    </svg>
  );
}

/** A red dot that pulses. Used when a result is critical. */
export function CriticalPulse({ text = "Critical" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-destructive/12 px-1.5 py-1 text-xs font-semibold leading-none text-destructive" role="status">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-70 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-destructive" />
      </span>
      {text}
    </span>
  );
}
