import type { MasterColumn } from "../schema";

/** Small builders so the master definitions stay short. All sample data is made up. */

export const RCM_NOTE =
  "Scaffold with sample rows. Claims and RCM are the financial NPHIES scope, not the Unified Health Record (UHR) clinical scope. Nothing here is sent to a payer.";

export const text = (key: string, label: string, required = false, placeholder?: string): MasterColumn => ({
  key, label, ...(required || placeholder ? { field: { type: "text", required, placeholder } } : {}),
});
export const mono = (key: string, label: string, required = false, placeholder?: string): MasterColumn => ({
  key, label, type: "mono", ...(required || placeholder ? { field: { type: "text", required, placeholder } } : {}),
});
export const num = (key: string, label: string, required = false): MasterColumn => ({
  key, label, type: "number", ...(required ? { field: { type: "number", required } } : {}),
});
export const date = (key: string, label: string, required = false): MasterColumn => ({
  key, label, type: "date", ...(required ? { field: { type: "date", required } } : {}),
});
export const bool = (key: string, label: string): MasterColumn => ({ key, label, type: "bool" });
export const badge = (key: string, label: string, options: string[], required = true): MasterColumn => ({
  key, label, type: "badge", field: { type: "select", options, required },
});
/** Plain text cell that is edited with a dropdown. */
export const pick = (key: string, label: string, options: string[], required = false): MasterColumn => ({
  key, label, field: { type: "select", options, required },
});
export const monoPick = (key: string, label: string, options: string[], required = false): MasterColumn => ({
  key, label, type: "mono", field: { type: "select", options, required },
});

export const STATUS = ["Active", "Draft", "Review", "Disabled"];
export const CLINICS = ["Family Medicine", "Internal Medicine", "Pediatrics", "Orthopedics", "Radiology", "Laboratory", "Emergency", "Rehabilitation"];
