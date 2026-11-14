import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { Patient } from "@/lib/model";
import { hasGlass } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";

const SEVERITY = { SV: "Severe", MO: "Moderate", MI: "Mild" } as const;

export function ageYears(dob: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(dob).getTime()) / (365.25 * 86_400_000)));
}

/**
 * Who the patient is, for the top of a dialog: name, MRN, age and sex, and the allergies of the visit.
 * Every laboratory and radiology dialog shows this, so nobody acts on the wrong patient.
 */
export function PatientIdStrip({ patient, visitNumber }: { patient: Patient; visitNumber?: string }) {
  const his = useHis();
  const enc = visitNumber ? his.encounters.find((e) => e.visitNumber === visitNumber) : undefined;
  const allergies = (enc?.allergies ?? []).filter((a) => a.text);
  const masked = !!patient.confidential && !hasGlass(patient.id);
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2" role="group" aria-label="Patient">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-sm font-semibold">{masked ? "Confidential patient" : patientName(patient)}</span>
        <span className="text-xs text-foreground">MRN <span className="font-mono">{patient.mrn}</span></span>
        <span className="text-xs text-foreground">
          {ageYears(patient.dob)} years, {patient.sex === "M" ? "Male" : "Female"}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
        {!enc ? (
          <span className="text-muted-foreground">Allergies: visit not found</span>
        ) : allergies.length ? (
          <>
            <span className="flex items-center gap-1 font-semibold text-destructive">
              <ShieldAlert className="size-4" aria-hidden="true" /> Allergies
            </span>
            {allergies.map((a, i) => (
              <Badge key={i} tone="danger">
                {a.text}, {SEVERITY[a.severity]}
              </Badge>
            ))}
          </>
        ) : (
          <span className="flex items-center gap-1 font-medium text-ok">
            <ShieldCheck className="size-4" aria-hidden="true" /> No allergies recorded
          </span>
        )}
      </div>
    </div>
  );
}
