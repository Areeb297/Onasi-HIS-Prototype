import { getRx } from "../rx";
import { isRaqeebScope } from "../rx-logic";
import type { CallEntry, IntegrationId } from "./call-log";
import { pretty } from "./call-log";

/**
 * Medication messages, read from the prescription store. A prescription with controlled medicines for an outpatient,
 * discharge or community setting is in Raqeeb scope: its prescribe and dispense messages are shown under Raqeeb.
 * Every other medication message is shown under NPHIES Clinical.
 */
export function medicationCalls(raqeeb: boolean): CallEntry[] {
  const s = getRx();
  const integration: IntegrationId = raqeeb ? "raqeeb" : "nphies-clinical";
  return s.sends.flatMap((rec): CallEntry[] => {
    const rxId = rec.kind === "prescription" ? rec.targetId : s.dispenses.find((d) => d.number === rec.targetId)?.rxId;
    const rx = s.prescriptions.find((p) => p.id === rxId);
    if ((rx ? isRaqeebScope(rx.controlled, rx.usage) : false) !== raqeeb) return [];
    return [{
      id: `RX-${rec.id}`, integration, at: rec.at, operation: rec.kind === "prescription" ? "Prescription" : "Dispense",
      summary: `${rx?.number ?? rec.targetId}. ${rec.summary}`, ok: rec.ok, format: "JSON", request: pretty(rec.bundle), response: pretty(rec.outcome),
    }];
  });
}

export const raqeebCalls = (): CallEntry[] => medicationCalls(true);
