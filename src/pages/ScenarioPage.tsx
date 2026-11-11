import * as React from "react";
import { Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { EventBadge, GROUP_TONE } from "@/components/badges";
import { MessagePanel } from "@/components/MessagePanel";
import { PatientBanner } from "@/components/PatientBanner";
import { useDevMode } from "@/lib/devmode";
import { Badge, Button, Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import type { Allergy, Dx, Encounter, HisState, Pr, ScenarioForm } from "@/lib/model";
import { ALLERGY_SAMPLES, DISPOSITIONS, DOCTORS, DX_SAMPLES, PR_SAMPLES, SERVICES } from "@/lib/reference-data";
import { navigate, useRoute } from "@/lib/router";
import { EVENT_BY_ID, eventLabel, type EventId, type SegId } from "@/lib/spec";
import {
  bedLabel, eligible, emptyForm, formFromEncounter, formProblem, freeBeds, getState, needsExistingVisit, nowLocal,
  patientName, planMessage, send, useHis,
} from "@/lib/store";

function initialForm(state: HisState, eventId: EventId, params: URLSearchParams): ScenarioForm {
  let f = emptyForm(state, eventId);
  const encId = params.get("enc");
  const enc = encId ? state.encounters.find((e) => e.visitNumber === encId) : undefined;
  if (needsExistingVisit(eventId)) {
    if (enc && eligible(eventId, enc)) f = formFromEncounter(state, eventId, enc, f);
    else if (eventId === "A31" && enc) f = formFromEncounter(state, eventId, enc, f);
    else if (eventId === "A31" && params.get("patient")) {
      const p = state.patients.find((x) => x.id === params.get("patient"));
      if (p) Object.assign(f, { patientId: p.id, family: p.family, given: p.given, dob: p.dob, sex: p.sex });
    }
  } else {
    const pid = params.get("patient");
    if (pid) f.patientId = pid;
  }
  const bed = params.get("bed");
  if (bed && ["A01", "A02", "A06", "A13"].includes(eventId)) f.bedId = bed;
  return f;
}

export function ScenarioPage({ eventId }: { eventId: EventId }) {
  const state = useHis();
  const route = useRoute();
  const dev = useDevMode();
  const event = EVENT_BY_ID[eventId];

  const [form, setForm] = React.useState<ScenarioForm>(() => initialForm(state, eventId, route.params));
  const [overrides, setOverrides] = React.useState<Partial<Record<SegId, boolean>>>({});
  const [toast, setToast] = React.useState<{ id: string; errors: number } | null>(null);

  const set = <K extends keyof ScenarioForm>(key: K, value: ScenarioForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const plan = planMessage(state, eventId, form, overrides);
  const problem = formProblem(state, eventId, form);
  const existing = needsExistingVisit(eventId);
  const needsBed = ["A01", "A02", "A06", "A13"].includes(eventId);
  const showAdmit = ["A01", "A04", "A06"].includes(eventId);
  const showDischarge = eventId === "A03" || eventId === "A08-CNHI";
  const segs = event.segments;

  const visitOptions = state.encounters
    .filter((e) => eligible(eventId, e))
    .reverse();
  const selectedEnc = state.encounters.find((e) => e.visitNumber === form.encounterId);
  const preadmits = state.encounters.filter((e) => e.status === "preadmit" && e.patientId === form.patientId);

  function pickVisit(visit: string) {
    const enc = state.encounters.find((e) => e.visitNumber === visit);
    setOverrides({});
    if (!enc) {
      setForm(emptyForm(state, eventId));
      return;
    }
    setForm(formFromEncounter(state, eventId, enc, emptyForm(state, eventId)));
  }

  function pickPreadmit(visit: string) {
    const enc = state.encounters.find((e) => e.visitNumber === visit);
    if (!enc) {
      setForm((f) => ({ ...f, encounterId: "", visitNumber: emptyForm(state, eventId).visitNumber }));
      return;
    }
    const f = formFromEncounter(state, "A01", enc, emptyForm(state, "A01"));
    f.cls = "I";
    f.bedId = "";
    f.admitAt = nowLocal();
    f.expectedAdmitAt = "";
    setForm(f);
  }

  function reset() {
    setOverrides({});
    setForm(initialForm(state, eventId, new URLSearchParams()));
    setToast(null);
  }

  function onSend() {
    const entry = send(eventId, form, { source: "user", overrides });
    setToast({ id: entry.controlId, errors: entry.errors });
    setOverrides({});
    // Read the new state straight from the store so the form shows the visit after the change.
    const s = getState();
    const enc = s.encounters.find((e) => e.visitNumber === (eventId === "A50" ? form.newVisitNumber : form.encounterId));
    if (needsExistingVisit(eventId) && enc && eligible(eventId, enc)) {
      setForm(formFromEncounter(s, eventId, enc, emptyForm(s, eventId)));
    } else {
      setForm({ ...emptyForm(s, eventId), patientId: needsExistingVisit(eventId) ? "" : form.patientId });
    }
  }

  const bannerPatient = state.patients.find((p) => p.id === form.patientId);
  const filename = `${eventLabel(eventId).replace(" ", "_")}_${plan.controlId}.hl7`;

  return (
    <div>
      <div className={`mb-5 rounded-xl border border-border bg-card p-4 border-l-4 ${HEADER_BORDER[GROUP_TONE[event.group]]}`}>
        <div className="flex flex-wrap items-center gap-2">
          <EventBadge id={eventId} className="text-xs" />
          <h1 className="text-xl font-semibold tracking-tight">{event.name}</h1>
        </div>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <Help term="Use Case" text={event.useCase} />
          <Help term="Workflow in the HIS" text={event.workflow} />
          <Help term="Purpose" text={event.purpose} />
        </dl>
        {event.pdfName && (
          <p className="mt-3 text-xs text-muted-foreground">
            The PDF calls this event "{event.pdfName}". This screen uses the Confluence name.
          </p>
        )}
        {event.note && (
          <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-foreground">{event.note}</p>
        )}
      </div>

      {bannerPatient && <PatientBanner patient={bannerPatient} encounter={selectedEnc} allergies={form.allergies} />}

      <div className={dev ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "max-w-3xl"}>
        <div className="space-y-4">
          {/* Visit and patient */}
          <Card>
            <CardHeader title={existing ? "Pick a Visit" : "Patient"} subtitle={existing ? "Only visits that this event can act on are listed." : undefined} />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {existing ? (
                <Field label="Visit" hl7="PV1-19" className="sm:col-span-2" hint={visitOptions.length === 0 ? "No visit can use this event right now. Run an earlier event first." : undefined}>
                  <Select value={form.encounterId} onChange={(e) => pickVisit(e.target.value)} aria-label="Visit">
                    <option value="">Select a visit</option>
                    {visitOptions.map((e) => (
                      <option key={e.visitNumber} value={e.visitNumber}>
                        {visitLabel(state, e)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <>
                  <Field label="Patient" hl7="PID-3">
                    <Select value={form.patientId} onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value, encounterId: "" }))} aria-label="Patient">
                      <option value="">Select a patient</option>
                      {state.patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {patientName(p)} ({p.mrn})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Visit Number" hl7="PV1-19">
                    <Input value={form.encounterId || form.visitNumber} disabled={!!form.encounterId} onChange={(e) => set("visitNumber", e.target.value)} className="font-mono" />
                  </Field>
                  {eventId === "A01" && (
                    <Field label="Start From" className="sm:col-span-2" hint="Admit a patient who was pre-admitted with A05, or start a new visit.">
                      <Select value={form.encounterId} onChange={(e) => pickPreadmit(e.target.value)} disabled={!form.patientId} aria-label="Start from">
                        <option value="">New visit</option>
                        {preadmits.map((e) => (
                          <option key={e.visitNumber} value={e.visitNumber}>
                            Pre-admit {e.visitNumber}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </>
              )}
              {selectedEnc && (
                <div className="sm:col-span-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {patientName(state.patients.find((p) => p.id === selectedEnc.patientId))} · {selectedEnc.status} ·{" "}
                  {selectedEnc.status === "active" ? bedLabel(selectedEnc.bedId) : "no bed"}
                </div>
              )}
              {eventId === "A45" && (
                <Field label="Correct Patient" hl7="PID-3, MRG-1" className="sm:col-span-2" hint="The patient who should own this visit. The PID segment carries this person. The MRG segment carries the wrong one.">
                  <Select value={form.correctPatientId} onChange={(e) => set("correctPatientId", e.target.value)} aria-label="Correct patient">
                    <option value="">Select the correct patient</option>
                    {state.patients
                      .filter((p) => p.id !== form.patientId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {patientName(p)} ({p.mrn})
                        </option>
                      ))}
                  </Select>
                </Field>
              )}
              {eventId === "A50" && (
                <>
                  <Field label="New Visit Number" hl7="PV1-19" hint="Goes in PV1-19. The old number goes in MRG-5.">
                    <Input value={form.newVisitNumber} onChange={(e) => set("newVisitNumber", e.target.value)} className="font-mono" />
                  </Field>
                  <Field label="Old Patient ID (MRG-1)" hint="Pick another patient to show an MPI de-duplication, where an old ID points to the survivor.">
                    <Select value={form.oldPatientId} onChange={(e) => set("oldPatientId", e.target.value)} aria-label="Old patient">
                      {state.patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {patientName(p)} ({p.mrn})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
            </div>
          </Card>

          {eventId === "A31" && (
            <Card>
              <CardHeader title="New Identity" subtitle="Core details of the master person record." />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Field label="Given Name" hl7="PID-5"><Input value={form.given} onChange={(e) => set("given", e.target.value)} /></Field>
                <Field label="Family Name" hl7="PID-5"><Input value={form.family} onChange={(e) => set("family", e.target.value)} /></Field>
                <Field label="Date of Birth" hl7="PID-7"><Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
                <Field label="Sex" hl7="PID-8">
                  <Select value={form.sex} onChange={(e) => set("sex", e.target.value as "M" | "F")}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </Select>
                </Field>
              </div>
            </Card>
          )}

          {/* Location and visit details */}
          {eventId !== "A31" && eventId !== "A45" && eventId !== "A50" && (
            <Card>
              <CardHeader title="Visit Details" />
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {eventId === "A04" && (
                  <Field label="Patient Class" hl7="PV1-2">
                    <Select value={form.cls} onChange={(e) => set("cls", e.target.value as ScenarioForm["cls"])}>
                      <option value="O">Outpatient</option>
                      <option value="E">Emergency</option>
                    </Select>
                  </Field>
                )}
                {needsBed && (
                  <Field label="Bed" hl7="PV1-3" hint={eventId === "A13" ? "The bed held before discharge is chosen if it is free." : undefined}>
                    <Select value={form.bedId} onChange={(e) => set("bedId", e.target.value)} aria-label="Bed">
                      <option value="">Select a bed</option>
                      {freeBeds(state, selectedEnc?.bedId).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.wardName}, Room {b.room}, Bed {b.bed}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {eventId === "A12" && (
                  <Field label="Revert To" hl7="PV1-3, PV1-6" hint="The location before the last transfer.">
                    <Input value={bedLabel(form.bedId)} disabled />
                  </Field>
                )}
                <Field label="Attending Doctor" hl7="PV1-7">
                  <Select value={form.attending} onChange={(e) => set("attending", e.target.value)}>
                    {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                  </Select>
                </Field>
                <Field label="Admitting Doctor" hl7="PV1-17">
                  <Select value={form.admitting} onChange={(e) => set("admitting", e.target.value)}>
                    {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                  </Select>
                </Field>
                {(eventId === "A04" || eventId === "A05") && (
                  <Field label="Referring Doctor" hl7="PV1-8" hint="Expected when registering or pre-registering.">
                    <Select value={form.referring} onChange={(e) => set("referring", e.target.value)}>
                      <option value="">None</option>
                      {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Hospital Service" hl7="PV1-10">
                  <Select value={form.service} onChange={(e) => set("service", e.target.value)}>
                    {SERVICES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </Select>
                </Field>
                <Field label="Reason for Visit" hl7="PV2-3">
                  <Input value={form.reason} onChange={(e) => set("reason", e.target.value)} placeholder="For example: chest pain" />
                </Field>
                {eventId === "A05" && (
                  <>
                    <Field label="Expected Admit Date" hl7="PV2-8"><Input type="datetime-local" value={form.expectedAdmitAt} onChange={(e) => set("expectedAdmitAt", e.target.value)} /></Field>
                    <Field label="Expected Discharge Date" hl7="PV2-9"><Input type="datetime-local" value={form.expectedDischargeAt} onChange={(e) => set("expectedDischargeAt", e.target.value)} /></Field>
                  </>
                )}
                {showAdmit && (
                  <Field label="Admit Date and Time" hl7="PV1-44"><Input type="datetime-local" value={form.admitAt} onChange={(e) => set("admitAt", e.target.value)} /></Field>
                )}
                {showDischarge && (
                  <Field label="Discharge Date and Time" hl7="PV1-45"><Input type="datetime-local" value={form.dischargeAt} onChange={(e) => set("dischargeAt", e.target.value)} /></Field>
                )}
                {eventId === "A03" && (
                  <Field label="Discharge Disposition" hl7="PV1-36">
                    <Select value={form.disposition} onChange={(e) => set("disposition", e.target.value)}>
                      {DISPOSITIONS.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Event Time" subtitle="When this event happened. Goes in MSH-7, EVN-2 and EVN-6." />
            <div className="p-4">
              <Field label="Event Date and Time" hl7="MSH-7, EVN-2">
                <Input type="datetime-local" value={form.eventAt} onChange={(e) => set("eventAt", e.target.value)} />
              </Field>
            </div>
          </Card>

          {eventId !== "A31" && eventId !== "A45" && eventId !== "A50" && (
            <>
              {segs.DG1 !== "-" && (
                <ListCard
                  title={segs.DG1 === "R" ? "Diagnoses (Required)" : "Diagnoses"}
                  tag="DG1" addLabel="Add Diagnosis"
                  onAdd={() => set("dx", [...form.dx, { ...DX_SAMPLES[form.dx.length % DX_SAMPLES.length] }])}
                  onAddBlank={() => set("dx", [...form.dx, { code: "", text: "", type: "W" }])}
                  empty="No diagnoses yet."
                >
                  {form.dx.map((d, i) => (
                    <DxRow key={i} d={d} onChange={(n) => set("dx", form.dx.map((x, j) => (j === i ? n : x)))} onRemove={() => set("dx", form.dx.filter((_, j) => j !== i))} />
                  ))}
                </ListCard>
              )}
              {segs.PR1 !== "-" && (
                <ListCard
                  title="Procedures"
                  tag="PR1" addLabel="Add Procedure"
                  onAdd={() => set("pr", [...form.pr, { ...PR_SAMPLES[form.pr.length % PR_SAMPLES.length] }])}
                  onAddBlank={() => set("pr", [...form.pr, { code: "", text: "" }])}
                  empty="No procedures yet."
                >
                  {form.pr.map((r, i) => (
                    <PrRow key={i} r={r} onChange={(n) => set("pr", form.pr.map((x, j) => (j === i ? n : x)))} onRemove={() => set("pr", form.pr.filter((_, j) => j !== i))} />
                  ))}
                </ListCard>
              )}
              {segs.AL1 !== "-" && (
                <ListCard
                  title="Allergies"
                  tag="AL1" addLabel="Add Allergy"
                  onAdd={() => set("allergies", [...form.allergies, { ...ALLERGY_SAMPLES[form.allergies.length % ALLERGY_SAMPLES.length] }])}
                  onAddBlank={() => set("allergies", [...form.allergies, { text: "", severity: "MI", reaction: "" }])}
                  empty="No allergies recorded."
                >
                  {form.allergies.map((a, i) => (
                    <AlRow key={i} a={a} onChange={(n) => set("allergies", form.allergies.map((x, j) => (j === i ? n : x)))} onRemove={() => set("allergies", form.allergies.filter((_, j) => j !== i))} />
                  ))}
                </ListCard>
              )}
            </>
          )}

          {eventId === "A08-CNHI" && (
            <Card>
              <CardHeader title="Z-Segment Fields (Placeholders)" subtitle="The field lists for ZPV1, ZDG1 and ZPR1 have not been supplied. These three fields per segment are stand-ins." />
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                {(["ZPV1", "ZDG1", "ZPR1"] as const).map((z) =>
                  form.z[z].map((v, i) => (
                    <Field key={`${z}${i}`} label={`${z}-${i + 2}`}>
                      <Input
                        value={v}
                        placeholder="Placeholder value"
                        onChange={(e) => set("z", { ...form.z, [z]: form.z[z].map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                    </Field>
                  )),
                )}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={!!problem} onClick={onSend}>
              <Send className="size-4" />
              {dev ? "Send To Log" : "Save"}
            </Button>
            <Button onClick={reset}>
              <RotateCcw className="size-4" />
              Reset Form
            </Button>
            {problem && <span className="text-xs text-muted-foreground">{problem}</span>}
          </div>
          {toast && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
              <Badge tone={toast.errors ? "danger" : "ok"}>{toast.errors ? "Saved With Errors" : "Saved"}</Badge>
              <span>
                {dev ? `Message ${toast.id} was saved to the log. Nothing leaves this app.` : "Saved. The ADT message was created in the background."}
              </span>
              {dev && <Button size="sm" variant="ghost" onClick={() => navigate("/log")}>View Log</Button>}
            </div>
          )}
        </div>

        {dev && <div className="xl:sticky xl:top-4 xl:self-start">
          <MessagePanel
            event={event}
            message={plan.message}
            filename={filename}
            statuses={plan.statuses}
            include={plan.include}
            onToggle={(id, v) => setOverrides((o) => ({ ...o, [id]: v }))}
            checks={plan.checks}
          />
        </div>}
      </div>
    </div>
  );
}

const HEADER_BORDER = {
  admit: "border-l-admit",
  move: "border-l-move",
  update: "border-l-update",
  cancel: "border-l-cancel",
  merge: "border-l-merge",
} as const;

function visitLabel(state: HisState, e: Encounter): string {
  const p = state.patients.find((x) => x.id === e.patientId);
  const where = e.status === "active" && e.bedId ? ` · ${bedLabel(e.bedId)}` : "";
  return `${e.visitNumber} · ${patientName(p)} · ${e.status}${where}`;
}

function Help({ term, text }: { term: string; text: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-1">{text}</dd>
    </div>
  );
}

function ListCard({
  title, tag, addLabel, onAdd, onAddBlank, empty, children,
}: {
  title: string; tag: string; addLabel: string; onAdd: () => void; onAddBlank: () => void; empty: string; children: React.ReactNode;
}) {
  const hasRows = React.Children.count(children) > 0;
  return (
    <Card>
      <CardHeader
        title={title}
        tag={tag}
        right={
          <div className="flex gap-1.5">
            <Button size="sm" onClick={onAdd}><Plus className="size-3.5" />{addLabel}</Button>
            <Button size="sm" variant="ghost" onClick={onAddBlank}>Add Blank</Button>
          </div>
        }
      />
      <div className="space-y-2 p-4">
        {hasRows ? children : <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </Card>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label="Remove row" className="shrink-0">
      <Trash2 className="size-3.5" />
    </Button>
  );
}

function DxRow({ d, onChange, onRemove }: { d: Dx; onChange: (d: Dx) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input className="w-28 font-mono" placeholder="ICD-10-AM" value={d.code} onChange={(e) => onChange({ ...d, code: e.target.value })} aria-label="Diagnosis code" />
      <Input placeholder="Description" value={d.text} onChange={(e) => onChange({ ...d, text: e.target.value })} aria-label="Diagnosis description" />
      <Select className="w-28" value={d.type} onChange={(e) => onChange({ ...d, type: e.target.value as Dx["type"] })} aria-label="Diagnosis type">
        <option value="A">Admitting</option>
        <option value="W">Working</option>
        <option value="F">Final</option>
      </Select>
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}

function PrRow({ r, onChange, onRemove }: { r: Pr; onChange: (r: Pr) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input className="w-28 font-mono" placeholder="Code" value={r.code} onChange={(e) => onChange({ ...r, code: e.target.value })} aria-label="Procedure code" />
      <Input placeholder="Description" value={r.text} onChange={(e) => onChange({ ...r, text: e.target.value })} aria-label="Procedure description" />
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}

function AlRow({ a, onChange, onRemove }: { a: Allergy; onChange: (a: Allergy) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input placeholder="Allergen" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} aria-label="Allergen" />
      <Select className="w-28" value={a.severity} onChange={(e) => onChange({ ...a, severity: e.target.value as Allergy["severity"] })} aria-label="Severity">
        <option value="MI">Mild</option>
        <option value="MO">Moderate</option>
        <option value="SV">Severe</option>
      </Select>
      <Input placeholder="Reaction" value={a.reaction} onChange={(e) => onChange({ ...a, reaction: e.target.value })} aria-label="Reaction" />
      <RemoveBtn onClick={onRemove} />
    </div>
  );
}
