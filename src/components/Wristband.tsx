import * as React from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import type { Patient } from "@/lib/model";
import { ageLabel, arabicName, flagViews } from "@/lib/registration";
import { hijri } from "@/lib/registry";
import { patientName, useHis } from "@/lib/store";

/** Allergies recorded on any visit of the patient that was not cancelled, each named once. */
function allergyNames(patientId: string, encounters: ReturnType<typeof useHis>["encounters"]): string[] {
  const seen = new Set<string>();
  for (const e of encounters) {
    if (e.patientId !== patientId || e.status === "cancelled") continue;
    for (const a of e.allergies) if (a.text.trim()) seen.add(a.text.trim());
  }
  return [...seen];
}

/*
 * Print rules for the wristband only. While the print view is open, everything else on the page is left out of the print.
 * Paper is white, so the band prints in black whatever the screen theme is.
 */
const PRINT_CSS = `
@media screen { .wristband-print { display: none; } }
@media print {
  body > *:not(.wristband-print) { display: none !important; }
  .wristband-print { display: block; color: black; background: white; padding: 8mm; font-family: "IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif; }
  .wristband-print .wb-band { border: 1pt solid black; border-radius: 3mm; padding: 4mm 6mm; max-width: 180mm; }
  .wristband-print .wb-name { font-size: 16pt; font-weight: 700; }
  .wristband-print .wb-name-ar { font-size: 14pt; font-weight: 600; }
  .wristband-print .wb-row { display: flex; flex-wrap: wrap; gap: 2mm 8mm; margin-top: 2mm; font-size: 11pt; }
  .wristband-print .wb-mrn { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 14pt; font-weight: 700; letter-spacing: 0.06em; }
  .wristband-print .wb-alert { margin-top: 2mm; font-size: 11pt; font-weight: 700; }
}
`;

function Band({ patient, allergies }: { patient: Patient; allergies: string[] }) {
  const flags = flagViews(patient.extra?.flags);
  const ar = arabicName(patient);
  return (
    <div className="wb-band">
      <div className="wb-name">{patientName(patient)}</div>
      {ar && <div className="wb-name-ar" dir="rtl" lang="ar">{ar}</div>}
      <div className="wb-row">
        <span>MRN <span className="wb-mrn">{patient.mrn}</span></span>
        <span>Date of birth {patient.dob} ({hijri(patient.dob)} Hijri)</span>
        <span>{patient.sex === "M" ? "Male" : "Female"}</span>
      </div>
      <div className="wb-alert">Allergies: {allergies.length ? allergies.join(", ") : "None recorded"}</div>
      {flags.length > 0 && <div className="wb-alert">Flags: {flags.map((f) => f.label).join(", ")}</div>}
    </div>
  );
}

/** Wristband print view: name, MRN, date of birth, allergies and flags. Opens the browser print window. */
export function WristbandDialog({ patientId, onClose }: { patientId: string | null; onClose: () => void }) {
  const state = useHis();
  const patient = patientId ? state.patients.find((p) => p.id === patientId) : undefined;
  if (!patient) return null;
  const allergies = allergyNames(patient.id, state.encounters);
  const flags = flagViews(patient.extra?.flags);
  const ar = arabicName(patient);

  function print() {
    audit("export", "Wristband printed", { patient: patientName(patient), detail: patient!.mrn });
    window.print();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Print Wristband"
      subtitle="Check the details with the patient before you put the band on."
      wide
      footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" onClick={print}><Printer className="size-4" />Print</Button></>}
    >
      <div className="rounded-xl border-2 border-foreground/70 bg-card px-4 py-3" aria-label="Wristband preview">
        <div className="text-lg font-semibold leading-tight">{patientName(patient)}</div>
        {ar && <div className="text-base font-medium" dir="rtl" lang="ar">{ar}</div>}
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">MRN</dt><dd className="font-mono text-base font-semibold">{patient.mrn}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Date of Birth</dt><dd>{patient.dob} <span className="text-muted-foreground">({ageLabel(patient.dob)})</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Sex</dt><dd>{patient.sex === "M" ? "Male" : "Female"}</dd></div>
        </dl>
        <p className="mt-2 text-sm"><span className="font-semibold">Allergies:</span> {allergies.length ? allergies.join(", ") : "None recorded"}</p>
        <p className="mt-1 text-sm"><span className="font-semibold">Flags:</span> {flags.length ? flags.map((f) => f.label).join(", ") : "None"}</p>
      </div>
      {typeof document !== "undefined" && createPortal(
        <div className="wristband-print">
          <style>{PRINT_CSS}</style>
          <Band patient={patient} allergies={allergies} />
        </div>,
        document.body,
      )}
    </Dialog>
  );
}
