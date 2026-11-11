import { audit } from "@/lib/audit";
import type { MoveVia } from "./types";

/** One audit entry for a move on a board. */
export function auditMove(target: string, toLabel: string, patient: string | undefined, via: MoveVia, detail: string) {
  audit("update", `${target} moved to ${toLabel}`, {
    patient,
    detail: `${detail}. Done with ${via === "drag" ? "drag and drop" : "the Move menu"} on the board.`,
  });
}
