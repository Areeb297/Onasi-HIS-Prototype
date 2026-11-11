import type { Encounter, HisState, LogEntry } from "./model";

/** Messages for a visit. A50 changes the visit number, so the older numbers are followed too. */
export function visitMessages(state: HisState, enc: Encounter): LogEntry[] {
  const ids = new Set([enc.visitNumber]);
  for (const m of state.log) {
    if (m.eventId === "A50" && ids.has(m.visitNumber)) {
      const mrg = m.message.split("\r").find((l) => l.startsWith("MRG|"));
      const old = mrg?.split("|")[5]?.split("^")[0];
      if (old) ids.add(old);
    }
  }
  return state.log.filter((m) => ids.has(m.visitNumber));
}
