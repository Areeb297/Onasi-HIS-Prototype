import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtDayHeading, fmtDayMonth, fmtDuration, fmtLongDate, fmtMonthYear, fmtRelative, fmtShort, fmtTime, fmtWeekday, toDate } from "./format";

const at = new Date(2026, 10, 15, 15, 48, 30); // 15 Nov 2026, 15:48 local

describe("date and time text", () => {
  it("writes the time in 24 hours, with a leading zero", () => {
    expect(fmtTime(at)).toBe("15:48");
    expect(fmtTime(new Date(2026, 0, 2, 7, 5))).toBe("07:05");
    expect(fmtTime(new Date(2026, 0, 2, 0, 0))).toBe("00:00");
    expect(fmtTime(new Date(2026, 0, 2, 23, 59))).toBe("23:59");
  });

  it("writes dates as 15 Nov 2026, with no leading zero on the day", () => {
    expect(fmtDate(at)).toBe("15 Nov 2026");
    expect(fmtDate(new Date(2026, 2, 3))).toBe("3 Mar 2026");
    expect(fmtDate("2026-11-05")).toBe("5 Nov 2026"); // a plain date is that local day, in any time zone
    expect(fmtDate("2026-02-30")).toBe(""); // not a real day
  });

  it("writes date and time as 15 Nov 2026, 15:48", () => {
    expect(fmtDateTime(at)).toBe("15 Nov 2026, 15:48");
    expect(fmtDateTime("2026-11-15T15:48")).toBe("15 Nov 2026, 15:48");
    expect(fmtDateTime(at.getTime())).toBe("15 Nov 2026, 15:48");
  });

  it("drops the year for this year only", () => {
    expect(fmtShort(at, new Date(2026, 11, 1))).toBe("15 Nov, 15:48");
    expect(fmtShort(at, new Date(2027, 0, 1))).toBe("15 Nov 2026, 15:48");
  });

  it("is relative for under an hour, and a date and time after that", () => {
    const now = new Date(2026, 10, 15, 16, 0, 0);
    expect(fmtRelative(new Date(2026, 10, 15, 15, 59, 40), now)).toBe("just now");
    expect(fmtRelative(new Date(2026, 10, 15, 15, 48), now)).toBe("12 min ago");
    expect(fmtRelative(new Date(2026, 10, 15, 15, 1), now)).toBe("59 min ago");
    expect(fmtRelative(new Date(2026, 10, 15, 15, 0), now)).toBe("15 Nov 2026, 15:00");
    expect(fmtRelative(new Date(2026, 10, 14, 9, 30), now)).toBe("14 Nov 2026, 09:30");
    expect(fmtRelative(new Date(2026, 10, 15, 16, 30), now)).toBe("15 Nov 2026, 16:30"); // in the future
  });

  it("shows nothing for a missing or broken value", () => {
    for (const v of [undefined, null, "", "not a date", NaN, new Date("x")]) {
      expect(fmtTime(v as never)).toBe("");
      expect(fmtDate(v as never)).toBe("");
      expect(fmtDateTime(v as never)).toBe("");
      expect(fmtRelative(v as never)).toBe("");
    }
    expect(toDate(undefined)).toBeNull();
  });

  it("writes how long something took", () => {
    expect(fmtDuration(0)).toBe("0 min");
    expect(fmtDuration(45)).toBe("45 min");
    expect(fmtDuration(80)).toBe("1 h 20 min");
    expect(fmtDuration(120)).toBe("2 h");
    expect(fmtDuration(27 * 60)).toBe("1 d 3 h");
    expect(fmtDuration(-5)).toBe("0 min");
  });

  it("writes day headings, long dates and months", () => {
    expect(fmtWeekday(at)).toBe("Sun");
    expect(fmtWeekday(at, "long")).toBe("Sunday");
    expect(fmtWeekday(at, "narrow")).toBe("S");
    expect(fmtDayHeading(at)).toBe("Sun 15 Nov");
    expect(fmtLongDate(at)).toBe("Sunday 15 Nov 2026");
    expect(fmtMonthYear(at)).toBe("November 2026");
    expect(fmtDayMonth(at)).toBe("15 Nov");
    expect(fmtDayHeading("nope")).toBe("");
  });
});
