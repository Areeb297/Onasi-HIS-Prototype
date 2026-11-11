import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Keeps the palette readable. Reads the tokens straight from src/index.css and checks WCAG AA (4.5:1) for
 * every text, status and button color pair, in the light and the dark theme.
 */
const css = readFileSync(new URL("../index.css", import.meta.url), "utf-8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("\n}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6});/g)) out[m[1]] = m[2];
  return out;
}

type RGB = [number, number, number];
const rgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (fg: RGB, bg: RGB, a: number): RGB => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as RGB;

const STATUS = ["warn", "ok", "admit", "move", "update", "cancel", "merge", "destructive"];

for (const [name, sel, tint, darkText] of [
  ["light", ":root", 0.14, "#0b1f23"],
  ["dark", ".dark", 0.16, "#0b1f23"],
] as const) {
  describe(`${name} theme contrast`, () => {
    const t = block(sel);
    const c = (k: string) => rgb(t[k]);

    it("body text and muted text read on every surface", () => {
      for (const bg of ["background", "card", "muted"]) {
        expect(ratio(c("foreground"), c(bg)), `foreground on ${bg}`).toBeGreaterThanOrEqual(7);
        expect(ratio(c("muted-foreground"), c(bg)), `muted-foreground on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("buttons and accents read", () => {
      expect(ratio(c("primary-foreground"), c("primary")), "primary button").toBeGreaterThanOrEqual(4.5);
      expect(ratio(c("accent-foreground"), c("accent")), "accent").toBeGreaterThanOrEqual(4.5);
      expect(ratio(c("destructive-foreground"), c("destructive")), "destructive button").toBeGreaterThanOrEqual(4.5);
    });

    it("status colors read as text on their own tint and on the page", () => {
      for (const k of STATUS) {
        const fg = c(k);
        for (const base of ["card", "background"]) {
          expect(ratio(fg, mix(fg, c(base), tint)), `${k} on ${k} tint over ${base}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(fg, c(base)), `${k} on ${base}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it("CTAS level fills carry readable text", () => {
      for (const l of [1, 2, 4, 5]) {
        const fill = c(`ctas-${l}`);
        const text = name === "light" ? rgb("#ffffff") : rgb(darkText);
        expect(ratio(text, fill), `CTAS ${l}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(rgb("#1a1a1a"), c("ctas-3")), "CTAS 3").toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe("type scale", () => {
  it("has no text below 12px in the theme", () => {
    const xs = css.match(/--text-xs:\s*([\d.]+)rem/);
    expect(Number(xs![1]) * 16).toBeGreaterThanOrEqual(12);
  });
});
