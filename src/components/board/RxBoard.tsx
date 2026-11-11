import * as React from "react";
import { IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { Badge } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Prescription, RxState } from "@/lib/rx-types";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { auditMove } from "./audit-move";
import { CheckCircle2 } from "lucide-react";
import { CardAction, CardFoot, CardSubject, PatientLine, PriorityTag, Tag } from "./CardBits";
import { fmtDuration } from "./clock";
import { ClockPill } from "./ClockPill";
import { PillStrip } from "./glyphs";
import {
  RX_LANES, RX_MOVE_HINT, RX_STAGES, itemFills, rxCanMove, rxClock, rxLaneOf, rxStageLabel, rxStageOf, rxStats, type ItemFill, type RxStageId,
} from "./rx-board";
import { StatStrip } from "./StatStrip";
import { SwimBoard } from "./SwimBoard";
import type { CardCtx, MoveCheck, MoveResult } from "./types";

const TYPE_TEXT: Record<string, string> = { FF: "Full", FFP: "Part", FFC: "Completes", RF: "Refill", RFP: "Part refill", RFC: "Completes refill" };

function FillBar({ f }: { f: ItemFill }) {
  const pct = f.quantity > 0 ? Math.min(100, Math.round((f.dispensed / f.quantity) * 100)) : 0;
  return (
    <li className="space-y-0.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">{f.name}</span>
        {f.lastType && <Badge tone={f.lastType === "FFP" || f.lastType === "RFP" ? "warn" : "ok"}>{f.lastType}</Badge>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={f.quantity} aria-valuenow={f.dispensed} aria-label={`${f.name}: ${f.dispensed} of ${f.quantity} ${f.unit} handed over`}>
        <div className={f.done ? "h-full bg-ok" : "h-full bg-merge"} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {f.done ? `All ${f.quantity} ${f.unit} handed over` : `${f.remaining} ${f.unit} left of ${f.quantity}`}
        {f.lastType && ` · last ${TYPE_TEXT[f.lastType] ?? f.lastType}`}
      </div>
    </li>
  );
}

function RxCard({ rx, s, ctx, allowed, onDispense }: { rx: Prescription; s: RxState; ctx: CardCtx; allowed: boolean; onDispense: () => void }) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === rx.patientId);
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const allergic = !!enc?.allergies.length;
  const stage = ctx.stage.id as RxStageId;
  const clock = rxClock(s, rx, stage);
  const fills = itemFills(s, rx);
  const totalQty = fills.reduce((n, f) => n + f.quantity, 0);
  const left = fills.reduce((n, f) => n + (f.done ? 0 : f.remaining), 0);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityTag tone={ctx.lane.tone} label={ctx.lane.id === "controlled" ? "Controlled drug" : "Standard"} />
          {rx.raqeebRef && <Tag tone="merge">Raqeeb</Tag>}
        </div>
        <span
          className={allergic ? "text-destructive" : "text-ok"}
          title={allergic ? `Allergies: ${enc?.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"}
        >
          {allergic ? <IconShieldExclamation className="size-[18px]" stroke={1.75} aria-label="Allergies recorded" /> : <IconShieldCheck className="size-[18px]" stroke={1.75} aria-label="No allergies recorded" />}
        </span>
      </div>
      <div className="mt-1.5">
        <PatientLine patient={patient} dev={ctx.dev} extra={rx.visitNumber} now={ctx.now} />
      </div>
      <CardSubject>
        {rx.number}
        {ctx.dev && rx.raqeebRef && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{rx.raqeebRef}</span>}
      </CardSubject>

      <div className="mt-2 flex items-center gap-2.5">
        <PillStrip left={totalQty > 0 ? left / totalQty : 0} label={`${left} of ${totalQty} units still owed`} />
        <span className="text-xs text-muted-foreground">{stage === "dispensed" ? "All handed over" : `${left} of ${totalQty} owed`}</span>
      </div>
      <ul className="mt-2 space-y-2">
        {fills.slice(0, 3).map((f) => <FillBar key={f.id} f={f} />)}
        {fills.length > 3 && <li className="text-xs text-muted-foreground">+{fills.length - 3} more items</li>}
      </ul>

      <CardFoot>
        {clock ? <ClockPill since={clock.since} targetMin={clock.targetMin} now={ctx.now} /> : <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Handed over</span>}
        {!ctx.overlay && stage !== "dispensed" && (
          <CardAction label={stage === "partial" ? "Dispense The Rest" : "Dispense"} allowed={allowed} reason="Your role cannot dispense medicines." onClick={onDispense} />
        )}
      </CardFoot>
    </div>
  );
}

/**
 * The pharmacy swim lane board. Lanes: controlled drugs and standard. Stages come from the dispense lines.
 * Every forward move opens the Dispense dialog, because quantities and scans must be entered. Nothing moves backwards.
 */
export function RxBoard({ state, prescriptions, onDispense }: { state: RxState; prescriptions: Prescription[]; onDispense: (id: string) => void }) {
  const his = useHis();
  const dev = useDevMode();
  const allowed = can("rx.dispense");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cards = React.useMemo(
    () => prescriptions.filter((r) => rxStageOf(state, r)).sort((a, b) => (a.sentAt ?? a.authoredAt).localeCompare(b.sentAt ?? b.authoredAt)),
    [prescriptions, state],
  );
  const stats = rxStats(state, now);
  const nameOf = (rx: Prescription) => patientName(his.patients.find((p) => p.id === rx.patientId));

  function onMove(rx: Prescription): MoveResult {
    onDispense(rx.id);
    return "deferred";
  }

  const canDrag = (): MoveCheck => (allowed ? { ok: true } : { ok: false, reason: "Your role cannot dispense. It needs the rx.dispense permission." });

  return (
    <div>
      <StatStrip
        stats={[
          { label: "Waiting For Pharmacy", value: stats.waiting, tone: stats.waiting ? "move" : "ok", note: stats.offBoard ? `${stats.offBoard} on hold, stopped or cancelled, see Table view` : "Pending and partly dispensed" },
          { label: "Controlled Waiting", value: stats.controlledWaiting, tone: stats.controlledWaiting ? "cancel" : "ok", note: "Need the secure code" },
          { label: "Dispensed Today", value: stats.dispensedToday, note: "Prescriptions with a hand over today" },
          { label: "Average Wait", value: stats.avgWaitMin === null ? "None yet" : fmtDuration(stats.avgWaitMin), note: stats.late ? `${stats.late} past target now` : "Sent to first hand over" },
        ]}
      />
      <SwimBoard<Prescription>
        ariaLabel="Pharmacy dispense board"
        laneHeading="Drug Type"
        storageKey="rx"
        lanes={RX_LANES}
        stages={RX_STAGES}
        cards={cards}
        getId={(r) => r.id}
        label={(r) => `${nameOf(r)}, ${r.number}`}
        laneOf={rxLaneOf}
        stageOf={(r) => rxStageOf(state, r) ?? "pending"}
        renderCard={(r, ctx) => <RxCard rx={r} s={state} ctx={ctx} allowed={allowed} onDispense={() => onDispense(r.id)} />}
        canMove={rxCanMove}
        canDrag={canDrag}
        onMove={onMove}
        onMoved={(r, from, to, via) => auditMove(`Prescription ${r.number}`, rxStageLabel(to), nameOf(r), via, `Visit ${r.visitNumber}, from ${rxStageLabel(from)}`)}
        clockOf={(r, st) => rxClock(state, r, st)}
        moveHint={() => RX_MOVE_HINT}
        dev={dev}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Drag a card forward to open the Dispense dialog. The card moves when the dispense is saved. FF is a full dispense, FFP a part, FFC the part that completes the fill.
      </p>
    </div>
  );
}
