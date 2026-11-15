import * as React from "react";
import { IconArrowBackUp, IconClockHour4, IconGavel, IconReceiptOff } from "@tabler/icons-react";
import { Check, FileUp, RotateCcw, Scale, StickyNote, Trash2, UserRound, X } from "lucide-react";
import { Money } from "@/components/Money";
import {
  ActionDialog, BRAND, ClearButton, Facts, LedgerBar, ListCard, NoAccess, NoteDialog, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Timeline, Toolbar,
  daysText, fmtDay, fmtTime, matches, run, useRcmData,
  Dialog,
} from "@/components/rcm/RcmUi";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Table, Td, Th } from "@/components/ui/primitives";
import { addNote, appealDenial, decideWriteOff, denialCases, moveDenial, moveToPatient, RCM_PAYERS, requestWriteOff, type DenialCase } from "@/lib/rcm-cases";

const STATUSES = ["Active", "Open", "Appealed", "Resolved", "Closed", "All"] as const;

/**
 * Denial Management: lines the payer would not pay. Appeal them (a new claim linked to the denied one), write them off with
 * a second person's approval, or move them to the patient. HIS rcm/denial-management.
 */
export function DenialsPage() {
  const { s, claims, today, allowed, user } = useRcmData();
  const cases = React.useMemo(() => denialCases(s, claims, today), [s, claims, today]);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("Active");
  const [payer, setPayer] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = cases.filter((c) =>
    (status === "All" || (status === "Active" ? c.status === "Open" || c.status === "Appealed" : c.status === status)) && (!payer || c.claim.payer === payer) &&
    matches(q, c.claim.claimNumber, c.claim.patientName, c.claim.mrn, c.claim.payer, ...c.deniedLines.map((l) => l.reason)));
  const current = cases.find((c) => c.id === sel) ?? null;
  const active = cases.filter((c) => c.status === "Open" || c.status === "Appealed");
  const maxDenied = Math.max(1, ...rows.map((c) => c.denied));

  return (
    <RcmPage title="Denial Management" subtitle="Service lines the payer would not pay. Appeal them, write them off with approval, or move them to the patient.">
      <KpiStrip label="Denial totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconReceiptOff stroke={1.75} />} accent="danger" label="Denied, Still Open" value={<Money value={active.reduce((n, c) => n + c.open, 0)} />} note={`${active.length} active cases`} />
        <KpiTile icon={<IconGavel stroke={1.75} />} label="Under Appeal" value={<Money value={cases.filter((c) => c.status === "Appealed").reduce((n, c) => n + c.open, 0)} />} note={`${cases.filter((c) => c.status === "Appealed").length} appeals waiting for the payer`} />
        <KpiTile icon={<IconArrowBackUp stroke={1.75} />} label="Recovered On Appeal" value={<Money value={cases.reduce((n, c) => n + c.recovered, 0)} />} tone="ok" note="Approved after appeal" />
        <KpiTile icon={<IconClockHour4 stroke={1.75} />} accent="warn" label="Write-Offs Waiting" value={cases.filter((c) => c.writeOff?.status === "Pending").length} note="Need a second person to approve" />
      </KpiStrip>
      <Toolbar query={q} onQuery={setQ} placeholder="Search claim, patient, MRN or reason" status={status} statuses={STATUSES} onStatus={(v) => setStatus(v as typeof status)} payer={payer} onPayer={setPayer} payers={RCM_PAYERS} count={rows.length}>
        {(q || payer || status !== "Active") && <ClearButton onClick={() => { setQ(""); setPayer(""); setStatus("Active"); }} />}
      </Toolbar>
      <SplitView label="Denial case" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title="Denied Claims" note="Oldest first. The bar compares denied money between claims.">
            {rows.length ? (
              <Table>
                <thead><tr><Th>Claim</Th><Th className="hidden sm:table-cell">Patient</Th><Th className="hidden sm:table-cell">Denial Reason</Th><Th numeric>Denied</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <RowButton key={c.id} selected={c.id === sel} onOpen={() => setSel(c.id)} label={`${c.claim.claimNumber}, ${c.claim.patientName}`}>
                      <Td className="whitespace-nowrap font-medium tabular-nums">{c.claim.claimNumber}<span className="block text-xs font-normal text-muted-foreground">{daysText(c.ageDays)}<span className="sm:hidden">, {c.claim.patientName}</span></span></Td>
                      <Td className="hidden whitespace-nowrap sm:table-cell">{c.claim.patientName}<span className="block text-xs text-muted-foreground">{c.claim.mrn}, {c.claim.payer}</span></Td>
                      <Td className="hidden min-w-[9rem] max-w-[12rem] sm:table-cell">
                        <span className="font-medium tabular-nums">{c.deniedLines[0]?.reason}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.deniedLines[0]?.reasonText}{c.deniedLines.length > 1 ? ` (${c.deniedLines.length} lines)` : ""}</span>
                      </Td>
                      <Td numeric className="whitespace-nowrap">
                        <Money value={c.denied} />
                        <span aria-hidden="true" className="mt-1 ml-auto block h-1 w-16 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[#03c1ac]" style={{ width: `${(c.denied / maxDenied) * 100}%` }} /></span>
                      </Td>
                      <Td className="whitespace-nowrap"><StatusBadge status={c.status} />{c.writeOff?.status === "Pending" && <span className="mt-1 block text-xs text-warn">Write-off waiting</span>}</Td>
                    </RowButton>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No denied claims match these filters.</Empty>}
          </ListCard>
        }
        panel={current ? <DenialPanel key={current.id} c={current} allowed={allowed} user={user} /> : <PanelEmpty>Select a denied claim to appeal it, write it off or move it to the patient.</PanelEmpty>}
      />
    </RcmPage>
  );
}

type Dlg = "note" | "appeal" | "writeoff" | "approve" | "decline" | "patient" | "close" | "reopen" | null;

function DenialPanel({ c, allowed, user }: { c: DenialCase; allowed: boolean; user: string }) {
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const pending = c.writeOff?.status === "Pending";
  const own = pending && c.writeOff!.by === user;
  return (
    <Panel eyebrow={c.claim.state === "Denied" ? "Denied Claim" : "Partly Approved Claim"} title={c.claim.claimNumber} badge={<StatusBadge status={c.status} />}
      sub={<>{c.claim.patientName}, {c.claim.mrn}, {c.claim.payer}</>}
      actions={allowed ? (
        <>
          {c.status === "Open" && <Button variant="primary" size="sm" className={BRAND} onClick={() => setDlg("appeal")}><Scale className="size-4" aria-hidden="true" />Appeal</Button>}
          {c.status !== "Closed" && !pending && c.open > 0 && <Button size="sm" onClick={() => setDlg("writeoff")}><Trash2 className="size-4" aria-hidden="true" />Write Off</Button>}
          {(c.status === "Open" || c.status === "Appealed") && !pending && c.open > 0 && <Button size="sm" onClick={() => setDlg("patient")}><UserRound className="size-4" aria-hidden="true" />Move To Patient Responsibility</Button>}
          <Button size="sm" onClick={() => setDlg("note")}><StickyNote className="size-4" aria-hidden="true" />Notes</Button>
          {(c.status === "Open" || c.status === "Resolved") && <Button size="sm" variant="ghost" onClick={() => setDlg("close")}><X className="size-4" aria-hidden="true" />Close</Button>}
          {c.status === "Closed" && <Button size="sm" variant="ghost" onClick={() => setDlg("reopen")}><RotateCcw className="size-4" aria-hidden="true" />Reopen</Button>}
        </>
      ) : <NoAccess />}>
      <Section title="Claim">
        <Facts items={[["Claim Type", c.claim.type], ["Service Date", fmtDay(c.claim.serviceDate)], ["Answered On", fmtDay(c.claim.answeredOn)], ["Age", daysText(c.ageDays)]]} />
        <div className="mt-3"><LedgerBar claim={c.claim} /></div>
      </Section>
      <Section title={`Denied Lines (${c.deniedLines.length})`}>
        <ul className="space-y-2.5">
          {c.deniedLines.map((l) => (
            <li key={l.seq} className="glass-row rounded-xl px-3 py-2.5 text-[0.8125rem]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">Line {l.seq}: {l.text}</p>
                  <p className="text-xs text-muted-foreground">{l.code}</p>
                </div>
                <Money value={l.denied} className="font-semibold text-destructive" />
              </div>
              <p className="mt-1.5"><span className="font-semibold tabular-nums">{l.reason}</span> {l.reasonText}</p>
              <p className="mt-1 text-xs text-muted-foreground">Claimed <Money value={l.claimed} />, approved <Money value={l.approved ?? 0} />{l.patientShare ? <>, patient share <Money value={l.patientShare} /></> : null}</p>
            </li>
          ))}
        </ul>
        <p className="mt-2 flex justify-between text-[0.8125rem]"><span className="text-muted-foreground">Still open</span><Money value={c.open} className="font-semibold" /></p>
      </Section>
      {c.appeal && (
        <Section title="Appeal" right={<StatusBadge status={c.appeal.state} />}>
          <Facts items={[["Appeal Claim", c.appeal.claimNumber], ["Sent On", fmtDay(c.appeal.at)], ["Sent By", c.appeal.by], ["Recovered", <Money key="r" value={c.appeal.approved} />]]} />
          <p className="mt-2 text-[0.8125rem]">{c.appeal.reason}</p>
          {c.appeal.attachments.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{c.appeal.attachments.map((a) => <li key={a}><Badge>{a}</Badge></li>)}</ul>}
          {c.appeal.state === "Submitted" && <p className="mt-2 text-xs text-muted-foreground">Waiting for the payer. Record the answer in Claim Import, Manual Responses.</p>}
        </Section>
      )}
      {c.writeOff && (
        <Section title="Write-Off" right={<StatusBadge status={c.writeOff.status} />}>
          <p className="text-[0.8125rem]"><Money value={c.writeOff.amount} className="font-semibold" /> asked by {c.writeOff.by}, {fmtTime(c.writeOff.at)}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{c.writeOff.reason}</p>
          {c.writeOff.decidedBy && <p className="mt-1 text-xs text-muted-foreground">{c.writeOff.status} by {c.writeOff.decidedBy}, {fmtTime(c.writeOff.decidedAt!)}</p>}
          {pending && allowed && (own
            ? <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">You asked for this write-off, so another billing officer or a manager must approve it.</p>
            : <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" className={BRAND} onClick={() => setDlg("approve")}><Check className="size-4" aria-hidden="true" />Approve Write Off</Button><Button size="sm" onClick={() => setDlg("decline")}>Decline</Button></div>)}
        </Section>
      )}
      {c.movedToPatient && (
        <Section title="Patient Responsibility">
          <p className="text-[0.8125rem]"><Money value={c.movedToPatient.amount} className="font-semibold" /> moved to the patient by {c.movedToPatient.by}, {fmtTime(c.movedToPatient.at)}. It is followed up in AR Management.</p>
        </Section>
      )}
      <Section title="Notes And History"><Timeline notes={c.notes} history={c.history} /></Section>

      <NoteDialog open={dlg === "note"} onClose={() => setDlg(null)} kindLabel="Denial" onSave={(n) => run(addNote("denials", c.id, n, c.claim.patientName), "Note saved.")} />
      <AppealDialog open={dlg === "appeal"} onClose={() => setDlg(null)} c={c} />
      <ActionDialog open={dlg === "writeoff"} onClose={() => setDlg(null)} title="Write Off" danger submit="Ask For Approval" noteLabel="Reason"
        subtitle={`Asks to write off ${c.open.toFixed(2)} SAR. Nothing is written off until another person approves it.`} onSubmit={(n) => run(requestWriteOff(c, n), "Write-off sent for approval.")} />
      <ActionDialog open={dlg === "approve"} onClose={() => setDlg(null)} title="Approve Write Off" submit="Approve" subtitle={`Writes off ${c.writeOff?.amount.toFixed(2)} SAR and closes the case.`}
        onSubmit={(n) => run(decideWriteOff(c, true, n), "Write-off approved.")} />
      <ActionDialog open={dlg === "decline"} onClose={() => setDlg(null)} title="Decline Write Off" danger submit="Decline" onSubmit={(n) => run(decideWriteOff(c, false, n), "Write-off declined.")} />
      <ActionDialog open={dlg === "patient"} onClose={() => setDlg(null)} title="Move To Patient Responsibility" submit="Move To Patient"
        subtitle={`${c.open.toFixed(2)} SAR becomes the patient's to pay and appears in AR Management. Tell the patient why the insurance did not pay.`}
        onSubmit={(n) => run(moveToPatient(c, n), "Moved to the patient.")} />
      <ActionDialog open={dlg === "close"} onClose={() => setDlg(null)} title="Close Case" submit="Close Case" onSubmit={(n) => run(moveDenial(c, "Closed", n), "Case closed.")} />
      <ActionDialog open={dlg === "reopen"} onClose={() => setDlg(null)} title="Reopen Case" submit="Reopen" onSubmit={(n) => run(moveDenial(c, "Open", n), "Case reopened.")} />
    </Panel>
  );
}

/** Appeal: choose the denied lines, say why the payer should pay, and list the documents sent with it. */
function AppealDialog({ open, onClose, c }: { open: boolean; onClose: () => void; c: DenialCase }) {
  const [seqs, setSeqs] = React.useState<number[]>([]);
  const [reason, setReason] = React.useState("");
  const [files, setFiles] = React.useState<string[]>([]);
  React.useEffect(() => { if (open) { setSeqs(c.deniedLines.map((l) => l.seq)); setReason(""); setFiles([]); } }, [open, c]);
  const total = c.deniedLines.filter((l) => seqs.includes(l.seq)).reduce((n, l) => n + l.denied, 0);
  const save = () => {
    const r = appealDenial(c, { seqs, reason, attachments: files });
    if (run(r, r.ok ? `Appeal ${r.id} sent to the payer.` : undefined)) onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} wide title="Appeal Denied Lines" subtitle={`Creates appeal claim ${c.claim.claimNumber}-AP linked to ${c.claim.claimNumber}, for the lines you choose.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" className={BRAND} onClick={save}>Send Appeal</Button></>}>
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Lines To Appeal</legend>
          <ul className="space-y-1.5">
            {c.deniedLines.map((l) => (
              <li key={l.seq}>
                <label className="glass-row flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem]">
                  <input type="checkbox" className="size-4 accent-[#032c26]" checked={seqs.includes(l.seq)} onChange={(e) => setSeqs(e.target.checked ? [...seqs, l.seq] : seqs.filter((x) => x !== l.seq))} />
                  <span className="min-w-0 flex-1"><span className="font-medium">Line {l.seq}: {l.text}</span><span className="block text-xs text-muted-foreground">{l.reason} {l.reasonText}</span></span>
                  <Money value={l.denied} />
                </label>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-right text-[0.8125rem]">Appealed amount <Money value={total} className="font-semibold" /></p>
        </fieldset>
        <Field label="Why The Payer Should Pay" required hint="For example: the approval number, the clinical reason, or the contract price.">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </Field>
        <div>
          <span className="text-sm font-medium">Attachments</span>
          <label className="mt-1.5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-input px-3 py-3 text-[0.8125rem] text-muted-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
            <FileUp className="size-4" aria-hidden="true" /> Add Files (only the file names are kept)
            <input type="file" multiple className="sr-only" onChange={(e) => { setFiles([...files, ...[...(e.target.files ?? [])].map((f) => f.name)]); e.target.value = ""; }} />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li key={`${f}${i}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">{f}
                  <button type="button" aria-label={`Remove ${f}`} className="rounded hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X className="size-3" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
