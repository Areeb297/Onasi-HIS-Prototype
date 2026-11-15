import { describe, expect, it } from "vitest";
import { SingleSession, type Bus, type SessionMsg } from "./single-session";

/** An in-memory BroadcastChannel: every message goes to every other member, at once. */
function hub() {
  const members = new Set<(m: SessionMsg) => void>();
  return (): Bus => {
    let mine: ((m: SessionMsg) => void) | null = null;
    return {
      post: (m) => members.forEach((cb) => cb !== mine && cb(m)),
      listen: (cb) => { mine = cb; members.add(cb); return () => members.delete(cb); },
      close: () => {},
    };
  };
}

/** Timers run only when flush() is called, so each test decides when the wait ends. */
function timers() {
  const queue: (() => void)[] = [];
  return { setTimer: (fn: () => void) => { queue.push(fn); }, flush: () => queue.splice(0).forEach((f) => f()) };
}

describe("one copy per browser", () => {
  it("the first copy becomes active when nobody answers", () => {
    const t = timers();
    const a = new SingleSession(hub()(), { id: "a", startedAt: 1, setTimer: t.setTimer });
    a.start();
    expect(a.status).toBe("checking");
    t.flush();
    expect(a.status).toBe("active");
  });

  it("a second copy is blocked by the active one", () => {
    const bus = hub(); const t = timers();
    const a = new SingleSession(bus(), { id: "a", startedAt: 1, setTimer: t.setTimer });
    a.start(); t.flush();
    const b = new SingleSession(bus(), { id: "b", startedAt: 2, setTimer: t.setTimer });
    b.start(); t.flush();
    expect(a.status).toBe("active");
    expect(b.status).toBe("blocked");
    expect(b.reason).toBe("open-elsewhere");
  });

  it("two copies starting together: the older wins", () => {
    const bus = hub(); const t = timers();
    const a = new SingleSession(bus(), { id: "a", startedAt: 5, setTimer: t.setTimer });
    const b = new SingleSession(bus(), { id: "b", startedAt: 3, setTimer: t.setTimer });
    a.start(); b.start(); t.flush();
    expect(b.status).toBe("active");
    expect(a.status).toBe("blocked");
  });

  it("Use It Here Instead takes over, and the old copy stops", () => {
    const bus = hub(); const t = timers();
    const a = new SingleSession(bus(), { id: "a", startedAt: 1, setTimer: t.setTimer });
    a.start(); t.flush();
    const b = new SingleSession(bus(), { id: "b", startedAt: 9, setTimer: t.setTimer });
    b.start(true);
    expect(b.status).toBe("active");
    expect(a.status).toBe("blocked");
    expect(a.reason).toBe("taken-over");
    const c = new SingleSession(bus(), { id: "c", startedAt: 10, setTimer: t.setTimer });
    c.start(); t.flush();
    expect(c.status).toBe("blocked");
  });

  it("a crashed copy never locks anyone out, and a closed one is reported", () => {
    const bus = hub(); const t = timers();
    const a = new SingleSession(bus(), { id: "a", startedAt: 1, setTimer: t.setTimer });
    a.start(); t.flush();
    const b = new SingleSession(bus(), { id: "b", startedAt: 2, setTimer: t.setTimer });
    b.start(); t.flush();
    a.stop();
    expect(b.reason).toBe("other-closed");
    const c = new SingleSession(bus(), { id: "c", startedAt: 3, setTimer: t.setTimer });
    c.start(); t.flush();
    expect(c.status).toBe("active");
  });

  it("Switch To That Tab asks the active copy to focus", () => {
    const bus = hub(); const t = timers();
    let focused = 0;
    const a = new SingleSession(bus(), { id: "a", startedAt: 1, setTimer: t.setTimer, onFocusRequest: () => focused++ });
    a.start(); t.flush();
    const b = new SingleSession(bus(), { id: "b", startedAt: 2, setTimer: t.setTimer });
    b.start(); t.flush();
    b.requestFocus();
    expect(focused).toBe(1);
  });
});
