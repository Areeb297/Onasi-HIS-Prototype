import type { MasterDef, Row } from "../schema";
import { EMR_GROUPS, EMR_MENU } from "../emr-menu";
import { NAV } from "../nav";
import { ROLES, USERS, type Permission } from "../session";
import { badge, bool, date, mono, monoPick, num, pick, text } from "./helpers";

/** EMR setup, reporting, users and role permissions. Users and roles are built from src/lib/session.ts so they always match. */

const ROLE_IDS = ROLES.map((r) => r.id);
const roleLabel = (id: string) => ROLES.find((r) => r.id === id)?.label ?? id;
const rolesWith = (p: Permission) => ROLES.filter((r) => r.permissions.includes(p)).map((r) => r.id);

const PERMISSION_TEXT: Record<Permission, string> = {
  "patient.read": "Open patient records",
  "patient.register": "Register and update patients",
  "adt.send": "Send ADT messages",
  "emr.read": "Read the clinical chart",
  "emr.write": "Write in the clinical chart",
  "order.lab": "Order laboratory tests",
  "order.rad": "Order radiology exams",
  "rx.write": "Write prescriptions",
  "rx.dispense": "Dispense medication",
  "lab.result": "Enter laboratory results",
  "rad.report": "Write radiology reports",
  "docs.publish": "Publish clinical documents",
  "confidential.read": "Open confidential patients",
  "audit.read": "Read the audit trail",
  admin: "Manage setup, users and roles",
  "ai.use": "Use AI assistants",
  billing: "Use invoice and RCM pages",
};

// EMR pages
const FORM_ITEMS = EMR_MENU.filter((i) => i.kind === "form");
const DRAFT_FORMS = new Set(["rehab-substance-seizure", "ot-schedule"]);
const REVIEW_FORMS = new Set(["ovulation-induction-cycle", "newborn-ballard-score"]);
const formStatus = (id: string) => (DRAFT_FORMS.has(id) ? "Draft" : REVIEW_FORMS.has(id) ? "Review" : "Active");

function pageRoles(id: string, group: string): { read: string[]; write: string[] } {
  const read = new Set(rolesWith("emr.read"));
  let write = rolesWith("emr.write");
  if (id === "prescription") { write = rolesWith("rx.write"); }
  if (id === "laboratory") { write = rolesWith("order.lab"); read.add("lab"); }
  if (id === "radiology") { write = rolesWith("order.rad"); read.add("radiologist"); }
  if (id === "documents") write = rolesWith("docs.publish");
  if (id === "adt") write = rolesWith("adt.send");
  if (group === "Nursing") write = ["nurse", "admin"];
  if (group === "OT") write = ["physician", "admin"];
  return { read: [...new Set([...read, ...write])], write };
}
const labels = (ids: string[]) => ids.map(roleLabel).join(", ");

const emrPageRows: Row[] = EMR_MENU.map((i, n) => ({ pageId: i.id, label: i.label, group: i.group, kind: i.kind === "form" ? "Form" : "Native", sort: n + 1, active: true }));

// Role to module access
const visibleGroups = NAV.filter((g) => !g.devOnly);
const roleModuleRows: Row[] = ROLES.flatMap((r) =>
  visibleGroups
    .filter((g) => !g.perm || r.permissions.includes(g.perm))
    .map((g) => ({ role: r.id, moduleId: g.id, module: g.label, pages: g.pages.filter((p) => !p.perm || r.permissions.includes(p.perm)).length, total: g.pages.length }))
    .filter((x) => x.pages > 0 || x.total === 0)
    .map((x) => ({ ...x, access: x.pages === x.total ? "Full" : "Partial" })),
);

const username = (name: string) => {
  if (name === "System Administrator") return "sysadmin";
  const plain = name.replace(/^Dr\.\s*/, "").split(",")[0].trim().split(/\s+/);
  return (plain[0][0] + plain[plain.length - 1]).toLowerCase();
};
const LAST_LOGIN = ["2026-11-11", "2026-11-11", "2026-11-10", "2026-11-11", "2026-11-10", "2026-11-09", "2026-11-11", "2026-11-05", "2026-11-11"];

export const SYSTEM: MasterDef[] = [
  {
    id: "emr-form-builder",
    title: "EMR Form Builder",
    module: "EMR Setup",
    description: "Every form that can appear in the patient chart.",
    note: "The form list is read from the chart menu. Editing a row here does not change the form fields in the app.",
    columns: [
      mono("formId", "Form Id", true),
      text("title", "Form", true),
      pick("group", "Group", EMR_GROUPS, true),
      text("version", "Version"),
      badge("status", "Status", ["Active", "Draft", "Review", "Disabled"]),
    ],
    seed: FORM_ITEMS.map((i) => ({ formId: i.id, title: i.label, group: i.group, version: DRAFT_FORMS.has(i.id) ? "0.9" : "1.0", status: formStatus(i.id) })),
  },
  {
    id: "emr-module",
    title: "EMR Module",
    module: "EMR Setup",
    description: "The groups in the left menu of the patient chart.",
    columns: [
      mono("moduleId", "Module Id", true),
      pick("name", "Module", EMR_GROUPS, true),
      num("pages", "Pages"),
      num("forms", "Forms"),
      pick("setting", "Care Setting", ["OPD", "IPD", "OPD and IPD"]),
      bool("active", "Active"),
    ],
    seed: EMR_GROUPS.map((g) => ({
      moduleId: "emr-" + g.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, ""),
      name: g,
      pages: EMR_MENU.filter((i) => i.group === g).length,
      forms: EMR_MENU.filter((i) => i.group === g && i.kind === "form").length,
      setting: g === "Gynecology & Antenatal (OPD)" ? "OPD" : g === "Obstetrics & Labor (IPD)" || g === "Nursing" ? "IPD" : "OPD and IPD",
      active: true,
    })),
  },
  {
    id: "emr-page",
    title: "EMR Page",
    module: "EMR Setup",
    description: "Every page in the patient chart menu. Native pages have their own screen. Form pages use the form engine.",
    columns: [
      mono("pageId", "Page Id", true),
      text("label", "Page", true),
      pick("group", "Module", EMR_GROUPS, true),
      pick("kind", "Kind", ["Native", "Form"]),
      num("sort", "Menu Order"),
      bool("active", "Active"),
    ],
    seed: emrPageRows,
  },
  {
    id: "emr-page-permissions",
    title: "EMR Page Permissions",
    module: "EMR Setup",
    description: "Which roles can read and write each chart page.",
    columns: [
      mono("pageId", "Page Id", true),
      text("page", "Page", true),
      pick("group", "Module", EMR_GROUPS),
      text("readRoles", "Can Read", true),
      text("writeRoles", "Can Write"),
    ],
    seed: EMR_MENU.map((i) => {
      const p = pageRoles(i.id, i.group);
      return { pageId: i.id, page: i.label, group: i.group, readRoles: labels(p.read), writeRoles: labels(p.write) };
    }),
  },

  // Reporting
  {
    id: "report-designer",
    title: "Report Designer",
    module: "Reporting",
    description: "Report layouts and the data view each one reads.",
    note: "Scaffold with sample rows. There is no visual designer in the app.",
    columns: [
      mono("code", "Report Code", true),
      text("name", "Report", true),
      pick("layout", "Layout", ["Table", "Summary", "Chart", "Form letter"], true),
      mono("dataSource", "Data View"),
      text("version", "Version"),
      date("modified", "Last Changed"),
      badge("status", "Status", ["Active", "Draft", "Review"]),
    ],
    seed: [
      { code: "RPT-CEN-01", name: "Daily inpatient census", layout: "Table", dataSource: "vw_daily_census", version: "1.2", modified: "2026-10-12", status: "Active" },
      { code: "RPT-FIN-01", name: "Revenue by clinic", layout: "Chart", dataSource: "vw_revenue_clinic", version: "1.0", modified: "2026-09-03", status: "Active" },
      { code: "RPT-FIN-02", name: "Receivables ageing", layout: "Summary", dataSource: "vw_ar_ageing", version: "0.8", modified: "2026-11-02", status: "Draft" },
      { code: "RPT-LAB-01", name: "Lab turnaround time", layout: "Table", dataSource: "vw_lab_tat", version: "1.1", modified: "2026-08-21", status: "Active" },
      { code: "RPT-PHA-01", name: "Drug stock level", layout: "Table", dataSource: "vw_pharmacy_stock", version: "1.0", modified: "2026-07-15", status: "Review" },
    ],
  },
  {
    id: "report-groups",
    title: "Report Groups",
    module: "Reporting",
    description: "Top level groups in the report list.",
    columns: [
      mono("code", "Code", true),
      text("name", "Group", true),
      num("sort", "Sort Order"),
      bool("active", "Active"),
    ],
    seed: [
      { code: "RG-CLN", name: "Clinical", sort: 1, active: true },
      { code: "RG-OPS", name: "Operational", sort: 2, active: true },
      { code: "RG-FIN", name: "Financial", sort: 3, active: true },
      { code: "RG-LAB", name: "Laboratory", sort: 4, active: true },
      { code: "RG-PHA", name: "Pharmacy", sort: 5, active: true },
      { code: "RG-REG", name: "Regulatory", sort: 6, active: true },
    ],
  },
  {
    id: "report-subgroups",
    title: "Report Sub Groups",
    module: "Reporting",
    description: "Second level groups in the report list.",
    columns: [
      mono("code", "Code", true),
      text("name", "Sub Group", true),
      pick("group", "Group", ["Clinical", "Operational", "Financial", "Laboratory", "Pharmacy", "Regulatory"], true),
      num("sort", "Sort Order"),
      bool("active", "Active"),
    ],
    seed: [
      { code: "RSG-CEN", name: "Census and beds", group: "Operational", sort: 1, active: true },
      { code: "RSG-APT", name: "Appointments", group: "Operational", sort: 2, active: true },
      { code: "RSG-DX", name: "Diagnoses", group: "Clinical", sort: 1, active: true },
      { code: "RSG-REV", name: "Revenue", group: "Financial", sort: 1, active: true },
      { code: "RSG-ARG", name: "Receivables", group: "Financial", sort: 2, active: true },
      { code: "RSG-TAT", name: "Turnaround time", group: "Laboratory", sort: 1, active: true },
      { code: "RSG-STK", name: "Stock", group: "Pharmacy", sort: 1, active: true },
      { code: "RSG-NPH", name: "NPHIES submissions", group: "Regulatory", sort: 1, active: true },
    ],
  },
  {
    id: "reports",
    title: "Reports",
    module: "Reporting",
    description: "Reports users can run, with the group they sit in.",
    columns: [
      mono("code", "Report Code", true),
      text("name", "Report", true),
      pick("group", "Group", ["Clinical", "Operational", "Financial", "Laboratory", "Pharmacy", "Regulatory"], true),
      text("subGroup", "Sub Group"),
      pick("output", "Output", ["PDF", "Excel", "PDF and Excel"]),
      monoPick("permission", "Permission", ["patient.read", "billing", "audit.read", "lab.result", "rx.dispense", "admin"]),
      bool("active", "Active"),
    ],
    seed: [
      { code: "RPT-CEN-01", name: "Daily inpatient census", group: "Operational", subGroup: "Census and beds", output: "PDF and Excel", permission: "patient.read", active: true },
      { code: "RPT-APT-01", name: "Appointments by clinic", group: "Operational", subGroup: "Appointments", output: "Excel", permission: "patient.read", active: true },
      { code: "RPT-DX-01", name: "Top 20 diagnoses", group: "Clinical", subGroup: "Diagnoses", output: "PDF", permission: "patient.read", active: true },
      { code: "RPT-FIN-01", name: "Revenue by clinic", group: "Financial", subGroup: "Revenue", output: "PDF and Excel", permission: "billing", active: true },
      { code: "RPT-FIN-02", name: "Receivables ageing", group: "Financial", subGroup: "Receivables", output: "Excel", permission: "billing", active: true },
      { code: "RPT-LAB-01", name: "Lab turnaround time", group: "Laboratory", subGroup: "Turnaround time", output: "PDF", permission: "lab.result", active: true },
      { code: "RPT-PHA-01", name: "Drug stock level", group: "Pharmacy", subGroup: "Stock", output: "Excel", permission: "rx.dispense", active: true },
      { code: "RPT-NPH-01", name: "NPHIES messages sent", group: "Regulatory", subGroup: "NPHIES submissions", output: "PDF", permission: "audit.read", active: false },
    ],
  },

  // Users and roles
  {
    id: "users",
    title: "User",
    module: "Users",
    description: "Demo accounts. The same accounts appear in the user switcher.",
    columns: [
      mono("userId", "User Id", true),
      text("name", "Name", true),
      mono("username", "Username"),
      monoPick("role", "Role", ROLE_IDS, true),
      text("department", "Department"),
      date("lastLogin", "Last Login"),
      badge("status", "Status", ["Active", "Disabled"]),
    ],
    seed: USERS.map((u, i) => ({ userId: u.id, name: u.name, username: username(u.name), role: u.role, department: u.department, lastLogin: LAST_LOGIN[i % LAST_LOGIN.length], status: "Active" })),
  },
  {
    id: "role",
    title: "Role",
    module: "Role Permissions",
    description: "Roles and how many permissions each has.",
    columns: [
      mono("roleId", "Role Id", true),
      text("name", "Role", true),
      num("permissions", "Permissions"),
      num("users", "Users"),
      bool("active", "Active"),
    ],
    seed: ROLES.map((r) => ({ roleId: r.id, name: r.label, permissions: r.permissions.length, users: USERS.filter((u) => u.role === r.id).length, active: true })),
  },
  {
    id: "role-module",
    title: "Role Module",
    module: "Role Permissions",
    description: "Which menu groups each role can open.",
    columns: [
      monoPick("role", "Role", ROLE_IDS, true),
      mono("moduleId", "Module Id", true),
      text("module", "Module"),
      num("pages", "Pages Open"),
      num("total", "Pages In Module"),
      badge("access", "Access", ["Full", "Partial"], false),
    ],
    seed: roleModuleRows,
  },
  {
    id: "role-rights",
    title: "Role Rights",
    module: "Role Permissions",
    description: "The permissions granted to each role.",
    columns: [
      monoPick("role", "Role", ROLE_IDS, true),
      text("roleName", "Role Name"),
      monoPick("permission", "Permission", Object.keys(PERMISSION_TEXT), true),
      text("meaning", "What It Allows"),
      bool("granted", "Granted"),
    ],
    seed: ROLES.flatMap((r) => r.permissions.map((p) => ({ role: r.id, roleName: r.label, permission: p, meaning: PERMISSION_TEXT[p], granted: true }))),
  },
];
