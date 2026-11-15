import { useSyncExternalStore } from "react";

/**
 * Workspace tabs, as in Epic: every page or record you open lives in a tab under the top bar. The address bar always
 * shows the active tab, so links, Back and every existing navigate() call keep working.
 *
 * Rules when the address changes (a sidebar click, a link, a button that opens a chart):
 * - A tab already open on the same place (same page, or the same patient's chart, claim or invoice) is focused.
 * - A record (chart, claim, invoice, transaction) opens in a new tab.
 * - A page replaces the active tab, unless that tab is pinned, holds a record, the click asked for a new tab
 *   (Ctrl+click or middle click), or the user turned on "Open Pages In New Tabs".
 * - At most LIMIT tabs: the tab used longest ago that is not pinned closes first.
 *
 * Tabs are kept per demo user in localStorage, so switching user swaps the tab set and a reload restores it.
 * The pure functions below take and return a state; the store at the bottom holds the current user's tabs.
 */

export const TAB_LIMIT = 12;

export interface WorkspaceTab {
  id: string;
  /** The address of the tab without the leading "#", for example "/chart?visit=V100001&s=vitals". */
  route: string;
  /** A name the user typed. Empty means the title comes from the page. */
  title?: string;
  pinned: boolean;
  openedAt: number;
  usedAt: number;
  /** Scroll position of the page, restored when the tab is shown again. */
  scroll: number;
}

export interface TabsState {
  tabs: WorkspaceTab[];
  activeId: string;
  /** "Open Pages In New Tabs": a plain click on a page opens a new tab instead of replacing the active one. */
  newTabOnClick: boolean;
}

/** Records open in their own tab, keyed by the parameter that names them. */
const RECORDS: Record<string, string> = { "/chart": "visit", "/claim": "visit", "/invoice": "visit", "/transaction": "id" };

export type TabKind = "chart" | "claim" | "invoice" | "transaction" | "page";

export function splitRoute(route: string): { path: string; params: URLSearchParams } {
  const raw = route.replace(/^#/, "");
  const [path, query = ""] = raw.split("?");
  return { path: path || "/dashboard", params: new URLSearchParams(query) };
}

export function kindOf(route: string): TabKind {
  const { path } = splitRoute(route);
  return path === "/chart" ? "chart" : path === "/claim" ? "claim" : path === "/invoice" ? "invoice" : path === "/transaction" ? "transaction" : "page";
}

export const isRecord = (route: string) => kindOf(route) !== "page";

/** Two routes with the same place key belong in the same tab. A chart's section (s=...) does not change the place. */
export function placeKey(route: string): string {
  const { path, params } = splitRoute(route);
  const key = RECORDS[path];
  return key ? `${path}?${key}=${params.get(key) ?? ""}` : path;
}

let seq = 0;
const newId = (now: number) => `t${now.toString(36)}${(seq++).toString(36)}`;

export function makeTab(route: string, now: number, over: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return { id: newId(now), route, pinned: false, openedAt: now, usedAt: now, scroll: 0, ...over };
}

export function initialState(route: string, now: number = Date.now()): TabsState {
  const t = makeTab(route || "/dashboard", now);
  return { tabs: [t], activeId: t.id, newTabOnClick: false };
}

export const activeTab = (s: TabsState): WorkspaceTab => s.tabs.find((t) => t.id === s.activeId) ?? s.tabs[0];

/** Closes the oldest unpinned tabs, never the active one, until there are at most `limit`. */
export function enforceLimit(s: TabsState, limit: number = TAB_LIMIT): TabsState {
  let tabs = s.tabs;
  while (tabs.length > limit) {
    const victim = tabs.filter((t) => !t.pinned && t.id !== s.activeId).sort((a, b) => a.usedAt - b.usedAt)[0];
    if (!victim) break;
    tabs = tabs.filter((t) => t.id !== victim.id);
  }
  return tabs === s.tabs ? s : { ...s, tabs };
}

/** What happens when the address changes to `route`. See the rules at the top of the file. */
export function openRoute(s: TabsState, route: string, opts: { newTab?: boolean; now?: number; limit?: number } = {}): TabsState {
  const now = opts.now ?? Date.now();
  const active = activeTab(s);
  if (active && active.route === route) return s;
  const key = placeKey(route);
  const existing = s.tabs.find((t) => placeKey(t.route) === key);
  if (existing) {
    return { ...s, activeId: existing.id, tabs: s.tabs.map((t) => (t.id === existing.id ? { ...t, route, usedAt: now } : t)) };
  }
  const fresh = opts.newTab || isRecord(route) || !active || active.pinned || isRecord(active.route) || s.newTabOnClick;
  if (!fresh) {
    // The tab now holds another place, so a name typed for the old place no longer fits.
    return { ...s, tabs: s.tabs.map((t) => (t.id === active.id ? { ...t, route, title: undefined, usedAt: now, scroll: 0 } : t)) };
  }
  const t = makeTab(route, now);
  const at = active ? s.tabs.findIndex((x) => x.id === active.id) + 1 : s.tabs.length;
  const tabs = [...s.tabs.slice(0, at), t, ...s.tabs.slice(at)];
  return enforceLimit({ ...s, tabs, activeId: t.id }, opts.limit);
}

export function focusTab(s: TabsState, id: string, now: number = Date.now()): TabsState {
  if (!s.tabs.some((t) => t.id === id)) return s;
  return { ...s, activeId: id, tabs: s.tabs.map((t) => (t.id === id ? { ...t, usedAt: now } : t)) };
}

/** Closes a tab. Closing the active tab shows the tab used most recently before it. The last tab becomes the dashboard. */
export function closeTab(s: TabsState, id: string, now: number = Date.now()): TabsState {
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (tabs.length === s.tabs.length) return s;
  if (!tabs.length) {
    const t = makeTab("/dashboard", now);
    return { ...s, tabs: [t], activeId: t.id };
  }
  if (s.activeId !== id) return { ...s, tabs };
  const next = [...tabs].sort((a, b) => b.usedAt - a.usedAt)[0];
  return focusTab({ ...s, tabs }, next.id, now);
}

/** Keeps the given tab and the pinned tabs. */
export function closeOthers(s: TabsState, id: string, now: number = Date.now()): TabsState {
  const tabs = s.tabs.filter((t) => t.id === id || t.pinned);
  return focusTab({ ...s, tabs }, id, now);
}

/** Closes every tab that is not pinned. With nothing pinned, one dashboard tab is left. */
export function closeAll(s: TabsState, now: number = Date.now()): TabsState {
  const tabs = s.tabs.filter((t) => t.pinned);
  if (!tabs.length) {
    const t = makeTab("/dashboard", now);
    return { ...s, tabs: [t], activeId: t.id };
  }
  const keep = tabs.some((t) => t.id === s.activeId) ? s.activeId : tabs[0].id;
  return focusTab({ ...s, tabs }, keep, now);
}

/** Moves a tab to the place of another tab (drag and drop). */
export function moveTab(s: TabsState, fromId: string, toId: string): TabsState {
  const from = s.tabs.findIndex((t) => t.id === fromId);
  const to = s.tabs.findIndex((t) => t.id === toId);
  if (from < 0 || to < 0 || from === to) return s;
  const tabs = [...s.tabs];
  const [t] = tabs.splice(from, 1);
  tabs.splice(to, 0, t);
  return { ...s, tabs };
}

/** Renames a tab. An empty name goes back to the page's own title. */
export function renameTab(s: TabsState, id: string, title: string): TabsState {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 60);
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: clean || undefined } : t)) };
}

/** Pins or unpins a tab. Pinned tabs move to the front, keeping their order. */
export function togglePin(s: TabsState, id: string): TabsState {
  const tabs = s.tabs.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t));
  return { ...s, tabs: [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)] };
}

/** A copy of a tab next to it, same place and name, not pinned. It becomes active. */
export function duplicateTab(s: TabsState, id: string, now: number = Date.now(), limit: number = TAB_LIMIT): TabsState {
  const at = s.tabs.findIndex((t) => t.id === id);
  if (at < 0) return s;
  const src = s.tabs[at];
  const t = makeTab(src.route, now, { title: src.title, scroll: src.scroll });
  const tabs = [...s.tabs.slice(0, at + 1), t, ...s.tabs.slice(at + 1)];
  return enforceLimit({ ...s, tabs, activeId: t.id }, limit);
}

export const setScroll = (s: TabsState, id: string, scroll: number): TabsState =>
  ({ ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, scroll } : t)) });

/** The tab `step` places from the active one, wrapping round (Ctrl+Tab is +1, Ctrl+Shift+Tab is -1). */
export function cycle(s: TabsState, step: number, now: number = Date.now()): TabsState {
  const i = s.tabs.findIndex((t) => t.id === s.activeId);
  const n = s.tabs.length;
  return focusTab(s, s.tabs[(((i + step) % n) + n) % n].id, now);
}

/** Ctrl+1 to Ctrl+8 jump to that tab; Ctrl+9 jumps to the last, as in browsers. */
export function jumpTo(s: TabsState, digit: number, now: number = Date.now()): TabsState {
  const t = digit === 9 ? s.tabs[s.tabs.length - 1] : s.tabs[digit - 1];
  return t ? focusTab(s, t.id, now) : s;
}

/** Reads a saved state, dropping anything malformed. Returns null when there is nothing usable. */
export function parseSaved(raw: string | null): TabsState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TabsState>;
    const tabs = (Array.isArray(v.tabs) ? v.tabs : []).filter((t): t is WorkspaceTab => !!t && typeof t.id === "string" && typeof t.route === "string")
      .map((t) => ({ ...t, pinned: !!t.pinned, scroll: Number(t.scroll) || 0, openedAt: Number(t.openedAt) || 0, usedAt: Number(t.usedAt) || 0 }));
    if (!tabs.length) return null;
    const activeId = tabs.some((t) => t.id === v.activeId) ? (v.activeId as string) : tabs[0].id;
    return { tabs: tabs.slice(0, TAB_LIMIT * 2), activeId, newTabOnClick: !!v.newTabOnClick };
  } catch {
    return null;
  }
}

/* ---------- the store: the signed-in user's tabs ---------- */

export const storageKey = (userId: string) => `onasi-tabs-v1:${userId}`;

let user = "";
let state: TabsState = initialState("/dashboard", 0);
const listeners = new Set<() => void>();
/** Set by requestNewTab, read by the next address change. */
let wantNewTab = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function save() {
  try {
    if (user) localStorage.setItem(storageKey(user), JSON.stringify(state));
  } catch {
    /* storage may be full or blocked; tabs still work for this visit */
  }
}

function set(next: TabsState) {
  if (next === state) return;
  state = next;
  save();
  listeners.forEach((l) => l());
}

export const getTabs = () => state;
export const tabsUser = () => user;

/** Loads a user's saved tabs, or starts with one tab on `route`. Called at start and when the user changes. */
export function loadTabs(userId: string, route: string, now: number = Date.now()): TabsState {
  user = userId;
  let saved: TabsState | null = null;
  try {
    saved = parseSaved(localStorage.getItem(storageKey(userId)));
  } catch {
    saved = null;
  }
  state = saved ?? initialState(route, now);
  save();
  listeners.forEach((l) => l());
  return state;
}

/** The address changed. Returns the route the address should show (the active tab's), which may be the same. */
export function syncRoute(route: string, now: number = Date.now()): string {
  const newTab = wantNewTab;
  wantNewTab = false;
  set(openRoute(state, route, { newTab, now }));
  return activeTab(state).route;
}

/** The next address change opens a new tab (Ctrl+click, middle click). */
export function requestNewTab() {
  wantNewTab = true;
}

export const tabActions = {
  focus: (id: string) => set(focusTab(state, id)),
  close: (id: string) => set(closeTab(state, id)),
  closeOthers: (id: string) => set(closeOthers(state, id)),
  closeAll: () => set(closeAll(state)),
  move: (fromId: string, toId: string) => set(moveTab(state, fromId, toId)),
  rename: (id: string, title: string) => set(renameTab(state, id, title)),
  togglePin: (id: string) => set(togglePin(state, id)),
  duplicate: (id: string) => set(duplicateTab(state, id)),
  /** Remembers the scroll position without re-rendering; written to storage a moment later. */
  scroll: (id: string, y: number) => {
    state = setScroll(state, id, y);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  },
  cycle: (step: number) => set(cycle(state, step)),
  jump: (digit: number) => set(jumpTo(state, digit)),
  setNewTabOnClick: (on: boolean) => set({ ...state, newTabOnClick: on }),
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useTabs(): TabsState {
  return useSyncExternalStore(subscribe, getTabs, getTabs);
}
