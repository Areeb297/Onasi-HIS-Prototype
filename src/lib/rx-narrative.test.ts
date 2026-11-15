import { describe, expect, it } from "vitest";
import { dosageNarrative, stepNarrative } from "./fhir/medication";
import { DRUG_BY_ID } from "./rx-catalogue";
import { orderSteps, stepsOf, unitCount } from "./rx-logic";
import type { DoseStep, RxItem } from "./rx-types";
import { orderLine } from "./rx-verify";

const PARA = DRUG_BY_ID.DRG001;
const step = (dose: number, time: DoseStep["time"], days = 3): DoseStep => ({ dose, frequencyId: "OD", days, time });
const item = (over: Partial<RxItem>): RxItem => ({
  id: "i", identifier: "RXI-1", drugId: PARA.id, dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 3, quantity: 6, quantityManual: false, route: "PO",
  patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R50.9", text: "Fever" }, status: "active", version: 1, ...over,
});

describe("units and plurals", () => {
  it("writes one tablet and two tablets, and leaves mL alone", () => {
    expect(unitCount(1, "tablet")).toBe("1 tablet");
    expect(unitCount(2, "tablet")).toBe("2 tablets");
    expect(unitCount(0.5, "tablet")).toBe("0.5 tablets");
    expect(unitCount(5, "mL")).toBe("5 mL");
  });

  it("uses the plural in the split summary: 2 tablets, not 2 tablet", () => {
    expect(stepNarrative(PARA, step(2, "MORN"))).toBe("2 tablets once daily in the morning for 3 days");
    expect(stepNarrative(PARA, step(1, "NIGHT"))).toBe("1 tablet once daily at night for 3 days");
    expect(dosageNarrative(PARA, item({ dose: 2 }))).toContain("2 tablets");
    expect(dosageNarrative(PARA, item({ dose: 1 }))).toContain("1 tablet,");
  });
});

describe("split rows come in the order of the day", () => {
  const typed = [step(1, "NIGHT"), step(2, "EVE"), step(2, "MORN"), step(1, undefined), step(1, "NOON")];

  it("sorts morning, noon, evening, night, then a row with no time, keeping the typed order for equal times", () => {
    expect(orderSteps("split", typed).map((s) => s.time)).toEqual(["MORN", "NOON", "EVE", "NIGHT", undefined]);
    const two = [step(1, "EVE"), step(2, "EVE", 5)];
    expect(orderSteps("split", two).map((s) => s.days)).toEqual([3, 5]);
  });

  it("never reorders a taper, because its phases follow one another", () => {
    const taper: DoseStep[] = [{ dose: 3, frequencyId: "OD", days: 5 }, { dose: 2, frequencyId: "OD", days: 5 }, { dose: 1, frequencyId: "OD", days: 5 }];
    expect(orderSteps("taper", taper)).toEqual(taper);
  });

  it("is used when the item is read, so old saved prescriptions come out in order too", () => {
    const it = item({ regimen: "split", schedule: typed });
    expect(stepsOf(it).map((s) => s.time)).toEqual(["MORN", "NOON", "EVE", "NIGHT", undefined]);
    const text = dosageNarrative(PARA, it);
    expect(text.indexOf("in the morning")).toBeLessThan(text.indexOf("at noon"));
    expect(text.indexOf("at noon")).toBeLessThan(text.indexOf("in the evening"));
    expect(text.indexOf("in the evening")).toBeLessThan(text.indexOf("at night"));
    const line = orderLine(PARA, it).dose;
    expect(line.indexOf("Morning")).toBeLessThan(line.indexOf("Night"));
    expect(line).toContain("2 tablets");
  });
});
