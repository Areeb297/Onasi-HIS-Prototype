import * as React from "react";
import { IconBarcode, IconCheck, IconKeyboard, IconQrcode, IconX } from "@tabler/icons-react";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { fmtDate } from "@/lib/format";
import { parseGs1, parseManual, gs1Text, type Gs1 } from "@/lib/integrations/rsd-gs1";
import { STATUS_LABEL, STATUS_TONE, dispenseProblem, packKey, type Pack, type PackStatus } from "@/lib/integrations/rsd-packs";
import { DRUG_BY_ID } from "@/lib/rx-catalogue";

/**
 * Pieces of the SFDA RSD (drug track and trace) screens: the pack scan field with a typed fallback, and the pack status badge.
 * Used at goods receipt and at dispense. Simulated.
 */

export function PackStatusBadge({ status }: { status: PackStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

/** The text a scanner would send for a pack, so Simulate Scan behaves like the real thing. */
export const scanTextOf = (p: Gs1): string => gs1Text(p, "scanner");

interface ScannerProps {
  /** Called with a pack that was read and checked as a GS1 code. The screen decides what to do with it. */
  onPack: (g: Gs1) => void;
  disabled?: boolean;
  label?: string;
  hint?: string;
  /** Pack that Simulate Scan fills in. Without it the button is not shown. */
  sample?: Gs1;
  /** A message from the screen about the last pack, shown under the field. */
  message?: { ok: boolean; text: string } | null;
}

/** One field that takes a scanned GS1 DataMatrix (or pasted text), and a switch to type the four parts when the scanner cannot read the pack. */
export function PackScanner({ onPack, disabled, label = "Scan Pack", hint = "Scan the 2D code on the pack, then press Enter.", sample, message }: ScannerProps) {
  const [text, setText] = React.useState("");
  const [manual, setManual] = React.useState(false);
  const [m, setM] = React.useState({ gtin: "", serial: "", batch: "", expiry: "" });
  const [problems, setProblems] = React.useState<string[]>([]);

  const submit = (r: ReturnType<typeof parseGs1>) => {
    setProblems(r.problems);
    if (!r.ok) return;
    onPack(r.value as Gs1);
    setText("");
    if (manual) setM({ gtin: "", serial: "", batch: "", expiry: "" });
  };

  return (
    <div className="space-y-2">
      {!manual ? (
        <Field label={label} hint={hint}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Input
              className="min-w-0 flex-1 basis-64 font-mono text-xs"
              value={text}
              disabled={disabled}
              placeholder="(01)GTIN(21)Serial(17)YYMMDD(10)Batch"
              autoComplete="off"
              onChange={(e) => { setText(e.target.value); setProblems([]); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(parseGs1(text)); } }}
            />
            <Button size="sm" disabled={disabled || !text.trim()} onClick={() => submit(parseGs1(text))}><IconBarcode className="size-4" />Read Code</Button>
            {sample && (
              <Button size="sm" disabled={disabled} onClick={() => submit(parseGs1(scanTextOf(sample)))} title="Reads a pack as a scanner would">
                <IconQrcode className="size-4" />Simulate Scan
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { setManual(true); setProblems([]); }}><IconKeyboard className="size-4" />Type It Instead</Button>
          </div>
        </Field>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Type The Pack Details</span>
            <Button size="sm" variant="ghost" onClick={() => { setManual(false); setProblems([]); }}>Back To Scan</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="GTIN" required hint="14 digits"><Input className="font-mono text-xs" inputMode="numeric" value={m.gtin} disabled={disabled} onChange={(e) => setM({ ...m, gtin: e.target.value })} /></Field>
            <Field label="Serial Number" required><Input className="font-mono text-xs" value={m.serial} disabled={disabled} onChange={(e) => setM({ ...m, serial: e.target.value })} /></Field>
            <Field label="Batch" required><Input className="font-mono text-xs" value={m.batch} disabled={disabled} onChange={(e) => setM({ ...m, batch: e.target.value })} /></Field>
            <Field label="Expiry Date" required><Input type="date" value={m.expiry} disabled={disabled} onChange={(e) => setM({ ...m, expiry: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="primary" disabled={disabled} onClick={() => submit(parseManual(m))}>Use This Pack</Button>
          </div>
        </div>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      {message && <p role="status" className={message.ok ? "text-xs text-[#016D48] dark:text-[#2EF0A9]" : "text-xs text-destructive"}>{message.text}</p>}
    </div>
  );
}

/** A scanned pack: serial, batch, expiry, and why it cannot be used when it cannot. */
export function PackChip({ p, drugId, onRemove, now }: { p: Pack; drugId?: string; onRemove?: () => void; now?: Date }) {
  const bad = dispenseProblem(p, drugId, now);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-white/60 px-2.5 py-1.5 text-xs dark:bg-white/5">
      {bad ? <IconX className="size-3.5 shrink-0 text-destructive" aria-hidden="true" /> : <IconCheck className="size-3.5 shrink-0 text-[#016D48] dark:text-[#2EF0A9]" aria-hidden="true" />}
      <span className="font-mono">{p.serial}</span>
      <span className="text-muted-foreground">Batch {p.batch}, expires {fmtDate(p.expiry)}</span>
      <PackStatusBadge status={p.status} />
      {bad && <span className="basis-full text-destructive">{bad}</span>}
      {onRemove && <button type="button" className="ms-auto rounded px-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={onRemove} aria-label={`Remove pack ${p.serial}`}>Remove</button>}
    </li>
  );
}

export const drugName = (id: string): string => {
  const d = DRUG_BY_ID[id];
  return d ? `${d.generic} ${d.strengthValue} ${d.strengthUnit}` : "Unknown medicine";
};

export { packKey };
