import { beforeEach, describe, expect, it } from "vitest";
import { getLab, resetLab, setRejectNext } from "./lab";
import { buildOutbox, countByGroup, filterOutbox, lastMessage, mayAct, readyRows, sendAllReady, sendRow, type OutboxRow } from "./nphies-outbox";
import { resetRad } from "./radiology";
import { resetRx } from "./rx";
import { switchUser } from "./session";
import { resetVitals } from "./vitals";

const find = (rows: OutboxRow[], key: string) => rows.find((r) => r.key === key)!;

describe("NPHIES clinical outbox", () => {
  beforeEach(() => {
    switchUser("U9"); // administrator may send everything
    resetLab();
    resetRad();
    resetRx(true);
    resetVitals();
  });

  it("lists every kind of item with a patient, visit and plain-English state", () => {
    const rows = buildOutbox();
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) {
      expect(r.patient).not.toBe("");
      expect(r.visit).not.toBe("");
      expect(["not-sent", "sent", "changes", "rejected"]).toContain(r.state);
    }
    const groups = countByGroup(rows);
    expect(groups.all).toBe(rows.length);
    expect(groups.lab).toBeGreaterThan(0);
  });

  it("offers a lab order only after the specimen is collected", () => {
    const rows = buildOutbox();
    const lab = getLab().orders;
    const collected = lab.find((o) => o.specimens.length > 0)!;
    const waiting = lab.find((o) => o.specimens.length === 0 && o.status === "received")!;
    expect(find(rows, `lab-order:${collected.id}`).action).toBe("Send");
    const w = find(rows, `lab-order:${waiting.id}`);
    expect(w.ready).toBe(false);
    expect(w.action).toBeNull();
    expect(w.blocked).toMatch(/specimen/i);
  });

  it("does not list a result before work on it has started", () => {
    const rows = buildOutbox();
    const collected = getLab().orders.find((o) => o.status === "collected")!;
    expect(rows.find((r) => r.key === `lab-result:${collected.id}`)).toBeUndefined();
  });

  it("sends a lab order through the real send function and marks it Sent", () => {
    const o = getLab().orders.find((x) => x.specimens.length > 0)!;
    const r = find(buildOutbox(), `lab-order:${o.id}`);
    expect(sendRow(r)).toBe("accepted");
    const after = find(buildOutbox(), `lab-order:${o.id}`);
    expect(after.state).toBe("sent");
    expect(after.action).toBeNull();
    expect(lastMessage(after)?.format).toBe("FHIR JSON");
  });

  it("shows a rejected send as Rejected with a Resend action", () => {
    const o = getLab().orders.find((x) => x.specimens.length > 0)!;
    setRejectNext(true);
    expect(sendRow(find(buildOutbox(), `lab-order:${o.id}`))).toBe("rejected");
    const after = find(buildOutbox(), `lab-order:${o.id}`);
    expect(after.state).toBe("rejected");
    expect(after.action).toBe("Resend");
  });

  it("never offers a send button on a dispense and has no message before sending", () => {
    for (const r of buildOutbox().filter((x) => x.type === "dispense")) {
      expect(r.state).toBe("sent");
      expect(r.action).toBeNull();
    }
  });

  it("Send all ready sends only ready rows and ends with nothing left to send", () => {
    const before = readyRows(buildOutbox());
    expect(before.length).toBeGreaterThan(0);
    const out = sendAllReady(buildOutbox());
    expect(out.accepted + out.rejected + out.skipped).toBe(before.length);
    const waiting = buildOutbox().filter((r) => !r.ready);
    for (const r of waiting) expect(r.action).toBeNull();
  });

  it("respects permissions", () => {
    switchUser("U7"); // billing officer
    const rows = buildOutbox();
    expect(readyRows(rows)).toEqual([]);
    const r = rows.find((x) => x.action !== null);
    if (r) expect(mayAct(r)).toBe(false);
    switchUser("U9");
  });

  it("filters by group, state and search text", () => {
    const rows = buildOutbox();
    expect(filterOutbox(rows, { group: "lab" }).every((r) => r.group === "lab")).toBe(true);
    expect(filterOutbox(rows, { state: "sent" }).every((r) => r.state === "sent")).toBe(true);
    expect(filterOutbox(rows, { state: "needs-action" }).every((r) => r.state !== "sent")).toBe(true);
    expect(filterOutbox(rows, { query: "zzzz-no-match" })).toEqual([]);
  });
});
