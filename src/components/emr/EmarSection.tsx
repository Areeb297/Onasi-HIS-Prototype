import * as React from "react";
import { IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clock, Minus, Pause, X } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import {
  DOSE_WINDOW_MIN, OUTCOME_LABEL, PRN_REASONS, REASONS_FOR, RIGHTS, STATE_LABEL, TIMING_REASONS,
  addEffectNote, dosesBetween, emarApplies, lastGiven, marOrders, recordDose, recordsOf, useEmar, voidRecord,
  type AdminRecord, type DoseOutcome, type DoseSlot, type DoseState, type MarOrder, type Right,
} from "@/lib/emar";
import type { Encounter, Patient } from "@/lib/model";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, toLocalInput, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * The chart "Medication Chart" tab (eMAR). A nurse works from the Now view; the day and week grids show the whole picture.
 * A dose is saved only when the nurse picks an outcome. Colour is never the only signal: every state has a word and a letter.
 */

const HOUR = 3_600_000;

const hm = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayLabel = (t: number) => new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const dateTime = (t: number | string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

const STATE_CLASS: Record<DoseState, string> = {
  given: "border-ok/40 bg-ok/12 text-ok",
  held: "border-warn/50 bg-warn/14 text-warn",
  refused: "border-cancel/40 bg-cancel/12 text-cancel",
  missed: "border-destructive/40 bg-destructive/10 text-destructive",
  due: "border-move/50 bg-move/12 text-move",
  overdue: "border-destructive bg-card font-semibold text-destructive",
  scheduled: "border-border bg-muted/50 text-muted-foreground",
};
const STATE_CODE: Record<DoseState, string> = { given: "G", held: "H", refused: "R", missed: "M", due: "D", overdue: "O", scheduled: "S" };
const STATE_ICON: Record<DoseState, React.ElementType> = { given: Check, held: Pause, refused: X, missed: Minus, due: Clock, overdue: AlertTriangle, scheduled: Clock };
const STATE_HELP: Record<DoseState, string> = {
  overdue: `More than ${DOSE_WINDOW_MIN} minutes late and nothing recorded`,
  due: `Within ${DOSE_WINDOW_MIN} minutes of the dose time`,
  scheduled: "Later, not due yet",
  given: "Given to the patient",
  held: "Held by the nurse or doctor, with a reason",
  refused: "The patient or family refused",
  missed: "Not given, with a reason",
};
const LEGEND_ORDER: DoseState[] = ["overdue", "due", "scheduled", "given", "held", "refused", "missed"];
const OUTCOME_TONE: Record<DoseOutcome, "ok" | "warn" | "cancel" | "danger"> = { given: "ok", held: "warn", refused: "cancel", missed: "danger" };

function useNow(everyMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type View = "now" | "day" | "week";
type Picked = { itemId: string; slot: number | null } | null;

export function EmarSection({ enc }: { enc: Encounter }) {
  const emar = useEmar();
  const rx = useRx();
  const his = useHis();
  useSession();
  const now = useNow();
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const [view, setView] = React.useState<View>("now");
  const [day, setDay] = React.useState(() => startOfDay(Date.now()));
  const [picked, setPicked] = React.useState<Picked>(null);
  const [detail, setDetail] = React.useState<string | null>(null);
  const topRef = React.useRef<HTMLDivElement>(null);

  if (!emarApplies(enc)) {
    return (
      <Card>
        <CardHeader title="Medication Chart" />
        <Empty>The medication chart is for inpatients and emergency patients. This is an outpatient visit: the patient takes the medicines home. See the Prescription section.</Empty>
      </Card>
    );
  }

  const canRecord = can("emr.write");
  const orders = marOrders(enc, rx);
  const records = recordsOf(enc.visitNumber, emar);
  const pickedOrder = picked ? orders.find((o) => o.itemId === picked.itemId) : undefined;
  const detailRecord = detail ? records.find((r) => r.id === detail) : undefined;
  const toTop = () => { if (typeof window !== "undefined") requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })); };

  const open = (d: DoseSlot) => {
    if (d.record) { setDetail(d.record.id); setPicked(null); }
    else if (canRecord) { setPicked({ itemId: d.order.itemId, slot: d.dueAt }); setDetail(null); }
    else { pushToast({ tone: "warn", text: "Your role cannot record doses" }); return; }
    toTop();
  };
  const openPrn = (o: MarOrder) => { setPicked({ itemId: o.itemId, slot: null }); setDetail(null); toTop(); };

  const views: { id: View; label: string }[] = [{ id: "now", label: "Now" }, { id: "day", label: "Day" }, { id: "week", label: "Week" }];
  const step = view === "week" ? 7 : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Medication Chart"
          subtitle="Doses due from the prescriptions of this visit. Record each dose as given, held, refused or missed."
          right={
            <div className="flex shrink-0 rounded-lg border border-border p-0.5" role="group" aria-label="View">
              {views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={view === v.id}
                  onClick={() => setView(v.id)}
                  className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors", view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  {v.label}
                </button>
              ))}
            </div>
          }
        />
        <AllergyStrip enc={enc} />

        <div ref={topRef}>
          {picked && pickedOrder && patient && (
            <DoseForm key={`${picked.itemId}|${picked.slot}`} enc={enc} patient={patient} order={pickedOrder} slot={picked.slot} onClose={() => setPicked(null)} />
          )}
          {detailRecord && <DoseDetail key={detailRecord.id} record={detailRecord} canRecord={canRecord} onClose={() => setDetail(null)} />}
        </div>

        {orders.length === 0 ? (
          <Empty>
            No medicines on this chart yet. Write a prescription and send it; its doses then appear here.
            <div className="mt-3"><Button onClick={() => navigate("/chart", { visit: enc.visitNumber, s: "prescription" })}>Go To Prescription</Button></div>
          </Empty>
        ) : (
          <>
            {view !== "now" && (
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
                <Button size="sm" onClick={() => setDay(addDays(day, -step))}><ChevronLeft className="size-4" aria-hidden="true" /> {view === "week" ? "Previous Week" : "Previous Day"}</Button>
                <Button size="sm" onClick={() => setDay(startOfDay(Date.now()))}>Today</Button>
                <Button size="sm" onClick={() => setDay(addDays(day, step))}>{view === "week" ? "Next Week" : "Next Day"} <ChevronRight className="size-4" aria-hidden="true" /></Button>
                <span className="text-sm font-medium">{view === "day" ? dayLabel(day) : `${dayLabel(addDays(day, -3))} to ${dayLabel(addDays(day, 3))}`}</span>
              </div>
            )}
            {view === "now" && <NowView enc={enc} orders={orders} now={now} canRecord={canRecord} onOpen={open} onPrn={openPrn} />}
            {view === "day" && <DayGrid enc={enc} orders={orders} day={day} now={now} onOpen={open} />}
            {view === "week" && <WeekGrid enc={enc} orders={orders} day={day} now={now} onOpen={open} />}
            <Legend letters={view === "week"} />
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Recorded Doses" subtitle="Who recorded each dose and when. Newest first." />
        <History records={records} onOpen={(id) => { setDetail(id); setPicked(null); toTop(); }} />
      </Card>
    </div>
  );
}

/* ---------- small parts ---------- */

function AllergyStrip({ enc }: { enc: Encounter }) {
  const sev = { SV: "severe", MO: "moderate", MI: "mild" } as const;
  if (!enc.allergies.length) {
    return (
      <div className="flex items-center gap-1.5 border-b border-border px-4 py-2 text-[0.8125rem] font-medium text-ok">
        <IconShieldCheck className="size-4" stroke={2} aria-hidden="true" /> No allergies recorded
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-destructive/30 bg-destructive/10 px-4 py-2">
      <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive"><IconShieldExclamation className="size-4" stroke={2} aria-hidden="true" /> Allergies</span>
      {enc.allergies.map((a, i) => (
        <span key={i} className="rounded-md border border-destructive/40 bg-card px-2 py-0.5 text-[0.8125rem] font-medium text-destructive">
          {a.text}<span className="font-normal"> · {sev[a.severity]}{a.reaction ? `, ${a.reaction}` : ""}</span>
        </span>
      ))}
    </div>
  );
}

function StateChip({ state, time, compact }: { state: DoseState; time?: string; compact?: boolean }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-none whitespace-nowrap", STATE_CLASS[state])}>
      {!compact && <Icon className="size-3.5" aria-hidden="true" />}
      {compact ? <>{time} <span className="font-semibold">{STATE_CODE[state]}</span></> : <>{STATE_LABEL[state]}{time ? ` ${time}` : ""}</>}
    </span>
  );
}

function DoseButton({ d, compact, onOpen }: { d: DoseSlot; compact?: boolean; onOpen: (d: DoseSlot) => void }) {
  const shown = d.record ? hm(new Date(d.record.at).getTime()) : undefined;
  const label = `${d.order.drug.generic}, ${d.dueAt !== null ? `due ${hm(d.dueAt)}` : "as needed"}, ${STATE_LABEL[d.state].toLowerCase()}${shown && d.state === "given" ? ` at ${shown}` : ""}. ${d.record ? "Open the record." : "Record this dose."}`;
  return (
    <button type="button" onClick={() => onOpen(d)} aria-label={label} title={label} className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StateChip state={d.state} compact={compact} time={compact ? hm(d.time) : d.state === "given" ? shown : undefined} />
    </button>
  );
}

function OrderCell({ o }: { o: MarOrder }) {
  return (
    <div className="min-w-[13rem]">
      <div className="font-medium">{o.drugText}</div>
      <div className="text-xs text-muted-foreground">{o.doseText} · {o.routeText} · {o.frequencyText}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {o.highAlert && <Badge tone="danger">High Alert: {o.highAlert}</Badge>}
        {o.status === "on-hold" && <Badge tone="warn">On Hold, No Doses Due</Badge>}
        {(o.status === "stopped" || o.status === "cancelled") && <Badge tone="neutral">{o.status === "stopped" ? "Stopped" : "Cancelled"}, No Further Doses</Badge>}
      </div>
    </div>
  );
}

function Legend({ letters }: { letters: boolean }) {
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-1.5 text-xs font-semibold">What the labels mean</div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
        {LEGEND_ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <StateChip state={s} />
            <span>{letters ? `${STATE_CODE[s]} in the week grid. ` : ""}{STATE_HELP[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Now: the nurse's working list ---------- */

function NowView({ enc, orders, now, canRecord, onOpen, onPrn }: { enc: Encounter; orders: MarOrder[]; now: number; canRecord: boolean; onOpen: (d: DoseSlot) => void; onPrn: (o: MarOrder) => void }) {
  const all = dosesBetween(enc, 0, now + 12 * HOUR, now);
  const rank: Partial<Record<DoseState, number>> = { overdue: 0, due: 1, scheduled: 2 };
  const pending = all.filter((d) => !d.record).sort((a, b) => (rank[a.state] ?? 9) - (rank[b.state] ?? 9) || a.time - b.time);
  const overdue = pending.filter((d) => d.state === "overdue").length;
  const due = pending.filter((d) => d.state === "due").length;
  const prn = orders.filter((o) => o.kind === "prn");
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
        <span className="font-medium">Now {hm(now)}</span>
        {overdue > 0 && <Badge tone="danger">{overdue} Overdue</Badge>}
        {due > 0 && <Badge tone="info">{due} Due Now</Badge>}
        {overdue + due === 0 && <Badge tone="ok">Nothing Due Now</Badge>}
        <span className="text-xs text-muted-foreground">Overdue first, then due now, then the next 12 hours.</span>
      </div>
      <Table>
        <thead><tr><Th>Status</Th><Th>Due</Th><Th>Medicine</Th><Th>Action</Th></tr></thead>
        <tbody>
          {pending.length === 0 && (
            <tr><Td colSpan={4}><Empty>No doses are due in the next 12 hours. Open the Day or Week view to see what comes later.</Empty></Td></tr>
          )}
          {pending.map((d) => (
            <tr key={d.id} className={cn(d.state === "overdue" && "bg-destructive/6")}>
              <Td><StateChip state={d.state} /></Td>
              <Td className="whitespace-nowrap tabular-nums">
                <div className="font-medium">{hm(d.time)}</div>
                {startOfDay(d.time) !== startOfDay(now) && <div className="text-xs text-muted-foreground">{dayLabel(d.time)}</div>}
                {d.state === "overdue" && <div className="text-xs text-destructive">{Math.round((now - d.time) / 60_000)} minutes late</div>}
              </Td>
              <Td><OrderCell o={d.order} /></Td>
              <Td>
                <span title={canRecord ? undefined : "Your role cannot record doses"}>
                  <Button size="sm" variant={d.state === "scheduled" ? "secondary" : "primary"} disabled={!canRecord} onClick={() => onOpen(d)}>Record Dose</Button>
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {prn.length > 0 && (
        <div className="border-t border-border">
          <div className="px-4 pt-3 text-sm font-semibold">As-Needed Medicines</div>
          <p className="px-4 pb-2 text-xs text-muted-foreground">These have no set time. Record a dose when you give one, with the reason.</p>
          <Table>
            <thead><tr><Th>Medicine</Th><Th>Last Given</Th><Th>Action</Th></tr></thead>
            <tbody>
              {prn.map((o) => {
                const last = lastGiven(enc.visitNumber, o.itemId);
                const since = last ? Math.round((now - new Date(last.at).getTime()) / 60_000) : undefined;
                const tooSoon = since !== undefined && o.minGapMinutes !== undefined && since < o.minGapMinutes;
                return (
                  <tr key={o.itemId}>
                    <Td><OrderCell o={o} /></Td>
                    <Td className="text-xs">
                      {last ? <>{dateTime(last.at)} by {last.by}</> : "Not given yet"}
                      {tooSoon && <div className="mt-0.5 flex items-center gap-1 font-medium text-warn"><AlertTriangle className="size-3.5" aria-hidden="true" /> Given {since} minutes ago. Usual gap is {Math.round((o.minGapMinutes as number) / 60)} hours.</div>}
                    </Td>
                    <Td>
                      <span title={!canRecord ? "Your role cannot record doses" : !o.live ? "No more doses for this prescription" : undefined}>
                        <Button size="sm" disabled={!canRecord || !o.live} onClick={() => onPrn(o)}>Record As-Needed Dose</Button>
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}

/* ---------- Day grid: medicines against dose times ---------- */

function DayGrid({ enc, orders, day, now, onOpen }: { enc: Encounter; orders: MarOrder[]; day: number; now: number; onOpen: (d: DoseSlot) => void }) {
  const doses = dosesBetween(enc, day, addDays(day, 1) - 1, now);
  const times = [...new Set(doses.filter((d) => d.dueAt !== null).map((d) => d.time))].sort((a, b) => a - b);
  const anyPrn = orders.some((o) => o.kind === "prn");
  if (doses.length === 0 && !anyPrn) return <Empty>No doses on {dayLabel(day)}. Pick another day, or go back to Today.</Empty>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Medicine</Th>
          {times.map((t) => <Th key={t} className="text-center tabular-nums">{hm(t)}</Th>)}
          {anyPrn && <Th>As Needed</Th>}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const mine = doses.filter((d) => d.order.itemId === o.itemId);
          const loose = mine.filter((d) => d.dueAt === null);
          return (
            <tr key={o.itemId}>
              <Td><OrderCell o={o} /></Td>
              {times.map((t) => {
                const d = mine.find((x) => x.dueAt === t);
                return <Td key={t} className="text-center">{d ? <DoseButton d={d} onOpen={onOpen} /> : <span className="text-xs text-muted-foreground" aria-label="No dose">-</span>}</Td>;
              })}
              {anyPrn && (
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {loose.map((d) => <DoseButton key={d.id} d={d} onOpen={onOpen} />)}
                    {o.kind === "prn" && loose.length === 0 && <span className="text-xs text-muted-foreground">None given</span>}
                  </div>
                </Td>
              )}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/* ---------- Week grid: medicines against days ---------- */

function WeekGrid({ enc, orders, day, now, onOpen }: { enc: Encounter; orders: MarOrder[]; day: number; now: number; onOpen: (d: DoseSlot) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(day, i - 3));
  const doses = dosesBetween(enc, days[0], addDays(days[6], 1) - 1, now);
  const today = startOfDay(now);
  return (
    <Table>
      <thead>
        <tr>
          <Th>Medicine</Th>
          {days.map((t) => <Th key={t} className={cn(t === today && "bg-move/12")}>{dayLabel(t)}{t === today ? " (today)" : ""}</Th>)}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.itemId}>
            <Td><OrderCell o={o} /></Td>
            {days.map((t) => {
              const cell = doses.filter((d) => d.order.itemId === o.itemId && startOfDay(d.time) === t);
              return (
                <Td key={t} className="align-top">
                  <div className="flex flex-col items-start gap-1">
                    {cell.map((d) => <DoseButton key={d.id} d={d} compact onOpen={onOpen} />)}
                    {cell.length === 0 && <span className="text-xs text-muted-foreground" aria-label="No dose">-</span>}
                  </div>
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/* ---------- recording a dose ---------- */

const RIGHT_LABEL: Record<Right, string> = { patient: "Right patient", drug: "Right drug", dose: "Right dose", route: "Right route", time: "Right time" };

function DoseForm({ enc, patient, order, slot, onClose }: { enc: Encounter; patient: Patient; order: MarOrder; slot: number | null; onClose: () => void }) {
  const prn = order.kind === "prn";
  // An as-needed dose is recorded only when given, so that is the only choice. A dose with a set time starts with no outcome.
  const [outcome, setOutcome] = React.useState<DoseOutcome | null>(prn ? "given" : null);
  const [rights, setRights] = React.useState<Partial<Record<Right, boolean>>>({});
  const [atText, setAtText] = React.useState(() => toLocalInput(new Date()));
  const [reason, setReason] = React.useState("");
  const [timingReason, setTimingReason] = React.useState("");
  const [prnReason, setPrnReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [witnessName, setWitnessName] = React.useState("");
  const [witnessNo, setWitnessNo] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);

  const at = new Date(atText).getTime();
  const off = slot !== null && !Number.isNaN(at) ? Math.round((at - slot) / 60_000) : 0;
  const offTime = Math.abs(off) > DOSE_WINDOW_MIN;
  const rightValue: Record<Right, string> = {
    patient: `${patientName(patient)}, Health ID ${patient.healthId}`,
    drug: order.drugText,
    dose: order.doseText,
    route: order.routeText,
    time: slot !== null ? `due ${hm(slot)}${dayLabel(slot) !== dayLabel(Date.now()) ? ` on ${dayLabel(slot)}` : ""}` : order.frequencyText,
  };
  const otherNote = reason === "Other" || timingReason === "Other" || prnReason === "Other";

  function save() {
    if (!outcome) return;
    if (outcome === "given" && Number.isNaN(at)) { setErrors(["Enter the time the dose was given."]); return; }
    const res = recordDose({
      visit: enc.visitNumber, itemId: order.itemId, slot: slot ?? undefined, outcome,
      at: outcome === "given" ? at : undefined, rights, reason, note,
      timingReason: offTime ? timingReason : undefined,
      witness: order.highAlert ? { name: witnessName, staffNo: witnessNo } : undefined,
      prnReason: prn ? prnReason : undefined,
    });
    if (!res.ok) { setErrors(res.errors); return; }
    pushToast({ tone: outcome === "given" ? "ok" : "warn", text: `${order.drug.generic} recorded as ${OUTCOME_LABEL[outcome].toLowerCase()}`, detail: `By ${res.record.by} at ${hm(new Date(res.record.at).getTime())}.` });
    onClose();
  }

  return (
    <div className="border-b border-border bg-muted/30 px-4 py-4" role="region" aria-label="Record a dose">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[0.9375rem] font-semibold">Record Dose: {order.drugText}</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            {order.doseText} · {order.routeText} · {order.frequencyText}{slot !== null ? ` · due ${dateTime(slot)}` : ""}
          </p>
        </div>
        <Button size="sm" onClick={onClose}>Close Without Saving</Button>
      </div>
      <div className="mt-2"><AllergyInline enc={enc} /></div>
      {order.highAlert && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> High-alert medicine ({order.highAlert}). A second nurse must check the drug and the dose with you.
        </p>
      )}

      {!prn && (
        <div className="mt-3">
          <div className="mb-1.5 text-sm font-medium">What happened with this dose?<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Outcome">
            {(Object.keys(OUTCOME_LABEL) as DoseOutcome[]).map((o) => (
              <Button key={o} aria-pressed={outcome === o} variant={outcome === o ? "primary" : "secondary"} onClick={() => { setOutcome(o); setReason(""); setErrors([]); }}>
                {OUTCOME_LABEL[o]}
              </Button>
            ))}
          </div>
          {!outcome && <p className="mt-1.5 text-xs text-muted-foreground">Nothing is saved until you choose one and save.</p>}
        </div>
      )}

      {outcome === "given" && (
        <div className="mt-4 space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Confirm the five rights<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></legend>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {RIGHTS.map((r) => (
                <li key={r}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={!!rights[r]} onChange={(e) => setRights({ ...rights, [r]: e.target.checked })} />
                    <span><span className="font-medium">{RIGHT_LABEL[r]}</span><span className="block text-xs text-muted-foreground">{rightValue[r]}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Time Given" required hint={slot !== null && off !== 0 ? `${Math.abs(off)} minutes ${off < 0 ? "early" : "late"}` : undefined}>
              <Input type="datetime-local" value={atText} max={toLocalInput(new Date())} onChange={(e) => setAtText(e.target.value)} />
            </Field>
            {offTime && (
              <Field label={`Reason For The ${off < 0 ? "Early" : "Late"} Dose`} required hint={`More than ${DOSE_WINDOW_MIN} minutes from the dose time.`}>
                <Select value={timingReason} onChange={(e) => setTimingReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {TIMING_REASONS.map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
            )}
            {prn && (
              <Field label="Reason For The Dose" required hint={order.minGapMinutes ? `Usual gap between doses: ${Math.round(order.minGapMinutes / 60)} hours.` : undefined}>
                <Select value={prnReason} onChange={(e) => setPrnReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  {PRN_REASONS.map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
            )}
            {order.highAlert && (
              <>
                <Field label="Second Nurse Name" required hint="The second nurse types their own name.">
                  <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Second Nurse Staff Number" required>
                  <Input value={witnessNo} onChange={(e) => setWitnessNo(e.target.value)} autoComplete="off" />
                </Field>
              </>
            )}
          </div>
        </div>
      )}

      {outcome && outcome !== "given" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={`Reason The Dose Was ${OUTCOME_LABEL[outcome]}`} required>
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose a reason</option>
              {REASONS_FOR[outcome].map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        </div>
      )}

      {outcome && (
        <div className="mt-3 max-w-2xl">
          <Field label="Note" required={otherNote} hint={otherNote ? "You chose Other. Write the reason here." : undefined}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="bg-card" />
          </Field>
          {prn && <p className="mt-1.5 text-xs text-muted-foreground">After the dose works, open it in Recorded Doses and add how the patient responded.</p>}
        </div>
      )}

      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!outcome} onClick={save}>{outcome ? `Save As ${OUTCOME_LABEL[outcome]}` : "Save"}</Button>
        <RequiredNote />
      </div>
    </div>
  );
}

function AllergyInline({ enc }: { enc: Encounter }) {
  if (!enc.allergies.length) return <span className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-ok"><IconShieldCheck className="size-4" stroke={2} aria-hidden="true" /> No allergies recorded for this patient</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[0.8125rem] font-medium text-destructive">
      <IconShieldExclamation className="size-4" stroke={2} aria-hidden="true" /> Allergies: {enc.allergies.map((a) => a.text).join(", ")}
    </span>
  );
}

/* ---------- a recorded dose ---------- */

function recordFacts(r: AdminRecord): string[] {
  const out: string[] = [];
  if (r.slot) out.push(`Due ${dateTime(r.slot)}`);
  if (r.offMinutes !== undefined && Math.abs(r.offMinutes) > DOSE_WINDOW_MIN) out.push(`${Math.abs(r.offMinutes)} minutes ${r.offMinutes < 0 ? "early" : "late"}: ${r.timingReason ?? "no reason"}`);
  if (r.reason) out.push(`Reason: ${r.reason}`);
  if (r.prnReason) out.push(`Given for: ${r.prnReason}`);
  if (r.witness) out.push(`Second nurse: ${r.witness.name} (${r.witness.staffNo})`);
  if (r.note) out.push(`Note: ${r.note}`);
  if (r.effect) out.push(`Effect: ${r.effect.text} (${r.effect.by}, ${dateTime(r.effect.at)})`);
  if (r.voided) out.push(`Entered in error: ${r.voided.reason} (${r.voided.by}, ${dateTime(r.voided.at)})`);
  return out;
}

function RecordBadge({ r }: { r: AdminRecord }) {
  return r.voided ? <Badge tone="neutral">Entered In Error</Badge> : <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>;
}

function DoseDetail({ record, canRecord, onClose }: { record: AdminRecord; canRecord: boolean; onClose: () => void }) {
  const [effect, setEffect] = React.useState("");
  const [voiding, setVoiding] = React.useState(false);
  const [why, setWhy] = React.useState("");
  const needsEffect = !!record.prnReason && record.outcome === "given" && !record.effect && !record.voided;
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-4" role="region" aria-label="Recorded dose">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-semibold">{record.drugText} <RecordBadge r={record} /></h3>
          <p className="text-[0.8125rem] text-muted-foreground">{record.doseText} · {record.routeText}</p>
          <p className="mt-1 text-sm">{OUTCOME_LABEL[record.outcome]} by <strong>{record.by}</strong> ({record.byRole}) on {dateTime(record.at)}</p>
        </div>
        <Button size="sm" onClick={onClose}>Close</Button>
      </div>
      <ul className="mt-2 space-y-0.5 text-[0.8125rem]">
        {recordFacts(record).map((f) => <li key={f}>{f}</li>)}
      </ul>
      {needsEffect && canRecord && (
        <div className="mt-3 max-w-2xl">
          <Field label="How Did The Patient Respond?" required hint="For example: pain went from 7 to 3 after 45 minutes.">
            <Textarea value={effect} onChange={(e) => setEffect(e.target.value)} rows={2} className="bg-card" />
          </Field>
          <Button className="mt-2" variant="primary" disabled={!effect.trim()} onClick={() => { if (addEffectNote(record.id, effect)) { pushToast({ tone: "ok", text: "Effect note saved" }); setEffect(""); } }}>Save Effect Note</Button>
        </div>
      )}
      {!record.voided && canRecord && (
        <div className="mt-3">
          {!voiding ? (
            <Button size="sm" variant="danger" onClick={() => setVoiding(true)}>Mark As Entered In Error</Button>
          ) : (
            <div className="max-w-2xl space-y-2">
              <Field label="Why Is This Record Wrong?" required hint="The record stays in the history, marked as an error. The dose can then be recorded again.">
                <Input value={why} onChange={(e) => setWhy(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button variant="danger" disabled={!why.trim()} onClick={() => { if (voidRecord(record.id, why)) { pushToast({ tone: "warn", text: "Record marked as entered in error" }); onClose(); } }}>Confirm Entered In Error</Button>
                <Button onClick={() => setVoiding(false)}>Keep The Record</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function History({ records, onOpen }: { records: AdminRecord[]; onOpen: (id: string) => void }) {
  if (records.length === 0) return <Empty>No doses recorded yet. Open the Now view and record the doses that are due.</Empty>;
  return (
    <Table>
      <thead><tr><Th>Status</Th><Th>Medicine</Th><Th>Recorded By</Th><Th>When</Th><Th>Details</Th><Th>Action</Th></tr></thead>
      <tbody>
        {records.map((r) => {
          const waitingEffect = !!r.prnReason && r.outcome === "given" && !r.effect && !r.voided;
          return (
            <tr key={r.id} className={cn(r.voided && "text-muted-foreground")}>
              <Td><RecordBadge r={r} /></Td>
              <Td>
                <div className={cn("font-medium", r.voided && "line-through")}>{r.drugText}</div>
                <div className="text-xs text-muted-foreground">{r.doseText} · {r.routeText}{r.highAlert ? ` · high alert (${r.highAlert})` : ""}</div>
              </Td>
              <Td><div>{r.by}</div><div className="text-xs text-muted-foreground">{r.byRole}</div></Td>
              <Td className="whitespace-nowrap tabular-nums">{dateTime(r.at)}</Td>
              <Td className="max-w-[22rem] text-xs">
                {recordFacts(r).map((f) => <div key={f}>{f}</div>)}
                {waitingEffect && <div className="font-medium text-warn">Effect note not written yet</div>}
              </Td>
              <Td><Button size="sm" onClick={() => onOpen(r.id)}>{waitingEffect ? "Add Effect Note" : "Open"}</Button></Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
