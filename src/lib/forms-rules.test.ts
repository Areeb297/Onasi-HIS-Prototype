import { describe, expect, it } from "vitest";
import { EMR_FORMS, EMR_FORM_BY_ID, fitsSex, sexProblem } from "./emr-forms";
import { titleCase } from "./forms/util";
import { WOMENS_FORMS } from "./forms/womens";

describe("forms made for one sex", () => {
  it("sets the sex on every women's form, except the one that describes a baby", () => {
    for (const f of WOMENS_FORMS) {
      if (f.id === "newborn-ballard-score") expect(f.sex, f.id).toBeUndefined();
      else expect(f.sex, f.id).toBe("F");
    }
    expect(WOMENS_FORMS.filter((f) => f.sex === "F").length).toBe(WOMENS_FORMS.length - 1);
  });

  it("covers pregnancy, labor flowsheet and the other obstetric and gynecology forms", () => {
    for (const id of ["pregnancy", "labor-flowsheet", "prenatal-visit", "labor-admission", "delivery-outcomes", "menstrual-cycle", "maternity-icu"]) {
      expect(EMR_FORM_BY_ID[id].sex, id).toBe("F");
    }
    expect(EMR_FORMS.filter((f) => f.group.includes("Gynecology") || f.group.includes("Obstetrics")).every((f) => f.sex === "F" || f.id === "newborn-ballard-score")).toBe(true);
  });

  it("fits the right sex, refuses the other, and hides nothing when the sex is unknown", () => {
    const preg = EMR_FORM_BY_ID.pregnancy;
    expect(fitsSex(preg, "F")).toBe(true);
    expect(fitsSex(preg, "M")).toBe(false);
    expect(fitsSex(preg, undefined)).toBe(true);
    expect(fitsSex(preg, "X")).toBe(true);
    expect(fitsSex(EMR_FORM_BY_ID["newborn-ballard-score"], "M")).toBe(true);
    expect(fitsSex(undefined, "M")).toBe(true);
  });

  it("says why in plain words", () => {
    expect(sexProblem(EMR_FORM_BY_ID.pregnancy, "M")).toBe("Pregnancy is only for female patients. This patient is male.");
    expect(sexProblem(EMR_FORM_BY_ID.pregnancy, "F")).toBe("");
  });

  it("no form outside the women's group has a sex rule by accident", () => {
    expect(EMR_FORMS.filter((f) => f.sex && !WOMENS_FORMS.includes(f)).map((f) => f.id)).toEqual([]);
  });
});

describe("form wording", () => {
  it("puts section names in Title Case", () => {
    expect(titleCase("Female factor")).toBe("Female Factor");
    expect(titleCase("Pre-op checklist verification")).toBe("Pre-Op Checklist Verification");
    expect(titleCase("Instrumental intervention details (if applicable)")).toBe("Instrumental Intervention Details (If Applicable)");
    expect(titleCase("Outcome / Delivery")).toBe("Outcome / Delivery");
    expect(titleCase("APGAR")).toBe("APGAR");
    const bad = EMR_FORMS.flatMap((f) => f.fields.filter((x) => x.section && x.section !== titleCase(x.section)).map((x) => `${f.id}: ${x.section}`));
    expect(bad).toEqual([]);
  });

  it("uses one spelling, Anesthesia, in every form", () => {
    const text = JSON.stringify(EMR_FORMS);
    expect(text).not.toMatch(/anaesth/i);
    expect(text).toMatch(/anesthesia/i);
  });
});
