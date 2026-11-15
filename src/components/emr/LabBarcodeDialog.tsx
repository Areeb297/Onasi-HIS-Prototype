import * as React from "react";
import { Printer } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button } from "@/components/ui/primitives";
import { code39Svg } from "@/lib/code39";
import { SPECIMEN_TYPES } from "@/lib/fhir/lab-catalog";
import type { LabOrder } from "@/lib/fhir/types";
import { leafTests } from "@/lib/lab";
import { markLabelsPrinted, sampleOf, specimenBarcode, useLabExtras } from "@/lib/lab-extras";
import type { Patient } from "@/lib/model";
import { esc, printDocument, printableName } from "@/lib/print-doc";

interface Label {
  barcode: string;
  specimen: string;
  tests: string[];
  collectedAt: string;
}

const stamp = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** One label per specimen: the tube is what the bench scans, so the label lists every test that goes in it. */
export function labelsFor(order: LabOrder): Label[] {
  return order.specimens.map((s) => ({
    barcode: specimenBarcode(s),
    specimen: SPECIMEN_TYPES[s.key].display,
    tests: leafTests(order).filter((t) => t.specimen === s.key).map((t) => t.short),
    collectedAt: s.collectedAt,
  }));
}

const LABEL_CSS = `
@page { size: A4; margin: 8mm }
.sheet { display: flex; flex-wrap: wrap; gap: 4mm }
.label { width: 93mm; min-height: 44mm; border: 0.3mm solid #0f172a; border-radius: 2mm; padding: 3mm; page-break-inside: avoid }
.top { display: flex; justify-content: space-between; gap: 3mm; font-size: 11px }
.name { font-size: 14px; font-weight: 700 }
.mrn { font-size: 11px; color: #334155 }
.bars { margin-top: 2mm }
.bars svg { display: block; width: 100%; height: 12mm }
.code { margin-top: 1mm; text-align: center; font-family: "Courier New", monospace; font-size: 12px; letter-spacing: 1px }
.tests { margin-top: 1.5mm; font-size: 10px }
.meta { margin-top: 1mm; font-size: 9px; color: #334155 }
.risk { display: inline-block; margin-top: 1mm; padding: 0 2mm; border: 0.3mm solid #b91c1c; color: #b91c1c; font-size: 9px; font-weight: 700 }
`;

/** The labels of an order, on screen and ready to print. */
export function LabBarcodeDialog({ order, patient, onClose }: { order: LabOrder; patient: Patient; onClose: () => void }) {
  const extras = useLabExtras();
  const rec = sampleOf(order, extras);
  const labels = labelsFor(order);
  const risk = rec?.details?.risk && rec.details.risk !== "Standard Precautions" ? rec.details.risk : "";
  const care = rec?.details?.care ?? "";
  const [msg, setMsg] = React.useState("");

  function print() {
    const body = `<div class="sheet">${labels
      .map(
        (l) => `<section class="label">
          <div class="top"><div><div class="name">${esc(printableName(patient))}</div><div class="mrn">${esc(patient.mrn)} · ${esc(order.visitNumber)}</div></div><div><b>${esc(l.specimen)}</b></div></div>
          <div class="bars">${code39Svg(l.barcode, 48)}</div>
          <div class="code">${esc(l.barcode)}</div>
          <div class="tests"><b>Tests:</b> ${esc(l.tests.join(", "))}</div>
          <div class="meta">Collected ${esc(stamp(l.collectedAt))}${care ? ` · ${esc(care)}` : ""}</div>
          ${risk ? `<div class="risk">${esc(risk)}</div>` : ""}
        </section>`,
      )
      .join("")}</div>`;
    const ok = printDocument({ title: `Sample Labels ${order.id}`, css: LABEL_CSS, body });
    if (ok) {
      markLabelsPrinted(order);
      setMsg("The print window is open. Choose a printer to print the labels.");
    } else setMsg("This browser could not open the print window.");
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Sample Labels"
      subtitle={`${printableName(patient)}, ${patient.mrn}`}
      wide
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={labels.length === 0} onClick={print}>
            <Printer className="size-4" />Print Labels
          </Button>
        </>
      }
    >
      {labels.length === 0 ? (
        <p className="text-sm text-muted-foreground">There are no specimens yet. Collect the specimen first. The barcodes are made when you save the collection.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{labels.length} {labels.length === 1 ? "label" : "labels"}, one for each specimen.</span>
            {!!rec?.labelsPrinted && <Badge tone="neutral">Printed {rec.labelsPrinted} {rec.labelsPrinted === 1 ? "time" : "times"}</Badge>}
            {risk && <Badge tone="danger">{risk}</Badge>}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {labels.map((l) => (
              <li key={l.barcode} className="rounded-lg border-2 border-foreground/70 p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold">{printableName(patient)}</div>
                    <div className="text-muted-foreground">{patient.mrn} · {order.visitNumber}</div>
                  </div>
                  <div className="font-semibold">{l.specimen}</div>
                </div>
                <div className="mt-2 h-12 w-full" role="img" aria-label={`Barcode ${l.barcode}`} dangerouslySetInnerHTML={{ __html: code39Svg(l.barcode, 48) }} />
                <div className="mt-1 text-center font-mono tracking-widest">{l.barcode}</div>
                <div className="mt-1"><b>Tests:</b> {l.tests.join(", ")}</div>
                <div className="mt-0.5 text-muted-foreground">Collected {stamp(l.collectedAt)}{care && ` · ${care}`}</div>
              </li>
            ))}
          </ul>
          {msg && <p role="status" className="text-xs text-foreground">{msg}</p>}
        </div>
      )}
    </Dialog>
  );
}
