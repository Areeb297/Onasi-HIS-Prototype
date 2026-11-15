import * as React from "react";
import { IconFileImport, IconFileSpreadsheet, IconFileX, IconMessageReply } from "@tabler/icons-react";
import { Download, FileUp, RotateCcw, Save } from "lucide-react";
import { Money } from "@/components/Money";
import {
  BRAND, Facts, LedgerBar, ListCard, NoAccess, Panel, PanelEmpty, RcmPage, RowButton, Section, SplitView, StatusBadge, Toolbar,
  fmtDay, fmtTime, matches, run, useRcmData,
} from "@/components/rcm/RcmUi";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Empty, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { dayOf, DENIAL_CODES, REJECTION_CODES, recordResponse, saveImported, type RcmClaim, type RcmState } from "@/lib/rcm-cases";
import { autoMap, checkRows, IMPORT_FIELDS, missingRequired, readTable, templateCsv, type ImportRow, type Mapping, type Table as Sheet } from "@/lib/rcm-import";
import { navigate } from "@/lib/router";
import { useHis } from "@/lib/store";

const TABS = ["Import File", "Manual Responses"] as const;

/**
 * Claim Import: load claims from another system (CSV or Excel .xlsx, read in the browser), map the columns, check every
 * row, and save the selected ones. Manual Responses: type in the payer's answer for a claim whose answer did not come
 * through NPHIES. HIS rcm/import and rcm/manual-response.
 */
export function ClaimImportPage() {
  const { s, claims, allowed } = useRcmData();
  const [tab, setTab] = React.useState<(typeof TABS)[number]>(() => (location.hash.includes("manual-response") ? "Manual Responses" : "Import File"));
  const waiting = claims.filter((c) => !c.live && c.state === "Submitted");
  const last = s.imports[0];
  return (
    <RcmPage title={tab === "Import File" ? "Claim Import" : "Manual Responses"}
      subtitle={tab === "Import File" ? "Load claims from another system. Map the columns, check every row, and save the ones that are ready." : "Type in the payer's answer for a claim when it did not come through NPHIES. Rejected and denied answers open cases straight away."}
      right={<GlassPillSwitch label="Claim import view" value={tab} options={TABS} onChange={setTab} />}>
      <KpiStrip label="Import totals" className="grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={<IconFileImport stroke={1.75} />} label="Files Imported" value={s.imports.length} note={last ? `Last: ${last.fileName}` : "None yet"} />
        <KpiTile icon={<IconFileSpreadsheet stroke={1.75} />} label="Claims Saved" value={s.imports.reduce((n, b) => n + b.saved, 0)} note={`${s.imports.reduce((n, b) => n + b.created, 0)} new, ${s.imports.reduce((n, b) => n + b.updated, 0)} updated`} />
        <KpiTile icon={<IconMessageReply stroke={1.75} />} accent="warn" label="Waiting For Answer" value={waiting.length} note={<><Money value={waiting.reduce((n, c) => n + c.claimed, 0)} /> claimed</>} />
        <KpiTile icon={<IconFileX stroke={1.75} />} label="Rows Left Out" value={s.imports.reduce((n, b) => n + b.invalid, 0)} note="Invalid rows not saved" />
      </KpiStrip>
      {tab === "Import File" ? <ImportFlow allowed={allowed} claims={claims} s={s} /> : <ManualResponses waiting={waiting} allowed={allowed} />}
    </RcmPage>
  );
}

/* ---------- Import File ---------- */

type Step = "upload" | "map" | "review" | "done";
const STEPS: { id: Step; label: string }[] = [{ id: "upload", label: "Upload" }, { id: "map", label: "Map Columns" }, { id: "review", label: "Review" }, { id: "done", label: "Saved" }];
const FILTERS = ["All Rows", "Ready", "Update Existing", "New Patients", "Invalid"] as const;

function ImportFlow({ allowed, claims, s }: { allowed: boolean; claims: RcmClaim[]; s: RcmState }) {
  const his = useHis();
  const [step, setStep] = React.useState<Step>("upload");
  const [file, setFile] = React.useState("");
  const [sheet, setSheet] = React.useState<Sheet | null>(null);
  const [map, setMap] = React.useState<Mapping>({});
  const [rows, setRows] = React.useState<ImportRow[]>([]);
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("All Rows");
  const [q, setQ] = React.useState("");
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState<{ created: number; updated: number; patients: number } | null>(null);
  const [drag, setDrag] = React.useState(false);

  const load = async (f: File | undefined) => {
    if (!f) return;
    setError("");
    try {
      const t = await readTable(f);
      setFile(f.name); setSheet(t); setMap(autoMap(t.headers)); setStep("map");
    } catch (e) { setError(e instanceof Error ? e.message : "The file could not be read."); }
  };
  const check = () => {
    if (!sheet) return;
    const ledger = new Set(s.claims.map((c) => c.claimNumber));
    const live = new Set(claims.filter((c) => c.live).map((c) => c.claimNumber));
    const out = checkRows(sheet, map, {
      ledger, live,
      mrns: new Set([...his.patients.map((p) => p.mrn.toUpperCase()), ...s.claims.map((c) => c.mrn.toUpperCase())]),
      nationalIds: new Set([...his.patients.map((p) => p.nationalId), ...s.claims.map((c) => c.nationalId ?? "")].filter(Boolean)),
    });
    setRows(out); setPicked(new Set(out.filter((r) => r.status !== "Invalid").map((r) => r.index))); setStep("review");
  };
  const save = () => {
    const chosen = rows.filter((r) => picked.has(r.index) && r.status !== "Invalid");
    const r = saveImported(file, chosen.map((x) => ({ claim: x.claim, update: x.status === "Update" })), rows.filter((x) => x.status === "Invalid").length, rows.length);
    if (run(r, "Import saved.")) {
      setResult({ created: chosen.filter((x) => x.status === "Ready").length, updated: chosen.filter((x) => x.status === "Update").length, patients: chosen.filter((x) => x.patient === "New").length });
      setStep("done");
    }
  };
  const restart = () => { setStep("upload"); setSheet(null); setRows([]); setPicked(new Set()); setFile(""); setResult(null); setError(""); };
  const template = () => {
    const url = URL.createObjectURL(new Blob([`﻿${templateCsv()}`], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "Claim_Import_Template.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };
  const missing = missingRequired(map);
  const shown = rows.filter((r) =>
    (filter === "All Rows" || (filter === "Ready" && r.status === "Ready") || (filter === "Update Existing" && r.status === "Update") || (filter === "New Patients" && r.patient === "New") || (filter === "Invalid" && r.status === "Invalid")) &&
    matches(q, r.claim.claimNumber, r.claim.patientName, r.claim.payer));
  const counts = { ready: rows.filter((r) => r.status === "Ready").length, update: rows.filter((r) => r.status === "Update").length, invalid: rows.filter((r) => r.status === "Invalid").length, newPt: rows.filter((r) => r.patient === "New" && r.status !== "Invalid").length };
  const at = STEPS.findIndex((x) => x.id === step);

  return (
    <div className="mt-4 grid gap-4">
      <ol className="glass-card flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl px-4 py-3" aria-label="Import steps">
        {STEPS.map((x, i) => (
          <li key={x.id} className="flex items-center gap-2 text-[0.8125rem]" aria-current={i === at ? "step" : undefined}>
            <span className={cn("flex size-6 items-center justify-center rounded-full text-xs font-semibold", i < at ? "bg-[#03c1ac] text-[#032c26]" : i === at ? "bg-[#032c26] text-white dark:bg-[#39edd5] dark:text-[#032c26]" : "bg-muted text-muted-foreground")}>{i + 1}</span>
            <span className={cn(i === at ? "font-semibold" : "text-muted-foreground")}>{x.label}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        ))}
        {step !== "upload" && <Button size="sm" variant="ghost" className="ml-auto" onClick={restart}><RotateCcw className="size-4" aria-hidden="true" />Upload Again</Button>}
      </ol>

      {step === "upload" && (
        <section className="glass-panel rounded-2xl p-4 sm:p-6">
          {!allowed && <div className="mb-3"><NoAccess /></div>}
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files[0]); }}
            className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-12 text-center transition-colors focus-within:ring-2 focus-within:ring-ring",
              drag ? "border-[#03c1ac] bg-[#39edd5]/10" : "border-input hover:bg-muted/50", !allowed && "pointer-events-none opacity-50")}>
            <span className="glass-icon flex size-12 items-center justify-center rounded-2xl"><FileUp className="size-6" aria-hidden="true" /></span>
            <span className="text-[0.9375rem] font-semibold">Drop a claim file here, or choose one</span>
            <span className="max-w-md text-[0.8125rem] text-muted-foreground">CSV or Excel (.xlsx), one claim per row with a header row. The file is read in this browser; nothing is uploaded until you save.</span>
            <input type="file" accept=".csv,.xlsx" className="sr-only" disabled={!allowed} onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/8 px-3 py-2 text-[0.8125rem] text-destructive">{error}</p>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Older .xls files are not read: save them as .xlsx or .csv first. Only the first worksheet is read.</p>
            <Button size="sm" onClick={template}><Download className="size-4" aria-hidden="true" />Download Template (.csv)</Button>
          </div>
          {s.imports.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 text-[0.9375rem] font-semibold">Previous Imports</h2>
              <Table>
                <thead><tr><Th>Import</Th><Th>File</Th><Th className="hidden sm:table-cell">By</Th><Th numeric>New</Th><Th numeric>Updated</Th><Th numeric>Invalid</Th></tr></thead>
                <tbody>{s.imports.map((b) => (
                  <tr key={b.id}><Td className="whitespace-nowrap font-medium">{b.id}<span className="block text-xs font-normal text-muted-foreground">{fmtTime(b.at)}</span></Td><Td className="max-w-[14rem] truncate">{b.fileName}</Td><Td className="hidden sm:table-cell">{b.by}</Td><Td numeric>{b.created}</Td><Td numeric>{b.updated}</Td><Td numeric>{b.invalid}</Td></tr>
                ))}</tbody>
              </Table>
            </div>
          )}
        </section>
      )}

      {step === "map" && sheet && (
        <section className="glass-panel rounded-2xl p-4 sm:p-5">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-[0.9375rem] font-semibold">Map Columns</h2>
              <p className="text-xs text-muted-foreground">{file}: {sheet.rows.length} rows, {sheet.headers.length} columns. Columns with the same name were matched for you.</p>
            </div>
            <Button variant="primary" className={BRAND} disabled={missing.length > 0} onClick={check}>Check Rows</Button>
          </header>
          {missing.length > 0 && <p role="status" className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-[0.8125rem] text-warn">Still to map: {missing.map((f) => f.label).join(", ")}.</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {IMPORT_FIELDS.map((f) => {
              const i = map[f.key];
              const sample = i !== undefined && i >= 0 ? sheet.rows.slice(0, 2).map((r) => r[i]).filter(Boolean).join(", ") : "";
              return (
                <Field key={f.key} label={f.label} required={f.required} hint={sample ? `For example: ${sample}` : f.hint}>
                  <Select value={i ?? -1} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })} aria-invalid={f.required && (i === undefined || i < 0)}>
                    <option value={-1}>Not In File</option>
                    {sheet.headers.map((h, j) => <option key={j} value={j}>{h || `Column ${j + 1}`}</option>)}
                  </Select>
                </Field>
              );
            })}
          </div>
        </section>
      )}

      {step === "review" && (
        <>
          <KpiStrip label="Rows checked" className="grid-cols-2 lg:grid-cols-4">
            <KpiTile dense label="Total Records" value={rows.length} />
            <KpiTile dense label="Ready To Import" value={counts.ready + counts.update} note={`${counts.ready} new, ${counts.update} update saved claims`} tone="ok" />
            <KpiTile dense label="New Patients" value={counts.newPt} note="Not found by MRN or National ID" />
            <KpiTile dense accent="danger" label="Invalid" value={counts.invalid} tone={counts.invalid ? "danger" : undefined} note="Fix them in the file and upload again" />
          </KpiStrip>
          <Toolbar query={q} onQuery={setQ} placeholder="Search claim, patient or payer" status={filter} statuses={FILTERS} onStatus={(v) => setFilter(v as typeof filter)} count={shown.length} unit={["row", "rows"]}>
            <Button size="sm" onClick={() => setPicked(new Set(rows.filter((r) => r.status !== "Invalid").map((r) => r.index)))}>Select All Valid</Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Deselect All</Button>
            <Button size="sm" variant="primary" className={BRAND} disabled={!allowed || !picked.size} onClick={save}><Save className="size-4" aria-hidden="true" />Save Selected ({picked.size})</Button>
          </Toolbar>
          <ListCard title="Rows" note={`${file}. Invalid rows cannot be selected.`}>
            {shown.length ? (
              <Table>
                <thead><tr><Th><span className="sr-only">Select</span></Th><Th numeric>Row</Th><Th>Status</Th><Th>Claim</Th><Th>Patient</Th><Th className="hidden md:table-cell">Payer</Th><Th className="hidden lg:table-cell">Diagnosis And Service</Th><Th numeric>Claimed</Th><Th>Issues</Th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.index} className={cn(r.status === "Invalid" && "bg-destructive/[0.03]")}>
                      <Td><input type="checkbox" className="size-4 accent-[#032c26]" aria-label={`Select row ${r.index + 2}`} disabled={r.status === "Invalid"} checked={picked.has(r.index)}
                        onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.index); else n.delete(r.index); setPicked(n); }} /></Td>
                      <Td numeric className="text-muted-foreground">{r.index + 2}</Td>
                      <Td className="whitespace-nowrap"><StatusBadge status={r.status} /></Td>
                      <Td className="whitespace-nowrap font-medium tabular-nums">{r.claim.claimNumber || <span className="text-muted-foreground">Missing</span>}{r.status !== "Invalid" && <span className="block text-xs font-normal text-muted-foreground">{r.claim.state}</span>}</Td>
                      <Td className="whitespace-nowrap">{r.claim.patientName}{r.patient === "New" && <Badge tone="info" className="ml-1.5">New</Badge>}<span className="block text-xs text-muted-foreground">{r.claim.mrn || r.claim.nationalId}</span></Td>
                      <Td className="hidden whitespace-nowrap md:table-cell">{r.claim.payer}</Td>
                      <Td className="hidden lg:table-cell">{r.claim.diagnosis}<span className="block text-xs text-muted-foreground">{r.claim.serviceCode}</span></Td>
                      <Td numeric>{r.claim.claimed ? <Money value={r.claim.claimed} /> : ""}</Td>
                      <Td className="min-w-[12rem] max-w-[20rem] text-xs">
                        {r.issues.length ? (
                          <details><summary className="cursor-pointer text-destructive">{r.issues[0]}{r.issues.length > 1 ? ` (${r.issues.length - 1} more)` : ""}</summary>
                            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-destructive">{r.issues.slice(1).map((x) => <li key={x}>{x}</li>)}</ul></details>
                        ) : <span className="text-muted-foreground">{r.status === "Update" ? "Updates the saved claim" : "None"}</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <Empty>No rows match.</Empty>}
          </ListCard>
        </>
      )}

      {step === "done" && result && (
        <section className="glass-panel rounded-2xl p-6 text-center">
          <h2 className="text-lg font-semibold text-[#032c26] dark:text-foreground">Import Completed</h2>
          <p className="mt-1 text-sm text-muted-foreground">{file}</p>
          <dl className="mx-auto mt-4 grid max-w-md grid-cols-3 gap-3">
            {[["New Claims", result.created], ["Updated", result.updated], ["New Patients", result.patients]].map(([k, v]) => (
              <div key={k} className="glass-row rounded-xl px-3 py-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="text-xl font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={restart}>Import More</Button>
            <Button variant="primary" className={BRAND} onClick={() => navigate("/m/ar-management")}>Go To AR Management</Button>
          </div>
        </section>
      )}
    </div>
  );
}

/* ---------- Manual Responses ---------- */

function ManualResponses({ waiting, allowed }: { waiting: RcmClaim[]; allowed: boolean }) {
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState<string | null>(null);
  const rows = waiting.filter((c) => matches(q, c.claimNumber, c.patientName, c.mrn, c.payer));
  const current = waiting.find((c) => c.key === sel) ?? null;
  return (
    <>
      <Toolbar query={q} onQuery={setQ} placeholder="Search claim, patient, MRN or payer" count={rows.length} unit={["claim", "claims"]} />
      <SplitView label="Payer answer" open={!!current} onClose={() => setSel(null)}
        list={
          <ListCard title="Claims Waiting For The Payer's Answer" note="Claims sent from this system get their answer through NPHIES and are not listed.">
            {rows.length ? (
              <Table>
                <thead><tr><Th>Claim</Th><Th>Patient</Th><Th className="hidden sm:table-cell">Sent On</Th><Th numeric>Claimed</Th></tr></thead>
                <tbody>{rows.map((c) => (
                  <RowButton key={c.key} selected={c.key === sel} onOpen={() => setSel(c.key)} label={`${c.claimNumber}, ${c.patientName}`}>
                    <Td className="whitespace-nowrap font-medium tabular-nums">{c.claimNumber}{c.appealOf && <span className="block text-xs font-normal text-muted-foreground">Appeal of {c.appealOf}</span>}</Td>
                    <Td className="whitespace-nowrap">{c.patientName}<span className="block text-xs text-muted-foreground">{c.mrn}, {c.payer}</span></Td>
                    <Td className="hidden whitespace-nowrap sm:table-cell">{fmtDay(c.submittedOn)}</Td>
                    <Td numeric><Money value={c.claimed} /></Td>
                  </RowButton>
                ))}</tbody>
              </Table>
            ) : <Empty>No claims are waiting for an answer.</Empty>}
          </ListCard>
        }
        panel={current ? <ResponsePanel key={current.key} c={current} allowed={allowed} onSaved={() => setSel(null)} /> : <PanelEmpty>Select a claim to type in the payer's answer.</PanelEmpty>}
      />
    </>
  );
}

type Outcome = "Approved" | "Partly Approved" | "Rejected";

function ResponsePanel({ c, allowed, onSaved }: { c: RcmClaim; allowed: boolean; onSaved: () => void }) {
  const [outcome, setOutcome] = React.useState<Outcome>("Approved");
  const [date, setDate] = React.useState(dayOf(new Date()));
  const [lines, setLines] = React.useState(() => Object.fromEntries(c.lines.map((l) => [l.seq, { approved: String(l.claimed), share: "0", reason: "" }])));
  const [errs, setErrs] = React.useState<{ code: string; seq: string }[]>([{ code: "", seq: "" }]);
  const save = () => {
    const r = recordResponse(c.claimNumber, {
      outcome, date,
      lines: outcome === "Rejected" ? undefined : c.lines.map((l) => ({ seq: l.seq, approved: Number(lines[l.seq].approved) || 0, patientShare: Number(lines[l.seq].share) || 0, reason: lines[l.seq].reason || undefined })),
      errors: outcome === "Rejected" ? errs.filter((e) => e.code).map((e) => ({ code: e.code, seq: e.seq ? Number(e.seq) : undefined })) : undefined,
    });
    if (run(r, outcome === "Rejected" ? "Answer saved. The claim is in Rejection Management." : outcome === "Partly Approved" ? "Answer saved. The unpaid lines are in Denial Management." : "Answer saved. The claim is in AR Management.")) onSaved();
  };
  return (
    <Panel eyebrow={c.appealOf ? `Appeal Of ${c.appealOf}` : "Claim Waiting For Answer"} title={c.claimNumber} badge={<StatusBadge status={c.state} />} sub={<>{c.patientName}, {c.mrn}, {c.payer}</>}>
      <Section title="Claim">
        <Facts items={[["Claim Type", c.type], ["Service Date", fmtDay(c.serviceDate)], ["Sent On", fmtDay(c.submittedOn)], ["Claimed", <Money key="c" value={c.claimed} />]]} />
        <div className="mt-3"><LedgerBar claim={c} /></div>
      </Section>
      <Section title="Payer's Answer">
        {!allowed ? <NoAccess /> : (
          <div className="grid gap-3">
            <GlassPillSwitch size="sm" label="Adjudication outcome" value={outcome} options={["Approved", "Partly Approved", "Rejected"] as const} onChange={setOutcome} />
            <Field label="Response Date" required><Input type="date" max={dayOf(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            {outcome !== "Rejected" ? (
              <ul className="space-y-2">
                {c.lines.map((l) => {
                  const v = lines[l.seq];
                  const short = l.claimed - (Number(v.approved) || 0) - (Number(v.share) || 0) > 0.004;
                  return (
                    <li key={l.seq} className="glass-row rounded-xl px-3 py-2.5">
                      <p className="text-[0.8125rem] font-medium">Line {l.seq}: {l.text}</p>
                      <p className="text-xs text-muted-foreground">{l.code}, claimed <Money value={l.claimed} /></p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Field label="Approved"><Input type="number" min={0} step="0.01" value={v.approved} onChange={(e) => setLines({ ...lines, [l.seq]: { ...v, approved: e.target.value } })} /></Field>
                        <Field label="Patient Share"><Input type="number" min={0} step="0.01" value={v.share} onChange={(e) => setLines({ ...lines, [l.seq]: { ...v, share: e.target.value } })} /></Field>
                        {short && (
                          <Field label="Reason Not Paid" required className="col-span-2">
                            <Select value={v.reason} onChange={(e) => setLines({ ...lines, [l.seq]: { ...v, reason: e.target.value } })}><option value="">Choose</option>{Object.entries(DENIAL_CODES).map(([k, t]) => <option key={k} value={k}>{k} {t}</option>)}</Select>
                          </Field>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="grid gap-2">
                {errs.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
                    <Field label={`Error ${i + 1}`} required={i === 0}><Select value={e.code} onChange={(ev) => setErrs(errs.map((x, j) => (j === i ? { ...x, code: ev.target.value } : x)))}><option value="">Choose</option>{Object.entries(REJECTION_CODES).map(([k, t]) => <option key={k} value={k}>{k} {t}</option>)}</Select></Field>
                    <Field label="Line"><Select value={e.seq} onChange={(ev) => setErrs(errs.map((x, j) => (j === i ? { ...x, seq: ev.target.value } : x)))}><option value="">Claim</option>{c.lines.map((l) => <option key={l.seq} value={l.seq}>{l.seq}</option>)}</Select></Field>
                  </div>
                ))}
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setErrs([...errs, { code: "", seq: "" }])}>Add Another Error</Button>
              </div>
            )}
            <Button variant="primary" className={cn(BRAND, "justify-self-start")} onClick={save}>Save Response</Button>
          </div>
        )}
      </Section>
    </Panel>
  );
}
