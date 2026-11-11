import { beforeEach, describe, expect, it } from "vitest";
import { pretty } from "./hl7";
import { getState } from "./store";
import {
  amendPanel, buildOru, cancelPanel, cancelReading, claimReadiness, claimVitalsJson, getVitals, needsSend, panelsOf, resetVitals,
  savePanel, scenarioCoverage, sendHistorical, sendPanel, validateOru, setVitalsRejectNext,
} from "./vitals";
import { VITALS, bmiOf, flagFor, news2 } from "./vitals-spec";

const visitOf = (pid: string) => [...getState().encounters].reverse().find((e) => e.patientId === pid && e.status !== "cancelled")!.visitNumber;
const ctxOf = (visit: string) => {
  const enc = getState().encounters.find((e) => e.visitNumber === visit)!;
  return { enc, patient: getState().patients.find((p) => p.id === enc.patientId)! };
};
const FULL = { sbp: 120, dbp: 80, pulse: 80, rr: 16, temp: 37, spo2: 98, weight: 70, height: 170 };

beforeEach(() => resetVitals());

describe("value set", () => {
  it("uses the codes and units of the NPHIES vital signs value set", () => {
    const want: Record<string, string> = {
      "8480-6": "mm[Hg]", "8462-4": "mm[Hg]", "8867-4": "{beats}/min", "9279-1": "{breaths}/min", "8310-5": "cel",
      "59408-5": "%", "29463-7": "kg", "8302-2": "cm",
    };
    for (const v of VITALS) expect(want[v.loinc], v.loinc).toBe(v.unit);
    expect(VITALS.length).toBe(8);
  });
  it("uses the UCUM units of the claim rules for claims", () => {
    expect(VITALS.find((v) => v.key === "temp")!.claimUnit).toBe("Cel");
    expect(VITALS.find((v) => v.key === "pulse")!.claimUnit).toBe("/min");
  });
});

describe("ORU message", () => {
  it("builds a valid ORU^R01 with the fixed panel code, Health ID and visit number", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "admission", values: FULL })!;
    const { enc, patient } = ctxOf(visit);
    const { segs, message } = buildOru([p], patient, enc, "CTRL1");
    const checks = validateOru(segs);
    expect(checks.filter((c) => c.level === "error")).toEqual([]);
    const lines = pretty(message).split("\n");
    expect(lines[0]).toContain("ORU^R01^ORU_R01");
    expect(lines[0]).toContain("nphies^2.16.840.1.113883.3.3731.1.2.2^ISO");
    expect(message).toContain("85353-1^Vital Signs Panel^2.16.840.1.113883.6.1");
    expect(lines.find((l) => l.startsWith("PID"))).toContain("&2.16.840.1.113883.3.3731.1.1.100.1&ISO");
    expect(lines.find((l) => l.startsWith("PV1"))).toContain(visit);
    expect(lines.filter((l) => l.startsWith("OBX")).length).toBeGreaterThanOrEqual(8);
    const obr = lines.find((l) => l.startsWith("OBR"))!.split("|");
    expect(obr[7]).toBe(obr[22]); // OBR-7 and OBR-22 are the same time
    expect(obr[25]).toBe("F");
    expect(obr[2]).toContain("^^2.16.840.1.113883.3.3731.5.1.");
  });

  it("adds BMI when weight and height are both there", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "other", values: FULL })!;
    const { enc, patient } = ctxOf(visit);
    expect(buildOru([p], patient, enc, "C").message).toContain("39156-5^Body mass index");
    expect(bmiOf(70, 170)).toBe(24.2);
  });

  it("does not send absence reasons in the ORU", () => {
    const visit = visitOf("P004");
    const p = savePanel({ visit, context: "other", values: { sbp: 110, dbp: 70 }, absences: { pulse: { code: "998", label: "Not recorded" } } })!;
    const { enc, patient } = ctxOf(visit);
    expect(buildOru([p], patient, enc, "C").message).not.toContain("8867-4");
  });

  it("catches wrong units, missing Health ID and different observation times", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "other", values: FULL })!;
    const { enc, patient } = ctxOf(visit);
    const bad = buildOru([p], { ...patient, healthId: "" }, enc, "C");
    expect(validateOru(bad.segs).some((c) => c.level === "error" && c.text.includes("PID-3"))).toBe(true);
    const unit = buildOru([p], patient, enc, "C");
    const obx = unit.segs.find((s) => (s.id as string) === "OBX")!;
    obx.f[6] = "mmHg";
    expect(validateOru(unit.segs).some((c) => c.text.includes("OBX-6 unit"))).toBe(true);
    const time = buildOru([p], patient, enc, "C");
    const obr = time.segs.find((s) => (s.id as string) === "OBR")!;
    obr.f[22] = "20200101000000+0300";
    expect(validateOru(time.segs).some((c) => c.text.includes("OBR-7 and OBR-22"))).toBe(true);
  });
});

describe("send, amend and cancel", () => {
  it("accepts a new panel, then a correction replaces it with status C", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "routine", values: FULL })!;
    expect(needsSend(p)).toBe(true);
    const r1 = sendPanel(p.id)!;
    expect(r1.accepted).toBe(true);
    expect(r1.ack).toContain("MSA|AA|");
    expect(needsSend(getVitals().panels.find((x) => x.id === p.id)!)).toBe(false);

    const fixed = amendPanel(p.id, { values: { ...FULL, temp: 38.2 } })!;
    expect(fixed.status).toBe("C");
    expect(fixed.version).toBe(2);
    expect(fixed.obs.find((o) => o.key === "temp")!.status).toBe("C");
    expect(fixed.obs.find((o) => o.key === "pulse")!.status).toBe("F");
    expect(needsSend(fixed)).toBe(true);
    const r2 = sendPanel(p.id)!;
    expect(r2.kind).toBe("amend");
    expect(r2.accepted).toBe(true);
    expect(r2.message).toMatch(/OBR\|1\|[^|]*\|[^|]*\|[^|]*\|\|\|[^|]*\|\|\|\|\|\|\|\|\|[^|]*\|\|\|\|\|\|[^|]*\|\|\|C/);
  });

  it("cancels a whole panel with OBR-25 X and every OBX D or W", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "routine", values: FULL })!;
    sendPanel(p.id);
    expect(cancelPanel(p.id, "W")).toBe(true);
    const rec = sendPanel(p.id)!;
    expect(rec.kind).toBe("cancel");
    expect(rec.accepted).toBe(true);
    const lines = pretty(rec.message).split("\n");
    expect(lines.find((l) => l.startsWith("OBR"))!.split("|")[25]).toBe("X");
    for (const l of lines.filter((x) => x.startsWith("OBX"))) expect(l.split("|")[11]).toBe("W");
  });

  it("cancels one reading with OBX-11 D", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "routine", values: FULL })!;
    sendPanel(p.id);
    cancelReading(p.id, "temp", "D");
    const rec = sendPanel(p.id)!;
    const temp = pretty(rec.message).split("\n").find((l) => l.includes("8310-5"))!;
    expect(temp.split("|")[11]).toBe("D");
  });

  it("rejects when the tester asks for it", () => {
    const visit = visitOf("P001");
    const p = savePanel({ visit, context: "routine", values: FULL })!;
    setVitalsRejectNext(true);
    const rec = sendPanel(p.id)!;
    expect(rec.accepted).toBe(false);
    expect(rec.ack).toContain("MSA|AE|");
    expect(rec.ack).toContain("ERR|");
  });

  it("sends a historical batch with several OBR groups in one message", () => {
    const visit = visitOf("P001");
    const rec = sendHistorical(visit)!;
    expect(rec.accepted).toBe(true);
    expect(rec.message.split("\r").filter((l) => l.startsWith("OBR|")).length).toBeGreaterThanOrEqual(2);
    expect(scenarioCoverage(visit).find((s) => s.id === "h")!.done).toBe(true);
  });

  it("keeps the chart header in step with the newest panel", () => {
    const visit = visitOf("P004");
    savePanel({ visit, context: "other", values: { ...FULL, sbp: 133, dbp: 88 } });
    const enc = getState().encounters.find((e) => e.visitNumber === visit)!;
    expect(enc.vitals?.bp).toBe("133/88");
    expect(enc.vitals?.height).toBe("170");
  });
});

describe("claims (CHI)", () => {
  it("is ready when all eight vitals and the complaint are there", () => {
    const visit = visitOf("P007");
    savePanel({ visit, context: "other", values: FULL });
    const r = claimReadiness(visit);
    expect(r.total).toBe(9);
    expect(r.lines.filter((l) => l.state === "missing").map((l) => l.label)).toEqual([]);
  });

  it("lists what is missing, and an absence reason counts as provided", () => {
    const visit = visitOf("P007");
    savePanel({ visit, context: "other", values: { sbp: 110, dbp: 70, pulse: 70 } });
    const before = claimReadiness(visit);
    expect(before.lines.find((l) => l.key === "temp")!.state).toBe("missing");
    savePanel({ visit, context: "other", values: {}, absences: { temp: { code: "888", label: "Not obtained" }, rr: { code: "88", label: "Not obtained" } } });
    const after = claimReadiness(visit);
    expect(after.lines.find((l) => l.key === "temp")!.state).toBe("absent");
    expect(after.ready).toBeGreaterThan(before.ready);
  });

  it("builds claim supportingInfo with the UCUM units of the claim rules", () => {
    const visit = visitOf("P007");
    savePanel({ visit, context: "other", values: FULL, absences: {} });
    const json = claimVitalsJson(visit) as { category: { coding: { code: string }[] }; valueQuantity?: { code: string } }[];
    const by = Object.fromEntries(json.map((j) => [j.category.coding[0].code, j.valueQuantity?.code]));
    expect(by["vital-sign-systolic"]).toBe("mm[Hg]");
    expect(by["pulse"]).toBe("/min");
    expect(by["respiratory-rate"]).toBe("/min");
    expect(by["temperature"]).toBe("Cel");
    expect(by["oxygen-saturation"]).toBe("%");
    expect(by["vital-sign-weight"]).toBe("kg");
    expect(by["vital-sign-height"]).toBe("cm");
  });

  it("uses the absence reason code system in the claim", () => {
    const visit = visitOf("P007");
    savePanel({ visit, context: "other", values: { sbp: 1 + 99 }, absences: { pulse: { code: "997", label: "Cardiac arrest" } } });
    const json = JSON.stringify(claimVitalsJson(visit));
    expect(json).toContain("http://nphies.sa/terminology/CodeSystem/pulse-absence-reason");
    expect(json).toContain('"code":"997"');
  });
});

describe("flags and NEWS2", () => {
  const d = (k: string) => VITALS.find((v) => v.key === k)!;
  it("flags adult readings and leaves children unflagged", () => {
    expect(flagFor(d("spo2"), 88, 40)).toBe("LL");
    expect(flagFor(d("pulse"), 105, 40)).toBe("H");
    expect(flagFor(d("sbp"), 120, 40)).toBe("");
    expect(flagFor(d("pulse"), 150, 6)).toBe("");
  });
  it("scores NEWS2 from the published tables", () => {
    const r = news2({ rr: 22, spo2: 94, sbp: 100, pulse: 112, temp: 38.5 }, false, "Alert")!;
    // RR 21-24 = 2, SpO2 94-95 = 1, SBP 91-100 = 2, pulse 111-130 = 2, temp 38.1-39.0 = 1
    expect(r.total).toBe(8);
    expect(r.band).toBe("High");
    expect(news2({ rr: 16, spo2: 98, sbp: 120, pulse: 70, temp: 37 }, false, "Alert")!.total).toBe(0);
    expect(news2({ rr: 16, spo2: 98, sbp: 120, pulse: 70, temp: 37 }, true, "Confusion")!.total).toBe(5);
  });
});

describe("scenarios", () => {
  it("tracks the example scenarios of the guide", () => {
    const visit = visitOf("P004");
    const p = savePanel({ visit, context: "discharge", values: FULL })!;
    expect(scenarioCoverage(visit).find((s) => s.id === "f")!.done).toBe(false);
    sendPanel(p.id);
    expect(scenarioCoverage(visit).find((s) => s.id === "f")!.done).toBe(true);
    expect(panelsOf(visit).length).toBeGreaterThan(0);
  });
});
