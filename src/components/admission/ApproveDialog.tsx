import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { PatientStrip } from "@/components/VisitActions";
import { Textarea } from "@/components/ui/textarea";
import { Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import {
  ACTIVITY_LEVELS, ADMISSION_TYPES, ADMITTING_DEPARTMENTS, PATIENT_CONDITIONS, RELATIONS, WARD_OF,
  approvalDefaults, approvalEvent, approvalProblems, approveRequest, doctorLabel, openSourceVisit,
  type AdmissionRequest, type ApprovalInput,
} from "@/lib/admission-requests";
import { niceDate } from "@/lib/discharge";
import { useDevMode } from "@/lib/devmode";
import { DOCTORS } from "@/lib/reference-data";
import { useSession } from "@/lib/session";
import { bedLabel, useHis } from "@/lib/store";
import { BedPicker, Group, SectionTitle, StillNeeded, WhatWillHappen } from "./parts";

const NOTE = {
  A01: "An admission message (A01) is sent to NPHIES.",
  A06: "A change-to-inpatient message (A06) is sent to NPHIES.",
  A05: "A pre-admission message (A05) is sent to NPHIES.",
} as const;

export function ApproveDialog({ request: r, onClose }: { request: AdmissionRequest; onClose: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const [a, setA] = React.useState<ApprovalInput>(() => approvalDefaults(r));
  const [errors, setErrors] = React.useState<string[]>([]);
  const set = <K extends keyof ApprovalInput>(k: K, v: ApprovalInput[K]) => { setA((x) => ({ ...x, [k]: v })); setErrors([]); };
  const patient = state.patients.find((p) => p.id === r.patientId);
  const source = openSourceVisit(r, state);
  const event = approvalEvent(r, a);
  const problems = approvalProblems(r, a);
  const insurance = patient?.extra?.insurance;
  const button = a.preAdmit ? "Approve As Pre-Admit" : "Approve And Admit";

  function confirm() {
    const res = approveRequest(r.id, a);
    if (!res.ok) return setErrors(res.errors);
    onClose();
  }

  const effects = [
    event === "A01" && (a.patientClass === "I" ? `A new inpatient visit opens in bed ${bedLabel(a.bedId)}.` : "A new outpatient (day case) visit opens. No bed is used."),
    event === "A06" && source && `${source.cls === "E" ? "Emergency" : "Outpatient"} visit ${source.visitNumber} changes to an inpatient stay in bed ${bedLabel(a.bedId)}.`,
    event === "A05" && `A pre-admission is saved for ${niceDate(a.admitAt)}.`,
    event === "A05" && (a.bedId ? `Bed ${bedLabel(a.bedId)} is held for the patient.` : "No bed is held. The bed is chosen when the patient arrives."),
    event !== "A05" && a.bedId && `Bed ${bedLabel(a.bedId)} becomes occupied.`,
    r.dx && event !== "A06" && "The admitting diagnosis is saved on the visit and goes to NPHIES with the next visit update.",
    NOTE[event],
    "The request is marked " + (a.preAdmit ? "Pre-Admitted." : "Approved."),
  ];

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Approve Admission Request"
      subtitle={dev ? `Request ${r.id}. Sends ${event}. Only a free bed, or the bed held for this patient, can be picked.` : `Request ${r.id}. Check the details, choose a bed or Pre-Admit, then approve.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Go Back</Button>
          <Button variant="primary" disabled={problems.length > 0} onClick={confirm}><CheckCircle2 className="size-4" />{button}</Button>
        </>
      }
    >
      <PatientStrip patient={patient} enc={source} />
      <dl className="mb-2 grid gap-x-4 gap-y-2 rounded-lg border border-border px-3 py-2.5 text-sm sm:grid-cols-2">
        {([
          ["Requested By", `${r.requestedBy}, ${niceDate(r.requestedAt)}`],
          ["Admitting Doctor", doctorLabel(r.admittingDoctor)],
          ["Approving Doctor", doctorLabel(r.approvingDoctor)],
          ["From Visit", source ? `${source.visitNumber} (${source.cls === "E" ? "Emergency" : "Outpatient"})` : r.fromVisit ? `${r.fromVisit} (no longer open)` : "None, a new visit opens"],
          ["Sub-Department", r.subDepartment || "None"],
          ["Specialty", r.specialty || "None"],
          ["Admission Diagnosis", r.dx ? `${r.dx.code} ${r.dx.text}` : "None"],
          ["Reason", r.reason],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className={k === "Reason" ? "sm:col-span-2" : undefined}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>

      <RequiredNote className="mb-1 mt-3" />
      <SectionTitle>Admission</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department" required>
          <Select value={a.department} onChange={(e) => set("department", e.target.value)}>
            {ADMITTING_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label={a.preAdmit ? "Expected Admission Date And Time" : "Admission Date And Time"} required hint={a.preAdmit ? undefined : "Admitting now. For a later date, tick Pre-Admit."}>
          <Input type="datetime-local" value={a.admitAt} onChange={(e) => set("admitAt", e.target.value)} />
        </Field>
        <Field label="Admission Type" required hl7="PV1-4">
          <Select value={a.admissionType} onChange={(e) => set("admissionType", e.target.value)}>
            {ADMISSION_TYPES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Patient Class" required hl7="PV1-2" hint={source ? "The open visit becomes an inpatient stay." : undefined}>
          <Select value={a.patientClass} onChange={(e) => { const cls = e.target.value as "I" | "O"; setA((x) => ({ ...x, patientClass: cls, bedId: cls === "O" && !x.preAdmit ? "" : x.bedId })); setErrors([]); }} disabled={!!source && !a.preAdmit}>
            <option value="I">Inpatient</option>
            <option value="O">Outpatient (Day Case)</option>
          </Select>
        </Field>
        <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2.5 text-sm sm:col-span-2">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={a.preAdmit} onChange={(e) => { const on = e.target.checked; setA((x) => ({ ...x, preAdmit: on, patientClass: !on && source ? "I" : x.patientClass })); setErrors([]); }} />
          <span>
            <span className="font-medium">Pre-Admit</span>
            <span className="block text-xs text-muted-foreground">Approve without admitting now. A bed can be held, or chosen when the patient arrives.</span>
          </span>
        </label>
      </div>

      {(a.patientClass === "I" || a.preAdmit) && (
        <>
          <SectionTitle>Bed</SectionTitle>
          <Group label={a.preAdmit ? "Bed To Hold" : "Bed"} required={!a.preAdmit} hint={a.preAdmit ? "Optional for a pre-admission." : undefined}>
            <BedPicker
              value={a.bedId}
              onPick={(b) => set("bedId", b)}
              patientId={r.patientId}
              visit={a.preAdmit ? undefined : source?.visitNumber}
              ward={WARD_OF[a.department]}
              allowNone={a.preAdmit}
            />
          </Group>
        </>
      )}

      <SectionTitle>More Details</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Consulting Doctor" hl7="PV1-9">
          <Select value={a.consulting} onChange={(e) => set("consulting", e.target.value)}>
            <option value="">None</option>
            {DOCTORS.map((d) => <option key={d.id} value={d.id}>{doctorLabel(d.id)}</option>)}
          </Select>
        </Field>
        <Field label="Plan" hint={a.plan === "Insurance" ? (insurance ? `${insurance.payer}, policy ${insurance.policyNo}, ${insurance.status.toLowerCase()}` : "No insurance on the patient file. Check it at registration.") : undefined}>
          <Select value={a.plan} onChange={(e) => set("plan", e.target.value as ApprovalInput["plan"])}>
            <option value="Insurance">Insurance</option>
            <option value="Cash">Cash</option>
          </Select>
        </Field>
        <Field label="Expected Days">
          <Input type="number" inputMode="numeric" min={1} max={365} value={a.expectedDays} onChange={(e) => set("expectedDays", e.target.value)} />
        </Field>
        <Field label="Activity Level">
          <Select value={a.activityLevel} onChange={(e) => set("activityLevel", e.target.value)}>
            <option value="">Choose a level</option>
            {ACTIVITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Patient Condition">
          <Select value={a.condition} onChange={(e) => set("condition", e.target.value)}>
            <option value="">Choose a condition</option>
            {PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Attendant Name">
          <Input value={a.attendantName} onChange={(e) => set("attendantName", e.target.value)} placeholder="Name" />
        </Field>
        <Field label="Contact Number">
          <Input type="tel" inputMode="tel" value={a.attendantPhone} onChange={(e) => set("attendantPhone", e.target.value)} placeholder="05XXXXXXXX" />
        </Field>
        <Field label="Relation">
          <Select value={a.attendantRelation} onChange={(e) => set("attendantRelation", e.target.value)}>
            <option value="">Choose a relation</option>
            {RELATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="General Notes" className="sm:col-span-2">
          <Textarea rows={2} className="bg-card" value={a.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Additional notes" />
        </Field>
      </div>

      {problems.length === 0 ? <WhatWillHappen items={effects} /> : <StillNeeded items={problems} />}
      {errors.length > 0 && <StillNeeded items={errors} />}
    </Dialog>
  );
}
