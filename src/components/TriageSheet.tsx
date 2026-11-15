import * as React from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Field, Input, Select, cn } from "@/components/ui/primitives";
import {
  AttentionLink, CheckRow, ChipSingle, ErrorSummary, FormActions, FormGrid, FormSection, SegmentedControl, fitsSegmented, isDirty, rules, useFormErrors, useUnsavedChangesGuard, type Errors,
} from "@/components/forms";
import { audit } from "@/lib/audit";
import { ageInMonths, assessCtas, needsReason, whyLine, type Appearance, type Distress, type Perfusion, type TriageInput } from "@/lib/ctas";
import { useDevMode } from "@/lib/devmode";
import { AREAS, ARRIVAL_MODES, CTAS, ctasInfo, defaultArea, saveTriage } from "@/lib/ed";
import type { CtasLevel, EdData, Encounter } from "@/lib/model";
import { COMPLAINT_SAMPLES } from "@/lib/reference-data";
import { currentUser } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { recordFromTriage } from "@/lib/vitals";
import { confirmPatient } from "@/lib/wrong-patient";

const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? undefined : Number(s));

/** A round CTAS level marker, coloured by level. */
export function LevelDot({ level, size = "md" }: { level?: CtasLevel; size?: "sm" | "md" | "lg" }) {
  const dim = size === "lg" ? "size-10 text-lg" : size === "sm" ? "size-6 text-xs" : "size-7 text-sm";
  if (!level) return <span className={cn("flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border font-semibold text-muted-foreground", dim)} title="Not triaged">?</span>;
  const info = ctasInfo(level);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-white dark:text-[#0b1f23]", info.bg, dim, level === 3 && "text-[#1a1a1a] dark:text-[#1a1a1a]")}
      title={`CTAS ${level}, ${info.label}`}
      aria-label={`CTAS ${level}, ${info.label}`}
    >
      {level}
    </span>
  );
}

/** A row of choices where exactly one is on: a segmented control when the choices are short, chips when they are long. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T | undefined; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  const opts = options.map((o) => ({ value: o.id, label: o.label }));
  return (
    <Field group label={label}>
      {fitsSegmented(opts)
        ? <SegmentedControl options={opts} value={value ?? ""} onChange={onChange} label={label} />
        : <ChipSingle options={opts} value={value ?? ""} onChange={onChange} label={label} />}
    </Field>
  );
}

export function TriageSheet({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const his = useHis();
  const dev = useDevMode();
  const ed = enc.ed!;
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const months = patient ? ageInMonths(patient.dob) : 40 * 12;

  const [picked, setPicked] = React.useState<CtasLevel | undefined>(ed.ctas);
  const [reason, setReason] = React.useState(ed.ctasOverride ?? "");
  const [mode, setMode] = React.useState<EdData["arrivalMode"]>(ed.arrivalMode);
  const [complaint, setComplaint] = React.useState(ed.complaint ?? enc.reason ?? "");
  const [bp, setBp] = React.useState(enc.vitals?.bp ?? "");
  const [hr, setHr] = React.useState(enc.vitals?.pulse ?? "");
  const [rr, setRr] = React.useState(enc.vitals?.rr ?? "");
  const [temp, setTemp] = React.useState(enc.vitals?.temp ?? "");
  const [spo2, setSpo2] = React.useState(enc.vitals?.spo2 ?? "");
  const [gcs, setGcs] = React.useState(ed.gcs !== undefined ? String(ed.gcs) : "");
  const [pain, setPain] = React.useState(ed.pain !== undefined ? String(ed.pain) : "");
  const [area, setArea] = React.useState<NonNullable<EdData["area"]>>(ed.area ?? "Triage");
  // Nurse judgement
  const [distress, setDistress] = React.useState<Distress>("none");
  const [perfusion, setPerfusion] = React.useState<Perfusion>("normal");
  const [appearance, setAppearance] = React.useState<Appearance | undefined>(undefined);
  const [immuno, setImmuno] = React.useState(false);
  const [painLoc, setPainLoc] = React.useState<"central" | "peripheral">("central");
  const [painDur, setPainDur] = React.useState<"acute" | "chronic">("acute");
  const [symptomatic, setSymptomatic] = React.useState(false);
  const [bleeding, setBleeding] = React.useState<"none" | "minor" | "major">("none");
  const [injury, setInjury] = React.useState(false);

  const [sbp, dbp] = bp.split("/").map((x) => num(x));
  const input: TriageInput = {
    ageMonths: months, hr: num(hr), rr: num(rr), sbp, dbp, spo2: num(spo2), temp: num(temp), gcs: num(gcs), pain: num(pain),
    painLocation: painLoc, painDuration: painDur, distress, perfusion, appearance, immunocompromised: immuno, symptomatic, bleeding, highRiskInjury: injury,
  };
  const a = assessCtas(input);
  const paed = a.band === "paediatric";
  const feverish = (num(temp) ?? 0) >= 38.5;
  const reasonNeeded = needsReason(picked, a);

  const errors: Errors = {};
  if (!picked) errors.level = "Choose the CTAS level.";
  if (reasonNeeded && reason.trim().length < 5) errors.reason = "Write why you chose a less urgent level, in at least 5 characters.";
  if (gcs.trim() && rules.range(3, 15)(gcs, {})) errors.gcs = "Enter a score from 3 to 15.";
  if (pain.trim() && rules.range(0, 10)(pain, {})) errors.pain = "Enter a score from 0 to 10.";
  if (bp.trim() && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(bp.trim())) errors.bp = "Write it as systolic over diastolic, for example 120/80.";
  const order = ["bp", "gcs", "pain", "level", "reason"];
  const fe = useFormErrors(errors, order);
  const labels: Record<string, string> = { bp: "Blood Pressure", gcs: paed ? "Coma Score" : "GCS", pain: "Pain", level: "CTAS Level", reason: "Reason For A Less Urgent Level" };

  const snapshot = { picked, reason, mode, complaint, bp, hr, rr, temp, spo2, gcs, pain, area, distress, perfusion, appearance, immuno, painLoc, painDur, symptomatic, bleeding, injury };
  const [start] = React.useState(snapshot);
  const { guard, dialog } = useUnsavedChangesGuard(isDirty(start, snapshot), { what: "You have triage details that are not saved." });
  const close = () => guard(onClose);
  const summaryRef = React.useRef<HTMLDivElement>(null);

  async function save() {
    if (!fe.attempt() || !picked) return;
    if (!(await confirmPatient(enc.patientId))) return;
    const why = a.drivers.length ? whyLine(a) : "Presenting complaint (no modifier raised the level)";
    saveTriage(
      enc.visitNumber,
      { ctas: picked, ctasWhy: why, ctasOverride: reasonNeeded ? reason.trim() : undefined, arrivalMode: mode, complaint, gcs: num(gcs), pain: num(pain), area, triageNurse: currentUser().name },
      { bp, pulse: hr, temp, spo2, rr },
      reasonNeeded ? `Less urgent than the modifiers (CTAS ${a.level}): ${reason.trim()}` : undefined,
    );
    audit("update", `Triage CTAS ${picked}`, { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${why}${reasonNeeded ? `. Chosen less urgent than CTAS ${a.level}: ${reason.trim()}` : ""}` });
    recordFromTriage(enc.visitNumber, { bp, pulse: hr, temp, spo2, rr });
    onClose();
  }

  const shownCount = Object.keys(fe.shown).length;

  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 bg-background sm:max-w-3xl">
        <SheetHeader className="border-b border-border bg-[color:var(--glass-solid)] px-5 pr-12">
          <SheetTitle className="text-lg">Triage: {patientName(patient)}</SheetTitle>
          <SheetDescription>
            {a.ageText}, so the <strong>{paed ? "paediatric" : "adult"}</strong> CTAS tables are used. Enter what you see, check what the modifiers say, then choose the level. The doctor clock starts when you save.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" {...fe.bind}>
          <ErrorSummary ref={summaryRef} items={Object.keys(fe.shown).sort((x, y) => order.indexOf(x) - order.indexOf(y)).map((k) => ({ key: k, text: `${labels[k]}: ${fe.shown[k]}` }))} onJump={fe.go} />

          <FormSection title="Vital Signs" help="Leave a reading empty if it was not taken.">
            <FormGrid cols={4}>
              <Field name="bp" label="Blood Pressure" error={fe.shown.bp}><Input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="120/80" suffix="mmHg" className="tabular-nums" /></Field>
              <Field label="Heart Rate"><Input value={hr} onChange={(e) => setHr(e.target.value)} inputMode="numeric" suffix="/min" className="tabular-nums" /></Field>
              <Field label="Respiratory Rate"><Input value={rr} onChange={(e) => setRr(e.target.value)} inputMode="numeric" suffix="/min" className="tabular-nums" /></Field>
              <Field label="Temperature" hint="Oral."><Input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" suffix="°C" className="tabular-nums" /></Field>
              <Field label="Oxygen Saturation"><Input value={spo2} onChange={(e) => setSpo2(e.target.value)} inputMode="numeric" suffix="%" className="tabular-nums" /></Field>
              <Field name="gcs" label={paed ? "Coma Score" : "Glasgow Coma Scale"} hint="3 to 15." error={fe.shown.gcs}><Input value={gcs} onChange={(e) => setGcs(e.target.value)} inputMode="numeric" className="tabular-nums" /></Field>
              <Field name="pain" label="Pain" hint="0 is none, 10 is the worst." error={fe.shown.pain}><Input value={pain} onChange={(e) => setPain(e.target.value)} inputMode="numeric" suffix="of 10" className="tabular-nums" /></Field>
            </FormGrid>
          </FormSection>

          <FormSection title="What You See" help="Your judgement of breathing, circulation and risk.">
            <div className="space-y-5">
              <Choice label="Breathing" value={distress} onChange={setDistress} options={[
                { id: "none", label: "No distress" }, { id: "mild", label: "Mild" }, { id: "moderate", label: "Moderate" }, { id: "severe", label: "Severe" },
              ]} />
              <Choice label="Circulation (Skin, Pulse, Capillary Refill)" value={perfusion} onChange={setPerfusion} options={[
                { id: "normal", label: "Normal" }, { id: "borderline", label: "Borderline" }, { id: "compromised", label: "Compromised" }, { id: "shock", label: "Shock" },
              ]} />
              {feverish && (
                <div className="space-y-3 rounded-xl border border-border bg-card p-3">
                  <Choice label="Fever: How Does The Patient Look?" value={appearance} onChange={setAppearance} options={[
                    { id: "well", label: "Looks well" }, { id: "unwell", label: "Looks unwell" }, { id: "septic", label: "Looks septic" },
                  ]} />
                  <CheckRow checked={immuno} onChange={setImmuno} hint="Low white cells, chemotherapy or steroids.">Immunocompromised</CheckRow>
                </div>
              )}
              {(num(pain) ?? 0) > 0 && !paed && (
                <div className="grid gap-4 rounded-xl border border-border bg-card p-3 @container">
                  <Choice label="Pain Location" value={painLoc} onChange={setPainLoc} options={[{ id: "central", label: "Central (organ or body cavity)" }, { id: "peripheral", label: "Peripheral (skin, muscle, bone)" }]} />
                  <Choice label="Pain Duration" value={painDur} onChange={setPainDur} options={[{ id: "acute", label: "New (acute)" }, { id: "chronic", label: "Long-standing (chronic)" }]} />
                </div>
              )}
              {!paed && ((sbp ?? 0) >= 200 || (dbp ?? 0) >= 110) && (
                <CheckRow checked={symptomatic} onChange={setSymptomatic} tone="warn" hint="Headache, chest pain, short of breath or nausea.">The blood pressure is high and the patient has symptoms</CheckRow>
              )}
              {!paed && (
                <Choice label="Bleeding On A Blood Thinner Or With A Bleeding Disorder" value={bleeding} onChange={setBleeding} options={[
                  { id: "none", label: "None" }, { id: "minor", label: "Minor bleed" }, { id: "major", label: "Major site or uncontrolled" },
                ]} />
              )}
              <CheckRow checked={injury} onChange={setInjury} tone="warn" hint="Ejected from a vehicle, rollover, fall from height, penetrating injury, pedestrian struck.">High-Risk Injury</CheckRow>
            </div>
          </FormSection>

          <FormSection title="What The CTAS Modifiers Say" help="Worked out from what you entered above. The most urgent one sets the suggested level.">
            <div aria-live="polite">
              {a.drivers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
                  No modifier raises the level. Choose 3, 4 or 5 from the presenting complaint.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {a.drivers.map((d, i) => (
                    <li key={d.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", i === 0 ? "border-[#03C1AC] bg-[#39EDD5]/10" : "border-border bg-card")}>
                      <LevelDot level={d.level} size="sm" />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold">{d.modifier}.</span> {d.why}
                      </span>
                      {i === 0 && <Badge tone="primary">Sets The Level</Badge>}
                    </li>
                  ))}
                </ol>
              )}
              {a.prompts.map((p) => (
                <p key={p} className="mt-2 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />{p}
                </p>
              ))}
              {dev && <p className="mt-2 text-xs text-muted-foreground">Tables: CTAS Paramedic Guide v2.0 and Field Reference Guide v1.0 (adult and paediatric first order modifiers). The highest acuity from all modifiers wins. Age to table row for children is our assumption, see ctas.ts.</p>}
            </div>
          </FormSection>

          <FormSection title="Your CTAS Level" help="You decide. The modifiers only suggest." attention={fe.shown.level || fe.shown.reason ? 1 : 0}>
            <Field group name="level" label="CTAS Level" required error={fe.shown.level}>
              <div role="radiogroup" aria-label="CTAS level" className="grid grid-cols-2 gap-2 pt-2 sm:grid-cols-5">
                {CTAS.map((c) => {
                  const on = picked === c.level;
                  const suggested = a.level === c.level;
                  return (
                    <button
                      key={c.level}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => { setPicked(c.level); if (area === "Triage") setArea(defaultArea(c.level)); }}
                      className={cn(
                        "relative flex flex-col items-center gap-1 rounded-xl border-2 bg-card px-2 pb-2 pt-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        on ? `${c.ring} bg-muted` : "border-border hover:bg-muted/60",
                      )}
                    >
                      {suggested && <span className="absolute -top-2.5 rounded-full bg-[#032C26] px-2 py-0.5 text-xs font-semibold text-white">Suggested</span>}
                      <LevelDot level={c.level} size="lg" />
                      <span className="text-sm font-semibold">{c.label}</span>
                      <span className="text-xs text-muted-foreground">{c.targetMin === 0 ? "Immediate" : `Doctor in ${c.targetMin} min`}</span>
                      {on && <Check className="size-4 text-ok" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </Field>
            {a.level !== undefined && picked !== a.level && (
              <button type="button" onClick={() => setPicked(a.level)} className="mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-move hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Use CTAS {a.level} from the modifiers <ArrowRight className="size-4" aria-hidden="true" />
              </button>
            )}
            {reasonNeeded && (
              <Field name="reason" className="mt-4" required label="Reason For A Less Urgent Level" hint={`You chose a less urgent level than the modifiers (CTAS ${a.level}). Say why.`} error={fe.shown.reason}>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="For example: chronic COPD, 91% is her usual saturation" />
              </Field>
            )}
          </FormSection>

          <FormSection title="Visit Details">
            <FormGrid cols={2}>
              <Field label="Arrival Mode" hl7={dev ? "ZPV1-18" : undefined}>
                <Select value={mode} onChange={(e) => setMode(e.target.value as EdData["arrivalMode"])}>{!ARRIVAL_MODES.includes(mode) && <option>{mode}</option>}{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
              </Field>
              <Field label="Area" hint="Filled from the level. Change it if the patient goes elsewhere.">
                <Select value={area} onChange={(e) => setArea(e.target.value as NonNullable<EdData["area"]>)}>{AREAS.map((x) => <option key={x}>{x}</option>)}</Select>
              </Field>
              <Field label="Chief Complaint" className="col-span-full" hl7={dev ? "PV2-3" : undefined}>
                <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Type or tap one below" />
              </Field>
              <div className="col-span-full -mt-3 flex flex-wrap gap-1.5">
                {COMPLAINT_SAMPLES.map((c) => (
                  <button key={c.code} type="button" onClick={() => setComplaint(c.text)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground/45 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{c.text}</button>
                ))}
              </div>
            </FormGrid>
          </FormSection>
        </div>

        <FormActions
          className="px-4 sm:px-5"
          status={shownCount ? <AttentionLink count={shownCount} onClick={() => summaryRef.current?.focus()} /> : picked ? <span className="flex items-center gap-2"><LevelDot level={picked} size="sm" />CTAS {picked}, {ctasInfo(picked).label}</span> : "Choose a level to save."}
          onCancel={close}
          onSave={save}
          saveLabel="Save Triage"
        />
        {dialog}
      </SheetContent>
    </Sheet>
  );
}
