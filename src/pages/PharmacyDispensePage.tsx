import * as React from "react";
import { IconChevronDown, IconPill, IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { RxBoard } from "@/components/board/RxBoard";
import { ViewToggle, useWorklistView } from "@/components/board/ViewToggle";
import { DispenseDialog } from "@/components/emr/DispenseDialog";
import { ConformancePanel, ControlBadge, ItemStatusBadge, MessageViewer } from "@/components/emr/RxShared";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { fillOf, getDrug, openItems, useRx } from "@/lib/rx";
import { isControlled } from "@/lib/rx-logic";
import { changeDispenseLine } from "@/lib/rx-send";
import type { Dispense, DispenseLine, Prescription } from "@/lib/rx-types";
import { can } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import type { RxState } from "@/lib/rx-types";

/** Pharmacist worklist: prescriptions sent by the doctors, dispense full, partial or the rest, with scan checks. */

function rxState(s: RxState, rx: Prescription): { label: string; tone: "admit" | "warn" | "ok" | "neutral" | "cancel"; open: boolean } {
  const open = openItems(s, rx).length > 0;
  const part = rx.items.some((i) => fillOf(s, rx, i).dispensedTotal > 0);
  if (open) return part ? { label: "Part Dispensed", tone: "warn", open: true } : { label: "Ready To Dispense", tone: "admit", open: true };
  if (rx.items.some((i) => i.status === "on-hold")) return { label: "On Hold", tone: "warn", open: false };
  if (rx.items.every((i) => i.status === "cancelled")) return { label: "Cancelled", tone: "neutral", open: false };
  if (rx.items.some((i) => i.status === "stopped")) return { label: "Stopped", tone: "cancel", open: false };
  return { label: "Done", tone: "ok", open: false };
}

export function PharmacyDispensePage() {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canDispense = can("rx.dispense");
  const [q, setQ] = React.useState("");
  const [view, setView] = useWorklistView("rx");
  const [filter, setFilter] = React.useState<"open" | "all">("open");
  const [dispensing, setDispensing] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [lineAction, setLineAction] = React.useState<{ mode: "cancel" | "update"; d: Dispense; line: DispenseLine } | null>(null);

  const rows = s.prescriptions
    .filter((rx) => rx.sentAt)
    .map((rx) => ({ rx, st: rxState(s, rx), patient: his.patients.find((p) => p.id === rx.patientId), enc: his.encounters.find((e) => e.visitNumber === rx.visitNumber) }))
    .filter((r) => filter === "all" || r.st.open || r.st.label === "On Hold")
    .filter((r) => !q || `${patientName(r.patient)} ${r.patient?.mrn} ${r.rx.number} ${r.rx.visitNumber}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.rx.authoredAt.localeCompare(a.rx.authoredAt));

  const dispenseRx = dispensing ? s.prescriptions.find((p) => p.id === dispensing) : undefined;
  const lastDispense = s.sends.filter((x) => x.kind === "dispense").at(-1);

  return (
    <div>
      <PageHeader
        title="Dispense Worklist"
        subtitle="Prescriptions sent by the doctors. Scan the patient wristband and the drug, then dispense in full, in part, or the rest of a part-filled item."
        right={<ViewToggle value={view} onChange={setView} />}
      />
      {view === "board" && (
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
            onDispense={setDispensing}
          />
        </>
      )}
      {view === "table" && (<>
      <Card className="mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <Field label="Patient Or Prescription"><Input placeholder="Name, MRN, prescription or visit" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Show">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")}>
              <option value="open">Waiting For Pharmacy</option>
              <option value="all">All Prescriptions</option>
            </Select>
          </Field>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-lg font-semibold text-move">Prescriptions</h2>
          <Badge tone="neutral">{rows.length} total</Badge>
        </div>
        <Table className="mt-3">
          <thead className="bg-move/8">
            <tr><Th>Patient</Th><Th>Prescription</Th><Th>Items</Th><Th>Status</Th><Th>Actions</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><Td colSpan={5}><Empty>No prescriptions are waiting. Doctors send them from the chart.</Empty></Td></tr>}
            {rows.map(({ rx, st, patient, enc }) => {
              const allergic = !!enc?.allergies.length;
              const hist = s.dispenses.filter((d) => d.rxId === rx.id);
              const isOpen = expanded === rx.id;
              return (
                <React.Fragment key={rx.id}>
                  <tr className="hover:bg-muted/40">
                    <Td>
                      <div className="flex items-center gap-3">
                        <span
                          className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", allergic ? "bg-destructive/12 text-destructive" : "bg-ok/12 text-ok")}
                          title={allergic ? `Allergies: ${enc?.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"}
                        >
                          {allergic ? <IconShieldExclamation className="size-[18px]" stroke={1.75} /> : <IconShieldCheck className="size-[18px]" stroke={1.75} />}
                        </span>
                        <div>
                          <div className="font-semibold text-move">{patientName(patient)}</div>
                          <div className="text-xs text-muted-foreground">{patient?.mrn}{dev && <span className="ml-2 font-mono">{rx.visitNumber}</span>}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium">{rx.number}</div>
                      <div className="text-xs text-muted-foreground">{new Date(rx.authoredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                      {rx.raqeebRef && <Badge tone="merge" className="mt-1">Raqeeb {rx.raqeebRef}</Badge>}
                      {dev && <div className="mt-0.5 font-mono text-xs text-update">groupIdentifier {rx.groupId}</div>}
                    </Td>
                    <Td>
                      <ul className="space-y-0.5 text-xs">
                        {rx.items.map((i) => {
                          const d = getDrug(i.drugId);
                          const f = fillOf(s, rx, i);
                          return (
                            <li key={i.id} className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{d.generic} {d.strengthValue} {d.strengthUnit}</span>
                              <span className="text-muted-foreground">{f.dispensedTotal} of {i.quantity} {d.unit}</span>
                              <ItemStatusBadge status={i.status} />
                              <ControlBadge cls={d.controlClass} />
                            </li>
                          );
                        })}
                      </ul>
                    </Td>
                    <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span title={!canDispense ? "You do not have permission to dispense" : !st.open ? "Nothing left to dispense" : undefined}>
                          <Button size="sm" variant="primary" disabled={!canDispense || !st.open} onClick={() => setDispensing(rx.id)}>
                            <IconPill className="size-4" />Dispense
                          </Button>
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setExpanded(isOpen ? null : rx.id)} aria-expanded={isOpen}>
                          <IconChevronDown className={cn("size-4 transition-transform", !isOpen && "-rotate-90")} />History
                        </Button>
                      </div>
                    </Td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <Td colSpan={5} className="bg-muted/30">
                        {hist.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Nothing dispensed yet.</p>
                        ) : (
                          <ul className="space-y-2 text-xs">
                            {hist.map((d) => (
                              <li key={d.id} className="rounded-md border border-border bg-card p-2">
                                <div className="mb-1 flex flex-wrap items-center gap-2">
                                  <b>{d.number}</b>
                                  <span className="text-muted-foreground">{new Date(d.handedOverAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} by {d.dispenser}</span>
                                  <Badge tone={d.verification.skippedReason ? "warn" : "ok"}>{d.verification.skippedReason ? `Scan skipped: ${d.verification.skippedReason}` : "Scans Matched"}</Badge>
                                </div>
                                {d.lines.map((l) => {
                                  const drug = getDrug(l.drugId);
                                  const ctrl = isControlled(drug.controlClass);
                                  return (
                                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
                                      <span>
                                        {drug.brand} ({drug.generic}), {l.quantity} {drug.unit}
                                        {l.lot && `, lot ${l.lot}`} <Badge tone={l.status === "cancelled" ? "neutral" : "ok"}>{l.status === "cancelled" ? "Cancelled" : "Completed"}</Badge>
                                        {dev && <span className="ml-1.5 font-mono text-update">{l.type} {l.identifier} v{l.version}</span>}
                                      </span>
                                      {l.status === "completed" && (
                                        <span className="flex gap-1.5">
                                          <span title={!canDispense ? "You do not have permission to dispense" : !ctrl ? "Update is offered for narcotic, controlled and restricted items" : undefined}>
                                            <Button size="sm" disabled={!canDispense || !ctrl} onClick={() => setLineAction({ mode: "update", d, line: l })}>Update Dispense</Button>
                                          </span>
                                          <span title={!canDispense ? "You do not have permission to dispense" : !ctrl ? "Cancel is offered for narcotic, controlled and restricted items" : undefined}>
                                            <Button size="sm" variant="danger" disabled={!canDispense || !ctrl} onClick={() => setLineAction({ mode: "cancel", d, line: l })}>Cancel Dispense</Button>
                                          </span>
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
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
      </Card>

      </>)}
      {dev && lastDispense && (
        <div className="mt-4">
          <MessageViewer title={lastDispense.targetId} bundle={lastDispense.bundle} checks={lastDispense.checks} record={lastDispense} history={s.sends.filter((x) => x.kind === "dispense")} />
        </div>
      )}
      <ConformancePanel />

      {dispenseRx && <DispenseDialog key={dispenseRx.id} rx={dispenseRx} onClose={() => setDispensing(null)} />}
      {lineAction && <LineDialog action={lineAction} onClose={() => setLineAction(null)} />}
    </div>
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
        {mode === "cancel" ? (
          <p>The patient did not collect the medicine. The quantity goes back to the prescription and nphies is told the dispense is cancelled.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={`Quantity (${drug.unit})`}><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Lot"><Input value={lot} onChange={(e) => setLot(e.target.value)} /></Field>
            <Field label="Expiry"><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></Field>
          </div>
        )}
        {problems.map((p) => <div key={p} role="alert" className="text-xs text-destructive">{p}</div>)}
      </div>
    </Dialog>
  );
}
