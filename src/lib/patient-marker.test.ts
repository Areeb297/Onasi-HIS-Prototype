import { describe, expect, it } from "vitest";
import { hashId, initialsOf, NEUTRAL_MARKER, PATIENT_COLORS, patientColor, patientMarker } from "./patient-marker";

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("patient marker", () => {
  it("gives the same patient the same colour every time", () => {
    expect(patientColor("P001")).toEqual(patientColor("P001"));
    expect(hashId("P001")).toBe(hashId("P001"));
  });

  it("spreads patients across the palette", () => {
    const used = new Set(Array.from({ length: 40 }, (_, i) => patientColor(`P${String(i + 1).padStart(3, "0")}`).name));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it("keeps the initials readable on every colour (WCAG AA)", () => {
    for (const c of [...PATIENT_COLORS, NEUTRAL_MARKER]) expect(contrast(c.bg, c.fg), c.name).toBeGreaterThanOrEqual(4.5);
  });

  it("shows initials, and a neutral marker without initials for a masked confidential patient", () => {
    const p = { id: "P003", given: "Fahad", family: "Alqahtani" };
    expect(initialsOf(p)).toBe("FA");
    expect(patientMarker(p, false)).toMatchObject({ initials: "FA", masked: false, bg: patientColor("P003").bg });
    expect(patientMarker(p, true)).toMatchObject({ initials: "", masked: true, bg: NEUTRAL_MARKER.bg });
    expect(initialsOf({ given: "", family: "" })).toBe("?");
  });
});
