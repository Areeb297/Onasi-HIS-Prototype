import * as React from "react";
import { RotateCcw, Search } from "lucide-react";
import { Money } from "@/components/Money";
import { ChartCard, StatTile } from "@/components/charts/ChartCard";
import { HBars, Lines, Stacked, VBars } from "@/components/charts/SimpleCharts";
import { Badge, Button, Card, CardHeader, Field, Input, Select, Table, Td, Th } from "@/components/ui/primitives";
import { DAMAN_COUNTS, DAMAN_MONTHS, DAMAN_PRIOR_AUTH, DAMAN_REJECTED_SERVICES, DAMAN_SECTIONS } from "@/lib/dashboard-data";
import { PAYERS } from "@/lib/nphies-financial";

const OUTCOME = [
  { key: "Approved", color: "var(--chart-1)" },
  { key: "Partial", color: "var(--chart-2)" },
  { key: "Rejected", color: "var(--chart-3)" },
];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Daman platform transactions: eligibility, claims, preauthorization and payment transactions for one client and
 * date range. Every figure on this page is sample data. The filters are kept so the layout matches the real page.
 */
export function DamanDashboardPage() {
  const today = new Date();
  const init = { client: PAYERS[3] ?? "Daman", from: iso(new Date(today.getTime() - 31 * 86_400_000)), to: iso(today) };
  const [draft, setDraft] = React.useState(init);
  const [applied, setApplied] = React.useState(init);
  const pa = DAMAN_PRIOR_AUTH;
  const rate = pa.requested ? (pa.rejected / pa.requested) * 100 : 0;

  return (
    <div>
      <header className="mb-4 overflow-hidden rounded-xl bg-[var(--brand-deep)] text-white">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-6 py-5">
          <div className="min-w-0 basis-80">
            <h1 className="text-xl font-semibold tracking-tight">Daman Dashboard</h1>
            <p className="mt-1 max-w-2xl text-sm text-white/80">Daman platform transactions: eligibility, claims, preauthorization, and access and coverage of care.</p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div><dt className="inline text-white/65">Client: </dt><dd className="inline font-medium">{applied.client}</dd></div>
            <div><dt className="inline text-white/65">Range: </dt><dd className="inline font-medium tabular-nums">{applied.from} to {applied.to}</dd></div>
            <div><dt className="inline text-white/65">Sections ready: </dt><dd className="inline font-medium">13 of 13</dd></div>
          </dl>
        </div>
        <p className="border-t border-white/10 px-6 py-2 text-xs text-white/70">Sample figures. The client and date range are shown as chosen but do not change the numbers.</p>
      </header>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <div className="min-w-44 flex-1"><Field label="Client"><Select value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })}>{PAYERS.map((p) => <option key={p}>{p}</option>)}</Select></Field></div>
          <div className="min-w-40 flex-1"><Field label="Start Date"><Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></Field></div>
          <div className="min-w-40 flex-1"><Field label="End Date"><Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></Field></div>
          <Button variant="primary" className="h-10" onClick={() => setApplied(draft)}><Search className="size-4" aria-hidden="true" /> Search</Button>
          <Button className="h-10" onClick={() => { setDraft(init); setApplied(init); }}><RotateCcw className="size-4" aria-hidden="true" /> Reset</Button>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {DAMAN_COUNTS.map(([label, n]) => <StatTile key={label} label={label} value={n.toLocaleString("en-US")} note="in this range" />)}
      </div>

      <Card className="mt-4">
        <CardHeader title="Prior authorization snapshot" subtitle="Item, rejection and money signals from access and coverage of care." right={<Badge tone="ok">Ready</Badge>} />
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Requested items" value={pa.requested.toLocaleString("en-US")} note="lines sent for approval" />
          <StatTile label="Approved items" value={pa.approved.toLocaleString("en-US")} note={`${pa.partial} more approved in part`} tone="ok" />
          <StatTile label="Rejected items" value={pa.rejected.toLocaleString("en-US")} note={`${rate.toFixed(1)}% rejection rate`} tone={rate > 10 ? "danger" : "warn"} />
          <StatTile label="Approved benefit amount" value={<Money value={pa.approvedAmount} />} note="approved by the payer" />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {DAMAN_SECTIONS.map((s) => (
          <ChartCard key={s.id} title={s.title} note={s.note} rows={s.data.map((d) => ({ Name: d.name, Count: d.count }))} columns={["Name", "Count"]} height={Math.max(150, 44 + s.data.length * 34)}>
            <HBars data={s.data} name="name" value="count" label={s.unit} width={158} color={s.id.includes("error") ? "var(--chart-3)" : s.id.includes("outcome") ? "var(--chart-2)" : "var(--chart-1)"} />
          </ChartCard>
        ))}
      </div>

      <h2 className="mb-3 mt-7 text-base font-semibold">Prior authorization over time</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Monthly prior authorization status mix" note="Approved, partial and rejected items by month." legend={OUTCOME.map((o) => ({ label: o.key, color: o.color }))} rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, Approved: m.Approved, Partial: m.Partial, Rejected: m.Rejected }))} columns={["Month", "Approved", "Partial", "Rejected"]}>
          <Stacked data={DAMAN_MONTHS} name="month" series={OUTCOME} />
        </ChartCard>
        <ChartCard title="Prior authorization rejection rate" note="Rejected items as a percent of requested items, by month." rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, "Rejection rate (%)": m.rate }))} columns={["Month", "Rejection rate (%)"]}>
          <Lines data={DAMAN_MONTHS} name="month" series={[{ key: "rate", color: "var(--chart-3)" }]} format={(v) => `${v}%`} />
        </ChartCard>
        <ChartCard title="Monthly approved amount" note="Approved benefit amount, in thousand Saudi riyals." rows={DAMAN_MONTHS.map((m) => ({ Month: m.month, "Approved (thousands)": m.amount }))} columns={["Month", "Approved (thousands)"]}>
          <VBars data={DAMAN_MONTHS} name="month" value="amount" label="Approved" color="var(--chart-1)" format={(v) => `${v}K`} />
        </ChartCard>
        <ChartCard title="Top rejected services" note="Service lines most often rejected for prior authorization." rows={DAMAN_REJECTED_SERVICES.map((r) => ({ Service: r.service, Rejections: r.rejections }))} columns={["Service", "Rejections"]}>
          <HBars data={DAMAN_REJECTED_SERVICES} name="service" value="rejections" label="Rejections" width={190} color="var(--chart-3)" />
        </ChartCard>
      </div>

      <Card className="mt-6">
        <CardHeader title="Top rejected services detail" subtitle="The service codes rejected most often in prior authorization responses." right={<Badge tone="ok">Ready</Badge>} />
        <Table>
          <thead><tr><Th>Code</Th><Th>Service</Th><Th>Rejections</Th></tr></thead>
          <tbody>
            {DAMAN_REJECTED_SERVICES.map((r) => (
              <tr key={r.code}><Td className="font-mono">{r.code}</Td><Td>{r.service}</Td><Td className="tabular-nums">{r.rejections}</Td></tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
