import { describe, expect, it } from "vitest";
import { EMR_FORMS, EMR_FORM_BY_ID } from "./emr-forms";
import { EMR_MENU } from "./emr-menu";
import { scoreOf } from "@/components/EmrFormPage";

const menuForms = EMR_MENU.filter((m) => m.kind === "form");

describe("EMR form definitions", () => {
  it("defines every form id listed in the menu, in the same group", () => {
    for (const m of menuForms) {
      const def = EMR_FORM_BY_ID[m.id];
      expect(def, `missing form ${m.id}`).toBeDefined();
      expect(def.group).toBe(m.group);
    }
  });

  it("has no form that is missing from the menu and no duplicate ids", () => {
    const ids = EMR_FORMS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const menuIds = new Set(menuForms.map((m) => m.id));
    for (const id of ids) expect(menuIds.has(id), `${id} is not in the menu`).toBe(true);
  });

  it("uses unique field keys inside each form", () => {
    for (const f of EMR_FORMS) {
      const keys = f.fields.map((x) => x.key);
      expect(new Set(keys).size, `duplicate key in ${f.id}`).toBe(keys.length);
    }
  });

  it("gives select, radio and multiselect fields options with unique values", () => {
    for (const f of EMR_FORMS) {
      for (const fld of f.fields) {
        if (fld.type === "select" || fld.type === "radio" || fld.type === "multiselect") {
          expect(fld.options?.length, `${f.id}.${fld.key} needs options`).toBeGreaterThan(0);
          const vals = fld.options!.map((o) => (typeof o === "string" ? o : o.value));
          expect(new Set(vals).size, `${f.id}.${fld.key} has duplicate option values`).toBe(vals.length);
        }
      }
    }
  });

  it("only lists existing fields in summaryKeys, 3 to 5 of them", () => {
    for (const f of EMR_FORMS) {
      expect(f.summaryKeys, `${f.id} needs summaryKeys`).toBeDefined();
      expect(f.summaryKeys!.length, `${f.id} summaryKeys count`).toBeGreaterThanOrEqual(3);
      expect(f.summaryKeys!.length).toBeLessThanOrEqual(5);
      for (const k of f.summaryKeys!) expect(f.fields.some((x) => x.key === k), `${f.id}: summary key ${k}`).toBe(true);
    }
  });

  it("keeps each form between 6 and 20 fields", () => {
    for (const f of EMR_FORMS) {
      expect(f.fields.length, f.id).toBeGreaterThanOrEqual(6);
      expect(f.fields.length, f.id).toBeLessThanOrEqual(20);
    }
  });

  it("sets scoreLabel on forms that produce a score", () => {
    for (const id of ["pediatric-fall-risk", "newborn-ballard-score", "pressure-ulcer-chart", "nursing-pain-scale"]) {
      expect(EMR_FORM_BY_ID[id].scoreLabel, id).toBeTruthy();
    }
  });

  it("scores the Humpty Dumpty scale from 7 to 23", () => {
    const f = EMR_FORM_BY_ID["pediatric-fall-risk"];
    const maxOf = (key: string) => Math.max(...f.fields.find((x) => x.key === key)!.options!.map((o) => (typeof o === "string" ? 0 : (o.score ?? 0))));
    const keys = ["age", "gender", "diagnosis", "cognition", "environment", "surgery", "medication"];
    expect(keys.reduce((n, k) => n + maxOf(k), 0)).toBe(23);
    const low = Object.fromEntries(keys.map((k) => [k, f.fields.find((x) => x.key === k)!.options!.map((o) => o as { value: string; score: number }).sort((a, b) => a.score - b.score)[0].value]));
    expect(scoreOf(f, low)).toBe(7);
  });

  it("scores the New Ballard Score from -10 to 50", () => {
    const f = EMR_FORM_BY_ID["newborn-ballard-score"];
    const scored = f.fields.filter((x) => x.type === "radio");
    expect(scored).toHaveLength(12);
    const sumBy = (pick: (s: number[]) => number) => scored.reduce((n, x) => n + pick(x.options!.map((o) => (typeof o === "string" ? 0 : (o.score ?? 0)))), 0);
    expect(sumBy((s) => Math.min(...s))).toBe(-10);
    expect(sumBy((s) => Math.max(...s))).toBe(50);
  });

  it("scores the Braden Scale from 6 to 23", () => {
    const f = EMR_FORM_BY_ID["pressure-ulcer-chart"];
    const braden = ["sensory", "moisture", "activity", "mobility", "nutrition", "friction"].map((k) => f.fields.find((x) => x.key === k)!);
    const scores = braden.map((x) => x.options!.map((o) => (typeof o === "string" ? 0 : (o.score ?? 0))));
    expect(scores.reduce((n, s) => n + Math.min(...s), 0)).toBe(6);
    expect(scores.reduce((n, s) => n + Math.max(...s), 0)).toBe(23);
  });
});
