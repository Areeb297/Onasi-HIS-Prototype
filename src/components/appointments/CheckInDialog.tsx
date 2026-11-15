import * as React from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import {
  VISIT_TYPE_LABEL, checkInAppointment, coverageFor, dayLabel, doctorName, targetStatus, STATUS_LABEL, type Appointment,
} from "@/lib/appointments";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { shownName } from "./BookingDialog";

/**
 * Check-in at the desk. Coverage is checked before the visit opens, with the same eligibility check and plain-word
 * answer as the registration form. A patient who is not covered goes on only when the clerk chooses Continue As Cash
 * Patient. The visit opens with A04, so the national message and the OPD worklist follow.
 */
export function CheckInDialog({ appt, onClose, now }: { appt: Appointment | null; onClose: () => void; now: number }) {
  const his = useHis();
  const [fixNote, setFixNote] = React.useState(false);
  React.useEffect(() => setFixNote(false), [appt?.id]);
  // Ask the payer once per dialog, not on every render.
  const cover = React.useMemo(() => (appt ? coverageFor(appt.patientId, now) : null), [appt?.id]);
  if (!appt || !cover) return null;

  const patient = his.patients.find((p) => p.id === appt.patientId);
  const to = targetStatus(appt, "checkin");
  const { outcome, card, stops } = cover;
  const tone = outcome.kind === "covered" ? "ok" : outcome.warning || (!stops && outcome.kind === "no-insurance") ? "warn" : "danger";
  const Icon = tone === "ok" ? ShieldCheck : tone === "warn" ? ShieldQuestion : ShieldAlert;

  function go(cash: boolean) {
    const res = checkInAppointment(appt!.id, { cash }, now);
    if (res.ok) {
      pushToast({
        tone: "ok",
        text: `${shownName(patient)} checked in.`,
        detail: `Visit ${res.visitNumber} is open on the OPD worklist. Paid as ${res.value.payType}.`,
      });
    } else if (!res.needsCashChoice) {
      pushToast({ tone: "danger", text: "Not checked in.", detail: res.errors.join(" ") });
    }
    onClose();
  }

  function fix() {
    audit("update", "Coverage decision at check-in", { patient: patientName(patient), detail: `${outcome.title}. Clerk chose Fix Coverage. No visit was opened. Appointment ${appt!.id}.` });
    setFixNote(true);
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Check In"
      subtitle={`${shownName(patient)}, ${dayLabel(appt.date)} at ${appt.start} with ${doctorName(appt.doctorId)}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {stops ? (
            <>
              <Button onClick={fix} disabled={fixNote}>Fix Coverage</Button>
              <Button variant="primary" onClick={() => go(true)}>Continue As Cash Patient</Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => go(false)}>Check In And Open Visit</Button>
          )}
        </>
      }
    >
      <div className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Visit Type</dt><dd>{VISIT_TYPE_LABEL[appt.visitType]}</dd>
          <dt className="text-muted-foreground">Reason</dt><dd>{appt.reason}</dd>
          <dt className="text-muted-foreground">After Check-In</dt><dd>{to ? STATUS_LABEL[to] : "Not allowed"}{appt.visitType === "online" && ", the visit starts at once"}</dd>
        </dl>

        <section
          aria-label="Coverage answer"
          className={cn(
            "rounded-lg border px-3 py-2.5",
            tone === "ok" && "border-ok/40 bg-ok/8",
            tone === "warn" && "border-warn/40 bg-warn/10",
            tone === "danger" && "border-destructive/40 bg-destructive/8",
          )}
        >
          <div className="flex items-start gap-2">
            <Icon className={cn("mt-0.5 size-5 shrink-0", tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-destructive")} aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">Coverage: {outcome.title}</p>
              <p className="mt-0.5">{outcome.text}</p>
              {card && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.payer}, {card.className}, {card.network}. Policy {card.policyNo}, member {card.memberId}. Valid {card.startDate} to {card.expiryDate}.
                </p>
              )}
              {!stops && outcome.kind === "no-insurance" && <p className="mt-1 font-medium">The patient is a cash patient. The visit opens as cash.</p>}
              {stops && <p className="mt-1 font-medium">The visit cannot open as an insurance visit. Continue as a cash patient, or fix the coverage first.</p>}
            </div>
          </div>
        </section>

        {fixNote && (
          <p role="status" className="rounded-lg bg-muted px-3 py-2">
            No visit was opened and the appointment stays where it is. Ask the patient for a valid card or call the payer, then check in again.
          </p>
        )}
        <p className="text-xs text-muted-foreground">Checking in opens an outpatient visit and sends the registration message (A04). The visit number then shows on the card.</p>
      </div>
    </Dialog>
  );
}
