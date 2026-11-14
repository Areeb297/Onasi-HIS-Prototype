import * as React from "react";
import { CalendarPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select, Table, Td, Th } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import {
  CLINICS, FOLLOW_UP_LABEL, VISIT_TYPE_LABEL, bookFollowUp, cancelFollowUp, completeFollowUp, followUpTarget, followUpTitle, followUpsOf, orderFollowUp,
  useCareRequests, type FollowUp, type FollowUpStatus, type VisitType,
} from "@/lib/care-requests";
import type { Encounter } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import { nowLocal } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** The chart "Follow-Up" tab: the doctor orders a return visit; the appointments desk books it. */

const TONE: Record<FollowUpStatus, "warn" | "info" | "ok" | "neutral"> = { requested: "warn", booked: "info", done: "ok", cancelled: "neutral" };
const dateTime = (t: string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const doctorName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "Any doctor in the clinic";
};

export function FollowUpSection({ enc }: { enc: Encounter }) {
  const s = useCareRequests();
  const { role } = useSession();
  const list = followUpsOf(enc.visitNumber, s);
  const canOrder = can("emr.write") && (role.id === "physician" || role.id === "admin");
  const canBook = can("emr.write") || can("patient.register");
  const [adding, setAdding] = React.useState(false);
  const [booking, setBooking] = React.useState<FollowUp | null>(null);
  const [cancelling, setCancelling] = React.useState<FollowUp | null>(null);
  const [when, setWhen] = React.useState("");
  const [why, setWhy] = React.useState("");
  const [error, setError] = React.useState("");

  const closeDialogs = () => { setBooking(null); setCancelling(null); setWhen(""); setWhy(""); setError(""); };

  function book() {
    if (!booking) return;
    const res = bookFollowUp(booking.id, when);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "ok", text: "Follow-up booked", detail: `${res.value.clinic}, ${dateTime(when)}.` });
    closeDialogs();
  }
  function cancel() {
    if (!cancelling) return;
    const res = cancelFollowUp(cancelling.id, why);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "warn", text: "Follow-up cancelled" });
    closeDialogs();
  }

  return (
    <Card>
      <CardHeader
        title="Follow-Up"
        subtitle="Order a return visit. It goes to the appointments desk as a booking request."
        right={
          <span title={canOrder ? undefined : "Only a doctor can order a follow-up"}>
            <Button variant="primary" disabled={!canOrder || adding} onClick={() => setAdding(true)}><CalendarPlus className="size-4" aria-hidden="true" /> New Follow-Up</Button>
          </span>
        }
      />
      {adding && <FollowUpForm enc={enc} onClose={() => setAdding(false)} />}
      {list.length === 0 ? (
        <Empty>{canOrder ? "No follow-up ordered for this visit. Choose New Follow-Up to ask for a return visit." : "No follow-up ordered for this visit. The doctor orders it here."}</Empty>
      ) : (
        <Table>
          <thead><tr><Th>Status</Th><Th>Follow-Up</Th><Th>Clinic And Doctor</Th><Th>Ordered By</Th><Th>Booking</Th><Th>Actions</Th></tr></thead>
          <tbody>
            {list.map((f) => (
              <tr key={f.id}>
                <Td><Badge tone={TONE[f.status]}>{FOLLOW_UP_LABEL[f.status]}</Badge></Td>
                <Td className="max-w-[20rem]">
                  <div className="font-medium">{followUpTitle(f)}</div>
                  <div className="text-xs text-muted-foreground">{VISIT_TYPE_LABEL[f.visitType]} · see by {dateOnly(f.targetDate)}</div>
                  {f.instructions && <div className="mt-1 text-xs">For the patient: {f.instructions}</div>}
                </Td>
                <Td><div>{f.clinic}</div><div className="text-xs text-muted-foreground">{doctorName(f.doctorId)}</div></Td>
                <Td><div>{f.orderedBy}</div><div className="text-xs text-muted-foreground">{dateTime(f.orderedAt)}</div></Td>
                <Td className="text-xs">
                  {f.status === "requested" && <span className="font-medium text-warn">Waiting for the appointments desk</span>}
                  {f.bookedFor && <div><span className="font-medium">{dateTime(f.bookedFor)}</span><div className="text-muted-foreground">Booked by {f.bookedBy}, {dateTime(f.bookedAt ?? f.bookedFor)}</div></div>}
                  {f.status === "done" && <div className="text-muted-foreground">Marked done by {f.doneBy}{f.doneAt ? `, ${dateTime(f.doneAt)}` : ""}</div>}
                  {f.status === "cancelled" && <div className="text-muted-foreground">Cancelled by {f.cancelledBy}{f.cancelledAt ? `, ${dateTime(f.cancelledAt)}` : ""}: {f.cancelReason}</div>}
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {(f.status === "requested" || f.status === "booked") && (
                      <Button size="sm" variant={f.status === "requested" ? "primary" : "secondary"} disabled={!canBook} onClick={() => { setBooking(f); setWhen(f.bookedFor ?? `${f.targetDate}T09:00`); }}>
                        {f.status === "requested" ? "Mark Booked" : "Change Date"}
                      </Button>
                    )}
                    {f.status === "booked" && <Button size="sm" disabled={!canBook} onClick={() => { if (completeFollowUp(f.id).ok) pushToast({ tone: "ok", text: "Follow-up marked done" }); }}>Mark Done</Button>}
                    {(f.status === "requested" || f.status === "booked") && <Button size="sm" variant="danger" disabled={!canBook} onClick={() => setCancelling(f)}>Cancel Follow-Up</Button>}
                    {(f.status === "done" || f.status === "cancelled") && <span className="text-xs text-muted-foreground">No actions</span>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={!!booking}
        onClose={closeDialogs}
        title="Mark Follow-Up As Booked"
        subtitle={booking ? `${followUpTitle(booking)}, ${booking.clinic}` : undefined}
        footer={<><Button onClick={closeDialogs}>Not Now</Button><Button variant="primary" onClick={book}>Save Booking</Button></>}
      >
        {booking && (
          <div className="space-y-3">
            <p className="text-sm">The doctor asked for a visit by {dateOnly(booking.targetDate)}.</p>
            <Field label="Appointment Date And Time" required>
              <Input type="datetime-local" value={when} min={nowLocal()} onChange={(e) => { setWhen(e.target.value); setError(""); }} />
            </Field>
            {error && <p role="alert" className="text-[0.8125rem] text-destructive">{error}</p>}
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!cancelling}
        onClose={closeDialogs}
        title="Cancel Follow-Up"
        subtitle={cancelling ? `${followUpTitle(cancelling)}, ${cancelling.clinic}` : undefined}
        footer={<><Button onClick={closeDialogs}>Keep The Follow-Up</Button><Button variant="danger" onClick={cancel}>Cancel Follow-Up</Button></>}
      >
        <div className="space-y-3">
          <Field label="Reason" required>
            <Input value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} placeholder="For example: patient will follow up elsewhere" />
          </Field>
          {error && <p role="alert" className="text-[0.8125rem] text-destructive">{error}</p>}
        </div>
      </Dialog>
    </Card>
  );
}

function FollowUpForm({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const [amount, setAmount] = React.useState("2");
  const [unit, setUnit] = React.useState<"days" | "weeks">("weeks");
  const [clinic, setClinic] = React.useState("");
  const [doctorId, setDoctorId] = React.useState(enc.attending);
  const [visitType, setVisitType] = React.useState<VisitType>("in-person");
  const [instructions, setInstructions] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const n = Number(amount);
  const valid = Number.isInteger(n) && n >= 1;

  function save() {
    const res = orderFollowUp({ visit: enc.visitNumber, amount: n, unit, clinic, doctorId, visitType, instructions });
    if (!res.ok) { setErrors(res.errors); return; }
    pushToast({ tone: "ok", text: `${followUpTitle(res.value)} ordered`, detail: `Booking request sent to ${res.value.clinic}.` });
    onClose();
  }

  return (
    <div className="border-b border-border bg-muted/30 px-4 py-4" role="region" aria-label="New follow-up">
      <h3 className="text-[0.9375rem] font-semibold">New Follow-Up</h3>
      <RequiredNote className="mt-0.5" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Follow Up In" required hint={valid ? `See by ${dateOnly(followUpTarget(n, unit))}.` : "Enter a whole number, 1 or more."}>
          <Input type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Days Or Weeks" required>
          <Select value={unit} onChange={(e) => setUnit(e.target.value as "days" | "weeks")}>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
          </Select>
        </Field>
        <Field label="Clinic" required>
          <Select value={clinic} onChange={(e) => setClinic(e.target.value)}>
            <option value="">Choose a clinic</option>
            {CLINICS.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Doctor">
          <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">Any doctor in the clinic</option>
            {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
          </Select>
        </Field>
        <Field label="Visit Type" required>
          <Select value={visitType} onChange={(e) => setVisitType(e.target.value as VisitType)}>
            {(Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((v) => <option key={v} value={v}>{VISIT_TYPE_LABEL[v]}</option>)}
          </Select>
        </Field>
        <Field label="Instructions For The Patient" className="sm:col-span-2 lg:col-span-3" hint="The patient sees this text with the appointment.">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} className="bg-card" placeholder="For example: come fasting, bring your blood sugar diary" />
        </Field>
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save}>Order Follow-Up</Button>
        <Button onClick={onClose}>Close Without Saving</Button>
      </div>
    </div>
  );
}
