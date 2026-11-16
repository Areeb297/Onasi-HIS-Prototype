import { NAV } from "./nav";
import { ROLES, hasNeed, type Permission, type PermissionNeed } from "./session";

/**
 * Who may open a page by its address. The sidebar already hides what a role cannot use; this stops the same pages
 * opening from a typed or pasted link. The rule comes from the sidebar itself, so the two never disagree:
 * - a page listed in the sidebar opens when any of its sidebar entries is visible to the user (group and page
 *   permission), so a page listed twice (Integrations for the admin and for billing) opens for both;
 * - a page under a listed page (/rule-engine/upload under /rule-engine) follows that page;
 * - records opened from a worklist follow the worklist (a claim, an invoice or a transaction needs billing);
 * - anything else (the chart, the dashboard) is open to every signed-in user, and the page decides what can be changed.
 * Developer pages are handled by the Developer View switch, not here.
 */

const RECORD_PERMS: Record<string, PermissionNeed> = {
  "/claim": ["billing", "coding", "approvals"], "/invoice": ["billing", "cashier"], "/transaction": "billing",
};

export interface RouteAccess {
  allowed: boolean;
  /** The page's name, for the No Access card. */
  label: string;
  /** Any one of these lists opens the page; every need in it must be met (a need that is a list: any one). Empty means anyone. */
  perms: PermissionNeed[][];
  /** Roles that can open it, for the No Access card. */
  roles: string[];
}

interface Entry { label: string; need: PermissionNeed[] }

function entriesFor(path: string): Entry[] {
  const out: Entry[] = [];
  for (const g of NAV) {
    if (g.devOnly) continue;
    for (const p of g.pages) {
      if (p.path === path) {
        out.push({ label: p.label === g.label ? p.label : `${p.label} (${g.label})`, need: [g.perm, p.perm].filter((x): x is PermissionNeed => !!x) });
      }
    }
  }
  return out;
}

export function routeAccess(path: string, has: (p: Permission) => boolean): RouteAccess {
  let entries = entriesFor(path);
  if (!entries.length && RECORD_PERMS[path]) {
    const label = path === "/claim" ? "Claim" : path === "/invoice" ? "Invoice" : "Transaction";
    entries = [{ label, need: [RECORD_PERMS[path]] }];
  }
  if (!entries.length) {
    // The closest listed page above this one, for example /automations for /automations/builder.
    const parent = NAV.flatMap((g) => (g.devOnly ? [] : g.pages.map((p) => p.path)))
      .filter((p) => path.startsWith(`${p}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (parent) entries = entriesFor(parent);
  }
  if (!entries.length) return { allowed: true, label: "", perms: [], roles: [] };
  const perms = entries.map((e) => e.need);
  const opens = (ok: (n: PermissionNeed) => boolean) => perms.some((need) => need.every(ok));
  const roles = ROLES.filter((r) => opens((n) => hasNeed(r.permissions, n))).map((r) => r.label);
  return { allowed: opens((n) => (typeof n === "string" ? has(n) : n.some(has))), label: entries[0].label, perms, roles };
}
