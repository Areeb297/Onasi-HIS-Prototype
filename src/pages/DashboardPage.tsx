import * as React from "react";
import { IconAmbulance, IconBed, IconBuildingHospital, IconCash, IconCashBanknote, IconClockDollar, IconReceipt2, IconSend, IconStethoscope, IconUsers } from "@tabler/icons-react";
import { CalendarDays } from "lucide-react";
import { Money } from "@/components/Money";
import { AgentWorkCard } from "@/components/ai/AgentWorkCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { HBars, Ring, RingGauge, SegmentedBar, Stacked, VBars } from "@/components/charts/SimpleCharts";
import { CTAS_COLORS, REST, VIZ } from "@/components/charts/viz";
import { DeltaPill, GlassBackdrop, GlassCard, GlassPillSwitch, GlassStagger, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useAppointments } from "@/lib/appointments";
import { CLAIMS_24H, RANGES, VISITS_LAST_WEEK, liveCounts, operations, patientMix, tileTrend, todayAgenda, visitTrend, type AgendaItem, type RangeId } from "@/lib/dashboard-data";
import { useDocs } from "@/lib/docs";
import { useLab } from "@/lib/lab";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can } from "@/lib/session";
import { useHis } from "@/lib/store";
import { useTheatre } from "@/lib/theatre";
import { useVitals } from "@/lib/vitals";
import { fmtLongDate, fmtTime } from "@/lib/format";

const money = (v: unknown) => Number(v).toLocaleString("en-US");
const sar = (v: unknown) => <Money value={Number(v)} />;
/** Left edge colour for each kind of item on today's list. */
const KIND = { Clinic: VIZ[0], Online: VIZ[1], Theatre: VIZ[3] } as const; // brand cyan, deep teal, Dark Green (Minty White in dark)

/**
 * Operational overview: the first page of the HIS. Census, beds, emergency, NPHIES and today's list are live.
 * Money, appointments, providers, the claims goal and the stat-tile history are sample figures that follow the range.
 */
export function DashboardPage() {
  useHis(); useLab(); useRad(); useRx(); useDocs(); useVitals(); useAppointments(); useTheatre();
  const [range, setRange] = React.useState<RangeId>("This month");
  const c = liveCounts();
  const mix = patientMix();
  const ops = operations(range);
  const trend = visitTrend().map((d) => ({ ...d, Total: d.Outpatient + d.Inpatient + d.Emergency }));
  const agenda = todayAgenda();
  const occ = c.bedsTotal ? Math.round((c.bedsUsed / c.bedsTotal) * 100) : 0;
  const appts = ops.appointments.online + ops.appointments.visit;
  const billing = can("billing");
  const t = (metric: string, current: number) => { const x = tileTrend(metric, current, range); return { points: x.points, current: x.current, prev: x.prev, against: x.against }; };
  const today = fmtLongDate(new Date());
  const week = { Outpatient: 0, Inpatient: 0, Emergency: 0 };
  for (const d of trend) { week.Outpatient += d.Outpatient; week.Inpatient += d.Inpatient; week.Emergency += d.Emergency; }
  const weekTotal = week.Outpatient + week.Inpatient + week.Emergency;
  const lastWeekTotal = VISITS_LAST_WEEK.Outpatient + VISITS_LAST_WEEK.Inpatient + VISITS_LAST_WEEK.Emergency;
  const edOnTime = c.er ? ((c.er - c.edLate) / c.er) * 100 : 100;

  return (
    <GlassBackdrop className="viz">
      <h1 className="sr-only">Dashboard</h1>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground"><CalendarDays className="size-4" aria-hidden="true" /> Date Range</span>
        <GlassPillSwitch label="Date range" value={range} options={RANGES} onChange={setRange} />
        <span className="ml-auto hidden text-xs text-muted-foreground md:block">{today}</span>
      </div>

      <KpiStrip label="Key numbers" className="grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile icon={<IconUsers stroke={1.75} />} label="Patients" value={mix.total.toLocaleString("en-US")} {...t("patients", mix.total)} kind="count" note="registered patients" />
        <KpiTile icon={<IconStethoscope stroke={1.75} />} label="OPD Patients" value={String(c.opd)} {...t("opd", c.opd)} kind="count" note="in the clinics now" />
        <KpiTile icon={<IconBed stroke={1.75} />} label="IPD Patients" value={String(c.ipd)} {...t("ipd", c.ipd)} kind="count" note={`active admits, ${occ}% of beds`} tone={occ >= 90 ? "danger" : undefined} accent={occ >= 90 ? "danger" : "brand"} />
        <KpiTile icon={<IconAmbulance stroke={1.75} />} label="Emergency Patients" value={String(c.er)} {...t("er", c.er)} kind="count" note={c.edLate ? `${c.edLate} past the CTAS target` : "all inside the CTAS target"} tone={c.edLate ? "danger" : "ok"} accent={c.edLate ? "danger" : "brand"} />
        {billing
          ? <KpiTile icon={<IconReceipt2 stroke={1.75} />} className="col-span-2 lg:col-span-1" label="Invoice Revenue" value={<Money value={ops.revenue.generated} />} {...t("revenue", ops.revenue.generated)} goodWhen="up" note={`${ops.revenue.invoices} invoices`} />
          : <KpiTile icon={<IconSend stroke={1.75} />} className="col-span-2 lg:col-span-1" label="Ready To Send To NPHIES" value={String(c.ready)} {...t("nphies", c.ready)} kind="count" note={c.rejected ? `${c.rejected} refused` : "none refused"} tone={c.rejected ? "danger" : undefined} />}
      </KpiStrip>

      {can("ai.use") && <AgentWorkCard />}

      <GlassStagger className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" gap={0.06}>
        <ChartCard className="lg:col-span-2" title="Visits This Week" note="All visits per day, last 7 days. Today adds the patients in the building now. Sample figures."
          actions={<DeltaPill current={weekTotal} prev={lastWeekTotal} goodWhen="neutral" against="last week" />}
          rows={trend} columns={["day", "Outpatient", "Inpatient", "Emergency", "Total"]} height={250}
          footer={<dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><dt>This week</dt><dd className="text-base font-semibold tabular-nums text-foreground">{weekTotal.toLocaleString("en-US")}</dd></div>
            {(["Outpatient", "Inpatient", "Emergency"] as const).map((k) => <div key={k}><dt>{k}</dt><dd className="text-base font-semibold tabular-nums text-foreground">{week[k].toLocaleString("en-US")}</dd></div>)}
          </dl>}>
          <VBars data={trend} name="day" value="Total" label="Visits" highlightIndex={trend.length - 1} grow
            extra={(r) => `Outpatient ${r.Outpatient}, Inpatient ${r.Inpatient}, Emergency ${r.Emergency}`} />
        </ChartCard>

        <TodayCard items={agenda} className="lg:col-span-2 xl:col-span-1 xl:row-span-2" />

        <GlassCard solid className="flex flex-col">
          <header className="px-5 pt-4">
            <h2 className="text-[0.9375rem] font-semibold">Goals</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Where the hospital stands against its targets. The tick marks the target.</p>
          </header>
          <div className="grid flex-1 grid-cols-3 items-start gap-2 px-3 pb-4 pt-4">
            <RingGauge value={edOnTime} target={90} label="Seen In CTAS Time" caption="Emergency, live. Target 90%" />
            <RingGauge value={occ} target={85} better="lower" label="Bed Occupancy" caption="Live. Target 85% or less" />
            <RingGauge value={CLAIMS_24H[range]} target={90} label="Claims Sent In 24 Hours" caption="Sample. Target 90%" />
          </div>
        </GlassCard>

        <ChartCard title="Appointments: online and visit" note="Booked online, or made at the desk." rows={[{ Mode: "Visit", Appointments: ops.appointments.visit }, { Mode: "Online", Appointments: ops.appointments.online }]} columns={["Mode", "Appointments"]} height="auto">
          <div className="flex h-full flex-col items-center justify-center gap-4 px-3 pb-3 pt-2">
            <Ring total={appts.toLocaleString("en-US")} caption="appointments" data={[{ name: "Visit", value: ops.appointments.visit, color: VIZ[0] }, { name: "Online", value: ops.appointments.online, color: VIZ[1] }]} />
            <dl className="grid w-full grid-cols-2 gap-3 border-t border-border/70 pt-3">
              {[["Made at the desk", ops.appointments.visit, VIZ[0]], ["Booked online", ops.appointments.online, VIZ[1]]].map(([l, n, col]) => (
                <div key={l as string}><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-2.5 rounded-full" style={{ background: col as string }} aria-hidden="true" />{l}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{(n as number).toLocaleString("en-US")} <span className="text-xs font-normal text-muted-foreground">{Math.round(((n as number) / Math.max(1, appts)) * 100)}%</span></dd></div>
              ))}
            </dl>
          </div>
        </ChartCard>

        <ChartCard title="Emergency patients by triage level" note="Live. CTAS 1 is the most urgent." rows={c.ctas.map((x) => ({ Level: x.level, Patients: x.patients }))} columns={["Level", "Patients"]} height={230}>
          {/* Triage levels keep the standard CTAS colour code, not brand colours: clinicians read the level by its colour. */}
          <VBars data={c.ctas} name="level" value="patients" label="Patients" colors={CTAS_COLORS} />
        </ChartCard>

        <ChartCard title="Bed availability" note={`Live. ${c.bedsUsed} of ${c.bedsTotal} beds in use, ${occ}% utilization.`} legend={[{ label: "In use", color: VIZ[0] }, { label: "Free", color: REST }]} rows={c.wards.map((w) => ({ Ward: w.ward, "In use": w.used, Free: w.free, "Not ready": w.notReady }))} columns={["Ward", "In use", "Free", "Not ready"]} height={230}>
          <Stacked horizontal data={c.wards} name="ward" width={118} series={[{ key: "used", label: "In use", color: VIZ[0] }, { key: "free", label: "Free", color: REST }]} />
        </ChartCard>

        <ChartCard title="NPHIES clinical messages by state" note="Live, from the NPHIES Clinical send list." rows={c.sendStates.map((x) => ({ State: x.state, Items: x.items }))} columns={["State", "Items"]} height={230}>
          <HBars data={c.sendStates} name="state" value="items" label="Items" width={128} />
        </ChartCard>

        <ChartCard title="Patients by gender" note="Live, registered patients." rows={mix.gender.map((g) => ({ Gender: g.name, Patients: g.patients }))} columns={["Gender", "Patients"]} height="auto">
          <div className="px-3 pb-2 pt-4">
            <SegmentedBar unit="patients" parts={mix.gender.map((g, i) => ({ name: g.name, value: g.patients, color: VIZ[i], dark: i === 0 }))} />
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
              {mix.gender.map((g) => <div key={g.name}><dt className="text-xs text-muted-foreground">{g.name}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{g.patients}</dd></div>)}
            </dl>
          </div>
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Patients by nationality" note="Live, registered patients. The six largest groups." rows={mix.nationality.map((g) => ({ Nationality: g.name, Patients: g.patients }))} columns={["Nationality", "Patients"]} height={Math.max(150, 40 + mix.nationality.length * 34)}>
          <HBars data={mix.nationality} name="name" value="patients" label="Patients" width={110} />
        </ChartCard>
      </GlassStagger>

      {billing && (
        <>
          <h2 className="mb-3 mt-8 text-base font-semibold">Money</h2>
          <KpiStrip label="Money" className="sm:grid-cols-3">
            <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Generated" value={<Money value={ops.revenue.generated} />} {...t("revenue", ops.revenue.generated)} goodWhen="up" note={`${ops.revenue.invoices} invoices in this range`} />
            <KpiTile icon={<IconCash stroke={1.75} />} label="Collected" value={<Money value={ops.revenue.collected} />} {...t("collected", ops.revenue.collected)} goodWhen="up" note={`${Math.round((ops.revenue.collected / Math.max(1, ops.revenue.generated)) * 100)}% of generated`} tone="ok" />
            <KpiTile icon={<IconClockDollar stroke={1.75} />} label="Outstanding" value={<Money value={ops.revenue.outstanding} />} {...t("outstanding", ops.revenue.outstanding)} goodWhen="down" note="Not collected yet" tone="warn" accent="warn" />
          </KpiStrip>
          <GlassStagger className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" gap={0.06}>
            <ChartCard title="Revenue by department" note="Sample figures." rows={ops.departments.map((d) => ({ Department: d.department, Revenue: d.revenue }))} columns={["Department", { key: "Revenue", format: sar }]} height={250}>
              <HBars data={ops.departments} name="department" value="revenue" label="Revenue" width={118} money />
            </ChartCard>
            <ChartCard title="Payment generation by insurance company" note="Insurance share. Sample figures." legend={[{ label: "Collected", color: VIZ[0] }, { label: "Outstanding", color: VIZ[1] }]} rows={ops.payers.map((p) => ({ Payer: p.payer, Collected: p.Collected, Outstanding: p.Outstanding }))} columns={["Payer", { key: "Collected", format: sar }, { key: "Outstanding", format: sar }]} height={250}>
              <Stacked horizontal data={ops.payers} name="payer" width={92} series={[{ key: "Collected", color: VIZ[0] }, { key: "Outstanding", color: VIZ[1] }]} money format={money} />
            </ChartCard>
            <ChartCard title="Cash, card and online payments" note="Receipts by payment method. Sample figures." rows={ops.payments.map((p) => ({ Method: p.method, Amount: p.amount }))} columns={["Method", { key: "Amount", format: sar }]} height={250}>
              <VBars data={ops.payments} name="method" value="amount" label="Amount" money />
            </ChartCard>
          </GlassStagger>
        </>
      )}

      <GlassCard solid lift={false} className="mt-6 overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-semibold"><IconBuildingHospital className="mr-1.5 inline size-4 align-[-2px] text-primary" stroke={1.75} aria-hidden="true" />Top providers</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Ranked by appointments in the chosen range. Sample figures.</p>
          </div>
          <Button size="sm" onClick={() => navigate("/m/appointments")}>Open Appointments</Button>
        </header>
        <Table>
          <thead><tr><Th>Provider</Th><Th>Department</Th><Th numeric>Appointments</Th><Th numeric>Completed</Th><Th numeric>No Show</Th><Th numeric>Cancelled</Th></tr></thead>
          <tbody>
            {ops.providers.map((p) => (
              <tr key={p.provider}>
                <Td className="font-medium">{p.provider}</Td><Td>{p.department}</Td>
                <Td numeric>{p.appointments}</Td><Td numeric>{p.completed}</Td><Td numeric>{p.noShow}</Td><Td numeric>{p.cancelled}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </GlassCard>
    </GlassBackdrop>
  );
}

/** Today's appointments and theatre cases in time order, each a small glass row with a coloured left edge. */
function TodayCard({ items, className }: { items: AgendaItem[]; className?: string }) {
  const nowHm = fmtTime(new Date());
  const next = items.findIndex((i) => !i.done && i.end >= nowHm);
  return (
    <GlassCard solid className={cn("flex min-h-0 flex-col", className)}>
      <header className="flex items-start gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[0.9375rem] font-semibold">Today</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{items.length ? `${items.length} appointments and theatre cases, in time order. Live.` : "Live, from Appointments and Theatre."}</p>
        </div>
      </header>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-2.5 text-xs text-muted-foreground">
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => <li key={k} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-1 rounded-full" style={{ background: KIND[k] }} />{k === "Clinic" ? "Clinic Visit" : k === "Online" ? "Online Visit" : "Theatre Case"}</li>)}
      </ul>
      {items.length ? (
        <ol className="mt-3 flex-1 space-y-2 overflow-y-auto px-4 pb-4 xl:max-h-[34rem]">
          {items.map((i, n) => (
            <li key={i.id}>
              <button type="button" onClick={() => navigate(i.route)} aria-label={`${i.time} to ${i.end}, ${i.kind === "Theatre" ? "theatre case" : `${i.kind.toLowerCase()} visit`}, ${i.title}, ${i.detail}, ${i.status}`}
                className={cn("glass-row relative flex w-full items-start gap-3 overflow-hidden rounded-xl py-2.5 pl-4 pr-3 text-left transition-colors hover:bg-card focus-visible:outline-2 focus-visible:outline-ring", i.done && "opacity-75")}>
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: KIND[i.kind] }} />
                <span className="w-11 shrink-0 pt-px text-[0.8125rem] font-semibold tabular-nums">{i.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-medium">{i.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{i.detail}</span>
                </span>
                {n === next ? <Badge tone="primary" className="shrink-0">Next</Badge> : <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{i.status}</span>}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing is booked for today yet.</p>
          <Button size="sm" onClick={() => navigate("/m/appointments")}>Open Appointments</Button>
        </div>
      )}
    </GlassCard>
  );
}
