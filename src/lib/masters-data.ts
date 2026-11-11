import type { MasterDef } from "./schema";
import { INSURANCE } from "./masters/insurance";
import { OPERATIONS } from "./masters/operations";
import { RCM } from "./masters/rcm";
import { SETUP } from "./masters/setup";
import { SYSTEM } from "./masters/system";

/**
 * Setup tables (masters), one entry per /m/<id> page in the menu (see src/lib/nav.ts).
 * All rows are made-up sample data. RCM and claims pages are scaffolds (financial NPHIES scope, not UHR).
 * Definitions live in src/lib/masters/*.ts.
 */
export const MASTERS: MasterDef[] = [...OPERATIONS, ...RCM, ...SETUP, ...INSURANCE, ...SYSTEM];
