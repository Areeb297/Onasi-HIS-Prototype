import type { MasterDef, Row } from "../schema";
import { EMR_GROUPS, EMR_MENU } from "../emr-menu";
import { NAV } from "../nav";
import { ROLES, USERS, type Permission } from "../session";
import { badge, bool, date, mono, monoPick, more, num, pick, text } from "./helpers";

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

/** Arabic names for a few chart pages. Others show no Arabic name. */
const EMR_PAGE_ARABIC: Record<string, string> = {
  overview: "نظرة عامة", complaints: "الشكوى الرئيسية", vitals: "العلامات الحيوية", allergies: "الحساسية", diagnosis: "التشخيص", prescription: "الوصفة الطبية",
  laboratory: "المختبر", radiology: "الأشعة", documents: "المستندات", adt: "رسائل الدخول والخروج والنقل",
};
const emrPageRows: Row[] = EMR_MENU.map((i, n) => ({
  pageId: i.id, label: i.label, caption: i.label, url: `/chart/${i.id}`, group: i.group, kind: i.kind === "form" ? "Form" : "Native", sort: n + 1, active: true,
  ...(EMR_PAGE_ARABIC[i.id] ? { nameArabic: EMR_PAGE_ARABIC[i.id] } : {}),
  ...(i.kind === "form" ? { formTemplate: i.label } : {}),
  icon: `icon-${i.id}`,
}));

// Role to module access
const visibleGroups = NAV.filter((g) => !g.devOnly);
const roleModuleRows: Row[] = ROLES.flatMap((r) =>
  visibleGroups
    .filter((g) => !g.perm || r.permissions.includes(g.perm))
    .map((g) => ({ role: r.id, moduleId: g.id, module: g.label, pages: g.pages.filter((p) => !p.perm || r.permissions.includes(p.perm)).length, total: g.pages.length }))
    .filter((x) => x.pages > 0 || x.total === 0)
    .map((x) => ({ ...x, access: x.pages === x.total ? "Full" : "Partial", active: true })),
);

const username = (name: string) => {
  if (name === "System Administrator") return "sysadmin";
  const plain = name.replace(/^Dr\.\s*/, "").split(",")[0].trim().split(/\s+/);
  return (plain[0][0] + plain[plain.length - 1]).toLowerCase();
};
const EMR_GROUP_ARABIC: Record<string, string> = {
  General: "عام", Rehab: "التأهيل", "Gynecology & Antenatal (OPD)": "أمراض النساء ومتابعة الحمل (العيادات)",
  "Obstetrics & Labor (IPD)": "التوليد والولادة (التنويم)", OT: "غرفة العمليات", Nursing: "التمريض",
};
const CLINIC_NAMES = ["Family Medicine Clinic", "Internal Medicine Clinic", "Pediatrics Clinic", "Orthopedics Clinic", "Emergency Triage", "Rehabilitation Clinic"];
const REPORT_GROUPS = ["Clinical", "Operational", "Financial", "Laboratory", "Pharmacy", "Regulatory"];
const REPORT_SUB_GROUPS = ["Census and beds", "Appointments", "Diagnoses", "Revenue", "Receivables", "Turnaround time", "Stock", "NPHIES submissions"];
const SPECIALTY_OPTIONS = ["Family Medicine", "Internal Medicine", "Pediatrics", "Orthopedics", "Radiology", "Emergency Medicine", "Nursing", "Clinical Pharmacy", "Laboratory Medicine", "Health Informatics", "Administration"];
/** Made-up personal details for the demo accounts. Identity and license numbers are not real. */
const USER_DETAILS: Record<string, Row> = {
  U1: { gender: "Male", middleName: "Saad", identificationType: "National ID", identificationValue: "1023456781", phoneNumber: "+966 55 555 0201", medicalLicenseNo: "SCFHS-10-112233", specialty: "Internal Medicine", subSpecialty: "General Internal Medicine", subDepartment: "Medical Ward", odooEmployeeReference: "EMP-0101", odooUserReference: "USR-0101", profilePhoto: "khalid-alharbi.jpg", signature: "khalid-alharbi-signature.png" },
  U2: { gender: "Female", middleName: "Fahad", identificationType: "National ID", identificationValue: "1034567892", phoneNumber: "+966 55 555 0202", medicalLicenseNo: "SCFHS-20-223344", specialty: "Nursing", subDepartment: "Ward 3A", odooEmployeeReference: "EMP-0102", signature: "huda-alotaibi-signature.png" },
  U3: { gender: "Male", middleName: "Nasser", identificationType: "National ID", identificationValue: "1045678903", phoneNumber: "+966 55 555 0203", specialty: "Administration", subDepartment: "Outpatient Registration", useLang: "Arabic" },
  U4: { gender: "Female", middleName: "Ali", identificationType: "National ID", identificationValue: "1056789014", phoneNumber: "+966 55 555 0204", medicalLicenseNo: "SCFHS-30-334455", specialty: "Clinical Pharmacy", subDepartment: "Outpatient Pharmacy", odooEmployeeReference: "EMP-0104", signature: "noura-alzahrani-signature.png" },
  U5: { gender: "Male", middleName: "Mohammed", identificationType: "National ID", identificationValue: "1067890125", phoneNumber: "+966 55 555 0205", medicalLicenseNo: "SCFHS-40-445566", specialty: "Laboratory Medicine", subSpecialty: "Hematology", subDepartment: "Hematology" },
  U6: { gender: "Female", middleName: "Abdulaziz", identificationType: "National ID", identificationValue: "1078901236", phoneNumber: "+966 55 555 0206", medicalLicenseNo: "SCFHS-10-556677", specialty: "Radiology", subSpecialty: "Cross-Sectional Imaging", subDepartment: "CT and MRI", odooEmployeeReference: "EMP-0106", odooUserReference: "USR-0106", signature: "layla-alanazi-signature.png" },
  U7: { gender: "Male", identificationType: "National ID", identificationValue: "1089012347", phoneNumber: "+966 55 555 0207", specialty: "Administration", subDepartment: "Claims", odooEmployeeReference: "EMP-0107", odooUserReference: "USR-0107" },
  U8: { gender: "Female", identificationType: "National ID", identificationValue: "1090123458", phoneNumber: "+966 55 555 0208", specialty: "Administration", subDepartment: "Internal Audit" },
  U9: { gender: "Male", phoneNumber: "+966 55 555 0209", specialty: "Health Informatics", subDepartment: "Applications", odooApiIntegrationKey: "<ODOO-API-KEY>" },
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
      text("description", "Description", true),
      pick("group", "Group", EMR_GROUPS, true),
      text("version", "Version"),
      badge("status", "Status", ["Active", "Draft", "Review", "Disabled"]),
    ],
    seed: FORM_ITEMS.map((i) => ({ formId: i.id, title: i.label, description: `${i.label} form in the ${i.group} group`, group: i.group, version: DRAFT_FORMS.has(i.id) ? "0.9" : "1.0", status: formStatus(i.id) })),
  },
  {
    id: "emr-module",
    title: "EMR Module",
    module: "EMR Setup",
    description: "The groups in the left menu of the patient chart.",
    columns: [
      mono("moduleId", "Module Id", true),
      pick("name", "Module", EMR_GROUPS, true),
      text("nameArabic", "Arabic Name"),
      num("order", "Menu Order"),
      num("pages", "Pages"),
      num("forms", "Forms"),
      pick("setting", "Care Setting", ["OPD", "IPD", "OPD and IPD"]),
      bool("active", "Active"),
      ...more(
        text("caption", "Caption", true),
        text("icon", "Icon"),
      ),
    ],
    seed: EMR_GROUPS.map((g, n) => ({
      moduleId: "emr-" + g.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, ""),
      name: g,
      caption: g,
      icon: "icon-emr-" + g.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, ""),
      nameArabic: EMR_GROUP_ARABIC[g] ?? "",
      order: n + 1,
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
      text("caption", "Caption"),
      mono("url", "URL"),
      pick("group", "Module", EMR_GROUPS, true),
      pick("kind", "Kind", ["Native", "Form"]),
      num("sort", "Menu Order"),
      bool("active", "Active"),
      ...more(
        text("nameArabic", "Arabic Name"),
        pick("formTemplate", "EMR Form Template", FORM_ITEMS.map((i) => i.label)),
        text("icon", "Icon"),
      ),
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
      text("addRoles", "Can Add"),
      text("writeRoles", "Can Write"),
      text("deleteRoles", "Can Delete"),
      ...more(
        pick("clinic", "Filter by Clinic", ["All clinics", ...CLINIC_NAMES]),
        text("user", "Select User"),
      ),
    ],
    seed: EMR_MENU.map((i) => {
      const p = pageRoles(i.id, i.group);
      return { pageId: i.id, page: i.label, group: i.group, readRoles: labels(p.read), addRoles: labels(p.write), writeRoles: labels(p.write), deleteRoles: labels(p.write.filter((r) => r === "physician" || r === "admin")), clinic: "All clinics", user: "All users in role" };
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
      pick("group", "Report Group", REPORT_GROUPS),
      pick("layout", "Layout", ["Table", "Summary", "Chart", "Form letter"], true),
      mono("dataSource", "Data View"),
      text("version", "Version"),
      date("modified", "Last Changed"),
      badge("status", "Status", ["Active", "Draft", "Review"]),
      ...more(
        pick("subGroup", "Report Sub Group", REPORT_SUB_GROUPS),
        text("description", "Description"),
        text("decryptColumns", "Columns To Decrypt"),
        text("queryText", "SQL Query", false, "SELECT / FROM / WHERE 1 = 1"),
        text("filterName", "Filter Display Name"),
        mono("filterParameter", "Filter Parameter Name"),
        pick("filterType", "Filter Type", ["Text", "Number", "Date", "Date Range", "Dropdown", "Multi Select", "Boolean"]),
        bool("filterRequired", "Filter Required"),
      ),
    ],
    seed: [
      { code: "RPT-CEN-01", name: "Daily inpatient census", group: "Operational", layout: "Table", dataSource: "vw_daily_census", version: "1.2", modified: "2026-10-12", status: "Active", subGroup: "Census and beds", description: "Inpatients in each ward at midnight", decryptColumns: "PatientName", queryText: "SELECT Ward, Bed, MRN, PatientName FROM vw_daily_census WHERE CensusDate = @CensusDate", filterName: "Census Date", filterParameter: "@CensusDate", filterType: "Date", filterRequired: true },
      { code: "RPT-FIN-01", name: "Revenue by clinic", group: "Financial", layout: "Chart", dataSource: "vw_revenue_clinic", version: "1.0", modified: "2026-09-03", status: "Active", subGroup: "Revenue", description: "Net revenue in SAR by clinic and month", queryText: "SELECT Clinic, Month, NetAmount FROM vw_revenue_clinic WHERE InvoiceDate BETWEEN @From AND @To", filterName: "Invoice Date", filterParameter: "@From, @To", filterType: "Date Range", filterRequired: true },
      { code: "RPT-FIN-02", name: "Receivables ageing", group: "Financial", layout: "Summary", dataSource: "vw_ar_ageing", version: "0.8", modified: "2026-11-02", status: "Draft", subGroup: "Receivables", description: "Unpaid invoices by payer and age band", filterName: "Payer", filterParameter: "@PayerId", filterType: "Dropdown", filterRequired: false },
      { code: "RPT-LAB-01", name: "Lab turnaround time", group: "Laboratory", layout: "Table", dataSource: "vw_lab_tat", version: "1.1", modified: "2026-08-21", status: "Active" },
      { code: "RPT-PHA-01", name: "Drug stock level", group: "Pharmacy", layout: "Table", dataSource: "vw_pharmacy_stock", version: "1.0", modified: "2026-07-15", status: "Review" },
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
      text("description", "Description"),
      num("subGroups", "Sub Groups"),
      num("reports", "Reports"),
      num("sort", "Sort Order"),
      bool("active", "Active"),
    ],
    seed: [
      { code: "RG-CLN", name: "Clinical", description: "Diagnoses and clinical activity", subGroups: 1, reports: 1, sort: 1, active: true },
      { code: "RG-OPS", name: "Operational", description: "Census, beds and appointments", subGroups: 2, reports: 2, sort: 2, active: true },
      { code: "RG-FIN", name: "Financial", description: "Revenue and receivables", subGroups: 2, reports: 2, sort: 3, active: true },
      { code: "RG-LAB", name: "Laboratory", description: "Laboratory workload and timing", subGroups: 1, reports: 1, sort: 4, active: true },
      { code: "RG-PHA", name: "Pharmacy", description: "Drug stock and dispensing", subGroups: 1, reports: 1, sort: 5, active: true },
      { code: "RG-REG", name: "Regulatory", description: "Submissions to national platforms", subGroups: 1, reports: 1, sort: 6, active: true },
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
      text("description", "Description"),
      num("reports", "Reports"),
      num("sort", "Sort Order"),
      bool("active", "Active"),
    ],
    seed: [
      { code: "RSG-CEN", name: "Census and beds", group: "Operational", description: "Inpatient census and bed use", reports: 1, sort: 1, active: true },
      { code: "RSG-APT", name: "Appointments", group: "Operational", description: "Booked, attended and missed appointments", reports: 1, sort: 2, active: true },
      { code: "RSG-DX", name: "Diagnoses", group: "Clinical", description: "Most common diagnoses", reports: 1, sort: 1, active: true },
      { code: "RSG-REV", name: "Revenue", group: "Financial", description: "Revenue by clinic and payer", reports: 1, sort: 1, active: true },
      { code: "RSG-ARG", name: "Receivables", group: "Financial", description: "Unpaid invoices by age", reports: 1, sort: 2, active: true },
      { code: "RSG-TAT", name: "Turnaround time", group: "Laboratory", description: "Time from order to result", reports: 1, sort: 1, active: true },
      { code: "RSG-STK", name: "Stock", group: "Pharmacy", description: "Stock on hand and expiry", reports: 1, sort: 1, active: true },
      { code: "RSG-NPH", name: "NPHIES submissions", group: "Regulatory", description: "Messages sent to NPHIES", reports: 1, sort: 1, active: true },
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
      text("email", "Email", true),
      monoPick("role", "Role", ROLE_IDS, true),
      text("department", "Department"),
      date("lastLogin", "Last Login"),
      badge("status", "Status", ["Active", "Disabled"]),
      ...more(
        pick("title", "Title", ["Dr.", "Mr.", "Mrs.", "Ms.", "Prof."], true),
        text("firstName", "First Name", true),
        text("middleName", "Middle Name"),
        text("lastName", "Last Name", true),
        pick("gender", "Gender", ["Male", "Female"], true),
        pick("identificationType", "Identity Type", ["National ID", "Iqama", "Passport", "Border Number"]),
        mono("identificationValue", "Identity Number"),
        text("profilePhoto", "Profile Photo", false, "photo.jpg"),
        mono("phoneNumber", "Phone #", false, "+966 5X XXX XXXX"),
        text("address", "Address", true),
        pick("country", "Country", ["Saudi Arabia", "United Arab Emirates", "Kuwait", "Bahrain", "Egypt", "Jordan", "Pakistan", "Philippines"]),
        pick("state", "State", ["Riyadh Region", "Makkah Region", "Eastern Province", "Madinah Region", "Asir Region", "Qassim Region"]),
        pick("city", "City", ["Riyadh", "Al Kharj", "Jeddah", "Makkah", "Dammam", "Al Khobar", "Madinah", "Abha"]),
        text("password", "Password", false, "Leave blank to keep the current password"),
        pick("useLang", "Language", ["English", "Arabic"]),
        mono("medicalLicenseNo", "Medical License No"),
        pick("specialty", "Specialty", SPECIALTY_OPTIONS),
        text("subSpecialty", "Sub-Specialty"),
        text("subDepartment", "Sub-Department"),
        mono("odooEmployeeReference", "Odoo Employee Ref"),
        mono("odooUserReference", "Odoo User Ref"),
        mono("odooApiIntegrationKey", "Odoo API Key", false, "<ODOO-API-KEY>"),
        text("signature", "Digital Signature", false, "signature.png"),
        text("roles", "Roles"),
        bool("isSuperUser", "Super User"),
        bool("active", "Active"),
      ),
    ],
    seed: USERS.map((u, i) => {
      const plain = u.name.replace(/^Dr\.\s*/, "").split(",")[0].trim().split(/\s+/);
      const extra = USER_DETAILS[u.id] ?? {};
      return {
        userId: u.id, name: u.name, username: username(u.name), email: `${username(u.name)}@alnoor-hospital.example`, role: u.role, department: u.department, lastLogin: LAST_LOGIN[i % LAST_LOGIN.length], status: "Active",
        title: u.name.startsWith("Dr.") ? "Dr." : extra.gender === "Female" ? "Ms." : "Mr.",
        firstName: plain[0], lastName: plain[plain.length - 1],
        address: "King Fahd Road, Al Olaya, Riyadh", country: "Saudi Arabia", state: "Riyadh Region", city: "Riyadh", useLang: "English",
        roles: roleLabel(u.role), isSuperUser: u.role === "admin", active: true,
        ...extra,
      };
    }),
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
      num("modules", "Modules"),
      num("pages", "Pages"),
      num("users", "Users"),
      bool("active", "Active"),
    ],
    seed: ROLES.map((r) => ({ roleId: r.id, name: r.label, permissions: r.permissions.length, modules: roleModuleRows.filter((x) => x.role === r.id).length, pages: roleModuleRows.filter((x) => x.role === r.id).reduce((sum, x) => sum + Number(x.pages), 0), users: USERS.filter((u) => u.role === r.id).length, active: true })),
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
      bool("active", "Active"),
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
  {
    id: "superuser",
    title: "Super User",
    module: "Users",
    description: "Accounts that can manage every client and clinic.",
    note: "Sample accounts. They cannot sign in.",
    columns: [
      text("firstName", "First Name", true),
      text("lastName", "Last Name", true),
      text("email", "Email", true),
      mono("phoneNumber", "Phone Number"),
      pick("gender", "Gender", ["Male", "Female"], true),
      pick("department", "Department", ["IT", "Medical Administration", "Nursing Administration", "Finance", "Quality"], true),
      pick("specialty", "Specialty", ["Health Informatics", "Family Medicine", "Internal Medicine", "Nursing", "Administration"], true),
      bool("active", "Active"),
      ...more(
        text("password", "Password", false, "Leave blank to keep the current password"),
        pick("country", "Country", ["Saudi Arabia", "United Arab Emirates", "Kuwait", "Bahrain", "Egypt", "Jordan"], true),
      ),
    ],
    seed: [
      { firstName: "Abdullah", lastName: "Alsaleh", email: "abdullah.alsaleh@alnoor-hospital.example", phoneNumber: "+966 55 555 0101", gender: "Male", department: "IT", specialty: "Health Informatics", active: true },
      { firstName: "Sara", lastName: "Almutairi", email: "sara.almutairi@alnoor-hospital.example", phoneNumber: "+966 55 555 0102", gender: "Female", department: "Medical Administration", specialty: "Internal Medicine", active: true },
      { firstName: "Turki", lastName: "Alshammari", email: "turki.alshammari@alnoor-hospital.example", phoneNumber: "+966 55 555 0103", gender: "Male", department: "Finance", specialty: "Administration", active: true },
      { firstName: "Amal", lastName: "Alharthi", email: "amal.alharthi@alnoor-hospital.example", phoneNumber: "+966 55 555 0104", gender: "Female", department: "Nursing Administration", specialty: "Nursing", active: true },
      { firstName: "Saad", lastName: "Alotaibi", email: "saad.alotaibi@alnoor-hospital.example", phoneNumber: "+966 55 555 0105", gender: "Male", department: "Quality", specialty: "Health Informatics", active: false },
    ].map((r) => ({ ...r, country: "Saudi Arabia" })),
  },

  // Patient communication
  {
    id: "whatsapp-templates",
    title: "WhatsApp Templates",
    module: "Patient Communication",
    description: "Message templates sent to patients by WhatsApp.",
    note: "Sample rows. No message is sent from this page. Words in double braces are filled in when a message is sent.",
    columns: [
      mono("templateCode", "Template Code", true),
      text("templateName", "Template Name", true),
      pick("category", "Category", ["Appointment", "Lab Results", "Prescription", "General", "Marketing", "Utility", "Authentication"], true),
      pick("templateType", "Template Type", ["Simple Text Template", "Official WhatsApp Template"], true),
      pick("languageCode", "Language", ["English", "Arabic"]),
      text("content", "Message Content", true),
      badge("status", "Status", ["Approved", "Pending", "Rejected", "Draft"], false),
      bool("isEnabled", "Enabled"),
      ...more(
        text("description", "Description"),
        mono("whatsAppTemplateName", "WhatsApp Template Name", false, "lowercase_with_underscores"),
        mono("whatsAppTemplateId", "Meta Template ID"),
        num("displayOrder", "Display Order"),
        pick("headerType", "Header Type", ["None", "Text", "Image", "Video", "Document"]),
        text("headerText", "Header Text"),
        text("exampleValues", "Example Values (JSON)"),
        text("footerText", "Footer Text"),
        pick("buttonType", "Button Type", ["Quick Reply", "URL", "Phone Number"]),
        text("buttonText", "Button Text"),
        mono("buttonUrl", "Website URL"),
        mono("buttonPhone", "Phone Number"),
      ),
    ],
    seed: [
      { templateCode: "APPT_CONFIRM", templateName: "Appointment Confirmation", category: "Appointment", templateType: "Official WhatsApp Template", languageCode: "English", content: "Dear {{PatientName}}, your appointment with {{DoctorName}} is confirmed for {{AppointmentDate}} at {{AppointmentTime}}.", status: "Approved", isEnabled: true, description: "Sent when an appointment is booked", whatsAppTemplateName: "appt_confirm_en", whatsAppTemplateId: "<META-TEMPLATE-ID>", displayOrder: 1, headerType: "Text", headerText: "Appointment Confirmed", exampleValues: "{\"PatientName\": \"Mohammed\", \"DoctorName\": \"Dr. Khalid Alharbi\", \"AppointmentDate\": \"2026-11-20\", \"AppointmentTime\": \"10:30\"}", footerText: "Al Noor Specialty Hospital", buttonType: "Phone Number", buttonText: "Call The Clinic", buttonPhone: "+966 11 555 0110" },
      { templateCode: "APPT_CONFIRM_AR", templateName: "Appointment Confirmation (Arabic)", category: "Appointment", templateType: "Official WhatsApp Template", languageCode: "Arabic", content: "عزيزي {{PatientName}}، تم تأكيد موعدك مع {{DoctorName}} بتاريخ {{AppointmentDate}} الساعة {{AppointmentTime}}.", status: "Approved", isEnabled: true },
      { templateCode: "APPT_REMINDER", templateName: "Appointment Reminder", category: "Appointment", templateType: "Official WhatsApp Template", languageCode: "English", content: "Reminder: you have an appointment at {{ClinicName}} tomorrow at {{AppointmentTime}}.", status: "Approved", isEnabled: true, description: "Sent the day before the appointment", whatsAppTemplateName: "appt_reminder_en", whatsAppTemplateId: "<META-TEMPLATE-ID>", displayOrder: 3, headerType: "None", footerText: "Reply STOP to opt out", buttonType: "Quick Reply", buttonText: "I Will Attend" },
      { templateCode: "LAB_READY", templateName: "Lab Results Ready", category: "Lab Results", templateType: "Official WhatsApp Template", languageCode: "English", content: "Dear {{PatientName}}, your lab results are ready. Please visit {{ClinicName}} or open the patient portal.", status: "Pending", isEnabled: false },
      { templateCode: "RX_READY", templateName: "Prescription Ready", category: "Prescription", templateType: "Simple Text Template", languageCode: "English", content: "Dear {{PatientName}}, your medication is ready for collection at the pharmacy.", status: "Draft", isEnabled: true },
      { templateCode: "OTP_LOGIN", templateName: "Login Code", category: "Authentication", templateType: "Official WhatsApp Template", languageCode: "English", content: "Your verification code is {{Code}}. It expires in 5 minutes.", status: "Approved", isEnabled: true },
      { templateCode: "RAMADAN_HOURS", templateName: "Ramadan Working Hours", category: "Marketing", templateType: "Official WhatsApp Template", languageCode: "Arabic", content: "تعلن {{ClinicName}} عن مواعيد العمل خلال شهر رمضان المبارك.", status: "Rejected", isEnabled: false },
    ],
  },
  {
    id: "patient-education-materials",
    title: "Patient Education Materials",
    module: "Patient Communication",
    description: "Leaflets and guides that staff can share with patients.",
    note: "Sample rows. The article text and attached files are not stored here.",
    columns: [
      text("title", "Title", true),
      pick("group", "Category Group", ["Clinical", "Surgical", "Rehabilitation", "Maternity", "Medication"], true),
      text("subGroup", "Category Sub-Group", true),
      pick("educationType", "Education Type", ["Treatment Guide", "Disease Overview", "Post-Operative Care", "Medication Instructions", "Lifestyle & Nutrition", "Rehabilitation & Physiotherapy", "Pre-Procedure Checklist"]),
      text("summary", "Brief Summary"),
      text("keywords", "Search Keywords"),
      num("attachments", "Attachments"),
      text("createdBy", "Created By"),
      ...more(
        text("articleContent", "Article Content (Optional)"),
        text("attachedDocuments", "Attached Documents", false, "File names, separated by commas"),
        text("documentDescription", "Document Description"),
      ),
    ],
    seed: [
      { title: "Living With Type 2 Diabetes", group: "Clinical", subGroup: "Diabetes", educationType: "Disease Overview", summary: "What diabetes is and how to keep blood sugar in range", keywords: "diabetes, blood sugar, HbA1c", attachments: 2, createdBy: "Dr. Tariq Aldossary", articleContent: "Type 2 diabetes means your body does not use insulin well. Healthy food, daily walking and your medicines keep your blood sugar in range.", attachedDocuments: "Diabetes-Guide.pdf, Blood-Sugar-Log.xlsx", documentDescription: "Printable guide and a log sheet for home readings" },
      { title: "Healthy Eating During Ramadan With Diabetes", group: "Clinical", subGroup: "Diabetes", educationType: "Lifestyle & Nutrition", summary: "Safe fasting, meal timing and when to break the fast", keywords: "Ramadan, fasting, diabetes, diet", attachments: 1, createdBy: "Dr. Tariq Aldossary" },
      { title: "Care After Knee Replacement", group: "Surgical", subGroup: "Orthopedics", educationType: "Post-Operative Care", summary: "Wound care, pain control and warning signs after surgery", keywords: "knee, replacement, wound, surgery", attachments: 3, createdBy: "Dr. Yasser Almalki", articleContent: "Keep the wound clean and dry, take pain medicine on time and walk with your frame as shown by the physiotherapist.", attachedDocuments: "Knee-Care.pdf, Exercise-Sheet.pdf, Wound-Care.mp4", documentDescription: "Home care guide, exercise sheet and a short wound care video" },
      { title: "Anti-Gravity Treadmill Therapy Guide", group: "Rehabilitation", subGroup: "Physiotherapy", educationType: "Rehabilitation & Physiotherapy", summary: "What to expect in a session and who it helps", keywords: "treadmill, gait, physiotherapy", attachments: 1, createdBy: "Dr. Huda Alfaifi" },
      { title: "How To Use Your Inhaler", group: "Medication", subGroup: "Respiratory", educationType: "Medication Instructions", summary: "Step by step inhaler technique for adults and children", keywords: "asthma, inhaler, spacer", attachments: 2, createdBy: "Noura Alzahrani, PharmD" },
      { title: "Preparing For Your MRI Scan", group: "Clinical", subGroup: "Radiology", educationType: "Pre-Procedure Checklist", summary: "What to wear, what to remove and how long the scan takes", keywords: "MRI, scan, preparation", attachments: 1, createdBy: "Dr. Layla Alanazi" },
    ],
  },
  {
    id: "synced-patients",
    title: "Synced Patients",
    module: "Patient",
    description: "Patients copied from the old Oracle hospital system, with when each one was synced.",
    note: "Sample rows. Nothing is read from an Oracle database and no eligibility request is sent.",
    readOnly: true,
    columns: [
      mono("mrn", "MRN"),
      text("patient", "Patient"),
      mono("externalPatientId", "Oracle ID"),
      date("migrationDate", "Synced On"),
      text("coverage", "Coverage Details"),
      badge("eligibility", "Eligibility", ["Eligible", "Not Eligible", "Not Checked"], false),
    ],
    seed: [
      { mrn: "MRN-204511", patient: "Mohammed Alqahtani", externalPatientId: "ORA-0091245", migrationDate: "2026-10-28", coverage: "Insured Standard, Class B", eligibility: "Eligible" },
      { mrn: "MRN-204512", patient: "Fatimah Alharbi", externalPatientId: "ORA-0091302", migrationDate: "2026-10-28", coverage: "Insured VIP, Class A", eligibility: "Eligible" },
      { mrn: "MRN-204513", patient: "Abdulrahman Alshehri", externalPatientId: "ORA-0091377", migrationDate: "2026-10-29", coverage: "Cash", eligibility: "Not Checked" },
      { mrn: "MRN-204514", patient: "Nouf Aldossari", externalPatientId: "ORA-0091420", migrationDate: "2026-10-29", coverage: "Insured Standard, Class C", eligibility: "Not Eligible" },
      { mrn: "MRN-204515", patient: "Sultan Alanazi", externalPatientId: "ORA-0091466", migrationDate: "2026-11-02", coverage: "Insured Standard, Class B", eligibility: "Eligible" },
      { mrn: "MRN-204516", patient: "Maha Alzahrani", externalPatientId: "ORA-0091513", migrationDate: "2026-11-02", coverage: "Cash", eligibility: "Not Checked" },
    ],
  },
];
