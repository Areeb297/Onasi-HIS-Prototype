import * as React from "react";
import { Siren, UserRound, UserRoundSearch, UserRoundX } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, cn } from "@/components/ui/primitives";
import { ageInMonths, ageText } from "@/lib/ctas";
import { useDevMode } from "@/lib/devmode";
import { ARRIVAL_MODES } from "@/lib/ed";
import { dobFromAge, registerEmergency, type ErIdentity } from "@/lib/er-register";
import type { EdData } from "@/lib/model";
import { COMPLAINT_SAMPLES, DOCTORS } from "@/lib/reference-data";
import { REGISTRY, lookupById } from "@/lib/registry";
import { navigate } from "@/lib/router";

type Kind = ErIdentity["kind"];

const KINDS: { id: Kind; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: "registry", label: "Has an ID", hint: "Look the patient up by ID number", icon: <UserRoundSearch className="size-5" /> },
  { id: "known", label: "Knows the name", hint: "No ID with them, type the name", icon: <UserRound className="size-5" /> },
  { id: "unknown", label: "Cannot say who", hint: "Unconscious or alone. Add the name later", icon: <UserRoundX className="size-5" /> },
];

/**
 * Emergency registration for the door. A few answers, then triage. The full registration form stays one tap away.
 * Consent and insurance are not asked here, because emergency care does not wait for them.
 */
export function ErQuickRegistration() {
  const dev = useDevMode();
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
  const [error, setError] = React.useState("");

  const person = kind === "registry" && idNumber.length === 10 ? lookupById(idNumber) : undefined;
  const ageN = age.trim() === "" || Number.isNaN(Number(age)) ? undefined : Math.max(0, Math.floor(Number(age)));

  const identity: ErIdentity | null =
    kind === "registry" ? (person ? { kind, idNumber } : null)
    : kind === "known" ? { kind, given, family, sex, dob: dob || undefined, ageYears: dob ? undefined : ageN }
    : { kind, sex, ageYears: unit === "years" ? ageN : undefined, ageMonths: unit === "months" ? ageN : undefined };

  const missing =
    kind === "registry" ? (person ? "" : idNumber.length === 10 ? "That ID is not in the registry. Use Knows the name." : "Enter the 10 digit ID number.")
    : kind === "known" ? (!given.trim() || !family.trim() ? "Enter the first and family names." : !dob && ageN === undefined ? "Enter the date of birth or an approximate age." : "")
    : ageN === undefined ? "Enter an approximate age." : "";

  // The preview shows what the board card will say.
  const shownName = kind === "registry" ? (person ? `${person.first} ${person.family}` : "Patient not found yet") : kind === "known" ? `${given || "First"} ${family || "Family"}` : `Unknown ${sex === "M" ? "Male" : "Female"}`;
  const shownSex = kind === "registry" ? person?.sex : sex;
  const months = kind === "registry" ? (person ? ageInMonths(person.dob) : undefined) : kind === "known" && dob ? ageInMonths(dob) : ageN === undefined ? undefined : unit === "months" && kind === "unknown" ? ageN : ageN * 12;

  function submit(triageNow: boolean) {
    if (!identity || missing) { setError(missing); return; }
    setError("");
    const r = registerEmergency({ identity, arrivalMode: mode, complaint, attending: doctor, referring: referring || undefined });
    if (!r.ok) { setError(r.message); return; }
    navigate("/er", triageNow ? { triage: r.visit } : undefined);
  }

  return (
    <div className="grid gap-5 pb-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-5">
        {/* Who */}
        <section aria-labelledby="er-who">
          <h2 id="er-who" className="mb-2 text-sm font-semibold">1. Who is the patient?</h2>
          <div role="radiogroup" aria-label="Who is the patient" className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => { setKind(k.id); setError(""); }}
                className={cn("flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-colors", kind === k.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")}>
                <span className={cn("mt-0.5", kind === k.id ? "text-primary" : "text-muted-foreground")}>{k.icon}</span>
                <span>
                  <span className="block text-sm font-semibold">{k.label}</span>
                  <span className="block text-xs text-muted-foreground">{k.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <Card className="mt-3 p-4">
            {kind === "registry" && (
              <div className="space-y-2">
                <Field label="ID (Iqama) number" hl7={dev ? "PID-3 via registry" : undefined}>
                  <Input className="w-64 font-mono" value={idNumber} onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, "").slice(0, 10))} inputMode="numeric" placeholder="10 digits" aria-label="ID number" />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Test IDs:{" "}
                  {REGISTRY.map((r) => <button key={r.idNumber} type="button" onClick={() => setIdNumber(r.idNumber)} className="me-2 font-mono text-move underline">{r.idNumber}</button>)}
                </p>
                {person && <Badge tone="ok">Found in the national registry (simulated): {person.first} {person.family}</Badge>}
              </div>
            )}
            {kind === "known" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" hl7={dev ? "PID-5.2" : undefined}><Input value={given} onChange={(e) => setGiven(e.target.value)} dir="ltr" /></Field>
                <Field label="Family name" hl7={dev ? "PID-5.1" : undefined}><Input value={family} onChange={(e) => setFamily(e.target.value)} dir="ltr" /></Field>
                <Field label="Sex" hl7={dev ? "PID-8" : undefined}>
                  <Select value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}><option value="M">Male</option><option value="F">Female</option></Select>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date of birth" hl7={dev ? "PID-7" : undefined}><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
                  <Field label="Or age (years)"><Input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" disabled={!!dob} /></Field>
                </div>
              </div>
            )}
            {kind === "unknown" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Sex (best guess)" hl7={dev ? "PID-8" : undefined}>
                  <Select value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}><option value="M">Male</option><option value="F">Female</option></Select>
                </Field>
                <Field label="Approximate age"><Input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" aria-label="Approximate age" /></Field>
                <Field label="In"><Select value={unit} onChange={(e) => setUnit(e.target.value as "years" | "months")}><option value="years">Years</option><option value="months">Months</option></Select></Field>
              </div>
            )}
            {dev && kind !== "registry" && <p className="mt-3 text-xs text-muted-foreground">Assumption: a made-up test Health ID is given, because every ADT message needs one in PID-3. Nationality and marital status are sent as unknown (999 and U).</p>}
          </Card>
        </section>

        {/* Arrival */}
        <section aria-labelledby="er-arrival">
          <h2 id="er-arrival" className="mb-2 text-sm font-semibold">2. How did they arrive?</h2>
          <div role="radiogroup" aria-label="Arrival mode" className="flex flex-wrap gap-2">
            {ARRIVAL_MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                className={cn("rounded-full border-2 px-4 py-1.5 text-sm font-medium transition-colors", mode === m ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>{m}</button>
            ))}
          </div>
          {dev && <p className="mt-1 text-xs text-muted-foreground">Goes in ZPV1-18 of the discharge update.</p>}
        </section>

        {/* Why */}
        <section aria-labelledby="er-why">
          <h2 id="er-why" className="mb-2 text-sm font-semibold">3. What is wrong?</h2>
          <Field label="Reason for the visit" hl7={dev ? "PV2-3" : undefined}>
            <Input value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="A few words. You can leave it empty and add it at triage." />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {COMPLAINT_SAMPLES.map((c) => <button key={c.code} type="button" onClick={() => setComplaint(c.text)} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent">{c.text}</button>)}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Emergency doctor" hl7={dev ? "PV1-7" : undefined}>
              <Select value={doctor} onChange={(e) => setDoctor(e.target.value)}>{DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}</Select>
            </Field>
            <Field label="Sent by a doctor (if any)" hl7={dev ? "PV1-8" : undefined} hint="Leave empty for walk-ins. NPHIES will show a warning that it expects one.">
              <Select value={referring} onChange={(e) => setReferring(e.target.value)}><option value="">None</option>{DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}</Select>
            </Field>
          </div>
        </section>

        <p className="text-sm text-muted-foreground">Consent and insurance are completed after triage. Emergency care does not wait for them.</p>

        {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!!missing} onClick={() => submit(true)}><Siren className="size-4" />Register And Triage Now</Button>
          <Button disabled={!!missing} onClick={() => submit(false)}>Register Only</Button>
          <Button onClick={() => navigate("/er")}>Cancel</Button>
          {missing && <span className="text-xs text-muted-foreground">{missing}</span>}
        </div>
      </div>

      {/* What the board will show */}
      <aside aria-label="Board card preview" className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 text-xs font-medium text-muted-foreground">What the nurse will see on the board</div>
        <div className="rounded-lg border border-border border-l-4 border-l-border bg-card p-3 shadow-sm">
          <div className="flex items-start gap-2.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-border text-lg font-semibold text-muted-foreground" title="Not triaged">?</span>
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
          <div className="mt-2 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">Waiting for triage, target 10 min</div>
        </div>
        {months !== undefined && <p className="mt-2 text-xs text-muted-foreground">Triage will use the {months < 216 ? "paediatric" : "adult"} CTAS tables.</p>}
        {dev && kind === "unknown" && ageN !== undefined && <p className="mt-1 text-xs text-muted-foreground">Birth date stored: {dobFromAge(unit === "years" ? ageN : undefined, unit === "months" ? ageN : undefined)}</p>}
      </aside>
    </div>
  );
}
