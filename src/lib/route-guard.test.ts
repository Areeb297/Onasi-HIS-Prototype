import { describe, expect, it } from "vitest";
import { routeAccess } from "./route-guard";
import { ROLES, type Permission } from "./session";

const as = (roleId: string) => {
  const perms = ROLES.find((r) => r.id === roleId)!.permissions;
  return (p: Permission) => perms.includes(p);
};

describe("route guard", () => {
  it("blocks admin master pages for every role but the administrator", () => {
    for (const role of ["physician", "nurse", "registration", "pharmacist", "lab", "radiologist", "billing", "auditor"]) {
      expect(routeAccess("/m/users", as(role)).allowed, role).toBe(false);
    }
    const users = routeAccess("/m/users", as("admin"));
    expect(users.allowed).toBe(true);
    expect(users.roles).toEqual(["System Administrator"]);
  });

  it("follows the worklist permission for lab, radiology, pharmacy and billing pages", () => {
    expect(routeAccess("/lab", as("lab")).allowed).toBe(true);
    expect(routeAccess("/lab", as("nurse")).allowed).toBe(false);
    expect(routeAccess("/radiology", as("radiologist")).allowed).toBe(true);
    expect(routeAccess("/pharmacy", as("pharmacist")).allowed).toBe(true);
    expect(routeAccess("/pharmacy", as("physician")).allowed).toBe(false);
    expect(routeAccess("/invoices", as("billing")).allowed).toBe(true);
    expect(routeAccess("/invoices", as("nurse")).allowed).toBe(false);
  });

  it("opens a page listed twice for either entry's role (Integrations: admin and billing)", () => {
    expect(routeAccess("/integrations", as("admin")).allowed).toBe(true);
    expect(routeAccess("/integrations", as("billing")).allowed).toBe(true);
    expect(routeAccess("/integrations", as("nurse")).allowed).toBe(false);
    expect(routeAccess("/integrations", as("nurse")).roles).toEqual(expect.arrayContaining(["Billing Officer", "System Administrator"]));
  });

  it("guards records and pages under a listed page", () => {
    expect(routeAccess("/claim", as("billing")).allowed).toBe(true);
    expect(routeAccess("/claim", as("physician")).allowed).toBe(false);
    expect(routeAccess("/invoice", as("registration")).allowed).toBe(false);
    expect(routeAccess("/rule-engine/upload", as("billing")).allowed).toBe(true);
    expect(routeAccess("/rule-engine/upload", as("nurse")).allowed).toBe(false);
  });

  it("leaves the chart, the dashboard and unknown addresses open, and names the page when blocked", () => {
    expect(routeAccess("/chart", as("billing")).allowed).toBe(true);
    expect(routeAccess("/dashboard", as("lab")).allowed).toBe(true);
    expect(routeAccess("/no-such-page", as("lab")).allowed).toBe(true);
    const lab = routeAccess("/lab", as("billing"));
    expect(lab.label).toBe("Worklist (Laboratory)");
    expect(lab.roles).toEqual(expect.arrayContaining(["Lab Technologist", "System Administrator"]));
  });
});
