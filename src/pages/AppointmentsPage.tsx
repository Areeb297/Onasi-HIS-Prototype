import { IconCalendarEvent, IconCalendarX, IconStethoscope, IconUserCheck } from "@tabler/icons-react";
import * as React from "react";
import { Plus, RefreshCcw, RotateCcw, Search } from "lucide-react";
import { AppointmentBoard } from "@/components/appointments/AppointmentBoard";
import { AppointmentDetails } from "@/components/appointments/AppointmentDetails";
import { BookingDialog } from "@/components/appointments/BookingDialog";
import { CheckInDialog } from "@/components/appointments/CheckInDialog";
import { CloseDialog } from "@/components/appointments/CloseDialog";
import { StatStrip } from "@/components/board/StatStrip";
import { Button, Card, Empty, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import {
  SPECIALITIES, columnOf, doctorName, doctorsFor, filterAppointments, resetAppointments, todayOf, useAppointments,
} from "@/lib/appointments";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * Appointments: the front desk board. Five columns as in the HIS (Booked, Scheduled, Check-In / Arrived, Check-Out,
 * Cancelled), one lane per doctor, with a date range, speciality and doctor filters and Add Appointment.
 */
export function AppointmentsPage() {
  const store = useAppointments();
  useHis();
  useSession();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const today = todayOf(now);

  const [from, setFrom] = React.useState(today);
  const [to, setTo] = React.useState(today);
  const [speciality, setSpeciality] = React.useState("");
  const [doctorId, setDoctorId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [booking, setBooking] = React.useState(false);
  const [checkInId, setCheckInId] = React.useState<string | null>(null);
  const [closeId, setCloseId] = React.useState<string | null>(null);
  const [detailsId, setDetailsId] = React.useState<string | null>(null);

  const allowed = can("patient.register");
  const rangeBad = !!from && !!to && from > to;
  const list = rangeBad ? [] : filterAppointments(store.appointments, { from: from || "0000-00-00", to: to || "9999-12-31", doctorId, speciality, q });
  const multiDay = from !== to;
  const filtered = from !== today || to !== today || !!speciality || !!doctorId || !!q.trim();
  const byId = (id: string | null) => (id ? store.appointments.find((a) => a.id === id) ?? null : null);

  const count = (cols: string[]) => list.filter((a) => cols.includes(columnOf(a.status))).length;
  const atDesk = list.filter((a) => a.status === "arrived" || a.status === "waiting").length;
  const withDoctor = list.filter((a) => a.status === "checked-in").length;

  function clear() {
    setFrom(today); setTo(today); setSpeciality(""); setDoctorId(""); setQ("");
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Book clinic appointments and run the day at the front desk. Check-in checks coverage and opens the outpatient visit. Drag a card to the next column, or use the arrows button on the card."
        right={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => { resetAppointments(); pushToast({ tone: "ok", text: "Sample appointments restored." }); }}>
              <RotateCcw className="size-4" aria-hidden="true" /> Reset Samples
            </Button>
            <span title={allowed ? undefined : "Your role cannot book appointments. It needs the patient.register permission."} className="inline-flex">
              <Button variant="primary" disabled={!allowed} onClick={() => setBooking(true)}>
                <Plus className="size-4" aria-hidden="true" /> Add Appointment
              </Button>
            </span>
          </div>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)_auto] lg:items-end">
          <Field label="From">
            <Input type="date" value={from} max={to || undefined} aria-invalid={rangeBad || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from || undefined} aria-invalid={rangeBad || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Speciality">
            <Select value={speciality} onChange={(e) => { setSpeciality(e.target.value); if (doctorId && !doctorsFor(e.target.value).some((d) => d.id === doctorId)) setDoctorId(""); }}>
              <option value="">All Specialities</option>
              {SPECIALITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">All Doctors</option>
              {doctorsFor(speciality).map((d) => <option key={d.id} value={d.id}>{doctorName(d.id)}</option>)}
            </Select>
          </Field>
          <Field label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient, MRN or visit" className="pl-9" />
            </div>
          </Field>
          <Button onClick={clear} disabled={!filtered} className="h-10">
            <RefreshCcw className="size-4" aria-hidden="true" /> Clear Filters
          </Button>
        </div>
        {rangeBad && <p role="alert" className="mt-2 text-sm text-destructive">The From date is after the To date.</p>}
      </Card>

      <StatStrip
        stats={[
          { label: "Appointments", icon: <IconCalendarEvent stroke={1.75} />, value: list.length - count(["cancelled"]), note: from === to ? (from === today ? "Today, not counting cancelled" : "On this day, not counting cancelled") : "In the date range, not counting cancelled" },
          { label: "At The Desk", icon: <IconUserCheck stroke={1.75} />, value: atDesk, tone: atDesk ? "admit" : "muted", note: "Arrived or in the waiting area" },
          { label: "With The Doctor", icon: <IconStethoscope stroke={1.75} />, value: withDoctor, tone: withDoctor ? "update" : "muted", note: "Checked in, visit open" },
          { label: "Cancelled Or No Show", icon: <IconCalendarX stroke={1.75} />, value: count(["cancelled"]), tone: count(["cancelled"]) ? "cancel" : "muted", note: "Including rescheduled" },
        ]}
      />

      {list.length === 0 ? (
        <Card>
          <Empty>
            {rangeBad ? "Fix the date range to see appointments." : "No appointments match. Change the dates or filters, or press Add Appointment."}
          </Empty>
        </Card>
      ) : (
        <AppointmentBoard
          appointments={list}
          allowed={allowed}
          multiDay={multiDay}
          onCheckIn={setCheckInId}
          onClose={setCloseId}
          onDetails={setDetailsId}
        />
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Check-in is on the day of the appointment. It shows the coverage answer first, then opens the outpatient visit, which goes to the OPD worklist.
        An in-person patient is Arrived, then goes to the waiting area and is called in. Check-out is offered once the doctor ends the visit.
        A cancelled or no-show appointment keeps no open visit.
      </p>

      <BookingDialog open={booking} onClose={() => setBooking(false)} now={now} />
      <CheckInDialog appt={byId(checkInId)} onClose={() => setCheckInId(null)} now={now} />
      <CloseDialog appt={byId(closeId)} onClose={() => setCloseId(null)} now={now} />
      <AppointmentDetails appt={byId(detailsId)} onClose={() => setDetailsId(null)} />
    </div>
  );
}
