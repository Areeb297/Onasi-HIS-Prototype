import * as React from "react";
import { IconDeviceFloppy, IconSend, IconTrash } from "@tabler/icons-react";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Problems, StockLinesEditor, blankLine, toInputs, type LineDraft } from "@/components/pharmacy/StockLinesEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import {
  DEFAULT_LOCATION, EXPIRY_WATCH_DAYS, LOCATIONS, REORDER_PACKS, SUPPLIERS, deleteDraftReceipt, expiryText, expiryWatch, isoDay, lowStock, postReceipt,
  receiptValue, saveOpeningStock, saveReceipt, stockOnHand, useStock, type ReceiptStatus, type StockRow,
} from "@/lib/pharmacy-stock";
import { navigate, useRoute } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { fmtExpiry } from "@/lib/rx-stock";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/**
 * Pharmacy stock: /pharmacy/stock. Tabs: Stock On Hand (with the Low Stock and Expiry Watch panels), Opening Stock Entry
 * and Goods Receipt. `?tab=low` or `?tab=expiry` opens Stock On Hand at that panel.
 */

type Tab = "stock" | "opening" | "receipt";

const qty = (n: number, unit: string) => `${Math.round(n * 100) / 100} ${unit}${n === 1 || unit === "mL" ? "" : "s"}`;
const mayEdit = () => can("rx.dispense") || can("admin");
const NO_RIGHTS = "This needs the dispensing permission.";

function ExpiryBadge({ r }: { r: StockRow }) {
  if (r.daysLeft < 0) return <Badge tone="danger">Expired</Badge>;
  if (r.daysLeft <= EXPIRY_WATCH_DAYS) return <Badge tone="warn">{r.daysLeft} Days Left</Badge>;
  return null;
}

export function PharmacyStockPage() {
  const route = useRoute();
  const rx = useRx();
  const stock = useStock();
  useSession();
  const param = route.params.get("tab") ?? "";
  const tab: Tab = param === "opening" || param === "receipt" ? param : "stock";
  const today = React.useMemo(() => new Date(), []);
  const rows = React.useMemo(() => stockOnHand(stock, rx.dispenses, today), [stock, rx.dispenses, today]);

  React.useEffect(() => {
    if (param === "low" || param === "expiry") document.getElementById(`panel-${param}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [param]);

  return (
    <div>
      <PageHeader
        title="Pharmacy Stock"
        subtitle="Stock by item, location and batch. Record opening stock and goods received from suppliers. Dispensing takes stock off the batch it came from."
        right={<Button onClick={() => navigate("/pharmacy")}>Pharmacy Home</Button>}
      />
      <Tabs value={tab} onValueChange={(v) => navigate("/pharmacy/stock", { tab: v === "stock" ? undefined : v })}>
        <TabsList>
          <TabsTrigger value="stock">Stock On Hand</TabsTrigger>
          <TabsTrigger value="opening">Opening Stock Entry</TabsTrigger>
          <TabsTrigger value="receipt">Goods Receipt</TabsTrigger>
        </TabsList>
        <TabsContent value="stock" className="pt-3"><StockTab rows={rows} /></TabsContent>
        <TabsContent value="opening" className="pt-3"><OpeningTab today={today} /></TabsContent>
        <TabsContent value="receipt" className="pt-3"><ReceiptTab today={today} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------- Stock On Hand ---------- */

function StockTab({ rows }: { rows: StockRow[] }) {
  const [q, setQ] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [hideEmpty, setHideEmpty] = React.useState(true);
  const low = lowStock(rows);
  const watch = expiryWatch(rows);
  const text = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (location && r.location !== location) return false;
    if (hideEmpty && r.available <= 0) return false;
    return !text || `${r.drug.generic} ${r.drug.brand} ${r.drug.code} ${r.lot}`.toLowerCase().includes(text);
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Stock Inquiry" subtitle={`${shown.length} of ${rows.length} batches shown.`} />
        <div className="grid gap-3 p-4 sm:grid-cols-[1fr_220px_auto] sm:items-end">
          <Field label="Item Or Batch"><Input placeholder="Drug name, brand, code or lot" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <Field label="Location">
            <Select value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All Locations</option>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
            Hide Empty Batches
          </label>
        </div>
        <Table>
          <thead>
            <tr><Th>Item</Th><Th>Location</Th><Th>Batch</Th><Th>Expiry</Th><Th className="text-right">Received</Th><Th className="text-right">Dispensed</Th><Th className="text-right">Available</Th><Th>Source</Th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><Td colSpan={8}><Empty>No batches match.</Empty></Td></tr>}
            {shown.map((r) => (
              <tr key={r.key} className={cn("hover:bg-muted/40", r.expired && "bg-destructive/5")}>
                <Td>
                  <div className="font-medium">{r.drug.generic} {r.drug.strengthValue} {r.drug.strengthUnit}</div>
                  <div className="text-xs text-muted-foreground">{r.drug.brand} · {r.drug.code}</div>
                </Td>
                <Td className="whitespace-nowrap">{r.location}</Td>
                <Td className="font-mono text-xs">{r.lot}</Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-2 whitespace-nowrap">{fmtExpiry(r.expiry)} <ExpiryBadge r={r} /></div>
                </Td>
                <Td className="text-right tabular-nums">{qty(r.base + r.received, r.drug.unit)}</Td>
                <Td className="text-right tabular-nums">{qty(r.dispensed, r.drug.unit)}</Td>
                <Td className={cn("text-right font-semibold tabular-nums", r.available <= 0 && "text-muted-foreground")}>{qty(r.available, r.drug.unit)}</Td>
                <Td className="whitespace-nowrap text-xs">{r.source}{r.ref && <span className="block font-mono text-muted-foreground">{r.ref}</span>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div id="panel-low" className="scroll-mt-4" />
          <CardHeader title="Low Stock" subtitle={`Usable stock in all locations under ${REORDER_PACKS} packs. Expired batches do not count.`} right={<Badge tone={low.length ? "warn" : "ok"}>{low.length}</Badge>} />
          <Table>
            <thead><tr><Th>Item</Th><Th className="text-right">Available</Th><Th className="text-right">Reorder Level</Th><Th className="text-right">Short By</Th></tr></thead>
            <tbody>
              {low.length === 0 && <tr><Td colSpan={4}><Empty>Every item is above its reorder level.</Empty></Td></tr>}
              {low.map((x) => (
                <tr key={x.drug.id}>
                  <Td><div className="font-medium">{x.drug.generic} {x.drug.strengthValue} {x.drug.strengthUnit}</div><div className="text-xs text-muted-foreground">{x.drug.brand}</div></Td>
                  <Td className={cn("text-right font-semibold tabular-nums", x.available <= 0 ? "text-destructive" : "text-warn")}>{qty(x.available, x.drug.unit)}</Td>
                  <Td className="text-right tabular-nums">{qty(x.reorderLevel, x.drug.unit)}</Td>
                  <Td className="text-right tabular-nums">{qty(x.short, x.drug.unit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <div id="panel-expiry" className="scroll-mt-4" />
          <CardHeader title="Expiry Watch" subtitle={`Batches with stock that are expired or expire within ${EXPIRY_WATCH_DAYS} days.`} right={<Badge tone={watch.length ? "danger" : "ok"}>{watch.length}</Badge>} />
          <Table>
            <thead><tr><Th>Item</Th><Th>Batch</Th><Th>Location</Th><Th>Expiry</Th><Th className="text-right">Available</Th></tr></thead>
            <tbody>
              {watch.length === 0 && <tr><Td colSpan={5}><Empty>No batch expires within {EXPIRY_WATCH_DAYS} days.</Empty></Td></tr>}
              {watch.map((r) => (
                <tr key={r.key}>
                  <Td className="font-medium">{r.drug.generic} {r.drug.strengthValue} {r.drug.strengthUnit}</Td>
                  <Td className="font-mono text-xs">{r.lot}</Td>
                  <Td className="whitespace-nowrap">{r.location}</Td>
                  <Td>
                    <div className="whitespace-nowrap">{fmtExpiry(r.expiry)}</div>
                    <div className={cn("text-xs", r.expired ? "text-destructive" : "text-warn")}>{expiryText(r)}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{qty(r.available, r.drug.unit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Opening Stock Entry ---------- */

function OpeningTab({ today }: { today: Date }) {
  const rx = useRx();
  const stock = useStock();
  const [location, setLocation] = React.useState<string>(DEFAULT_LOCATION);
  const [date, setDate] = React.useState(isoDay(today));
  const [lines, setLines] = React.useState<LineDraft[]>(() => [blankLine()]);
  const [problems, setProblems] = React.useState<string[]>([]);
  const allowed = mayEdit();

  const save = () => {
    const r = saveOpeningStock({ location, date, lines: toInputs(lines) }, rx.dispenses, today);
    if (!r.ok) { setProblems(r.errors); return; }
    setProblems([]);
    setLines([blankLine()]);
    pushToast({ tone: "ok", text: `Opening stock ${r.value.number} saved.`, detail: `${r.value.lines.length} batch${r.value.lines.length === 1 ? "" : "es"} added to ${r.value.location}.` });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Opening Stock Entry" subtitle="The first count of stock in a location, before any goods receipt. Each line adds a batch at once." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Location" required>
            <Select value={location} disabled={!allowed} onChange={(e) => setLocation(e.target.value)}>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Stock Date" required><Input type="date" value={date} disabled={!allowed} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <StockLinesEditor lines={lines} onChange={setLines} disabled={!allowed} />
        <Problems items={problems} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
          {!allowed && <span className="text-sm text-muted-foreground">{NO_RIGHTS}</span>}
          <Button onClick={() => { setLines([blankLine()]); setProblems([]); }} disabled={!allowed}>Clear</Button>
          <Button variant="primary" onClick={save} disabled={!allowed}><IconDeviceFloppy className="size-4" /> Save Opening Stock</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Saved Opening Stock" />
        <Table>
          <thead><tr><Th>Number</Th><Th>Date</Th><Th>Location</Th><Th>Items</Th><Th>Entered By</Th></tr></thead>
          <tbody>
            {stock.openings.length === 0 && <tr><Td colSpan={5}><Empty>No opening stock entered yet.</Empty></Td></tr>}
            {[...stock.openings].reverse().map((o) => (
              <tr key={o.id}>
                <Td className="font-mono text-xs">{o.number}</Td>
                <Td className="whitespace-nowrap">{fmtExpiry(o.date)}</Td>
                <Td>{o.location}</Td>
                <Td>{o.lines.length}</Td>
                <Td>{o.by}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

/* ---------- Goods Receipt ---------- */

function ReceiptTab({ today }: { today: Date }) {
  const rx = useRx();
  const stock = useStock();
  const [supplier, setSupplier] = React.useState("");
  const [invoiceNo, setInvoiceNo] = React.useState("");
  const [location, setLocation] = React.useState<string>(DEFAULT_LOCATION);
  const [date, setDate] = React.useState(isoDay(today));
  const [notes, setNotes] = React.useState("");
  const [lines, setLines] = React.useState<LineDraft[]>(() => [blankLine()]);
  const [problems, setProblems] = React.useState<string[]>([]);
  const allowed = mayEdit();

  const reset = () => { setSupplier(""); setInvoiceNo(""); setNotes(""); setLines([blankLine()]); setProblems([]); };
  const save = (status: ReceiptStatus) => {
    const r = saveReceipt({ supplier, invoiceNo, location, date, notes, lines: toInputs(lines) }, status, rx.dispenses, today);
    if (!r.ok) { setProblems(r.errors); return; }
    reset();
    pushToast({
      tone: "ok",
      text: status === "Posted" ? `Goods receipt ${r.value.number} posted.` : `Goods receipt ${r.value.number} saved as a draft.`,
      detail: status === "Posted" ? `${r.value.lines.length} batch${r.value.lines.length === 1 ? "" : "es"} added to ${r.value.location}.` : "A draft adds no stock until it is posted.",
    });
  };
  const post = (id: string) => {
    const r = postReceipt(id, rx.dispenses, today);
    if (!r.ok) { pushToast({ tone: "warn", text: "The receipt was not posted.", detail: r.errors.join(" ") }); return; }
    pushToast({ tone: "ok", text: `Goods receipt ${r.value.number} posted.`, detail: `Stock added to ${r.value.location}.` });
  };
  const remove = (id: string) => {
    const r = deleteDraftReceipt(id);
    if (!r.ok) pushToast({ tone: "warn", text: r.errors[0] });
    else pushToast({ tone: "ok", text: "Draft receipt removed." });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="New Goods Receipt" subtitle="Medicine received from a supplier. Posting the receipt adds each line as a batch in the receiving location." />
        <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Supplier" required>
            <Select value={supplier} disabled={!allowed} onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Choose a supplier</option>
              {SUPPLIERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Supplier Invoice Number" required><Input placeholder="Invoice or delivery note" value={invoiceNo} disabled={!allowed} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
          <Field label="Receiving Location" required>
            <Select value={location} disabled={!allowed} onChange={(e) => setLocation(e.target.value)}>
              {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Receipt Date" required><Input type="date" value={date} disabled={!allowed} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Notes" className="sm:col-span-2 lg:col-span-4"><Input placeholder="Optional note" value={notes} disabled={!allowed} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <StockLinesEditor lines={lines} onChange={setLines} disabled={!allowed} />
        <Problems items={problems} />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-4 py-3">
          {!allowed && <span className="text-sm text-muted-foreground">{NO_RIGHTS}</span>}
          <Button onClick={reset} disabled={!allowed}>Clear</Button>
          <Button onClick={() => save("Draft")} disabled={!allowed}><IconDeviceFloppy className="size-4" /> Save As Draft</Button>
          <Button variant="primary" onClick={() => save("Posted")} disabled={!allowed}><IconSend className="size-4" /> Post Receipt</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Goods Receipts" subtitle="Newest first. The receipt number is given when it is saved." />
        <Table>
          <thead><tr><Th>Receipt Number</Th><Th>Date</Th><Th>Supplier</Th><Th>Invoice</Th><Th>Location</Th><Th className="text-right">Items</Th><Th className="text-right">Value</Th><Th>Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {stock.receipts.length === 0 && <tr><Td colSpan={9}><Empty>No goods received yet.</Empty></Td></tr>}
            {[...stock.receipts].reverse().map((r) => (
              <tr key={r.id} className="hover:bg-muted/40">
                <Td className="font-mono text-xs">{r.number}</Td>
                <Td className="whitespace-nowrap">{fmtExpiry(r.date)}</Td>
                <Td>{r.supplier}</Td>
                <Td className="font-mono text-xs">{r.invoiceNo}</Td>
                <Td className="whitespace-nowrap">{r.location}</Td>
                <Td className="text-right">{r.lines.length}</Td>
                <Td className="text-right"><Sar value={receiptValue(r)} /></Td>
                <Td><Badge tone={r.status === "Posted" ? "ok" : "neutral"}>{r.status}</Badge></Td>
                <Td>
                  {r.status === "Draft" ? (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => post(r.id)} disabled={!allowed}>Post</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(r.id)} disabled={!allowed} aria-label={`Remove draft ${r.number}`} title="Remove Draft"><IconTrash className="size-4" /></Button>
                    </div>
                  ) : <span className="text-xs text-muted-foreground">Posted {r.postedAt ? fmtExpiry(r.postedAt) : ""}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
