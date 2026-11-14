import { describe, expect, it } from "vitest";
import { EMR_MENU } from "./emr-menu";
import { MASTERS } from "./masters-data";
import { NAV } from "./nav";
import { ROLES, type Permission } from "./session";
import { PERMISSION_LABELS } from "./permission-labels";
import { FRAMEWORKS } from "./compliance-data";

const ROUTES = new Set([
  "/patients", "/confidential", "/registration", "/opd", "/ipd", "/er", "/beds", "/lab", "/radiology", "/theatre", "/pharmacy/dispense",
  "/audit", "/compliance", "/ai-governance", "/nphies-clinical", "/nphies-financial", "/agents", "/dashboard", "/access", "/runner", "/log", "/encounters", "/spec",
]);

describe("menu", () => {
  const pages = NAV.flatMap((g) => g.pages);

  it("every page path is a known route or a setup page that has a definition", () => {
    const missing = pages.filter((p) => !(ROUTES.has(p.path) || (p.path.startsWith("/m/") && MASTERS.some((m) => `/m/${m.id}` === p.path)))).map((p) => p.path);
    expect(missing).toEqual([]);
  });

  it("has no duplicate setup ids", () => {
    const ids = MASTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("chart menu ids are unique", () => {
    const ids = EMR_MENU.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("roles and permissions", () => {
  it("every permission used by a role or a page has a label", () => {
    const used = new Set<Permission>([...ROLES.flatMap((r) => r.permissions), ...NAV.flatMap((g) => [g.perm, ...g.pages.map((p) => p.perm)]).filter(Boolean) as Permission[]]);
    for (const p of used) expect(PERMISSION_LABELS[p], p).toBeTruthy();
  });

  it("the administrator has every permission", () => {
    const admin = ROLES.find((r) => r.id === "admin")!;
    for (const p of Object.keys(PERMISSION_LABELS) as Permission[]) expect(admin.permissions).toContain(p);
  });
});

describe("compliance map", () => {
  it("has unique control ids and a status for every control", () => {
    const ids = FRAMEWORKS.flatMap((f) => f.controls.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FRAMEWORKS) for (const c of f.controls) expect(["Applied", "Partial", "Not applied", "Needs backend"]).toContain(c.status);
  });
});
