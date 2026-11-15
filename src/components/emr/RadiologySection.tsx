import * as React from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { AssumptionNote, DocViewer, Gate, NphiesPill, PRIORITY_UI, RAD_STATUS_UI, StatusBadge } from "@/components/emr/fhir-ui";
import { OrderMetaLine } from "@/components/emr/OrderFields";
import { RadOrderPad } from "@/components/emr/RadOrderPad";
import { RadReportView } from "@/components/emr/RadReportEditor";
import { Badge, Button, Card, CardHeader, Empty, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { RAD_ASSUMPTIONS } from "@/lib/fhir/assumptions";
import { personFromDoctor } from "@/lib/fhir/people";
import { BODY_REGIONS, MODALITIES, procByCode } from "@/lib/fhir/rad-catalog";
import { lastAccepted, lastAttempt, type RadOrder } from "@/lib/fhir/types";
import type { Encounter } from "@/lib/model";
import {
  amendRadOrder, cancelRadOrder, groupRadOrders, openRadDuplicates, placeRadOrderGroup, radOrderNphiesState, radReportNphiesState, radSendsOf, sendRadOrder, useRad,
} from "@/lib/radiology";
import { visitInsured } from "@/lib/order-fields";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { fmtDateTime } from "@/lib/format";
import { confirmPatient } from "@/lib/wrong-patient";

const when = (iso: string) =>
  fmtDateTime(iso);

function sendLabel(o: RadOrder): string | null {
  const last = lastAttempt(o.sends, "rad-order");
  const acc = lastAccepted(o.sends, "rad-order");
  if (o.status === "cancelled") return !acc && !last ? null : o.orderDirty || last?.response.status === "rejected" ? "Send Cancellation To NPHIES" : null;
  if (!last) return "Send Order To NPHIES";
  if (last.response.status === "rejected") return "Send Order To NPHIES Again";
  if (o.orderDirty) return "Send Amended Order To NPHIES";
  return null;
}

/** The Radiology tab of the chart. Order an exam in a few taps, follow the status, read the report. */
export function RadiologySection({ enc }: { enc: Encounter }) {
  const rad = useRad();
  const dev = useDevMode();
  useSession();
  const orders = rad.orders.filter((o) => o.visitNumber === enc.visitNumber);
  const [padKey, setPadKey] = React.useState(0);
  const [amending, setAmending] = React.useState<string | null>(null);
  const [cancelling, setCancelling] = React.useState<string | null>(null);
  const [fhirOpen, setFhirOpen] = React.useState<Record<string, boolean>>({});

  const visitOpen = enc.status !== "cancelled";
  const canOrder = can("order.rad") && visitOpen;
  const reason = !visitOpen ? "This visit is cancelled." : "Your role cannot order radiology exams.";
  const his = useHis();
  const insured = visitInsured(his.patients.find((p) => p.id === enc.patientId));
  const amendingOrder = orders.find((o) => o.id === amending);
  const cancellingOrder = orders.find((o) => o.id === cancelling);
  const criticals = orders.filter((o) => o.report?.critical && (o.status === "resulted" || o.status === "amended"));

  return (
    <div className="space-y-4">
      {criticals.map((o) => (
        <div key={o.id} role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="text-sm">
            <div className="font-semibold text-destructive">Critical Imaging Result</div>
            <div>{procByCode(o.procCode)?.short}: {o.report?.impression}</div>
            {o.report?.communicated && <div className="text-xs text-muted-foreground">Communicated to {o.report.communicated}</div>}
          </div>
        </div>
      ))}

      <Card>
        <CardHeader
          title="Order Imaging"
          subtitle={`Visit ${enc.visitNumber}. Tap one or more exams, then place the order.`}
          right={dev ? <Badge tone="update">Visit number goes in Encounter.identifier</Badge> : undefined}
        />
        <div className="px-4 py-4">
          <RadOrderPad
            key={padKey}
            diagnoses={enc.dx}
            insured={insured}
            duplicatesOf={(codes) => openRadDuplicates(rad.orders, enc.visitNumber, codes).map((c) => procByCode(c)?.short ?? c)}
            canOrder={canOrder}
            reason={reason}
            defaultIndication={enc.reason}
            submitLabel="Place Order"
            showSend
            onSubmit={async (v, andSend) => {
              if (!(await confirmPatient(enc.patientId))) return;
              const { orders: placed } = placeRadOrderGroup(enc, v);
              if (andSend) for (const o of placed) sendRadOrder(o.id);
              if (placed.length) setPadKey((k) => k + 1);
            }}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Radiology Orders" subtitle={`${orders.length} for this visit`} />
        {orders.length === 0 && <Empty>No radiology orders for this visit yet.</Empty>}
        <div className="divide-y divide-border">
          {groupRadOrders(orders).map((g) => {
            const unsent = g.orders.filter((o) => sendLabel(o) === "Send Order To NPHIES");
            return (
              <div key={g.groupId}>
                {g.orders[0].groupId && (
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-4 py-2">
                    <div className="text-sm">
                      <span className="font-semibold">Order {g.groupId}</span>
                      <span className="text-muted-foreground"> · {g.orders.length} {g.orders.length === 1 ? "Exam" : "Exams"}</span>
                    </div>
                    {unsent.length > 1 && (
                      <Gate allowed={can("order.rad")} reason="Your role cannot send radiology orders.">
                        <Button size="sm" disabled={!can("order.rad")} onClick={() => unsent.forEach((o) => sendRadOrder(o.id))}>
                          Send All {unsent.length} To NPHIES
                        </Button>
                      </Gate>
                    )}
                  </div>
                )}
                <div className="divide-y divide-border">
          {g.orders.map((o) => {
            const proc = procByCode(o.procCode);
            const nph = radOrderNphiesState(o);
            const rep = radReportNphiesState(o);
            const label = sendLabel(o);
            const editable = o.status === "received" || o.status === "performed";
            const published = o.status === "resulted" || o.status === "amended";
            return (
              <div key={o.id} className="space-y-3 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{proc?.display ?? o.procCode}</span>
                      {dev && <span className="font-mono text-xs text-muted-foreground">{o.id}</span>}
                      <StatusBadge map={RAD_STATUS_UI} status={o.status} />
                      <StatusBadge map={PRIORITY_UI} status={o.priority} />
                      <NphiesPill label={nph.label} tone={nph.tone} />
                      {(published || radSendsOf(o, "rad-report").length > 0) && <NphiesPill label={`Report ${rep.label}`} tone={rep.tone} />}
                      {o.report?.critical && published && <Badge tone="danger">Critical Result</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {proc && `Modality: ${MODALITIES[proc.modality].display} · Body Site: ${BODY_REGIONS[proc.region].display}`}
                      <br />
                      Ordered {when(o.orderedAt)} by {personFromDoctor(o.orderedById).name}
                      {o.indication && ` · Reason: ${o.indication}`}
                      {dev && <span className="ml-2 font-mono">Visit {o.visitNumber}</span>}
                    </div>
                    <OrderMetaLine diagnosis={o.diagnosis} coverage={o.coverage} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {label && (
                      <Gate allowed={can("order.rad")} reason="Your role cannot send radiology orders.">
                        <Button variant="primary" size="sm" disabled={!can("order.rad")} onClick={() => sendRadOrder(o.id)}>{label}</Button>
                      </Gate>
                    )}
                    {editable && (
                      <>
                        <Gate allowed={can("order.rad")} reason="Your role cannot change radiology orders.">
                          <Button size="sm" disabled={!can("order.rad")} onClick={() => setAmending(o.id)}>Amend Order</Button>
                        </Gate>
                        <Gate allowed={can("order.rad")} reason="Your role cannot cancel radiology orders.">
                          <Button size="sm" variant="danger" disabled={!can("order.rad")} onClick={() => setCancelling(o.id)}>Cancel Order</Button>
                        </Gate>
                      </>
                    )}
                  </div>
                </div>

                {o.status === "cancelled" && <p className="text-sm text-muted-foreground">This order was cancelled.</p>}
                {(o.status === "received" || o.status === "performed") && (
                  <p className="text-sm text-muted-foreground">
                    {o.status === "received" ? "Waiting for the exam." : "The exam is done. Waiting for the radiologist's report."}
                  </p>
                )}
                {published && o.report && <RadReportView order={o} />}

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
                          <h3 className="mb-2 text-sm font-semibold">Radiology Order Bundle</h3>
                          <DocViewer key={`${o.id}-o${radSendsOf(o, "rad-order").length}`} records={radSendsOf(o, "rad-order")} filenamePrefix={`rad-order-${o.id}`} empty="Not sent yet. Press Send Order To NPHIES." />
                        </div>
                        {radSendsOf(o, "rad-report").length > 0 && (
                          <div>
                            <h3 className="mb-2 text-sm font-semibold">Radiology Report Bundle</h3>
                            <DocViewer key={`${o.id}-r${radSendsOf(o, "rad-report").length}`} records={radSendsOf(o, "rad-report")} filenamePrefix={`rad-report-${o.id}`} empty="" />
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
              </div>
            );
          })}
        </div>
      </Card>
      <AssumptionNote items={RAD_ASSUMPTIONS} />

      <Dialog open={!!amendingOrder} onClose={() => setAmending(null)} title="Amend Order" subtitle={amendingOrder ? `${amendingOrder.id}. Sending the change replaces the order in NPHIES.` : undefined} wide>
        {amendingOrder && (
          <RadOrderPad
            key={amendingOrder.id}
            diagnoses={enc.dx}
            insured={insured}
            duplicatesOf={(codes) => openRadDuplicates(rad.orders, enc.visitNumber, codes, amendingOrder.id).map((c) => procByCode(c)?.short ?? c)}
            single
            procLocked={amendingOrder.status !== "received"}
            initial={{
              procCode: amendingOrder.procCode, priority: amendingOrder.priority, indication: amendingOrder.indication, clinicalInfo: amendingOrder.clinicalInfo,
              diagnosis: amendingOrder.diagnosis ?? null, coverage: amendingOrder.coverage,
            }}
            canOrder={canOrder}
            reason={reason}
            submitLabel="Save Changes"
            showSend={!!lastAccepted(amendingOrder.sends, "rad-order")}
            onSubmit={(v, andSend) => {
              if (amendRadOrder(amendingOrder.id, { ...v, procCode: v.procCodes[0] })) {
                if (andSend) sendRadOrder(amendingOrder.id);
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
        subtitle={cancellingOrder ? `${cancellingOrder.id}: ${procByCode(cancellingOrder.procCode)?.display}` : undefined}
        footer={
          <>
            <Button onClick={() => setCancelling(null)}>Keep Order</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (cancellingOrder && cancelRadOrder(cancellingOrder.id)) setCancelling(null);
              }}
            >
              Cancel Order
            </Button>
          </>
        }
      >
        <p className="text-sm">Radiology will not do this exam. If the order was already sent, you can send the cancellation to NPHIES after this.</p>
      </Dialog>
    </div>
  );
}
