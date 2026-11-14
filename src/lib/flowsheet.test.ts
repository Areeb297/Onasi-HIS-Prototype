import { describe, expect, it } from "vitest";
import { EMR_FORM_BY_ID } from "./emr-forms";
import { ageYears, allergyText, computeValues, fitsAge, fluidDays, prefillValues, scoreSummary, shiftAt, signedMl } from "./flowsheet";

const form = (id: string) => EMR_FORM_BY_ID[id];

describe("worked-out totals", () => {
  const io = form("intake-output");

  it("adds intake and output and works out the balance", () => {
    const v = computeValues(io, { oral: 400, iv: 1000, urine: 900, drain: 50 });
    expect(v.totalIntake).toBe(1400);
    expect(v.totalOutput).toBe(950);
    expect(v.balance).toBe(450);
  });

  it("shows a negative balance when more went out than came in", () => {
    expect(computeValues(io, { oral: 200, urine: 800 }).balance).toBe(-600);
  });

  it("leaves the totals empty until a number is entered", () => {
    const v = computeValues(io, { stool: "2 loose stools" });
    expect(v.totalIntake).toBe("");
    expect(v.balance).toBe("");
  });

  it("ignores a typed total, the system value wins", () => {
    expect(computeValues(io, { oral: 100, totalIntake: 9999 }).totalIntake).toBe(100);
  });
});

describe("risk bands", () => {
  it("names the Braden band only when all six items are answered", () => {
    const f = form("pressure-ulcer-chart");
    const part = scoreSummary(f, { sensory: "1", moisture: "1" });
    expect(part.complete).toBe(false);
    expect(part.band).toBeUndefined();
    expect(part.missing).toHaveLength(4);

    const worst = scoreSummary(f, { sensory: "1", moisture: "1", activity: "1", mobility: "1", nutrition: "1", friction: "1" });
    expect(worst.total).toBe(6);
    expect(worst.band?.label).toBe("Very high risk");
    const best = scoreSummary(f, { sensory: "4", moisture: "4", activity: "4", mobility: "4", nutrition: "4", friction: "3" });
    expect(best.total).toBe(23);
    expect(best.band?.label).toBe("No risk");
  });

  it("covers every possible Braden total with exactly one band", () => {
    const bands = form("pressure-ulcer-chart").scoreBands!;
    for (let t = 6; t <= 23; t++) expect(bands.filter((b) => t >= b.min && t <= b.max), `total ${t}`).toHaveLength(1);
  });

  it("puts the Humpty Dumpty cut-off at 12", () => {
    const bands = form("pediatric-fall-risk").scoreBands!;
    const label = (t: number) => bands.find((b) => t >= b.min && t <= b.max)?.label;
    expect(label(7)).toBe("Low risk");
    expect(label(11)).toBe("Low risk");
    expect(label(12)).toBe("High risk");
    expect(label(23)).toBe("High risk");
  });

  it("scores the Morse Fall Scale from 0 to 125 with its three bands", () => {
    const f = form("adult-fall-risk");
    const keys = ["history", "secondaryDx", "aid", "ivLine", "gait", "mental"];
    const pick = (best: boolean) => Object.fromEntries(keys.map((k) => {
      const opts = f.fields.find((x) => x.key === k)!.options!.map((o) => o as { value: string; score: number }).sort((a, b) => a.score - b.score);
      return [k, (best ? opts[0] : opts[opts.length - 1]).value];
    }));
    expect(scoreSummary(f, pick(true)).total).toBe(0);
    expect(scoreSummary(f, pick(true)).band?.label).toBe("Low risk");
    expect(scoreSummary(f, pick(false)).total).toBe(125);
    expect(scoreSummary(f, pick(false)).band?.label).toBe("High risk");
    expect(scoreSummary(f, { ...pick(true), history: "yes" }).band?.label).toBe("Moderate risk");
    expect(scoreSummary(f, { history: "yes" }).complete).toBe(false);
  });

  it("names the pain band", () => {
    const f = form("nursing-pain-scale");
    expect(scoreSummary(f, { score: 0 }).band?.label).toBe("No pain");
    expect(scoreSummary(f, { score: 3 }).band?.label).toBe("Mild pain");
    expect(scoreSummary(f, { score: 6 }).band?.label).toBe("Moderate pain");
    expect(scoreSummary(f, { score: 7 }).band?.label).toBe("Severe pain");
    expect(scoreSummary(f, {}).complete).toBe(false);
  });
});

describe("shifts and starting values", () => {
  it("maps the time of day to a shift", () => {
    expect(shiftAt(new Date(2026, 0, 5, 7, 0))).toBe("Morning");
    expect(shiftAt(new Date(2026, 0, 5, 14, 59))).toBe("Morning");
    expect(shiftAt(new Date(2026, 0, 5, 15, 0))).toBe("Evening");
    expect(shiftAt(new Date(2026, 0, 5, 23, 0))).toBe("Night");
    expect(shiftAt(new Date(2026, 0, 5, 6, 59))).toBe("Night");
  });

  it("starts a new intake and output record on today's date and the running shift", () => {
    const v = prefillValues(form("intake-output"), new Date(2026, 2, 9, 16, 5));
    expect(v.chartDate).toBe("2026-03-09");
    expect(v.shift).toBe("Evening");
  });
});

describe("age-appropriate tools", () => {
  it("works out the age in whole years", () => {
    expect(ageYears("2020-06-15", new Date(2026, 5, 14))).toBe(5);
    expect(ageYears("2020-06-15", new Date(2026, 5, 15))).toBe(6);
  });

  it("offers the paediatric fall tool to children only and the adult tool to adults only", () => {
    const child = form("pediatric-fall-risk"), adult = form("adult-fall-risk");
    expect(fitsAge(child, 6)).toBe(true);
    expect(fitsAge(adult, 6)).toBe(false);
    expect(fitsAge(child, 40)).toBe(false);
    expect(fitsAge(adult, 40)).toBe(true);
    expect(fitsAge(adult, 14)).toBe(true);
    expect(fitsAge(child, 13)).toBe(true);
    expect(fitsAge(form("nursing-pain-scale"), 6)).toBe(true);
    expect(child.alternative).toBe("adult-fall-risk");
    expect(adult.alternative).toBe("pediatric-fall-risk");
  });
});

describe("allergies from the chart", () => {
  it("writes the chart allergies as one line", () => {
    expect(allergyText([])).toBe("No allergies recorded in the chart");
    expect(allergyText([{ text: "Penicillin", severity: "SV", reaction: "Rash" }, { text: "Latex", severity: "MI" }])).toBe("Penicillin (severe, Rash); Latex (mild)");
  });
});

describe("fluid balance by shift and day", () => {
  const rec = (values: Record<string, string | number>) => ({ values });

  it("adds up each shift and the 24 hours", () => {
    const days = fluidDays([
      rec({ chartDate: "2026-03-09", shift: "Morning", oral: 500, iv: 500, urine: 600 }),
      rec({ chartDate: "2026-03-09", shift: "Morning", oral: 100 }),
      rec({ chartDate: "2026-03-09", shift: "Night", iv: 250, urine: 700, vomit: 100 }),
      rec({ chartDate: "2026-03-10", shift: "Evening", oral: 300, urine: 100 }),
      rec({ shift: "Evening", oral: 999 }),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-03-10", "2026-03-09"]);
    const d = days[1];
    expect(d.shifts.Morning).toEqual({ intake: 1100, output: 600, balance: 500 });
    expect(d.shifts.Evening).toBeNull();
    expect(d.shifts.Night).toEqual({ intake: 250, output: 800, balance: -550 });
    expect(d).toMatchObject({ intake: 1350, output: 1400, balance: -50 });
  });

  it("always writes the sign of a balance", () => {
    expect(signedMl(250)).toBe("+250 mL");
    expect(signedMl(-50)).toBe("-50 mL");
    expect(signedMl(0)).toBe("0 mL");
  });
});

describe("nursing forms record the nurse and show the shift", () => {
  it("has no typed signature left on nursing forms", () => {
    const typed = Object.values(EMR_FORM_BY_ID).filter((f) => f.group === "Nursing").flatMap((f) => f.fields.filter((x) => /(assessed|turned|checked|recorded) by/i.test(x.label) && x.auto !== "user").map((x) => `${f.id}.${x.key}`));
    expect(typed).toEqual([]);
  });

  it("uses the same three shifts on every shift picker", () => {
    for (const f of Object.values(EMR_FORM_BY_ID)) {
      for (const x of f.fields.filter((y) => y.prefill === "shift")) expect(x.options, `${f.id}.${x.key}`).toEqual(["Morning", "Evening", "Night"]);
    }
  });
});
