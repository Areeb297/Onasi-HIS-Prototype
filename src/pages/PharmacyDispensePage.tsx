import * as React from "react";
import { IconChevronDown, IconClipboardCheck, IconPill, IconPills, IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { ageSex } from "@/components/board/board-util";
import { RxBoard } from "@/components/board/RxBoard";
import { ViewToggle, useWorklistView } from "@/components/board/ViewToggle";
import { DispenseDialog, type DispenseQueue } from "@/components/emr/DispenseDialog";
import { ConformancePanel, ControlBadge, ItemStatusBadge, MessageViewer, RxPatientStrip, VerifyBadge, VerifyTrail, fmtWhen } from "@/components/emr/RxShared";
import { VerifyDialog } from "@/components/emr/VerifyDialog";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Encounter, Patient } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { fillOf, getDrug, useRx } from "@/lib/rx";
import type { FillState } from "@/lib/rx-logic";
import { changeDispenseLine } from "@/lib/rx-send";
import { batchesFor, fmtExpiry } from "@/lib/rx-stock";
import type { Dispense, DispenseLine, Drug, Prescription, RxItem } from "@/lib/rx-types";
import { needsPharmacist, needsPrescriber, orderLine, verifyStatusOf, type VerifyStatus } from "@/lib/rx-verify";
import { STATUS_FILTERS, TABS, canChangeLine, dispensedRows, readyPrescriptions, readySummary, statusMatches, tabMatches, type DispensedFilter, type StatusFilter, type WorklistTab } from "@/lib/rx-worklist";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * Pharmacist worklist. Every prescription item sent by a doctor arrives as To Verify. The pharmacist opens the check sheet,
 * then dispenses in full, in part, or the rest of a part-filled item, with scan checks.
 */

type Grouping = "patient" | "item";
type Target = { rxId: string; itemId: string };

interface Row {
  key: string;
  rx: Prescription;
  item: RxItem;
  drug: Drug;
  fill: FillState;
  /** Where the item stands with the pharmacist. Only meaningful while the item is open. */
  verify: VerifyStatus;
  /** Active and not fully handed over. */
  open: boolean;
  patient?: Patient;
  enc?: Encounter;
}

/** One word status for an item on the worklist. */
function ItemStage({ r }: { r: Row }) {
  if (r.item.status !== "active" && r.item.status !== "completed") return <ItemStatusBadge status={r.item.status} />;
  if (!r.open) return <Badge tone="ok">Dispensed</Badge>;
  if (r.verify !== "verified") return <VerifyBadge status={r.verify} />;
  return r.fill.dispensedTotal > 0 ? <Badge tone="warn">Part Dispensed</Badge> : <Badge tone="admit">Ready To Dispense</Badge>;
}

export function PharmacyDispensePage() {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const [q, setQ] = React.useState("");
  const [view, setView] = useWorklistView("rx");
  const [tab, setTab] = React.useState<WorklistTab>("waiting");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [section, setSection] = React.useState<"worklist" | "dispensed">("worklist");
  const [run, setRun] = React.useState<{ ids: string[]; i: number; scan: string } | null>(null);
  const [grouping, setGrouping] = React.useState<Grouping>("patient");
  const [dispensing, setDispensing] = React.useState<{ rxId: string; itemId?: string } | null>(null);
  const [verifying, setVerifying] = React.useState<Target | null>(null);
  const [openPatient, setOpenPatient] = React.useState<string | null>(null);
  const [lineAction, setLineAction] = React.useState<{ mode: "cancel" | "update"; d: Dispense; line: DispenseLine } | null>(null);

  const allRows: Row[] = s.prescriptions
    .filter((rx) => rx.sentAt)
    .sort((a, b) => (a.sentAt ?? a.authoredAt).localeCompare(b.sentAt ?? b.authoredAt))
    .flatMap((rx) => {
      const patient = his.patients.find((p) => p.id === rx.patientId);
      const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
      return rx.items.map((item): Row => {
        const fill = fillOf(s, rx, item);
        return { key: `${rx.id}:${item.id}`, rx, item, drug: getDrug(item.drugId), fill, verify: verifyStatusOf(item, fill.dispensedTotal), open: item.status === "active" && !fill.done, patient, enc };
      });
    })
    .filter((r) => statusMatches(statusFilter, r.item.status))
    .filter((r) => !q || `${patientName(r.patient)} ${r.patient?.mrn} ${r.rx.number} ${r.rx.visitNumber} ${r.drug.generic}`.toLowerCase().includes(q.toLowerCase()));
  const tabCount = (t: WorklistTab) => allRows.filter((r) => tabMatches(t, { open: r.open, verify: r.verify, itemStatus: r.item.status })).length;
  const rows = allRows.filter((r) => tabMatches(tab, { open: r.open, verify: r.verify, itemStatus: r.item.status }));

  const byPatient = new Map<string, Row[]>();
  for (const r of rows) byPatient.set(r.rx.patientId, [...(byPatient.get(r.rx.patientId) ?? []), r]);

  const dispenseRx = dispensing ? s.prescriptions.find((p) => p.id === dispensing.rxId) : undefined;
  const verifyRx = verifying ? s.prescriptions.find((p) => p.id === verifying.rxId) : undefined;
  const lastDispense = s.sends.filter((x) => x.kind === "dispense").at(-1);
  const toVerify = rows.filter((r) => r.open && needsPharmacist(r.verify)).length;
  const dispensedCount = dispensedRows(s).length;
  const runRx = run ? s.prescriptions.find((p) => p.id === run.ids[run.i]) : undefined;
  const queue: DispenseQueue | undefined = run && runRx
    ? {
        n: run.i + 1,
        total: run.ids.length,
        patientScan: run.scan,
        onScan: (v) => setRun((r) => (r ? { ...r, scan: v } : r)),
        onDone: () => setRun((r) => (r && r.i + 1 < r.ids.length ? { ...r, i: r.i + 1 } : null)),
        onSkip: () => setRun((r) => (r && r.i + 1 < r.ids.length ? { ...r, i: r.i + 1 } : null)),
      }
    : undefined;
  const startRun = (patientId: string) => {
    const ids = readyPrescriptions(s, patientId).map((rx) => rx.id);
    if (ids.length) setRun({ ids, i: 0, scan: "" });
  };
  const tableProps = { onVerify: setVerifying, onDispense: (t: Target) => setDispensing(t), onLine: setLineAction };
  const openRx = (number: string) => {
    setSection("worklist");
    setTab("all");
    setStatusFilter("all");
    setQ(number);
  };

  return (
    <div>
      <PageHeader
        title="Dispense Worklist"
        subtitle="Items sent by the doctors. Check and verify each item first. Then scan the patient wristband and the drug, and dispense in full or in part."
        right={section === "worklist" ? <ViewToggle value={view} onChange={setView} /> : undefined}
      />
      <div role="radiogroup" aria-label="Pharmacy section" className="mb-4 inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
        {([["worklist", "Dispense Worklist"], ["dispensed", `Dispensed (${dispensedCount})`]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={section === id}
            onClick={() => setSection(id)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring", section === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
          </button>
        ))}
      </div>
      {section === "dispensed" && <DispensedSection onLine={setLineAction} onOpenRx={openRx} />}
      {section === "worklist" && view === "board" && (
        <>
          <Card className="mb-4 px-4 py-3">
            <Field label="Patient Or Prescription" className="w-full sm:w-80">
              <Input placeholder="Name, MRN, prescription or visit" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
          </Card>
          <RxBoard
            state={s}
            prescriptions={s.prescriptions.filter((rx) => {
              if (!q) return true;
              const p = his.patients.find((x) => x.id === rx.patientId);
              return `${patientName(p)} ${p?.mrn} ${rx.number} ${rx.visitNumber}`.toLowerCase().includes(q.toLowerCase());
            })}
            onDispense={(rxId) => setDispensing({ rxId })}
            onVerify={(rxId, itemId) => setVerifying({ rxId, itemId })}
          />
        </>
      )}
      {section === "worklist" && view === "table" && (
        <>
          <Card className="mb-4 px-4 py-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Worklist tab">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", tab === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}
                >
                  {t.label} <span className="opacity-70">{tabCount(t.id)}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px]">
              <Field label="Patient, Prescription Or Drug"><Input placeholder="Name, MRN, prescription, visit or drug" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
              <Field label="Item Status">
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
                  {STATUS_FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-move">Prescriptions</h2>
                <Badge tone={toVerify ? "update" : "neutral"}>{toVerify} To Verify</Badge>
                <Badge tone="neutral">{byPatient.size} {byPatient.size === 1 ? "patient" : "patients"}, {rows.length} {rows.length === 1 ? "item" : "items"}</Badge>
              </div>
              <GroupToggle value={grouping} onChange={setGrouping} />
            </div>

            {grouping === "item" ? (
              <ItemTable rows={rows} showPatient {...tableProps} className="mt-3" />
            ) : (
              <Table className="mt-3">
                <thead className="bg-move/8">
                  <tr><Th>Patient</Th><Th>Items</Th><Th>What Is Waiting</Th><Th>Oldest Item Sent</Th><Th>Actions</Th></tr>
                </thead>
                <tbody>
                  {byPatient.size === 0 && <tr><Td colSpan={5}><Empty>No items are waiting. Doctors send prescriptions from the chart.</Empty></Td></tr>}
                  {[...byPatient.entries()].map(([pid, list]) => {
                    const { patient, enc } = list[0];
                    const allergic = !!enc?.allergies.length;
                    const isOpen = openPatient === pid;
                    const openRows = list.filter((r) => r.open);
                    const nVerify = openRows.filter((r) => needsPharmacist(r.verify)).length;
                    const nPrescriber = openRows.filter((r) => needsPrescriber(r.verify)).length;
                    const nReady = openRows.filter((r) => r.verify === "verified" && r.fill.dispensedTotal === 0).length;
                    const nPart = openRows.filter((r) => r.verify === "verified" && r.fill.dispensedTotal > 0).length;
                    const nHold = list.filter((r) => r.item.status === "on-hold").length;
                    const ready = readySummary(s, pid);
                    const oldest = list.map((r) => r.rx.sentAt ?? r.rx.authoredAt).sort()[0];
                    return (
                      <React.Fragment key={pid}>
                        <tr className="hover:bg-muted/40">
                          <Td>
                            <div className="flex items-center gap-3">
                              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", allergic ? "bg-destructive/12 text-destructive" : "bg-ok/12 text-ok")} aria-hidden="true">
                                {allergic ? <IconShieldExclamation className="size-[18px]" stroke={1.75} /> : <IconShieldCheck className="size-[18px]" stroke={1.75} />}
                              </span>
                              <div>
                                <div className="font-semibold text-move">{patientName(patient)}</div>
                                <div className="text-xs text-muted-foreground">{patient?.mrn}{patient && ` · ${ageSex(patient)}`}</div>
                                <div className={cn("text-xs", allergic ? "font-medium text-destructive" : "text-muted-foreground")}>
                                  {allergic ? `Allergies: ${enc?.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"}
                                </div>
                              </div>
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap font-medium tabular-nums">{list.length} {list.length === 1 ? "item" : "items"}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1.5">
                              {nVerify > 0 && <Badge tone="update">{nVerify} To Verify</Badge>}
                              {nPrescriber > 0 && <Badge tone="warn">{nPrescriber} With Prescriber</Badge>}
                              {nReady > 0 && <Badge tone="admit">{nReady} Ready To Dispense</Badge>}
                              {nPart > 0 && <Badge tone="warn">{nPart} Part Dispensed</Badge>}
                              {nHold > 0 && <Badge tone="neutral">{nHold} On Hold</Badge>}
                              {nVerify + nPrescriber + nReady + nPart + nHold === 0 && <Badge tone="ok">Nothing Waiting</Badge>}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap text-xs text-muted-foreground">{oldest ? fmtWhen(oldest) : ""}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1.5">
                              <Button size="sm" variant={isOpen ? "secondary" : "primary"} onClick={() => setOpenPatient(isOpen ? null : pid)} aria-expanded={isOpen}>
                                <IconChevronDown className={cn("size-4 transition-transform", !isOpen && "-rotate-90")} />
                                {isOpen ? "Hide Items" : "Show Items"}
                              </Button>
                              {ready.items > 1 && (
                                <span title={!can("rx.dispense") ? "You do not have permission to dispense" : `Dispense ${ready.items} verified items on ${ready.prescriptions} ${ready.prescriptions === 1 ? "prescription" : "prescriptions"}, one prescription after the other`}>
                                  <Button size="sm" disabled={!can("rx.dispense")} onClick={() => startRun(pid)}>
                                    <IconPills className="size-4" />Multi-Drug Dispense ({ready.items})
                                  </Button>
                                </span>
                              )}
                            </div>
                          </Td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <Td colSpan={5} className="bg-muted/30">
                              <ItemTable rows={list} showPatient={false} {...tableProps} className="rounded-md border border-border bg-card" />
                            </Td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}
      {dev && lastDispense && (
        <div className="mt-4">
          <MessageViewer title={lastDispense.targetId} bundle={lastDispense.bundle} checks={lastDispense.checks} record={lastDispense} history={s.sends.filter((x) => x.kind === "dispense")} />
        </div>
      )}
      <ConformancePanel />

      {dispenseRx && <DispenseDialog key={`${dispenseRx.id}:${dispensing?.itemId ?? ""}`} rx={dispenseRx} focusItemId={dispensing?.itemId} onClose={() => setDispensing(null)} />}
      {run && runRx && queue && <DispenseDialog key={`run:${runRx.id}`} rx={runRx} queue={queue} onClose={() => setRun(null)} />}
      {verifyRx && verifying && <VerifyDialog key={`${verifyRx.id}:${verifying.itemId}`} rx={verifyRx} itemId={verifying.itemId} onClose={() => setVerifying(null)} />}
      {lineAction && <LineDialog action={lineAction} onClose={() => setLineAction(null)} />}
    </div>
  );
}

/** By Patient or By Item. */
function GroupToggle({ value, onChange }: { value: Grouping; onChange: (v: Grouping) => void }) {
  const opts: { id: Grouping; label: string }[] = [{ id: "patient", label: "By Patient" }, { id: "item", label: "By Item" }];
  return (
    <div role="radiogroup" aria-label="Group the worklist" className="inline-flex rounded-lg border border-border bg-muted/60 p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
            value === o.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- one row per prescription item ---------- */

function ItemTable({
  rows, showPatient, onVerify, onDispense, onLine, className,
}: {
  rows: Row[];
  showPatient: boolean;
  onVerify: (t: Target) => void;
  onDispense: (t: Target) => void;
  onLine: (a: { mode: "cancel" | "update"; d: Dispense; line: DispenseLine }) => void;
  className?: string;
}) {
  const s = useRx();
  const dev = useDevMode();
  const canDispense = can("rx.dispense");
  const [history, setHistory] = React.useState<string | null>(null);
  const cols = showPatient ? 6 : 5;
  return (
    <Table className={className}>
      <thead className="bg-move/8">
        <tr>{showPatient && <Th>Patient</Th>}<Th>Drug</Th><Th>Order</Th><Th>Pharmacist Check</Th><Th>Supply</Th><Th>Actions</Th></tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><Td colSpan={cols}><Empty>No items are waiting. Doctors send prescriptions from the chart.</Empty></Td></tr>}
        {rows.map((r) => {
          const { rx, item, drug, fill } = r;
          const o = orderLine(drug, item);
          const doctor = DOCTORS.find((d) => d.id === rx.prescriberId);
          const allergic = !!r.enc?.allergies.length;
          const hist = s.dispenses.filter((d) => d.rxId === rx.id && d.lines.some((l) => l.itemId === item.id));
          const isOpen = history === r.key;
          const canCheck = r.open && r.verify !== "verified";
          const canGive = r.open && r.verify === "verified";
          return (
            <React.Fragment key={r.key}>
              <tr className="hover:bg-muted/40">
                {showPatient && (
                  <Td>
                    <div className="font-semibold text-move">{patientName(r.patient)}</div>
                    <div className="text-xs text-muted-foreground">{r.patient?.mrn}{r.patient && ` · ${ageSex(r.patient)}`}</div>
                    <div className={cn("text-xs", allergic ? "font-medium text-destructive" : "text-muted-foreground")}>
                      {allergic ? `Allergies: ${r.enc?.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"}
                    </div>
                  </Td>
                )}
                <Td>
                  <div className="font-medium">{drug.generic} {drug.strengthValue} {drug.strengthUnit}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {rx.number}
                    <ControlBadge cls={drug.controlClass} />
                    {rx.raqeebRef && <Badge tone="merge">Raqeeb {rx.raqeebRef}</Badge>}
                    {item.allergyOverride && <Badge tone="danger">Allergy Override</Badge>}
                  </div>
                  {dev && <div className="mt-0.5 font-mono text-xs text-update">{item.identifier} v{item.version} · groupIdentifier {rx.groupId}</div>}
                </Td>
                <Td className="text-xs">
                  <div>{o.dose}, {o.route.toLowerCase()}</div>
                  <div>{o.frequency}, {o.duration}</div>
                  <div className="text-muted-foreground">{doctor ? `Dr. ${doctor.given} ${doctor.family}` : rx.prescriberId} · sent {fmtWhen(rx.sentAt ?? rx.authoredAt)}</div>
                </Td>
                <Td className="max-w-[260px]">
                  <ItemStage r={r} />
                  <div className="mt-1"><VerifyTrail item={item} status={r.verify} /></div>
                </Td>
                <Td className="whitespace-nowrap text-xs tabular-nums">
                  <div className="font-medium">Remaining {fill.remaining} of {item.quantity} {drug.unit}</div>
                  {fill.totalFills > 1 && <div className="text-muted-foreground">Fill {Math.min(fill.completedFills + 1, fill.totalFills)} of {fill.totalFills}</div>}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {canCheck && (
                      <Button size="sm" variant={needsPharmacist(r.verify) ? "primary" : "secondary"} onClick={() => onVerify({ rxId: rx.id, itemId: item.id })}>
                        <IconClipboardCheck className="size-4" />{needsPharmacist(r.verify) ? "Check And Verify" : "Open Check Sheet"}
                      </Button>
                    )}
                    {canGive && (
                      <span title={!canDispense ? "You do not have permission to dispense" : undefined}>
                        <Button size="sm" variant="primary" disabled={!canDispense} onClick={() => onDispense({ rxId: rx.id, itemId: item.id })}>
                          <IconPill className="size-4" />{fill.dispensedTotal > 0 ? "Dispense The Rest" : "Dispense"}
                        </Button>
                      </span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setHistory(isOpen ? null : r.key)} aria-expanded={isOpen}>
                      <IconChevronDown className={cn("size-4 transition-transform", !isOpen && "-rotate-90")} />History
                    </Button>
                  </div>
                </Td>
              </tr>
              {isOpen && (
                <tr>
                  <Td colSpan={cols} className="bg-muted/30">
                    {hist.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing dispensed yet.</p>
                    ) : (
                      <ul className="space-y-2 text-xs">
                        {hist.map((d) => (
                          <li key={d.id} className="rounded-md border border-border bg-card p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <b>{d.number}</b>
                              <span className="text-muted-foreground">{fmtWhen(d.handedOverAt)} by {d.dispenser}</span>
                              <Badge tone={d.verification.skippedReason ? "warn" : "ok"}>{d.verification.skippedReason ? `Scan skipped: ${d.verification.skippedReason}` : "Scans Matched"}</Badge>
                              {d.witness && <span className="text-muted-foreground">Witness {d.witness.name} ({d.witness.staffNo})</span>}
                            </div>
                            {d.lines.filter((l) => l.itemId === item.id).map((l) => (
                              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                                <span>
                                  {drug.brand} ({drug.generic}), {l.quantity} {drug.unit}
                                  {l.lot && `, batch ${l.lot}`}{l.expiry && `, expires ${fmtExpiry(l.expiry)}`} <Badge tone={l.status === "cancelled" ? "neutral" : "ok"}>{l.status === "cancelled" ? "Cancelled" : "Completed"}</Badge>
                                  {dev && <span className="ml-1.5 font-mono text-update">{l.type} {l.identifier} v{l.version}</span>}
                                </span>
                                {l.status === "completed" && (
                                  <span className="flex gap-1.5">
                                    <span title={!canDispense ? "You do not have permission to dispense" : canChangeLine(drug, l).reason || undefined}>
                                      <Button size="sm" disabled={!canDispense || !canChangeLine(drug, l).ok} onClick={() => onLine({ mode: "update", d, line: l })}>Update Dispense</Button>
                                    </span>
                                    <span title={!canDispense ? "You do not have permission to dispense" : canChangeLine(drug, l).reason || undefined}>
                                      <Button size="sm" variant="danger" disabled={!canDispense || !canChangeLine(drug, l).ok} onClick={() => onLine({ mode: "cancel", d, line: l })}>Cancel Dispense</Button>
                                    </span>
                                  </span>
                                )}
                              </div>
                            ))}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

function LineDialog({ action, onClose }: { action: { mode: "cancel" | "update"; d: Dispense; line: DispenseLine }; onClose: () => void }) {
  const { mode, d, line } = action;
  const drug = getDrug(line.drugId);
  const [qty, setQty] = React.useState(String(line.quantity));
  const [lot, setLot] = React.useState(line.lot ?? "");
  const [expiry, setExpiry] = React.useState(line.expiry ?? "");
  const [problems, setProblems] = React.useState<string[]>([]);

  function go() {
    const res = changeDispenseLine(d.id, line.id, mode, mode === "update" ? { quantity: parseFloat(qty), lot: lot || undefined, expiry: expiry || undefined } : {});
    if (!res.outcome) return setProblems(res.problems);
    if (res.outcome.ok) {
      pushToast({ tone: "ok", text: mode === "cancel" ? "Dispense cancelled and sent to nphies" : "Dispense updated and sent to nphies" });
      onClose();
    } else {
      pushToast({ tone: "danger", text: "nphies rejected the change", detail: res.outcome.record.checks.find((c) => c.level === "error")?.text });
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "cancel" ? "Cancel Dispense" : "Update Dispense"}
      subtitle={`${d.number}, ${drug.generic}`}
      footer={
        <>
          <Button onClick={onClose}>Keep As Is</Button>
          <Button variant="primary" onClick={go}>{mode === "cancel" ? "Cancel And Send To NPHIES" : "Save And Send To NPHIES"}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <RxPatientStrip rx={d} />
        {mode === "cancel" ? (
          <div className="space-y-1.5">
            <p>The patient did not collect the medicine. The quantity goes back to the prescription and nphies is told the dispense is cancelled.</p>
            <p className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-xs">
              Stock goes back: {line.quantity} {drug.unit}{line.lot ? ` return to batch ${line.lot}` : " return to stock"}.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Quantity (${drug.unit})`} required><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Batch"><Input value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
            <Field label="Expiry Date"><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          </div>
        )}
        {problems.map((p) => <div key={p} role="alert" className="text-xs text-destructive">{p}</div>)}
      </div>
    </Dialog>
  );
}

/* ---------- what was dispensed, with cancel ---------- */

const DISPENSED_TABS: { id: DispensedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

/** Every dispense that was handed out, with Update and Cancel where the rules allow. A cancelled line returns its quantity to the batch it came from. */
function DispensedSection({ onLine, onOpenRx }: { onLine: (a: { mode: "cancel" | "update"; d: Dispense; line: DispenseLine }) => void; onOpenRx: (number: string) => void }) {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canDispense = can("rx.dispense");
  const [f, setF] = React.useState<DispensedFilter>("all");
  const [q, setQ] = React.useState("");
  const rows = dispensedRows(s, f).filter((r) => {
    if (!q.trim()) return true;
    const p = his.patients.find((x) => x.id === r.dispense.patientId);
    return `${patientName(p)} ${p?.mrn} ${r.rx?.number} ${r.dispense.number} ${r.drug.generic} ${r.drug.brand} ${r.line.lot ?? ""}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const count = (id: DispensedFilter) => dispensedRows(s, id).length;
  return (
    <Card>
      <div className="space-y-3 px-4 pt-4">
        <div>
          <h2 className="text-lg font-semibold text-move">Dispensed Medications</h2>
          <p className="text-sm text-muted-foreground">Everything handed to patients. Cancel a dispense to take it back: the quantity returns to the prescription and to the batch it came from, and NPHIES is told.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Dispensed filter">
            {DISPENSED_TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={f === t.id} onClick={() => setF(t.id)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", f === t.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                {t.label} <span className="opacity-70">{count(t.id)}</span>
              </button>
            ))}
          </div>
          <Field label="Patient, Drug, Prescription Or Batch" className="ml-auto w-full sm:w-72"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, MRN, drug, dispense number or batch" /></Field>
        </div>
      </div>
      <Table className="mt-3">
        <thead className="bg-move/8">
          <tr><Th>Medication</Th><Th>Patient</Th><Th>Quantity And Batch</Th><Th>Status</Th><Th>Dispensed</Th><Th>Actions</Th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={6}><Empty>{dispensedCount(s) === 0 ? "Nothing has been dispensed yet." : "No dispense matches."}</Empty></Td></tr>}
          {rows.map((r) => {
            const p = his.patients.find((x) => x.id === r.dispense.patientId);
            const cancelled = r.line.status === "cancelled";
            const batch = r.line.lot ? batchesFor(r.drug, s.dispenses).find((b) => b.lot === r.line.lot) : undefined;
            return (
              <tr key={r.key} className="hover:bg-muted/40">
                <Td>
                  <div className="font-medium">{r.drug.brand} ({r.drug.generic}) {r.drug.strengthValue} {r.drug.strengthUnit}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {r.rx?.number} · {r.dispense.number}
                    <ControlBadge cls={r.drug.controlClass} />
                  </div>
                  {dev && <div className="font-mono text-xs text-update">{r.line.type} {r.line.identifier} v{r.line.version}</div>}
                </Td>
                <Td>
                  <div className="font-semibold text-move">{patientName(p)}</div>
                  <div className="text-xs text-muted-foreground">{p?.mrn}{dev && ` · Visit ${r.dispense.visitNumber}`}</div>
                </Td>
                <Td className="text-xs tabular-nums">
                  <div className="font-medium">{r.line.quantity} {r.drug.unit}</div>
                  <div className="text-muted-foreground">Batch {r.line.lot ?? "not recorded"}{r.line.expiry && `, expires ${fmtExpiry(r.line.expiry)}`}</div>
                  {cancelled && <div className="text-ok">{r.line.lot ? `Returned to batch${batch ? `, ${batch.onHand} ${r.drug.unit} on hand now` : ""}` : "Returned to stock"}</div>}
                </Td>
                <Td><Badge tone={cancelled ? "neutral" : "ok"}>{cancelled ? "Cancelled" : "Completed"}</Badge></Td>
                <Td className="text-xs text-muted-foreground"><div>{fmtWhen(r.dispense.handedOverAt)}</div><div>by {r.dispense.dispenser}</div></Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    {r.rx && <Button size="sm" variant="secondary" onClick={() => onOpenRx(r.rx!.number)}>Open Prescription</Button>}
                    {!cancelled && (
                      <>
                        <span title={!canDispense ? "You do not have permission to dispense" : r.change.reason || undefined}>
                          <Button size="sm" disabled={!canDispense || !r.change.ok} onClick={() => onLine({ mode: "update", d: r.dispense, line: r.line })}>Update</Button>
                        </span>
                        <span title={!canDispense ? "You do not have permission to dispense" : r.change.reason || undefined}>
                          <Button size="sm" variant="danger" disabled={!canDispense || !r.change.ok} onClick={() => onLine({ mode: "cancel", d: r.dispense, line: r.line })}>Cancel Dispense</Button>
                        </span>
                      </>
                    )}
                  </div>
                  {!cancelled && !r.change.ok && <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">{r.change.reason}</div>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

const dispensedCount = (s: ReturnType<typeof useRx>): number => dispensedRows(s).length;
