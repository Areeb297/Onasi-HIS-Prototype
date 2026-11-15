import { describe, expect, it } from "vitest";
import { CODE39, NARROW, WIDE, canEncode, code39Geometry, code39Svg, normalizeBarcode } from "./code39";

describe("Code 39", () => {
  it("every character is 9 elements with exactly 3 wide ones, and no two characters share a pattern", () => {
    for (const [c, p] of Object.entries(CODE39)) {
      expect(p, c).toHaveLength(9);
      expect([...p].filter((x) => x === "w").length, c).toBe(3);
    }
    expect(new Set(Object.values(CODE39)).size).toBe(Object.keys(CODE39).length);
  });

  it("the 10 digits, 26 letters and 7 symbols are all there", () => {
    expect(Object.keys(CODE39)).toHaveLength(43 + 1); // 43 data characters plus the star
    expect("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%".split("").every((c) => c in CODE39)).toBe(true);
  });

  it("draws a start star, the text and a stop star, with 5 bars for each character", () => {
    const g = code39Geometry("SP-100001-BLD")!;
    expect(g.text).toBe("SP-100001-BLD");
    expect(g.bars).toHaveLength((13 + 2) * 5);
    expect(g.bars[0].x).toBe(0);
    // Bars never overlap and stay inside the width.
    for (let i = 1; i < g.bars.length; i++) expect(g.bars[i].x).toBeGreaterThanOrEqual(g.bars[i - 1].x + g.bars[i - 1].width);
    const last = g.bars[g.bars.length - 1];
    expect(last.x + last.width).toBe(g.totalWidth);
    expect(g.bars.every((b) => b.width === NARROW || b.width === WIDE)).toBe(true);
  });

  it("reads lower case as upper case and refuses what it cannot draw", () => {
    expect(normalizeBarcode("  sp-1 ")).toBe("SP-1");
    expect(code39Geometry("sp-1")?.text).toBe("SP-1");
    expect(canEncode("A*B")).toBe(false);
    expect(canEncode("")).toBe(false);
    expect(canEncode("é")).toBe(false);
    expect(code39Geometry("a_b")).toBeNull();
    expect(code39Svg("a_b")).toBe("");
  });

  it("makes SVG with one rect for each bar", () => {
    const svg = code39Svg("A1");
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<rect/g) ?? []).length).toBe(4 * 5);
  });
});
