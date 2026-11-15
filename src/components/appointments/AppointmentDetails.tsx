import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/primitives";
import { STATUS_LABEL, VISIT_TYPE_LABEL, dayLabel, doctorName, linkedVisit, type Appointment } from "@/lib/appointments";
import { navigate } from "@/lib/router";
import { useHis } from "@/lib/store";
import { shownName } from "./BookingDialog";
import { fmtDateTime } from "@/lib/format";

const when = (iso: string) =>
  fmtDateTime(iso);

/** The appointment and its status history, as the HIS History action shows it. */
export function AppointmentDetails({ appt, onClose }: { appt: Appointment | null; onClose: () => void }) {
  const his = useHis();
  if (!appt) return null;
  const patient = his.patients.find((p) => p.id === appt.patientId);
  const visit = linkedVisit(appt);
  const rows: [string, string][] = [
    ["Patient", `${shownName(patient)}${patient ? `, MRN ${patient.mrn}` : ""}`],
    ["When", `${dayLabel(appt.date)}, ${appt.start} to ${appt.end}`],
    ["Doctor", `${doctorName(appt.doctorId)}, ${appt.speciality}`],
    ["Visit Type", VISIT_TYPE_LABEL[appt.visitType]],
    ["Reason", appt.reason],
    ["Status", STATUS_LABEL[appt.status]],
    ["Booked", `${when(appt.bookedAt)} by ${appt.bookedBy}`],
  ];
  if (appt.coverageNote) rows.push(["Coverage At Check-In", `${appt.coverageNote}${appt.payType ? `. Paid as ${appt.payType}.` : ""}`]);
  if (appt.closeReason) rows.push(["Reason For Closing", appt.closeReason]);
  if (appt.rescheduledFrom) rows.push(["Rescheduled From", appt.rescheduledFrom]);
  if (appt.rescheduledTo) rows.push(["Rescheduled To", appt.rescheduledTo]);
  if (appt.cancelledVisit) rows.push(["Cancelled Visit", appt.cancelledVisit]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Appointment ${appt.id}`}
      subtitle="Details and status history"
      footer={
        <>
          {visit && <Button onClick={() => navigate("/chart", { visit: visit.visitNumber })}>Open Chart For {visit.visitNumber}</Button>}
          <Button variant="primary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-4 mb-2 text-sm font-semibold">Status History</h3>
      <ol className="grid gap-2 border-l border-border pl-4">
        {appt.history.map((h, i) => (
          <li key={i} className="relative text-sm">
            <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-move" aria-hidden="true" />
            <span className="font-medium">{STATUS_LABEL[h.status]}</span>
            <span className="text-muted-foreground">, {when(h.at)} by {h.by}</span>
            {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
          </li>
        ))}
      </ol>
    </Dialog>
  );
}
