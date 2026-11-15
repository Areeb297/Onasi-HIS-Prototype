import { beforeEach, describe, expect, it } from "vitest";
import { dischargeWith } from "./actions";
import {
  NOT_ALLOWED, bookAppointment, callIn, canMoveTo, checkInAppointment, checkOut, clearAppointments, closeAppointment, completeAppointment,
  confirmAppointment, getAppointments, nextStatuses, resetAppointments, rescheduleAppointment, sendToWaiting, slotsFor, specialityOf,
  targetStatus, todayOf, type Appointment, type BookingInput,
} from "./appointments";
import { switchUser } from "./session";
import { getState, registerPatient, resetAll } from "./store";

const T0 = (() => { const d = new Date(); d.setHours(7, 0, 0, 0); return d.getTime(); })();
const TODAY = todayOf(T0);

const input = (over: Partial<BookingInput> = {}): BookingInput => ({
  patientId: "P009", speciality: specialityOf("D1001"), doctorId: "D1001", date: TODAY, start: "09:00", visitType: "in-person", reason: "Cough for two weeks", ...over,
});

function book(over: Partial<BookingInput> = {}): Appointment {
  const res = bookAppointment(input(over), T0);
  if (!res.ok) throw new Error(res.errors.join(" "));
  return res.value;
}

const appt = (id: string) => getAppointments().appointments.find((a) => a.id === id)!;
const visitsOf = (pid: string) => getState().encounters.filter((e) => e.patientId === pid);
const openVisitsOf = (pid: string) => visitsOf(pid).filter((e) => e.status === "active");

beforeEach(() => {
  resetAll();
  clearAppointments();
  switchUser("U3");
});

describe("board moves", () => {
  it("allows the HIS moves and refuses the others with the HIS message", () => {
    const a = book();
    expect(a.status).toBe("booked");
    expect(canMoveTo(a, "scheduled", T0)).toEqual({ ok: true });
    expect(canMoveTo(a, "checkin", T0)).toEqual({ ok: true });
    expect(canMoveTo(a, "cancelled", T0)).toEqual({ ok: true });
    expect(canMoveTo(a, "checkout", T0)).toEqual({ ok: false, reason: NOT_ALLOWED });
    expect(canMoveTo(a, "booked", T0)).toEqual({ ok: false, reason: NOT_ALLOWED });

    expect(confirmAppointment(a.id, T0).ok).toBe(true);
    const c = appt(a.id);
    expect(c.status).toBe("confirmed");
    expect(canMoveTo(c, "booked", T0)).toEqual({ ok: false, reason: NOT_ALLOWED });
    expect(confirmAppointment(a.id, T0)).toEqual({ ok: false, errors: [NOT_ALLOWED] });
    expect(nextStatuses(c)).toEqual(["arrived", "cancelled", "no-show", "rescheduled"]);
  });

  it("checks in an in-person patient as Arrived and an online patient straight to Checked In", () => {
    expect(targetStatus(book(), "checkin")).toBe("arrived");
    expect(targetStatus(book({ start: "09:20", visitType: "online" }), "checkin")).toBe("checked-in");
  });

  it("refuses check-in on another day than the appointment", () => {
    const a = book({ date: todayOf(T0 + 86_400_000) });
    const chk = canMoveTo(a, "checkin", T0);
    expect(chk.ok).toBe(false);
    expect(!chk.ok && chk.reason.startsWith(NOT_ALLOWED)).toBe(true);
  });
});

describe("booking", () => {
  it("refuses a slot that is already taken and frees it again on cancel", () => {
    const a = book();
    const clash = bookAppointment(input({ patientId: "P010" }), T0);
    expect(clash.ok).toBe(false);
    expect(!clash.ok && clash.errors.join(" ")).toMatch(/already booked/);
    expect(slotsFor("D1001", TODAY, T0).find((s) => s.start === "09:00")).toMatchObject({ free: false, why: "Booked" });
    // Another doctor at the same time is fine for another patient, but not for the same patient.
    expect(bookAppointment(input({ patientId: "P010", doctorId: "D1005", speciality: specialityOf("D1005") }), T0).ok).toBe(true);
    const twice = bookAppointment(input({ doctorId: "D1002", speciality: specialityOf("D1002") }), T0);
    expect(!twice.ok && twice.errors.join(" ")).toMatch(/already has an appointment/);

    expect(closeAppointment(a.id, "cancelled", "Patient request", T0).ok).toBe(true);
    expect(slotsFor("D1001", TODAY, T0).find((s) => s.start === "09:00")?.free).toBe(true);
    expect(bookAppointment(input({ patientId: "P006" }), T0).ok).toBe(true);
  });

  it("checks the form: patient, doctor in the speciality, a real slot, not in the past, a reason", () => {
    const bad = bookAppointment(input({ patientId: "", doctorId: "D1005", start: "12:20", reason: " " }), T0);
    expect(!bad.ok && bad.errors).toEqual([
      "Pick the patient.", `Dr. Omar Alshehri does not work in ${specialityOf("D1001")}.`, "That time is not in the doctor's clinic hours.", "Enter the reason for the visit.",
    ]);
    const late = new Date(T0); late.setHours(10, 5);
    const past = bookAppointment(input(), late.getTime());
    expect(!past.ok && past.errors).toEqual(["That time has already passed. Pick a later time."]);
  });
});

describe("check-in", () => {
  it("opens exactly one outpatient visit with A04 and links it", () => {
    const a = book();
    const before = visitsOf("P009").length;
    const logBefore = getState().log.length;
    const res = checkInAppointment(a.id, {}, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(visitsOf("P009")).toHaveLength(before + 1);
    const v = getState().encounters.find((e) => e.visitNumber === res.visitNumber)!;
    expect(v).toMatchObject({ patientId: "P009", cls: "O", status: "active", attending: "D1001", reason: "Cough for two weeks" });
    expect(getState().log.slice(logBefore).map((l) => l.eventId)).toEqual(["A04"]);
    expect(appt(a.id)).toMatchObject({ status: "arrived", visitNumber: res.visitNumber, payType: "Cash" });

    // A second check-in does not open another visit.
    const again = checkInAppointment(a.id, {}, T0);
    expect(again.ok).toBe(false);
    expect(visitsOf("P009")).toHaveLength(before + 1);

    // Waiting, then called in: the OPD worklist shows the visit as checked in.
    expect(sendToWaiting(a.id, T0).ok).toBe(true);
    expect(callIn(a.id, T0).ok).toBe(true);
    expect(getState().encounters.find((e) => e.visitNumber === res.visitNumber)?.checkedIn).toBe(true);
    expect(visitsOf("P009")).toHaveLength(before + 1);
  });

  it("checks an online patient straight in", () => {
    const a = book({ visitType: "online" });
    const res = checkInAppointment(a.id, {}, T0);
    expect(res.ok && appt(a.id).status).toBe("checked-in");
    expect(res.ok && getState().encounters.find((e) => e.visitNumber === res.visitNumber)?.checkedIn).toBe(true);
  });

  it("keeps the card where it was and says why when the visit cannot open", () => {
    const admitted = getState().encounters.find((e) => e.cls === "I" && e.status === "active")!;
    const a = book({ patientId: admitted.patientId, doctorId: "D1003", speciality: specialityOf("D1003") });
    const before = getState().encounters.length;
    const res = checkInAppointment(a.id, {}, T0);
    expect(res.ok).toBe(false);
    expect(getState().encounters).toHaveLength(before);
    expect(appt(a.id).status).toBe("booked");
    expect(appt(a.id).problem).toMatch(/is admitted now/);
    // The next move that works clears the reason.
    expect(confirmAppointment(a.id, T0).ok).toBe(true);
    expect(appt(a.id).problem).toBeUndefined();
  });

  it("shows the coverage answer and opens the visit only when the clerk continues as cash", () => {
    const p = registerPatient({
      healthId: "1090000542", given: "Abdullah", family: "Alotaibi", dob: "1979-05-20", sex: "M", nationality: "SAU", maritalStatus: "M", address: "RHAD3135",
      extra: { idNumber: "1000000201", visitPayType: "Insurance" },
    });
    const a = book({ patientId: p.id });
    const first = checkInAppointment(a.id, {}, T0);
    expect(first.ok).toBe(false);
    expect(!first.ok && first.needsCashChoice?.outcome.kind).toBe("out-of-network");
    expect(visitsOf(p.id)).toHaveLength(0);
    expect(appt(a.id).status).toBe("booked");

    const cash = checkInAppointment(a.id, { cash: true }, T0);
    expect(cash.ok).toBe(true);
    expect(visitsOf(p.id)).toHaveLength(1);
    expect(appt(a.id)).toMatchObject({ status: "arrived", payType: "Cash", coverageNote: "Out Of Network. Continued as a cash patient." });
  });
});

describe("cancel and no show", () => {
  it("cancelling before check-in opens no visit", () => {
    const a = book();
    const before = visitsOf("P009").length;
    expect(closeAppointment(a.id, "cancelled", " ", T0).ok).toBe(false);
    expect(closeAppointment(a.id, "cancelled", "Patient request", T0).ok).toBe(true);
    expect(appt(a.id)).toMatchObject({ status: "cancelled", closeReason: "Patient request" });
    expect(appt(a.id).visitNumber).toBeUndefined();
    expect(visitsOf("P009")).toHaveLength(before);
  });

  it("a booked appointment cannot be a no show, a confirmed one can, and it keeps no visit", () => {
    const a = book();
    expect(closeAppointment(a.id, "no-show", "Did not arrive", T0)).toEqual({ ok: false, errors: [NOT_ALLOWED] });
    confirmAppointment(a.id, T0);
    expect(closeAppointment(a.id, "no-show", "Did not arrive", T0).ok).toBe(true);
    expect(appt(a.id).visitNumber).toBeUndefined();
    expect(openVisitsOf("P009")).toHaveLength(0);
  });

  it("a patient who checked in and left is a no show, and the visit opened at the desk is cancelled", () => {
    const a = book();
    const res = checkInAppointment(a.id, {}, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    sendToWaiting(a.id, T0);
    expect(closeAppointment(a.id, "no-show", "Left before being seen", T0).ok).toBe(true);
    expect(appt(a.id)).toMatchObject({ status: "no-show", cancelledVisit: res.visitNumber });
    expect(appt(a.id).visitNumber).toBeUndefined();
    expect(getState().encounters.find((e) => e.visitNumber === res.visitNumber)?.status).toBe("cancelled");
    expect(openVisitsOf("P009")).toHaveLength(0);
  });
});

describe("check-out", () => {
  it("is offered only once the linked visit has ended", () => {
    const a = book();
    const res = checkInAppointment(a.id, {}, T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    callIn(a.id, T0);
    const chk = canMoveTo(appt(a.id), "checkout", T0);
    expect(!chk.ok && chk.reason).toBe(`${NOT_ALLOWED} Check-out is offered once visit ${res.visitNumber} has ended.`);
    expect(checkOut(a.id, T0).ok).toBe(false);

    expect(dischargeWith(res.visitNumber, [{ code: "J06.9", text: "Acute upper respiratory infection", type: "F" }], "306689006").ok).toBe(true);
    expect(canMoveTo(appt(a.id), "checkout", T0)).toEqual({ ok: true });
    expect(checkOut(a.id, T0).ok).toBe(true);
    expect(completeAppointment(a.id, T0).ok).toBe(true);
    expect(appt(a.id).history.map((h) => h.status)).toEqual(["booked", "arrived", "checked-in", "checked-out", "completed"]);
  });
});

describe("reschedule", () => {
  it("keeps the old appointment as Rescheduled, books the new time and frees the old slot", () => {
    const a = book();
    const tomorrow = todayOf(T0 + 86_400_000);
    expect(rescheduleAppointment(a.id, { date: TODAY, start: "09:00" }, "Patient request", T0).ok).toBe(false);
    const res = rescheduleAppointment(a.id, { date: tomorrow, start: "10:00" }, "Patient request", T0);
    if (!res.ok) throw new Error(res.errors.join(" "));
    expect(res.value.old).toMatchObject({ status: "rescheduled", rescheduledTo: res.value.fresh.id });
    expect(res.value.fresh).toMatchObject({ status: "booked", date: tomorrow, start: "10:00", rescheduledFrom: a.id });
    expect(slotsFor("D1001", TODAY, T0).find((s) => s.start === "09:00")?.free).toBe(true);
  });
});

describe("sample appointments", () => {
  it("seeds about twelve appointments over three days with existing patients and doctors", () => {
    resetAppointments(T0);
    const list = getAppointments().appointments;
    expect(list.length).toBeGreaterThanOrEqual(12);
    expect(new Set(list.map((a) => a.date)).size).toBe(3);
    expect(list.every((a) => getState().patients.some((p) => p.id === a.patientId))).toBe(true);
    // Checked-in samples point at a real open outpatient visit.
    for (const a of list.filter((x) => x.visitNumber)) {
      expect(getState().encounters.find((e) => e.visitNumber === a.visitNumber)).toMatchObject({ cls: "O", status: "active" });
    }
  });
});
