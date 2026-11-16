import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import {
  CANCEL_REASONS, NO_SHOW_REASONS, RESCHEDULE_REASONS, STATUS_LABEL, closeAppointment, closeChoices, dayLabel, doctorName, doctorsFor,
  rescheduleAppointment, todayOf, type Appointment, type ApptStatus,
} from "@/lib/appointments";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { shownName } from "./BookingDialog";
import { SlotPicker } from "./SlotPicker";

const REASONS: Partial<Record<ApptStatus, string[]>> = { cancelled: CANCEL_REASONS, "no-show": NO_SHOW_REASONS, rescheduled: RESCHEDULE_REASONS };
const HELP: Partial<Record<ApptStatus, string>> = {
  cancelled: "The patient or the clinic called it off. The time is freed.",
  "no-show": "The patient did not come, or left before being seen.",
  rescheduled: "Move it to a new time. A new appointment is booked and this one is kept as Rescheduled.",
};

/** The Cancelled column: cancel, no show or reschedule, with a reason. Only the choices the status allows are offered. */
export function CloseDialog({ appt, onClose, now }: { appt: Appointment | null; onClose: () => void; now: number }) {
  const his = useHis();
  const choices = appt ? closeChoices(appt) : [];
  const [choice, setChoice] = React.useState<ApptStatus>("cancelled");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [doctorId, setDoctorId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [start, setStart] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!appt) return;
    setChoice(closeChoices(appt)[0] ?? "cancelled");
    setReason(""); setNote(""); setDoctorId(appt.doctorId); setDate(appt.date < todayOf() ? todayOf() : appt.date); setStart(""); setErrors([]);
  }, [appt?.id]);

  if (!appt) return null;
  const patient = his.patients.find((p) => p.id === appt.patientId);
  const text = reason === "Other" ? note.trim() : [reason, note.trim()].filter(Boolean).join(": ");

  function save() {
    if (!appt) return;
    if (!reason) return setErrors(["Choose the reason."]);
    if (reason === "Other" && note.trim().length < 3) return setErrors(["Say what the reason is."]);
    if (choice === "rescheduled") {
      const res = rescheduleAppointment(appt.id, { doctorId, date, start }, text, now);
      if (!res.ok) return setErrors(res.errors);
      pushToast({ tone: "ok", text: "Appointment rescheduled.", detail: `New time ${dayLabel(res.value.fresh.date)} at ${res.value.fresh.start} with ${doctorName(res.value.fresh.doctorId)}. It is on the board as Booked.` });
    } else {
      const res = closeAppointment(appt.id, choice as "cancelled" | "no-show", text, now);
      if (!res.ok) return setErrors(res.errors);
      pushToast({
        tone: "ok",
        text: `Appointment marked ${STATUS_LABEL[choice]}.`,
        detail: appt.visitNumber ? `Visit ${appt.visitNumber} was cancelled with it (A11).` : "No visit was opened.",
      });
    }
    onClose();
  }

  return (
    <Dialog
      open
      wide={choice === "rescheduled"}
      onClose={onClose}
      title="Cancel, No Show Or Reschedule"
      subtitle={`${shownName(patient)}, ${dayLabel(appt.date)} at ${appt.start} with ${doctorName(appt.doctorId)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Keep Appointment</Button>
          <Button variant={choice === "rescheduled" ? "primary" : "danger"} onClick={save}>
            {choice === "rescheduled" ? "Reschedule" : `Mark ${STATUS_LABEL[choice]}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <ul className="list-disc pl-5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        )}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">What Happened</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {choices.map((c) => (
              <label key={c} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", choice === c ? "border-primary bg-accent" : "border-border")}>
                <input type="radio" name="close-choice" className="mt-0.5 size-4 accent-primary" checked={choice === c} onChange={() => { setChoice(c); setReason(""); setErrors([]); }} />
                <span>
                  <span className="block font-medium">{STATUS_LABEL[c]}</span>
                  <span className="block text-xs text-muted-foreground">{HELP[c]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {appt.visitNumber && choice !== "rescheduled" && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm">Visit {appt.visitNumber} was opened at check-in. It is cancelled with the appointment (A11), so no visit is left open.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reason" required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose the reason</option>
              {(REASONS[choice] ?? CANCEL_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </Field>
          <Field label={reason === "Other" ? "Say What The Reason Is" : "Note"} required={reason === "Other"}>
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {choice === "rescheduled" && (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Doctor" required>
                <Select value={doctorId} onChange={(e) => { setDoctorId(e.target.value); setStart(""); }}>
                  {doctorsFor(appt.speciality).map((d) => <option key={d.id} value={d.id}>{doctorName(d.id)}</option>)}
                </Select>
              </Field>
              <Field label="New Date" required>
                <Input type="date" min={todayOf(now)} value={date} onChange={(e) => { setDate(e.target.value); setStart(""); }} />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">New Time<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
              <SlotPicker doctorId={doctorId} date={date} value={start} onChange={setStart} now={now} ignoreId={appt.id} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
