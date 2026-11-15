import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { PatientIdStrip } from "@/components/emr/PatientIdStrip";
import { Badge, Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { SPECIMEN_TYPES } from "@/lib/fhir/lab-catalog";
import type { LabOrder } from "@/lib/fhir/types";
import { collectSpecimens, getOrder, leafTests } from "@/lib/lab";
import {
  COLLECTION_METHODS, SAMPLE_CARE, SPECIMEN_RISKS, SPECIMEN_SOURCES, defaultSampleDetails, recordSampleDetails, sampleOf, specimenBarcode, useLabExtras,
  type SampleDetails,
} from "@/lib/lab-extras";
import type { Patient } from "@/lib/model";
import { toLocalInput } from "@/lib/store";

/** The tests that go in each specimen, in catalogue order. */
function testsBySpecimen(order: LabOrder): { key: keyof typeof SPECIMEN_TYPES; tests: string[] }[] {
  const map = new Map<keyof typeof SPECIMEN_TYPES, string[]>();
  for (const t of leafTests(order)) map.set(t.specimen, [...(map.get(t.specimen) ?? []), t.short]);
  return [...map.entries()].map(([key, tests]) => ({ key, tests }));
}

/**
 * Collect the specimen: when, how, where from, how to look after it and any risk. Saving creates the specimens and their
 * barcodes. With mode "edit" the details of a sample that was already collected can be changed.
 */
export function LabSampleDialog({
  order, patient, mode, onClose, onDone,
}: { order: LabOrder; patient: Patient; mode: "collect" | "edit"; onClose: () => void; onDone?: () => void }) {
  const dev = useDevMode();
  const extras = useLabExtras();
  const groups = testsBySpecimen(order);
  const saved = sampleOf(order, extras)?.details;
  const [at, setAt] = React.useState(() => toLocalInput(new Date()));
  const [d, setD] = React.useState<SampleDetails>(() => saved ?? defaultSampleDetails(groups.map((g) => g.key)));
  const set = (k: keyof SampleDetails) => (e: React.ChangeEvent<HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const opts = (list: string[], current: string) => (list.includes(current) || !current ? list : [current, ...list]);

  function save() {
    if (mode === "collect") {
      if (!at) return;
      if (!collectSpecimens(order.id, new Date(at).toISOString())) return;
    }
    const fresh = getOrder(order.id);
    if (fresh && recordSampleDetails(fresh, d)) {
      onDone?.();
      onClose();
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "collect" ? "Collect Specimen" : "Sample Details"}
      subtitle={groups.flatMap((g) => g.tests).join(", ")}
      wide
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={mode === "collect" && !at} onClick={save}>{mode === "collect" ? "Confirm Collection" : "Save Details"}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <PatientIdStrip patient={patient} visitNumber={order.visitNumber} />
        <RequiredNote />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">Specimens ({groups.length})</div>
          <ul className="space-y-1.5">
            {groups.map((g) => {
              const sp = order.specimens.find((s) => s.key === g.key);
              return (
                <li key={g.key} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{SPECIMEN_TYPES[g.key].display}</span>
                    {dev && <span className="font-mono text-xs text-muted-foreground">SNOMED CT {SPECIMEN_TYPES[g.key].code}</span>}
                    {sp ? <Badge tone="ok">Barcode {specimenBarcode(sp)}</Badge> : <Badge tone="neutral">Barcode is made when you save</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{g.tests.join(", ")}</div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {mode === "collect" && (
            <Field label="Collected At" required hl7={dev ? "Specimen.collection.collectedDateTime" : undefined}>
              <Input type="datetime-local" value={at} aria-required="true" onChange={(e) => setAt(e.target.value)} />
            </Field>
          )}
          <Field label="Collection Method" hl7={dev ? "Specimen.collection.method (HIS only)" : undefined}>
            <Select value={d.method} onChange={set("method")}>{opts(COLLECTION_METHODS, d.method).map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label="Specimen Source" hl7={dev ? "Specimen.collection.bodySite (HIS only)" : undefined}>
            <Select value={d.source} onChange={set("source")}>{opts(SPECIMEN_SOURCES, d.source).map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label="Sample Care">
            <Select value={d.care} onChange={set("care")}>{opts(SAMPLE_CARE, d.care).map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label="Specimen Risk">
            <Select value={d.risk} onChange={set("risk")}>{opts(SPECIMEN_RISKS, d.risk).map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
        </div>
        {d.risk !== "Standard Precautions" && (
          <p role="status" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
            This sample is marked {d.risk}. The label prints the risk so the bench handles it with care.
          </p>
        )}
      </div>
    </Dialog>
  );
}
