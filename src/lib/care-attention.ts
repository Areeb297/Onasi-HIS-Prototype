import { CONSULT_TARGET_MIN, URGENCY_LABEL, consultTimes, consultsPastTarget, followUpTitle, minutesText, unbookedFollowUps } from "./care-requests";
import { overdueDoses } from "./emar";
import type { Encounter } from "./model";

/**
 * Items for the chart's "needs attention" list that come from the medication chart, consults and follow-up orders.
 * Kept here so chart-review.ts needs one line. Reads the stores; writes nothing.
 */
export interface CareAttention {
  id: string;
  level: "high" | "medium" | "info";
  text: string;
  section: string;
}

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function careAttention(enc: Encounter, now: number = Date.now()): CareAttention[] {
  const out: CareAttention[] = [];

  if (enc.status === "active") {
    const overdue = overdueDoses(enc, now);
    if (overdue.length) {
      const names = overdue.slice(0, 3).map((d) => `${d.order.drug.generic} ${hm(d.time)}`).join(", ");
      const highAlert = overdue.some((d) => d.order.highAlert);
      out.push({
        id: "dose-overdue", level: highAlert ? "high" : "medium", section: "emar",
        text: `${overdue.length} medicine dose${overdue.length > 1 ? "s" : ""} overdue: ${names}${overdue.length > 3 ? ` and ${overdue.length - 3} more` : ""}. Record each as given, held, refused or missed.`,
      });
    }
  }

  const late = consultsPastTarget(enc.visitNumber, now);
  if (late.length) {
    const worst = late.find((c) => c.urgency === "emergency") ?? late[0];
    const t = consultTimes(worst, now);
    out.push({
      id: "consult-late", level: worst.urgency === "emergency" ? "high" : "medium", section: "consults",
      text: `${URGENCY_LABEL[worst.urgency]} ${worst.specialty} consult has waited ${minutesText(t.waiting ?? 0)}. The target is ${minutesText(CONSULT_TARGET_MIN[worst.urgency])}.${late.length > 1 ? ` ${late.length - 1} more consult${late.length > 2 ? "s are" : " is"} past the target.` : ""}`,
    });
  }

  if (enc.status === "discharged") {
    const open = unbookedFollowUps(enc.visitNumber);
    if (open.length) {
      out.push({
        id: "follow-up", level: "medium", section: "follow-up",
        text: `Discharged, but ${open.length === 1 ? `the follow-up (${followUpTitle(open[0]).toLowerCase()}, ${open[0].clinic}) is` : `${open.length} follow-ups are`} not booked yet.`,
      });
    }
  }
  return out;
}
