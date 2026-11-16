import * as React from "react";
import { IconBuildingBank, IconCashBanknote, IconHourglass, IconSend } from "@tabler/icons-react";
import { Plus, Send, SplitSquareHorizontal } from "lucide-react";
import { Money } from "@/components/Money";
import {
  BRAND, ClearButton, Facts, ListCard, NoAccess, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Toolbar,
  fmtDay, fmtTime, matches, run, useRcmData,
  Dialog,
} from "@/components/rcm/RcmUi";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Input, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { round2 } from "@/lib/invoice";
import {
  addManualPayment, adjustToClaims, allNotices, dayOf, fillInOrder, generatePaymentNotice, PAY_METHODS, RCM_PAYERS, setManualPaymentActive, validateAllocation,
  validateManualPayment, type NoticeView, type RcmClaim,
} from "@/lib/rcm-cases";

const TABS = ["Payment Reconciliation", "Manual Payments"] as const;
const STATUSES = ["Open", "Received", "Partly Adjusted", "Adjusted", "Notice Sent", "All"] as const;

/**
 * Payment Reconciliation: the payer's payments (from NPHIES or keyed in by hand) are adjusted to claims, then a payment
 * notice confirms the money arrived. Claims become Paid or Partly Paid. For a claim sent from this system the payment is
 * recorded through NPHIES Financial, so the visit invoice's insurance balance drops with it.
 * HIS finance/payment-reconciliations (Payment Reconciliation and Manual Payments tabs).
 */
export function ReconciliationPage() {
  const { s, fin, claims, allowed } = useRcmData();
  const notices = React.useMemo(() => allNotices(s, fin), [s, fin]);
  const [tab, setTab] = React.useState<(typeof TABS)[number]>(() => (location.hash.includes("manual") ? "Manual Payments" : "Payment Reconciliation"));
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("Open");
  const [payer, setPayer] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const inTab = notices.filter((n) => (tab === "Manual Payments" ? !!n.manual : true));
  const rows = inTab.filter((n) =>
    (status === "All" || (status === "Open" ? n.status !== "Notice Sent" : n.status === status)) && (!payer || n.payer === payer) &&
    matches(q, n.id, n.reference, n.payer, ...n.allocations.map((a) => a.claimNumber)));
  const current = notices.find((n) => n.id === sel) ?? null;
  const waiting = claims.filter((c) => (c.state === "Approved" || c.state === "Partly Approved") && c.outstanding > 0.004);

  return (
    <RcmPage title="Payment Reconciliation" subtitle="Payments from payers, adjusted to the claims they pay. Send the payment notice once the money is in the bank and fully adjusted."
      right={<GlassPillSwitch label="Payment view" value={tab} options={TABS} onChange={(t) => { setTab(t); setSel(null); }} />}>
      <KpiStrip label="Payment totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconBuildingBank stroke={1.75} />} label="Received" value={<Money value={notices.reduce((n, x) => n + x.amount, 0)} />} note={`${notices.length} payments`} />
        <KpiTile icon={<IconHourglass stroke={1.75} />} accent="warn" label="Not Yet Adjusted" value={<Money value={notices.reduce((n, x) => n + Math.max(0, x.remaining), 0)} />} note={`${notices.filter((x) => x.remaining > 0.004).length} payments with money left`} />
        <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Claims Waiting For Money" value={<Money value={waiting.reduce((n, c) => n + c.outstanding, 0)} />} note={`${waiting.length} approved claims not fully paid`} />
        <KpiTile icon={<IconSend stroke={1.75} />} label="Notices To Send" value={notices.filter((x) => x.status === "Adjusted").length} note="Fully adjusted, notice not sent" />
      </KpiStrip>
      <Toolbar query={q} onQuery={setQ} placeholder="Search reconciliation, reference or claim" status={status} statuses={STATUSES} onStatus={(v) => setStatus(v as typeof status)} payer={payer} onPayer={setPayer} payers={RCM_PAYERS} count={rows.length} unit={["payment", "payments"]}>
        {(q || payer || status !== "Open") && <ClearButton onClick={() => { setQ(""); setPayer(""); setStatus("Open"); }} />}
        {tab === "Manual Payments" && allowed && <Button size="sm" variant="primary" className={BRAND} onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" />Manual Payment</Button>}
      </Toolbar>
      <SplitView label="Payment" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title={tab === "Manual Payments" ? "Manual Payments" : "Payment Worklist"} note={tab === "Manual Payments" ? "Payments keyed in by hand, such as cheques and bank transfers." : "Newest first."}>
            {rows.length ? (
              <Table>
                <thead><tr><Th>{tab === "Manual Payments" ? "Reference" : "Reconciliation"}</Th><Th className="hidden sm:table-cell">Payer</Th><Th numeric>Amount</Th><Th className="hidden sm:table-cell">Adjusted</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((n) => (
                    <RowButton key={n.id} selected={n.id === sel} onOpen={() => setSel(n.id)} label={`${n.id}, ${n.payer}`}>
                      <Td className="whitespace-nowrap font-medium tabular-nums">{tab === "Manual Payments" ? n.reference : n.id}<span className="block text-xs font-normal text-muted-foreground">{fmtDay(n.date)}{n.manual && tab !== "Manual Payments" ? ", manual" : ""}{n.fromNphies ? ", NPHIES" : ""}</span><span className="block text-xs font-normal text-muted-foreground sm:hidden">{n.payer}</span></Td>
                      <Td className="hidden whitespace-nowrap sm:table-cell">{n.payer}<span className="block text-xs text-muted-foreground">{n.allocations.length ? `${n.allocations.length} ${n.allocations.length === 1 ? "claim" : "claims"} paid` : "No claims yet"}</span></Td>
                      <Td numeric><Money value={n.amount} /></Td>
                      <Td className="hidden min-w-[8rem] sm:table-cell"><Progress n={n} /></Td>
                      <Td className="whitespace-nowrap"><StatusBadge status={n.status} />{n.manual && !n.manual.active && <span className="mt-1 block text-xs text-muted-foreground">Inactive</span>}</Td>
                    </RowButton>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>{tab === "Manual Payments" ? "No manual payments match. Add one with Manual Payment." : "No payments match these filters."}</Empty>}
          </ListCard>
        }
        panel={current ? <NoticePanel key={current.id} n={current} claims={claims} allowed={allowed} /> : <PanelEmpty>Select a payment to adjust it to claims and send the payment notice.</PanelEmpty>}
      />
      {adding && <ManualPaymentDialog onClose={() => setAdding(false)} existing={notices} onSaved={(id) => { setAdding(false); setSel(id); }} />}
    </RcmPage>
  );
}

function Progress({ n }: { n: NoticeView }) {
  const pct = n.amount ? Math.min(100, (n.allocated / n.amount) * 100) : 0;
  return (
    <span className="block">
      <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><span className="block h-full rounded-full bg-[#03c1ac]" style={{ width: `${pct}%` }} /></span>
      <span className="mt-1 block text-xs text-muted-foreground">{n.remaining > 0.004 ? <><Money value={n.remaining} /> left</> : "All adjusted"}</span>
    </span>
  );
}

function NoticePanel({ n, claims, allowed }: { n: NoticeView; claims: RcmClaim[]; allowed: boolean }) {
  const [dlg, setDlg] = React.useState<"adjust" | "notice" | null>(null);
  const byKey = new Map(claims.map((c) => [c.key, c]));
  const sent = n.status === "Notice Sent";
  return (
    <Panel eyebrow={n.manual ? `Manual Payment, ${n.manual.method}` : n.fromNphies ? "Payment Advice From NPHIES" : "Payment From Payer"} title={n.id} badge={<StatusBadge status={n.status} />}
      sub={<>{n.payer}, reference {n.reference}</>}
      actions={allowed ? (
        <>
          {!sent && !n.fromNphies && n.remaining > 0.004 && <Button size="sm" variant="primary" className={BRAND} disabled={n.manual?.active === false} onClick={() => setDlg("adjust")}><SplitSquareHorizontal className="size-4" aria-hidden="true" />Adjust To Claim</Button>}
          {!sent && <Button size="sm" variant={n.remaining > 0.004 ? "secondary" : "primary"} className={n.remaining > 0.004 ? undefined : BRAND} onClick={() => setDlg("notice")}><Send className="size-4" aria-hidden="true" />Generate Payment Notice</Button>}
          {n.manual && !sent && (
            <label className="ml-auto flex items-center gap-2 text-[0.8125rem]">Active
              <Switch label="Active" checked={n.manual.active} onChange={(v) => run(setManualPaymentActive(n.id, v), v ? "Payment made active." : "Payment made inactive.")} />
            </label>
          )}
        </>
      ) : <NoAccess />}>
      <Section title="Payment">
        <div className="mb-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${Math.round(n.allocated)} of ${Math.round(n.amount)} SAR adjusted`}>
            <span className="bg-[#032c26] dark:bg-[#39edd5]" style={{ width: `${n.amount ? (n.allocated / n.amount) * 100 : 0}%` }} />
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div><dt className="text-muted-foreground">Amount</dt><dd className="font-semibold"><Money value={n.amount} /></dd></div>
            <div><dt className="text-muted-foreground">Adjusted</dt><dd className="font-semibold"><Money value={n.allocated} /></dd></div>
            <div><dt className="text-muted-foreground">Remaining</dt><dd className={cn("font-semibold", n.remaining > 0.004 && "text-warn")}><Money value={n.remaining} /></dd></div>
          </dl>
        </div>
        <Facts items={[
          ["Payment Date", fmtDay(n.date)], ["Recorded By", n.by],
          ...(n.manual ? [["Payment Method", n.manual.method], ["Discounted / Write-Off", <Money key="w" value={n.manual.writeOff} />]] as [string, React.ReactNode][] : []),
          ["Payment Notice", n.notice ? `${n.notice.status}, ${fmtTime(n.notice.at)}` : "Not Sent"],
        ]} />
      </Section>
      <Section title={`Adjusted To Claims (${n.allocations.length})`}>
        {n.allocations.length ? (
          <ul className="space-y-2">
            {n.allocations.map((a, i) => {
              const c = byKey.get(a.claimKey);
              return (
                <li key={`${a.claimKey}${i}`} className="glass-row flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[0.8125rem]">
                  <div className="min-w-0">
                    <p className="font-medium tabular-nums">{a.claimNumber}{c?.live && <Badge className="ml-1.5">This System</Badge>}</p>
                    <p className="truncate text-xs text-muted-foreground">{c?.patientName}, {a.by}, {fmtTime(a.at)}</p>
                  </div>
                  <div className="text-right"><Money value={a.amount} className="font-semibold" />{c && <StatusBadge status={c.pay} className="mt-1 flex" />}</div>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-[0.8125rem] text-muted-foreground">Nothing adjusted yet. Use Adjust To Claim to place this money on the claims it pays.</p>}
      </Section>
      {dlg === "adjust" && <AdjustDialog n={n} claims={claims} onClose={() => setDlg(null)} />}
      {dlg === "notice" && <NoticeDialog n={n} onClose={() => setDlg(null)} />}
    </Panel>
  );
}

/** Adjust To Claim: the payer's claims that still owe money, an amount for each, and what is left of the payment. */
function AdjustDialog({ n, claims, onClose }: { n: NoticeView; claims: RcmClaim[]; onClose: () => void }) {
  const list = claims.filter((c) => c.payer === n.payer && c.outstanding > 0.004 && (c.state === "Approved" || c.state === "Partly Approved")).sort((a, b) => a.submittedOn.localeCompare(b.submittedOn));
  const [amounts, setAmounts] = React.useState<Record<string, string>>({});
  const nums = Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, Number(v) || 0]));
  const v = validateAllocation(n, claims, nums);
  const touched = Object.values(nums).some((x) => x !== 0);
  const save = () => { if (run(adjustToClaims(n.id, nums, claims), `${v.total.toLocaleString("en-US", { minimumFractionDigits: 2 })} SAR adjusted to claims.`)) onClose(); };
  return (
    <Dialog open onClose={onClose} wide title="Adjust To Claim" subtitle={`${n.id} from ${n.payer}. Place the money on the claims it pays.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" className={BRAND} disabled={!touched || v.errors.length > 0} onClick={save}>Save Adjustment</Button></>}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem]">Available <Money value={n.remaining} className="font-semibold" /></p>
        <Button size="sm" onClick={() => setAmounts(Object.fromEntries(Object.entries(fillInOrder(n, claims)).map(([k, x]) => [k, x.toFixed(2)])))}>Fill Oldest First</Button>
      </div>
      {list.length ? (
        <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-border">
          <Table>
            <thead><tr><Th>Claim</Th><Th numeric>Approved</Th><Th numeric>Paid</Th><Th numeric>Owed</Th><Th numeric>Adjust</Th></tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.key}>
                  <Td className="whitespace-nowrap"><span className="font-medium tabular-nums">{c.claimNumber}</span><span className="block text-xs text-muted-foreground">{c.patientName}{c.live ? ", paid in full only" : ""}</span></Td>
                  <Td numeric><Money value={c.approved} /></Td>
                  <Td numeric><Money value={c.paid} /></Td>
                  <Td numeric><Money value={c.outstanding} /></Td>
                  <Td numeric>
                    <label className="sr-only" htmlFor={`adj-${c.key}`}>Amount for {c.claimNumber}</label>
                    <Input id={`adj-${c.key}`} type="number" min={0} step="0.01" inputMode="decimal" className="ml-auto h-8 w-28 text-right" value={amounts[c.key] ?? ""}
                      onChange={(e) => setAmounts({ ...amounts, [c.key]: e.target.value })} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <Empty>No approved {n.payer} claims are waiting for money.</Empty>}
      <div className="mt-3 flex flex-wrap justify-end gap-x-6 gap-y-1 text-[0.8125rem]" aria-live="polite">
        <span>Adjusting <Money value={v.total} className="font-semibold" /></span>
        <span>Remaining after this <Money value={round2(Math.max(0, n.remaining - v.total))} className={cn("font-semibold", v.remaining < -0.004 && "text-destructive")} /></span>
      </div>
      {touched && v.errors.length > 0 && <ul role="alert" className="mt-2 list-disc space-y-0.5 rounded-lg bg-destructive/8 py-2 pl-7 pr-3 text-[0.8125rem] text-destructive">{v.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Dialog>
  );
}

function NoticeDialog({ n, onClose }: { n: NoticeView; onClose: () => void }) {
  const [status, setStatus] = React.useState<"Paid" | "Cleared">("Paid");
  const blocked = n.remaining > 0.004;
  return (
    <Dialog open onClose={onClose} title="Generate Payment Notice" subtitle="Tells the payer through NPHIES that the money arrived."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" className={BRAND} disabled={blocked} onClick={() => run(generatePaymentNotice(n.id, status), "Payment notice sent.") && onClose()}>Submit</Button></>}>
      <Facts items={[["Reconciliation Number", n.id], ["Amount", <Money key="a" value={n.amount} />], ["Claims", n.allocations.map((a) => a.claimNumber).join(", ") || "None"], ["Payer", n.payer]]} />
      <Field label="Payment Status" required className="mt-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value as "Paid" | "Cleared")}><option>Paid</option><option>Cleared</option></Select>
      </Field>
      {blocked && <p role="alert" className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[0.8125rem] text-warn">{n.remaining.toFixed(2)} SAR of this payment is not adjusted to a claim. Adjust all of it first.</p>}
    </Dialog>
  );
}

function ManualPaymentDialog({ onClose, existing, onSaved }: { onClose: () => void; existing: NoticeView[]; onSaved: (id: string) => void }) {
  const [f, setF] = React.useState({ method: "", reference: "", date: dayOf(new Date()), payer: "", amount: "", writeOff: "" });
  const [errors, setErrors] = React.useState<string[]>([]);
  const input = { method: f.method, reference: f.reference, date: f.date, payer: f.payer, amount: Number(f.amount), writeOff: f.writeOff ? Number(f.writeOff) : 0 };
  const save = () => {
    const e = validateManualPayment(input, existing);
    setErrors(e);
    if (e.length) return;
    const r = addManualPayment(input);
    if (run(r, "Manual payment saved. Adjust it to claims next.") && r.ok) onSaved(r.id!);
  };
  return (
    <Dialog open onClose={onClose} wide title="Manual Payment" subtitle="A payment that did not come through NPHIES, such as a cheque or a bank transfer."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" className={BRAND} onClick={save}>Save Payment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Payment Method" required><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="">Choose</option>{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Reference No" required><Input maxLength={100} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Cheque or transfer number" /></Field>
        <Field label="Payment Date" required><Input type="date" max={dayOf(new Date())} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Payer" required><Select value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })}><option value="">Choose</option>{RCM_PAYERS.map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Payment Amount (SAR)" required><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Discounted / Write-Off Amount (SAR)" hint="Contract discount the payer took off. For the record only."><Input type="number" min={0} step="0.01" value={f.writeOff} onChange={(e) => setF({ ...f, writeOff: e.target.value })} /></Field>
      </div>
      {errors.length > 0 && <ul role="alert" className="mt-3 list-disc space-y-0.5 rounded-lg bg-destructive/8 py-2 pl-7 pr-3 text-[0.8125rem] text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Dialog>
  );
}
