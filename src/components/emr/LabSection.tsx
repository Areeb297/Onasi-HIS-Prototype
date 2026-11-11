import * as React from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { AssumptionNote, DocViewer, Gate, NphiesPill, PRIORITY_UI, LAB_STATUS_UI, StatusBadge } from "@/components/emr/fhir-ui";
import { LabOrderPad } from "@/components/emr/LabOrderPad";
import { LabResultsTable } from "@/components/emr/LabResultsTable";
import { Badge, Button, Card, CardHeader, Empty, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { LAB_ASSUMPTIONS } from "@/lib/fhir/assumptions";
import { formatResult } from "@/lib/fhir/lab-bundles";
import { personFromDoctor } from "@/lib/fhir/people";
import { testByCode } from "@/lib/fhir/lab-catalog";
import {
  amendLabOrder, cancelLabOrder, hasCritical, labSendsOf, orderNphiesState, placeLabOrder, resultNphiesState, sendLabOrder, useLab,
} from "@/lib/lab";
import type { Encounter } from "@/lib/model";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { lastAccepted, lastAttempt, type LabOrder } from "@/lib/fhir/types";

const when = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** What the "send" button should say, depending on where the order stands. */
function sendLabel(o: LabOrder): string | null {
  const last = lastAttempt(o.sends, "lab-order");
  const acc = lastAccepted(o.sends, "lab-order");
  if (o.status === "cancelled") return !acc && !last ? null : o.orderDirty || last?.response.status === "rejected" ? "Send Cancellation To NPHIES" : null;
  if (!last) return "Send Order To NPHIES";
  if (last.response.status === "rejected") return "Send Order To NPHIES Again";
  if (o.orderDirty) return "Send Amended Order To NPHIES";
  return null;
}

/** The Laboratory tab of the chart. Order in a few taps, see status and results, send to NPHIES. */
export function LabSection({ enc }: { enc: Encounter }) {
  const lab = useLab();
  const his = useHis();
  const dev = useDevMode();
  useSession();
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const orders = lab.orders.filter((o) => o.visitNumber === enc.visitNumber);
  const [padKey, setPadKey] = React.useState(0);
  const [amending, setAmending] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [fhirOpen, setFhirOpen] = React.useState<Record<string, boolean>>({});

  const visitOpen = enc.status !== "cancelled";
  const canOrder = can("order.lab") && visitOpen;
  const reason = !visitOpen ? "This visit is cancelled." : "Your role cannot order laboratory tests.";

  const criticals = orders.flatMap((o) =>
    Object.values(o.results)
      .filter((r) => (r.interp === "HH" || r.interp === "LL") && r.status !== "cancelled")
      .map((r) => ({ o, r, t: testByCode(r.code) })),
  );

  const amendingOrder = orders.find((o) => o.id === amending);
  const cancellingOrder = orders.find((o) => o.id === cancelling);

  return (
    <div className="space-y-4">
      {criticals.length > 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <div className="font-semibold text-destructive">Critical Result</div>
            {criticals.map(({ o, r, t }) => (
              <div key={`${o.id}-${r.code}`}>
                {t?.short}: <span className="font-semibold">{t ? formatResult(t, r) : r.value}</span> ({o.id})
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader
          title="Order Laboratory Tests"
          subtitle={`Visit ${enc.visitNumber}. Tap tests, then place the order.`}
          right={dev ? <Badge tone="update">Visit number goes in Encounter.identifier</Badge> : undefined}
        />
        <div className="px-4 py-4">
          <LabOrderPad
            key={padKey}
            canOrder={canOrder}
            reason={reason}
            submitLabel="Place Order"
            showSend
            onSubmit={(v, andSend) => {
              const o = placeLabOrder(enc, v);
              if (o && andSend) sendLabOrder(o.id);
              if (o) setPadKey((k) => k + 1);
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Laboratory Orders" subtitle={`${orders.length} for this visit`} />
        {orders.length === 0 && <Empty>No laboratory orders for this visit yet.</Empty>}
        <div className="divide-y divide-border">
          {orders.map((o) => {
            const nph = orderNphiesState(o);
            const res = resultNphiesState(o);
            const label = sendLabel(o);
            const editable = o.status === "received" || o.status === "collected" || o.status === "in-progress";
            const hasResults = Object.keys(o.results).length > 0;
            const showResults = hasResults && (o.status === "resulted" || o.status === "amended" || dev);
            return (
              <div key={o.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{dev ? o.id : "Lab Order"}</span>
                      <StatusBadge map={LAB_STATUS_UI} status={o.status} />
                      <StatusBadge map={PRIORITY_UI} status={o.priority} />
                      <NphiesPill label={nph.label} tone={nph.tone} />
                      {(o.status === "resulted" || o.status === "amended" || labSendsOf(o, "lab-result").length > 0) && <NphiesPill label={`Result ${res.label}`} tone={res.tone} />}
                      {hasCritical(o) && <Badge tone="danger">Critical Result</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {o.codes.map((c) => (
                        <Badge key={c} tone="neutral">
                          {testByCode(c)?.short ?? c}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ordered {when(o.orderedAt)} by {personFromDoctor(o.orderedById).name}
                      {o.fasting !== null && ` · ${o.fasting ? "Fasting" : "Non-fasting"}`}
                      {o.note && ` · ${o.note}`}
                      {dev && <span className="ml-2 font-mono">Visit {o.visitNumber}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {label && (
                      <Gate allowed={can("order.lab")} reason="Your role cannot send laboratory orders.">
                        <Button variant="primary" size="sm" disabled={!can("order.lab")} onClick={() => sendLabOrder(o.id)}>
                          {label}
                        </Button>
                      </Gate>
                    )}
                    {editable && (
                      <>
                        <Gate allowed={can("order.lab")} reason="Your role cannot change laboratory orders.">
                          <Button size="sm" disabled={!can("order.lab")} onClick={() => setAmending(o.id)}>Amend Order</Button>
                        </Gate>
                        <Gate allowed={can("order.lab")} reason="Your role cannot cancel laboratory orders.">
                          <Button size="sm" variant="danger" disabled={!can("order.lab")} onClick={() => setCancelling(o.id)}>Cancel Order</Button>
                        </Gate>
                      </>
                    )}
                  </div>
                </div>

                {o.status === "cancelled" && <p className="text-sm text-muted-foreground">This order was cancelled.</p>}
                {!hasResults && o.status !== "cancelled" && <p className="text-sm text-muted-foreground">Waiting for the laboratory. Results appear here when they are published.</p>}
                {showResults && (
                  <div className="rounded-lg border border-border">
                    <LabResultsTable order={o} sex={patient?.sex ?? "M"} />
                    {!(o.status === "resulted" || o.status === "amended") && <p className="px-3 py-2 text-xs text-muted-foreground">Not published yet. Shown in Developer View only.</p>}
                  </div>
                )}

                {dev && (
                  <div>
                    <button
                      className="flex items-center gap-1.5 text-xs font-medium text-update hover:underline"
                      aria-expanded={!!fhirOpen[o.id]}
                      onClick={() => setFhirOpen((s) => ({ ...s, [o.id]: !s[o.id] }))}
                    >
                      <ChevronDown className={cn("size-4 transition-transform", fhirOpen[o.id] && "rotate-180")} />
                      FHIR documents for this order
                    </button>
                    {fhirOpen[o.id] && (
                      <div className="mt-3 space-y-5">
                        <div>
                          <h3 className="mb-2 text-sm font-semibold">Laboratory Order Bundle</h3>
                          <DocViewer key={`${o.id}-ord-${labSendsOf(o, "lab-order").length}`} records={labSendsOf(o, "lab-order")} filenamePrefix={`lab-order-${o.id}`} empty="Not sent yet. Press Send Order To NPHIES." />
                        </div>
                        {labSendsOf(o, "lab-result").length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold">Laboratory Report Bundle</h3>
                            <DocViewer key={`${o.id}-res-${labSendsOf(o, "lab-result").length}`} records={labSendsOf(o, "lab-result")} filenamePrefix={`lab-result-${o.id}`} empty="" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      <AssumptionNote items={LAB_ASSUMPTIONS} />

      <Dialog open={!!amendingOrder} onClose={() => setAmending(null)} title="Amend Order" subtitle={amendingOrder ? `${amendingOrder.id}. Sending the change replaces the order in NPHIES.` : undefined} wide>
        {amendingOrder && (
          <LabOrderPad
            key={amendingOrder.id}
            initial={{ codes: amendingOrder.codes, priority: amendingOrder.priority, fasting: amendingOrder.fasting, note: amendingOrder.note }}
            testsLocked={amendingOrder.status !== "received"}
            canOrder={canOrder}
            reason={reason}
            submitLabel="Save Changes"
            showSend={!!lastAccepted(amendingOrder.sends, "lab-order")}
            onSubmit={(v, andSend) => {
              if (amendLabOrder(amendingOrder.id, v)) {
                if (andSend) sendLabOrder(amendingOrder.id);
                setAmending(null);
              }
            }}
            onCancel={() => setAmending(null)}
          />
        )}
      </Dialog>

      <Dialog
        open={!!cancellingOrder}
        onClose={() => setCancelling(null)}
        title="Cancel Order"
        subtitle={cancellingOrder ? `${cancellingOrder.id}: ${cancellingOrder.codes.map((c) => testByCode(c)?.short).join(", ")}` : undefined}
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep Order</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (cancellingOrder && cancelLabOrder(cancellingOrder.id)) setCancelling(null);
              }}
            >
              Cancel Order
            </Button>
          </>
        }
      >
        <p className="text-sm">The laboratory will not process this order. If it was already sent, you can send the cancellation to NPHIES after this.</p>
      </Dialog>
    </div>
  );
}
