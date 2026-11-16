import {
  IconActivity, IconBed, IconBuildingHospital, IconCalendar, IconCash, IconClipboardHeart, IconDeviceDesktopAnalytics,
  IconFlask, IconHeartbeat, IconId, IconLock, IconPill, IconPlayerPlay, IconReportMedical, IconRoute, IconSettings, IconShieldCheck,
  IconStethoscope, IconUsers, IconUserShield, IconXboxX, IconBuildingBank, IconFileInvoice, IconHeartRateMonitor, IconTool,
  IconCloudUpload, IconRadioactive, IconScissors, IconNotebook, IconTable, IconListDetails, IconSchool, IconRobot, IconFolders,
} from "@tabler/icons-react";
import type { ComponentType } from "react";
import type { Permission } from "./session";

type Icon = ComponentType<{ className?: string; stroke?: number }>;

export interface NavPage {
  id: string;
  label: string;
  path: string;
  perm?: Permission;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: Icon;
  pages: NavPage[];
  /** Hidden unless the user has this permission. */
  perm?: Permission;
  /** Only in Developer View. */
  devOnly?: boolean;
}

const m = (id: string, label: string, perm?: Permission): NavPage => ({ id, label, path: `/m/${id}`, perm });

/**
 * The menu of the Onasi HIS. Pages that are generic setup tables point to /m/<id>.
 * Workflow pages have their own route.
 */
export const NAV: NavGroup[] = [
  {
    id: "dashboard", label: "Dashboard", icon: IconDeviceDesktopAnalytics,
    pages: [
      { id: "dashboard", label: "Dashboard", path: "/dashboard", perm: "patient.read" },
      { id: "my-patients", label: "My Patients", path: "/my-patients", perm: "emr.read" },
    ],
  },
  {
    id: "patient", label: "Patient", icon: IconUsers,
    pages: [
      { id: "patients", label: "Patient", path: "/patients", perm: "patient.read" },
      { id: "confidential", label: "Confidential Patient", path: "/confidential", perm: "patient.read" },
      m("synced-patients", "Synced Patients", "admin"),
      { id: "registration", label: "Patient Registration", path: "/registration", perm: "patient.register" },
    ],
  },
  {
    id: "appointments", label: "Appointments", icon: IconCalendar,
    pages: [{ id: "appointments", label: "Appointments", path: "/appointments", perm: "patient.read" }],
  },
  {
    id: "opd", label: "OPD", icon: IconStethoscope,
    pages: [
      { id: "opd", label: "OPD Worklist", path: "/opd", perm: "patient.read" },
      { id: "reclassified", label: "Reclassified To Outpatient", path: "/reclassified", perm: "patient.read" },
    ],
  },
  {
    id: "ipd", label: "IPD", icon: IconBuildingHospital,
    pages: [
      { id: "admission-requests", label: "Admission Requests", path: "/admission-requests", perm: "patient.read" },
      { id: "beds", label: "Beds", path: "/beds", perm: "patient.read" },
      { id: "ward-view", label: "Ward View", path: "/ward-view", perm: "patient.read" },
      { id: "ipd", label: "IPD Worklist", path: "/ipd", perm: "patient.read" },
    ],
  },
  {
    id: "er", label: "Emergency", icon: IconHeartbeat,
    pages: [{ id: "er", label: "Emergency Worklist", path: "/er", perm: "patient.read" }],
  },
  {
    id: "lab", label: "Laboratory", icon: IconFlask,
    pages: [{ id: "lab", label: "Worklist", path: "/lab", perm: "lab.result" }],
  },
  {
    id: "rad", label: "Radiology", icon: IconRadioactive,
    pages: [{ id: "rad", label: "Worklist", path: "/radiology", perm: "rad.report" }],
  },
  {
    id: "theatre", label: "Theatre", icon: IconScissors,
    pages: [{ id: "theatre", label: "Theatre List", path: "/theatre", perm: "emr.read" }],
  },
  {
    id: "pharmacy", label: "Pharmacy", icon: IconPill,
    pages: [
      { id: "pharmacy-home", label: "Pharmacy", path: "/pharmacy", perm: "rx.dispense" },
      { id: "pharmacy-stock", label: "Stock", path: "/pharmacy/stock", perm: "rx.dispense" },
      m("pharmacy", "Drug Master", "admin"),
      m("pharmacy-catalog-items", "Catalog Items", "admin"), m("pharmacy-generics", "Generic Medications", "admin"), m("pharmacy-brands", "Brand Medications", "admin"),
      m("pharmacy-suppliers", "Suppliers", "admin"), m("pharmacy-locations", "Stock Locations", "admin"),
      { id: "dispense", label: "Dispense Worklist", path: "/pharmacy/dispense", perm: "rx.dispense" },
    ],
  },
  {
    id: "onasi-ai", label: "Onasi AI", icon: IconRobot, perm: "ai.use",
    pages: [{ id: "agents", label: "Agents", path: "/agents", perm: "ai.use" }],
  },
  {
    id: "invoice", label: "Invoice", icon: IconFileInvoice, perm: "billing",
    pages: [{ id: "invoices", label: "Invoice Worklist", path: "/invoices", perm: "billing" }, m("contractual-discounts", "Contractual Discounts", "billing")],
  },
  {
    id: "rcm", label: "RCM", icon: IconCash, perm: "billing",
    pages: [
      m("daman-dashboard", "Daman Dashboard", "billing"),
      { id: "billing", label: "Billing Worklist", path: "/billing", perm: "billing" },
      { id: "transactions", label: "Submitted Transactions", path: "/transactions", perm: "billing" },
      { id: "rule-engine", label: "Rule Engine", path: "/rule-engine", perm: "billing" },
      { id: "integrations-billing", label: "Integrations", path: "/integrations", perm: "billing" },
      { id: "field-mapping", label: "Field Mapping", path: "/field-mapping", perm: "billing" },
      m("rejection-management", "Rejection Management", "billing"),
      m("fwa-management", "FWA Management", "billing"), m("denial-management", "Denial Management", "billing"),
      m("ar-management", "AR Management", "billing"), m("payment-reconciliations", "Payment Reconciliations", "billing"),
      m("claim-import", "Claim Import", "billing"), m("refer-patient", "Refer Patient", "billing"),
      m("ar-cases", "AR Cases", "billing"), m("manual-payments", "Manual Payments", "billing"), m("manual-responses", "Manual Responses", "billing"),
      { id: "nphies-financial", label: "NPHIES Financial", path: "/nphies-financial", perm: "billing" },
    ],
  },
  {
    id: "nphies", label: "NPHIES", icon: IconCloudUpload,
    pages: [{ id: "nphies-clinical", label: "Clinical", path: "/nphies-clinical", perm: "patient.read" }],
  },
  {
    id: "scheduler", label: "Scheduler", icon: IconCalendar, perm: "admin",
    pages: [
      m("shift-management", "Shift Management"), m("shift-assignment", "Shift Assignment"), m("plans-management", "Plans Management"),
      m("patient-plans", "Patient Plans"), m("task-scheduler", "Task Scheduler"),
    ],
  },
  {
    id: "rehab", label: "Rehabilitation Section", icon: IconHeartRateMonitor, perm: "admin",
    pages: [
      m("rehab-schedules", "Rehabilitation Schedules"), m("rehab-classes", "Rehabilitation Classes"),
      m("rehab-attendance", "Rehabilitation Attendance"), m("rehab-dashboard", "Rehabilitation Dashboard"),
      m("treatment-plan-goals", "Treatment Plan Goals"), m("treatment-plan", "Treatment Plan"), m("rehab-schedule-slots", "Rehabilitation Schedule Slots"),
    ],
  },
  {
    id: "client-setup", label: "Client Setup", icon: IconBuildingBank, perm: "admin",
    pages: [
      m("client", "Client"), m("clinic", "Clinic"), m("department", "Department"), m("sub-department", "Sub Department"), m("client-branding", "Client Branding"),
      m("care-faculty-module", "Care Faculty Module"), m("country", "Country"), m("state", "State"), m("city", "City"),
    ],
  },
  {
    id: "settings", label: "Settings", icon: IconSettings, perm: "admin",
    pages: [
      { id: "integrations", label: "Integrations", path: "/integrations", perm: "admin" },
      m("lookup", "Lookup"), m("module", "Module"), m("page", "Page"), m("clinical-integrations", "Clinical Integrations"),
      m("fee-scheduler", "Fee Scheduler"), m("tax-registration", "Tax Registration"), m("loinc-mapping", "LOINC Code Mapping"),
      m("client-diagnoses", "Client Diagnoses"), 
      m("code-type", "Code Type"), m("code", "Code"), m("whatsapp-templates", "WhatsApp Templates"), m("patient-education-materials", "Patient Education Materials"),
    ],
  },
  {
    id: "lab-setup", label: "Laboratory Setup", icon: IconFlask, perm: "admin",
    pages: [m("lab-groups", "Group & Sub-Group"), m("lab-test-details", "Test Details"), m("lab-test-components", "Test Result Components"), m("lab-permissions", "Permissions")],
  },
  {
    id: "rad-setup", label: "Radiology Setup", icon: IconRadioactive, perm: "admin",
    pages: [m("rad-groups", "Group & Sub-Group"), m("rad-permissions", "Permissions"), m("rad-machines", "Machines")],
  },
  {
    id: "insurance-setup", label: "Insurance Setup", icon: IconShieldCheck, perm: "admin",
    pages: [
      m("tpa", "TPA"), m("insurance", "Insurance"), m("insurance-policy", "Insurance Policy"), m("insurance-class", "Insurance Class"),
      m("insurance-network", "Insurance Network"), m("insurance-master", "Insurance Master Setup"),
    ],
  },
  {
    id: "emr-setup", label: "EMR Setup", icon: IconClipboardHeart, perm: "admin",
    pages: [m("emr-form-builder", "EMR Form Builder"), m("emr-module", "EMR Module"), m("emr-page", "EMR Page"), m("emr-page-permissions", "EMR Page Permissions")],
  },
  {
    id: "reporting", label: "Reporting", icon: IconReportMedical, perm: "admin",
    pages: [m("report-designer", "Report Designer"), m("report-groups", "Report Groups"), m("report-subgroups", "Report Sub Groups"), m("reports", "Reports")],
  },
  {
    id: "speciality", label: "Speciality", icon: IconStethoscope, perm: "admin",
    pages: [m("specialty", "Specialty"), m("sub-specialty", "Sub-Specialty")],
  },
  {
    id: "users", label: "Users", icon: IconUserShield, perm: "admin",
    pages: [m("users", "User"), m("superuser", "Super User")],
  },
  {
    id: "roles", label: "Role Permissions", icon: IconLock, perm: "admin",
    pages: [m("role", "Role"), m("role-module", "Role Module"), m("role-rights", "Role Rights"), { id: "access", label: "Access Matrix", path: "/access", perm: "admin" }],
  },
  {
    id: "automations", label: "Automations", icon: IconRoute, perm: "patient.read",
    pages: [
      { id: "automations", label: "Automations", path: "/automations", perm: "admin" },
      { id: "automation-history", label: "Run History", path: "/automations/history", perm: "patient.read" },
    ],
  },
  {
    id: "governance", label: "Governance", icon: IconShieldCheck, perm: "audit.read",
    pages: [
      { id: "audit", label: "Audit Trail", path: "/audit", perm: "audit.read" },
      { id: "compliance", label: "Compliance Map", path: "/compliance", perm: "audit.read" },
      { id: "ai-governance", label: "AI Governance", path: "/ai-governance", perm: "audit.read" },
    ],
  },
  // Developer View only
  {
    id: "dev-adt", label: "ADT Event Forms", icon: IconActivity, devOnly: true, pages: [],
  },
  {
    id: "dev-tools", label: "Test Tools", icon: IconTool, devOnly: true,
    pages: [
      { id: "runner", label: "Scenario Runner", path: "/runner" },
      { id: "log", label: "Message Log", path: "/log" },
      { id: "encounters", label: "Visit Timelines", path: "/encounters" },
      { id: "spec", label: "Segment Table", path: "/spec" },
    ],
  },
];

/** Listing pages and worklists: they open with the sidebar collapsed to its icon rail, so the grid gets the width. */
const LIST_PATHS = new Set([
  "/patients", "/confidential", "/my-patients", "/appointments", "/opd", "/reclassified", "/ipd", "/admission-requests", "/er",
  "/lab", "/radiology", "/theatre", "/pharmacy", "/pharmacy/stock", "/pharmacy/dispense", "/invoices", "/billing", "/transactions", "/audit",
]);
/** Every /m/ page is a setup table or an RCM case list, except the Daman dashboard. */
export const isListPage = (path: string) => LIST_PATHS.has(path) || (path.startsWith("/m/") && path !== "/m/daman-dashboard");

export const NAV_ICONS = {
  IconBed, IconDeviceDesktopAnalytics, IconId, IconPlayerPlay, IconXboxX, IconNotebook, IconTable, IconListDetails, IconSchool, IconRobot, IconFolders,
};
