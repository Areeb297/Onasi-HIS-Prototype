import { beforeEach, describe, expect, it } from "vitest";
import {
  acceptConsult, answerConsult, bookFollowUp, cancelFollowUp, chartFindings, closeConsult, completeFollowUp, consultTimes, consultsOf, consultsPastTarget,
  followUpTarget, followUpTitle, followUpsOf, minutesText, orderFollowUp, requestConsult, resetCareRequests, unbookedFollowUps,
} from "./care-requests";
import { attentionFor } from "./chart-review";
import { resetDocs } from "./docs";
import { resetEmar } from "./emar";
import { resetLab } from "./lab";
import { getRx, resetRx, setRx } from "./rx";
import { DRUGS } from "./rx-catalogue";
import { switchUser } from "./session";
import { getState, resetAll } from "./store";
import { resetVitals } from "./vitals";

const MIN = 60_000;
const T0 = new Date(2026, 0, 5, 9, 0).getTime();
const enc = () => getState().encounters.find((e) => e.cls === "I" && e.status === "active")!;
const patient = () => getState().patients.find((p) => p.id === enc().patientId)!;
const FU = { amount: 2, unit: "weeks" as const, clinic: "Cardiology Clinic", doctorId: "D1001", visitType: "telehealth" as const, instructions: "Bring your blood pressure diary." };

beforeEach(() => {
  resetAll(); resetVitals(); resetLab(); resetRx(); resetDocs(); resetEmar(); resetCareRequests(); switchUser("U1");
});

describe("follow-up order", () => {
  it("is a booking request until somebody books it with a date", () => {
    const visit = enc().visitNumber;
    const res = orderFollowUp({ visit, ...FU }, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(res.value).toMatchObject({ status: "requested", orderedBy: "Dr. Khalid Alharbi", targetDate: "2026-01-19", visitType: "telehealth" });
    expect(followUpTitle(res.value)).toBe("Follow up in 2 weeks");
    expect(unbookedFollowUps(visit)).toHaveLength(1);
    expect(bookFollowUp(res.value.id, "", T0).ok).toBe(false);
    expect(bookFollowUp(res.value.id, "2026-01-04T10:00", T0).ok).toBe(false);
    const booked = bookFollowUp(res.value.id, "2026-01-19T10:30", T0 + 5 * MIN);
    expect(booked.ok && booked.value).toMatchObject({ status: "booked", bookedFor: "2026-01-19T10:30", bookedBy: "Dr. Khalid Alharbi" });
    expect(unbookedFollowUps(visit)).toHaveLength(0);
    expect(completeFollowUp(res.value.id).ok).toBe(true);
    expect(cancelFollowUp(res.value.id, "Not needed").ok).toBe(false);
    expect(followUpsOf(visit)[0].status).toBe("done");
  });

  it("checks the number, the clinic and the cancel reason", () => {
    const visit = enc().visitNumber;
    expect(orderFollowUp({ visit, ...FU, amount: 0 }).ok).toBe(false);
    expect(orderFollowUp({ visit, ...FU, clinic: "" }).ok).toBe(false);
    expect(followUpTarget(10, "days", T0)).toBe("2026-01-15");
    expect(followUpTitle({ amount: 1, unit: "days" })).toBe("Follow up in 1 day");
    const res = orderFollowUp({ visit, ...FU });
    if (!res.ok) throw new Error("expected a follow-up");
    expect(cancelFollowUp(res.value.id, " ").ok).toBe(false);
    expect(completeFollowUp(res.value.id).ok).toBe(false);
    expect(cancelFollowUp(res.value.id, "Patient moved to another city").ok).toBe(true);
  });

  it("is on the needs-attention list when the patient is discharged and it is not booked", () => {
    const visit = enc().visitNumber;
    const res = orderFollowUp({ visit, ...FU }, T0);
    if (!res.ok) throw new Error("expected a follow-up");
    expect(attentionFor(enc(), patient()).some((a) => a.id === "follow-up")).toBe(false);
    const discharged = { ...enc(), status: "discharged" as const };
    const item = attentionFor(discharged, patient()).find((a) => a.id === "follow-up");
    expect(item).toMatchObject({ section: "follow-up", level: "medium" });
    bookFollowUp(res.value.id, "2099-01-19T10:30");
    expect(attentionFor(discharged, patient()).some((a) => a.id === "follow-up")).toBe(false);
  });
});

describe("consult request", () => {
  const ask = (urgency: "routine" | "urgent" | "emergency" = "emergency") => {
    const res = requestConsult({ visit: enc().visitNumber, specialty: "Cardiology", urgency, question: "Chest pain with new ST changes. Is this for the cath lab?", findings: "" }, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    return res.value;
  };

  it("needs the clinical question", () => {
    expect(requestConsult({ visit: enc().visitNumber, specialty: "Cardiology", urgency: "routine", question: "  ", findings: "" }).ok).toBe(false);
    expect(requestConsult({ visit: enc().visitNumber, specialty: "", urgency: "routine", question: "Advice please", findings: "" }).ok).toBe(false);
  });

  it("moves from requested to accepted, seen and closed, and times each step", () => {
    const c = ask();
    expect(consultTimes(c, T0 + 10 * MIN)).toMatchObject({ target: 30, waiting: 10, overdue: false });
    switchUser("U9");
    expect(acceptConsult(c.id, T0 + 12 * MIN).ok).toBe(true);
    expect(acceptConsult(c.id, T0 + 13 * MIN).ok).toBe(false);
    expect(answerConsult(c.id, "", "", T0 + 25 * MIN).ok).toBe(false);
    const seen = answerConsult(c.id, "Inferior STEMI.", "Activate the cath lab. Aspirin 300 mg now.", T0 + 25 * MIN);
    if (!seen.ok) throw new Error("expected seen");
    expect(seen.value).toMatchObject({ status: "seen", acceptedBy: "System Administrator", seenBy: "System Administrator", requestedBy: "Dr. Khalid Alharbi" });
    expect(consultTimes(seen.value, T0 + 60 * MIN)).toMatchObject({ toAccepted: 12, toSeen: 25, overdue: false, seenLate: false, waiting: undefined });
    expect(closeConsult(c.id, "", T0 + 40 * MIN).ok).toBe(true);
    expect(consultsOf(enc().visitNumber)[0].status).toBe("closed");
    expect(closeConsult(c.id).ok).toBe(false);
  });

  it("accepts and sees in one step when the consultant answers straight away", () => {
    const c = ask("urgent");
    const seen = answerConsult(c.id, "Seen. No acute problem.", "", T0 + 50 * MIN);
    expect(seen.ok && consultTimes(seen.value)).toMatchObject({ toAccepted: 50, toSeen: 50 });
  });

  it("flags an emergency consult that is not seen in 30 minutes", () => {
    const c = ask();
    const visit = enc().visitNumber;
    expect(consultsPastTarget(visit, T0 + 30 * MIN)).toHaveLength(0);
    expect(consultsPastTarget(visit, T0 + 31 * MIN)).toHaveLength(1);
    acceptConsult(c.id, T0 + 5 * MIN);
    expect(consultsPastTarget(visit, T0 + 45 * MIN)).toHaveLength(1);
    const late = answerConsult(c.id, "Seen.", "", T0 + 45 * MIN);
    expect(late.ok && consultTimes(late.value).seenLate).toBe(true);
    expect(consultsPastTarget(visit, T0 + 90 * MIN)).toHaveLength(0);
  });

  it("gives routine and urgent consults longer", () => {
    ask("urgent");
    ask("routine");
    const visit = enc().visitNumber;
    expect(consultsPastTarget(visit, T0 + 60 * MIN)).toHaveLength(0);
    expect(consultsPastTarget(visit, T0 + 241 * MIN).map((c) => c.urgency)).toEqual(["urgent"]);
    expect(consultsPastTarget(visit, T0 + 1441 * MIN)).toHaveLength(2);
  });

  it("needs a reason to close a consult that was never seen", () => {
    const c = ask("routine");
    expect(closeConsult(c.id).ok).toBe(false);
    const closed = closeConsult(c.id, "Patient transferred to another hospital");
    expect(closed.ok && closed.value.closeReason).toMatch(/transferred/);
  });

  it("puts an open consult past its target on the needs-attention list", () => {
    const res = requestConsult({ visit: enc().visitNumber, specialty: "Cardiology", urgency: "emergency", question: "Unstable. Please see now.", findings: "" }, Date.now() - 45 * MIN);
    if (!res.ok) throw new Error("expected a consult");
    const item = attentionFor(enc(), patient()).find((a) => a.id === "consult-late");
    expect(item).toMatchObject({ level: "high", section: "consults" });
    expect(item?.text).toMatch(/Cardiology/);
    answerConsult(res.value.id, "Seen.", "");
    expect(attentionFor(enc(), patient()).some((a) => a.id === "consult-late")).toBe(false);
  });

  it("writes minutes in words", () => {
    expect(minutesText(1)).toBe("1 minute");
    expect(minutesText(45)).toBe("45 minutes");
    expect(minutesText(190)).toBe("3 hours 10 minutes");
    expect(minutesText(120)).toBe("2 hours");
  });
});

describe("findings from the chart", () => {
  it("pulls diagnoses, allergies, vital signs and current medicines", () => {
    const e = enc();
    const drug = DRUGS.find((d) => d.generic === "Metformin")!;
    setRx({
      ...getRx(),
      prescriptions: [{
        id: "t-rx", number: "RX-T", visitNumber: e.visitNumber, patientId: e.patientId, prescriberId: e.attending, authoredAt: new Date().toISOString(),
        usage: "inpatient", groupId: "G", controlled: false, dirty: false, sentAt: new Date().toISOString(),
        items: [{
          id: "t-i", identifier: "RXI-T", drugId: drug.id, dose: 1, frequencyId: "BID", asNeeded: false, durationDays: 5, quantity: 10, quantityManual: false,
          route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R69", text: "Illness" }, status: "active", version: 1,
        }],
      }],
    });
    const text = chartFindings({ ...e, allergies: [], dx: [{ code: "I21.9", text: "Acute myocardial infarction", type: "W" }], vitals: { bp: "90/60", pulse: "110", temp: "", spo2: "93", rr: "", weight: "", at: "" } });
    expect(text).toContain("Acute myocardial infarction (I21.9)");
    expect(text).toContain("Allergies: none recorded.");
    expect(text).toContain("BP 90/60, pulse 110, oxygen 93%");
    expect(text).toContain("Current medicines: Metformin.");
  });
});

describe("overdue doses on the needs-attention list", () => {
  it("lists them for an active inpatient", () => {
    const e = enc();
    const drug = DRUGS.find((d) => d.generic === "Metformin")!;
    const sent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    setRx({
      ...getRx(),
      prescriptions: [{
        id: "t-rx", number: "RX-T", visitNumber: e.visitNumber, patientId: e.patientId, prescriberId: e.attending, authoredAt: sent,
        usage: "inpatient", groupId: "G", controlled: false, dirty: false, sentAt: sent,
        items: [{
          id: "t-i", identifier: "RXI-T", drugId: drug.id, dose: 1, frequencyId: "Q6H", asNeeded: false, durationDays: 10, quantity: 40, quantityManual: false,
          route: "PO", patientInstruction: "", fulfillmentNote: "", refills: 0, reason: { code: "R69", text: "Illness" }, status: "active", version: 1,
        }],
      }],
    });
    const item = attentionFor(e, patient()).find((a) => a.id === "dose-overdue");
    expect(item).toMatchObject({ section: "emar", level: "medium" });
    expect(item?.text).toMatch(/Metformin/);
    expect(attentionFor({ ...e, cls: "O" }, patient()).some((a) => a.id === "dose-overdue")).toBe(false);
  });
});
