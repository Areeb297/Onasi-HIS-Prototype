import {
  IconActivity, IconBed, IconBuildingHospital, IconCalendar, IconCash, IconClipboardHeart, IconDeviceDesktopAnalytics,
  IconFlask, IconHeartbeat, IconId, IconLock, IconPill, IconPlayerPlay, IconReportMedical, IconSettings, IconShieldCheck,
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
  color: string; // text color class
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
    id: "dashboard", label: "Dashboard", icon: IconDeviceDesktopAnalytics, color: "text-admit",
    pages: [{ id: "dashboard", label: "Dashboard", path: "/dashboard", perm: "patient.read" }],
  },
  {
    id: "patient", label: "Patient", icon: IconUsers, color: "text-merge",
    pages: [
      { id: "patients", label: "Patient", path: "/patients", perm: "patient.read" },
      { id: "confidential", label: "Confidential Patient", path: "/confidential", perm: "patient.read" },
      { id: "registration", label: "Patient Registration", path: "/registration", perm: "patient.register" },
    ],
  },
  {
    id: "appointments", label: "Appointments", icon: IconCalendar, color: "text-move",
    pages: [m("appointments", "Appointments", "patient.read")],
  },
  {
    id: "opd", label: "OPD", icon: IconStethoscope, color: "text-admit",
    pages: [{ id: "opd", label: "OPD Worklist", path: "/opd", perm: "patient.read" }],
  },
  {
    id: "ipd", label: "IPD", icon: IconBuildingHospital, color: "text-move",
    pages: [
      m("admission-approval", "Admission Approval Worklist", "patient.read"),
      m("admission-request", "Admission Request", "patient.read"),
      { id: "beds", label: "Beds", path: "/beds", perm: "patient.read" },
      { id: "ipd", label: "IPD Worklist", path: "/ipd", perm: "patient.read" },
    ],
  },
  {
    id: "er", label: "Emergency", icon: IconHeartbeat, color: "text-cancel",
    pages: [{ id: "er", label: "Emergency Worklist", path: "/er", perm: "patient.read" }],
  },
  {
    id: "lab", label: "Laboratory", icon: IconFlask, color: "text-update",
    pages: [{ id: "lab", label: "Worklist", path: "/lab", perm: "lab.result" }],
  },
  {
    id: "rad", label: "Radiology", icon: IconRadioactive, color: "text-move",
    pages: [{ id: "rad", label: "Worklist", path: "/radiology", perm: "rad.report" }],
  },
  {
    id: "theatre", label: "Theatre", icon: IconScissors, color: "text-cancel",
    pages: [{ id: "theatre", label: "Theatre List", path: "/theatre", perm: "emr.read" }],
  },
  {
    id: "pharmacy", label: "Pharmacy", icon: IconPill, color: "text-ok",
    pages: [
      m("pharmacy", "Pharmacy", "admin"),
      { id: "dispense", label: "Dispense Worklist", path: "/pharmacy/dispense", perm: "rx.dispense" },
    ],
  },
  {
    id: "onasi-ai", label: "Onasi AI", icon: IconRobot, color: "text-admit", perm: "ai.use",
    pages: [{ id: "agents", label: "Agents", path: "/agents", perm: "ai.use" }],
  },
  {
    id: "invoice", label: "Invoice", icon: IconFileInvoice, color: "text-merge", perm: "billing",
    pages: [m("invoice", "Invoice", "billing"), m("contractual-discounts", "Contractual Discounts", "billing")],
  },
  {
    id: "rcm", label: "RCM", icon: IconCash, color: "text-ok", perm: "billing",
    pages: [
      m("daman-dashboard", "Daman Dashboard", "billing"), m("submitted-transactions", "Submitted Transactions", "billing"),
      m("new-transactions", "New Transactions", "billing"), m("rejection-management", "Rejection Management", "billing"),
      m("fwa-management", "FWA Management", "billing"), m("denial-management", "Denial Management", "billing"),
      m("ar-management", "AR Management", "billing"), m("payment-reconciliations", "Payment Reconciliations", "billing"),
      m("claim-import", "Claim Import", "billing"), m("refer-patient", "Refer Patient", "billing"),
      { id: "nphies-financial", label: "NPHIES Financial", path: "/nphies-financial", perm: "billing" },
    ],
  },
  {
    id: "nphies", label: "NPHIES", icon: IconCloudUpload, color: "text-move",
    pages: [{ id: "nphies-clinical", label: "Clinical", path: "/nphies-clinical", perm: "patient.read" }],
  },
  {
    id: "scheduler", label: "Scheduler", icon: IconCalendar, color: "text-update", perm: "admin",
    pages: [
      m("shift-management", "Shift Management"), m("shift-assignment", "Shift Assignment"), m("plans-management", "Plans Management"),
      m("patient-plans", "Patient Plans"), m("task-scheduler", "Task Scheduler"),
    ],
  },
  {
    id: "rehab", label: "Rehabilitation Section", icon: IconHeartRateMonitor, color: "text-admit", perm: "admin",
    pages: [
      m("rehab-schedules", "Rehabilitation Schedules"), m("rehab-classes", "Rehabilitation Classes"),
      m("rehab-attendance", "Rehabilitation Attendance"), m("rehab-dashboard", "Rehabilitation Dashboard"),
      m("treatment-plan-goals", "Treatment Plan Goals"), m("treatment-plan", "Treatment Plan"),
    ],
  },
  {
    id: "client-setup", label: "Client Setup", icon: IconBuildingBank, color: "text-move", perm: "admin",
    pages: [m("clinic", "Clinic"), m("department", "Department"), m("sub-department", "Sub Department"), m("client-branding", "Client Branding")],
  },
  {
    id: "settings", label: "Settings", icon: IconSettings, color: "text-muted-foreground", perm: "admin",
    pages: [
      m("lookup", "Lookup"), m("module", "Module"), m("page", "Page"), m("clinical-integrations", "Clinical Integrations"),
      m("fee-scheduler", "Fee Scheduler"), m("tax-registration", "Tax Registration"), m("loinc-mapping", "LOINC Code Mapping"),
      m("client-diagnoses", "Client Diagnoses"), m("rule-engine", "Rule Engine"), m("rule-engine-field-mapping", "Rule Engine Field Mapping"),
    ],
  },
  {
    id: "lab-setup", label: "Laboratory Setup", icon: IconFlask, color: "text-update", perm: "admin",
    pages: [m("lab-groups", "Group & Sub-Group"), m("lab-test-details", "Test Details"), m("lab-permissions", "Permissions")],
  },
  {
    id: "rad-setup", label: "Radiology Setup", icon: IconRadioactive, color: "text-move", perm: "admin",
    pages: [m("rad-groups", "Group & Sub-Group"), m("rad-permissions", "Permissions"), m("rad-machines", "Machines")],
  },
  {
    id: "insurance-setup", label: "Insurance Setup", icon: IconShieldCheck, color: "text-ok", perm: "admin",
    pages: [
      m("tpa", "TPA"), m("insurance", "Insurance"), m("insurance-policy", "Insurance Policy"), m("insurance-class", "Insurance Class"),
      m("insurance-network", "Insurance Network"), m("insurance-master", "Insurance Master Setup"),
    ],
  },
  {
    id: "emr-setup", label: "EMR Setup", icon: IconClipboardHeart, color: "text-admit", perm: "admin",
    pages: [m("emr-form-builder", "EMR Form Builder"), m("emr-module", "EMR Module"), m("emr-page", "EMR Page"), m("emr-page-permissions", "EMR Page Permissions")],
  },
  {
    id: "reporting", label: "Reporting", icon: IconReportMedical, color: "text-merge", perm: "admin",
    pages: [m("report-designer", "Report Designer"), m("report-groups", "Report Groups"), m("report-subgroups", "Report Sub Groups"), m("reports", "Reports")],
  },
  {
    id: "speciality", label: "Speciality", icon: IconStethoscope, color: "text-update", perm: "admin",
    pages: [m("specialty", "Specialty"), m("sub-specialty", "Sub-Specialty")],
  },
  {
    id: "users", label: "Users", icon: IconUserShield, color: "text-move", perm: "admin",
    pages: [m("users", "User")],
  },
  {
    id: "roles", label: "Role Permissions", icon: IconLock, color: "text-cancel", perm: "admin",
    pages: [m("role", "Role"), m("role-module", "Role Module"), m("role-rights", "Role Rights"), { id: "access", label: "Access Matrix", path: "/access", perm: "admin" }],
  },
  {
    id: "governance", label: "Governance", icon: IconShieldCheck, color: "text-ok", perm: "audit.read",
    pages: [
      { id: "audit", label: "Audit Trail", path: "/audit", perm: "audit.read" },
      { id: "compliance", label: "Compliance Map", path: "/compliance", perm: "audit.read" },
      { id: "ai-governance", label: "AI Governance", path: "/ai-governance", perm: "audit.read" },
    ],
  },
  // Developer View only
  {
    id: "dev-adt", label: "ADT Event Forms", icon: IconActivity, color: "text-update", devOnly: true, pages: [],
  },
  {
    id: "dev-tools", label: "Test Tools", icon: IconTool, color: "text-ok", devOnly: true,
    pages: [
      { id: "runner", label: "Scenario Runner", path: "/runner" },
      { id: "log", label: "Message Log", path: "/log" },
      { id: "encounters", label: "Visit Timelines", path: "/encounters" },
      { id: "spec", label: "Segment Table", path: "/spec" },
    ],
  },
];

export const NAV_ICONS = {
  IconBed, IconDeviceDesktopAnalytics, IconId, IconPlayerPlay, IconXboxX, IconNotebook, IconTable, IconListDetails, IconSchool, IconRobot, IconFolders,
};
