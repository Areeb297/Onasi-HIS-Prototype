import { describe, expect, it } from "vitest";
import { MASTERS } from "../masters-data";
import type { MasterDef } from "../schema";
import { allowsNegative, keyColumn, mono, num, rowProblems, text } from "./helpers";

const def: MasterDef = {
  id: "t", title: "Suppliers", module: "Pharmacy",
  columns: [mono("code", "Supplier Code", true), text("name", "Name", true), num("price", "Price (SAR)"), num("balance", "Balance")],
  seed: [{ code: "SUP-001", name: "Najd Medical Supplies" }, { code: "SUP-002", name: "Hijaz Pharma" }],
};

describe("setup row rules", () => {
  it("uses the first typed code column as the key", () => {
    expect(keyColumn(def)?.key).toBe("code");
    expect(keyColumn({ ...def, columns: [text("name", "Name", true)] })).toBeUndefined();
    // A table whose sample rows already repeat the first column has no key.
    expect(keyColumn({ ...def, seed: [...def.seed, { code: "sup-001", name: "Again" }] })).toBeUndefined();
  });

  it("refuses a code another row already uses, whatever the letter case", () => {
    const row = { code: " sup-001 ", name: "Copy" };
    expect(rowProblems(def, row, def.seed, null)).toEqual(["Supplier Code sup-001 is already used by another row. Each row needs its own."]);
    // Saving a row over itself is fine.
    expect(rowProblems(def, { ...def.seed[0], name: "Renamed" }, def.seed, 0)).toEqual([]);
    expect(rowProblems(def, { code: "SUP-002", name: "Renamed" }, def.seed, 0)).toHaveLength(1);
    expect(rowProblems(def, { code: "SUP-003", name: "New" }, def.seed, null)).toEqual([]);
  });

  it("refuses a number below zero where that has no meaning", () => {
    expect(rowProblems(def, { code: "SUP-9", name: "X", price: -50 }, def.seed, null)).toEqual(["Price (SAR) cannot be below zero."]);
    expect(rowProblems(def, { code: "SUP-9", name: "X", price: 0, balance: -50 }, def.seed, null)).toEqual([]);
    expect(allowsNegative(num("variance", "Variance"))).toBe(true);
    expect(allowsNegative(num("quantity", "Quantity"))).toBe(false);
  });

  it("names the required fields that are empty", () => {
    expect(rowProblems(def, { code: "", name: "" }, def.seed, null)).toEqual(["Enter Supplier Code.", "Enter Name."]);
  });

  it("accepts every sample row of every setup table", () => {
    for (const m of MASTERS) {
      m.seed.forEach((row, i) => {
        const problems = rowProblems(m, row, m.seed, i).filter((p) => !p.startsWith("Enter "));
        expect(problems, `${m.id} row ${i + 1}`).toEqual([]);
      });
    }
  });

  it("writes ID and Phone Number in full capitals and words", () => {
    for (const m of MASTERS) for (const c of m.columns) {
      expect(c.label, `${m.id}.${c.key}`).not.toMatch(/\bId\b/);
      expect(c.label, `${m.id}.${c.key}`).not.toContain("#");
    }
  });
});
