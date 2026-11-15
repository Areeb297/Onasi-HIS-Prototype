import * as React from "react";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { StatusBadge } from "@/components/badges";
import { Badge, Button, Field, Select, cn } from "@/components/ui/primitives";
import { coverageLabel, coveragesOf, primaryCoverage, useCoverages } from "@/lib/coverage";
import { useDevMode } from "@/lib/devmode";
import type { Patient } from "@/lib/model";
import { mergePatients, mergeProblem, openVisits } from "@/lib/patient-merge";
import { ageLabel, listName } from "@/lib/registration";
import { can, hasGlass, useSession } from "@/lib/session";
import { nowLocal, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** One file in the side by side view. */
function FileCard({ patient, tone, label }: { patient: Patient | undefined; tone: "ok" | "danger"; label: string }) {
  const state = useHis();
  const store = useCoverages();
  if (!patient) {
    return <div className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{label}: not picked yet</div>;
  }
  const visits = state.encounters.filter((e) => e.patientId === patient.id);
  const primary = primaryCoverage(coveragesOf(patient.id, store, state.patients), nowLocal().slice(0, 10));
  const rows: [string, React.ReactNode][] = [
    ["File Number", <span className="font-mono">{patient.mrn}</span>],
    ["Health ID", <span className="font-mono">{patient.healthId || "None"}</span>],
    ["ID Number", <span className="font-mono">{patient.extra?.idNumber || patient.nationalId || "None"}</span>],
    ["Date of Birth", `${patient.dob || "Not known"}${patient.dob ? ` (${ageLabel(patient.dob)})` : ""}`],
    ["Sex", patient.sex === "M" ? "Male" : "Female"],
    ["Mobile", <span className="font-mono">{patient.extra?.mobile || "None"}</span>],
    ["Coverage", coverageLabel(primary)],
  ];
  return (
    <div className={cn("min-w-0 rounded-lg border-2 p-3", tone === "ok" ? "border-ok/50" : "border-destructive/40")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={tone}>{label}</Badge>
        {patient.confidential && <Badge tone="warn">Confidential</Badge>}
      </div>
      <div className="mt-2 text-base font-semibold">{listName(patient, hasGlass(patient.id))}</div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => <React.Fragment key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="min-w-0 break-words">{v}</dd></React.Fragment>)}
      </dl>
      <div className="mt-3 text-xs font-medium text-muted-foreground">Visits ({visits.length})</div>
      <ul className="mt-1 space-y-1 text-sm">
        {visits.length === 0 && <li className="text-muted-foreground">None</li>}
        {visits.map((e) => <li key={e.visitNumber} className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{e.visitNumber}</span><StatusBadge status={e.status} /></li>)}
      </ul>
    </div>
  );
}

/** Merge Patients: pick the file to keep and the duplicate, compare them, then move the duplicate's visits to the kept file. */
export function MergePatientsDialog({ open, onClose, keepId: initialKeep }: { open: boolean; onClose: () => void; keepId?: string }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const [keepId, setKeepId] = React.useState(initialKeep ?? "");
  const [dupId, setDupId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (open) { setKeepId(initialKeep ?? ""); setDupId(""); setReason(""); setConfirming(false); setError(""); }
  }, [open, initialKeep]);

  if (!open) return null;
  const allowed = can("patient.register");
  const files = state.patients.filter((p) => !p.mergedInto);
  const keep = files.find((p) => p.id === keepId);
  const dup = files.find((p) => p.id === dupId);
  const problem = keepId && dupId ? mergeProblem(state, keepId, dupId) : null;
  const dupVisits = dup ? state.encounters.filter((e) => e.patientId === dup.id) : [];
  const ready = !!keep && !!dup && !problem && reason.trim().length >= 5 && allowed;
  const option = (p: Patient) => (
    <option key={p.id} value={p.id}>{listName(p, hasGlass(p.id))}, {p.mrn}, born {p.dob || "not known"}{openVisits(state, p.id).length ? ", open visit" : ""}</option>
  );

  function merge() {
    const r = mergePatients(keepId, dupId, reason);
    if (!r.ok) { setError(r.message); setConfirming(false); return; }
    const n = r.outcome.moved.length;
    pushToast({
      tone: r.outcome.entries.some((e) => e.errors) ? "warn" : "ok",
      text: `Files merged. ${dup?.mrn} is now part of ${keep?.mrn}.`,
      detail: n ? `${n} visit${n === 1 ? "" : "s"} moved. ${r.outcome.entries.length} merge message${r.outcome.entries.length === 1 ? "" : "s"} (A50) saved.` : "The duplicate had no visits, so no message was needed.",
    });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Merge Patients"
      subtitle="Join two files of the same person. The duplicate's visits move to the file you keep, and the duplicate leaves the patient lists."
      footer={
        confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>Go Back</Button>
            <Button variant="danger" onClick={merge}>Yes, Merge The Files</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!ready} onClick={() => setConfirming(true)}>Prepare Merge</Button>
          </>
        )
      }
    >
      {!allowed && <p role="alert" className="mb-3 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm">Your role cannot merge patient files. Ask a registration clerk.</p>}
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
        <Field label="File To Keep" required>
          <Select value={keepId} onChange={(e) => { setKeepId(e.target.value); setConfirming(false); setError(""); }} disabled={confirming}>
            <option value="">Select</option>
            {files.filter((p) => p.id !== dupId).map(option)}
          </Select>
        </Field>
        <Field label="Duplicate File" required hint="This file is closed after the merge.">
          <Select value={dupId} onChange={(e) => { setDupId(e.target.value); setConfirming(false); setError(""); }} disabled={confirming}>
            <option value="">Select</option>
            {files.filter((p) => p.id !== keepId).map(option)}
          </Select>
        </Field>
      </div>

      <div className="mt-4 grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <FileCard patient={dup} tone="danger" label="Duplicate" />
        <div className="flex items-center justify-center text-muted-foreground"><ArrowRight className="size-5 rotate-90 sm:rotate-0" aria-hidden="true" /></div>
        <FileCard patient={keep} tone="ok" label="Keep" />
      </div>

      {problem && <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{problem}</p>}
      {error && !problem && <p role="alert" className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}

      <Field className="mt-4" label="Reason For Merge" required hint="Kept in the audit trail. For example: the same person was registered twice with a misspelled name.">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={confirming}
          rows={2}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted dark:bg-background"
        />
      </Field>

      {confirming && keep && dup && (
        <div role="alertdialog" aria-label="Confirm merge" className="mt-4 rounded-lg border border-warn/60 bg-warn/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4 shrink-0" />This cannot be undone here.</p>
          <ul className="mt-1.5 list-disc space-y-0.5 ps-5">
            <li>{dupVisits.length ? `${dupVisits.length} visit${dupVisits.length === 1 ? "" : "s"} (${dupVisits.map((e) => e.visitNumber).join(", ")}) move to ${keep.mrn}.` : "The duplicate has no visits to move."}</li>
            <li>{dup.mrn} is marked merged and leaves the patient lists.</li>
            <li>The duplicate's coverages that {keep.mrn} does not already have are added after its own.</li>
            <li>A merge message goes to the national platform for each visit that is not cancelled.</li>
          </ul>
          {dev && <p className="mt-2 text-xs text-muted-foreground">ADT A50 per visit: PID is the kept patient, MRG-1 the duplicate's Health ID, MRG-5 and PV1-19 the visit number, which does not change.</p>}
        </div>
      )}
    </Dialog>
  );
}
