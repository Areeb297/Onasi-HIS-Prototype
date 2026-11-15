/**
 * Fields shared by the laboratory and radiology order forms: the diagnosis the order is for, and who pays (coverage).
 * Pure helpers, no store.
 */

import type { Dx, Encounter, Patient } from "./model";
import type { OrderCoverage, OrderDiagnosis } from "./fhir/types";

export type { OrderCoverage, OrderDiagnosis } from "./fhir/types";

export const COVERAGE_LABEL: Record<OrderCoverage, string> = {
  plan: "Plan Coverage",
  "self-pay": "Additional / Self-Pay",
};

export const coverageLabel = (c: OrderCoverage | undefined): string => (c ? COVERAGE_LABEL[c] : "Not Recorded");

/** The visit is billed to an insurance plan. Falls back to an active insurance card when the pay type was not recorded. */
export function visitInsured(patient: Pick<Patient, "extra"> | undefined): boolean {
  const x = patient?.extra;
  if (!x) return false;
  if (x.visitPayType) return x.visitPayType === "Insurance";
  return x.insurance?.status === "Active";
}

/** Plan coverage when the visit is insured, otherwise self-pay. */
export const defaultOrderCoverage = (patient: Pick<Patient, "extra"> | undefined): OrderCoverage => (visitInsured(patient) ? "plan" : "self-pay");

export const dxOption = (d: Pick<Dx, "code" | "text">): OrderDiagnosis => ({ code: d.code, text: d.text });

/** The diagnosis the form starts with: the first working or admitting diagnosis, else the first one. */
export function defaultOrderDiagnosis(dx: Dx[]): OrderDiagnosis | null {
  const d = dx.find((x) => x.type === "W" || x.type === "A") ?? dx[0];
  return d ? dxOption(d) : null;
}

/**
 * The diagnosis sent with an order. The one picked on the order wins. Orders saved before the picker existed
 * fall back to the visit's first diagnosis, which is what the bundle sent before.
 */
export function orderDiagnosis(order: { diagnosis?: OrderDiagnosis }, enc: Pick<Encounter, "dx">): OrderDiagnosis | null {
  if (order.diagnosis?.code) return order.diagnosis;
  return enc.dx[0] ? dxOption(enc.dx[0]) : null;
}

export const NO_DIAGNOSIS_NOTE = "This visit has no diagnosis yet. Add one in the Diagnosis section to link it to the order. You can still place the order without it.";
