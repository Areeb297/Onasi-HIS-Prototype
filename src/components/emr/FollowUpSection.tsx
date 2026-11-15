import * as React from "react";
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, CheckCircle2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { EmptyState, EntryList, EntryRow, EntrySheet, ErrorSummary, FormField, FormGrid, RowMenu, Segmented, TextArea, useValidation } from "@/components/emr/entry-ui";
import { Badge, Button, Card, CardHeader, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime, fmtWeekday } from "@/lib/format";
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
const dateTime = (t: string) => fmtDateTime(t);
const dateOnly = (ymd: string) => `${fmtWeekday(`${ymd}T00:00`)}, ${fmtDate(`${ymd}T00:00`)}`;
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
  const startBooking = (f: FollowUp) => { setBooking(f); setWhen(f.bookedFor ?? `${f.targetDate}T09:00`); setError(""); };

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

  const addButton = (
    <span title={canOrder ? undefined : "Only a doctor can order a follow-up"}>
      <Button size="sm" variant="primary" disabled={!canOrder} onClick={() => setAdding(true)}><CalendarPlus className="size-4" aria-hidden="true" /> New Follow-Up</Button>
    </span>
  );

  return (
    <Card>
      <CardHeader
        title="Follow-Up"
        subtitle="Order a return visit. It goes to the appointments desk as a booking request."
        right={list.length > 0 ? addButton : undefined}
      />
      {list.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="No Follow-Up Ordered" action={canOrder ? addButton : undefined}>
          {canOrder ? "Order a return visit and the appointments desk will book it." : "The doctor orders a return visit here."}
        </EmptyState>
      ) : (
        <EntryList label="Follow-ups">
          {list.map((f) => {
            const open = f.status === "requested" || f.status === "booked";
            return (
              <EntryRow
                key={f.id}
                title={followUpTitle(f)}
                badges={<Badge tone={TONE[f.status]}>{FOLLOW_UP_LABEL[f.status]}</Badge>}
                muted={f.status === "cancelled"}
                meta={[
                  ["See By", dateOnly(f.targetDate)],
                  ["Visit", VISIT_TYPE_LABEL[f.visitType]],
                  ["Clinic", f.clinic],
                  ["Doctor", doctorName(f.doctorId)],
                  ["Ordered By", `${f.orderedBy}, ${dateTime(f.orderedAt)}`],
                ]}
                right={open ? (
                  <>
                    {f.status === "requested" && <Button size="sm" variant="primary" disabled={!canBook} onClick={() => startBooking(f)}><CalendarCheck className="size-4" aria-hidden="true" /> Mark Booked</Button>}
                    {f.status === "booked" && (
                      <Button size="sm" variant="primary" disabled={!canBook} onClick={() => { if (completeFollowUp(f.id).ok) pushToast({ tone: "ok", text: "Follow-up marked done" }); }}>
                        <CheckCircle2 className="size-4" aria-hidden="true" /> Mark Done
                      </Button>
                    )}
                    {canBook && (
                      <RowMenu
                        label={`More actions for ${followUpTitle(f)}`}
                        items={[
                          f.status === "booked" && { label: "Change Date", icon: <CalendarClock className="size-4" />, onSelect: () => startBooking(f) },
                          { label: "Cancel Follow-Up", icon: <CalendarX className="size-4" />, onSelect: () => { setCancelling(f); setError(""); }, danger: true },
                        ]}
                      />
                    )}
                  </>
                ) : undefined}
              >
                {f.instructions && <p className="mt-1 text-xs"><span className="text-muted-foreground">For the patient: </span>{f.instructions}</p>}
                <p className="mt-1 text-xs">
                  {f.status === "requested" && <span className="font-medium text-warn">Waiting for the appointments desk</span>}
                  {f.bookedFor && <><span className="font-medium">Booked for {dateTime(f.bookedFor)}</span><span className="text-muted-foreground"> by {f.bookedBy}, {dateTime(f.bookedAt ?? f.bookedFor)}. </span></>}
                  {f.status === "done" && <span className="text-muted-foreground">Marked done by {f.doneBy}{f.doneAt ? `, ${dateTime(f.doneAt)}` : ""}.</span>}
                  {f.status === "cancelled" && <span className="text-muted-foreground">Cancelled by {f.cancelledBy}{f.cancelledAt ? `, ${dateTime(f.cancelledAt)}` : ""}: {f.cancelReason}</span>}
                </p>
              </EntryRow>
            );
          })}
        </EntryList>
      )}

      {adding && <FollowUpForm enc={enc} onClose={() => setAdding(false)} />}

      <Dialog
        open={!!booking}
        onClose={closeDialogs}
        title={booking?.status === "booked" ? "Change Appointment Date" : "Mark Follow-Up As Booked"}
        subtitle={booking ? `${followUpTitle(booking)}, ${booking.clinic}` : undefined}
        footer={<><Button onClick={closeDialogs}>Not Now</Button><Button variant="primary" onClick={book}>Save Booking</Button></>}
      >
        {booking && (
          <FormField label="Appointment Date And Time" required error={error || undefined} help={`The doctor asked for a visit by ${dateOnly(booking.targetDate)}.`}>
            <Input type="datetime-local" value={when} min={nowLocal()} onChange={(e) => { setWhen(e.target.value); setError(""); }} />
          </FormField>
        )}
      </Dialog>
      <Dialog
        open={!!cancelling}
        onClose={closeDialogs}
        title="Cancel Follow-Up"
        subtitle={cancelling ? `${followUpTitle(cancelling)}, ${cancelling.clinic}` : undefined}
        footer={<><Button onClick={closeDialogs}>Keep The Follow-Up</Button><Button variant="danger" onClick={cancel}>Cancel Follow-Up</Button></>}
      >
        <FormField label="Reason" required error={error || undefined}>
          <Input value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} placeholder="For example: patient will follow up elsewhere" />
        </FormField>
      </Dialog>
    </Card>
  );
}

const UNIT_OPTIONS = [{ value: "days" as const, label: "Days" }, { value: "weeks" as const, label: "Weeks" }];
const VISIT_OPTIONS = (Object.keys(VISIT_TYPE_LABEL) as VisitType[]).map((v) => ({ value: v, label: VISIT_TYPE_LABEL[v] }));

function FollowUpForm({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const [amount, setAmount] = React.useState("2");
  const [unit, setUnit] = React.useState<"days" | "weeks">("weeks");
  const [clinic, setClinic] = React.useState("");
  const [doctorId, setDoctorId] = React.useState(enc.attending);
  const [visitType, setVisitType] = React.useState<VisitType>("in-person");
  const [instructions, setInstructions] = React.useState("");
  const [failed, setFailed] = React.useState<string[]>([]);
  const n = Number(amount);
  const valid = amount.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= 365;
  const v = useValidation({
    amount: !valid && "Enter a whole number, 1 to 365.",
    clinic: !clinic && "Choose the clinic.",
  });
  const dirty = amount !== "2" || unit !== "weeks" || !!clinic || doctorId !== enc.attending || visitType !== "in-person" || !!instructions.trim();

  function save() {
    if (!v.submit()) return;
    const res = orderFollowUp({ visit: enc.visitNumber, amount: n, unit, clinic, doctorId, visitType, instructions });
    if (!res.ok) { setFailed(res.errors); return; }
    pushToast({ tone: "ok", text: `${followUpTitle(res.value)} ordered`, detail: `Booking request sent to ${res.value.clinic}.` });
    onClose();
  }

  return (
    <EntrySheet
      onClose={onClose}
      title="New Follow-Up"
      subtitle="The appointments desk books the visit."
      dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Order Follow-Up</Button></>}
    >
      <div className="space-y-4">
        <RequiredNote />
        <ErrorSummary problems={failed.length ? failed : v.summary} />
        <FormField label="Follow Up In" required group error={v.error("amount")} help={valid ? `See by ${dateOnly(followUpTarget(n, unit))}.` : undefined}>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-24" type="number" inputMode="numeric" min={1} max={365} step={1} value={amount} aria-label="Number of days or weeks"
              aria-invalid={v.error("amount") ? true : undefined}
              onChange={(e) => { setAmount(e.target.value); setFailed([]); }} onBlur={v.blur("amount")}
            />
            <Segmented label="Days or weeks" value={unit} options={UNIT_OPTIONS} onChange={setUnit} />
          </div>
        </FormField>
        <FormGrid>
          <FormField label="Clinic" required error={v.error("clinic")}>
            <Select value={clinic} onChange={(e) => { setClinic(e.target.value); setFailed([]); }} onBlur={v.blur("clinic")}>
              <option value="">Choose A Clinic</option>
              {CLINICS.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </FormField>
          <FormField label="Doctor">
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Any Doctor In The Clinic</option>
              {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Visit Type" required group>
          <Segmented value={visitType} options={VISIT_OPTIONS} onChange={setVisitType} />
        </FormField>
        <FormField label="Instructions For The Patient" help="The patient sees this text with the appointment.">
          <TextArea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: come fasting, bring your blood sugar diary" />
        </FormField>
      </div>
    </EntrySheet>
  );
}
