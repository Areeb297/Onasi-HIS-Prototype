import * as React from "react";
import { RiyalSign } from "@/components/Money";
import { Badge, cn } from "@/components/ui/primitives";
import { qrSeed, round2, zatcaClock, zatcaQrText, type Invoice, type InvoiceStatus, type InvoiceView } from "@/lib/invoice";

/** An amount in Saudi riyals with halalas (two decimals). Money.tsx rounds to whole riyals, which is not enough for tax. */
export function Sar({ value, minus, className }: { value: number; minus?: boolean; className?: string }) {
  const v = round2(value);
  return (
    <span className={cn("inline-flex items-baseline gap-[0.18em] whitespace-nowrap tabular-nums", className)}>
      {(minus && v !== 0) || v < 0 ? <span aria-hidden="true">-</span> : null}
      <RiyalSign />
      <span>{Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span className="sr-only">{(minus && v !== 0) || v < 0 ? " Saudi riyals off" : " Saudi riyals"}</span>
    </span>
  );
}

const STATUS_TONE: Record<InvoiceStatus, "neutral" | "warn" | "ok"> = { Draft: "neutral", Submitted: "warn", Closed: "ok" };

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

/** ZATCA status tag (Pending, Reported, Failed) and, unless reported, how long is left of the 24 hours. */
export function ZatcaTag({ invoice, now, compact }: { invoice: Invoice; now: number; compact?: boolean }) {
  const c = zatcaClock(invoice, now);
  const tone = c.status === "Reported" ? "ok" : c.status === "Failed" || c.overdue ? "danger" : "warn";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1", compact && "flex-col items-start")} title={invoice.zatca.message}>
      <Badge tone={tone}>ZATCA: {c.status}</Badge>
      <span className={cn("text-xs", c.overdue && c.status !== "Reported" ? "font-medium text-destructive" : "text-muted-foreground")}>{c.text}</span>
    </span>
  );
}

/**
 * A stand-in for the ZATCA QR code: a pattern drawn from the invoice data, with the three corner squares a QR code has.
 * It is not scannable. A live system draws the real code from the signed invoice.
 */
export function ZatcaQr({ view, size = 96 }: { view: InvoiceView; size?: number }) {
  const n = 21;
  let seed = qrSeed(zatcaQrText(view)) || 1;
  const next = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const finder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    const ring = (ox: number, oy: number) => {
      const dx = x - ox, dy = y - oy;
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
    };
    if (inBox(0, 0)) return ring(0, 0) ? 1 : 0;
    if (inBox(n - 7, 0)) return ring(n - 7, 0) ? 1 : 0;
    if (inBox(0, n - 7)) return ring(0, n - 7) ? 1 : 0;
    if ((x === 7 && y < 8) || (y === 7 && x < 8) || (x === n - 8 && y < 8) || (y === 7 && x > n - 9) || (x === 7 && y > n - 9) || (y === n - 8 && x < 8)) return 0;
    return -1;
  };
  const cells: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const f = finder(x, y);
      const on = f === -1 ? next() > 0.5 : f === 1;
      if (on) cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />);
    }
  }
  return (
    <figure className="inline-flex flex-col items-center gap-1">
      <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} width={size} height={size} role="img" aria-label="ZATCA QR code placeholder" className="rounded-md bg-white fill-black p-0.5">
        {cells}
      </svg>
      <figcaption className="text-[0.6875rem] text-muted-foreground">QR placeholder</figcaption>
    </figure>
  );
}
