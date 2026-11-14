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
  RX_BOARD_STAGES, RX_LANES, RX_MOVE_HINT, RX_VERIFY_MOVE_HINT, itemFills, rxBoardCanMove, rxBoardClock, rxBoardStageOf, rxLaneOf, rxStageLabel, rxStats, rxVerifyCounts,
  type ItemFill, type RxBoardStageId,
} from "./rx-board";
import { needsPharmacist, pharmacyItems } from "@/lib/rx-verify";
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

function RxCard({ rx, s, ctx, allowed, onDispense, onVerify }: { rx: Prescription; s: RxState; ctx: CardCtx; allowed: boolean; onDispense: () => void; onVerify: () => void }) {
  const his = useHis();
  const patient = his.patients.find((p) => p.id === rx.patientId);
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const allergic = !!enc?.allergies.length;
  const stage = ctx.stage.id as RxBoardStageId;
  const clock = rxBoardClock(s, rx, stage);
  const vc = rxVerifyCounts(s, rx);
  const checkedBy = [...new Set(rx.items.filter((i) => i.verify?.status === "verified" && i.verify.version === i.version).map((i) => i.verify?.by))].join(", ");
  const fills = itemFills(s, rx);
  const totalQty = fills.reduce((n, f) => n + f.quantity, 0);
  const left = fills.reduce((n, f) => n + (f.done ? 0 : f.remaining), 0);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <PriorityTag tone={ctx.lane.tone} label={ctx.lane.id === "controlled" ? "Controlled drug" : "Standard"} />
          {rx.raqeebRef && <Tag tone="merge">Raqeeb</Tag>}
          {stage !== "dispensed" && vc.toVerify > 0 && <Tag tone="update">{vc.toVerify} To Verify</Tag>}
          {stage !== "dispensed" && vc.withPrescriber > 0 && <Tag tone="muted">{vc.withPrescriber} With Prescriber</Tag>}
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
      {checkedBy && <p className="mt-2 text-xs text-muted-foreground">Verified by {checkedBy}</p>}

      <CardFoot>
        {clock ? <ClockPill since={clock.since} targetMin={clock.targetMin} now={ctx.now} /> : <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCircle2 className="size-3.5" aria-hidden="true" /> Handed over</span>}
        {!ctx.overlay && stage !== "dispensed" && (
          <span className="flex flex-wrap items-center gap-1.5">
            {(stage === "verify" || vc.toVerify + vc.withPrescriber > 0) && (
              <CardAction label={vc.toVerify > 0 ? "Check And Verify" : "Open Check Sheet"} variant={vc.toVerify > 0 ? "primary" : "secondary"} allowed={allowed} reason="Your role cannot dispense or verify medicines." onClick={onVerify} />
            )}
            {vc.verified > 0 && (
              <CardAction label={stage === "partial" ? "Dispense The Rest" : "Dispense"} variant={vc.toVerify > 0 ? "secondary" : "primary"} allowed={allowed} reason="Your role cannot dispense medicines." onClick={onDispense} />
            )}
          </span>
        )}
      </CardFoot>
    </div>
  );
}

/**
 * The pharmacy swim lane board. Lanes: controlled drugs and standard. Stages: To Verify, then the stages that come from the dispense lines.
 * Leaving To Verify opens the pharmacist check sheet. Every other forward move opens the Dispense dialog,
 * because quantities and scans must be entered. Nothing moves backwards.
 */
export function RxBoard({
  state, prescriptions, onDispense, onVerify,
}: {
  state: RxState;
  prescriptions: Prescription[];
  onDispense: (id: string) => void;
  onVerify: (rxId: string, itemId: string) => void;
}) {
  const his = useHis();
  const dev = useDevMode();
  const allowed = can("rx.dispense");
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const cards = React.useMemo(
    () => prescriptions.filter((r) => rxBoardStageOf(state, r)).sort((a, b) => (a.sentAt ?? a.authoredAt).localeCompare(b.sentAt ?? b.authoredAt)),
    [prescriptions, state],
  );
  const stats = rxStats(state, now);
  const nameOf = (rx: Prescription) => patientName(his.patients.find((p) => p.id === rx.patientId));

  /** The item the check sheet opens on: first one waiting for the pharmacist, else the first one not verified. */
  function verifyFirst(rx: Prescription) {
    const list = pharmacyItems(state, rx).filter((x) => x.status !== "verified");
    const pick = list.find((x) => needsPharmacist(x.status)) ?? list[0];
    if (pick) onVerify(rx.id, pick.item.id);
  }

  function onMove(rx: Prescription, from: string): MoveResult {
    if (from === "verify") verifyFirst(rx);
    else onDispense(rx.id);
    return "deferred";
  }

  const canDrag = (): MoveCheck => (allowed ? { ok: true } : { ok: false, reason: "Your role cannot dispense or verify. It needs the rx.dispense permission." });

  return (
    <div>
      <StatStrip
        stats={[
          { label: "To Verify", value: stats.toVerify, tone: stats.toVerify ? "update" : "ok", note: stats.withPrescriber ? `Items to check. ${stats.withPrescriber} more with the prescriber` : "Items waiting for the pharmacist check" },
          { label: "Waiting For Pharmacy", value: stats.waiting, tone: stats.waiting ? "move" : "ok", note: stats.offBoard ? `${stats.offBoard} on hold, stopped or cancelled, see Table view` : "Prescriptions not fully handed over" },
          { label: "Controlled Waiting", value: stats.controlledWaiting, tone: stats.controlledWaiting ? "cancel" : "ok", note: "Need a witness and the secure code" },
          { label: "Dispensed Today", value: stats.dispensedToday, note: `${stats.avgWaitMin === null ? "No hand over yet" : `Average wait ${fmtDuration(stats.avgWaitMin)}`}${stats.late ? `. ${stats.late} past target now` : ""}` },
        ]}
      />
      <SwimBoard<Prescription>
        ariaLabel="Pharmacy dispense board"
        laneHeading="Drug Type"
        storageKey="rx"
        lanes={RX_LANES}
        stages={RX_BOARD_STAGES}
        cards={cards}
        getId={(r) => r.id}
        label={(r) => `${nameOf(r)}, ${r.number}`}
        laneOf={rxLaneOf}
        stageOf={(r) => rxBoardStageOf(state, r) ?? "pending"}
        renderCard={(r, ctx) => <RxCard rx={r} s={state} ctx={ctx} allowed={allowed} onDispense={() => onDispense(r.id)} onVerify={() => verifyFirst(r)} />}
        canMove={rxBoardCanMove}
        canDrag={canDrag}
        onMove={onMove}
        onMoved={(r, from, to, via) => auditMove(`Prescription ${r.number}`, rxStageLabel(to), nameOf(r), via, `Visit ${r.visitNumber}, from ${rxStageLabel(from)}`)}
        clockOf={(r, st) => rxBoardClock(state, r, st)}
        moveHint={(_r, from) => (from === "verify" ? RX_VERIFY_MOVE_HINT : RX_MOVE_HINT)}
        dev={dev}
      />
      <p className="mt-2 text-xs text-muted-foreground">
        A new prescription starts in To Verify. Drag it forward to open the check sheet. Only verified items can be dispensed. From Pending, drag a card forward to open the Dispense dialog. The card moves when the dispense is saved. FF is a full dispense, FFP a part, FFC the part that completes the fill.
      </p>
    </div>
  );
}
