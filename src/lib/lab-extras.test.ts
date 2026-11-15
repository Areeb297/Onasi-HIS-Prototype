import { beforeEach, describe, expect, it } from "vitest";
import { collectSpecimens, getLab, getOrder, resetLab } from "./lab";
import {
  defaultSampleDetails, getLabExtras, isReceived, markLabelsPrinted, notesOf, receiveSample, recordSampleDetails, resetLabExtras, saveNotes, sampleOf, specimenBarcode,
} from "./lab-extras";
import { switchUser } from "./session";

const waiting = () => getLab().orders.find((o) => o.status === "received")!;

describe("laboratory sample extras", () => {
  beforeEach(() => {
    switchUser("U9");
    resetLab();
    resetLabExtras();
  });

  it("starts with the usual choices for the specimen type", () => {
    expect(defaultSampleDetails(["BLD", "SER"])).toMatchObject({ method: "Venipuncture", source: "Left Arm", risk: "Standard Precautions" });
    expect(defaultSampleDetails(["URN"])).toMatchObject({ method: "Clean Catch Urine", source: "Urethra" });
    expect(defaultSampleDetails(["NPS"])).toMatchObject({ method: "Swab", source: "Nose" });
  });

  it("keeps the sample details, makes one barcode for each specimen and tells when it was received", () => {
    const id = waiting().id;
    expect(collectSpecimens(id)).toBe(true);
    const o = getOrder(id)!;
    expect(recordSampleDetails(o, { method: "Venipuncture", source: "Right Arm", care: "Keep On Ice", risk: "Biohazard" })).toBe(true);
    expect(sampleOf(o)?.details?.source).toBe("Right Arm");
    expect(isReceived(o)).toBe(false);
    for (const s of o.specimens) expect(specimenBarcode(s)).toBe(s.id.toUpperCase());
    expect(new Set(o.specimens.map(specimenBarcode)).size).toBe(o.specimens.length);

    expect(receiveSample(o)).toBe(true);
    expect(isReceived(getOrder(id)!)).toBe(true);
    expect(sampleOf(o)?.details?.care).toBe("Keep On Ice"); // receiving does not drop the details
    expect(sampleOf(o)?.receivedBy).toBeTruthy();
  });

  it("counts label prints", () => {
    const id = waiting().id;
    collectSpecimens(id);
    const o = getOrder(id)!;
    markLabelsPrinted(o);
    markLabelsPrinted(o);
    expect(sampleOf(o)?.labelsPrinted).toBe(2);
  });

  it("does nothing for an order with no specimen", () => {
    const o = waiting();
    expect(recordSampleDetails(o, defaultSampleDetails([]))).toBe(false);
    expect(receiveSample(o)).toBe(false);
  });

  it("ignores an entry that belongs to an older collection, so a reset cannot leave a stale one", () => {
    const id = waiting().id;
    collectSpecimens(id, "2026-11-01T08:00:00.000Z");
    receiveSample(getOrder(id)!);
    expect(isReceived(getOrder(id)!)).toBe(true);
    resetLab(); // the order is waiting again; the extras store was not cleared
    collectSpecimens(id, "2026-11-02T08:00:00.000Z");
    expect(getLabExtras().samples[id]).toBeTruthy();
    expect(isReceived(getOrder(id)!)).toBe(false);
  });

  it("an order saved before this feature has no entry and still opens", () => {
    const o = getLab().orders.find((x) => x.specimens.length > 0)!;
    expect(sampleOf(o)).toBeUndefined();
    expect(isReceived(o)).toBe(false);
  });

  it("saves the conclusion and comments, and only for a user who may enter results", () => {
    expect(saveNotes("LO-100001", { conclusion: "No anaemia", comments: "Repeat in a week" })).toBe(true);
    expect(notesOf("LO-100001")).toMatchObject({ conclusion: "No anaemia", comments: "Repeat in a week" });
    switchUser("U1"); // physician has no lab.result permission
    expect(saveNotes("LO-100002", { conclusion: "x", comments: "y" })).toBe(false);
    expect(notesOf("LO-100002")).toBeUndefined();
  });

  it("the receive step needs the lab.result permission", () => {
    const id = waiting().id;
    collectSpecimens(id);
    switchUser("U1");
    expect(receiveSample(getOrder(id)!)).toBe(false);
    expect(isReceived(getOrder(id)!)).toBe(false);
  });
});
