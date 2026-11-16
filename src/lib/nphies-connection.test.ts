import { describe, expect, it } from "vitest";
import { connectionStatus, OUTBOX_USE_CASE } from "./nphies-connection";
import { USE_CASES } from "@/components/NphiesUseCaseIcon";

describe("NPHIES connection status", () => {
  it("counts a use case as connected once a message for it was accepted", () => {
    const s = connectionStatus(
      [{ type: "lab-order", state: "sent" }, { type: "rx", state: "changes" }, { type: "document", state: "rejected" }, { type: "visit", state: "not-sent" }],
      [{ visit: "V1", messages: [], eligibility: { status: "eligible", at: "", ref: "", note: "" } } as never],
    );
    expect(s["lab-order"]).toBe("connected");
    expect(s["e-prescribe"]).toBe("connected");
    expect(s["clinical-notes"]).toBe("not-yet");
    expect(s["visit-history"]).toBe("not-yet");
    expect(s.eligibility).toBe("connected");
    expect(s.claims).toBe("not-yet");
    expect(s.sso).toBe("not-built");
    expect(s["rad-view"]).toBe("not-built");
    // A rejected claim (NPHIES outcome error) does not prove the claims connection works.
    const r = connectionStatus([], [{ visit: "V2", messages: [], claim: { status: "rejected", at: "", ref: "", claimNumber: "CL00000001", note: "" } } as never]);
    expect(r.claims).toBe("not-yet");
  });

  it("has an icon entry for every NHIC use case and maps every send-list type", () => {
    expect(USE_CASES).toHaveLength(14);
    expect(new Set(USE_CASES.map((u) => u.id)).size).toBe(14);
    expect(Object.keys(connectionStatus([], [])).sort()).toEqual(USE_CASES.map((u) => u.id).sort());
    expect(Object.values(OUTBOX_USE_CASE).every((id) => id === "vitals" || USE_CASES.some((u) => u.id === id))).toBe(true);
  });
});
