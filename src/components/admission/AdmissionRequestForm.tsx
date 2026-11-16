import * as React from "react";
import { Send } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import {
  ACTIVITY_LEVELS, ADMISSION_SPECIALTIES, ADMISSION_TYPES, ADMITTING_DEPARTMENTS, PATIENT_CONDITIONS, SUB_DEPARTMENTS,
  createRequest, defaultAdmissionType, doctorLabel, departmentLabel, requestBlock, requestProblems, sourceVisitsOf, useAdmissionRequests, type RequestInput,
} from "@/lib/admission-requests";
import { DOCTORS } from "@/lib/reference-data";
import { currentUser, hasGlass, useSession } from "@/lib/session";
import { nowLocal, patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { DiagnosisSearch, Group, StillNeeded } from "./parts";

/** The signed-in doctor, when the user is one of the hospital's doctors. */
const myDoctorId = (): string => DOCTORS.find((d) => `Dr. ${d.given} ${d.family}` === currentUser().name)?.id ?? "";

function blank(patientId = "", visit = ""): RequestInput {
  return {
    patientId, fromVisit: visit, admittingDoctor: myDoctorId(), approvingDoctor: "", admitAt: nowLocal(), department: "", subDepartment: "",
    admissionType: "14", condition: "", activityLevel: "", expectedStayDays: "", specialty: "", dx: undefined, reason: "",
  };
}

/** Fill the parts that follow from the patient: the open visit, the admission type and the department. */
function withPatient(f: RequestInput, patientId: string, visit?: string): RequestInput {
  const visits = sourceVisitsOf(patientId);
  const enc = visits.find((e) => e.visitNumber === visit) ?? visits[0];
  const dept = enc && ADMITTING_DEPARTMENTS.some((d) => d.code === enc.service) ? enc.service : f.department;
  return {
    ...f, patientId, fromVisit: enc?.visitNumber ?? "", admissionType: defaultAdmissionType(enc?.cls), department: dept,
    subDepartment: dept === f.department ? f.subDepartment : "", reason: f.reason || enc?.reason || "",
  };
}

export function AdmissionRequestForm({ onClose, patientId, visit, onSaved }: { onClose: () => void; patientId?: string; visit?: string; onSaved?: (id: string) => void }) {
  const state = useHis();
  useAdmissionRequests();
  useSession();
  const [f, setF] = React.useState<RequestInput>(() => (patientId ? withPatient(blank(), patientId, visit) : blank()));
  const [tried, setTried] = React.useState(false);
  const set = <K extends keyof RequestInput>(k: K, v: RequestInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const problems = requestProblems(f);
  const visits = f.patientId ? sourceVisitsOf(f.patientId) : [];
  const shown = (pid: string) => {
    const p = state.patients.find((x) => x.id === pid);
    return p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
  };

  function save() {
    setTried(true);
    const res = createRequest(f);
    if (!res.ok) return;
    pushToast({ tone: "ok", text: `Admission request ${res.value.id} saved for ${shown(res.value.patientId)}.`, detail: `Pending approval by ${doctorLabel(res.value.approvingDoctor)}. No ADT message until it is approved.` });
    onSaved?.(res.value.id);
    onClose();
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="New Admission Request"
      subtitle="The request waits as Pending until the approving doctor approves it. Approval admits the patient."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Go Back</Button>
          <Button variant="primary" onClick={save} disabled={tried && problems.length > 0}><Send className="size-4" />Submit Admission Request</Button>
        </>
      }
    >
      <RequiredNote className="mb-3" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient" required className="sm:col-span-2">
          <Select value={f.patientId} onChange={(e) => setF(e.target.value ? withPatient(f, e.target.value) : { ...f, patientId: "", fromVisit: "" })}>
            <option value="">Choose a patient</option>
            {state.patients.map((p) => {
              const block = requestBlock(p.id);
              return (
                <option key={p.id} value={p.id} disabled={!!block}>
                  {shown(p.id)} ({p.mrn}){block ? ` - ${block.includes("admitted") ? "already admitted" : "request pending"}` : ""}
                </option>
              );
            })}
          </Select>
        </Field>
        <Field label="From Visit" className="sm:col-span-2" hint={f.fromVisit ? "Approval changes this visit to inpatient." : "No open visit: approval opens a new inpatient visit."}>
          <Select value={f.fromVisit ?? ""} onChange={(e) => {
            const enc = visits.find((x) => x.visitNumber === e.target.value);
            setF({ ...f, fromVisit: e.target.value, admissionType: defaultAdmissionType(enc?.cls) });
          }} disabled={!f.patientId}>
            <option value="">None (new visit on approval)</option>
            {visits.map((e) => (
              <option key={e.visitNumber} value={e.visitNumber}>
                {e.cls === "E" ? "Emergency" : "Outpatient"} visit {e.visitNumber}, {departmentLabel(e.service)}{e.reason ? `, ${e.reason}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Admitting Doctor" required>
          <Select value={f.admittingDoctor} onChange={(e) => set("admittingDoctor", e.target.value)}>
            <option value="">Choose a doctor</option>
            {DOCTORS.map((d) => <option key={d.id} value={d.id}>{doctorLabel(d.id)}</option>)}
          </Select>
        </Field>
        <Field label="Approving Doctor" required>
          <Select value={f.approvingDoctor} onChange={(e) => set("approvingDoctor", e.target.value)}>
            <option value="">Choose a doctor</option>
            {DOCTORS.map((d) => <option key={d.id} value={d.id}>{doctorLabel(d.id)}</option>)}
          </Select>
        </Field>
        <Field label="Admission Date And Time" required>
          <Input type="datetime-local" value={f.admitAt} onChange={(e) => set("admitAt", e.target.value)} />
        </Field>
        <Field label="Department" required>
          <Select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value, subDepartment: "" })}>
            <option value="">Choose a department</option>
            {ADMITTING_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label="Sub-Department">
          <Select value={f.subDepartment} onChange={(e) => set("subDepartment", e.target.value)} disabled={!f.department}>
            <option value="">{f.department ? "Choose a sub-department" : "Choose the department first"}</option>
            {(SUB_DEPARTMENTS[f.department] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Admission Type" required>
          <Select value={f.admissionType} onChange={(e) => set("admissionType", e.target.value)}>
            <option value="">Choose a type</option>
            {ADMISSION_TYPES.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </Select>
        </Field>
        <Field label="Patient Condition" required>
          <Select value={f.condition} onChange={(e) => set("condition", e.target.value)}>
            <option value="">Choose a condition</option>
            {PATIENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Activity Level">
          <Select value={f.activityLevel} onChange={(e) => set("activityLevel", e.target.value)}>
            <option value="">Choose a level</option>
            {ACTIVITY_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Expected Stay (Days)">
          <Input type="number" inputMode="numeric" min={1} max={365} value={f.expectedStayDays} onChange={(e) => set("expectedStayDays", e.target.value)} />
        </Field>
        <Field label="Admission Specialty">
          <Select value={f.specialty} onChange={(e) => set("specialty", e.target.value)}>
            <option value="">Choose a specialty</option>
            {ADMISSION_SPECIALTIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Group label="Admission Diagnosis (ICD-10-AM)" className="sm:col-span-2">
          <DiagnosisSearch value={f.dx} onChange={(d) => set("dx", d)} />
        </Group>
        <Field label="Reason" required className="sm:col-span-2">
          <Textarea rows={3} className="bg-card" value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="The clinical reason the patient needs an inpatient bed" />
        </Field>
      </div>
      {tried && <StillNeeded items={problems} />}
    </Dialog>
  );
}
