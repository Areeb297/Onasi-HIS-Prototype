import * as React from "react";
import { IconMessage2, IconShieldExclamation, IconShieldCheck } from "@tabler/icons-react";
import { AlertTriangle, CheckCircle2, CircleAlert, Plus, Trash2 } from "lucide-react";
import { ClassBadge } from "@/components/badges";
import { RowActions, type ActionKey } from "@/components/RowActions";
import { useVisitActions } from "@/components/VisitActions";
import { CodeBlock } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { quickSend } from "@/lib/actions";
import { useDevMode } from "@/lib/devmode";
import { pretty } from "@/lib/hl7";
import type { Encounter, Patient, Vitals } from "@/lib/model";
import { ALLERGY_SAMPLES, ALLERGY_TYPES, COMPLAINT_SAMPLES, DOCTORS, DX_SAMPLES, DX_TYPES, PR_SAMPLES, PR_TYPES } from "@/lib/reference-data";
import { navigate, useRoute } from "@/lib/router";
import { EVENT_BY_ID } from "@/lib/spec";
import { bedLabel, nowLocal, patientName, updateEncounter, useHis } from "@/lib/store";
import { visitMessages } from "@/lib/visitMessages";
import { visitStatus } from "@/pages/WorklistPage";
import { ChartMenu } from "@/components/ChartMenu";
import { VitalsSection } from "@/components/emr/VitalsSection";
import { ChartOverview } from "@/components/emr/ChartOverview";
import { AiBriefModal } from "@/components/ai/AiBriefModal";
import { claimReadiness, useVitals } from "@/lib/vitals";
import { EmrFormPage } from "@/components/EmrFormPage";
import { ClinicalDocsSection } from "@/components/emr/ClinicalDocsSection";
import { LabSection } from "@/components/emr/LabSection";
import { PrescriptionSection } from "@/components/emr/PrescriptionSection";
import { RadiologySection } from "@/components/emr/RadiologySection";
import { SoapSection } from "@/components/emr/SoapSection";
import { audit } from "@/lib/audit";
import { EMR_FORM_BY_ID } from "@/lib/emr-forms";
import { EMR_MENU, type NativeId } from "@/lib/emr-menu";
import { breakGlass, can, hasGlass, useSession } from "@/lib/session";

const age = (dob: string) => Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));
const doctorName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "None";
};
const when = (local?: string) =>
  local ? new Date(local).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Not yet";

const REASONS = ["Emergency treatment", "Covering for a colleague", "Patient asked me to", "Quality or safety review", "Other"];

function GlassGate({ patient }: { patient: Patient }) {
  const [reason, setReason] = React.useState(REASONS[0]);
  const [detail, setDetail] = React.useState("");
  return (
    <Card className="mx-auto mt-6 max-w-xl border-destructive/40">
      <CardHeader title="Confidential record" subtitle="Access to this patient is restricted. Break the glass only if you need it to treat or protect the patient." />
      <div className="space-y-3 p-4">
        <p className="text-sm">
          <strong>{patientName(patient)}</strong> is marked confidential. Your access will be recorded in the audit trail with your name, the time and your reason. It lasts 30 minutes.
        </p>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Details">
          <Input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Add a short note" />
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" disabled={reason === "Other" && !detail.trim()} onClick={() => breakGlass(patient.id, patientName(patient), detail ? `${reason}: ${detail}` : reason)}>
            Break The Glass And Open
          </Button>
          <Button onClick={() => navigate("/opd")}>Go Back</Button>
        </div>
      </div>
    </Card>
  );
}

const NATIVE: Record<NativeId, (p: { enc: Encounter }) => React.ReactElement> = {
  overview: OverviewTab, complaints: Complaints, vitals: VitalsSection, diagnosis: Diagnosis, prescription: PrescriptionSection,
  procedures: Procedures, allergies: Allergies, laboratory: LabSection, radiology: RadiologySection, notes: Notes,
  soap: SoapSection, documents: ClinicalDocsSection, adt: AdtMessages,
};

export function ChartPage() {
  const state = useHis();
  const route = useRoute();
  useSession();
  const { act, dialogs } = useVisitActions();
  const visit = route.params.get("visit") ?? "";
  const section = route.params.get("s") || "overview";
  const enc = state.encounters.find((e) => e.visitNumber === visit);
  const patient = enc && state.patients.find((p) => p.id === enc.patientId);
  const gated = !!patient?.confidential && !hasGlass(patient.id);

  React.useEffect(() => {
    if (enc && patient && !gated) audit("view", `Chart ${enc.visitNumber}`, { patient: patientName(patient) });
  }, [enc?.visitNumber, gated]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enc || !patient) {
    return (
      <Card>
        <Empty>
          This visit was not found. <button className="text-move underline" onClick={() => navigate("/opd")}>Go to the OPD Worklist</button>
        </Empty>
      </Card>
    );
  }
  if (!can("emr.read") && !can("patient.read")) {
    audit("denied", `Chart ${enc.visitNumber}`, { patient: patientName(patient) });
    return <Card><Empty>Your role cannot open patient charts.</Empty></Card>;
  }
  if (gated) return <GlassGate patient={patient} />;

  const go = (s: string) => navigate("/chart", { visit, s });
  const onAct = (k: ActionKey) => (k === "CHART" ? undefined : act(k, enc.visitNumber));
  const item = EMR_MENU.find((i) => i.id === section) ?? EMR_MENU[0];
  const Native = item.kind === "native" ? NATIVE[item.id as NativeId] : null;
  const formDef = item.kind === "form" ? EMR_FORM_BY_ID[item.id] : undefined;

  return (
    <div>
      <ChartHeader enc={enc} patient={patient} />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Visit actions</span>
          <RowActions enc={{ ...enc, status: enc.status }} onAct={onAct} />
          <AiBriefModal enc={enc} patient={patient} />
        </div>
        {enc.dirty && (
          <div className="flex items-center gap-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-1.5 text-xs">
            <CircleAlert className="size-4 text-warn" />
            <span>The chart changed after the last update was sent.</span>
            <Button size="sm" variant="primary" onClick={() => quickSend("A08", enc.visitNumber)}>
              Send Update
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <ChartMenu active={item.id} visit={enc.visitNumber} onPick={go} />
        <div className="min-w-0">
          {Native && <Native enc={enc} />}
          {formDef && <EmrFormPage form={formDef} enc={enc} />}
          {item.kind === "form" && !formDef && <Card><Empty>The form "{item.label}" is not defined yet.</Empty></Card>}
        </div>
      </div>
      {dialogs}
    </div>
  );
}

/* ---------- Header: patient, vitals, allergies ---------- */

/** One vital sign in large type. An abnormal value gets an icon and a word, so color is never the only signal. */
function Vital({ label, value, unit, flag }: { label: string; value?: string; unit: string; flag?: "High" | "Low" | "Check" }) {
  return (
    <div className="min-w-[76px]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("flex items-baseline gap-1 text-lg font-semibold tabular-nums", flag && "text-destructive")}>
        {flag && <AlertTriangle className="size-4 self-center" aria-hidden="true" />}
        {value ? value : <span className="text-muted-foreground">--</span>}
        {value && <span className="text-xs font-normal text-muted-foreground">{unit}</span>}
      </div>
      {flag && <div className="text-xs font-semibold text-destructive">{flag}</div>}
    </div>
  );
}

/**
 * Patient header. The identity row and the allergy band stay pinned while the chart scrolls: who the patient is,
 * and what could hurt them, must never leave the screen. Vitals sit below and scroll away.
 */
function ChartHeader({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const st = visitStatus(enc);
  const v = enc.vitals;
  const num = (s?: string) => (s ? parseFloat(s) : NaN);
  const temp = num(v?.temp), spo2 = num(v?.spo2), pulse = num(v?.pulse), rr = num(v?.rr);
  const sbp = num(v?.bp?.split("/")[0]);
  const primaryDx = enc.dx[0];
  const initials = `${patient.given[0] ?? ""}${patient.family[0] ?? ""}`;
  const sev = { SV: "severe", MO: "moderate", MI: "mild" } as const;
  return (
    <>
      <div className="sticky top-[3.4rem] z-20 overflow-hidden rounded-xl border border-border bg-card shadow-sm" role="region" aria-label="Patient header">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 border-l-4 border-l-move px-4 py-3">
          <div className="flex items-center gap-3.5">
            <span className="flex size-11 items-center justify-center rounded-full bg-move/12 text-sm font-semibold text-move" aria-hidden="true">{initials}</span>
            <div>
              <h1 className="text-lg font-semibold leading-tight">{patientName(patient)}</h1>
              <div className="text-[0.8125rem] text-muted-foreground">
                {age(patient.dob)} years · {patient.sex === "M" ? "Male" : "Female"} · Health ID <span className="font-mono">{patient.healthId}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Visit</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{enc.visitNumber}</span>
              <ClassBadge cls={enc.cls} />
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Location</div>
            <div className="text-sm font-medium">{enc.status === "active" && enc.bedId ? bedLabel(enc.bedId) : enc.cls === "I" ? "None" : "Outpatient"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Doctor</div>
            <div className="text-sm font-medium">{doctorName(enc.attending)}</div>
          </div>
          <div className="ml-auto">
            <div className="text-xs text-muted-foreground">Primary diagnosis</div>
            <div className="text-sm font-medium">{primaryDx ? `${primaryDx.code}` : "Not set"}</div>
          </div>
        </div>
        {enc.allergies.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-destructive/30 bg-destructive/10 px-4 py-2" role="alert">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <IconShieldExclamation className="size-4" stroke={2} /> Allergies
            </span>
            {enc.allergies.map((a, i) => (
              <span key={i} className="rounded-md border border-destructive/40 bg-card px-2 py-0.5 text-[0.8125rem] font-medium text-destructive">
                {a.text}
                <span className="font-normal"> · {sev[a.severity]}{a.reaction ? `, ${a.reaction}` : ""}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 border-t border-border bg-ok/8 px-4 py-1.5 text-[0.8125rem] font-medium text-ok">
            <IconShieldCheck className="size-4" stroke={2} /> No allergies recorded
          </div>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" role="region" aria-label="Latest vital signs">
        <Vital label="Blood pressure" value={v?.bp} unit="mmHg" flag={sbp < 90 ? "Low" : sbp > 180 ? "High" : undefined} />
        <Vital label="Pulse" value={v?.pulse} unit="/min" flag={pulse > 100 ? "High" : pulse < 50 ? "Low" : undefined} />
        <Vital label="Temperature" value={v?.temp} unit="°C" flag={temp >= 38 ? "High" : temp < 35.5 ? "Low" : undefined} />
        <Vital label="Oxygen" value={v?.spo2} unit="%" flag={spo2 < 94 ? "Low" : undefined} />
        <Vital label="Breathing" value={v?.rr} unit="/min" flag={rr > 24 ? "High" : rr < 10 ? "Low" : undefined} />
        <Vital label="Weight" value={v?.weight} unit="kg" />
        {!v && <span className="text-sm text-muted-foreground">No vital signs recorded yet.</span>}
      </div>
    </>
  );
}

/* ---------- Overview ---------- */

function Check({ ok, required, label, detail }: { ok: boolean; required?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : required ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
      <div>
        <div className="text-sm font-medium">
          {label} {required && <Badge tone="primary">Needed To Discharge</Badge>}
        </div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
    </li>
  );
}

function OverviewTab({ enc }: { enc: Encounter }) {
  const state = useHis();
  const patient = state.patients.find((p) => p.id === enc.patientId);
  if (!patient) return <Overview enc={enc} />;
  return <ChartOverview enc={enc} patient={patient}><Overview enc={enc} /></ChartOverview>;
}

function Overview({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  useVitals();
  const vitalsClaim = claimReadiness(enc.visitNumber);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Visit" />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-4 text-sm">
          <Info label="Visit Number" value={enc.visitNumber} mono />
          <Info label="Service" value={enc.service} />
          <Info label="Arrived" value={when(enc.admitAt ?? enc.expectedAdmitAt)} />
          <Info label="Discharged" value={when(enc.dischargeAt)} />
          <Info label="Reason" value={enc.reason || "Not entered"} />
          <Info label="Doctor" value={doctorName(enc.attending)} />
        </dl>
      </Card>
      <Card>
        <CardHeader title="What The Next ADT Message Will Carry" subtitle="Data entered in the chart goes into the messages by itself." />
        <ul className="divide-y divide-border px-4 py-1">
          <Check
            ok={enc.dx.length > 0}
            required
            label={`Diagnosis${dev ? " (DG1)" : ""}`}
            detail={enc.dx.length ? enc.dx.map((d) => d.code).join(", ") : "None yet. Add one in the Diagnosis section."}
          />
          <Check ok={enc.allergies.length > 0} label={`Allergies${dev ? " (AL1)" : ""}`} detail={enc.allergies.length ? enc.allergies.map((a) => a.text).join(", ") : "None recorded. This is optional."} />
          <Check ok={enc.pr.length > 0} label={`Procedures${dev ? " (PR1)" : ""}`} detail={enc.pr.length ? enc.pr.map((p) => p.code).join(", ") : "None recorded. This is optional."} />
          <Check ok={!!enc.reason} label={`Reason For Visit${dev ? " (PV2-3)" : ""}`} detail={enc.reason || "None entered. This is optional."} />
          <Check ok={vitalsClaim.ready === vitalsClaim.total} label={`Vital signs for the claim${dev ? " (ORU, CHI rules)" : ""}`} detail={vitalsClaim.ready === vitalsClaim.total ? "All eight vitals and the chief complaint are there." : `Missing: ${vitalsClaim.lines.filter((l) => l.state === "missing").map((l) => l.label).join(", ")}`} />
        </ul>
      </Card>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

/* ---------- Generic section table ---------- */

function SectionCard({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} tag={tag} />
      {children}
    </Card>
  );
}

function Chips({ items, onPick }: { items: { key: string; label: string }[]; onPick: (key: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <button
          key={i.key}
          onClick={() => onPick(i.key)}
          className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs transition-colors hover:border-admit hover:bg-admit/10"
        >
          <Plus className="size-3 text-admit" />
          {i.label}
        </button>
      ))}
    </div>
  );
}

function AddBar({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-3">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Remove({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label="Remove" title="Remove" className="rounded p-1 text-destructive hover:bg-destructive/10">
      <Trash2 className="size-4" />
    </button>
  );
}

function Complaints({ enc }: { enc: Encounter }) {
  const [text, setText] = React.useState("");
  const add = (code: string, t: string) =>
    updateEncounter(enc.visitNumber, (e) => {
      e.complaints = [...e.complaints, { code, text: t }];
      e.reason = e.complaints.map((c) => c.text).join("; ");
    });
  const remove = (i: number) =>
    updateEncounter(enc.visitNumber, (e) => {
      e.complaints = e.complaints.filter((_, j) => j !== i);
      e.reason = e.complaints.map((c) => c.text).join("; ");
    });
  return (
    <SectionCard title="Chief Complaints" tag="PV2-3">
      <AddBar label="Tap a complaint to add it">
        <Chips items={COMPLAINT_SAMPLES.map((c) => ({ key: c.code, label: c.text }))} onPick={(k) => { const c = COMPLAINT_SAMPLES.find((x) => x.code === k)!; add(c.code, c.text); }} />
        <div className="mt-2 flex max-w-md gap-2">
          <Input placeholder="Or type another complaint" value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={!text.trim()} onClick={() => { add("", text.trim()); setText(""); }}>Add</Button>
        </div>
      </AddBar>
      <Table>
        <thead><tr><Th>Date and Time</Th><Th>Doctor</Th><Th>Complaint</Th><Th>Status</Th><Th /></tr></thead>
        <tbody>
          {enc.complaints.length === 0 && <tr><Td colSpan={5}><Empty>No complaints yet.</Empty></Td></tr>}
          {enc.complaints.map((c, i) => (
            <tr key={i}>
              <Td className="font-mono text-xs text-muted-foreground">{when(enc.admitAt ?? enc.expectedAdmitAt)}</Td>
              <Td>{doctorName(enc.attending)}</Td>
              <Td><div className="font-medium">{c.code ? `${c.code} - ` : ""}{c.text}</div>{c.code && <div className="text-xs text-muted-foreground">Type: SNOMED CT</div>}</Td>
              <Td><Badge tone="ok">Active</Badge></Td>
              <Td className="text-right"><Remove onClick={() => remove(i)} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Diagnosis({ enc }: { enc: Encounter }) {
  const add = (code: string) => {
    const d = DX_SAMPLES.find((x) => x.code === code)!;
    updateEncounter(enc.visitNumber, (e) => { if (!e.dx.some((x) => x.code === code)) e.dx = [...e.dx, { ...d, type: enc.status === "discharged" ? "F" : d.type, at: nowLocal() }]; });
  };
  return (
    <SectionCard title="Diagnosis" tag="DG1">
      <AddBar label="Tap a diagnosis to add it (ICD-10-AM)">
        <Chips items={DX_SAMPLES.map((d) => ({ key: d.code, label: `${d.code} ${d.text}` }))} onPick={add} />
      </AddBar>
      <Table>
        <thead><tr><Th>Code</Th><Th>Description</Th><Th>Type</Th><Th>Status</Th><Th /></tr></thead>
        <tbody>
          {enc.dx.length === 0 && <tr><Td colSpan={5}><Empty>No diagnoses yet. A discharge needs at least one.</Empty></Td></tr>}
          {enc.dx.map((d, i) => (
            <tr key={d.code + i}>
              <Td className="font-mono text-xs font-semibold">{d.code}</Td>
              <Td>{d.text}</Td>
              <Td>
                <Select className="h-8 w-32" value={d.type} aria-label="Diagnosis type" onChange={(ev) => updateEncounter(enc.visitNumber, (e) => { e.dx = e.dx.map((x, j) => (j === i ? { ...x, type: ev.target.value as "A" | "W" | "F" } : x)); })}>
                  {DX_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </Select>
              </Td>
              <Td><Badge tone="ok">Active</Badge></Td>
              <Td className="text-right"><Remove onClick={() => updateEncounter(enc.visitNumber, (e) => { e.dx = e.dx.filter((_, j) => j !== i); })} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Procedures({ enc }: { enc: Encounter }) {
  return (
    <SectionCard title="Procedures" tag="PR1">
      <AddBar label="Tap a procedure to add it (ACHI)">
        <Chips
          items={PR_SAMPLES.map((p) => ({ key: p.code, label: `${p.code} ${p.text}` }))}
          onPick={(code) => { const p = PR_SAMPLES.find((x) => x.code === code)!; updateEncounter(enc.visitNumber, (e) => { if (!e.pr.some((x) => x.code === code)) e.pr = [...e.pr, { ...p, at: nowLocal() }]; }); }}
        />
      </AddBar>
      <Table>
        <thead><tr><Th>Code</Th><Th>Description</Th><Th>Started</Th><Th>Type</Th><Th>Surgeon</Th><Th /></tr></thead>
        <tbody>
          {enc.pr.length === 0 && <tr><Td colSpan={6}><Empty>No procedures yet.</Empty></Td></tr>}
          {enc.pr.map((p, i) => (
            <tr key={p.code + i}>
              <Td className="font-mono text-xs font-semibold">{p.code}</Td>
              <Td>{p.text}</Td>
              <Td>
                <Input className="h-8 w-48" type="datetime-local" value={p.at ?? ""} aria-label="Procedure start date and time" onChange={(ev) => updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.map((x, j) => (j === i ? { ...x, at: ev.target.value } : x)); })} />
              </Td>
              <Td>
                <Select className="h-8 w-32" value={p.type ?? ""} aria-label="Procedure type" onChange={(ev) => updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.map((x, j) => (j === i ? { ...x, type: (ev.target.value || undefined) as typeof x.type } : x)); })}>
                  <option value="">Not set</option>
                  {PR_TYPES.map((t) => <option key={t.code} value={t.code}>{t.short}</option>)}
                </Select>
              </Td>
              <Td>
                <Select className="h-8 w-44" value={p.surgeon ?? ""} aria-label="Surgeon" onChange={(ev) => updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.map((x, j) => (j === i ? { ...x, surgeon: ev.target.value || undefined } : x)); })}>
                  <option value="">None</option>
                  {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                </Select>
              </Td>
              <Td className="text-right"><Remove onClick={() => updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.filter((_, j) => j !== i); })} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Allergies({ enc }: { enc: Encounter }) {
  const sev = { SV: "Severe", MO: "Moderate", MI: "Mild" } as const;
  return (
    <SectionCard title="Allergies" tag="AL1">
      <AddBar label="Tap an allergy to add it">
        <Chips
          items={ALLERGY_SAMPLES.map((a) => ({ key: a.text, label: `${a.text} (${sev[a.severity]})` }))}
          onPick={(k) => { const a = ALLERGY_SAMPLES.find((x) => x.text === k)!; updateEncounter(enc.visitNumber, (e) => { if (!e.allergies.some((x) => x.text === k)) e.allergies = [...e.allergies, { ...a }]; }); }}
        />
      </AddBar>
      <Table>
        <thead><tr><Th>Allergen</Th><Th>Type</Th><Th>Severity</Th><Th>Reaction</Th><Th /></tr></thead>
        <tbody>
          {enc.allergies.length === 0 && <tr><Td colSpan={5}><Empty>No allergies recorded.</Empty></Td></tr>}
          {enc.allergies.map((a, i) => (
            <tr key={a.text + i}>
              <Td className="font-medium">{a.text}</Td>
              <Td>
                <Select className="h-8 w-24" value={a.type ?? "DALG"} aria-label="Allergy type" onChange={(ev) => updateEncounter(enc.visitNumber, (e) => { e.allergies = e.allergies.map((x, j) => (j === i ? { ...x, type: ev.target.value as typeof x.type } : x)); })}>
                  {ALLERGY_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                </Select>
              </Td>
              <Td><Badge tone={a.severity === "SV" ? "danger" : a.severity === "MO" ? "warn" : "neutral"}>{sev[a.severity]}</Badge></Td>
              <Td>{a.reaction || "None"}</Td>
              <Td className="text-right"><Remove onClick={() => updateEncounter(enc.visitNumber, (e) => { e.allergies = e.allergies.filter((_, j) => j !== i); })} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </SectionCard>
  );
}

function Notes({ enc }: { enc: Encounter }) {
  const [text, setText] = React.useState("");
  return (
    <SectionCard title="Progress Notes">
      <div className="space-y-2 border-b border-border px-4 py-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Write a note"
          aria-label="Progress note"
          className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          variant="primary"
          disabled={!text.trim()}
          onClick={() => { updateEncounter(enc.visitNumber, (e) => { e.notes = [...e.notes, { at: nowLocal(), author: doctorName(e.attending), text: text.trim() }]; }, { touch: false }); setText(""); }}
        >
          Add Note
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {enc.notes.length === 0 && <li><Empty>No notes yet. Notes are not part of the ADT message.</Empty></li>}
        {[...enc.notes].reverse().map((n, i) => (
          <li key={i} className="px-4 py-3 text-sm">
            <div className="text-xs text-muted-foreground">{n.author} · {when(n.at)}</div>
            <div className="mt-1">{n.text}</div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function AdtMessages({ enc }: { enc: Encounter }) {
  const state = useHis();
  const dev = useDevMode();
  const msgs = visitMessages(state, enc);
  const events: TimelineEvent[] = msgs.map((m) => ({
    id: String(m.seq),
    at: m.sentAt,
    actor: m.trigger,
    title: EVENT_BY_ID[m.eventId].name,
    meta: dev ? `${m.controlId}${m.errors ? `, ${m.errors} errors` : ""}${m.warnings ? `, ${m.warnings} warnings` : ""}` : undefined,
    tone: m.errors ? "danger" : m.warnings ? "warn" : "success",
    icon: m.errors ? <AlertTriangle className="size-3.5" /> : <IconMessage2 className="size-3.5" stroke={1.75} />,
    detail: dev ? <CodeBlock filename={`${m.controlId}_${m.trigger}.hl7`} code={pretty(m.message)} /> : undefined,
  }));
  return (
    <SectionCard title="ADT Messages" tag={dev ? "Event history" : undefined}>
      <div className="p-4">
        {events.length === 0 ? <Empty>No messages for this visit yet.</Empty> : <Timeline events={events} label="ADT messages for this visit" />}
      </div>
      {!dev && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Switch to Developer View to see the HL7 text of each message.</p>}
    </SectionCard>
  );
}
