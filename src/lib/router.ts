import { useSyncExternalStore } from "react";

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/patients";
  const [path, query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
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

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function navigate(path: string, params?: Record<string, string | undefined>) {
  const q = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => v && q.set(k, v));
  const s = q.toString();
  window.location.hash = s ? `${path}?${s}` : path;
}
