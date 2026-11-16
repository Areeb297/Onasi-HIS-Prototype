import { describe, expect, it } from "vitest";
import { PERMISSION_LABELS } from "./permission-labels";
import { routeAccess } from "./route-guard";
import { IDLE_MAX, IDLE_MIN, ROLES, USERS, breakGlass, clampIdle, currentUser, hasGlass, lockScreen, signInFromLock, switchUser, type Permission } from "./session";
import { audit, clearAudit, getAudit, resolveAuditPatient } from "./audit";
import { getState, patientName } from "./store";

const as = (roleId: string) => {
  const perms = ROLES.find((r) => r.id === roleId)!.permissions;
  return (p: Permission) => perms.includes(p);
};

describe("roles and segregation", () => {
  it("has the roles a Saudi hospital needs, each with a user", () => {
    for (const label of ["Cashier", "Insurance Approvals Officer", "Medical Coder", "Bed Manager", "Pharmacist", "Radiologist", "Billing Officer"]) {
      const role = ROLES.find((r) => r.label === label);
      expect(role, label).toBeTruthy();
      expect(USERS.some((u) => u.role === role!.id), label).toBe(true);
    }
    expect(USERS.some((u) => u.role === "nurse" && /triage/i.test(u.department))).toBe(true);
  });

  it("lets the bed manager reach beds and ward view but not registration, charts or billing", () => {
    const bm = as("bed-manager");
    expect(routeAccess("/beds", bm).allowed).toBe(true);
    expect(routeAccess("/ward-view", bm).allowed).toBe(true);
    expect(routeAccess("/admission-requests", bm).allowed).toBe(true);
    expect(routeAccess("/registration", bm).allowed).toBe(false);
    expect(routeAccess("/invoices", bm).allowed).toBe(false);
    expect(bm("emr.read")).toBe(false);
  });

  it("lets the approvals officer reach NPHIES Financial and admission requests", () => {
    expect(routeAccess("/nphies-financial", as("approvals")).allowed).toBe(true);
    expect(routeAccess("/admission-requests", as("approvals")).allowed).toBe(true);
  });

  it("gives the administrator every permission, and each finance duty to one role only", () => {
    expect([...ROLES.find((r) => r.id === "admin")!.permissions].sort()).toEqual(Object.keys(PERMISSION_LABELS).sort());
    for (const p of ["cashier", "approvals", "coding"] as Permission[]) {
      expect(ROLES.filter((r) => r.id !== "admin" && r.permissions.includes(p)).length, p).toBe(1);
    }
  });

  it("keeps finance roles out of clinical worklists, setup and each other's work", () => {
    for (const role of ["cashier", "approvals", "coder"]) {
      expect(as(role)("billing"), role).toBe(false);
      for (const path of ["/lab", "/m/users", "/rule-engine", "/transactions", "/m/daman-dashboard"]) expect(routeAccess(path, as(role)).allowed, `${role} ${path}`).toBe(false);
    }
    expect(as("approvals")("adt.send")).toBe(false);
  });

  it("opens each finance role's own pages", () => {
    const opens = (role: string, paths: string[], ok: boolean) => paths.forEach((p) => expect(routeAccess(p, as(role)).allowed, `${role} ${p}`).toBe(ok));
    opens("cashier", ["/invoices", "/invoice"], true);
    opens("cashier", ["/billing", "/claim", "/nphies-financial"], false);
    opens("approvals", ["/nphies-financial", "/claim", "/admission-requests"], true);
    opens("approvals", ["/invoices", "/billing"], false);
    opens("coder", ["/billing", "/claim"], true);
    opens("coder", ["/invoices", "/nphies-financial"], false);
    opens("billing", ["/invoices", "/invoice", "/billing", "/claim", "/nphies-financial", "/transactions"], true);
  });
});

describe("radiology", () => {
  it("opens the radiology worklist for the technician, who may perform but not report", () => {
    const tech = as("rad-tech");
    expect(routeAccess("/radiology", tech).allowed).toBe(true);
    expect(tech("rad.perform")).toBe(true);
    expect(tech("rad.report")).toBe(false);
    expect(as("radiologist")("rad.perform")).toBe(true);
    expect(routeAccess("/radiology", as("nurse")).allowed).toBe(false);
    expect(USERS.some((u) => u.role === "rad-tech")).toBe(true);
  });
});

describe("session rules", () => {
  it("never turns the idle lock off and caps it", () => {
    expect(clampIdle(0)).toBe(IDLE_MIN);
    expect(clampIdle(500)).toBe(IDLE_MAX);
    expect(clampIdle(15)).toBe(15);
  });

  it("needs a reason to break the glass", () => {
    expect(breakGlass("P-glass", "Test Patient", "   ")).toBe(false);
    expect(hasGlass("P-glass")).toBe(false);
    expect(breakGlass("P-glass", "Test Patient", "Emergency care")).toBe(true);
    expect(hasGlass("P-glass")).toBe(true);
  });

  it("signs another person in at the lock screen and drops the old session's glass", () => {
    switchUser("U1");
    breakGlass("P-glass2", "Test Patient", "Treating team");
    lockScreen();
    signInFromLock("U2");
    expect(currentUser().id).toBe("U2");
    expect(hasGlass("P-glass2")).toBe(false);
    switchUser("U1");
  });

  it("records the clearing of the audit trail", () => {
    clearAudit();
    const entries = getAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "delete", target: "Audit trail" });
  });
});

describe("audit patient", () => {
  it("stores the same MRN and name whether the caller passed the id, the MRN or the name", () => {
    const p = getState().patients[0];
    for (const v of [p.id, p.mrn, patientName(p)]) expect(resolveAuditPatient(v), v).toEqual({ patient: patientName(p), mrn: p.mrn });
    expect(resolveAuditPatient("Unknown patient")).toEqual({ patient: "Unknown patient" });
    expect(resolveAuditPatient(undefined)).toEqual({});
    audit("view", "Chart test", { patient: p.id });
    expect(getAudit().at(-1)).toMatchObject({ patient: patientName(p), mrn: p.mrn });
  });
});
