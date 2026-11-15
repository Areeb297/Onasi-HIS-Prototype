import { describe, expect, it } from "vitest";
import { clampRatio, closePane, loadSplitPrefs, openBeside, paneOf, readSplit, setPane, splitParams, swap, toggleSplit, type Pane } from "./split";

const q = (s: string) => new URLSearchParams(s);
const P = (section: string, tab?: string): Pane => paneOf(section, tab)!;
const emar = P("emar"), vitals = P("vitals"), rx = P("prescription"), labResults = P("laboratory"), labOrders = P("laboratory", "orders");

describe("chart split view", () => {
  it("reads the deep link, and a plain ?s= link still opens one section", () => {
    expect(readSplit(q("visit=V1&s=emar"))).toEqual({ left: { section: "emar", tab: "medications" }, right: null });
    expect(readSplit(q("s=emar&s2=vitals"))).toEqual({ left: emar, right: vitals });
    expect(readSplit(q("s=prescription&s2=laboratory"))).toEqual({ left: { section: "prescription", tab: "orders" }, right: { section: "laboratory", tab: "results" } });
    expect(readSplit(q("s=laboratory&t=orders&s2=laboratory"))).toEqual({ left: labOrders, right: labResults });
    expect(readSplit(q(""))).toEqual({ left: { section: "overview", tab: "overview" }, right: null });
    expect(readSplit(q("s=vitals&s2=no-such-section")).right).toBeNull();
    expect(readSplit(q("s=vitals&s2=vitals")).right).toBeNull(); // the same pane twice is no split
  });

  it("writes the link back, with a tab only when it is not the usual one", () => {
    expect(splitParams({ left: emar, right: vitals })).toEqual({ s: "emar", t: undefined, s2: "vitals", t2: undefined });
    expect(splitParams({ left: labOrders, right: labResults })).toEqual({ s: "laboratory", t: "orders", s2: "laboratory", t2: undefined });
    expect(splitParams({ left: emar, right: null })).toEqual({ s: "emar", t: undefined, s2: undefined, t2: undefined });
    const link = splitParams({ left: rx, right: labOrders });
    expect(readSplit(q(`s=${link.s}&s2=${link.s2}&t2=${link.t2}`))).toEqual({ left: rx, right: labOrders });
  });

  it("opens a second section, and a third one replaces the second", () => {
    const one = { left: emar, right: null };
    const two = openBeside(one, vitals);
    expect(two).toEqual({ left: emar, right: vitals });
    expect(openBeside(two, rx)).toEqual({ left: emar, right: rx });
    expect(openBeside(one, emar)).toBe(one); // the section that is already open does not split
  });

  it("changes one pane, and swaps when the other pane's section is picked", () => {
    const two = { left: emar, right: vitals };
    expect(setPane(two, "right", rx)).toEqual({ left: emar, right: rx });
    expect(setPane(two, "left", rx)).toEqual({ left: rx, right: vitals });
    expect(setPane(two, "left", vitals)).toEqual({ left: vitals, right: emar });
    expect(setPane({ left: emar, right: null }, "left", vitals)).toEqual({ left: vitals, right: null });
    expect(swap(two)).toEqual({ left: vitals, right: emar });
    expect(swap({ left: emar, right: null })).toEqual({ left: emar, right: null });
  });

  it("closes a pane: the one that stays becomes the whole chart", () => {
    const two = { left: emar, right: vitals };
    expect(closePane(two, "right")).toEqual({ left: emar, right: null });
    expect(closePane(two, "left")).toEqual({ left: vitals, right: null });
  });

  it("toggles with the section used last, and keeps the width inside 30 to 70 percent", () => {
    expect(toggleSplit({ left: emar, right: vitals })).toEqual({ left: emar, right: null });
    expect(toggleSplit({ left: emar, right: null }, rx)).toEqual({ left: emar, right: rx });
    expect(toggleSplit({ left: emar, right: null }, emar).right).toEqual(vitals); // last is the open one: fall back
    expect(toggleSplit({ left: vitals, right: null }).right).toEqual(P("overview"));
    expect([0.1, 0.5, 0.95, NaN].map(clampRatio)).toEqual([0.3, 0.5, 0.7, 0.5]);
    expect(loadSplitPrefs("U1")).toEqual({ ratio: 0.5, last: null }); // nothing stored (and no storage in tests)
  });
});
