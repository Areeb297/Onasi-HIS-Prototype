import { describe, expect, it, vi } from "vitest";

/**
 * A brand new browser has no saved prescriptions. The demo prescriptions come from the visit store, which can load after rx.ts,
 * so they must be made on the first read and not when the file loads.
 */
const store = new Map<string, string>();
(globalThis as unknown as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe("the demo prescriptions in a fresh profile", () => {
  it("are there on the first read, even when the visit store is created after rx.ts is loaded", async () => {
    vi.resetModules();
    store.clear();
    const rx = await import("./rx"); // loads first: nothing is read yet
    const hs = await import("./store"); // the visit store loads after it
    void hs;
    const s = rx.getRx();
    expect(s.prescriptions.length).toBeGreaterThanOrEqual(3);
    expect(s.prescriptions.every((p) => p.sentAt)).toBe(true);
    // The seeded visits plus the past visits of the RCM sample patients (rcm-demo.ts).
    expect([...new Set(s.prescriptions.map((p) => p.patientId))]).toEqual(expect.arrayContaining(["P002", "P007", "P101"]));
  });

  it("are made from the visits that exist at the first read, not from the visits at load time (the bug in a fresh profile)", async () => {
    vi.resetModules();
    store.clear();
    let ready = false;
    vi.doMock("./store", async () => {
      const real = await vi.importActual<typeof import("./store")>("./store");
      const full = real.seedState();
      return { ...real, getState: () => (ready ? full : { ...full, encounters: [] }) };
    });
    try {
      const rx = await import("./rx"); // the visit store has no visits yet, as when the modules load in a cycle
      ready = true; // the visits exist from here on
      expect(rx.getRx().prescriptions.length).toBeGreaterThanOrEqual(3);
    } finally {
      vi.doUnmock("./store");
    }
  });

  it("do not overwrite what the browser already saved", async () => {
    vi.resetModules();
    store.clear();
    store.set("onasi-emr-rx-v2", JSON.stringify({ prescriptions: [], dispenses: [], sends: [], heights: {}, counters: { rx: 0, item: 0, disp: 0, ref: 0 } }));
    const rx = await import("./rx");
    expect(rx.getRx().prescriptions).toEqual([]);
  });

  it("keep their changes once the user acts, and reading alone saves nothing", async () => {
    vi.resetModules();
    store.clear();
    const rx = await import("./rx");
    rx.getRx();
    expect(store.has("onasi-emr-rx-v2")).toBe(false);
    rx.setHeight("V100001", "P001", 170);
    expect(store.has("onasi-emr-rx-v2")).toBe(true);
    expect(rx.getRx().prescriptions.length).toBeGreaterThanOrEqual(3);
  });
});
