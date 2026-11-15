import * as React from "react";
import { IconAlertTriangle, IconCalendarDue, IconClipboardCheck, IconPackage, IconPackageImport, IconPill, IconTruckDelivery } from "@tabler/icons-react";
import { VerifyBadge, fmtWhen } from "@/components/emr/RxShared";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui/primitives";
import { activeQueue, pharmacyOverview, useStock } from "@/lib/pharmacy-stock";
import { navigate } from "@/lib/router";
import { fillOf, getDrug, useRx } from "@/lib/rx";
import { useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";

/** Pharmacy home: /pharmacy. What is waiting at the pharmacy now and the stock alerts. */

type TileTone = "update" | "admit" | "ok" | "warn" | "danger";

const TONE: Record<TileTone, string> = {
  update: "bg-update/12 text-update",
  admit: "bg-admit/14 text-admit",
  ok: "bg-ok/14 text-ok",
  warn: "bg-warn/16 text-warn",
  danger: "bg-destructive/12 text-destructive",
};

function Tile({ label, value, hint, tone, icon, onClick }: { label: string; value: number; hint: string; tone: TileTone; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", TONE[tone])} aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-muted-foreground">{label}</span>
        <span className="block text-2xl font-semibold tabular-nums">{value}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

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
  const icon = "size-5";

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

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Waiting For Check" value={o.waiting} hint="New, changed or answered items" tone="update" icon={<IconClipboardCheck className={icon} stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <Tile label="Ready To Dispense" value={o.ready} hint="Verified by a pharmacist" tone="admit" icon={<IconPill className={icon} stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <Tile label="Dispensed Today" value={o.dispensedToday} hint="Lines handed over today" tone="ok" icon={<IconPackageImport className={icon} stroke={1.75} />} onClick={() => navigate("/pharmacy/dispense")} />
        <Tile label="Low Stock" value={o.lowStock} hint="Items under the reorder level" tone="warn" icon={<IconAlertTriangle className={icon} stroke={1.75} />} onClick={() => navigate("/pharmacy/stock", { tab: "low" })} />
        <Tile label="Expiring Soon" value={o.expiringSoon} hint="Batches within 90 days or expired" tone="danger" icon={<IconCalendarDue className={icon} stroke={1.75} />} onClick={() => navigate("/pharmacy/stock", { tab: "expiry" })} />
      </div>

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
