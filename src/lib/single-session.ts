import { useSyncExternalStore } from "react";

/**
 * One active copy of Onasi HIS per browser. Two copies in two tabs could show different patients side by side and
 * overwrite each other's saved data, so only one copy is active at a time.
 *
 * Handshake over a BroadcastChannel (or localStorage "storage" events where BroadcastChannel is missing):
 * 1. A new copy says "hello" and waits a moment.
 * 2. An active copy answers "active". The new copy then shows the notice and stays blocked.
 * 3. No answer: the new copy becomes active. A copy that crashed cannot answer, so it never locks anyone out.
 * 4. Two copies starting together: the one that started first wins, the other blocks.
 * 5. "Use It Here Instead" reloads the blocked copy with a take-over flag (so its data is read fresh); on start it
 *    says "takeover", and the old copy blocks and stops editing.
 * 6. "Switch To That Tab" asks the active copy to focus itself. Browsers often refuse, so the notice also explains.
 */

export type SessionStatus = "checking" | "active" | "blocked";
export type BlockReason = "open-elsewhere" | "taken-over" | "other-closed";

export interface SessionMsg { type: "hello" | "active" | "takeover" | "focus" | "bye"; id: string; startedAt: number; to?: string }

export interface Bus {
  post(m: SessionMsg): void;
  listen(cb: (m: SessionMsg) => void): () => void;
  close(): void;
}

const CHANNEL = "onasi-his-session";
const TAKEOVER_FLAG = "onasi-his-takeover";
export const WAIT_MS = 350;

/** BroadcastChannel when the browser has it, otherwise localStorage events. */
export function browserBus(): Bus {
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel(CHANNEL);
    return {
      post: (m) => ch.postMessage(m),
      listen: (cb) => {
        const h = (e: MessageEvent) => cb(e.data as SessionMsg);
        ch.addEventListener("message", h);
        return () => ch.removeEventListener("message", h);
      },
      close: () => ch.close(),
    };
  }
  return {
    post: (m) => {
      try { localStorage.setItem(CHANNEL, JSON.stringify({ ...m, nonce: Math.random() })); } catch { /* storage blocked: nothing to coordinate with */ }
    },
    listen: (cb) => {
      const h = (e: StorageEvent) => {
        if (e.key !== CHANNEL || !e.newValue) return;
        try { cb(JSON.parse(e.newValue) as SessionMsg); } catch { /* ignore */ }
      };
      window.addEventListener("storage", h);
      return () => window.removeEventListener("storage", h);
    },
    close: () => {},
  };
}

export interface SessionOptions {
  id?: string;
  startedAt?: number;
  waitMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Called when another copy asks this one to come to the front. */
  onFocusRequest?: () => void;
}

export class SingleSession {
  readonly id: string;
  readonly startedAt: number;
  status: SessionStatus = "checking";
  reason: BlockReason | null = null;
  private answered = false;
  private yieldTo = false;
  private off: () => void = () => {};
  private listeners = new Set<() => void>();

  constructor(private bus: Bus, private opts: SessionOptions = {}) {
    this.id = opts.id ?? Math.random().toString(36).slice(2, 10);
    this.startedAt = opts.startedAt ?? Date.now();
  }

  private me(type: SessionMsg["type"], to?: string): SessionMsg {
    return { type, id: this.id, startedAt: this.startedAt, ...(to ? { to } : {}) };
  }

  private set(status: SessionStatus, reason: BlockReason | null = null) {
    this.status = status;
    this.reason = reason;
    this.listeners.forEach((l) => l());
  }

  /** Starts the handshake. With `takeover`, this copy becomes active at once and the other copy blocks. */
  start(takeover = false) {
    this.off = this.bus.listen((m) => this.receive(m));
    if (takeover) {
      this.set("active");
      this.bus.post(this.me("takeover"));
      return;
    }
    this.bus.post(this.me("hello"));
    const timer = this.opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    timer(() => {
      if (this.status !== "checking") return;
      if (this.answered || this.yieldTo) this.set("blocked", "open-elsewhere");
      else this.set("active");
    }, this.opts.waitMs ?? WAIT_MS);
  }

  receive(m: SessionMsg) {
    if (m.id === this.id || (m.to && m.to !== this.id)) return;
    switch (m.type) {
      case "hello":
        if (this.status === "active") this.bus.post(this.me("active", m.id));
        else if (this.status === "checking" && (m.startedAt < this.startedAt || (m.startedAt === this.startedAt && m.id < this.id))) this.yieldTo = true;
        break;
      case "active":
        if (this.status === "checking") this.answered = true;
        break;
      case "takeover":
        if (this.status !== "blocked" || this.reason !== "taken-over") this.set("blocked", "taken-over");
        break;
      case "focus":
        if (this.status === "active") this.opts.onFocusRequest?.();
        break;
      case "bye":
        if (this.status === "blocked") this.set("blocked", "other-closed");
        break;
    }
  }

  /** Asks the active copy to come to the front. */
  requestFocus() {
    this.bus.post(this.me("focus"));
  }

  /** Tells the others this copy is closing. */
  stop() {
    if (this.status === "active") this.bus.post(this.me("bye"));
    this.off();
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

/* ---------- the browser's copy ---------- */

let session: SingleSession | null = null;
const ACTIVE_SNAPSHOT = { status: "active" as SessionStatus, reason: null as BlockReason | null };
let snap = { status: "checking" as SessionStatus, reason: null as BlockReason | null };

function ensure(): SingleSession | null {
  if (typeof window === "undefined") return null;
  if (session) return session;
  session = new SingleSession(browserBus(), { onFocusRequest: () => window.focus() });
  session.subscribe(() => { snap = { status: session!.status, reason: session!.reason }; });
  let takeover = false;
  try {
    takeover = sessionStorage.getItem(TAKEOVER_FLAG) === "1";
    sessionStorage.removeItem(TAKEOVER_FLAG);
  } catch { /* ignore */ }
  session.start(takeover);
  window.addEventListener("pagehide", () => session?.stop());
  return session;
}

export function useSingleSession(): { status: SessionStatus; reason: BlockReason | null } {
  const s = ensure();
  return useSyncExternalStore(
    (cb) => (s ? s.subscribe(cb) : () => {}),
    () => (s ? snap : ACTIVE_SNAPSHOT),
    () => ACTIVE_SNAPSHOT,
  );
}

/** "Use It Here Instead": reload with the take-over flag, so this copy reads the latest saved data and the other blocks. */
export function useItHere() {
  try { sessionStorage.setItem(TAKEOVER_FLAG, "1"); } catch { /* without sessionStorage the handshake still runs */ }
  window.location.reload();
}

export const switchToOther = () => session?.requestFocus();
