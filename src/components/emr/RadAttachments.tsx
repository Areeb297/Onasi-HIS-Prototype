import * as React from "react";
import { FileText, Image as ImageIcon, Paperclip, Printer, X } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { Button, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { RadOrder } from "@/lib/fhir/types";
import type { Patient } from "@/lib/model";
import { MAX_IMAGES, addImages, attachmentsOf, fmtSize, previewOf, printCountOf, removeFile, setPdf, setPreview, useRadExtras } from "@/lib/rad-extras";
import { printRadReport } from "@/lib/rad-print";
import { can } from "@/lib/session";

/** The files on a report, as a read-only list. Used in the chart and under a signed report. */
export function RadAttachmentList({ order }: { order: RadOrder }) {
  const extras = useRadExtras();
  const att = attachmentsOf(order, extras);
  if (!att.images.length && !att.pdf) return null;
  return (
    <div className="text-xs text-foreground">
      <span className="font-semibold">Attachments:</span>{" "}
      {att.images.length > 0 && <span>{att.images.length} {att.images.length === 1 ? "image" : "images"} ({att.images.map((i) => i.name).join(", ")})</span>}
      {att.images.length > 0 && att.pdf && "; "}
      {att.pdf && <span>PDF ({att.pdf.name})</span>}
    </div>
  );
}

/** Up to 10 images and one PDF for the report. Only the names are kept, so the files are not stored. */
export function RadAttachments({ order, editable }: { order: RadOrder; editable: boolean }) {
  const extras = useRadExtras();
  const dev = useDevMode();
  const att = attachmentsOf(order, extras);
  const [problems, setProblems] = React.useState<string[]>([]);
  const imgInput = React.useRef<HTMLInputElement>(null);
  const pdfInput = React.useRef<HTMLInputElement>(null);
  const canWrite = can("rad.report") && editable;

  function pickImages(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    const res = addImages(order, files);
    res.added.forEach((rec) => {
      const file = files.find((f) => f.name === rec.name && f.size === rec.size);
      if (file && typeof URL !== "undefined") setPreview(rec.id, URL.createObjectURL(file));
    });
    setProblems(res.problems);
    if (imgInput.current) imgInput.current.value = "";
  }

  function pickPdf(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const res = setPdf(order, file);
    setProblems(res.problems);
    if (pdfInput.current) pdfInput.current.value = "";
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip className="size-4" aria-hidden="true" />Images And PDF</h3>
        <div className="flex flex-wrap gap-2">
          <Gate allowed={canWrite} reason={editable ? "Your role cannot attach files to a report." : "A signed report cannot take new files."}>
            <Button size="sm" disabled={!canWrite || att.images.length >= MAX_IMAGES} onClick={() => imgInput.current?.click()}>
              <ImageIcon className="size-4" />Add Images
            </Button>
          </Gate>
          <Gate allowed={canWrite} reason={editable ? "Your role cannot attach files to a report." : "A signed report cannot take new files."}>
            <Button size="sm" disabled={!canWrite} onClick={() => pdfInput.current?.click()}>
              <FileText className="size-4" />{att.pdf ? "Replace PDF" : "Choose PDF"}
            </Button>
          </Gate>
        </div>
      </div>
      <input ref={imgInput} type="file" accept="image/png,image/jpeg" multiple className="sr-only" aria-label="Choose images" tabIndex={-1} onChange={(e) => pickImages(e.target.files)} />
      <input ref={pdfInput} type="file" accept="application/pdf" className="sr-only" aria-label="Choose PDF" tabIndex={-1} onChange={(e) => pickPdf(e.target.files)} />

      <p className="text-xs text-muted-foreground">Add up to {MAX_IMAGES} images (PNG or JPG) and one PDF. Only the file names are kept in this app. The files are not stored and are not sent to NPHIES.</p>

      <div>
        <div className="mb-1 text-xs font-medium">Images ({att.images.length} of {MAX_IMAGES})</div>
        {att.images.length === 0 ? (
          <p className="text-xs text-muted-foreground">No images added yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {att.images.map((f) => {
              const url = previewOf(f.id);
              return (
                <li key={f.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
                  {url ? <img src={url} alt="" className="size-10 shrink-0 rounded object-cover" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted"><ImageIcon className="size-4 text-muted-foreground" aria-hidden="true" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={f.name}>{f.name}</span>
                    <span className="text-muted-foreground">{fmtSize(f.size)}{dev && ` · ${f.id}`}</span>
                  </span>
                  {canWrite && (
                    <Button size="sm" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => removeFile(order, f.id)}><X className="size-4" /></Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium">Result PDF</div>
        {att.pdf ? (
          <div className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium" title={att.pdf.name}>{att.pdf.name} <span className="font-normal text-muted-foreground">{fmtSize(att.pdf.size)}</span></span>
            {canWrite && <Button size="sm" variant="ghost" aria-label={`Remove ${att.pdf.name}`} onClick={() => removeFile(order, att.pdf!.id)}><X className="size-4" /></Button>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No PDF added yet.</p>
        )}
      </div>

      {problems.map((p) => <p key={p} role="alert" className="text-xs text-destructive">{p}</p>)}
    </div>
  );
}

/** Prints the report as a page. A report that is not signed prints with a Draft mark. */
export function RadPrintButton({ order, patient, size = "sm" }: { order: RadOrder; patient: Patient | undefined; size?: "sm" | "md" }) {
  const extras = useRadExtras();
  const [msg, setMsg] = React.useState("");
  const ready = !!patient && !!order.report && order.report.findings.trim() !== "" && order.report.impression.trim() !== "";
  const n = printCountOf(order.id, extras);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Button
        size={size}
        variant="secondary"
        disabled={!ready}
        title={ready ? "Print the report" : "Write the findings and the impression first"}
        onClick={() => setMsg(patient && printRadReport(order, patient) ? "The print window is open." : "This browser could not open the print window.")}
      >
        <Printer className={cn("size-4")} />Print Report
      </Button>
      {(msg || n > 0) && <span className="text-xs text-muted-foreground" role="status">{msg || `Printed ${n} ${n === 1 ? "time" : "times"}`}</span>}
    </span>
  );
}
