import * as React from "react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import { ageInMonths, assessCtas, needsReason, whyLine, type Appearance, type Distress, type Perfusion, type TriageInput } from "@/lib/ctas";
import { useDevMode } from "@/lib/devmode";
import { AREAS, ARRIVAL_MODES, CTAS, ctasInfo, defaultArea, saveTriage } from "@/lib/ed";
import type { CtasLevel, EdData, Encounter } from "@/lib/model";
import { COMPLAINT_SAMPLES } from "@/lib/reference-data";
import { currentUser } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { recordFromTriage } from "@/lib/vitals";

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

/** A row of choices where exactly one is on. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T | undefined; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn("rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors", value === o.id ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
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
  const reasonOk = !reasonNeeded || reason.trim().length >= 5;
  const canSave = !!picked && reasonOk;

  function save() {
    if (!picked) return;
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

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Triage: {patientName(patient)}</SheetTitle>
          <SheetDescription>
            {a.ageText}, so the <strong>{paed ? "paediatric" : "adult"}</strong> CTAS tables are used. Enter what you see. The modifiers below show the level they give. You decide the level. The doctor clock starts when you save.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {/* 1 Vital signs */}
          <section aria-labelledby="tri-vitals">
            <h3 id="tri-vitals" className="mb-2 text-sm font-semibold">1. Vital signs</h3>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="BP (mmHg)"><Input value={bp} onChange={(e) => setBp(e.target.value)} placeholder="120/80" /></Field>
              <Field label="Heart rate"><Input value={hr} onChange={(e) => setHr(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Resp rate"><Input value={rr} onChange={(e) => setRr(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Temp (°C, oral)"><Input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" /></Field>
              <Field label="SpO2 (%)"><Input value={spo2} onChange={(e) => setSpo2(e.target.value)} inputMode="numeric" /></Field>
              <Field label={paed ? "Coma score (3 to 15)" : "GCS (3 to 15)"}><Input value={gcs} onChange={(e) => setGcs(e.target.value)} inputMode="numeric" /></Field>
              <Field label="Pain (0 to 10)"><Input value={pain} onChange={(e) => setPain(e.target.value)} inputMode="numeric" /></Field>
            </div>
          </section>

          {/* 2 Nurse assessment */}
          <section aria-labelledby="tri-assess" className="space-y-3">
            <h3 id="tri-assess" className="text-sm font-semibold">2. What you see</h3>
            <Choice label="Breathing" value={distress} onChange={setDistress} options={[
              { id: "none", label: "No distress" }, { id: "mild", label: "Mild" }, { id: "moderate", label: "Moderate" }, { id: "severe", label: "Severe" },
            ]} />
            <Choice label="Circulation (skin, pulse, capillary refill)" value={perfusion} onChange={setPerfusion} options={[
              { id: "normal", label: "Normal" }, { id: "borderline", label: "Borderline" }, { id: "compromised", label: "Compromised" }, { id: "shock", label: "Shock" },
            ]} />
            {feverish && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Choice label="Fever: how does the patient look?" value={appearance} onChange={setAppearance} options={[
                  { id: "well", label: "Looks well" }, { id: "unwell", label: "Looks unwell" }, { id: "septic", label: "Looks septic" },
                ]} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={immuno} onChange={(e) => setImmuno(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                  Immunocompromised (low white cells, chemotherapy, steroids)
                </label>
              </div>
            )}
            {(num(pain) ?? 0) > 0 && !paed && (
              <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
                <Choice label="Pain location" value={painLoc} onChange={setPainLoc} options={[{ id: "central", label: "Central (organ or body cavity)" }, { id: "peripheral", label: "Peripheral (skin, muscle, bone)" }]} />
                <Choice label="Pain duration" value={painDur} onChange={setPainDur} options={[{ id: "acute", label: "New (acute)" }, { id: "chronic", label: "Long-standing (chronic)" }]} />
              </div>
            )}
            {!paed && ((sbp ?? 0) >= 200 || (dbp ?? 0) >= 110) && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={symptomatic} onChange={(e) => setSymptomatic(e.target.checked)} className="size-4 accent-[var(--primary)]" />
                The blood pressure is high and the patient has symptoms (headache, chest pain, short of breath, nausea)
              </label>
            )}
            {!paed && (
              <Choice label="Bleeding while on a blood thinner or with a bleeding disorder" value={bleeding} onChange={setBleeding} options={[
                { id: "none", label: "None" }, { id: "minor", label: "Minor bleed" }, { id: "major", label: "Major site or uncontrolled" },
              ]} />
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={injury} onChange={(e) => setInjury(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              High-risk injury (ejected from vehicle, rollover, fall from height, penetrating injury, pedestrian struck)
            </label>
          </section>

          {/* 3 Modifiers */}
          <section aria-labelledby="tri-mods" aria-live="polite">
            <h3 id="tri-mods" className="mb-2 text-sm font-semibold">3. What the CTAS modifiers say</h3>
            {a.drivers.length === 0 ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No modifier raises the level. Choose 3, 4 or 5 from the presenting complaint. This screen does not hold the complaint list.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {a.drivers.map((d, i) => (
                  <li key={d.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", i === 0 ? "border-primary/60 bg-primary/5" : "border-border")}>
                    <LevelDot level={d.level} size="sm" />
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">{d.modifier}.</span> {d.why}
                    </span>
                    {i === 0 && <Badge tone="primary">Sets the level</Badge>}
                  </li>
                ))}
              </ol>
            )}
            {a.prompts.map((p) => (
              <p key={p} className="mt-2 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />{p}
              </p>
            ))}
            {dev && <p className="mt-2 text-xs text-muted-foreground">Tables: CTAS Paramedic Guide v2.0 and Field Reference Guide v1.0 (adult and paediatric first order modifiers). The highest acuity from all modifiers wins. Age to table row for children is our assumption, see ctas.ts.</p>}
          </section>

          {/* 4 Level ladder */}
          <section aria-labelledby="tri-level">
            <h3 id="tri-level" className="mb-2 text-sm font-semibold">4. Your CTAS level</h3>
            <div role="radiogroup" aria-label="CTAS level" className="grid gap-2 sm:grid-cols-5">
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
                    className={cn("relative flex flex-col items-center gap-1 rounded-xl border-2 px-2 pb-2 pt-3 text-center transition-colors", on ? `${c.ring} bg-muted` : "border-border hover:bg-muted/60")}
                  >
                    {suggested && <span className="absolute -top-2.5 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">Modifiers</span>}
                    <LevelDot level={c.level} size="lg" />
                    <span className="text-sm font-semibold">{c.label}</span>
                    <span className="text-xs text-muted-foreground">{c.targetMin === 0 ? "Immediate" : `Doctor in ${c.targetMin} min`}</span>
                    {on && <Check className="size-4 text-ok" />}
                  </button>
                );
              })}
            </div>
            {a.level !== undefined && picked !== a.level && (
              <button type="button" onClick={() => setPicked(a.level)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-move hover:underline">
                Use CTAS {a.level} from the modifiers <ArrowRight className="size-4" />
              </button>
            )}
            {reasonNeeded && (
              <div className="mt-3 rounded-lg border-2 border-destructive/50 bg-destructive/5 p-3">
                <p className="text-sm font-medium">You chose a less urgent level than the modifiers (CTAS {a.level}). Write why.</p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  aria-label="Reason for the less urgent level"
                  aria-invalid={!reasonOk}
                  className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  placeholder="For example: chronic COPD, 91% is her usual saturation"
                />
              </div>
            )}
          </section>

          {/* 5 Details */}
          <section aria-labelledby="tri-details" className="grid gap-3 sm:grid-cols-2">
            <h3 id="tri-details" className="text-sm font-semibold sm:col-span-2">5. Visit details</h3>
            <Field label="Arrival mode" hl7="ZPV1-18">
              <Select value={mode} onChange={(e) => setMode(e.target.value as EdData["arrivalMode"])}>{ARRIVAL_MODES.map((m) => <option key={m}>{m}</option>)}</Select>
            </Field>
            <Field label="Area">
              <Select value={area} onChange={(e) => setArea(e.target.value as NonNullable<EdData["area"]>)}>{AREAS.map((x) => <option key={x}>{x}</option>)}</Select>
            </Field>
            <Field label="Chief complaint" className="sm:col-span-2" hl7="PV2-3">
              <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Type or tap one below" />
              <div className="mt-1 flex flex-wrap gap-1.5">
                {COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setComplaint(c.text)} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent">{c.text}</button>)}
              </div>
            </Field>
          </section>
        </div>

        <SheetFooter className="flex-row items-center justify-between gap-2 border-t border-border">
          <span className="text-xs text-muted-foreground">{!picked ? "Pick a level to save." : !reasonOk ? "Write the reason to save." : `CTAS ${picked}, ${ctasInfo(picked).label}.`}</span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>Save Triage</Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
