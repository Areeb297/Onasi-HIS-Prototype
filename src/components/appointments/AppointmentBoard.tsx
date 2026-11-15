import * as React from "react";
import { CalendarClock, CircleAlert, FileText, Monitor, UserRound } from "lucide-react";
import { CardAction, CardFoot, CardSubject, Tag } from "@/components/board/CardBits";
import { ClockPill } from "@/components/board/ClockPill";
import { SwimBoard } from "@/components/board/SwimBoard";
import { ageSex } from "@/components/board/board-util";
import type { BoardLane, BoardStage, BoardTone, CardCtx, ClockSpec, MoveCheck, MoveResult } from "@/components/board/types";
import { useDevMode } from "@/lib/devmode";
import {
  COLUMN_LABEL, STATUS_LABEL, VISIT_TYPE_LABEL, WAIT_TARGET_MIN, callIn, canMoveTo, checkInAppointment, checkOut, columnOf,
  completeAppointment, confirmAppointment, dayLabel, doctorName, linkedVisit, sendToWaiting, specialityOf, visitBlock,
  type Appointment, type ApptColumn, type ApptStatus,
} from "@/lib/appointments";
import { navigate } from "@/lib/router";
import { hasGlass } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { shownName } from "./BookingDialog";

export const APPT_STAGES: (BoardStage & { id: ApptColumn })[] = [
  { id: "booked", label: COLUMN_LABEL.booked, tone: "muted", hint: "Booked, not yet confirmed" },
  { id: "scheduled", label: COLUMN_LABEL.scheduled, tone: "move", hint: "Confirmed by the patient" },
  { id: "checkin", label: COLUMN_LABEL.checkin, tone: "admit", hint: "Visit open: arrived, waiting or with the doctor", target: `Wait target ${WAIT_TARGET_MIN} min` },
  { id: "checkout", label: COLUMN_LABEL.checkout, tone: "ok", hint: "Visit ended, checked out", limit: 4 },
  { id: "cancelled", label: COLUMN_LABEL.cancelled, tone: "cancel", hint: "Cancelled, no show or rescheduled", limit: 4 },
];

const LANE_TONES: BoardTone[] = ["move", "admit", "update", "merge", "ok"];

const STATUS_TONE: Record<ApptStatus, BoardTone> = {
  booked: "muted", confirmed: "move", arrived: "admit", waiting: "merge", "checked-in": "update", "checked-out": "ok", completed: "ok",
  cancelled: "cancel", "no-show": "cancel", rescheduled: "muted",
};

const MOVE_HINT: Record<string, string> = {
  "booked>scheduled": "Status Confirmed. No message.",
  "booked>checkin": "Coverage check, then A04 Register Outpatient opens the visit.",
  "scheduled>checkin": "Coverage check, then A04 Register Outpatient opens the visit.",
  "checkin>checkout": "Status Checked Out. Needs the visit ended (A03).",
  "booked>cancelled": "Cancel or reschedule. No message.",
  "scheduled>cancelled": "Cancel, no show or reschedule. No message.",
  "checkin>cancelled": "Cancel or no show. A11 cancels the visit opened at check-in.",
};

const isMasked = (patientId: string, confidential?: boolean) => !!confidential && !hasGlass(patientId);

function ApptCard({ a, ctx, allowed, multiDay, onDetails, onRefresh }: {
  a: Appointment; ctx: CardCtx; allowed: boolean; multiDay: boolean; onDetails: () => void; onRefresh: (msg?: string) => void;
}) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === a.patientId);
  const masked = patient ? isMasked(patient.id, patient.confidential) : false;
  const visit = linkedVisit(a);
  const ended = visit?.status === "discharged";
  const waitClock = (a.status === "arrived" || a.status === "waiting") && !ctx.overlay;
  const reason = "Your role cannot work on appointments. It needs the patient.register permission.";

  const run = (fn: () => { ok: boolean; errors?: string[] }, done: string) => {
    const res = fn();
    if (!res.ok) pushToast({ tone: "warn", text: res.errors?.join(" ") ?? "That did not work." });
    else onRefresh(done);
  };

  let action: React.ReactNode = null;
  if (!ctx.overlay) {
    const btn = (label: string, onClick: () => void, variant: "primary" | "secondary" = "primary") => (
      <CardAction key={label} label={label} allowed={allowed} reason={reason} variant={variant} onClick={onClick} />
    );
    const chart = () => visit && navigate("/chart", { visit: visit.visitNumber });
    switch (a.status) {
      case "booked": action = btn("Confirm", () => ctx.move("scheduled")); break;
      case "confirmed": action = btn("Check In", () => ctx.move("checkin")); break;
      case "arrived":
        action = <>{btn("To Waiting Area", () => run(() => sendToWaiting(a.id), "Sent to the waiting area."), "secondary")}{btn("Call In", () => run(() => callIn(a.id), "Called in. The visit is checked in on the OPD worklist."))}</>;
        break;
      case "waiting": action = btn("Call In", () => run(() => callIn(a.id), "Called in. The visit is checked in on the OPD worklist.")); break;
      case "checked-in":
        action = ended ? btn("Check Out", () => ctx.move("checkout")) : visit && visit.status === "active"
          ? <CardAction label="Open Chart" allowed reason="" variant="secondary" onClick={chart} icon={<FileText className="size-3.5" aria-hidden="true" />} />
          : null;
        break;
      case "checked-out": action = btn("Mark Completed", () => run(() => completeAppointment(a.id), "Appointment completed.")); break;
      default: action = null;
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums">
          <CalendarClock className="size-3.5 text-muted-foreground" aria-hidden="true" />
          {multiDay && <span className="font-medium text-muted-foreground">{dayLabel(a.date)},</span>}
          {a.start} to {a.end}
        </span>
        <Tag tone={a.visitType === "online" ? "merge" : "muted"} icon={a.visitType === "online" ? <Monitor className="size-3" aria-hidden="true" /> : <UserRound className="size-3" aria-hidden="true" />}>
          {VISIT_TYPE_LABEL[a.visitType]}
        </Tag>
      </div>

      <div className="mt-1.5 min-w-0">
        {ctx.overlay ? (
          <div className="truncate text-sm font-semibold">{shownName(patient)}</div>
        ) : (
          <button type="button" onClick={onDetails} className="block max-w-full truncate text-left text-sm font-semibold text-move hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {shownName(patient)}
          </button>
        )}
        <div className="truncate text-xs text-foreground/80">
          {patient ? <>MRN <span className="font-mono">{patient.mrn}</span>{!masked && ` · ${ageSex(patient, ctx.now)}`}</> : "Patient not found"}
        </div>
        <div className="truncate text-xs text-muted-foreground">{a.speciality}</div>
        {ctx.dev && <div className="truncate font-mono text-xs text-muted-foreground">{a.id}{a.visitNumber ? ` · ${a.visitNumber}` : ""}</div>}
      </div>
      <CardSubject>{a.reason}</CardSubject>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tag tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Tag>
        {visit && !ctx.overlay && (
          <button
            type="button"
            onClick={() => navigate("/chart", { visit: visit.visitNumber })}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-move underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            title="Open the chart"
          >
            <FileText className="size-3" aria-hidden="true" />
            Visit <span className="font-mono">{visit.visitNumber}</span>
            {visit.status === "discharged" && <span className="text-muted-foreground">, ended</span>}
            {visit.status === "cancelled" && <span className="text-destructive">, cancelled</span>}
          </button>
        )}
        {a.payType && columnOf(a.status) === "checkin" && <Tag tone={a.payType === "Cash" ? "muted" : "ok"}>{a.payType}</Tag>}
      </div>
      {a.closeReason && columnOf(a.status) === "cancelled" && <p className="mt-1 text-xs text-muted-foreground">Reason: {a.closeReason}</p>}
      {a.rescheduledTo && <p className="mt-0.5 text-xs text-muted-foreground">New appointment {a.rescheduledTo}.</p>}
      {a.cancelledVisit && columnOf(a.status) === "cancelled" && <p className="mt-0.5 text-xs text-muted-foreground">Visit {a.cancelledVisit} was cancelled with it.</p>}
      {a.status === "checked-in" && visit?.status === "active" && !ctx.overlay && (
        <p className="mt-1 text-xs text-muted-foreground">Check-out is offered when the doctor ends the visit.</p>
      )}
      {a.problem && !ctx.overlay && (
        <p role="alert" className="mt-2 flex gap-1.5 rounded-md bg-destructive/8 px-2 py-1.5 text-xs text-destructive">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{a.problem}</span>
        </p>
      )}

      {(waitClock || action) && (
        <CardFoot>
          <div>{waitClock && <ClockPill since={a.statusAt} targetMin={WAIT_TARGET_MIN} now={ctx.now} />}</div>
          {action && <div className="flex flex-wrap gap-1.5">{action}</div>}
        </CardFoot>
      )}
    </div>
  );
}

/**
 * The appointment board: one lane per doctor, five columns as in the HIS. Every move goes through canMoveTo,
 * by drag or by the Move menu on the card. Check-in and the Cancelled column open a dialog first.
 */
export function AppointmentBoard({
  appointments, allowed, multiDay, onCheckIn, onClose, onDetails,
}: {
  appointments: Appointment[];
  allowed: boolean;
  multiDay: boolean;
  onCheckIn: (id: string) => void;
  onClose: (id: string) => void;
  onDetails: (id: string) => void;
}) {
  const his = useHis();
  const dev = useDevMode();
  const nameOf = (a: Appointment) => shownName(his.patients.find((p) => p.id === a.patientId));

  const lanes: BoardLane[] = React.useMemo(() => {
    const ids = [...new Set(appointments.map((a) => a.doctorId))].sort();
    return ids.map((id, i) => ({ id, label: doctorName(id), tone: LANE_TONES[i % LANE_TONES.length], hint: specialityOf(id) }));
  }, [appointments]);

  function onMove(a: Appointment, _from: string, to: string): MoveResult {
    const col = to as ApptColumn;
    if (col === "scheduled") {
      const res = confirmAppointment(a.id);
      if (!res.ok) pushToast({ tone: "warn", text: res.errors.join(" ") });
      return res.ok;
    }
    if (col === "checkin") {
      // A visit that cannot open is refused here, and the card keeps the reason.
      if (visitBlock(a.patientId)) {
        const res = checkInAppointment(a.id);
        if (!res.ok) pushToast({ tone: "danger", text: "Not checked in. No visit was opened.", detail: res.errors.join(" ") });
        return false;
      }
      onCheckIn(a.id);
      return "deferred";
    }
    if (col === "checkout") {
      const res = checkOut(a.id);
      if (!res.ok) pushToast({ tone: "warn", text: res.errors.join(" ") });
      return res.ok;
    }
    if (col === "cancelled") {
      onClose(a.id);
      return "deferred";
    }
    return false;
  }

  const canDrag = (): MoveCheck => (allowed ? { ok: true } : { ok: false, reason: "Your role cannot move appointments. It needs the patient.register permission." });
  const clockOf = (a: Appointment, stage: string): ClockSpec | null =>
    stage === "checkin" && (a.status === "arrived" || a.status === "waiting") ? { since: a.statusAt, targetMin: WAIT_TARGET_MIN } : null;

  return (
    <SwimBoard<Appointment>
      ariaLabel="Appointment board"
      laneHeading="Doctor"
      storageKey="appointments"
      lanes={lanes}
      stages={APPT_STAGES}
      cards={appointments}
      getId={(a) => a.id}
      label={(a) => `${nameOf(a)}, ${a.start} with ${doctorName(a.doctorId)}`}
      laneOf={(a) => a.doctorId}
      stageOf={(a) => columnOf(a.status)}
      renderCard={(a, ctx) => (
        <ApptCard
          a={a}
          ctx={ctx}
          allowed={allowed}
          multiDay={multiDay}
          onDetails={() => onDetails(a.id)}
          onRefresh={(msg) => msg && pushToast({ tone: "ok", text: msg })}
        />
      )}
      canMove={(a, _from, to) => canMoveTo(a, to as ApptColumn, Date.now())}
      canDrag={canDrag}
      onMove={onMove}
      clockOf={clockOf}
      moveHint={(_a, from, to) => MOVE_HINT[`${from}>${to}`]}
      dev={dev}
    />
  );
}

