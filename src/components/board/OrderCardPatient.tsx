import type { Patient } from "@/lib/model";
import { hasGlass } from "@/lib/session";
import { patientName } from "@/lib/store";
import { ageSex } from "./board-util";
import { elapsedMin, fmtDuration } from "./clock";

/**
 * Who the card is about, for the laboratory and radiology boards: the patient name (opens the order), the MRN,
 * age and sex, and how long ago the order was placed. Staff never see an internal order number; Developer View adds it.
 * Confidential patients are masked until break the glass.
 */
export function OrderCardPatient({ patient, orderedAt, onOpen, now, devExtra }: { patient?: Patient; orderedAt: string; onOpen?: () => void; now: number; /** Developer View only: order and visit numbers. */ devExtra?: string }) {
  const masked = !!patient?.confidential && !hasGlass(patient.id);
  const name = masked ? "Confidential patient" : patientName(patient);
  return (
    <div className="min-w-0">
      {onOpen ? (
        <button type="button" onClick={onOpen} className="block max-w-full truncate text-left text-sm font-semibold text-move hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {name}
        </button>
      ) : (
        <div className="truncate text-sm font-semibold">{name}</div>
      )}
      <div className="truncate text-xs text-foreground/80">
        {patient ? (
          <>
            MRN <span className="font-mono">{patient.mrn}</span>
            {!masked && ` · ${ageSex(patient, now)}`}
          </>
        ) : (
          "Patient not found"
        )}
      </div>
      <div className="text-xs text-muted-foreground">Ordered {orderAge(orderedAt, now)}</div>
      {devExtra && <div className="truncate font-mono text-xs text-muted-foreground">{devExtra}</div>}
    </div>
  );
}

/** "25m ago", "1h 20m ago", or "just now" in the first minute. */
export function orderAge(orderedAt: string, now: number): string {
  const min = elapsedMin(orderedAt, now);
  return min < 1 ? "just now" : `${fmtDuration(min)} ago`;
}
