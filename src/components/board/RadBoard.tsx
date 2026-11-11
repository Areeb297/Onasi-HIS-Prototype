import * as React from "react";
import { useDevMode } from "@/lib/devmode";
import type { RadOrder } from "@/lib/fhir/types";
import { markPerformed, procByCode, releaseRadReport } from "@/lib/radiology";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { auditMove } from "./audit-move";
import { byPriorityThenAge } from "./board-util";
import { CheckCircle2 } from "lucide-react";
import { CardAction, CardFoot, CardSubject, PatientLine, PriorityTag, Tag } from "./CardBits";
import { fmtDuration } from "./clock";
import { ClockPill } from "./ClockPill";
import { CriticalPulse, ModalityGlyph } from "./glyphs";
import {
  MODALITY_SHORT, RAD_LANES, RAD_MOVE_HINT, RAD_STAGES, REGION_SHORT, radCanMove, radClock, radLaneOf, radStageLabel, radStageOf, radStats,
  type RadStageId,
} from "./rad-board";
import { StatStrip } from "./StatStrip";
import { SwimBoard } from "./SwimBoard";
import { TONE } from "./tone";
import type { CardCtx, MoveCheck, MoveResult } from "./types";

const NEXT_ACTION: Record<RadStageId, { label: string; to?: RadStageId }> = {
  ordered: { label: "Mark Exam Performed", to: "performed" },
  performed: { label: "Write Report", to: "reporting" },
  reporting: { label: "Release Report", to: "reported" },
  reported: { label: "View Or Amend" },
};

function RadCard({ order, ctx, onOpen, allowed }: { order: RadOrder; ctx: CardCtx; onOpen: () => void; allowed: boolean }) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === order.patientId);
  const proc = procByCode(order.procCode);
  const stage = ctx.stage.id as RadStageId;
  const clock = radClock(order, stage);
  const next = NEXT_ACTION[stage];
  const modality = proc?.modality ?? "CR";
  const t = TONE[ctx.lane.tone];
  const prio = order.priority === "stat" ? { tone: "cancel" as const, label: "STAT" } : order.priority === "routine" ? { tone: "muted" as const, label: "Routine" } : { tone: "merge" as const, label: "Urgent" };
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityTag tone={prio.tone} label={prio.label} />
          <Tag tone={ctx.lane.tone}>{MODALITY_SHORT[modality] ?? modality}</Tag>
          {proc?.contrast && <Tag tone="merge">Contrast</Tag>}
          {order.report?.critical && <CriticalPulse />}
        </div>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${t.soft} ${t.text}`} title={`${MODALITY_SHORT[modality] ?? modality}`}>
          <ModalityGlyph modality={modality} className="size-6" />
        </span>
      </div>

      <div className="mt-1.5">
        <PatientLine patient={patient} onOpen={ctx.overlay ? undefined : onOpen} dev={ctx.dev} extra={`${order.id} · ${order.visitNumber}`} now={ctx.now} />
      </div>
      <CardSubject>
        {proc?.short ?? order.procCode}
        {proc && <span className="text-muted-foreground"> · {REGION_SHORT[proc.region] ?? proc.region}</span>}
      </CardSubject>

      <CardFoot>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {clock ? (
            <ClockPill since={clock.since} targetMin={clock.targetMin} now={ctx.now} mode={stage === "ordered" ? "elapsed" : "due"} dueLabel="Report due" />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Report released</span>
          )}
          {stage === "reporting" && order.report && !order.report.impression.trim() && <Tag tone="merge">No impression yet</Tag>}
        </div>
        {!ctx.overlay && (
          <div className="flex gap-1.5">
            {stage === "reporting" && (
              <CardAction label="Open Report" variant="secondary" allowed={allowed} reason="Your role cannot write radiology reports." onClick={onOpen} />
            )}
            <CardAction
              label={next.label}
              allowed={allowed}
              reason="Your role cannot work on radiology orders."
              variant={stage === "reported" ? "secondary" : "primary"}
              onClick={() => (next.to ? ctx.move(next.to) : onOpen())}
            />
          </div>
        )}
      </CardFoot>
    </div>
  );
}

/** The radiology swim lane board. Lanes are modalities, stages follow the real order status plus a draft report. */
export function RadBoard({
  orders, onOpenEditor, onOpen,
}: {
  orders: RadOrder[];
  onOpenEditor: (id: string, hint: string) => void;
  onOpen: (id: string) => void;
}) {
  const his = useHis();
  const dev = useDevMode();
  const allowed = can("rad.report");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cards = React.useMemo(
    () => orders.filter((o) => radStageOf(o)).sort(byPriorityThenAge((o: RadOrder) => o.priority, (o) => o.orderedAt)),
    [orders],
  );
  const stats = radStats(orders, now);
  const nameOf = (o: RadOrder) => patientName(his.patients.find((p) => p.id === o.patientId));

  function onMove(o: RadOrder, _from: string, to: string): MoveResult {
    if (to === "performed") return markPerformed(o.id);
    if (to === "reporting") {
      onOpenEditor(o.id, "Write the findings and the impression. The card moves to Reporting as soon as you type.");
      return "deferred";
    }
    if (to === "reported") {
      return releaseRadReport(o.id);
    }
    return false;
  }

  const canDrag = (): MoveCheck => (allowed ? { ok: true } : { ok: false, reason: "Your role cannot move radiology orders. It needs the rad.report permission." });

  return (
    <div>
      <StatStrip
        stats={[
          { label: "Exams Today", value: stats.examsToday, note: stats.cancelled ? `${stats.cancelled} cancelled, see Table view` : "Not counting cancelled" },
          { label: "STAT Waiting", value: stats.statWaiting, tone: stats.statWaiting ? "cancel" : "ok", note: "Not yet reported" },
          { label: "Awaiting Report", value: stats.awaitingReport, tone: stats.awaitingReport ? "update" : "ok", note: stats.avgReportMin === null ? "No reports published yet" : `Average report time ${fmtDuration(stats.avgReportMin)}` },
          { label: "Past Target", value: stats.late, tone: stats.late ? "merge" : "ok", note: "Cards with a red clock" },
        ]}
      />
      <SwimBoard<RadOrder>
        ariaLabel="Radiology board"
        laneHeading="Modality"
        storageKey="rad"
        lanes={RAD_LANES}
        stages={RAD_STAGES}
        cards={cards}
        getId={(o) => o.id}
        label={(o) => `${nameOf(o)}, ${procByCode(o.procCode)?.short ?? o.procCode}`}
        laneOf={radLaneOf}
        stageOf={(o) => radStageOf(o) ?? "ordered"}
        renderCard={(o, ctx) => <RadCard order={o} ctx={ctx} allowed={allowed} onOpen={() => onOpen(o.id)} />}
        canMove={radCanMove}
        canDrag={canDrag}
        onMove={onMove}
        onMoved={(o, from, to, via) => auditMove(`Radiology order ${o.id}`, radStageLabel(to), nameOf(o), via, `Visit ${o.visitNumber}, from ${radStageLabel(from)}`)}
        clockOf={radClock}
        moveHint={(_o, from, to) => RAD_MOVE_HINT[`${from}>${to}`]}
        dev={dev}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a card to the next stage, or use the arrows button on the card. The clock on Exam Done and Reporting cards counts down to the report due time.
      </p>
    </div>
  );
}
