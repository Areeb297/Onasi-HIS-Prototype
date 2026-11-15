import * as React from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Select, Input, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import {
  INSURERS, REQUEST_PRIORITIES, REQUEST_TYPES, coveragesOf, eligibilityProblems, primaryCoverage, requestEligibility, sortCoverages, useCoverages,
  type EligibilityAnswer, type EligibilityRequest, type RequestPriority, type RequestType,
} from "@/lib/coverage";
import { listName } from "@/lib/registration";
import { can, currentUser, hasGlass, useSession } from "@/lib/session";
import { nowLocal, useHis } from "@/lib/store";
import { useDevMode } from "@/lib/devmode";

const dateText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** Eligible or Not Eligible with the date of the answer. "None" when the payer was never asked. */
export function EligibilityBadge({ answer, className }: { answer?: EligibilityAnswer; className?: string }) {
  if (!answer) return <span className={cn("text-xs text-muted-foreground", className)}>None</span>;
  const warn = answer.eligible && answer.kind !== "covered";
  return (
    <span className={cn("inline-flex flex-col items-start gap-0.5", className)} title={`${answer.title}. ${answer.text}`}>
      <Badge tone={answer.eligible ? (warn ? "warn" : "ok") : "danger"}>{answer.eligible ? "Eligible" : "Not Eligible"}</Badge>
      <span className="text-xs text-muted-foreground">{dateText(answer.at)}{answer.kind !== "covered" ? `, ${answer.title}` : ""}</span>
    </span>
  );
}

const YES_NO = (label: string, value: boolean, onChange: (v: boolean) => void) => (
  <fieldset className="min-w-0">
    <legend className="mb-1.5 text-sm font-medium">{label}</legend>
    <div className="flex gap-4 text-sm">
      {[true, false].map((v) => (
        <label key={String(v)} className="flex items-center gap-1.5">
          <input type="radio" name={label} checked={value === v} onChange={() => onChange(v)} className="size-4 accent-[var(--primary)]" />
          {v ? "Yes" : "No"}
        </label>
      ))}
    </div>
  </fieldset>
);

/** Eligibility Request: ask the payer whether the patient is covered for a service period. The answer is saved on the coverage. */
export function EligibilityDialog({ patientId, onClose }: { patientId: string | null; onClose: () => void }) {
  const state = useHis();
  const store = useCoverages();
  const dev = useDevMode();
  useSession();
  const today = nowLocal().slice(0, 10);
  const patient = state.patients.find((p) => p.id === patientId);
  const list = patientId ? sortCoverages(coveragesOf(patientId, store, state.patients)).filter((c) => c.active) : [];
  const primary = primaryCoverage(list, today);

  const initial = (): EligibilityRequest => ({
    coverageId: primary?.id ?? "", requestType: list.length ? "Validation" : "Discovery", payer: "", priority: "Normal",
    serviceStart: today, serviceEnd: today, transfer: false, newborn: !!patient?.extra?.newborn,
  });
  const [r, setR] = React.useState<EligibilityRequest>(initial);
  const [tried, setTried] = React.useState(false);
  const [answer, setAnswer] = React.useState<EligibilityAnswer | null>(null);
  const [added, setAdded] = React.useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setR(initial()); setTried(false); setAnswer(null); setAdded(false); }, [patientId]);

  if (!patientId || !patient) return null;
  const allowed = can("patient.register");
  const name = listName(patient, hasGlass(patient.id));
  const set = <K extends keyof EligibilityRequest>(k: K, v: EligibilityRequest[K]) => setR((x) => ({ ...x, [k]: v }));
  const problems = eligibilityProblems(r);
  const coverage = list.find((c) => c.id === r.coverageId);

  function send() {
    setTried(true);
    if (problems.length) return;
    const out = requestEligibility(patientId!, r, currentUser().name);
    if (!out.ok) return;
    setAnswer(out.value.answer);
    setAdded(!r.coverageId && !!out.value.coverage);
    audit("view", "Insurance eligibility request", {
      patient: name,
      detail: `${r.requestType}, ${coverage ? `${coverage.insurer || coverage.tpa} ${coverage.memberId}` : r.payer}, ${r.serviceStart} to ${r.serviceEnd}: ${out.value.answer.eligible ? "Eligible" : "Not Eligible"} (${out.value.answer.title})`,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Eligibility Request"
      subtitle={`${name}, ${patient.mrn}`}
      footer={
        <>
          <Button onClick={onClose}>{answer ? "Close" : "Cancel"}</Button>
          {!answer && <Button variant="primary" disabled={!allowed} onClick={send}>Send Request</Button>}
          {answer && <Button variant="primary" onClick={() => { setAnswer(null); setTried(false); }}>New Request</Button>}
        </>
      }
    >
      {!allowed && <p className="mb-3 text-xs text-muted-foreground">Your role cannot send eligibility requests.</p>}
      {answer ? (
        <div role="status" className={cn("rounded-lg border px-3 py-2.5 text-sm", answer.eligible ? (answer.kind === "covered" ? "border-ok/40 bg-ok/10" : "border-warn/50 bg-warn/10") : "border-destructive/50 bg-destructive/10")}>
          <div className="flex items-center gap-2 font-semibold">
            {answer.eligible && answer.kind === "covered" ? <CircleCheck className="size-4 shrink-0" /> : <TriangleAlert className="size-4 shrink-0" />}
            {answer.eligible ? "Eligible" : "Not Eligible"}: {answer.title}
          </div>
          <p className="mt-1">{answer.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">Answered {dateText(answer.at)} for {answer.serviceStart} to {answer.serviceEnd}. Saved on the coverage and shown in the patient list.</p>
          {added && <p className="mt-1 font-medium">The payer found a policy. It was added to the patient's coverages.</p>}
          {!r.coverageId && !added && <p className="mt-1">Nothing was saved, because the payer found no policy.</p>}
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <Field className="sm:col-span-2" label="Coverage" required={r.requestType !== "Discovery"} hint={list.length ? undefined : "This patient has no active coverage. Use a discovery request to ask a payer."}>
            <Select value={r.coverageId} onChange={(e) => set("coverageId", e.target.value)} aria-invalid={tried && r.requestType !== "Discovery" && !r.coverageId}>
              <option value="">{r.requestType === "Discovery" ? "None, ask the payer to find it" : "Select coverage"}</option>
              {list.map((c) => <option key={c.id} value={c.id}>Priority {c.priority} | {c.memberId} | {c.insurer || c.tpa}{c.plan ? `, ${c.plan}` : ""}</option>)}
            </Select>
          </Field>
          <Field label="Request Type" required>
            <Select value={r.requestType} onChange={(e) => set("requestType", e.target.value as RequestType)}>{REQUEST_TYPES.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <Field label="Payer" required={r.requestType === "Discovery" && !r.coverageId} hint={r.coverageId ? "Taken from the coverage." : undefined}>
            {r.coverageId
              ? <Input value={coverage?.insurer || coverage?.tpa || ""} disabled />
              : <Select value={r.payer} onChange={(e) => set("payer", e.target.value)} aria-invalid={tried && !r.payer}><option value="">Select payer</option>{INSURERS.map((x) => <option key={x}>{x}</option>)}</Select>}
          </Field>
          <Field label="Priority" required>
            <Select value={r.priority} onChange={(e) => set("priority", e.target.value as RequestPriority)}>{REQUEST_PRIORITIES.map((x) => <option key={x}>{x}</option>)}</Select>
          </Field>
          <div className="hidden sm:block" />
          <Field label="Service Start Date" required><Input type="date" value={r.serviceStart} onChange={(e) => set("serviceStart", e.target.value)} /></Field>
          <Field label="Service End Date" required><Input type="date" value={r.serviceEnd} min={r.serviceStart} onChange={(e) => set("serviceEnd", e.target.value)} /></Field>
          {YES_NO("Transfer", r.transfer, (v) => set("transfer", v))}
          {YES_NO("Newborn", r.newborn, (v) => set("newborn", v))}
          {tried && problems.length > 0 && (
            <ul role="alert" className="list-disc space-y-0.5 rounded-lg border border-destructive/50 bg-destructive/10 py-2 ps-7 pe-3 text-sm sm:col-span-2">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          {dev && <p className="text-xs text-muted-foreground sm:col-span-2">Simulated answer, worked out with the same rules as the coverage check at registration. A real HIS sends an NPHIES CoverageEligibilityRequest (financial services) with purpose discovery, validation or benefits.</p>}
        </div>
      )}
    </Dialog>
  );
}
