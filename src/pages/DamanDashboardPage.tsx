import * as React from "react";
import {
  IconAlertTriangle, IconCalendarTime, IconCashBanknote, IconCircleCheck, IconClockHour4, IconFileInvoice, IconFilter, IconHourglass,
  IconPercentage, IconReceiptOff, IconShieldX, IconX,
} from "@tabler/icons-react";
import { Money } from "@/components/Money";
import { ChartCard, ViewSwitch } from "@/components/charts/ChartCard";
import { AreaTrend, FunnelBars, HBars, ParetoRows, SegmentedBar, Stacked, VBars } from "@/components/charts/SimpleCharts";
import { ORD, STATUS_COLOR, VIZ, num, pct } from "@/components/charts/viz";
import { GlassBackdrop, GlassCard, GlassPillSwitch, GlassStagger, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Table, Td, Th } from "@/components/ui/primitives";
import {
  ALL, CLAIM_PAYERS, CLAIM_PERIODS, CLAIM_TYPES, DAMAN_COUNTS, DAMAN_MONTHS, DAMAN_PRIOR_AUTH, DAMAN_REJECTED_SERVICES, DAMAN_SECTIONS, PREV_WORD,
  claimsView, type ClaimFilters,
} from "@/lib/dashboard-data";

/** Prior authorization outcomes are a state, so they wear the status colours. */
const OUTCOME = [
  { key: "Approved", color: STATUS_COLOR.Paid },
  { key: "Partial", color: STATUS_COLOR["Partially Paid"] },
  { key: "Rejected", color: STATUS_COLOR.Denied },
];
const sar = (v: unknown) => <Money value={Number(v)} />;
const rate = (v: unknown) => pct(Number(v));
const days = (v: unknown) => `${Number(v).toFixed(1)} days`;
const STATUS_ICON: Record<string, React.ReactNode> = {
  Paid: <IconCircleCheck className="size-4" stroke={1.75} />, "Partially Paid": <IconAlertTriangle className="size-4" stroke={1.75} />,
  Denied: <IconReceiptOff className="size-4" stroke={1.75} />, Pending: <IconHourglass className="size-4" stroke={1.75} />,
};
const INIT: ClaimFilters = { period: "Last 90 Days", payer: ALL, type: ALL };

/**
 * Daman Dashboard. Claims tab: revenue-cycle analytics over made-up Saudi sample claims, filtered by period, payer and
 * claim type; every tile, chart and table reads the same filtered slice. Platform Transactions tab: Daman message counts.
 */
export function DamanDashboardPage() {
  const [tab, setTab] = React.useState<"Claims" | "Platform Transactions">("Claims");
  return (
    <GlassBackdrop className="viz">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Daman Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Claims, denials and payments, and the Daman platform transactions behind them. Sample figures.</p>
        </div>
        <GlassPillSwitch label="Dashboard view" value={tab} options={["Claims", "Platform Transactions"] as const} onChange={setTab} />
      </div>
      {tab === "Claims" ? <ClaimsTab /> : <TransactionsTab />}
    </GlassBackdrop>
  );
}

function ClaimsTab() {
  const [f, setF] = React.useState<ClaimFilters>(INIT);
  const v = React.useMemo(() => claimsView(f), [f]);
  const k = v.kpis, p = v.prev, against = PREV_WORD[f.period];
  const [pickBy, setTrendBy] = React.useState<"Monthly" | "Weekly" | "Daily" | null>(null);
  // Until someone picks, the grouping follows the period: daily for 30 days, weekly for 90, monthly beyond.
  const trendBy = pickBy ?? (f.period === "Last 30 Days" ? "Daily" : f.period === "Last 90 Days" ? "Weekly" : "Monthly");
  const [measure, setMeasure] = React.useState<"Amount" | "Claims">("Amount");
  const trend = trendBy === "Monthly" ? v.monthly : trendBy === "Weekly" ? v.weekly : v.daily;
  const filtered = f.payer !== ALL || f.type !== ALL || f.period !== INIT.period;
  const topThree = v.pareto.slice(0, 3).reduce((n, r) => n + r.share, 0);
  const statusParts = v.status.map((s) => ({ name: s.status, value: s.claims, color: STATUS_COLOR[s.status], dark: s.status === "Partially Paid" || s.status === "Pending" }));

  return (
    <>
      {/* Filters: one row, above everything they scope. */}
      <div className="glass-card mb-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl px-3 py-2.5 sm:px-4" role="group" aria-label="Filters">
        <span className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground"><IconFilter className="size-4" stroke={1.75} aria-hidden="true" /> Filters</span>
        <GlassPillSwitch label="Period" size="sm" value={f.period} options={CLAIM_PERIODS} onChange={(period) => setF({ ...f, period })} />
        <FilterSelect label="Payer" value={f.payer} options={[ALL, ...CLAIM_PAYERS]} onChange={(payer) => setF({ ...f, payer })} />
        <FilterSelect label="Claim Type" value={f.type} options={[ALL, ...CLAIM_TYPES]} onChange={(type) => setF({ ...f, type })} />
        {filtered && (
          <button type="button" onClick={() => setF(INIT)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[0.8125rem] font-medium text-primary hover:bg-muted"><IconX className="size-3.5" stroke={2} aria-hidden="true" />Clear Filters</button>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{num(k.claims)} claims</span>
      </div>

      <KpiStrip label="Claims totals" className="sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile icon={<IconFileInvoice stroke={1.75} />} label="Total Claimed" value={<Money value={k.claimed} />} points={v.spark("claimed")} current={k.claimed} prev={p.claimed} against={against} goodWhen="up" note={`${num(k.claims)} claims submitted`} />
        <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Paid" value={<Money value={k.paid} />} points={v.spark("paid")} current={k.paid} prev={p.paid} against={against} goodWhen="up" note={`${pct(k.collectionRate)} of adjudicated money`} />
        <KpiTile icon={<IconReceiptOff stroke={1.75} />} label="Denied" value={<Money value={k.denied} />} points={v.spark("denied")} current={k.denied} prev={p.denied} against={against} goodWhen="down" accent="danger" note="Full and partial denials" />
        <KpiTile icon={<IconClockHour4 stroke={1.75} />} label="Outstanding" value={<Money value={k.outstanding} />} points={v.spark("outstanding")} current={k.outstanding} prev={p.outstanding} against={against} goodWhen="down" accent="warn" note="All claims still waiting for the payer" />
        <KpiTile icon={<IconPercentage stroke={1.75} />} label="Denial Rate" value={pct(k.denialRate)} points={v.spark("denialRate")} current={k.denialRate} prev={p.denialRate} against={against} goodWhen="down" kind="points" note="Denied claims of adjudicated" />
        <KpiTile icon={<IconCalendarTime stroke={1.75} />} label="Average Days To Pay" value={k.avgPayDays.toFixed(1)} points={v.spark("avgPayDays")} current={k.avgPayDays} prev={p.avgPayDays} against={against} goodWhen="down" kind="days" note="From submission to payment" />
      </KpiStrip>

      <h2 className="mb-3 mt-7 text-base font-semibold">Prior Authorization Impact</h2>
      <KpiStrip label="Prior authorization impact" className="sm:grid-cols-3">
        <KpiTile icon={<IconShieldX stroke={1.75} />} accent="danger" label="Denied After Authorization Was Refused" value={<Money value={k.paDeniedAmount} />} points={v.spark("paDeniedAmount")} current={k.paDeniedAmount} prev={p.paDeniedAmount} against={against} goodWhen="down" />
        <KpiTile icon={<IconReceiptOff stroke={1.75} />} label="Claims Denied For Authorization" value={num(k.paDeniedCount)} points={v.spark("paDeniedCount")} current={k.paDeniedCount} prev={p.paDeniedCount} against={against} goodWhen="down" kind="count" />
        <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Average Denied Amount" value={<Money value={k.paDeniedAvg} />} points={v.spark("paDeniedAvg")} current={k.paDeniedAvg} prev={p.paDeniedAvg} against={against} goodWhen="down" />
      </KpiStrip>

      <GlassStagger className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3" gap={0.05}>
        <ChartCard title="Revenue Cycle Funnel" note="Money at each stage, and its share of what was submitted." rows={v.funnel} columns={[{ key: "stage", label: "Stage" }, { key: "amount", label: "Amount", format: sar }, { key: "claims", label: "Claims" }]} height="auto">
          <div className="pb-2 pt-2"><FunnelBars stages={v.funnel} colors={[ORD[1], ORD[2], ORD[3], ORD[4]]} /></div>
        </ChartCard>

        <ChartCard title="Claim Status" note="Share of claims by where they stand with the payer." rows={v.status} columns={[{ key: "status", label: "Status" }, { key: "claims", label: "Claims" }, { key: "share", label: "Share", format: rate }]} height="auto">
          <div className="px-3 pb-2 pt-3">
            <SegmentedBar parts={statusParts} unit="claims" />
            <ul className="mt-4 divide-y divide-border/60 border-t border-border/60">
              {v.status.map((s) => (
                <li key={s.status} className="flex items-center gap-2.5 py-2 text-[0.8125rem]">
                  <span className="flex size-6 items-center justify-center rounded-md" style={{ color: STATUS_COLOR[s.status], background: `color-mix(in srgb, ${STATUS_COLOR[s.status]} 14%, transparent)` }} aria-hidden="true">{STATUS_ICON[s.status]}</span>
                  <span className="flex-1 font-medium">{s.status}</span>
                  <span className="tabular-nums text-muted-foreground">{pct(s.share, 0)}</span>
                  <span className="w-14 text-right font-semibold tabular-nums">{num(s.claims)}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartCard>

        <ChartCard title="Claim Amount By Status" note="Total claimed money in each status. Hover for the average claim." rows={v.status} columns={[{ key: "status", label: "Status" }, { key: "amount", label: "Total", format: sar }, { key: "avg", label: "Average Claim", format: sar }, { key: "claims", label: "Claims" }]} height={272}>
          <VBars data={v.status} name="status" value="amount" label="Total claimed" money colors={v.status.map((s) => STATUS_COLOR[s.status])} extra={(r) => <>Average claim <Money value={Number(r.avg)} />, {num(r.claims)} claims</>} />
        </ChartCard>

        <ChartCard className="lg:col-span-2 xl:col-span-3" title="Claims Trend" note={measure === "Amount" ? "Claimed money over time." : "Number of claims submitted over time."} rows={trend} columns={[{ key: "label", label: trendBy === "Monthly" ? "30 Days Ending" : trendBy === "Weekly" ? "Week Ending" : "Day" }, { key: "claims", label: "Claims" }, { key: "amount", label: "Amount", format: sar }]} height={280}
          actions={<>
            <ViewSwitch label="Measure" value={measure} onChange={setMeasure} options={["Amount", "Claims"]} />
            <ViewSwitch label="Group by" value={trendBy} onChange={setTrendBy} options={["Monthly", "Weekly", "Daily"]} />
          </>}>
          <AreaTrend data={trend} name="label" value={measure === "Amount" ? "amount" : "claims"} label={measure === "Amount" ? "Claimed" : "Claims"} money={measure === "Amount"}
            extra={(r) => (measure === "Amount" ? `${num(r.claims)} claims` : <><Money value={Number(r.amount)} /> claimed</>)} />
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Department Paid Vs Denied" note="Money paid and denied for each department's claims." legend={[{ label: "Paid", color: STATUS_COLOR.Paid }, { label: "Denied", color: STATUS_COLOR.Denied }]} rows={v.depts} columns={[{ key: "dept", label: "Department" }, { key: "Paid", format: sar }, { key: "Denied", format: sar }]} height={Math.max(220, 40 + v.depts.length * 32)}>
          <Stacked horizontal money data={v.depts} name="dept" width={170} series={[{ key: "Paid", color: STATUS_COLOR.Paid }, { key: "Denied", color: STATUS_COLOR.Denied }]} />
        </ChartCard>

        <ChartCard title="Prior Authorization Denials" note="Denied money by the authorization behind the claim." rows={v.preAuth} columns={[{ key: "name", label: "Authorization" }, { key: "amount", label: "Denied", format: sar }, { key: "claims", label: "Claims" }]} height={Math.max(220, 40 + v.depts.length * 32)}>
          <VBars data={v.preAuth.map((x, i) => ({ ...x, short: ["Approved", "Denied or Missing", "Not Needed"][i] }))} name="short" value="amount" label="Denied" money extra={(r) => <>{String(r.name)}, {num(r.claims)} claims</>} />
        </ChartCard>

        <ChartCard title="Denial Reasons Breakdown" note="Claims denied in full or in part, by reason." rows={v.reasons} columns={[{ key: "reason", label: "Reason" }, { key: "claims", label: "Claims" }, { key: "amount", label: "Denied", format: sar }]} height={Math.max(240, 40 + v.reasons.length * 32)}>
          <HBars data={v.reasons} name="reason" value="claims" label="Claims" width={170} extra={(r) => <><Money value={Number(r.amount)} /> denied</>} />
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Denial Analysis" note={v.pareto.length ? `Denied money by reason, largest first. The top three reasons make up ${topThree.toFixed(0)}% of it.` : "No denials in this selection."} rows={v.pareto} columns={[{ key: "reason", label: "Reason" }, { key: "amount", label: "Denied", format: sar }, { key: "share", label: "Share", format: rate }, { key: "cumulative", label: "Running Total", format: rate }]} height="auto">
          <div className="pb-1 pt-2"><ParetoRows rows={v.pareto} /></div>
        </ChartCard>

        <ChartCard title="Claims By Payer" note="Claimed money by insurance company." rows={v.payers} columns={[{ key: "payer", label: "Payer" }, { key: "claimed", label: "Claimed", format: sar }, { key: "claims", label: "Claims" }]} height={Math.max(220, 40 + v.payers.length * 34)}>
          <HBars data={v.payers} name="payer" value="claimed" label="Claimed" width={120} money extra={(r) => `${num(r.claims)} claims`} />
        </ChartCard>

        <ChartCard title="Reimbursement Time" note="Paid claims by days from submission to payment." rows={v.payTimes} columns={[{ key: "band", label: "Days" }, { key: "claims", label: "Claims" }]} height={Math.max(220, 40 + v.payers.length * 34)}>
          <VBars data={v.payTimes} name="band" value="claims" label="Paid claims" grow extra={(r) => `${String(r.band)} days`} />
        </ChartCard>

        <ChartCard title="Pending Claims Ageing" note="Every claim still open today for the chosen payer and claim type, by how long it has waited." rows={v.ageing} columns={[{ key: "band", label: "Waiting" }, { key: "claims", label: "Claims" }, { key: "amount", label: "Amount", format: sar }]} height={Math.max(220, 40 + v.payers.length * 34)}>
          <VBars data={v.ageing.map((a) => ({ ...a, short: a.band.replace(" days", "") }))} name="short" value="claims" label="Pending claims" colors={[...ORD]} extra={(r) => <><Money value={Number(r.amount)} /> waiting</>} />
        </ChartCard>

        <ChartCard className="lg:col-span-2" title="Average Claim By Service Group" note="Average claimed amount per claim, by Saudi Billing System (SBS) and ACHI service group." rows={v.groups} columns={[{ key: "group", label: "Service Group" }, { key: "system", label: "Code System" }, { key: "avg", label: "Average Claim", format: sar }, { key: "claims", label: "Claims" }]} height={Math.max(240, 40 + v.groups.length * 30)}>
          <HBars data={v.groups.map((g) => ({ ...g, label: `${g.group} (${g.system})` }))} name="label" value="avg" label="Average claim" width={220} money extra={(r) => `${num(r.claims)} claims`} />
        </ChartCard>

        <ChartCard title="Claim Type Mix" note="Claims by NPHIES claim type. Hover for the claimed amount." rows={v.types} columns={[{ key: "type", label: "Claim Type" }, { key: "claims", label: "Claims" }, { key: "amount", label: "Amount", format: sar }]} height={Math.max(220, 40 + v.types.length * 34)}>
          <HBars data={v.types} name="type" value="claims" label="Claims" width={96} extra={(r) => <><Money value={Number(r.amount)} /> claimed</>} />
        </ChartCard>
      </GlassStagger>

      <GlassCard solid lift={false} className="mt-6 overflow-hidden">
        <header className="px-5 py-4">
          <h2 className="text-[0.9375rem] font-semibold">Payer Performance</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">How each insurance company pays, for the filters above.</p>
        </header>
        <Table>
          <thead><tr><Th className="w-full">Payer</Th><Th numeric>Claims</Th><Th numeric>Claimed</Th><Th numeric>Paid</Th><Th numeric>Paid To Claimed</Th><Th numeric>Denial Rate</Th><Th numeric>Average Days To Pay</Th></tr></thead>
          <tbody>
            {v.payers.map((r) => (
              <tr key={r.payer}>
                <Td className="font-medium">{r.payer}</Td>
                <Td numeric>{num(r.claims)}</Td>
                <Td numeric><Money value={r.claimed} /></Td>
                <Td numeric><Money value={r.paid} /></Td>
                <Td numeric>{pct(r.paidRatio)}</Td>
                <Td numeric>{r.denialRate >= 15 ? <Badge tone="cancel">{pct(r.denialRate)}</Badge> : r.denialRate >= 10 ? <Badge tone="warn">{pct(r.denialRate)}</Badge> : <span className="tabular-nums">{pct(r.denialRate)}</span>}</Td>
                <Td numeric>{days(r.avgPayDays)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-5 py-2.5 text-xs text-muted-foreground">A denial rate of 10% or more is marked for follow-up, 15% or more is marked high.</p>
      </GlassCard>
    </>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  const id = React.useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] text-muted-foreground">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="glass-pill h-8 rounded-full pl-2.5 pr-7 text-[0.8125rem] font-medium text-foreground dark:[color-scheme:dark]">
        {options.map((o) => <option key={o} value={o}>{o === ALL ? (label === "Payer" ? "All Payers" : "All Types") : o}</option>)}
      </select>
    </span>
  );
}

/* ---------- Platform transactions (the Daman message counts, unchanged figures) ---------- */

function TransactionsTab() {
  const pa = DAMAN_PRIOR_AUTH;
  const rejectRate = pa.requested ? (pa.rejected / pa.requested) * 100 : 0;
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Messages exchanged through the Daman platform in the last 31 days.</p>
      <KpiStrip label="Platform message counts" className="sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {DAMAN_COUNTS.map(([label, n]) => <KpiTile key={label} dense label={label} value={n.toLocaleString("en-US")} />)}
      </KpiStrip>

      <h2 className="mb-3 mt-7 text-base font-semibold">Prior Authorization Snapshot</h2>
      <KpiStrip label="Prior authorization snapshot" className="sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconFileInvoice stroke={1.75} />} label="Requested Items" value={pa.requested.toLocaleString("en-US")} note="lines sent for approval" />
        <KpiTile icon={<IconCircleCheck stroke={1.75} />} label="Approved Items" value={pa.approved.toLocaleString("en-US")} note={`${pa.partial} more approved in part`} tone="ok" />
        <KpiTile icon={<IconReceiptOff stroke={1.75} />} accent="danger" label="Rejected Items" value={pa.rejected.toLocaleString("en-US")} note={`${rejectRate.toFixed(1)}% rejection rate`} tone={rejectRate > 10 ? "danger" : "warn"} />
        <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Approved Benefit Amount" value={<Money value={pa.approvedAmount} />} note="approved by the payer" />
      </KpiStrip>

      <GlassStagger className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {DAMAN_SECTIONS.map((s) => (
          <ChartCard key={s.id} title={s.title} note={s.note} rows={s.data.map((d) => ({ Name: d.name, Count: d.count }))} columns={["Name", "Count"]} height={Math.max(150, 44 + s.data.length * 34)}>
            <HBars data={s.data} name="name" value="count" label={s.unit} width={158} />
          </ChartCard>
        ))}
      </GlassStagger>

      <h2 className="mb-3 mt-7 text-base font-semibold">Prior Authorization Over Time</h2>
      <GlassStagger className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Monthly prior authorization status mix" note="Approved, partial and rejected items by month." legend={OUTCOME.map((o) => ({ label: o.key, color: o.color }))} rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, Approved: m.Approved, Partial: m.Partial, Rejected: m.Rejected }))} columns={["Month", "Approved", "Partial", "Rejected"]}>
          <Stacked data={DAMAN_MONTHS} name="month" series={OUTCOME} />
        </ChartCard>
        <ChartCard title="Prior authorization rejection rate" note="Rejected items as a percent of requested items, by month." rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, "Rejection rate (%)": m.rate }))} columns={["Month", "Rejection rate (%)"]}>
          <AreaTrend data={DAMAN_MONTHS} name="month" value="rate" label="Rejection rate" format={(x) => pct(Number(x))} />
        </ChartCard>
        <ChartCard title="Monthly approved amount" note="Approved benefit amount, in thousand Saudi riyals." rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, "Approved (thousands)": m.amount }))} columns={["Month", "Approved (thousands)"]}>
          <VBars data={DAMAN_MONTHS} name="month" value="amount" label="Approved, thousands" format={(x) => `${x}K`} />
        </ChartCard>
        <ChartCard title="Top rejected services" note="Service lines most often rejected for prior authorization." rows={DAMAN_REJECTED_SERVICES.map((r) => ({ Code: r.code, Service: r.service, Rejections: r.rejections }))} columns={["Code", "Service", "Rejections"]}>
          <HBars data={DAMAN_REJECTED_SERVICES} name="service" value="rejections" label="Rejections" width={190} />
        </ChartCard>
      </GlassStagger>
    </>
  );
}
