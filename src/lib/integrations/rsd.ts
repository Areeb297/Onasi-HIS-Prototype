import { isOff, logCall, type CallEntry } from "./call-log";

/**
 * RSD, the SFDA drug track and trace system: the pharmacy tells RSD which serialised pack left the shelf.
 * Simulated. A pack is known by its GTIN (14 digits, kept as text so the leading zero stays), serial number,
 * batch and expiry, as printed in the pack's 2D barcode. The response codes are made up.
 */

export interface RsdPack {
  gtin: string;
  serial: string;
  batch: string;
  /** YYYY-MM-DD */
  expiry: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

export function rsdDispense(pack: RsdPack, now: number = Date.now()): Result<CallEntry> {
  if (isOff("rsd")) return { ok: false, errors: ["RSD is switched off. Ask the System Administrator to connect it."] };
  const errors: string[] = [];
  if (!/^\d{14}$/.test(pack.gtin)) errors.push("The GTIN must be 14 digits.");
  if (!pack.serial.trim()) errors.push("Enter the pack serial number.");
  if (!pack.batch.trim()) errors.push("Enter the batch number.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pack.expiry)) errors.push("Enter the expiry date.");
  if (errors.length) return { ok: false, errors };
  const expired = pack.expiry < new Date(now).toISOString().slice(0, 10);
  const entry = logCall({
    integration: "rsd", operation: "Dispense Notification", ok: !expired,
    summary: expired ? `GTIN ${pack.gtin}: pack expired, not accepted` : `GTIN ${pack.gtin}, serial ${pack.serial}: accepted`,
    request: { service: "DispenseService", products: [{ GTIN: pack.gtin, SN: pack.serial, BN: pack.batch, XD: pack.expiry }] },
    response: expired ? { responseCode: "10204", message: "Product expired" } : { responseCode: "10201", message: "Success", notificationId: `RSD-${now}` },
  }, now);
  return expired ? { ok: false, errors: ["RSD did not accept the pack: it is past its expiry date."] } : { ok: true, value: entry };
}
