import { IconAlertTriangle, IconClock, IconFileText, IconScan } from "@tabler/icons-react";
import * as React from "react";
import { useDevMode } from "@/lib/devmode";
import type { RadOrder } from "@/lib/fhir/types";
import { isRadSigned, procByCode, releaseRadReport } from "@/lib/radiology";
import { personFromDoctor } from "@/lib/fhir/people";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { auditMove } from "./audit-move";
import { byPriorityThenAge } from "./board-util";
import { CheckCircle2 } from "lucide-react";
import { CardAction, CardFoot, CardSubject, PriorityTag, Tag } from "./CardBits";
import { OrderCardPatient } from "./OrderCardPatient";
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
  ordered: { label: "Mark Exam Done", to: "performed" },
  performed: { label: "Write Report", to: "reporting" },
  reporting: { label: "Sign Report", to: "signed" },
  signed: { label: "Release Report", to: "reported" },
  reported: { label: "Open Report" },
};

function RadCard({ order, ctx, onOpen, mayPerform, mayReport }: { order: RadOrder; ctx: CardCtx; onOpen: () => void; mayPerform: boolean; mayReport: boolean }) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === order.patientId);
  const proc = procByCode(order.procCode);
  const stage = ctx.stage.id as RadStageId;
  const clock = radClock(order, stage);
  const signed = isRadSigned(order);
  const next = NEXT_ACTION[stage];
  const modality = proc?.modality ?? "DX";
  const t = TONE[ctx.lane.tone];
  const prio = order.priority === "stat" ? { tone: "cancel" as const, label: "STAT" } : order.priority === "routine" ? { tone: "muted" as const, label: "Routine" } : { tone: "merge" as const, label: "Urgent" };
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityTag tone={prio.tone} label={prio.label} />
          <Tag tone={ctx.lane.tone}>{MODALITY_SHORT[modality] ?? modality}</Tag>
          {proc?.contrast && <Tag tone="merge">Contrast</Tag>}
          {order.coverage && <Tag tone={order.coverage === "plan" ? "ok" : "muted"}>{order.coverage === "plan" ? "Insured" : "Self-Pay"}</Tag>}
          {order.report?.critical && <CriticalPulse />}
        </div>
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${t.soft} ${t.text}`} title={`${MODALITY_SHORT[modality] ?? modality}`}>
          <ModalityGlyph modality={modality} className="size-6" />
        </span>
      </div>

      <div className="mt-1.5">
        <OrderCardPatient patient={patient} orderedAt={order.orderedAt} onOpen={ctx.overlay ? undefined : onOpen} now={ctx.now} devExtra={ctx.dev ? `${order.id} · Visit ${order.visitNumber}` : undefined} />
      </div>
      <CardSubject>
        {proc?.short ?? order.procCode}
        {proc && <span className="text-muted-foreground"> · {REGION_SHORT[proc.region] ?? proc.region}</span>}
      </CardSubject>
      <p className="mt-0.5 text-xs text-muted-foreground">Ordered by {personFromDoctor(order.orderedById).name}</p>

      <CardFoot>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {clock ? (
            <ClockPill since={clock.since} targetMin={clock.targetMin} now={ctx.now} mode={stage === "ordered" ? "elapsed" : "due"} dueLabel="Report due" />
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Report released</span>
          )}
          {stage === "reporting" && order.report && !order.report.impression.trim() && <Tag tone="merge">No impression yet</Tag>}
          {stage === "reporting" && <Tag tone="update">Draft</Tag>}
          {stage === "signed" && <Tag tone="ok">Signed</Tag>}
        </div>
        {!ctx.overlay && (
          <div className="flex gap-1.5">
            {stage === "signed" && (
              <CardAction label="Open Report" variant="secondary" allowed={mayReport} reason="Your role cannot write radiology reports." onClick={onOpen} />
            )}
            <CardAction
              label={next.label}
              allowed={stage === "ordered" ? mayPerform : mayReport}
              reason={stage === "ordered" ? "Your role cannot record exams." : "Only a radiologist works on the report."}
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
  orders, onPerform, onOpenEditor, onOpen,
}: {
  orders: RadOrder[];
  /** Opens the exam record of the page: machine, times, contrast and the pregnancy check. */
  onPerform: (id: string) => void;
  onOpenEditor: (id: string, hint: string) => void;
  onOpen: (id: string) => void;
}) {
  const his = useHis();
  const dev = useDevMode();
  // The technician performs the exam (rad.perform); the radiologist writes, signs and releases the report (rad.report).
  const mayPerform = can("rad.perform");
  const mayReport = can("rad.report");
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
    if (to === "performed") {
      onPerform(o.id);
      return "deferred";
    }
    if (to === "reporting") {
      onOpenEditor(o.id, "Write the findings and the impression. The card moves to Result Entry as soon as you type.");
      return "deferred";
    }
    if (to === "signed") {
      onOpenEditor(o.id, "A radiologist must sign the report. Check the text, then press Sign Report.");
      return "deferred";
    }
    if (to === "reported") {
      if (!isRadSigned(o)) {
        onOpenEditor(o.id, "A radiologist must sign the report before it is released. Check the text, then press Sign Report.");
        return "deferred";
      }
      return releaseRadReport(o.id);
    }
    return false;
  }

  const canDrag = (): MoveCheck => (mayPerform || mayReport ? { ok: true } : { ok: false, reason: "Your role cannot move radiology orders. It needs the rad.perform or rad.report permission." });
  const canMove = (o: RadOrder, from: string, to: string): MoveCheck => {
    if (to === "performed" && !mayPerform) return { ok: false, reason: "Only a radiology technician or radiologist records the exam. It needs the rad.perform permission." };
    if (to !== "performed" && !mayReport) return { ok: false, reason: "Only a radiologist writes, signs and releases the report. It needs the rad.report permission." };
    return radCanMove(o, from, to);
  };

  return (
    <div>
      <StatStrip
        stats={[
          { label: "Exams Today", icon: <IconScan stroke={1.75} />, value: stats.examsToday, note: stats.cancelled ? `${stats.cancelled} cancelled, see Table view` : "Not counting cancelled" },
          { label: "STAT Waiting", icon: <IconAlertTriangle stroke={1.75} />, value: stats.statWaiting, tone: stats.statWaiting ? "cancel" : "ok", note: "Not yet reported" },
          { label: "Awaiting Report", icon: <IconFileText stroke={1.75} />, value: stats.awaitingReport, tone: stats.awaitingReport ? "update" : "ok", note: stats.avgReportMin === null ? "No reports published yet" : `Average report time ${fmtDuration(stats.avgReportMin)}` },
          { label: "Past Target", icon: <IconClock stroke={1.75} />, value: stats.late, tone: stats.late ? "merge" : "ok", note: "Cards with a red clock" },
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
        renderCard={(o, ctx) => <RadCard order={o} ctx={ctx} mayPerform={mayPerform} mayReport={mayReport} onOpen={() => onOpen(o.id)} />}
        canMove={canMove}
        canDrag={canDrag}
        onMove={onMove}
        onMoved={(o, from, to, via) => auditMove(`Radiology order ${o.id}`, radStageLabel(to), nameOf(o), via, `Visit ${o.visitNumber}, from ${radStageLabel(from)}`)}
        clockOf={radClock}
        moveHint={(_o, from, to) => RAD_MOVE_HINT[`${from}>${to}`]}
        dev={dev}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a card to the next stage, or use the arrows button on the card. The clock on Test Processing, Result Entry and Result Verification cards counts down to the report due time.
        A report is released only after a radiologist has signed it.
      </p>
    </div>
  );
}
