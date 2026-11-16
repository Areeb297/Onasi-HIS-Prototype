import * as React from "react";
import { IconAlertTriangle, IconClockHour4, IconFileAlert, IconReceiptOff } from "@tabler/icons-react";
import { Pencil, RotateCcw, Send, StickyNote, X } from "lucide-react";
import { Money } from "@/components/Money";
import { openClaimAt } from "@/components/rcm/openClaimAt";
import {
  ActionDialog, ClearButton, Facts, LedgerBar, ListCard, NoAccess, NoteDialog, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Timeline, Toolbar,
  daysText, fmtDay, matches, run, useRcmData,
  BRAND,
  Dialog,
} from "@/components/rcm/RcmUi";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Input, Table, Td, Th } from "@/components/ui/primitives";
import {
  addNote, correctRejection, isActive, moveRejection, RCM_PAYERS, rejectionCases, resubmitRejection, startCorrection, type RejectionCase,
} from "@/lib/rcm-cases";
import { pushToast } from "@/lib/toast";

const STATUSES = ["Active", "Open", "In Review", "Resolved", "Closed", "All"] as const;

/**
 * Rejection Management: claims the payer refused because of errors. Each case lists the payer's error codes; the biller
 * corrects the claim, sends it again, and keeps notes of every contact. HIS rcm/rejection-management.
 */
export function RejectionsPage() {
  const { s, claims, today, allowed } = useRcmData();
  const cases = React.useMemo(() => rejectionCases(s, claims, today), [s, claims, today]);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<(typeof STATUSES)[number]>("Active");
  const [payer, setPayer] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = cases.filter((c) =>
    (status === "All" || (status === "Active" ? c.status !== "Closed" : c.status === status)) && (!payer || c.claim.payer === payer) &&
    matches(q, c.claim.claimNumber, c.claim.patientName, c.claim.mrn, c.claim.payer, ...c.errors.map((e) => e.code)));
  const current = cases.find((c) => c.id === sel) ?? null;
  const active = cases.filter((c) => c.status !== "Closed");
  const open = cases.filter((c) => c.status === "Open");

  return (
    <RcmPage title="Rejection Management" subtitle="Claims the payer refused because of errors. Correct each one and send it again, and record every contact with the payer.">
      <KpiStrip label="Rejection totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconFileAlert stroke={1.75} />} accent="warn" label="Open" value={open.length} note={`${active.length} still active`} />
        <KpiTile icon={<IconAlertTriangle stroke={1.75} />} label="Errors To Fix" value={active.reduce((n, c) => n + c.errors.filter((e) => !e.fixed).length, 0)} note="On active cases" />
        <KpiTile icon={<IconReceiptOff stroke={1.75} />} label="Amount Held" value={<Money value={active.reduce((n, c) => n + c.claim.claimed, 0)} />} note="Claimed on active cases" />
        <KpiTile icon={<IconClockHour4 stroke={1.75} />} label="Oldest Open" value={open.length ? daysText(Math.max(...open.map((c) => c.ageDays))) : "None"} note="Since the payer answered" tone={open.some((c) => c.ageDays > 30) ? "danger" : undefined} />
      </KpiStrip>
      <Toolbar query={q} onQuery={setQ} placeholder="Search claim, patient, MRN or code" status={status} statuses={STATUSES} onStatus={(v) => setStatus(v as typeof status)} payer={payer} onPayer={setPayer} payers={RCM_PAYERS} count={rows.length}>
        {(q || payer || status !== "Active") && <ClearButton onClick={() => { setQ(""); setPayer(""); setStatus("Active"); }} />}
      </Toolbar>
      <SplitView label="Rejection case" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title="Rejected Claims" note="Oldest first. Select a claim to work on it.">
            {rows.length ? (
              <Table>
                <thead><tr><Th>Claim</Th><Th className="hidden sm:table-cell">Patient</Th><Th className="hidden 2xl:table-cell">Payer</Th><Th className="hidden sm:table-cell">Errors</Th><Th numeric>Amount</Th><Th numeric className="hidden 2xl:table-cell">Age</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <RowButton key={c.id} selected={c.id === sel} onOpen={() => setSel(c.id)} label={`${c.claim.claimNumber}, ${c.claim.patientName}`}>
                      <Td className="whitespace-nowrap font-medium tabular-nums">{c.claim.claimNumber}<span className="block text-xs font-normal text-muted-foreground">{c.claim.live ? `Visit ${c.claim.visit}, ` : ""}<span className="2xl:hidden">{daysText(c.ageDays)}</span><span className="sm:hidden">, {c.claim.patientName}</span></span></Td>
                      <Td className="hidden whitespace-nowrap sm:table-cell">{c.claim.patientName}<span className="block text-xs text-muted-foreground">{c.claim.mrn}<span className="2xl:hidden">, {c.claim.payer}</span></span></Td>
                      <Td className="hidden whitespace-nowrap 2xl:table-cell">{c.claim.payer}</Td>
                      <Td className="hidden min-w-[10rem] max-w-[13rem] sm:table-cell">
                        <span className="font-medium tabular-nums">{c.errors[0]?.code ?? "No Code"}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.errors[0]?.text}{c.errors.length > 1 ? ` (and ${c.errors.length - 1} more)` : ""}</span>
                      </Td>
                      <Td numeric><Money value={c.claim.claimed} /></Td>
                      <Td numeric className="hidden whitespace-nowrap 2xl:table-cell">{daysText(c.ageDays)}</Td>
                      <Td className="whitespace-nowrap"><StatusBadge status={c.status} /></Td>
                    </RowButton>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No rejected claims match these filters.</Empty>}
          </ListCard>
        }
        panel={current ? <RejectionPanel key={current.id} c={current} allowed={allowed} /> : <PanelEmpty>Select a rejected claim to see the payer's errors and correct it.</PanelEmpty>}
      />
    </RcmPage>
  );
}

/** Every error has its fix recorded (HIS keeps the case In Review until it is resubmitted). */
const isCorrected = (c: RejectionCase) => c.status === "In Review" && c.errors.length > 0 && c.errors.every((e) => e.fixed);

function RejectionPanel({ c, allowed }: { c: RejectionCase; allowed: boolean }) {
  const [dlg, setDlg] = React.useState<"note" | "correct" | "close" | "reopen" | "review" | "resubmit" | null>(null);
  const live = c.claim.live;
  const first = c.errors[0];
  const canResubmit = c.status === "In Review" && (live || isCorrected(c));
  const correct = () => {
    if (live) {
      if (!run(startCorrection(c))) return;
      openClaimAt(c.claim.visit!, first?.field ?? "claim", first?.fieldLabel ?? "Claim");
    } else setDlg("correct");
  };
  return (
    <Panel eyebrow={live ? "Rejected Claim, Sent From This System" : "Rejected Claim"} title={c.claim.claimNumber} badge={<StatusBadge status={c.status} />}
      sub={<>{c.claim.patientName}, {c.claim.mrn}, {c.claim.payer}</>}
      actions={allowed ? (
        <>
          {isActive(c.status) && <Button variant="primary" size="sm" className={BRAND} onClick={correct}><Pencil className="size-4" aria-hidden="true" />Correct And Resubmit</Button>}
          {canResubmit && <Button size="sm" onClick={() => setDlg("resubmit")}><Send className="size-4" aria-hidden="true" />Resubmit</Button>}
          {c.status === "Open" && <Button size="sm" onClick={() => setDlg("review")}>Start Review</Button>}
          <Button size="sm" onClick={() => setDlg("note")}><StickyNote className="size-4" aria-hidden="true" />Notes</Button>
          {c.status !== "Closed" && <Button size="sm" variant="ghost" onClick={() => setDlg("close")}><X className="size-4" aria-hidden="true" />Close</Button>}
          {(c.status === "Closed" || c.status === "Resolved") && <Button size="sm" variant="ghost" onClick={() => setDlg("reopen")}><RotateCcw className="size-4" aria-hidden="true" />Reopen</Button>}
        </>
      ) : <NoAccess />}>
      <Section title="Claim">
        <Facts items={[
          ["Claim Type", c.claim.type], ["Service Date", fmtDay(c.claim.serviceDate)], ["Sent On", fmtDay(c.claim.submittedOn)],
          ["Rejected On", fmtDay(c.claim.answeredOn)], ["Assigned To", c.assignee], ["Age", daysText(c.ageDays)],
        ]} />
        <div className="mt-3"><LedgerBar claim={c.claim} /></div>
      </Section>
      <Section title={`Errors From The Payer (${c.errors.length})`}>
        <ul className="space-y-2.5">
          {c.errors.map((e, i) => {
            const line = e.seq ? c.claim.lines.find((l) => l.seq === e.seq) : undefined;
            return (
              <li key={i} className="glass-row rounded-xl px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-semibold tabular-nums">{e.code}</span>
                  <Badge>{e.scope === "Item" ? `Line ${e.seq}` : "Whole Claim"}</Badge>
                  {e.fixed && <Badge tone="ok">Corrected</Badge>}
                </div>
                <p className="mt-1 text-[0.8125rem]">{e.text}</p>
                {line && <p className="mt-0.5 text-xs text-muted-foreground">{line.code}, {line.text}, <Money value={line.claimed} /></p>}
                <p className="mt-1 text-xs text-muted-foreground">Fix in: <span className="font-medium text-[#035d53] dark:text-[#39edd5]">{e.fieldLabel}</span></p>
                {e.fixed && <p className="mt-1 text-xs"><span className="text-muted-foreground">Changed: </span>{e.fixed}</p>}
              </li>
            );
          })}
        </ul>
        {!c.errors.length && <p className="text-[0.8125rem] text-muted-foreground">The payer's error codes were not in the imported file. Ask the payer for them and add a note.</p>}
        {live && <p className="mt-2 text-xs text-muted-foreground">Correct And Resubmit opens the claim at {first?.fieldLabel ?? "the claim"}. Come back here to send it again, or send it from the claim page.</p>}
      </Section>
      <Section title="Notes And History"><Timeline notes={c.notes} history={c.history} /></Section>

      <NoteDialog open={dlg === "note"} onClose={() => setDlg(null)} kindLabel="Rejection" onSave={(n) => run(addNote("rejections", c.id, n, c.claim.patientName), "Note saved.")} />
      <CorrectDialog open={dlg === "correct"} onClose={() => setDlg(null)} c={c} />
      <ActionDialog open={dlg === "review"} onClose={() => setDlg(null)} title="Start Review" subtitle="Tells the team you are working on this claim." submit="Start Review"
        onSubmit={(note) => run(moveRejection(c, "In Review", note), "Case in review.")} />
      <ActionDialog open={dlg === "resubmit"} onClose={() => setDlg(null)} title="Resubmit Claim"
        subtitle={live ? "Runs the claim review, then sends the corrected claim through NPHIES." : "The claim goes back to the payer and waits for an answer. Record the answer in Manual Responses."}
        submit="Resubmit" notePlaceholder="What was corrected" onSubmit={(note) => run(resubmitRejection(c, note), "Claim sent again.")} />
      <ActionDialog open={dlg === "close"} onClose={() => setDlg(null)} title="Close Case" subtitle="Closing keeps the claim as rejected. Say why, for example the payer approved it, or the hospital accepts the loss." submit="Close Case"
        onSubmit={(note) => run(moveRejection(c, "Closed", note), "Case closed.")} />
      <ActionDialog open={dlg === "reopen"} onClose={() => setDlg(null)} title="Reopen Case" submit="Reopen" onSubmit={(note) => run(moveRejection(c, "Open", note), "Case reopened.")} />
    </Panel>
  );
}

/** Correction of a claim from before this system: what was changed for each error, then save or save and send. */
function CorrectDialog({ open, onClose, c }: { open: boolean; onClose: () => void; c: RejectionCase }) {
  const [fixes, setFixes] = React.useState<Record<string, string>>({});
  const [note, setNote] = React.useState("");
  React.useEffect(() => { if (open) { setFixes(Object.fromEntries(c.errors.map((e, i) => [String(i), e.fixed ?? ""]))); setNote(""); } }, [open, c]);
  const save = (send: boolean) => {
    const ok = isCorrected(c) ? true : run(correctRejection(c, fixes, note));
    if (!ok) return;
    if (send) {
      const now = { ...c, status: "In Review" as const };
      if (!run(resubmitRejection(now, note || "Sent the corrected claim to the payer."), "Claim corrected and sent again.")) return;
    } else pushOk();
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} wide title="Correct Claim" subtitle={`${c.claim.claimNumber} came from before this system, so it is corrected here. Write what you changed for each error.`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => save(false)}>Save Correction</Button><Button variant="primary" onClick={() => save(true)}>Save And Resubmit</Button></>}>
      <div className="grid gap-3">
        {c.errors.map((e, i) => (
          <Field key={i} required label={`${e.code} ${e.scope === "Item" ? `(Line ${e.seq})` : "(Whole Claim)"}`} hint={e.text}>
            <Input value={fixes[String(i)] ?? ""} onChange={(ev) => setFixes({ ...fixes, [String(i)]: ev.target.value })} placeholder={`What you changed in ${e.fieldLabel}`} />
          </Field>
        ))}
        <Field label="Notes"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know" /></Field>
      </div>
    </Dialog>
  );
}

const pushOk = () => pushToast({ tone: "ok", text: "Correction saved." });
