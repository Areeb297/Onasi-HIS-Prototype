import { beforeEach, describe, expect, it } from "vitest";
import { MAX_IMAGES, addImages, attachmentsOf, fmtSize, imageProblem, isImageFile, isPdfFile, markReportPrinted, pdfProblem, printCountOf, removeFile, resetRadExtras, setPdf } from "./rad-extras";
import { radReportHtml } from "./rad-print";
import { getRad, getRadOrder, markPerformed, resetRad, saveRadReport, signRadReport } from "./radiology";
import { switchUser } from "./session";
import { getState } from "./store";

const png = (n: number) => ({ name: `image-${n}.png`, type: "image/png", size: 1000 + n });
const performed = () => {
  const o = getRad().orders.find((x) => x.status === "received")!;
  markPerformed(o.id);
  return getRadOrder(o.id)!;
};

describe("radiology report attachments", () => {
  beforeEach(() => {
    switchUser("U9");
    resetRad();
    resetRadExtras();
  });

  it("knows an image from a PDF by type and by name", () => {
    expect(isImageFile({ name: "a.PNG", type: "image/png", size: 1 })).toBe(true);
    expect(isImageFile({ name: "a.jpeg", type: "image/jpeg", size: 1 })).toBe(true);
    expect(isImageFile({ name: "a.gif", type: "image/gif", size: 1 })).toBe(false);
    expect(isImageFile({ name: "a.png", type: "application/pdf", size: 1 })).toBe(false);
    expect(isPdfFile({ name: "r.pdf", type: "application/pdf", size: 1 })).toBe(true);
    expect(isPdfFile({ name: "r.png", type: "application/pdf", size: 1 })).toBe(false);
    expect(imageProblem({ name: "a.png", type: "image/png", size: 0 })).toMatch(/empty/);
    expect(pdfProblem({ name: "a.doc", type: "application/msword", size: 5 })).toMatch(/only a PDF/);
    expect(fmtSize(512)).toBe("1 KB");
    expect(fmtSize(5 * 1_048_576)).toBe("5.0 MB");
  });

  it("keeps up to 10 images, names the ones it skips, and refuses the same file twice", () => {
    const o = performed();
    const first = addImages(o, [png(1), png(2), { name: "scan.gif", type: "image/gif", size: 5 }]);
    expect(first.added).toHaveLength(2);
    expect(first.problems).toHaveLength(1);
    expect(first.problems[0]).toContain("scan.gif");
    expect(addImages(getRadOrder(o.id)!, [png(1)]).problems[0]).toMatch(/already attached/);
    const many = addImages(getRadOrder(o.id)!, Array.from({ length: 12 }, (_, i) => png(10 + i)));
    expect(many.added).toHaveLength(MAX_IMAGES - 2);
    expect(many.problems.some((p) => p.includes(`at most ${MAX_IMAGES}`))).toBe(true);
    expect(attachmentsOf(getRadOrder(o.id)!).images).toHaveLength(MAX_IMAGES);
  });

  it("keeps one PDF and a new one replaces it", () => {
    const o = performed();
    expect(setPdf(o, { name: "a.pdf", type: "application/pdf", size: 10 }).added).toHaveLength(1);
    setPdf(getRadOrder(o.id)!, { name: "b.pdf", type: "application/pdf", size: 20 });
    expect(attachmentsOf(getRadOrder(o.id)!).pdf?.name).toBe("b.pdf");
    expect(setPdf(getRadOrder(o.id)!, png(1)).problems).toHaveLength(1);
  });

  it("removes a file", () => {
    const o = performed();
    const { added } = addImages(o, [png(1), png(2)]);
    expect(removeFile(getRadOrder(o.id)!, added[0].id)).toBe(true);
    expect(attachmentsOf(getRadOrder(o.id)!).images.map((i) => i.name)).toEqual(["image-2.png"]);
    expect(removeFile(getRadOrder(o.id)!, "nope")).toBe(false);
  });

  it("needs an exam first, and the rad.report permission", () => {
    const waiting = getRad().orders.find((x) => x.status === "received")!;
    expect(addImages(waiting, [png(1)]).added).toHaveLength(0);
    const o = performed();
    switchUser("U1"); // physician has no rad.report permission
    expect(addImages(getRadOrder(o.id)!, [png(1)]).added).toHaveLength(0);
    expect(attachmentsOf(getRadOrder(o.id)!).images).toHaveLength(0);
  });

  it("locks the files once the report is signed", () => {
    const o = performed();
    addImages(o, [png(1)]);
    saveRadReport(o.id, { findings: "Clear lungs", impression: "Normal chest" });
    switchUser("U6"); // radiologist
    expect(signRadReport(o.id)).toBe(true);
    const signed = getRadOrder(o.id)!;
    expect(addImages(signed, [png(2)]).problems[0]).toMatch(/signed/);
    expect(removeFile(signed, attachmentsOf(signed).images[0].id)).toBe(false);
    switchUser("U9");
  });

  it("ignores files that belong to an older study, so a reset cannot leave a stale entry", () => {
    const o = performed();
    addImages(o, [png(1)]);
    resetRad();
    const again = performed();
    expect(attachmentsOf(again).images).toHaveLength(0);
  });

  it("an order saved before this feature has no files and still opens", () => {
    const o = getRad().orders[0];
    expect(attachmentsOf(o)).toEqual({ images: [] });
  });

  it("the printed report names the files, marks a draft and escapes the text", () => {
    const o = performed();
    addImages(o, [png(1)]);
    setPdf(getRadOrder(o.id)!, { name: "result.pdf", type: "application/pdf", size: 2048 });
    saveRadReport(o.id, { findings: "No <b>bold</b> & more", impression: "Normal" });
    const patient = getState().patients.find((p) => p.id === o.patientId)!;
    const html = radReportHtml(getRadOrder(o.id)!, patient)!;
    expect(html).toContain("DRAFT, NOT SIGNED");
    expect(html).toContain("image-1.png");
    expect(html).toContain("result.pdf");
    expect(html).toContain("No &lt;b&gt;bold&lt;/b&gt; &amp; more");
    expect(html).not.toContain("<b>bold</b>");
    expect(radReportHtml(getRad().orders.find((x) => x.status === "received")!, patient)).toBeNull();
  });

  it("keeps the name of a confidential patient off the printed page", () => {
    const o = performed();
    saveRadReport(o.id, { findings: "Clear", impression: "Normal" });
    const p = getState().patients.find((x) => x.id === o.patientId)!;
    const hidden = radReportHtml(getRadOrder(o.id)!, { ...p, confidential: true })!;
    expect(hidden).toContain("Confidential patient");
    expect(hidden).toContain(p.mrn);
    expect(hidden).not.toContain(p.family);
    expect(radReportHtml(getRadOrder(o.id)!, { ...p, confidential: false })).toContain(p.family);
  });

  it("counts prints", () => {
    const o = performed();
    markReportPrinted(o);
    markReportPrinted(o);
    expect(printCountOf(o.id)).toBe(2);
  });
});
