import { IconAlertTriangle, IconClock, IconFlask, IconHourglass } from "@tabler/icons-react";
import * as React from "react";
import { useDevMode } from "@/lib/devmode";
import type { LabOrder } from "@/lib/fhir/types";
import { awaitingVerification, hasCritical, startProcessing } from "@/lib/lab";
import { receiveSample } from "@/lib/lab-extras";
import { personFromDoctor } from "@/lib/fhir/people";
import { coverageLabel } from "@/lib/order-fields";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { auditMove } from "./audit-move";
import { byPriorityThenAge } from "./board-util";
import { CheckCircle2, Printer } from "lucide-react";
import { CardAction, CardFoot, CardSubject, PriorityTag, ProgressRing, Tag } from "./CardBits";
import { OrderCardPatient } from "./OrderCardPatient";
import { ClockPill } from "./ClockPill";
import { CriticalPulse, TubeIcon } from "./glyphs";
import {
  LAB_LANES, LAB_MOVE_HINT, LAB_STAGES, labCanMove, labClock, labLaneOf, labStageOf, labStats, resultProgress, stageLabelOf,
  testChips, tubesForOrder, type LabStageId,
} from "./lab-board";
import { StatStrip } from "./StatStrip";
import { SwimBoard } from "./SwimBoard";
import { fmtDuration } from "./clock";
import type { CardCtx, MoveCheck, MoveResult } from "./types";

const NEXT_ACTION: Record<LabStageId, { label: string; to?: LabStageId }> = {
  ordered: { label: "Collect Specimen", to: "collected" },
  collected: { label: "Receive Sample", to: "received" },
  received: { label: "Start Processing", to: "in-progress" },
  "in-progress": { label: "Enter Results", to: "entered" },
  entered: { label: "Send For Verification", to: "verification" },
  verification: { label: "Verify Result", to: "published" },
  published: { label: "View Or Amend" },
};

function LabCard({ order, ctx, onOpen, onLabels, allowed }: { order: LabOrder; ctx: CardCtx; onOpen: () => void; onLabels: () => void; allowed: boolean }) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === order.patientId);
  const stage = ctx.stage.id as LabStageId;
  const clock = labClock(order, stage);
  const prog = resultProgress(order);
  const tubes = tubesForOrder(order);
  const chips = testChips(order);
  const waiting = awaitingVerification(order);
  const next = NEXT_ACTION[stage];
  const hasTubes = order.specimens.length > 0 && stage !== "published";
  const insured = order.coverage === "plan" ? "Insured" : order.coverage === "self-pay" ? "Self-Pay" : "";
  const critical = hasCritical(order);
  const filled = stage !== "ordered";
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityTag tone={ctx.lane.tone} label={PRIORITY_WORD[ctx.lane.id] ?? ctx.lane.label} />
          {order.fasting === true && <Tag tone="merge">Fasting</Tag>}
          {insured && <Tag tone={order.coverage === "plan" ? "ok" : "muted"} title={coverageLabel(order.coverage)}>{insured}</Tag>}
          {critical && <CriticalPulse />}
          {waiting && <Tag tone="update">Awaiting Verification</Tag>}
          {!waiting && order.sentBack && order.status === "in-progress" && <Tag tone="merge">Sent Back</Tag>}
        </div>
        <div className="flex items-end gap-1" aria-label={`${tubes.length} ${tubes.length === 1 ? "container" : "containers"}`}>
          {tubes.slice(0, 3).map((k) => <TubeIcon key={k} kind={k} filled={filled} />)}
        </div>
      </div>

      <div className="mt-1.5">
        <OrderCardPatient patient={patient} orderedAt={order.orderedAt} onOpen={ctx.overlay ? undefined : onOpen} now={ctx.now} devExtra={ctx.dev ? `${order.id} · Visit ${order.visitNumber}` : undefined} />
      </div>
      <CardSubject>{chips.slice(0, 4).join(", ")}{chips.length > 4 && ` and ${chips.length - 4} more`}</CardSubject>
      <p className="mt-0.5 text-xs text-muted-foreground">Ordered by {personFromDoctor(order.orderedById).name}</p>

      <CardFoot>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {clock ? (
            <ClockPill since={clock.since} targetMin={clock.targetMin} now={ctx.now} />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Result released</span>
          )}
          {stage === "in-progress" && <ProgressRing done={prog.done} total={prog.total} label="results" />}
        </div>
        {!ctx.overlay && (
          <div className="flex items-center gap-1.5">
            {hasTubes && (
              <button
                type="button"
                onClick={onLabels}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                title="Print the barcode labels for this sample"
              >
                <Printer className="size-3.5" aria-hidden="true" />Labels
              </button>
            )}
          <CardAction
            label={next.label}
            allowed={allowed}
            reason="Your role cannot work on laboratory orders."
            variant={stage === "published" ? "secondary" : "primary"}
            onClick={() => (next.to ? ctx.move(next.to) : onOpen())}
          />
          </div>
        )}
      </CardFoot>
    </div>
  );
}

const PRIORITY_WORD: Record<string, string> = { stat: "STAT", urgent: "Urgent", routine: "Routine" };

/**
 * The laboratory swim lane board. Lanes are priorities, stages follow the real order status.
 * onCollect, onOpenEditor and onVerify belong to the page: it owns the Collect dialog, the result editor and the
 * verification sign-off.
 */
export function LabBoard({
  orders, onCollect, onOpenEditor, onVerify, onOpen, onLabels,
}: {
  orders: LabOrder[];
  onLabels: (id: string) => void;
  onCollect: (id: string) => void;
  onOpenEditor: (id: string, hint: string) => void;
  onVerify: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const his = useHis();
  const dev = useDevMode();
  const allowed = can("lab.result");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cards = React.useMemo(
    () => orders.filter((o) => labStageOf(o)).sort(byPriorityThenAge((o: LabOrder) => o.priority, (o) => o.orderedAt)),
    [orders],
  );
  const stats = labStats(orders, now);
  const nameOf = (o: LabOrder) => patientName(his.patients.find((p) => p.id === o.patientId));

  function onMove(o: LabOrder, _from: string, to: string): MoveResult {
    if (to === "collected") {
      onCollect(o.id);
      return "deferred";
    }
    if (to === "received") return receiveSample(o);
    if (to === "in-progress") return startProcessing(o.id);
    if (to === "entered") {
      onOpenEditor(o.id, "Enter every result. The card moves to Results Entered when all of them are filled.");
      return "deferred";
    }
    if (to === "verification") {
      onOpenEditor(o.id, "Check the results, then press Send For Verification. A second user verifies and releases them.");
      return "deferred";
    }
    if (to === "published") {
      // Release is a sign-off by a second user, so the move opens a form and the card moves when that is done.
      if (awaitingVerification(o)) onVerify(o.id);
      else onOpenEditor(o.id, "Send the results for verification first. A second user verifies and releases them.");
      return "deferred";
    }
    return false;
  }

  const canDrag = (): MoveCheck => (allowed ? { ok: true } : { ok: false, reason: "Your role cannot move laboratory orders. It needs the lab.result permission." });

  return (
    <div>
      <StatStrip
        stats={[
          { label: "Orders Today", icon: <IconFlask stroke={1.75} />, value: stats.ordersToday, note: stats.cancelled ? `${stats.cancelled} cancelled, see Table view` : "Not counting cancelled" },
          { label: "STAT Waiting", icon: <IconAlertTriangle stroke={1.75} />, value: stats.statWaiting, tone: stats.statWaiting ? "cancel" : "ok", note: "Not yet resulted" },
          { label: "Average Turnaround", icon: <IconHourglass stroke={1.75} />, value: stats.avgTurnaroundMin === null ? "None yet" : fmtDuration(stats.avgTurnaroundMin), note: "Order to published result" },
          { label: "Past Target", icon: <IconClock stroke={1.75} />, value: stats.late, tone: stats.late ? "merge" : "ok", note: "Cards with a red clock" },
        ]}
      />
      <SwimBoard<LabOrder>
        ariaLabel="Laboratory board"
        laneHeading="Priority"
        storageKey="lab"
        lanes={LAB_LANES}
        stages={LAB_STAGES}
        cards={cards}
        getId={(o) => o.id}
        label={(o) => `${nameOf(o)}, ${testChips(o).join(" ")}`}
        laneOf={labLaneOf}
        stageOf={(o) => labStageOf(o) ?? "ordered"}
        renderCard={(o, ctx) => <LabCard order={o} ctx={ctx} allowed={allowed} onOpen={() => onOpen(o.id)} onLabels={() => onLabels(o.id)} />}
        canMove={labCanMove}
        canDrag={canDrag}
        onMove={onMove}
        onMoved={(o, from, to, via) => auditMove(`Lab order ${o.id}`, stageLabelOf(to), nameOf(o), via, `Visit ${o.visitNumber}, from ${stageLabelOf(from)}`)}
        clockOf={labClock}
        moveHint={(_o, from, to) => LAB_MOVE_HINT[`${from}>${to}`]}
        dev={dev}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a card to the next stage, or use the arrows button on the card. Moves that need input open the form first. Tube caps show the container the specimen goes in.
        Labels prints the barcode labels. Receive Sample is done at the lab bench. Verify Result opens the sign-off, where a second user chooses Verify And Release or Send Back.
      </p>
    </div>
  );
}
