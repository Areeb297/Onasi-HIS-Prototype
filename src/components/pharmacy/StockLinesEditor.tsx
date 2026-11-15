import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button, Input, Select, Table, Td, Th } from "@/components/ui/primitives";
import type { StockLineInput } from "@/lib/pharmacy-stock";
import { DRUGS, DRUG_BY_ID } from "@/lib/rx-catalogue";

/** One line as typed, before it is turned into numbers. */
export interface LineDraft {
  key: number;
  drugId: string;
  lot: string;
  expiry: string;
  quantity: string;
  unitCost: string;
}

let nextKey = 1;
export const blankLine = (): LineDraft => ({ key: nextKey++, drugId: "", lot: "", expiry: "", quantity: "", unitCost: "" });

export function toInputs(lines: LineDraft[]): StockLineInput[] {
  return lines.map((l) => ({
    drugId: l.drugId,
    lot: l.lot,
    expiry: l.expiry,
    quantity: l.quantity.trim() === "" ? NaN : Number(l.quantity),
    unitCost: l.unitCost.trim() === "" ? undefined : Number(l.unitCost),
  }));
}

const drugLabel = (id: string) => {
  const d = DRUG_BY_ID[id];
  return d ? `${d.generic} ${d.strengthValue} ${d.strengthUnit} (${d.brand})` : "";
};

/** Item lines of an opening stock entry or a goods receipt: item, batch, expiry, quantity and unit cost. */
export function StockLinesEditor({ lines, onChange, disabled }: { lines: LineDraft[]; onChange: (next: LineDraft[]) => void; disabled?: boolean }) {
  const set = (key: number, patch: Partial<LineDraft>) => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th className="min-w-56">Item</Th>
            <Th className="min-w-32">Batch (Lot)</Th>
            <Th className="min-w-36">Expiry Date</Th>
            <Th className="min-w-28">Quantity</Th>
            <Th className="min-w-28">Unit Cost (SAR)</Th>
            <Th><span className="sr-only">Remove</span></Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const d = DRUG_BY_ID[l.drugId];
            const n = i + 1;
            return (
              <tr key={l.key}>
                <Td>
                  <Select aria-label={`Line ${n} item`} value={l.drugId} disabled={disabled} onChange={(e) => set(l.key, { drugId: e.target.value })}>
                    <option value="">Choose an item</option>
                    {DRUGS.map((x) => <option key={x.id} value={x.id}>{drugLabel(x.id)}</option>)}
                  </Select>
                </Td>
                <Td><Input aria-label={`Line ${n} batch number`} placeholder="LOT-001" value={l.lot} disabled={disabled} onChange={(e) => set(l.key, { lot: e.target.value })} /></Td>
                <Td><Input aria-label={`Line ${n} expiry date`} type="date" value={l.expiry} disabled={disabled} onChange={(e) => set(l.key, { expiry: e.target.value })} /></Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Line ${n} quantity`} inputMode="decimal" placeholder="100" value={l.quantity} disabled={disabled} onChange={(e) => set(l.key, { quantity: e.target.value })} />
                    {d && <span className="text-xs whitespace-nowrap text-muted-foreground">{d.unit}s</span>}
                  </div>
                </Td>
                <Td><Input aria-label={`Line ${n} unit cost in SAR`} inputMode="decimal" placeholder="12.50" value={l.unitCost} disabled={disabled} onChange={(e) => set(l.key, { unitCost: e.target.value })} /></Td>
                <Td>
                  <Button size="sm" variant="ghost" disabled={disabled || lines.length === 1} onClick={() => onChange(lines.filter((x) => x.key !== l.key))} aria-label={`Remove line ${n}`} title="Remove Line">
                    <IconTrash className="size-4" />
                  </Button>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="px-4 py-3">
        <Button size="sm" disabled={disabled} onClick={() => onChange([...lines, blankLine()])}><IconPlus className="size-4" /> Add Line</Button>
      </div>
    </div>
  );
}

export function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div role="alert" className="mx-4 mb-3 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
      <p className="font-medium">Please fix the following:</p>
      <ul className="mt-1 list-disc ps-5">{items.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>
  );
}
