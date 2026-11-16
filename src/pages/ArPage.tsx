import * as React from "react";
import { IconAlarm, IconCalendarDollar, IconCashBanknote, IconHourglassHigh } from "@tabler/icons-react";
import { ExternalLink } from "lucide-react";
import { Money } from "@/components/Money";
import { AgeingChart } from "@/components/rcm/AgeingChart";
import {
  BRAND, ClearButton, Facts, ListCard, NoAccess, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Timeline, Toolbar,
  daysText, fmtDay, matches, run, useRcmData,
  Dialog,
} from "@/components/rcm/RcmUi";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Input, Select, Table, Td, Th } from "@/components/ui/primitives";
import {
  AR_ACTION_LABEL, COLLECTION_STAGES, COLLECTORS, ESCALATION_LEVELS, ageingOf, arAction, arCases, dayOf, validateArAction,
  type ArAction, type ArCase, type Bucket,
} from "@/lib/rcm-cases";
import { navigate } from "@/lib/router";

const STATUSES = ["Active", "Open", "In Review", "Follow Up", "Closed", "All"] as const;
const TYPES = ["All", "Insurance", "Patient"] as const;

/**
 * AR Management: money still owed by payers (insurance AR) and by patients (patient AR), case by case, with ageing,
 * priority, a collector and the next follow-up. Every action needs a note and is kept in the collection history.
 * HIS rcm/ar-management (Accounts Receivable and Collections), with its Manage Workflow dialog.
 */
export function ArPage() {
  const { s, claims, today, allowed } = useRcmData();
  const cases = React.useMemo(() => arCases(s, claims, today), [s, claims, today]);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("Active");
  const [kind, setKind] = React.useState<(typeof TYPES)[number]>("All");
  const [bucket, setBucket] = React.useState<Bucket | "">("");
  const [overdue, setOverdue] = React.useState(false);
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = cases.filter((c) =>
    (status === "All" || (status === "Active" ? c.status !== "Closed" : c.status === status)) && (kind === "All" || c.kind === kind) && (!bucket || c.bucket === bucket) &&
    (!overdue || c.followUpOverdue || c.promiseOverdue) && matches(q, c.ref, c.patientName, c.mrn, c.payer, c.assignee));
  const current = cases.find((c) => c.id === sel) ?? null;
  const open = cases.filter((c) => c.status !== "Closed" && c.outstanding > 0.004);
  const outstanding = open.reduce((n, c) => n + c.outstanding, 0);
  const over90 = open.filter((c) => c.days > 90).reduce((n, c) => n + c.outstanding, 0);
  const ageing = React.useMemo(() => ageingOf(kind === "All" ? cases : cases.filter((c) => c.kind === kind)), [cases, kind]);
  const todayIso = dayOf(today);

  return (
    <RcmPage title="AR Management" subtitle="Money still owed by payers and patients, by age. Follow up each case, record what was promised, and escalate what is stuck.">
      <KpiStrip label="AR totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconCashBanknote stroke={1.75} />} label="Outstanding" value={<Money value={outstanding} />} note={`${open.length} open cases`} />
        <KpiTile icon={<IconHourglassHigh stroke={1.75} />} accent="danger" label="Over 90 Days" value={`${outstanding ? Math.round((over90 / outstanding) * 100) : 0}%`} note={<><Money value={over90} /> of the outstanding money</>} />
        <KpiTile icon={<IconCalendarDollar stroke={1.75} />} label="Promised To Pay" value={<Money value={open.filter((c) => c.promise).reduce((n, c) => n + c.promise!.amount, 0)} />} note={`${open.filter((c) => c.promiseOverdue).length} promises overdue`} />
        <KpiTile icon={<IconAlarm stroke={1.75} />} accent="warn" label="Follow-Ups Due" value={open.filter((c) => c.nextFollowUp && c.nextFollowUp <= todayIso).length} note={`${open.filter((c) => c.followUpOverdue).length} overdue, ${open.filter((c) => c.nextFollowUp === todayIso).length} today`} />
      </KpiStrip>
      <div className="mt-4"><AgeingChart rows={ageing} active={bucket} onPick={setBucket} /></div>
      <Toolbar query={q} onQuery={setQ} placeholder="Search claim, invoice, patient or collector" status={status} statuses={STATUSES} onStatus={(v) => setStatus(v as typeof status)} count={rows.length}>
        <GlassPillSwitch size="sm" label="AR type" value={kind} options={TYPES} onChange={setKind} />
        <label className="flex items-center gap-1.5 text-[0.8125rem]"><input type="checkbox" className="size-4 accent-[#032c26]" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />Overdue Only</label>
        {bucket && <Badge tone="info">{bucket} days</Badge>}
        {(q || bucket || overdue || kind !== "All" || status !== "Active") && <ClearButton onClick={() => { setQ(""); setBucket(""); setOverdue(false); setKind("All"); setStatus("Active"); }} />}
      </Toolbar>
      <SplitView label="AR case" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title="AR Cases" note="Oldest first.">
            {rows.length ? (
              <Table>
                <thead><tr><Th>Claim / Invoice</Th><Th className="hidden sm:table-cell">Patient</Th><Th numeric className="hidden sm:table-cell">Days</Th><Th numeric>Outstanding</Th><Th className="hidden 2xl:table-cell">Priority</Th><Th className="hidden md:table-cell">Next Follow-Up</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <RowButton key={c.id} selected={c.id === sel} onOpen={() => setSel(c.id)} label={`${c.ref}, ${c.patientName}`}>
                      <Td className="whitespace-nowrap font-medium tabular-nums">{c.ref}<span className="block text-xs font-normal text-muted-foreground">{c.kind}{c.visit ? `, visit ${c.visit}` : ""}</span><span className="block text-xs font-normal text-muted-foreground sm:hidden">{c.patientName}, {c.days} days</span></Td>
                      <Td className="hidden whitespace-nowrap sm:table-cell">{c.patientName}<span className="block text-xs text-muted-foreground">{c.payer}</span></Td>
                      <Td numeric className="hidden whitespace-nowrap sm:table-cell">{c.days}<span className="block text-xs text-muted-foreground">{c.bucket}</span></Td>
                      <Td numeric><Money value={c.outstanding} /><span className="hidden sm:block 2xl:hidden"><StatusBadge status={c.priority} className="mt-1" /></span></Td>
                      <Td className="hidden 2xl:table-cell"><StatusBadge status={c.priority} /></Td>
                      <Td className="hidden whitespace-nowrap md:table-cell">{c.nextFollowUp ? fmtDay(c.nextFollowUp) : <span className="text-muted-foreground">Not Set</span>}<span className="block text-xs text-muted-foreground">{c.assignee ?? "Unassigned"}</span></Td>
                      <Td className="whitespace-nowrap">
                        <StatusBadge status={c.status} />
                        {c.followUpOverdue && <span className="mt-1 block text-xs font-medium text-destructive">Follow-Up Overdue</span>}
                        {c.promiseOverdue && <span className="mt-1 block text-xs font-medium text-destructive">Promise Overdue</span>}
                        {c.level > 0 && <span className="mt-1 block text-xs text-warn">Escalated L{c.level}</span>}
                      </Td>
                    </RowButton>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No AR cases match these filters.</Empty>}
          </ListCard>
        }
        panel={current ? <ArPanel key={current.id} c={current} allowed={allowed} today={today} /> : <PanelEmpty>Select a case to follow it up.</PanelEmpty>}
      />
    </RcmPage>
  );
}

function ArPanel({ c, allowed, today }: { c: ArCase; allowed: boolean; today: Date }) {
  const [action, setAction] = React.useState<ArAction | null>(null);
  const actions: ArAction[] = c.status === "Closed" ? ["reopen"] : (["in-review", "follow-up", "promise", "assign", "escalate", "close"] as ArAction[]).filter((a) => a !== "in-review" || c.status !== "In Review");
  return (
    <Panel eyebrow={`${c.kind} AR`} title={c.ref} badge={<StatusBadge status={c.status} />} sub={<>{c.patientName}{c.mrn ? `, ${c.mrn}` : ""}, {c.payer}</>}
      actions={allowed ? (
        <>
          {actions.map((a, i) => <Button key={a} size="sm" variant={i === 0 ? "primary" : "secondary"} className={i === 0 ? BRAND : undefined} onClick={() => setAction(a)}>{AR_ACTION_LABEL[a]}</Button>)}
          {c.visit && <Button size="sm" variant="ghost" onClick={() => navigate(c.kind === "Patient" ? "/invoice" : "/claim", { visit: c.visit })}><ExternalLink className="size-4" aria-hidden="true" />{c.kind === "Patient" ? "View Invoice" : "View Claim"}</Button>}
        </>
      ) : <NoAccess />}>
      <Section title="Case Summary">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><p className="text-xs text-muted-foreground">Outstanding Balance</p><Money value={c.outstanding} className="text-2xl font-semibold tracking-tight" /></div>
          <div className="text-right"><StatusBadge status={c.priority} /><p className="mt-1 text-xs text-muted-foreground">{daysText(c.days)}, {c.bucket} bucket</p></div>
        </div>
        <Facts items={[
          ["AR Type", c.kind], ["Ageing Start", fmtDay(c.agingStart)], ["Collection Stage", c.stage], ["Escalation Level", ESCALATION_LEVELS[c.level]],
          ["Assigned To", c.assignee], ["Next Follow-Up", c.nextFollowUp && <span key="f" className={c.followUpOverdue ? "text-destructive" : undefined}>{fmtDay(c.nextFollowUp)}{c.followUpOverdue ? ", overdue" : ""}</span>],
          ["Promise Date", c.promise && <span key="p" className={c.promiseOverdue ? "text-destructive" : undefined}>{fmtDay(c.promise.date)}{c.promiseOverdue ? ", overdue" : ""}</span>],
          ["Promise Amount", c.promise && <Money key="m" value={c.promise.amount} />],
        ]} />
      </Section>
      <Section title="Collection History"><Timeline notes={c.notes} history={c.history} /></Section>
      {action && <ArDialog c={c} action={action} today={today} onClose={() => setAction(null)} />}
    </Panel>
  );
}

/** The HIS Manage Workflow dialog for one action: the fields that action needs, then the required notes. */
function ArDialog({ c, action, today, onClose }: { c: ArCase; action: ArAction; today: Date; onClose: () => void }) {
  const [f, setF] = React.useState({ notes: "", date: "", amount: action === "promise" ? String(c.outstanding) : "", collector: "", level: String(Math.min(3, c.level + 1)), stage: "" });
  const [errors, setErrors] = React.useState<string[]>([]);
  const input = { notes: f.notes, date: f.date || undefined, amount: f.amount === "" ? undefined : Number(f.amount), collector: f.collector || undefined, level: Number(f.level), stage: f.stage || undefined };
  const submit = () => {
    const e = validateArAction(c, action, input, today);
    setErrors(e);
    if (!e.length && run(arAction(c, action, input, today), `${AR_ACTION_LABEL[action]} saved.`)) onClose();
  };
  const min = dayOf(today);
  return (
    <Dialog open onClose={onClose} title={AR_ACTION_LABEL[action]} subtitle={`${c.ref}, ${c.patientName}. Outstanding ${c.outstanding.toFixed(2)} SAR.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" className={BRAND} onClick={submit}>Submit Action</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {action === "follow-up" && <Field label="Next Follow-Up Date" required><Input type="date" min={min} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>}
        {action === "promise" && (
          <>
            <Field label="Promise Amount (SAR)" required><Input type="number" min={0} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Promise Pay Date" required><Input type="date" min={min} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </>
        )}
        {action === "assign" && (
          <Field label="Collector" required className="sm:col-span-2">
            <Select value={f.collector} onChange={(e) => setF({ ...f, collector: e.target.value })}><option value="">Choose A Collector</option>{COLLECTORS.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
        )}
        {action === "escalate" && (
          <Field label="Escalation Level" required>
            <Select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{ESCALATION_LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}</Select>
          </Field>
        )}
        {action !== "assign" && (
          <Field label="Collection Stage">
            <Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">{c.stage ? `Keep ${c.stage}` : "No Change"}</option>{COLLECTION_STAGES.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
        )}
        <Field label="Action Notes" required className="sm:col-span-2">
          <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} placeholder="Who you spoke to and what they said" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </Field>
      </div>
      {errors.length > 0 && <ul role="alert" className="mt-3 list-disc space-y-0.5 rounded-lg bg-destructive/8 py-2 pl-7 pr-3 text-[0.8125rem] text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Dialog>
  );
}
