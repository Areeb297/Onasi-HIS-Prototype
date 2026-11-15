import { beforeEach, describe, expect, it } from "vitest";
import {
  activeTab, canDuplicate, cancelPendingChart, CHART_LIMIT, chartsOldestFirst, chartTabs, closeAll, closeOthers, closeTab, cycle, duplicateTab,
  getTabs, initialState, jumpTo, loadTabs, moveTab, openRoute, parseSaved, placeKey, renameTab, requestNewTab, resolvePendingChart, storageKey,
  syncRoute, tabActions, TAB_LIMIT, togglePin, type TabsState,
} from "./workspace-tabs";

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(), key: () => null, length: 0,
};

const routes = (s: TabsState) => s.tabs.map((t) => t.route);
let clock = 1000;
const at = () => (clock += 10);
const open = (s: TabsState, r: string, newTab = false) => openRoute(s, r, { now: at(), newTab });

beforeEach(() => { mem.clear(); clock = 1000; });

describe("opening places", () => {
  it("a page replaces the active page tab; a record opens a new tab", () => {
    let s = initialState("/dashboard", at());
    s = open(s, "/opd");
    expect(routes(s)).toEqual(["/opd"]);
    s = open(s, "/chart?visit=V100001");
    expect(routes(s)).toEqual(["/opd", "/chart?visit=V100001"]);
    expect(activeTab(s).route).toBe("/chart?visit=V100001");
  });

  it("focuses the tab already open on the same place, keeping a chart's section change in that tab", () => {
    let s = initialState("/opd", at());
    s = open(s, "/chart?visit=V100001");
    s = open(s, "/chart?visit=V100002");
    s = open(s, "/chart?visit=V100001&s=vitals");
    expect(s.tabs).toHaveLength(3);
    expect(activeTab(s).route).toBe("/chart?visit=V100001&s=vitals");
    expect(placeKey("/chart?visit=V100001&s=vitals")).toBe(placeKey("/chart?visit=V100001"));
    expect(placeKey("/claim?visit=V1")).not.toBe(placeKey("/invoice?visit=V1"));
  });

  it("opens a page in a new tab when the active tab is pinned, holds a record, the click asked for it, or the setting is on", () => {
    let s = initialState("/opd", at());
    s = togglePin(s, s.activeId);
    s = open(s, "/ipd");
    expect(routes(s)).toEqual(["/opd", "/ipd"]);
    s = open(s, "/chart?visit=V100001");
    s = open(s, "/billing");
    expect(routes(s)).toEqual(["/opd", "/ipd", "/chart?visit=V100001", "/billing"]);
    s = open(s, "/beds", true);
    expect(s.tabs).toHaveLength(5);
    s = { ...s, newTabOnClick: true };
    s = open(s, "/er");
    expect(s.tabs).toHaveLength(6);
  });

  it("a renamed tab loses its name when it moves to another page", () => {
    let s = initialState("/opd", at());
    s = renameTab(s, s.activeId, "  Morning   clinic ");
    expect(activeTab(s).title).toBe("Morning clinic");
    s = open(s, "/ipd");
    expect(activeTab(s).title).toBeUndefined();
  });
});

describe("closing, moving, pinning", () => {
  it("closing the active tab shows the tab used just before it; the last tab becomes the dashboard", () => {
    let s = initialState("/opd", at());
    s = open(s, "/chart?visit=V1");
    s = open(s, "/chart?visit=V2");
    const opd = s.tabs[0].id;
    s = open(s, "/opd"); // focus OPD
    s = open(s, "/chart?visit=V2"); // back to V2
    s = closeTab(s, s.activeId, at());
    expect(s.activeId).toBe(opd);
    for (const t of [...s.tabs]) s = closeTab(s, t.id, at());
    expect(routes(s)).toEqual(["/dashboard"]);
  });

  it("Close Others keeps the tab and the pinned ones; Close All keeps only pinned, or one dashboard", () => {
    let s = initialState("/opd", at());
    s = togglePin(s, s.activeId);
    s = open(s, "/chart?visit=V1");
    s = open(s, "/chart?visit=V2");
    const v2 = s.activeId;
    s = open(s, "/chart?visit=V3");
    expect(routes(closeOthers(s, v2, at()))).toEqual(["/opd", "/chart?visit=V2"]);
    expect(routes(closeAll(s, at()))).toEqual(["/opd"]);
    expect(routes(closeAll(togglePin(s, s.tabs[0].id), at()))).toEqual(["/dashboard"]);
  });

  it("moves a tab by drag and drop, and pinned tabs go first", () => {
    let s = initialState("/opd", at());
    s = open(s, "/chart?visit=V1");
    s = open(s, "/chart?visit=V2");
    const [a, b, c] = s.tabs.map((t) => t.id);
    s = moveTab(s, c, a);
    expect(s.tabs.map((t) => t.id)).toEqual([c, a, b]);
    s = togglePin(s, b);
    expect(s.tabs.map((t) => t.id)).toEqual([b, c, a]);
    expect(s.tabs[0].pinned).toBe(true);
  });

  it("duplicates a tab next to it with the same place and name", () => {
    let s = initialState("/opd", at());
    s = renameTab(s, s.activeId, "Clinic A");
    s = duplicateTab(s, s.activeId, at());
    expect(routes(s)).toEqual(["/opd", "/opd"]);
    expect(activeTab(s).title).toBe("Clinic A");
    expect(s.tabs[0].id).not.toBe(s.tabs[1].id);
  });

  it("keeps at most the limit, closing the tab used longest ago that is not pinned", () => {
    let s = initialState("/opd", at());
    const first = s.activeId;
    s = togglePin(s, first);
    for (let i = 1; i <= TAB_LIMIT + 3; i++) s = open(s, `/m/page-${i}`, true);
    expect(s.tabs).toHaveLength(TAB_LIMIT);
    expect(s.tabs[0].id).toBe(first); // pinned, kept although oldest
    expect(routes(s)).not.toContain("/m/page-1");
    expect(activeTab(s).route).toBe(`/m/page-${TAB_LIMIT + 3}`);
  });

  it("Ctrl+Tab cycles and Ctrl+1..9 jump, with 9 the last tab", () => {
    let s = initialState("/opd", at());
    s = open(s, "/chart?visit=V1");
    s = open(s, "/chart?visit=V2");
    expect(activeTab(cycle(s, 1, at())).route).toBe("/opd");
    expect(activeTab(cycle(s, -1, at())).route).toBe("/chart?visit=V1");
    expect(activeTab(jumpTo(s, 1, at())).route).toBe("/opd");
    expect(activeTab(jumpTo(s, 9, at())).route).toBe("/chart?visit=V2");
    expect(jumpTo(s, 5, at())).toBe(s);
  });
});

describe("chart limit", () => {
  const fourCharts = () => {
    let s = initialState("/opd", at());
    for (let i = 1; i <= CHART_LIMIT; i++) s = open(s, `/chart?visit=V${i}`);
    return s;
  };

  it("opening one chart more than the limit opens nothing and closes nothing; it waits for the user", () => {
    const s = fourCharts();
    const next = open(s, "/chart?visit=V9");
    expect(chartTabs(next)).toHaveLength(CHART_LIMIT);
    expect(next.tabs.map((t) => t.id)).toEqual(s.tabs.map((t) => t.id));
    expect(next.activeId).toBe(s.activeId);
    expect(next.pendingChart).toBe("/chart?visit=V9");
  });

  it("an already open chart and other pages are not limited", () => {
    const s = fourCharts();
    expect(open(s, "/chart?visit=V2&s=vitals").pendingChart).toBeUndefined();
    const withPages = open(open(s, "/billing", true), "/beds", true);
    expect(withPages.tabs).toHaveLength(CHART_LIMIT + 3);
    expect(withPages.pendingChart).toBeUndefined();
  });

  it("lists charts oldest first, and closing the chart the user picks opens the waiting one", () => {
    const s = open(fourCharts(), "/chart?visit=V9");
    const list = chartsOldestFirst(s);
    expect(list.map((t) => t.route)).toEqual(["/chart?visit=V1", "/chart?visit=V2", "/chart?visit=V3", "/chart?visit=V4"]);
    const done = resolvePendingChart(s, list[1].id, at());
    expect(done.pendingChart).toBeUndefined();
    expect(routes(done)).not.toContain("/chart?visit=V2");
    expect(activeTab(done).route).toBe("/chart?visit=V9");
    expect(chartTabs(done)).toHaveLength(CHART_LIMIT);
    expect(cancelPendingChart(s).pendingChart).toBeUndefined();
    expect(resolvePendingChart(s, s.tabs[0].id, at())).toBe(s); // a page is not a chart: nothing happens
  });

  it("the overall tab limit never closes a chart, and a chart cannot be duplicated past the limit", () => {
    let s = fourCharts();
    for (let i = 0; i < TAB_LIMIT + 2; i++) s = open(s, `/m/page-${i}`, true);
    expect(s.tabs).toHaveLength(TAB_LIMIT);
    expect(chartTabs(s)).toHaveLength(CHART_LIMIT);
    const chart = chartTabs(s)[0].id;
    expect(canDuplicate(s, chart)).toBe(false);
    expect(duplicateTab(s, chart, at())).toBe(s);
  });
});

describe("saved per user", () => {
  it("restores each user's own tabs, and starts a new user with one tab", () => {
    loadTabs("U1", "/opd", at());
    syncRoute("/chart?visit=V100001", at());
    tabActions.rename(getTabs().activeId, "Saad");
    expect(routes(getTabs())).toEqual(["/opd", "/chart?visit=V100001"]);

    loadTabs("U7", "/billing", at());
    expect(routes(getTabs())).toEqual(["/billing"]);
    syncRoute("/invoices", at());
    expect(routes(getTabs())).toEqual(["/invoices"]);

    loadTabs("U1", "/whatever", at());
    expect(routes(getTabs())).toEqual(["/opd", "/chart?visit=V100001"]);
    expect(activeTab(getTabs()).title).toBe("Saad");
    expect(JSON.parse(mem.get(storageKey("U7"))!).tabs[0].route).toBe("/invoices");
  });

  it("a Ctrl+click asks for a new tab once", () => {
    loadTabs("U2", "/opd", at());
    requestNewTab();
    syncRoute("/ipd", at());
    syncRoute("/er", at());
    expect(routes(getTabs())).toEqual(["/opd", "/er"]);
  });

  it("ignores damaged saved data", () => {
    expect(parseSaved("not json")).toBeNull();
    expect(parseSaved(JSON.stringify({ tabs: [] }))).toBeNull();
    const s = parseSaved(JSON.stringify({ tabs: [{ id: "a", route: "/opd" }, { bad: 1 }], activeId: "zzz" }))!;
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe("a");
    expect(s.tabs[0].pinned).toBe(false);
  });
});
