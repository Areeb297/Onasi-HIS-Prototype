/**
 * Code 39 barcode geometry. Code 39 is the symbology the HIS prints on laboratory sample labels.
 * It encodes capital letters, digits and - . space $ / + %, framed by a start and stop star.
 * Each character is 9 elements (5 bars and 4 spaces, starting with a bar), 3 of them wide.
 */

/** n is a narrow element, w a wide one. Bar, space, bar, space, bar, space, bar, space, bar. */
export const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn", Z: "nwwnwnnnn",
  "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
  $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn",
};

export const NARROW = 1;
export const WIDE = 3;
/** The gap between two characters, as wide as a narrow element. */
const GAP = 1;

export interface Code39Geometry {
  /** Only the dark bars. Spaces are the gaps between them. */
  bars: { x: number; width: number }[];
  totalWidth: number;
  height: number;
  /** The text that was encoded, without the stars. */
  text: string;
}

/** Upper case and trimmed. This is what a scanner will read back. */
export const normalizeBarcode = (value: string | null | undefined): string => (value ?? "").trim().toUpperCase();

/** True when every character can be drawn in Code 39. A star is not allowed inside the text. */
export const canEncode = (value: string): boolean => value.length > 0 && [...value].every((c) => c !== "*" && c in CODE39);

export function code39Geometry(value: string, height = 48): Code39Geometry | null {
  const text = normalizeBarcode(value);
  if (!canEncode(text)) return null;
  const chars = ["*", ...text, "*"];
  const bars: Code39Geometry["bars"] = [];
  let x = 0;
  chars.forEach((c, ci) => {
    [...CODE39[c]].forEach((el, i) => {
      const w = el === "w" ? WIDE : NARROW;
      if (i % 2 === 0) bars.push({ x, width: w });
      x += w;
    });
    if (ci < chars.length - 1) x += GAP;
  });
  return { bars, totalWidth: x, height, text };
}

/** The barcode as SVG markup, for the screen and for the print window. */
export function code39Svg(value: string, height = 48): string {
  const g = code39Geometry(value, height);
  if (!g) return "";
  const rects = g.bars.map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${g.height}" fill="#0f172a"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.totalWidth} ${g.height}" width="100%" height="${g.height}" preserveAspectRatio="none" role="img" aria-label="${g.text}">${rects}</svg>`;
}
