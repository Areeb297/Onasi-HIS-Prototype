import { Flag, ShieldAlert, ShieldCheck } from "lucide-react";
import { ClassBadge, StatusBadge } from "@/components/badges";
import { Badge, cn } from "@/components/ui/primitives";
import type { Allergy, Encounter, Patient } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { ageLabel, arabicName, flagViews } from "@/lib/registration";
import { bedLabel, patientName } from "@/lib/store";

const SEVERITY = { SV: "Severe", MO: "Moderate", MI: "Mild" } as const;

/** The Arabic name of the patient, right to left. Shows nothing when no Arabic name is on file. */
export function PatientNameAr({ patient, className }: { patient: Patient; className?: string }) {
  const ar = arabicName(patient);
  if (!ar) return null;
  // The words read right to left, and the line stays on the same side as the English name above it.
  return <div lang="ar" className={cn("text-sm text-muted-foreground", className)}><bdi dir="rtl">{ar}</bdi></div>;
}

/**
 * Safety flags set at registration (Do Not Resuscitate, Isolation, Fall Risk, Needs Interpreter) as labelled badges.
 * Use it on any row or card that shows a patient. Shows nothing when the patient has no flags.
 */
export function PatientFlagBadges({ patient, detail, className }: { patient: Patient | undefined; detail?: boolean; className?: string }) {
  const flags = flagViews(patient?.extra?.flags);
  if (!flags.length) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)} aria-label="Patient flags">
      {flags.map((f) => (
        <Badge key={f.id} tone={f.tone} className="whitespace-normal leading-tight">
          {f.label}{detail && f.detail ? ` (${f.detail})` : ""}
        </Badge>
      ))}
    </span>
  );
}

/**
 * Patient banner, the strip that stays at the top of every chart in a HIS.
 * Identity on the left, visit in the middle, allergies in red so they are never missed.
 */
export function PatientBanner({ patient, encounter, allergies }: { patient: Patient; encounter?: Encounter; allergies: Allergy[] }) {
  const doctor = encounter && DOCTORS.find((d) => d.id === encounter.attending);
  const initials = `${patient.given[0] ?? ""}${patient.family[0] ?? ""}`;
  const flags = flagViews(patient.extra?.flags).length > 0;
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-border bg-card" role="region" aria-label="Patient banner">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-l-4 border-l-admit px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-admit/15 text-sm font-semibold text-admit">{initials}</span>
          <div>
            <div className="text-base font-semibold leading-tight">{patientName(patient)}</div>
            <PatientNameAr patient={patient} className="text-start leading-tight" />
            <div className="text-xs text-muted-foreground">
              {ageLabel(patient.dob) || "Age not known"} · {patient.sex === "M" ? "Male" : "Female"} · DOB {patient.dob}
            </div>
          </div>
        </div>
        <Item label="MRN" value={patient.mrn} mono />
        <Item label="National ID" value={patient.nationalId} mono />
        {encounter && (
          <>
            <Item label="Visit" value={encounter.visitNumber} mono />
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <span className="flex gap-1.5">
                <ClassBadge cls={encounter.cls} />
                <StatusBadge status={encounter.status} />
              </span>
            </div>
            <Item label="Location" value={encounter.status === "active" ? bedLabel(encounter.bedId) : "None"} />
            {doctor && <Item label="Attending" value={`Dr. ${doctor.given} ${doctor.family}`} />}
          </>
        )}
      </div>
      {flags && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2 text-xs">
          <span className="flex items-center gap-1 font-semibold text-foreground">
            <Flag className="size-4" /> Flags
          </span>
          <PatientFlagBadges patient={patient} detail />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-4 py-2 text-xs">
        {allergies.length ? (
          <>
            <span className="flex items-center gap-1 font-semibold text-destructive">
              <ShieldAlert className="size-4" /> Allergies
            </span>
            {allergies.filter((a) => a.text).map((a, i) => (
              <Badge key={i} tone="danger">
                {a.text}, {SEVERITY[a.severity]}
                {a.reaction ? `, ${a.reaction}` : ""}
              </Badge>
            ))}
          </>
        ) : (
          <span className="flex items-center gap-1 font-medium text-ok">
            <ShieldCheck className="size-4" /> No allergies recorded
          </span>
        )}
      </div>
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</span>
    </div>
  );
}
