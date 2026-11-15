import * as React from "react";
import { IconAlertTriangle, IconCalendarDue, IconClipboardCheck, IconPackage, IconPackageImport, IconPill, IconTruckDelivery } from "@tabler/icons-react";
import { VerifyBadge, fmtWhen } from "@/components/emr/RxShared";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui/primitives";
import { activeQueue, pharmacyOverview, useStock } from "@/lib/pharmacy-stock";
import { navigate } from "@/lib/router";
import { fillOf, getDrug, useRx } from "@/lib/rx";
import { useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";

/** Pharmacy home: /pharmacy. What is waiting at the pharmacy now and the stock alerts. */

const QUEUE_LIMIT = 12;

export function PharmacyHomePage() {
  const rx = useRx();
  const his = useHis();
  const stock = useStock();
  useSession();
  const [showAll, setShowAll] = React.useState(false);
  const today = React.useMemo(() => new Date(), []);

  const o = pharmacyOverview(rx, stock, today);
  const queue = activeQueue(rx);
  const shown = showAll ? queue : queue.slice(0, QUEUE_LIMIT);

  return (
    <div>
      <PageHeader
        title="Pharmacy"
        subtitle="Prescriptions waiting at the pharmacy and the stock that needs attention. A pharmacist checks every item before it is dispensed."
        right={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/pharmacy/stock")}><IconPackage className="size-4" /> Stock On Hand</Button>
            <Button onClick={() => navigate("/pharmacy/stock", { tab: "receipt" })}><IconTruckDelivery className="size-4" /> Goods Receipt</Button>
            <Button variant="primary" onClick={() => navigate("/pharmacy/dispense")}><IconPill className="size-4" /> Dispense Worklist</Button>
          </div>
        }
      />

      <KpiStrip label="Pharmacy now" className="mb-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Waiting For Check" value={o.waiting} note="New, changed or answered items" icon={<IconClipboardCheck stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <KpiTile label="Ready To Dispense" value={o.ready} note="Verified by a pharmacist" icon={<IconPill stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <KpiTile label="Dispensed Today" value={o.dispensedToday} note="Lines handed over today" tone="ok" icon={<IconPackageImport stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <KpiTile label="Low Stock" value={o.lowStock} note="Items under the reorder level" tone={o.lowStock ? "warn" : undefined} accent={o.lowStock ? "warn" : "brand"} icon={<IconAlertTriangle stroke={1.75} />} onClick={() => navigate("/pharmacy/stock", { tab: "low" })} />
        <KpiTile label="Expiring Soon" value={o.expiringSoon} note="Batches within 90 days or expired" tone={o.expiringSoon ? "danger" : undefined} accent={o.expiringSoon ? "danger" : "brand"} icon={<IconCalendarDue stroke={1.75} />} onClick={() => navigate("/pharmacy/stock", { tab: "expiry" })} className="col-span-2 sm:col-span-1" />
      </KpiStrip>

      <Card>
        <CardHeader
          title="Active Queue"
          subtitle="Items sent by the doctors that are not fully dispensed, oldest first."
          right={<Badge tone={queue.length ? "update" : "neutral"}>{queue.length} {queue.length === 1 ? "item" : "items"}</Badge>}
        />
        <Table>
          <thead>
            <tr><Th>Patient</Th><Th>Prescription</Th><Th>Drug</Th><Th>Status</Th><Th>Sent</Th><Th>Action</Th></tr>
          </thead>
          <tbody>
            {queue.length === 0 && <tr><Td colSpan={6}><Empty>Nothing is waiting at the pharmacy. Doctors send prescriptions from the chart.</Empty></Td></tr>}
            {shown.map(({ rx: p, item, status, sentAt }) => {
              const patient = his.patients.find((x) => x.id === p.patientId);
              const drug = getDrug(item.drugId);
              const fill = fillOf(rx, p, item);
              const part = status === "verified" && fill.dispensedTotal > 0;
              return (
                <tr key={`${p.id}:${item.id}`} className="hover:bg-muted/40">
                  <Td>
                    <div className="font-medium">{patientName(patient)}</div>
                    <div className="text-xs text-muted-foreground">{patient?.mrn}</div>
                  </Td>
                  <Td>
                    <div className="font-mono text-xs">{p.number}</div>
                    <div className="text-xs text-muted-foreground">Visit {p.visitNumber}</div>
                  </Td>
                  <Td>
                    <div className="font-medium">{drug.generic} {drug.strengthValue} {drug.strengthUnit}</div>
                    <div className="text-xs text-muted-foreground">{item.quantity} {drug.unit}{item.quantity === 1 || drug.unit === "mL" ? "" : "s"}{part ? `, ${fill.dispensedTotal} given` : ""}</div>
                  </Td>
                  <Td>{part ? <Badge tone="warn">Part Dispensed</Badge> : status === "verified" ? <Badge tone="admit">Ready To Dispense</Badge> : <VerifyBadge status={status} />}</Td>
                  <Td className="whitespace-nowrap">{fmtWhen(sentAt)}</Td>
                  <Td>
                    <Button size="sm" onClick={() => navigate("/pharmacy/dispense")} aria-label={`Open ${drug.generic} for ${patientName(patient)} in the Dispense Worklist`}>
                      {status === "verified" ? "Dispense" : "Check"}
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        {queue.length > QUEUE_LIMIT && (
          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show Fewer" : `Show All ${queue.length}`}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
