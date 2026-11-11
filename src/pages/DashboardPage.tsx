import * as React from "react";
import { IconActivityHeartbeat } from "@tabler/icons-react";
import { CalendarDays } from "lucide-react";
import { Money } from "@/components/Money";
import { ChartCard, StatTile } from "@/components/charts/ChartCard";
import { HBars, Lines, Ring, Stacked, VBars } from "@/components/charts/SimpleCharts";
import { Button, Card, CardHeader, Table, Td, Th, cn } from "@/components/ui/primitives";
import { RANGES, liveCounts, operations, patientMix, visitTrend, type RangeId } from "@/lib/dashboard-data";
import { useDocs } from "@/lib/docs";
import { useLab } from "@/lib/lab";
import { useRad } from "@/lib/radiology";
import { navigate } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { useVitals } from "@/lib/vitals";

const SERIES = [
  { key: "Outpatient", color: "var(--chart-1)" },
  { key: "Inpatient", color: "var(--chart-2)" },
  { key: "Emergency", color: "var(--chart-3)" },
];
const money = (v: unknown) => Number(v).toLocaleString("en-US");

/**
 * Operational overview: the first page of the HIS. Census, beds, emergency and NPHIES numbers are counted live.
 * Money, appointments and providers are sample figures that follow the chosen date range.
 */
export function DashboardPage() {
  useHis(); useLab(); useRad(); useRx(); useDocs(); useVitals();
  const { user } = useSession();
  const [range, setRange] = React.useState<RangeId>("This month");
  const c = liveCounts();
  const mix = patientMix();
  const ops = operations(range);
  const trend = visitTrend();
  const occ = c.bedsTotal ? Math.round((c.bedsUsed / c.bedsTotal) * 100) : 0;
  const appts = ops.appointments.online + ops.appointments.visit;
  const billing = can("billing");

  return (
    <div>
      <header className="mb-4 overflow-hidden rounded-xl bg-[var(--brand-deep)] text-white">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[var(--brand-mint)]"><IconActivityHeartbeat className="size-7" stroke={1.75} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1 basis-72">
            <h1 className="text-xl font-semibold tracking-tight">Operational overview</h1>
            <p className="mt-1 text-sm text-white/80">Good day, {user.name}. Live census, money and activity for the hospital.</p>
          </div>
          {can("ai.use") && (
            <button type="button" onClick={() => navigate("/agents")} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand-mint)] px-4 text-sm font-semibold text-[var(--brand-deep)] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Open Onasi AI Agents
            </button>
          )}
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5" role="group" aria-label="Date range">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground"><CalendarDays className="size-4" aria-hidden="true" /> Date range</span>
        {RANGES.map((r) => (
          <button key={r} type="button" aria-pressed={r === range} onClick={() => setRange(r)} className={cn("rounded-full border px-3 py-1 text-[0.8125rem] font-medium transition-colors", r === range ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
            {r}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Patients" value={String(mix.total)} note="registered patients" />
        <StatTile label="OPD patients" value={String(c.opd)} note="in the clinics now" />
        <StatTile label="IPD patients" value={String(c.ipd)} note={`active admits, ${occ}% of beds`} tone={occ >= 90 ? "danger" : undefined} />
        <StatTile label="Emergency patients" value={String(c.er)} note={c.edLate ? `${c.edLate} past the CTAS target` : "all inside the CTAS target"} tone={c.edLate ? "danger" : "ok"} />
        {billing
          ? <StatTile label="Invoice revenue" value={<Money value={ops.revenue.generated} />} note={`${ops.revenue.invoices} invoices`} />
          : <StatTile label="Ready to send to NPHIES" value={String(c.ready)} note={c.rejected ? `${c.rejected} refused` : "none refused"} tone={c.rejected ? "danger" : undefined} />}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ChartCard className="xl:col-span-2" title="Visits per day, last 7 days" note="Sample figures." legend={SERIES.map((s) => ({ label: s.key, color: s.color }))} rows={trend} columns={["day", "Outpatient", "Inpatient", "Emergency"]} height={270}>
          <Lines data={trend} name="day" series={SERIES} />
        </ChartCard>

        <ChartCard title="Appointments: online and visit" note="Booked online, or made at the desk." legend={[{ label: "Online", color: "var(--chart-2)" }, { label: "Visit", color: "var(--chart-1)" }]} rows={[{ Mode: "Online", Appointments: ops.appointments.online }, { Mode: "Visit", Appointments: ops.appointments.visit }]} columns={["Mode", "Appointments"]} height={270}>
          <Ring total={appts.toLocaleString("en-US")} caption="appointments" data={[{ name: "Online", value: ops.appointments.online, color: "var(--chart-2)" }, { name: "Visit", value: ops.appointments.visit, color: "var(--chart-1)" }]} />
        </ChartCard>

        <ChartCard title="Emergency patients by triage level" note="Live. CTAS 1 is the most urgent." rows={c.ctas.map((x) => ({ Level: x.level, Patients: x.patients }))} columns={["Level", "Patients"]} height={240}>
          <VBars data={c.ctas} name="level" value="patients" label="Patients" colors={[1, 2, 3, 4, 5].map((n) => `var(--ctas-${n})`)} />
        </ChartCard>

        <ChartCard title="Bed availability" note={`Live. ${c.bedsUsed} of ${c.bedsTotal} beds in use, ${occ}% utilization.`} legend={[{ label: "In use", color: "var(--chart-2)" }, { label: "Free", color: "var(--border)" }]} rows={c.wards.map((w) => ({ Ward: w.ward, "In use": w.used, Free: w.free }))} columns={["Ward", "In use", "Free"]} height={240}>
          <Stacked horizontal data={c.wards} name="ward" width={124} series={[{ key: "used", color: "var(--chart-2)" }, { key: "free", color: "var(--border)" }]} />
        </ChartCard>

        <ChartCard title="NPHIES clinical messages by state" note="Live, from the NPHIES Clinical send list." rows={c.sendStates.map((x) => ({ State: x.state, Items: x.items }))} columns={["State", "Items"]} height={240}>
          <HBars data={c.sendStates} name="state" value="items" label="Items" width={128} />
        </ChartCard>

        <ChartCard title="Patients by gender" note="Live, registered patients." rows={mix.gender.map((g) => ({ Gender: g.name, Patients: g.patients }))} columns={["Gender", "Patients"]} height={200}>
          <HBars data={mix.gender} name="name" value="patients" label="Patients" color="var(--chart-2)" width={70} />
        </ChartCard>

        <ChartCard className="xl:col-span-2" title="Patients by nationality" note="Live, registered patients." rows={mix.nationality.map((g) => ({ Nationality: g.name, Patients: g.patients }))} columns={["Nationality", "Patients"]} height={200}>
          <HBars data={mix.nationality} name="name" value="patients" label="Patients" width={120} />
        </ChartCard>
      </div>

      {billing && (
        <>
          <h2 className="mb-3 mt-7 text-base font-semibold">Money</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Generated" value={<Money value={ops.revenue.generated} />} note={`${ops.revenue.invoices} invoices in this range`} />
            <StatTile label="Collected" value={<Money value={ops.revenue.collected} />} note={`${Math.round((ops.revenue.collected / Math.max(1, ops.revenue.generated)) * 100)}% of generated`} tone="ok" />
            <StatTile label="Outstanding" value={<Money value={ops.revenue.outstanding} />} note="Not collected yet" tone="warn" />
          </div>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <ChartCard title="Revenue by department" note="In Saudi riyals. Sample figures." rows={ops.departments.map((d) => ({ Department: d.department, "Revenue": d.revenue }))} columns={["Department", "Revenue"]} height={250}>
              <HBars data={ops.departments} name="department" value="revenue" label="Revenue" width={118} format={money} />
            </ChartCard>
            <ChartCard title="Payment generation by insurance company" note="Insurance share, in Saudi riyals. Sample figures." legend={[{ label: "Collected", color: "var(--chart-1)" }, { label: "Outstanding", color: "var(--chart-3)" }]} rows={ops.payers.map((p) => ({ Payer: p.payer, Collected: p.Collected, Outstanding: p.Outstanding }))} columns={["Payer", "Collected", "Outstanding"]} height={250}>
              <Stacked horizontal data={ops.payers} name="payer" width={92} series={[{ key: "Collected", color: "var(--chart-1)" }, { key: "Outstanding", color: "var(--chart-3)" }]} format={money} />
            </ChartCard>
            <ChartCard title="Cash, card and online payments" note="Receipts by payment method, in Saudi riyals. Sample figures." rows={ops.payments.map((p) => ({ Method: p.method, "Amount": p.amount }))} columns={["Method", "Amount"]} height={250}>
              <VBars data={ops.payments} name="method" value="amount" label="Amount" color="var(--chart-2)" format={money} />
            </ChartCard>
          </div>
        </>
      )}

      <Card className="mt-6">
        <CardHeader title="Top providers" subtitle="Ranked by appointments in the chosen range. Sample figures." right={<Button size="sm" onClick={() => navigate("/m/appointments")}>Open Appointments</Button>} />
        <Table>
          <thead><tr><Th>Provider</Th><Th>Department</Th><Th>Appointments</Th><Th>Completed</Th><Th>No show</Th><Th>Cancelled</Th></tr></thead>
          <tbody>
            {ops.providers.map((p) => (
              <tr key={p.provider}>
                <Td className="font-medium">{p.provider}</Td><Td>{p.department}</Td>
                <Td className="tabular-nums">{p.appointments}</Td><Td className="tabular-nums">{p.completed}</Td><Td className="tabular-nums">{p.noShow}</Td><Td className="tabular-nums">{p.cancelled}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
