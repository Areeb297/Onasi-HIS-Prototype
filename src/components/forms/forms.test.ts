import { describe, expect, it } from "vitest";
import { attentionText, countIn, firstErrorKey, isBlank, rangeText, rules, summaryItems, validate, visibleErrors } from "./validation";
import { createDirtyRegistry, createLeaveGate, isDirty } from "./unsaved";
import { clearDraft, loadDraft, saveDraft } from "./drafts";

describe("isBlank", () => {
  it("treats empty values as blank", () => {
    for (const v of [undefined, null, "", "   ", [], false, Number.NaN]) expect(isBlank(v)).toBe(true);
  });
  it("treats real values as filled", () => {
    for (const v of ["a", 0, ["x"], true]) expect(isBlank(v)).toBe(false);
  });
});

describe("rules and validate", () => {
  const order = ["name", "age", "note"];
  const fieldRules = {
    name: [rules.required("Enter the name.")],
    age: [rules.required(), rules.range(0, 120)],
    note: [rules.minLength(5)],
  };

  it("keeps the first problem of each field", () => {
    const e = validate({ name: "", age: "", note: "" }, fieldRules);
    expect(e).toEqual({ name: "Enter the name.", age: "This field is required." });
  });

  it("checks number ranges and leaves empty optional fields alone", () => {
    expect(validate({ name: "Sara", age: 130, note: "" }, fieldRules)).toEqual({ age: "Enter a number from 0 to 120." });
    expect(validate({ name: "Sara", age: "abc", note: "" }, fieldRules)).toEqual({ age: "Enter a number." });
    expect(validate({ name: "Sara", age: "45", note: "ok" }, fieldRules)).toEqual({ note: "Enter at least 5 characters." });
    expect(validate({ name: "Sara", age: 45, note: "" }, fieldRules)).toEqual({});
  });

  it("writes range messages in plain words", () => {
    expect(rangeText(1, 4)).toBe("Enter a number from 1 to 4.");
    expect(rangeText(0)).toBe("Enter 0 or more.");
    expect(rangeText(undefined, 10)).toBe("Enter 10 or less.");
  });

  it("matches a pattern only when there is a value", () => {
    const r = rules.pattern(/^\d{10}$/, "Enter 10 digits.");
    expect(r("", {})).toBeUndefined();
    expect(r("12345", {})).toBe("Enter 10 digits.");
    expect(r("1000000011", {})).toBeUndefined();
  });

  it("shows only the errors of fields the user left, until a save attempt", () => {
    const errors = { name: "Enter the name.", age: "This field is required." };
    expect(visibleErrors(errors, new Set(), false)).toEqual({});
    expect(visibleErrors(errors, new Set(["age"]), false)).toEqual({ age: "This field is required." });
    expect(visibleErrors(errors, new Set(), true)).toEqual(errors);
  });

  it("finds the first error in form order, and builds the summary in that order", () => {
    const errors = { note: "x", age: "y" };
    expect(firstErrorKey(errors, order)).toBe("age");
    expect(firstErrorKey({ other: "z" }, order)).toBe("other");
    expect(firstErrorKey({}, order)).toBeUndefined();
    expect(summaryItems(errors, order, { age: "Age" }).map((i) => [i.key, i.label])).toEqual([["age", "Age"], ["note", "note"]]);
    expect(countIn(errors, ["age", "name"])).toBe(1);
  });

  it("says how many fields need attention", () => {
    expect(attentionText(1)).toBe("1 field needs attention");
    expect(attentionText(3)).toBe("3 fields need attention");
  });
});

describe("unsaved changes", () => {
  it("sees no change when values only look different", () => {
    expect(isDirty({ a: "" }, {})).toBe(false);
    expect(isDirty({ a: [] }, { a: undefined })).toBe(false);
    expect(isDirty({ a: false }, {})).toBe(false);
    expect(isDirty({ n: 5 }, { n: "5" })).toBe(false);
    expect(isDirty({ list: ["x", "y"] }, { list: ["x", "y"] })).toBe(false);
  });

  it("sees a real change", () => {
    expect(isDirty({}, { a: "typed" })).toBe(true);
    expect(isDirty({ list: ["x"] }, { list: ["x", "y"] })).toBe(true);
    expect(isDirty({ ok: true }, { ok: false })).toBe(true);
    expect(isDirty({ nested: { a: 1 } }, { nested: { a: 2 } })).toBe(true);
  });

  it("stops a route change only while there are changes, and lets one through after the user agrees", () => {
    const gate = createLeaveGate();
    expect(gate.shouldBlock(false)).toBe(false);
    expect(gate.shouldBlock(true)).toBe(true);
    gate.allowNext();
    expect(gate.shouldBlock(true)).toBe(false);
    expect(gate.shouldBlock(true)).toBe(true);
  });

  it("asks when any open form has changes, and forgets a form when it closes", () => {
    const reg = createDirtyRegistry();
    let a = false;
    const offA = reg.register(() => a);
    const offB = reg.register(() => false);
    expect(reg.anyDirty()).toBe(false);
    a = true;
    expect(reg.anyDirty()).toBe(true);
    offA();
    expect(reg.anyDirty()).toBe(false);
    offB();
    expect(reg.size()).toBe(0);
  });
});

describe("drafts", () => {
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it("saves, loads and clears a draft by key", () => {
    const s = mem();
    saveDraft("V1:form:new", { a: "typed" }, s, new Date("2026-11-15T10:00:00Z"));
    expect(loadDraft("V1:form:new", s)).toEqual({ values: { a: "typed" }, savedAt: "2026-11-15T10:00:00.000Z" });
    expect(loadDraft("V1:other:new", s)).toBeUndefined();
    clearDraft("V1:form:new", s);
    expect(loadDraft("V1:form:new", s)).toBeUndefined();
  });

  it("survives broken storage", () => {
    const s = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(loadDraft("x", s)).toBeUndefined();
    expect(() => saveDraft("x", {}, s)).not.toThrow();
  });
});
