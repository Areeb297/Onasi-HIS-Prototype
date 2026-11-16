import * as React from "react";
import { Search, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import {
  SPECIALITIES, VISIT_TYPE_LABEL, bookAppointment, bookingProblems, dayLabel, doctorName, doctorsFor, specialityOf, todayOf, type VisitType,
} from "@/lib/appointments";
import type { Patient } from "@/lib/model";
import { hasGlass } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { SlotPicker } from "./SlotPicker";

const masked = (p: Patient) => !!p.confidential && !hasGlass(p.id);
export const shownName = (p: Patient | undefined) => (!p ? "Patient not found" : masked(p) ? "Confidential patient" : patientName(p));

/** Search the patient files by name, MRN, ID number or Health ID. A confidential file is found only by its numbers. */
function PatientSearch({ value, onChange, invalid }: { value: string; onChange: (id: string) => void; invalid?: boolean }) {
  const his = useHis();
  const [q, setQ] = React.useState("");
  const picked = his.patients.find((p) => p.id === value);
  const term = q.trim().toLowerCase();
  const hits = term.length < 2 ? [] : his.patients.filter((p) => {
    const numbers = `${p.mrn} ${p.nationalId} ${p.healthId} ${p.extra?.idNumber ?? ""}`.toLowerCase();
    return numbers.includes(term) || (!masked(p) && patientName(p).toLowerCase().includes(term));
  }).slice(0, 6);

  if (picked) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{shownName(picked)}</div>
          <div className="text-xs text-muted-foreground">MRN <span className="font-mono">{picked.mrn}</span>{!masked(picked) && ` · Born ${picked.dob}`}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => { onChange(""); setQ(""); }} aria-label="Change the patient">
          <X className="size-4" /> Change
        </Button>
      </div>
    );
  }
  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, MRN, ID number or Health ID"
          className="pl-9"
          aria-label="Search patients"
          aria-invalid={invalid || undefined}
          autoFocus
        />
      </div>
      {term.length >= 2 && (
        <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-border" aria-label="Matching patients">
          {hits.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">No patient file matches. Register the patient first.</li>}
          {hits.map((p) => (
            <li key={p.id} className="border-b border-border/70 last:border-b-0">
              <button type="button" onClick={() => onChange(p.id)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{shownName(p)}</span>
                  <span className="block text-xs text-muted-foreground">MRN <span className="font-mono">{p.mrn}</span>{!masked(p) && ` · Born ${p.dob}`}</span>
                </span>
                <span className="text-xs font-medium text-move">Pick</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Add Appointment: patient, speciality, doctor, date, a free time, visit type and reason. Saved as Booked. */
export function BookingDialog({ open, onClose, now }: { open: boolean; onClose: () => void; now: number }) {
  const today = todayOf(now);
  const [patientId, setPatientId] = React.useState("");
  const [speciality, setSpeciality] = React.useState("");
  const [doctorId, setDoctorId] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [start, setStart] = React.useState("");
  const [visitType, setVisitType] = React.useState<VisitType>("in-person");
  const [reason, setReason] = React.useState("");
  const [tried, setTried] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setPatientId(""); setSpeciality(""); setDoctorId(""); setDate(todayOf()); setStart(""); setVisitType("in-person"); setReason(""); setTried(false);
  }, [open]);

  const input = { patientId, speciality, doctorId, date, start, visitType, reason };
  const problems = tried ? bookingProblems(input, now) : [];
  const has = (re: RegExp) => problems.some((p) => re.test(p));

  function save() {
    setTried(true);
    const res = bookAppointment(input, now);
    if (!res.ok) return;
    pushToast({ tone: "ok", text: "Appointment booked.", detail: `${dayLabel(res.value.date)} at ${res.value.start} with ${doctorName(res.value.doctorId)}. It is on the board as Booked.` });
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="Add Appointment"
      subtitle="Search the patient, pick the doctor and a free time. The appointment is saved as Booked."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>Book Appointment</Button>
        </>
      }
    >
      <div className="grid gap-4">
        <RequiredNote />
        {problems.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            <p className="font-medium">The appointment was not booked:</p>
            <ul className="mt-1 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Patient<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
          <PatientSearch value={patientId} onChange={setPatientId} invalid={has(/patient\.$/)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Speciality" required>
            <Select
              value={speciality}
              aria-invalid={has(/speciality|does not work/) || undefined}
              onChange={(e) => {
                const s = e.target.value;
                setSpeciality(s);
                if (doctorId && specialityOf(doctorId) !== s) { setDoctorId(""); setStart(""); }
                const only = doctorsFor(s);
                if (s && only.length === 1) setDoctorId(only[0].id);
              }}
            >
              <option value="">Choose the speciality</option>
              {SPECIALITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Doctor" required>
            <Select
              value={doctorId}
              aria-invalid={has(/doctor\.$/) || undefined}
              onChange={(e) => {
                setDoctorId(e.target.value);
                setStart("");
                if (e.target.value && !speciality) setSpeciality(specialityOf(e.target.value));
              }}
            >
              <option value="">Choose the doctor</option>
              {doctorsFor(speciality).map((d) => <option key={d.id} value={d.id}>{doctorName(d.id)}</option>)}
            </Select>
          </Field>
          <Field label="Date" required>
            <Input type="date" min={today} value={date} aria-invalid={has(/date/) || undefined} onChange={(e) => { setDate(e.target.value); setStart(""); }} />
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Visit Type<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></legend>
            <div className="grid grid-cols-2 gap-2">
              {(["in-person", "online"] as VisitType[]).map((v) => (
                <label key={v} className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm", visitType === v ? "border-primary bg-accent" : "border-border")}>
                  <input type="radio" name="visit-type" className="size-4 accent-primary" checked={visitType === v} onChange={() => setVisitType(v)} />
                  {VISIT_TYPE_LABEL[v]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Time<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
          <SlotPicker doctorId={doctorId} date={date} value={start} onChange={setStart} now={now} invalid={has(/time|clinic hours|appointment at/)} />
        </div>
        <Field label="Reason For The Visit" required>
          <Input value={reason} maxLength={200} placeholder="For example: knee pain for two weeks" aria-invalid={has(/reason/) || undefined} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
