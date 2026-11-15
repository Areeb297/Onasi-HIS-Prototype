import * as React from "react";
import { IconAlertOctagon, IconClockHour4, IconShieldSearch, IconZoomMoney } from "@tabler/icons-react";
import { ExternalLink, Play, RotateCcw, ShieldCheck, StickyNote, UserCheck } from "lucide-react";
import { Money } from "@/components/Money";
import {
  ActionDialog, BRAND, ClearButton, Facts, ListCard, NoAccess, NoteDialog, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Timeline, Toolbar,
  daysText, fmtDay, matches, run, useRcmData,
} from "@/components/rcm/RcmUi";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Button, Empty, Field, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { addNote, assignFwa, FWA_OUTCOMES, FWA_REVIEWERS, fwaCases, moveFwa, type FwaCase } from "@/lib/rcm-cases";
import { navigate } from "@/lib/router";

const STATUSES = ["Active", "Open", "In Review", "Closed", "All"] as const;
const TYPES = ["Error", "Waste", "Abuse", "Suspected Fraud", "Anomaly"];
const STAGES = ["Pre Submission", "Post Claim Response"];

const riskLevel = (score: number) => (score >= 70 ? "High" : score >= 40 ? "Medium" : "Low");

/**
 * FWA Management: fraud, waste and abuse flags raised by the rule engine on claims, before they are sent or after the
 * payer answered. A reviewer checks the evidence and records the outcome. HIS rcm/fwa-management.
 */
export function FwaPage() {
  const { s, claims, today, allowed } = useRcmData();
  const cases = React.useMemo(() => fwaCases(s, claims, today), [s, claims, today]);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("Active");
  const [type, setType] = React.useState("");
  const [stage, setStage] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = cases.filter((c) =>
    (status === "All" || (status === "Active" ? c.status !== "Closed" : c.status === status)) && (!type || c.flag.findingType === type) && (!stage || c.flag.stage === stage) &&
    matches(q, c.claimNumber, c.patientName, c.payer, c.flag.ruleName, c.flag.ruleCode));
  const current = cases.find((c) => c.id === sel) ?? null;
  const active = cases.filter((c) => c.status !== "Closed");
  const open = cases.filter((c) => c.status === "Open");

  return (
    <RcmPage title="FWA Management" subtitle="Fraud, waste and abuse flags on claims. Check the evidence, record what the review found, and correct the claim when needed.">
      <KpiStrip label="FWA totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconShieldSearch stroke={1.75} />} label="Open Findings" value={active.length} note={`${new Set(active.map((c) => c.claimNumber)).size} claims to review`} />
        <KpiTile icon={<IconAlertOctagon stroke={1.75} />} accent="danger" label="High Risk" value={active.filter((c) => c.flag.score >= 70).length} note="Risk score 70 or more" />
        <KpiTile icon={<IconZoomMoney stroke={1.75} />} label="Amount At Risk" value={<Money value={active.reduce((n, c) => n + c.flag.atRisk, 0)} />} note="On active findings" />
        <KpiTile icon={<IconClockHour4 stroke={1.75} />} accent="warn" label="Oldest Open" value={open.length ? daysText(Math.max(...open.map((c) => c.ageDays))) : "None"} note="Since the flag was raised" />
      </KpiStrip>
      <Toolbar query={q} onQuery={setQ} placeholder="Search claim, patient or rule" status={status} statuses={STATUSES} onStatus={(v) => setStatus(v as typeof status)} count={rows.length} unit={["finding", "findings"]}>
        <MiniSelect label="Finding Type" value={type} onChange={setType} options={TYPES} all="All Types" />
        <MiniSelect label="Stage" value={stage} onChange={setStage} options={STAGES} all="All Stages" />
        {(q || type || stage || status !== "Active") && <ClearButton onClick={() => { setQ(""); setType(""); setStage(""); setStatus("Active"); }} />}
      </Toolbar>
      <SplitView label="FWA finding" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title="Findings" note="Highest risk first.">
            {rows.length ? (
              <Table>
                <thead><tr><Th className="hidden sm:table-cell">Claim</Th><Th>Rule That Fired</Th><Th numeric>Risk</Th><Th className="hidden 2xl:table-cell">Stage</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <RowButton key={c.id} selected={c.id === sel} onOpen={() => setSel(c.id)} label={`${c.flag.ruleName}, ${c.claimNumber}`}>
                      <Td className="hidden whitespace-nowrap font-medium tabular-nums sm:table-cell">{c.claimNumber}<span className="block text-xs font-normal text-muted-foreground">{c.patientName}</span></Td>
                      <Td className="sm:min-w-[12rem]">{c.flag.ruleName}<span className="block text-xs text-muted-foreground"><span className="sm:hidden">{c.claimNumber}, </span>{c.flag.findingType}, {c.flag.ruleCode}<span className="2xl:hidden">, {c.flag.stage}</span></span></Td>
                      <Td numeric><RiskScore score={c.flag.score} /></Td>
                      <Td className="hidden whitespace-nowrap 2xl:table-cell">{c.flag.stage}</Td>
                      <Td className="whitespace-nowrap"><StatusBadge status={c.status} />{c.outcome && <span className="mt-1 block text-xs text-muted-foreground">{c.outcome}</span>}</Td>
                    </RowButton>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No findings match these filters.</Empty>}
          </ListCard>
        }
        panel={current ? <FwaPanel key={current.id} c={current} allowed={allowed} /> : <PanelEmpty>Select a finding to see the evidence and record the review.</PanelEmpty>}
      />
    </RcmPage>
  );
}

function MiniSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (v: string) => void; options: string[]; all: string }) {
  const id = React.useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] text-muted-foreground">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="glass-pill h-8 rounded-full pl-2.5 pr-7 text-[0.8125rem] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:[color-scheme:dark]">
        <option value="">{all}</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </span>
  );
}

function RiskScore({ score }: { score: number }) {
  const level = riskLevel(score);
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="font-semibold tabular-nums">{score}</span><StatusBadge status={level} className="hidden sm:inline-flex" /></span>;
}

function RiskMeter({ score }: { score: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.8125rem]"><span className="text-muted-foreground">Risk Score</span><span><span className="text-xl font-semibold tabular-nums">{score}</span><span className="text-muted-foreground"> of 100</span></span></div>
      <div className="relative mt-1.5 h-2 rounded-full bg-muted" role="meter" aria-valuenow={score} aria-valuemin={0} aria-valuemax={100} aria-label={`Risk score ${score} of 100, ${riskLevel(score)}`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,#39edd5,#03c1ac_45%,#032c26)]" style={{ width: `${score}%` }} />
        {[40, 70].map((t) => <span key={t} aria-hidden="true" className="absolute -top-0.5 h-3 w-px bg-foreground/30" style={{ left: `${t}%` }} />)}
      </div>
      <div className="mt-1 flex justify-between text-[0.6875rem] text-muted-foreground"><span>Low</span><span className="pl-[18%]">Medium from 40</span><span>High from 70</span></div>
    </div>
  );
}

type Dlg = "note" | "assign" | "review" | "close" | "reopen" | null;

function FwaPanel({ c, allowed }: { c: FwaCase; allowed: boolean }) {
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [reviewer, setReviewer] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const line = c.flag.lineSeq ? c.claim?.lines.find((l) => l.seq === c.flag.lineSeq) : undefined;
  const visit = c.claim?.visit ?? (c.flag.claimKey.startsWith("V") ? c.flag.claimKey : undefined);
  return (
    <Panel eyebrow={`${c.flag.findingType} Finding`} title={c.flag.ruleName} badge={<StatusBadge status={c.status} />}
      sub={<>{c.claimNumber}, {c.patientName}{c.payer ? `, ${c.payer}` : ""}</>}
      actions={allowed ? (
        <>
          {c.status === "Open" && (c.reviewer
            ? <Button variant="primary" size="sm" className={BRAND} onClick={() => setDlg("review")}><Play className="size-4" aria-hidden="true" />Start Review</Button>
            : <Button variant="primary" size="sm" className={BRAND} onClick={() => { setReviewer(""); setDlg("assign"); }}><UserCheck className="size-4" aria-hidden="true" />Assign Reviewer</Button>)}
          {c.status !== "Closed" && c.reviewer && <Button size="sm" onClick={() => { setReviewer(c.reviewer ?? ""); setDlg("assign"); }}><UserCheck className="size-4" aria-hidden="true" />Change Reviewer</Button>}
          {c.status !== "Closed" && <Button size="sm" onClick={() => { setOutcome(""); setDlg("close"); }}><ShieldCheck className="size-4" aria-hidden="true" />Record Outcome</Button>}
          <Button size="sm" onClick={() => setDlg("note")}><StickyNote className="size-4" aria-hidden="true" />Notes</Button>
          {visit && <Button size="sm" variant="ghost" onClick={() => navigate("/claim", { visit })}><ExternalLink className="size-4" aria-hidden="true" />Open Claim</Button>}
          {c.status === "Closed" && <Button size="sm" variant="ghost" onClick={() => setDlg("reopen")}><RotateCcw className="size-4" aria-hidden="true" />Reopen</Button>}
        </>
      ) : <NoAccess />}>
      <Section title="What Was Found">
        <RiskMeter score={c.flag.score} />
        <p className="mt-3 text-[0.8125rem]">{c.flag.description}</p>
        <p className="mt-1 text-xs text-muted-foreground">Rule {c.flag.ruleCode}</p>
      </Section>
      <Section title="Evidence">
        <ul className="list-disc space-y-1 pl-4 text-[0.8125rem] marker:text-[#03c1ac]">{c.flag.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
        {line && (
          <div className="glass-row mt-2.5 rounded-xl px-3 py-2 text-[0.8125rem]">
            <p className="font-medium">Line {line.seq}: {line.text}</p>
            <p className="text-xs text-muted-foreground">{line.code}, claimed <Money value={line.claimed} /></p>
          </div>
        )}
      </Section>
      <Section title="Review">
        <Facts items={[
          ["Evaluation Stage", c.flag.stage], ["Finding Type", c.flag.findingType], ["Reviewer", c.reviewer], ["Outcome", c.outcome],
          ["Amount At Risk", <Money key="a" value={c.flag.atRisk} />], ["Raised On", fmtDay(c.flag.openedOn)],
        ]} />
      </Section>
      <Section title="Notes And History"><Timeline notes={c.notes} history={c.history} /></Section>

      <NoteDialog open={dlg === "note"} onClose={() => setDlg(null)} kindLabel="FWA" onSave={(n) => run(addNote("fwa", c.id, n, c.patientName), "Note saved.")} />
      <ActionDialog open={dlg === "assign"} onClose={() => setDlg(null)} title="Assign Reviewer" submit="Assign" notePlaceholder="What the reviewer should check"
        onSubmit={(n) => run(assignFwa(c, reviewer, n), `Assigned to ${reviewer}.`)}>
        <Field label="Reviewer" required><Select value={reviewer} onChange={(e) => setReviewer(e.target.value)}><option value="">Choose</option>{FWA_REVIEWERS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
      </ActionDialog>
      <ActionDialog open={dlg === "review"} onClose={() => setDlg(null)} title="Start Review" submit="Start Review" onSubmit={(n) => run(moveFwa(c, "In Review", n), "Review started.")} />
      <ActionDialog open={dlg === "close"} onClose={() => setDlg(null)} title="Record Outcome" subtitle="Closes the finding with what the review found." submit="Close Finding" noteLabel="Findings"
        onSubmit={(n) => run(moveFwa(c, "Closed", n, outcome), "Finding closed.")}>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Outcome <span className="text-destructive" aria-hidden="true">*</span></legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {FWA_OUTCOMES.map((o) => (
              <label key={o} className={cn("glass-row flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[0.8125rem]", outcome === o && "ring-2 ring-[#03c1ac]")}>
                <input type="radio" name="fwa-outcome" className="accent-[#032c26]" checked={outcome === o} onChange={() => setOutcome(o)} />{o}
              </label>
            ))}
          </div>
        </fieldset>
      </ActionDialog>
      <ActionDialog open={dlg === "reopen"} onClose={() => setDlg(null)} title="Reopen Finding" submit="Reopen" onSubmit={(n) => run(moveFwa(c, "Open", n), "Finding reopened.")} />
    </Panel>
  );
}
