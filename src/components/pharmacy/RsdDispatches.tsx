import * as React from "react";
import { IconCheck, IconTruckDelivery, IconX } from "@tabler/icons-react";
import { PackScanner, PackStatusBadge, drugName } from "@/components/pharmacy/RsdParts";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Table, Td, Th } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime, fmtRelative, fmtTime } from "@/lib/format";
import { MODE_LABEL, MODE_TONE, ownCalls, useCallLog } from "@/lib/integrations/call-log";
import type { Gs1 } from "@/lib/integrations/rsd-gs1";
import {
  PHARMACY_GLN, STATUS_LABEL, acceptDispatch, acceptPack, countsByStatus, packsList, packsOfDispatch, pendingDispatches, rejectDispatch, rsdActive, rsdMode, useRsd,
  type Dispatch, type PackStatus,
} from "@/lib/integrations/rsd-packs";
import { DRUG_BY_ID } from "@/lib/rx-catalogue";
import { pushToast } from "@/lib/toast";

/**
 * SFDA RSD at goods receipt. A supplier's dispatch notification waits here until the pharmacy accepts it: until then the packs
 * cannot be dispensed. Accept the whole dispatch, scan a single pack, or reject it with a reason. Simulated.
 */

/** What goes into the receipt form when a dispatch is accepted: one line per drug and batch. */
export interface ReceiptLineFromDispatch { drugId: string; lot: string; expiry: string; quantity: number }

export function linesOfDispatch(d: Dispatch): ReceiptLineFromDispatch[] {
  const out = new Map<string, ReceiptLineFromDispatch>();
  for (const p of packsOfDispatch(d)) {
    const drug = DRUG_BY_ID[p.drugId];
    if (!drug) continue;
    const k = `${p.drugId}|${p.batch}`;
    const cur = out.get(k) ?? { drugId: p.drugId, lot: p.batch, expiry: p.expiry, quantity: 0 };
    cur.quantity += drug.pack.size;
    out.set(k, cur);
  }
  return [...out.values()];
}

const ORDER: PackStatus[] = ["received", "accepted", "dispensed", "cancelled"];

export function RsdDispatches({ allowed, onAccepted }: { allowed: boolean; onAccepted?: (d: Dispatch) => void }) {
  const state = useRsd();
  useCallLog();
  const active = rsdActive();
  const pending = pendingDispatches(state);
  const counts = countsByStatus(state);
  const [rejecting, setRejecting] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const calls = ownCalls("rsd").slice(-5).reverse();
  const sample = packsList(state).find((p) => p.status === "received");

  const accept = (d: Dispatch) => {
    const r = acceptDispatch(d.id);
    if (!r.ok) { pushToast({ tone: "warn", text: r.message }); return; }
    pushToast({ tone: "ok", text: `${d.id} accepted`, detail: r.message });
    onAccepted?.(d);
  };
  const reject = (d: Dispatch) => {
    const r = rejectDispatch(d.id, reason);
    if (!r.ok) { pushToast({ tone: "warn", text: r.message }); return; }
    pushToast({ tone: "ok", text: `${d.id} rejected`, detail: r.message });
    setRejecting(null);
    setReason("");
  };
  const scan = (g: Gs1) => {
    const r = acceptPack(g);
    setMsg({ ok: r.ok, text: r.message });
  };

  return (
    <Card>
      <CardHeader
        title="SFDA RSD Dispatches"
        subtitle={`Medicine sent to this pharmacy (GLN ${PHARMACY_GLN}). Accept a dispatch before its packs can be dispensed.`}
        right={<div className="flex items-center gap-2"><Badge tone={MODE_TONE[rsdMode()]}>RSD {MODE_LABEL[rsdMode()]}</Badge>{active && <Badge tone={pending.length ? "warn" : "ok"}>{pending.length} Waiting</Badge>}</div>}
      />
      {!active ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">RSD is switched off. Packs are not checked and nothing is reported. The System Administrator can connect it on the Integrations page.</p>
      ) : (
        <div className="space-y-4 p-4">
          {pending.length === 0 && <Empty>No dispatch is waiting.</Empty>}
          <ul className="space-y-3">
            {pending.map((d) => {
              const lines = linesOfDispatch(d);
              const total = d.packKeys.length;
              return (
                <li key={d.id} className="glass-card rounded-xl p-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <IconTruckDelivery className="size-4 text-[#035D53] dark:text-[#52FCE3]" aria-hidden="true" />
                        <span className="font-mono text-xs font-semibold">{d.id}</span>
                        <Badge tone="warn">Waiting For Your Accept</Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium">{d.supplier}</p>
                      <p className="text-xs text-muted-foreground">GLN {d.supplierGln} · Order {d.poRef} · Sent {fmtRelative(d.sentAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="primary" size="sm" disabled={!allowed} onClick={() => accept(d)}><IconCheck className="size-4" />Accept Dispatch</Button>
                      <Button size="sm" disabled={!allowed} onClick={() => { setRejecting(rejecting === d.id ? null : d.id); setReason(""); }}><IconX className="size-4" />Reject</Button>
                    </div>
                  </div>
                  <Table className="mt-3">
                    <thead><tr><Th>Medicine</Th><Th>Batch</Th><Th>Expiry</Th><Th className="text-right">Packs</Th><Th className="text-right">Units</Th></tr></thead>
                    <tbody>
                      {lines.map((l) => {
                        const drug = DRUG_BY_ID[l.drugId];
                        return (
                          <tr key={`${l.drugId}${l.lot}`}>
                            <Td className="font-medium">{drugName(l.drugId)}<span className="block text-xs font-normal text-muted-foreground">{drug?.brand}</span></Td>
                            <Td className="font-mono text-xs">{l.lot}</Td>
                            <Td className="whitespace-nowrap">{fmtDate(l.expiry)}</Td>
                            <Td className="text-right tabular-nums">{drug ? l.quantity / drug.pack.size : 0}</Td>
                            <Td className="text-right tabular-nums">{l.quantity} {drug?.unit}s</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                  <p className="mt-1 text-xs text-muted-foreground">{total} packs, each with its own serial number.</p>
                  {rejecting === d.id && (
                    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                      <Field label="Reason For Rejecting" required className="min-w-0 flex-1 basis-64"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: wrong batch delivered" /></Field>
                      <Button size="sm" variant="primary" disabled={reason.trim().length < 5} onClick={() => reject(d)}>Confirm Reject</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="rounded-lg border border-border p-3">
            <PackScanner
              label="Accept One Pack"
              hint="Scan a pack from the delivery to accept just that pack."
              disabled={!allowed}
              sample={sample}
              onPack={scan}
              message={msg}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold">Packs By RSD Status</div>
            <div className="flex flex-wrap gap-2">
              {ORDER.map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/60 px-2.5 py-1 text-xs dark:bg-white/5">
                  <PackStatusBadge status={s} /><span className="font-semibold tabular-nums">{counts[s]}</span>
                </span>
              ))}
              {counts.rejected > 0 && <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs"><PackStatusBadge status="rejected" /><span className="font-semibold tabular-nums">{counts.rejected}</span></span>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{STATUS_LABEL.received}: sent by the supplier, not accepted yet. {STATUS_LABEL.accepted}: can be dispensed.</p>
          </div>

          {calls.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold">Latest RSD Calls</div>
              <ul className="space-y-1">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-2 text-xs">
                    <Badge tone={c.ok ? "ok" : "danger"}>{c.ok ? "Success" : "Error"}</Badge>
                    <span className="font-medium">{c.operation}</span>
                    <span className="text-muted-foreground">{c.summary}</span>
                    <span className="ms-auto text-muted-foreground" title={fmtDateTime(c.at)}>{fmtTime(c.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
