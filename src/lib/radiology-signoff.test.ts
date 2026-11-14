import { beforeEach, describe, expect, it } from "vitest";
import { RAD_CATALOG, machinesFor, reportTemplatesFor } from "./fhir/rad-catalog";
import {
  addRadAddendum, applyReportTemplate, completeExam, examProblems, getRadOrder, markPerformed, needsPregnancyCheck, openRadDuplicates,
  placeRadOrder, publishRadReport, radReportSendBlock, releaseRadReport, reopenRadDraft, resetRad, saveRadReport, signRadReport,
  type ExamDetails,
} from "./radiology";
import { byType } from "./fhir/common";
import { switchUser } from "./session";
import { getState } from "./store";

const enc = (pid = "P001") => getState().encounters.find((e) => e.patientId === pid && e.status !== "cancelled")!;
const NOW = new Date("2026-11-14T10:00:00Z").getTime();
const man = { sex: "M" as const, dob: "1968-03-14" };
const woman = { sex: "F" as const, dob: "1991-07-02" };

const details = (extra: Partial<ExamDetails> = {}): ExamDetails => ({
  machine: "X-Ray Room 1",
  start: new Date(Date.now() - 20 * 60_000).toISOString(),
  end: new Date(Date.now() - 5 * 60_000).toISOString(),
  contrastGiven: false,
  contrastAmount: "",
  pregnancy: "",
  pregnancyNote: "",
  ...extra,
});

function order(procCode = "XCHES-PA", pid = "P001") {
  switchUser("U9");
  return placeRadOrder(enc(pid), { procCode, priority: "routine", indication: "Cough", clinicalInfo: "" })!;
}

describe("technologist record", () => {
  it("asks the pregnancy question of women aged 12 to 55 only", () => {
    expect(needsPregnancyCheck(woman, NOW)).toBe(true);
    expect(needsPregnancyCheck(man, NOW)).toBe(false);
    expect(needsPregnancyCheck({ sex: "F", dob: "2015-06-01" }, NOW)).toBe(false); // 11
    expect(needsPregnancyCheck({ sex: "F", dob: "2014-06-01" }, NOW)).toBe(true); // 12
    expect(needsPregnancyCheck({ sex: "F", dob: "1971-06-01" }, NOW)).toBe(true); // 55
    expect(needsPregnancyCheck({ sex: "F", dob: "1970-06-01" }, NOW)).toBe(false); // 56
  });

  it("needs the machine, sensible times and the contrast answer", () => {
    const ok = { machine: "CT Scanner 1", start: "2026-11-14T09:30:00Z", end: "2026-11-14T09:50:00Z", contrastGiven: false, contrastAmount: "", pregnancy: "" as const, pregnancyNote: "" };
    expect(examProblems(ok, man, NOW)).toEqual([]);
    expect(examProblems({ ...ok, machine: " " }, man, NOW)).toEqual(["Choose the machine."]);
    expect(examProblems({ ...ok, end: "2026-11-14T09:00:00Z" }, man, NOW)).toEqual(["The end time is before the start time."]);
    expect(examProblems({ ...ok, end: "2026-11-14T12:00:00Z" }, man, NOW)).toEqual(["The end time is in the future."]);
    expect(examProblems({ ...ok, start: "" }, man, NOW)).toEqual(["Enter the start time."]);
    expect(examProblems({ ...ok, contrastGiven: null }, man, NOW)).toEqual(["Say if contrast was given."]);
    expect(examProblems({ ...ok, contrastGiven: true }, man, NOW)).toEqual(["Enter the amount of contrast given."]);
    expect(examProblems({ ...ok, contrastGiven: true, contrastAmount: "80 mL" }, man, NOW)).toEqual([]);
  });

  it("needs the pregnancy check for a woman of childbearing age, with a note when she may be pregnant", () => {
    const ok = { machine: "CT Scanner 1", start: "2026-11-14T09:30:00Z", end: "2026-11-14T09:50:00Z", contrastGiven: false, contrastAmount: "", pregnancy: "" as const, pregnancyNote: "" };
    expect(examProblems(ok, woman, NOW)).toEqual(["Record the pregnancy check."]);
    expect(examProblems({ ...ok, pregnancy: "not-pregnant" }, woman, NOW)).toEqual([]);
    expect(examProblems({ ...ok, pregnancy: "unsure" }, woman, NOW)).toHaveLength(1);
    expect(examProblems({ ...ok, pregnancy: "pregnant", pregnancyNote: "Radiologist informed, shielding used" }, woman, NOW)).toEqual([]);
  });

  it("every study type has machines to choose from", () => {
    for (const p of RAD_CATALOG) expect(machinesFor(p.code).length, p.code).toBeGreaterThan(0);
  });
});

describe("exam, report and sign-off", () => {
  beforeEach(() => {
    resetRad();
    switchUser("U9");
  });

  it("the exam is not marked done with an incomplete record, and the report cannot start before it", () => {
    const o = order("CABPEC");
    expect(saveRadReport(o.id, { findings: "Early text" })).toBe(false);
    expect(completeExam(o.id, details({ machine: "" }))).toBe(false);
    expect(getRadOrder(o.id)!.status).toBe("received");
    expect(completeExam(o.id, details({ machine: "CT Scanner 2", contrastGiven: true, contrastAmount: "80 mL" }))).toBe(true);
    const study = getRadOrder(o.id)!.study!;
    expect(getRadOrder(o.id)!.status).toBe("performed");
    expect(study.machine).toBe("CT Scanner 2");
    expect(study.contrastGiven).toBe(true);
    expect(study.contrastAmount).toBe("80 mL");
    expect(new Date(study.performedEnd).getTime()).toBeGreaterThan(new Date(study.performedStart).getTime());
    expect(saveRadReport(o.id, { findings: "Now it can be written" })).toBe(true);
  });

  it("records the pregnancy check for a woman aged 12 to 55", () => {
    const o = order("XCHES-PA", "P002"); // woman born 1991
    expect(completeExam(o.id, details())).toBe(false);
    expect(completeExam(o.id, details({ pregnancy: "not-pregnant" }))).toBe(true);
    expect(getRadOrder(o.id)!.study!.pregnancy).toBe("not-pregnant");
  });

  it("offers templates per study type with normal wording for that exam", () => {
    const chest = reportTemplatesFor("XCHES-PA");
    const head = reportTemplatesFor("CSKUH");
    expect(chest[0].label).toBe("Normal Chest X-Ray");
    expect(chest[0].findings).toMatch(/lungs are clear/i);
    expect(head[0].findings).toMatch(/intracranial/i);
    expect(chest[0].findings).not.toBe(head[0].findings);
    for (const p of RAD_CATALOG) {
      const t = reportTemplatesFor(p.code)[0];
      expect(t.findings.length, p.code).toBeGreaterThan(20);
      expect(t.impression, p.code).toMatch(/^Normal /);
      expect(t.technique).toBe(p.technique);
    }
    const o = order("CSKUH");
    markPerformed(o.id);
    applyReportTemplate(o.id, "normal");
    expect(getRadOrder(o.id)!.report!.impression).toBe("Normal CT of the head.");
  });

  it("an unsigned report cannot be released, and only a radiologist signs", () => {
    const o = order();
    markPerformed(o.id);
    applyReportTemplate(o.id, "normal");
    expect(releaseRadReport(o.id)).toBe(false);
    expect(getRadOrder(o.id)!.status).toBe("performed");
    expect(radReportSendBlock(getRadOrder(o.id)!)).toMatch(/sign/);
    expect(signRadReport(o.id)).toBe(false); // administrator is not a radiologist
    switchUser("U6");
    expect(signRadReport(o.id)).toBe(true);
    const r = getRadOrder(o.id)!.report!;
    expect(r.signedBy).toEqual({ id: "R6001", name: "Dr. Layla Alanazi" });
    expect(r.signedAt).toBeTruthy();
    expect(r.reportedById).toBe("R6001");
    expect(radReportSendBlock(getRadOrder(o.id)!)).toMatch(/released/);
    expect(releaseRadReport(o.id)).toBe(true);
    expect(getRadOrder(o.id)!.status).toBe("resulted");
    expect(radReportSendBlock(getRadOrder(o.id)!)).toBeNull();
  });

  it("does not sign without an impression, or a critical finding nobody was told about", () => {
    const o = order();
    markPerformed(o.id);
    switchUser("U6");
    saveRadReport(o.id, { findings: "Clear lungs." });
    expect(signRadReport(o.id)).toBe(false);
    saveRadReport(o.id, { impression: "Large pneumothorax.", critical: true });
    expect(signRadReport(o.id)).toBe(false);
    saveRadReport(o.id, { communicated: "Dr. Khalid Alharbi" });
    expect(signRadReport(o.id)).toBe(true);
  });

  it("a signed report keeps its text: changes are refused, addenda are added after it", () => {
    const o = order();
    markPerformed(o.id);
    applyReportTemplate(o.id, "normal");
    switchUser("U6");
    expect(addRadAddendum(o.id, "Too early")).toBe(false); // not signed yet
    signRadReport(o.id);
    const signedText = getRadOrder(o.id)!.report!.impression;
    expect(saveRadReport(o.id, { impression: "Changed after signing" })).toBe(false);
    expect(applyReportTemplate(o.id, "abnormal")).toBe(false);
    expect(getRadOrder(o.id)!.report!.impression).toBe(signedText);
    releaseRadReport(o.id);
    expect(addRadAddendum(o.id, "  ")).toBe(false);
    expect(addRadAddendum(o.id, "Compared with the study of last month. No change.")).toBe(true);
    expect(addRadAddendum(o.id, "Second note.")).toBe(true);
    const fresh = getRadOrder(o.id)!;
    expect(fresh.report!.impression).toBe(signedText);
    expect(fresh.report!.addenda!.map((a) => a.text)).toEqual(["Compared with the study of last month. No change.", "Second note."]);
    expect(fresh.report!.addenda![0].by).toBe("Dr. Layla Alanazi");
    expect(fresh.report!.addendum).toContain("Second note.");
    expect(fresh.reportDirty).toBe(true);
    switchUser("U9");
    expect(addRadAddendum(o.id, "Not a radiologist")).toBe(false);
  });

  it("a signed draft can be reopened before release, not after", () => {
    const o = order();
    markPerformed(o.id);
    applyReportTemplate(o.id, "normal");
    switchUser("U6");
    signRadReport(o.id);
    expect(reopenRadDraft(o.id)).toBe(true);
    expect(getRadOrder(o.id)!.report!.signedAt).toBeUndefined();
    expect(saveRadReport(o.id, { impression: "Normal chest X-ray. No follow-up." })).toBe(true);
    signRadReport(o.id);
    releaseRadReport(o.id);
    expect(reopenRadDraft(o.id)).toBe(false);
  });

  it("the message names the radiologist who signed, whoever sends it, and carries the addendum", () => {
    const o = order();
    markPerformed(o.id);
    applyReportTemplate(o.id, "normal");
    switchUser("U6");
    signRadReport(o.id);
    releaseRadReport(o.id);
    addRadAddendum(o.id, "Reviewed with the clinical team.");
    switchUser("U9");
    const rec = publishRadReport(o.id)!;
    expect(rec.checks.filter((c) => c.level === "error")).toEqual([]);
    expect(rec.response.status).toBe("accepted");
    expect(byType(rec.bundle, "Practitioner").map((p) => p.identifier[0].value)).toContain("R6001");
    expect(JSON.stringify(rec.bundle)).toContain("Reviewed with the clinical team.");
    expect(getRadOrder(o.id)!.report!.signedBy?.id).toBe("R6001");
  });
});

describe("duplicate exam warning", () => {
  beforeEach(() => {
    resetRad();
    switchUser("U9");
  });

  it("warns for an exam that is already open for the same visit", () => {
    const visit = enc("P002").visitNumber;
    const o = order("CSKUH", "P002");
    const orders = [getRadOrder(o.id)!];
    expect(openRadDuplicates(orders, visit, ["CSKUH", "CCHES"])).toEqual(["CSKUH"]);
    expect(openRadDuplicates(orders, "V-OTHER", ["CSKUH"])).toEqual([]);
    expect(openRadDuplicates(orders, visit, ["CSKUH"], o.id)).toEqual([]);
    expect(openRadDuplicates([{ ...orders[0], status: "resulted" }], visit, ["CSKUH"])).toEqual([]);
    expect(openRadDuplicates([{ ...orders[0], status: "cancelled" }], visit, ["CSKUH"])).toEqual([]);
  });
});
