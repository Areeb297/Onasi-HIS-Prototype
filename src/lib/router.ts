import { createContext, useContext, useSyncExternalStore } from "react";

export interface Route {
  path: string;
  params: URLSearchParams;
}

/** Reads a route from an address such as "#/chart?visit=V100001" or "/chart?visit=V100001". */
export function routeOf(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/patients";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

function parse(): Route {
  return routeOf(window.location.hash);
}

let cache: { hash: string; route: Route } | null = null;

function snapshot(): Route {
  const hash = window.location.hash;
  if (!cache || cache.hash !== hash) cache = { hash, route: parse() };
  return cache.route;
}

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/**
 * Each workspace tab renders its page inside a RouteProvider with the tab's own route, so a page kept open in a
 * background tab keeps reading its own address, not the active tab's.
 */
const RouteContext = createContext<Route | null>(null);
export const RouteProvider = RouteContext.Provider;

export function useRoute(): Route {
  const own = useContext(RouteContext);
  const global = useSyncExternalStore(subscribe, snapshot, snapshot);
  return own ?? global;
}

export function navigate(path: string, params?: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => v && q.set(k, v));
  const s = q.toString();
  window.location.hash = s ? `${path}?${s}` : path;
}
