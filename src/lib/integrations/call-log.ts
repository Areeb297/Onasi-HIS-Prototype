import { audit } from "../audit";
import { createStore } from "../fhir/store-util";
import { can, currentUser } from "../session";

/**
 * The shared call log of the national integrations, and the status of each one.
 * Yakeen, RSD and Seha write their calls here. NPHIES, Raqeeb and ZATCA already keep their own records, so their
 * modules read those instead of copying them. Everything is simulated: no call leaves the browser.
 */

export type IntegrationId = "nphies-financial" | "nphies-clinical" | "raqeeb" | "yakeen" | "rsd" | "seha" | "zatca";

export type Mode = "connected" | "test" | "off";
export const MODES: Mode[] = ["connected", "test", "off"];
export const MODE_LABEL: Record<Mode, string> = { connected: "Connected", test: "Test", off: "Off" };
export const MODE_TONE: Record<Mode, "ok" | "warn" | "neutral"> = { connected: "ok", test: "warn", off: "neutral" };
const ENVIRONMENT: Record<Mode, string> = { connected: "Production", test: "Sandbox", off: "Not Connected" };

const DEFAULT_MODE: Record<IntegrationId, Mode> = {
  "nphies-financial": "connected", "nphies-clinical": "test", raqeeb: "test", yakeen: "connected", rsd: "test", seha: "connected", zatca: "connected",
};

export interface CallEntry {
  id: string;
  integration: IntegrationId;
  /** ISO time the request was sent. */
  at: string;
  /** What was asked, for example "Identity Lookup". */
  operation: string;
  /** One line a person can read. */
  summary: string;
  ok: boolean;
  /** Decides how the log shows the text: JSON is formatted, HL7 is highlighted. */
  format: "JSON" | "HL7 v2" | "XML";
  request: string;
  response: string;
  by?: string;
}

interface State {
  calls: CallEntry[];
  seq: number;
  modes: Partial<Record<IntegrationId, Mode>>;
}

const KEEP = 300;
const store = createStore<State>("onasi-emr-integration-calls-v1", () => ({ calls: [], seq: 0, modes: {} }));
export const useCallLog = store.use;
export const resetCallLog = store.reset;
export const ownCalls = (id: IntegrationId): CallEntry[] => store.get().calls.filter((c) => c.integration === id);

export const modeOf = (id: IntegrationId): Mode => store.get().modes[id] ?? DEFAULT_MODE[id];
export const environmentOf = (id: IntegrationId): string => ENVIRONMENT[modeOf(id)];
export const isOff = (id: IntegrationId): boolean => modeOf(id) === "off";

/** Only the System Administrator switches an integration on or off. */
export function setMode(id: IntegrationId, mode: Mode): boolean {
  if (!can("admin")) return false;
  const s = store.get();
  store.set({ ...s, modes: { ...s.modes, [id]: mode } });
  audit("update", `Integration ${id}`, { detail: `Status set to ${MODE_LABEL[mode]}` });
  return true;
}

export const pretty = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Records one simulated call. `request` and `response` may be objects: they are stored as formatted JSON. */
export function logCall(c: { integration: IntegrationId; operation: string; summary: string; ok: boolean; request: unknown; response: unknown }, now: number = Date.now()): CallEntry {
  const s = store.get();
  const seq = s.seq + 1;
  let by = "Unknown";
  try { by = currentUser().name; } catch { /* no session in some tests */ }
  const entry: CallEntry = {
    id: `CALL-${seq}`, integration: c.integration, at: new Date(now).toISOString(), operation: c.operation, summary: c.summary, ok: c.ok,
    format: "JSON", request: pretty(c.request), response: pretty(c.response), by,
  };
  store.set({ ...s, seq, calls: [...s.calls, entry].slice(-KEEP) });
  return entry;
}
