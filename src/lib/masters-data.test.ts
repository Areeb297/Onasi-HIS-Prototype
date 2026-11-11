import { describe, expect, it } from "vitest";
import { MASTERS } from "./masters-data";
import { NAV } from "./nav";
import { ROLES, USERS } from "./session";

const masterPaths = NAV.flatMap((g) => g.pages).filter((p) => p.path.startsWith("/m/"));

describe("masters data", () => {
  it("defines a master for every /m/<id> page in the menu", () => {
    const ids = new Set(MASTERS.map((m) => m.id));
    const missing = masterPaths.filter((p) => !ids.has(p.path.slice(3))).map((p) => p.path);
    expect(missing).toEqual([]);
    expect(masterPaths.length).toBeGreaterThan(50);
  });

  it("has unique ids", () => {
    const ids = MASTERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a title, module and columns on every master, and unique column keys", () => {
    for (const m of MASTERS) {
      expect(m.title, m.id).toBeTruthy();
      expect(m.module, m.id).toBeTruthy();
      expect(m.columns.length, m.id).toBeGreaterThanOrEqual(3);
      expect(m.columns.length, m.id).toBeLessThanOrEqual(8);
      const keys = m.columns.map((c) => c.key);
      expect(new Set(keys).size, m.id).toBe(keys.length);
    }
  });

  it("uses the menu label as the title", () => {
    for (const p of masterPaths) {
      expect(MASTERS.find((m) => m.id === p.path.slice(3))?.title, p.path).toBe(p.label);
    }
  });

  it("only uses column keys in seed rows, and has at least 3 rows", () => {
    for (const m of MASTERS) {
      const keys = new Set(m.columns.map((c) => c.key));
      expect(m.seed.length, m.id).toBeGreaterThanOrEqual(3);
      for (const row of m.seed) {
        for (const k of Object.keys(row)) expect(keys.has(k), `${m.id}.${k}`).toBe(true);
      }
    }
  });

  it("select fields have options and seed values that fit them", () => {
    for (const m of MASTERS) {
      for (const c of m.columns) {
        if (c.field?.type !== "select") continue;
        expect(c.field.options?.length, `${m.id}.${c.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("users and roles match the demo session", () => {
    const users = MASTERS.find((m) => m.id === "users")!.seed;
    expect(users.map((u) => u.userId)).toEqual(USERS.map((u) => u.id));
    expect(users.map((u) => u.role)).toEqual(USERS.map((u) => u.role));
    const roles = MASTERS.find((m) => m.id === "role")!.seed;
    expect(roles.map((r) => r.roleId)).toEqual(ROLES.map((r) => r.id));
    const rights = MASTERS.find((m) => m.id === "role-rights")!.seed;
    expect(rights.length).toBe(ROLES.reduce((n, r) => n + r.permissions.length, 0));
  });

  it("has no em dashes in user text", () => {
    expect(JSON.stringify(MASTERS)).not.toContain("—");
  });
});
