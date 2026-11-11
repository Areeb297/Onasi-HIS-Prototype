import type { Permission } from "./session";

export const PERMISSION_LABELS: Record<Permission, string> = {
  "patient.read": "View patients and worklists",
  "patient.register": "Register patients",
  "adt.send": "Send ADT events (admit, transfer, discharge)",
  "emr.read": "Read the clinical chart",
  "emr.write": "Write in the clinical chart",
  "order.lab": "Order laboratory tests",
  "order.rad": "Order radiology",
  "rx.write": "Prescribe",
  "rx.dispense": "Dispense medication",
  "lab.result": "Enter laboratory results",
  "rad.report": "Write radiology reports",
  "docs.publish": "Publish clinical documents",
  "confidential.read": "Read confidential records without break-the-glass",
  "audit.read": "Read the audit trail and compliance map",
  admin: "Administer setup, users and roles",
  "ai.use": "Use the AI assistant",
  billing: "Billing and RCM",
};
