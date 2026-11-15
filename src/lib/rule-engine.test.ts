import { beforeEach, describe, expect, it } from "vitest";
import { claimFor, insuredVisits, resetClaims, reviewClaim, reviewModel, type ReviewInput } from "./claims";
import { resetInvoices } from "./invoice";
import { resetFinancial } from "./nphies-financial";
import {
  conditionHolds, deleteRule, evaluateConditions, getRules, readRuleRows, resetRules, saveField, saveRule, saveUploadedRules, setFieldActive, setRuleActive,
  SEED_RULES, type ClaimFacts,
} from "./rule-engine";
import { switchUser } from "./session";
import { replaceState, seedState } from "./store";

const clean = (): ReviewInput => ({
  dx: [{ code: "J18.9", type: "principal" }], chiefComplaint: true, vitalsMissing: ["Height"], vitalsTotal: 8, authNeeded: false,
  lines: [{ key: "visit", seq: 1, text: "Outpatient Consultation", unitCost: 350, dxSeqs: [1] }],
});
const facts = (claim: Record<string, string | number>, lines: Record<string, string | number>[] = []): ClaimFacts => ({
  claim, lines: lines.map((values, i) => ({ key: `l${i + 1}`, seq: i + 1, text: `Line ${i + 1}`, values })),
});
const rule = (id: string) => getRules().rules.find((r) => r.id === id)!;

describe("rule engine", () => {
  beforeEach(() => {
    switchUser("U9");
    resetRules();
    replaceState(seedState());
    resetFinancial();
    resetInvoices();
    resetClaims();
  });

  it("seeds the review's built-in checks as rules, and the review keeps its behaviour", () => {
    const checks = SEED_RULES.filter((r) => r.check).map((r) => r.check);
    expect(checks).toEqual(["no-principal-dx", "many-principal-dx", "no-chief-complaint", "no-vitals", "vitals-missing", "auth-not-approved", "line-no-dx", "line-zero-cost"]);
    expect(reviewClaim(clean(), "claim").map((f) => `${f.rule}:${f.severity}`)).toEqual(["vitals-missing:soft"]);
    expect(reviewClaim(clean(), "claim")[0].ruleId).toBe("GR-005");
  });

  it("changing a rule's severity or switching it off changes the review", () => {
    expect(saveRule({ ...rule("GR-005"), severity: "hard" }).ok).toBe(true);
    expect(reviewClaim(clean(), "claim")[0].severity).toBe("hard");
    expect(setRuleActive("GR-005", false).ok).toBe(true);
    expect(reviewClaim(clean(), "claim")).toEqual([]);
  });

  it("a built-in rule keeps its check and cannot be deleted", () => {
    expect(saveRule({ ...rule("GR-001"), conditions: [{ field: "claim.net", op: "greater", value: "1" }] }).ok).toBe(true);
    expect(rule("GR-001").check).toBe("no-principal-dx");
    expect(rule("GR-001").conditions).toBeUndefined();
    expect(deleteRule("GR-001").ok).toBe(false);
  });

  it("trigger and claim type limit where a rule runs", () => {
    const r = { ...clean(), dx: [] };
    expect(reviewClaim(r, "priorauth").some((f) => f.rule === "no-principal-dx")).toBe(true);
    saveRule({ ...rule("GR-001"), trigger: "claim" });
    expect(reviewClaim(r, "priorauth").some((f) => f.rule === "no-principal-dx")).toBe(false);
    saveRule({ ...rule("GR-001"), trigger: "both", claimTypes: ["institutional"] });
    expect(reviewClaim({ ...r, claimType: "professional" }, "claim").some((f) => f.rule === "no-principal-dx")).toBe(false);
    expect(reviewClaim({ ...r, claimType: "institutional" }, "claim").some((f) => f.rule === "no-principal-dx")).toBe(true);
  });

  it("evaluates conditions on claim fields once and on line fields per line", () => {
    const fields = getRules().fields;
    expect(evaluateConditions([{ field: "claim.net", op: "greater", value: "5000" }], facts({ "claim.net": 6000 }), fields)).toEqual([{}]);
    expect(evaluateConditions([{ field: "claim.net", op: "greater", value: "5000" }], facts({ "claim.net": 400 }), fields)).toEqual([]);
    const hits = evaluateConditions([{ field: "line.quantity", op: "less", value: "1" }], facts({}, [{ "line.quantity": 0 }, { "line.quantity": 2 }]), fields);
    expect(hits.map((h) => h.seq)).toEqual([1]);
    expect(conditionHolds({ field: "x", op: "empty", value: "" }, "")).toBe(true);
    expect(conditionHolds({ field: "x", op: "contains", value: "j18" }, "J18.9 E11.9")).toBe(true);
    expect(conditionHolds({ field: "x", op: "greater", value: "5" }, undefined)).toBe(false);
  });

  it("a condition rule adds a finding with its message and NPHIES code; a switched-off field stops it", () => {
    const r = { ...clean(), vitalsMissing: [], facts: facts({ "claim.net": 9000, "careTeam.primaryCount": 1 }) };
    const f = reviewClaim(r, "claim");
    expect(f.map((x) => x.id)).toEqual(["rule:GR-009"]);
    expect(f[0]).toMatchObject({ severity: "warning", text: "The claim is above 5,000 SAR." });
    const noPrimary = reviewClaim({ ...r, facts: facts({ "claim.net": 10, "careTeam.primaryCount": 0 }) }, "claim");
    expect(noPrimary[0]).toMatchObject({ ruleId: "BV-01004", nphiesCode: "BV-01004", severity: "hard" });
    const net = getRules().fields.find((x) => x.key === "claim.net")!;
    const off = setFieldActive(net.id, false);
    expect(off.ok && off.stopped).toEqual(["GR-009"]);
    expect(reviewClaim(r, "claim")).toEqual([]);
    expect(setRuleActive("GR-009", true).ok).toBe(false);
  });

  it("the review of a real claim runs the condition rules", () => {
    const enc = insuredVisits().find((v) => v.enc.cls === "E" && !v.enc.ed?.ctas)?.enc;
    if (!enc) return;
    const m = claimFor(enc.visitNumber)!;
    expect(reviewModel(m, "claim").some((f) => f.ruleId === "BV-00341")).toBe(true);
  });

  it("rejects a condition rule without a field, value or number", () => {
    const base = { source: "generic" as const, name: "Test Rule", description: "", category: "Test", severity: "warning" as const, trigger: "both" as const, claimTypes: [], active: true, message: "Fires", fix: "Fix it" };
    expect(saveRule({ ...base, conditions: [] }).ok).toBe(false);
    expect(saveRule({ ...base, conditions: [{ field: "claim.net", op: "greater", value: "lots" }] }).ok).toBe(false);
    const ok = saveRule({ ...base, conditions: [{ field: "claim.net", op: "greater", value: "100" }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(deleteRule(ok.id!).ok).toBe(true);
    switchUser("U2");
    expect(saveRule({ ...base, conditions: [{ field: "claim.net", op: "greater", value: "100" }] }).ok).toBe(false);
  });

  it("reads an NPHIES rule sheet: finds the header row, maps fields, flags rows to review", () => {
    const table = [
      ["NPHIES Business Rules"],
      ["Rule ID", "Rule Type", "Related Element", "Description", "Display", "Severity", "Field", "Operator", "Value"],
      ["BV-00777", "Item", "Claim.item.unitPrice", "Unit price above zero.", "Unit price must be above zero", "Soft Stop", "Unit Cost", "Less Than", "0.01"],
      ["BV-00999", "Claim", "Claim.extension-newborn", "Newborn flag must match.", "Newborn flag mismatch", "", "", "", ""],
      ["BV-00112", "Coverage", "", "Covered on the service date.", "Not covered", "Hard Stop", "Eligibility Status", "Equals", "Not Eligible"],
      ["", "Item", "", "No id", "No id", "", "", "", ""],
    ];
    const { rows, missing } = readRuleRows(table);
    expect(missing).toEqual([]);
    expect(rows.map((r) => r.status)).toEqual(["Ready", "Needs Review", "Existing Rule", "Invalid"]);
    expect(rows[0].rule).toMatchObject({ severity: "soft", conditions: [{ field: "line.unitCost", op: "less", value: "0.01" }] });
    expect(rows[1].rule.active).toBe(false);
    expect(saveUploadedRules(rows).ok).toBe(false);
    expect(saveUploadedRules(rows.slice(0, 3)).ok).toBe(true);
    expect(rule("BV-00777").source).toBe("nphies");
    expect(readRuleRows([["Rule", "Text"]]).missing.length).toBe(5);
  });

  it("field mapping: one mapping per claim value", () => {
    const f = getRules().fields[0];
    expect(saveField({ ...f, id: undefined, name: "Copy" }).ok).toBe(false);
    expect(saveField({ ...f, name: "Type Of Claim" }).ok).toBe(true);
    expect(getRules().fields[0].name).toBe("Type Of Claim");
  });
});
