import * as React from "react";
import { flushSync } from "react-dom";
import { Siren, UserRound, UserRoundSearch, UserRoundX } from "lucide-react";
import { Badge, Button, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import {
  AttentionLink, ChipSingle, ErrorSummary, FormActions, FormGrid, FormSection, SearchSelect, SegmentedControl, SEARCH_FROM, isDirty, useFormErrors, useUnsavedChangesGuard, type Errors,
} from "@/components/forms";
import { ageInMonths, ageText } from "@/lib/ctas";
import { useDevMode } from "@/lib/devmode";
import { ARRIVAL_MODES, CTAS, ctasInfo } from "@/lib/ed";
import { dobFromAge, existingFileFor, registerEmergency, type ErIdentity } from "@/lib/er-register";
import type { CtasLevel, EdData } from "@/lib/model";
import { COMPLAINT_SAMPLES, DOCTORS } from "@/lib/reference-data";
import { REGISTRY, lookupById, registryNameAr } from "@/lib/registry";
import { navigate } from "@/lib/router";
import { canSetTriage, useSession } from "@/lib/session";
import { nowLocal } from "@/lib/store";

type Kind = ErIdentity["kind"];

const KINDS: { id: Kind; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "registry", label: "Has An ID", hint: "Look the patient up by ID number", icon: <UserRoundSearch className="size-5" /> },
  { id: "known", label: "Knows The Name", hint: "No ID with them, type the name", icon: <UserRound className="size-5" /> },
  { id: "unknown", label: "Cannot Say Who", hint: "Unconscious or alone. Add the name later", icon: <UserRoundX className="size-5" /> },
];

const doctorOpts = DOCTORS.map((d) => ({ value: d.id, label: `Dr. ${d.given} ${d.family}` }));

/** A doctor picker: a search box when the list is long, a plain select otherwise. */
function DoctorSelect({ value, onChange, emptyLabel }: { value: string; onChange: (v: string) => void; emptyLabel?: string }) {
  if (doctorOpts.length > SEARCH_FROM) return <SearchSelect options={doctorOpts} value={value} onChange={onChange} emptyLabel={emptyLabel} />;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {doctorOpts.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
    </Select>
  );
}

/**
 * Emergency registration for the door. A few answers, then triage. The full registration form stays one tap away.
 * Consent and insurance are not asked here, because emergency care does not wait for them.
 */
export function ErQuickRegistration() {
  const dev = useDevMode();
  useSession();
  const [kind, setKind] = React.useState<Kind>("registry");
  const [idNumber, setIdNumber] = React.useState("");
  const [given, setGiven] = React.useState("");
  const [family, setFamily] = React.useState("");
  const [sex, setSex] = React.useState<"M" | "F">("M");
  const [dob, setDob] = React.useState("");
  const [age, setAge] = React.useState("");
  const [unit, setUnit] = React.useState<"years" | "months">("years");
  const [mode, setMode] = React.useState<EdData["arrivalMode"]>("Walk-in");
  const [complaint, setComplaint] = React.useState("");
  const [doctor, setDoctor] = React.useState(DOCTORS[0].id);
  const [referring, setReferring] = React.useState("");
  const [picked, setCtas] = React.useState<CtasLevel | undefined>(undefined);
  // Only a nurse or a doctor may set the level. For a clerk the choice is not shown and the patient waits for triage.
  const mayTriage = canSetTriage();
  const ctas = mayTriage ? picked : undefined;
  const [serverError, setServerError] = React.useState("");
  const [done, setDone] = React.useState(false);
  const summaryRef = React.useRef<HTMLDivElement>(null);

  const person = kind === "registry" && idNumber.length === 10 ? lookupById(idNumber) : undefined;
  // A registry patient who already has a file keeps it. The visit is added to that file, so no second file is made.
  const onFile = person ? existingFileFor(person.idNumber) : undefined;
  const ageN = age.trim() === "" || Number.isNaN(Number(age)) ? undefined : Math.max(0, Math.floor(Number(age)));

  const identity: ErIdentity | null =
    kind === "registry" ? (person ? { kind, idNumber } : null)
    : kind === "known" ? { kind, given, family, sex, dob: dob || undefined, ageYears: dob ? undefined : ageN }
    : { kind, sex, ageYears: unit === "years" ? ageN : undefined, ageMonths: unit === "months" ? ageN : undefined };

  const errors: Errors = {};
  if (kind === "registry") {
    if (!idNumber) errors.idNumber = "Enter the 10 digit ID number.";
    else if (idNumber.length !== 10) errors.idNumber = "The ID number has 10 digits.";
    else if (!person) errors.idNumber = "That ID is not in the registry. Choose Knows The Name.";
  } else if (kind === "known") {
    if (!given.trim()) errors.given = "Enter the first name.";
    if (!family.trim()) errors.family = "Enter the family name.";
    if (!dob && ageN === undefined) errors.age = "Enter the date of birth or an approximate age.";
    else if (!dob && ageN !== undefined && ageN > 120) errors.age = "Enter an age from 0 to 120 years.";
  } else {
    if (ageN === undefined) errors.age = "Enter an approximate age.";
    else if (ageN > (unit === "years" ? 120 : 36)) errors.age = unit === "years" ? "Enter an age from 0 to 120 years." : "Enter up to 36 months, or switch to years.";
  }
  const order = ["idNumber", "given", "family", "age"];
  const labels: Record<string, string> = { idNumber: "ID Number", given: "First Name", family: "Family Name", age: kind === "unknown" ? "Approximate Age" : "Date Of Birth Or Age" };
  const fe = useFormErrors(errors, order);
  const shownCount = Object.keys(fe.shown).length;

  const snapshot = { kind, idNumber, given, family, sex, dob, age, unit, mode, complaint, doctor, referring, picked };
  const [start] = React.useState(snapshot);
  const { dialog } = useUnsavedChangesGuard(!done && isDirty(start, snapshot), { what: "The emergency registration is not saved." });

  // The preview shows what the board card will say.
  const shownName = kind === "registry" ? (person ? `${person.first} ${person.family}` : "Patient not found yet") : kind === "known" ? `${given || "First"} ${family || "Family"}` : `Unknown ${sex === "M" ? "Male" : "Female"}`;
  const shownSex = kind === "registry" ? person?.sex : sex;
  const months = kind === "registry" ? (person ? ageInMonths(person.dob) : undefined) : kind === "known" && dob ? ageInMonths(dob) : ageN === undefined ? undefined : unit === "months" && kind === "unknown" ? ageN : ageN * 12;

  function submit(triageNow: boolean) {
    setServerError("");
    if (!fe.attempt() || !identity) return;
    const r = registerEmergency({ identity, arrivalMode: mode, complaint, attending: doctor, referring: referring || undefined, ctas });
    if (!r.ok) { setServerError(r.message); requestAnimationFrame(() => summaryRef.current?.focus()); return; }
    flushSync(() => setDone(true));
    navigate("/er", triageNow ? { triage: r.visit } : undefined);
  }

  function chooseKind(k: Kind) {
    setKind(k);
    setServerError("");
    fe.reset();
  }

  return (
    <div className="grid gap-5 pb-2 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4" {...fe.bind}>
        <ErrorSummary
          ref={summaryRef}
          items={[
            ...Object.keys(fe.shown).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((k) => ({ key: k, text: `${labels[k]}: ${fe.shown[k]}` })),
            ...(serverError ? [{ key: "server", text: serverError }] : []),
          ]}
          onJump={(k) => k !== "server" && fe.go(k)}
        />

        <FormSection title="Who Is The Patient?" help="Pick what you know. A temporary ID is given when there is no ID with the patient.">
          <div role="radiogroup" aria-label="Who is the patient" className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const on = kind === k.id;
              return (
                <button
                  key={k.id} type="button" role="radio" aria-checked={on} onClick={() => chooseKind(k.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border-2 bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                    on ? "border-[#032C26] dark:border-[#39EDD5]" : "border-border hover:border-foreground/30",
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", on ? "text-[#035D53] dark:text-[#39EDD5]" : "text-muted-foreground")}>{k.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{k.label}</span>
                    <span className="block text-xs text-muted-foreground">{k.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 border-t border-border pt-5">
            {kind === "registry" && (
              <div className="space-y-3">
                <FormGrid>
                  <Field name="idNumber" required label="ID (Iqama) Number" hl7={dev ? "PID-3 via registry" : undefined} error={fe.shown.idNumber} hint="10 digits. The patient is found as you type the last digit.">
                    <Input className="font-mono tracking-wider" value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="1000000011" dir="ltr" />
                  </Field>
                </FormGrid>
                <p className="text-xs text-muted-foreground">
                  Test IDs:{" "}
                  {REGISTRY.map((r) => <button key={r.idNumber} type="button" onClick={() => setIdNumber(r.idNumber)} className="me-2 rounded font-mono text-move underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{r.idNumber}</button>)}
                </p>
                {person && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="ok" className="whitespace-normal leading-tight">Found in the national registry: {person.first} {person.family}</Badge>
                    <span lang="ar" className="text-sm text-muted-foreground"><bdi dir="rtl">{registryNameAr(person)}</bdi></span>
                  </div>
                )}
                {onFile && <p className="text-sm">This patient already has a file here ({onFile.mrn}). The visit will be added to that file.</p>}
              </div>
            )}
            {kind === "known" && (
              <FormGrid>
                <Field name="given" required label="First Name" hl7={dev ? "PID-5.2" : undefined} error={fe.shown.given}><Input value={given} onChange={(e) => setGiven(e.target.value)} dir="ltr" autoComplete="off" /></Field>
                <Field name="family" required label="Family Name" hl7={dev ? "PID-5.1" : undefined} error={fe.shown.family}><Input value={family} onChange={(e) => setFamily(e.target.value)} dir="ltr" autoComplete="off" /></Field>
                <Field group label="Sex" hl7={dev ? "PID-8" : undefined}>
                  <SegmentedControl options={[{ value: "M", label: "Male" }, { value: "F", label: "Female" }]} value={sex} onChange={setSex} label="Sex" />
                </Field>
                <Field name="age" group required label="Date Of Birth Or Age" hl7={dev ? "PID-7" : undefined} error={fe.shown.age} hint="Either one is enough." className="col-span-full @3xl:col-span-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] gap-2">
                    <Input type="date" value={dob} max={nowLocal().slice(0, 10)} onChange={(e) => setDob(e.target.value)} aria-label="Date of birth" />
                    <Input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" disabled={!!dob} suffix="years" aria-label="Or age in years" className="tabular-nums" />
                  </div>
                </Field>
              </FormGrid>
            )}
            {kind === "unknown" && (
              <FormGrid>
                <Field group label="Sex (Best Guess)" hl7={dev ? "PID-8" : undefined}>
                  <SegmentedControl options={[{ value: "M", label: "Male" }, { value: "F", label: "Female" }]} value={sex} onChange={setSex} label="Sex, best guess" />
                </Field>
                <Field name="age" group required label="Approximate Age" error={fe.shown.age}>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" aria-label="Approximate age" className="tabular-nums" />
                    <SegmentedControl options={[{ value: "years", label: "Years" }, { value: "months", label: "Months" }]} value={unit} onChange={setUnit} label="Age in" className="w-auto" />
                  </div>
                </Field>
              </FormGrid>
            )}
            <RequiredNote className="mt-4" />
            {dev && kind !== "registry" && <p className="mt-3 text-xs text-muted-foreground">Assumption: a made-up test Health ID is given, because every ADT message needs one in PID-3. Nationality and marital status are sent as unknown (999 and U).</p>}
          </div>
        </FormSection>

        <FormSection title="How Did They Arrive?">
          <Field group label="Arrival Mode" hl7={dev ? "ZPV1-18" : undefined}>
            <ChipSingle options={ARRIVAL_MODES} value={mode} onChange={setMode} label="Arrival mode" />
          </Field>
        </FormSection>

        <FormSection title="What Is Wrong?" help="A few words is enough. It can be completed at triage.">
          <FormGrid cols={2}>
            <Field label="Reason For The Visit" hl7={dev ? "PV2-3" : undefined} className="col-span-full">
              <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="For example: chest pain since this morning" />
            </Field>
            <div className="col-span-full -mt-3 flex flex-wrap gap-1.5">
              {COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setComplaint(c.text)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-foreground/45 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{c.text}</button>)}
            </div>
            <Field label="Emergency Doctor" hl7={dev ? "PV1-7" : undefined}>
              <DoctorSelect value={doctor} onChange={setDoctor} />
            </Field>
            <Field label="Referring Doctor" hl7={dev ? "PV1-8" : undefined} hint="Leave empty for walk-ins.">
              <DoctorSelect value={referring} onChange={setReferring} emptyLabel="None" />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Triage Level (CTAS)" help={mayTriage ? "Choose a level now if it is clear at the door. The full triage can confirm or change it." : undefined}>
          {mayTriage ? (
            <div role="radiogroup" aria-label="CTAS triage level" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {CTAS.map((c) => (
                <button key={c.level} type="button" role="radio" aria-checked={ctas === c.level} onClick={() => setCtas(c.level)}
                  className={cn("flex items-start gap-3 rounded-xl border-2 bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", ctas === c.level ? cn(c.ring, "bg-muted/60") : "border-border hover:border-foreground/30")}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-base font-bold text-white", c.bg, c.level === 3 && "text-[#1a1a1a]")}>{c.level}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.targetMin === 0 ? "Doctor now" : `Doctor within ${c.targetMin} minutes`}</span>
                  </span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={ctas === undefined} onClick={() => setCtas(undefined)}
                className={cn("flex items-start gap-3 rounded-xl border-2 bg-card p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", ctas === undefined ? "border-[#032C26] dark:border-[#39EDD5]" : "border-border hover:border-foreground/30")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-base font-semibold text-muted-foreground">?</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Decide At Triage</span>
                  <span className="block text-xs text-muted-foreground">The triage nurse sets the level</span>
                </span>
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm">The triage nurse sets the level. After you register, the patient shows on the Emergency board as waiting for triage.</p>
          )}
          {ctas && <p className="mt-3 text-sm"><span className="font-semibold">CTAS {ctas}, {ctasInfo(ctas).label}.</span> {ctasInfo(ctas).description}</p>}
          {dev && <p className="mt-1 text-xs text-muted-foreground">Goes in ZPV1-22 of the discharge update, with the triage time in ZPV1-21.</p>}
        </FormSection>

        <p className="text-sm text-muted-foreground">Consent and insurance are completed after triage. Emergency care does not wait for them.</p>

        <FormActions
          sticky
          reserveEnd
          status={shownCount ? <AttentionLink count={shownCount} onClick={() => summaryRef.current?.focus()} /> : <span>Next: {ctas ? `CTAS ${ctas} on the board` : "triage"}</span>}
          onCancel={() => navigate("/er")}
          extra={<Button onClick={() => submit(false)}>{ctas ? `Register As CTAS ${ctas}` : "Register Only"}</Button>}
          onSave={() => submit(true)}
          saveIcon={<Siren className="size-4" />}
          saveLabel={ctas ? "Register And Open Full Triage" : "Register And Triage Now"}
        />
      </div>

      {/* What the board will show */}
      <aside aria-label="Board card preview" className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 text-xs font-medium text-muted-foreground">What the nurse will see on the board</div>
        <div className="rounded-xl border border-[color:var(--glass-border)] border-l-4 border-l-border bg-[color:var(--glass-bg-strong)] p-3 shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow)]" style={ctas ? { borderLeftColor: `var(--ctas-${ctas})` } : undefined}>
          <div className="flex items-start gap-2.5">
            {ctas
              ? <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white", ctasInfo(ctas).bg, ctas === 3 && "text-[#1a1a1a]")} title={`CTAS ${ctas}, ${ctasInfo(ctas).label}`}>{ctas}</span>
              : <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-lg font-semibold text-muted-foreground" title="Not triaged">?</span>}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{shownName}</div>
              <div className="text-xs text-muted-foreground">
                {months !== undefined ? `${ageText(months)}, ` : ""}{shownSex ? (shownSex === "M" ? "Male" : "Female") : ""}
                {mode !== "Walk-in" && <> <Badge tone="info">{mode}</Badge></>}
              </div>
            </div>
          </div>
          <p className="mt-2 text-sm">{complaint || "No complaint entered"}</p>
          {kind !== "registry" && <div className="mt-1.5"><Badge tone="info">Temporary ID</Badge></div>}
          <div className="mt-2 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">{ctas ? `CTAS ${ctas}, ${ctasInfo(ctas).label}. ${ctasInfo(ctas).targetMin === 0 ? "Doctor now" : `Doctor within ${ctasInfo(ctas).targetMin} min`}` : "Waiting for triage, target 10 min"}</div>
        </div>
        {months !== undefined && <p className="mt-2 text-xs text-muted-foreground">Triage will use the {months < 216 ? "paediatric" : "adult"} CTAS tables.</p>}
        {dev && kind === "unknown" && ageN !== undefined && <p className="mt-1 text-xs text-muted-foreground">Birth date stored: {dobFromAge(unit === "years" ? ageN : undefined, unit === "months" ? ageN : undefined)}</p>}
      </aside>
    </div>
  );
}
