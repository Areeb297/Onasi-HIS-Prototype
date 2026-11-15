import * as React from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Field, Input, Select, cn } from "@/components/ui/primitives";
import { DateTimeInput, FormActions, FormGrid, FormSection, ReasonButton, SegmentedControl, isDirty, useUnsavedChangesGuard } from "@/components/forms";
import { useDevMode } from "@/lib/devmode";
import { titleCase } from "@/lib/forms/util";
import type { Encounter, Patient } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { can } from "@/lib/session";
import { nowLocal } from "@/lib/store";
import { amendPanel, currentRecorder, obsValue, savePanel, sendPanel, type VitalPanel } from "@/lib/vitals";
import {
  BP_POSITIONS, CONSCIOUSNESS, CONTEXTS, DIPSTICK, LOCAL_VITALS, VITALS, bmiOf, flagFor, localFlag, news2, refRangeText,
  type Consciousness, type LocalReadings, type PanelContext, type VitalKey,
} from "@/lib/vitals-spec";

const ageOf = (p: Patient) => Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000));

/** NEWS2 has its own colour scale, so it is never read as a CTAS triage level. */
export function newsTone(band: string) {
  return band === "High" ? "bg-destructive text-white" : band === "Medium" ? "bg-warn text-white" : band === "Low-Medium" ? "bg-warn/20 text-warn" : "bg-ok/20 text-ok";
}

export function defaultContext(enc: Encounter, hasPanels: boolean): PanelContext {
  if (enc.cls === "E" && !hasPanels) return "triage";
  if (enc.status === "discharged") return "discharge";
  if (enc.cls === "I") return hasPanels ? "routine" : "admission";
  return "other";
}

/**
 * Record vital signs, or correct a panel. Every one of the eight vitals that NPHIES claims need can be
 * a value or an absence reason ("not obtained"), so the claim can still be built.
 */
export function VitalsSheet({ enc, patient, panel, hasPanels, onClose }: { enc: Encounter; patient: Patient; panel?: VitalPanel; hasPanels: boolean; onClose: () => void }) {
  const dev = useDevMode();
  const correcting = !!panel;
  const initial = (k: VitalKey) => (panel ? obsValue(panel, k) : undefined);
  const [vals, setVals] = React.useState<Record<string, string>>(() => Object.fromEntries(VITALS.map((v) => [v.key, initial(v.key) !== undefined ? String(initial(v.key)) : ""])));
  const [absent, setAbsent] = React.useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const x of panel?.obs ?? []) if (x.absence) o[x.key] = x.absence.code;
    return o;
  });
  const [onOx, setOnOx] = React.useState(panel?.onOxygen ?? false);
  const [o2, setO2] = React.useState(panel?.o2flow !== undefined ? String(panel.o2flow) : "");
  const [pos, setPos] = React.useState(panel?.position ?? "");
  const [cons, setCons] = React.useState<Consciousness>(panel?.consciousness ?? "Alert");
  const [context, setContext] = React.useState<PanelContext>(panel?.context ?? defaultContext(enc, hasPanels));
  const [at, setAt] = React.useState(panel?.at ?? nowLocal());
  const [by, setBy] = React.useState(panel?.recordedBy ?? currentRecorder());
  const [note, setNote] = React.useState(panel?.note ?? "");
  const [localVals, setLocalVals] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(LOCAL_VITALS.map((d) => { const v = panel?.local?.[d.key]; return [d.key, v !== undefined ? String(v) : ""]; })),
  );
  /** Readings the user has left. A value outside the expected range is pointed out only after leaving the box. */
  const [left, setLeft] = React.useState<Set<string>>(() => new Set(panel ? VITALS.map((v) => v.key) : []));
  const leave = (k: string) => setLeft((s) => (s.has(k) ? s : new Set(s).add(k)));

  const snapshot = { vals, absent, onOx, o2, pos, cons, context, at, by, note, localVals };
  const [start] = React.useState(snapshot);
  const dirty = isDirty(start, snapshot);
  const { guard, dialog } = useUnsavedChangesGuard(dirty, { what: "You have vital signs on this form that are not saved." });
  const close = () => guard(onClose);

  const age = ageOf(patient);
  const local: LocalReadings = {};
  for (const d of LOCAL_VITALS) {
    const raw = localVals[d.key]?.trim() ?? "";
    if (raw === "") continue;
    if (d.kind === "number") { if (!Number.isNaN(Number(raw))) local[d.key] = Number(raw); }
    else local[d.key] = raw;
  }
  const hasLocal = Object.keys(local).length > 0;
  const num = (k: string) => (vals[k]?.trim() !== "" && !Number.isNaN(Number(vals[k])) ? Number(vals[k]) : undefined);
  const nums: Partial<Record<VitalKey, number>> = {};
  for (const v of VITALS) if (num(v.key) !== undefined && !absent[v.key]) nums[v.key] = num(v.key);
  const bmi = nums.weight !== undefined && nums.height !== undefined ? bmiOf(nums.weight, nums.height) : undefined;
  const score = news2(nums, onOx, cons);
  const outOfRange = VITALS.filter((v) => nums[v.key] !== undefined && (nums[v.key]! < v.min || nums[v.key]! > v.max));
  const forOru = Object.keys(nums).length > 0 || Object.keys(absent).length > 0;
  const something = forOru || hasLocal || (correcting && !!panel?.local);
  const canWrite = can("emr.write");
  const taken = VITALS.filter((v) => nums[v.key] !== undefined || absent[v.key]).length;

  function save(andSend: boolean) {
    const absences: Record<string, { code: string; label: string }> = {};
    for (const v of VITALS) {
      const code = absent[v.key];
      if (code) absences[v.key] = v.absence.find((a) => a.code === code) ?? { code, label: "Not obtained" };
    }
    let id: string | undefined;
    if (panel) {
      id = amendPanel(panel.id, { values: nums, absences, note, local })?.id;
    } else {
      id = savePanel({
        visit: enc.visitNumber, at, context, recordedBy: by, values: nums, absences, onOxygen: onOx,
        o2flow: o2 !== "" ? Number(o2) : undefined, position: pos || undefined, consciousness: cons, note: note || undefined, local,
      })?.id;
    }
    if (andSend && id && can("adt.send")) sendPanel(id);
    onClose();
  }

  const saveReason = !canWrite ? "Your role cannot record vital signs." : !something ? "Enter at least one reading, or tick Not Obtained." : undefined;
  const sendReason = !canWrite ? "Your role cannot record vital signs." : !can("adt.send") ? "Your role cannot send messages." : !forOru ? "Only bedside tests are filled in. They are not sent." : undefined;

  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent className="flex w-full flex-col gap-0 bg-background sm:max-w-2xl">
        <SheetHeader className="border-b border-border bg-[color:var(--glass-solid)] px-5 pr-12">
          <SheetTitle className="text-lg">{correcting ? "Correct Vital Signs" : "Record Vital Signs"}</SheetTitle>
          <SheetDescription>
            {correcting ? `Panel ${panel!.businessId}. A change after sending goes out as a correction.` : "Take all eight if you can. Insurance claims need each one, or the reason it was not taken."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
          <FormSection title="Vital Signs" help="Type the reading, or tick Not Obtained and give the reason." filled={taken} total={VITALS.length}>
            <FormGrid cols={2}>
              {VITALS.map((v) => {
                const n = num(v.key);
                const flag = n !== undefined && !absent[v.key] ? flagFor(v, n, age) : "";
                const off = n !== undefined && !absent[v.key] && (n < v.min || n > v.max) && left.has(v.key);
                return (
                  <div key={v.key} className="min-w-0">
                    <Field
                      name={v.key}
                      label={titleCase(v.label)}
                      hl7={dev ? `OBX ${v.loinc}` : undefined}
                      hint={off ? undefined : absent[v.key] ? "Not obtained. The reason is sent instead." : v.range ? `Normal ${refRangeText(v)}` : undefined}
                      error={off ? `Check this value. Expected ${v.min} to ${v.max}.` : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          type="number" step={v.step ?? 1} inputMode="decimal" disabled={!!absent[v.key]} value={absent[v.key] ? "" : vals[v.key]}
                          onChange={(e) => setVals((x) => ({ ...x, [v.key]: e.target.value }))}
                          onBlur={() => leave(v.key)}
                          suffix={v.display}
                          className={cn("tabular-nums", flag && !off && "border-warn")}
                          aria-label={titleCase(v.label)}
                        />
                        {flag && <Badge tone={flag.length === 2 ? "danger" : "warn"}>{flag}</Badge>}
                      </div>
                    </Field>
                    <div className="mt-2 flex min-h-8 flex-wrap items-center gap-2 text-xs">
                      <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground">
                        <input
                          type="checkbox" checked={!!absent[v.key]} className="size-4 accent-[#035D53]"
                          onChange={(e) => setAbsent((a) => { const n2 = { ...a }; if (e.target.checked) n2[v.key] = v.absence[0].code; else delete n2[v.key]; return n2; })}
                        />
                        Not Obtained
                      </label>
                      {absent[v.key] && (
                        <Select className="h-8 min-w-0 flex-1 text-xs" value={absent[v.key]} aria-label={`${titleCase(v.label)}, reason not obtained`} onChange={(e) => setAbsent((a) => ({ ...a, [v.key]: e.target.value }))}>
                          {v.absence.map((a) => <option key={a.code} value={a.code}>{a.label}{dev ? ` (${a.code})` : ""}</option>)}
                        </Select>
                      )}
                    </div>
                  </div>
                );
              })}
            </FormGrid>
            {bmi !== undefined && (
              <p className="mt-4 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                Body Mass Index <strong className="tabular-nums">{bmi}</strong> kg/m2
                <span className="ms-1 text-xs text-muted-foreground">Worked out from the weight and height.{dev ? " Sent as 39156-5." : ""}</span>
              </p>
            )}
          </FormSection>

          <FormSection title="How It Was Taken" help="Used for the early warning score and the message.">
            <FormGrid cols={2}>
              <Field label="Consciousness" hint="Alert, new confusion, responds to voice, responds to pain, unresponsive.">
                <Select value={cons} onChange={(e) => setCons(e.target.value as Consciousness)}>{CONSCIOUSNESS.map((c) => <option key={c}>{c}</option>)}</Select>
              </Field>
              <Field label="Blood Pressure Position" hl7={dev ? "OBX 8361-8" : undefined}>
                <Select value={pos} onChange={(e) => setPos(e.target.value)}><option value="">Not recorded</option>{BP_POSITIONS.map((c) => <option key={c}>{c}</option>)}</Select>
              </Field>
              <Field group label="On Oxygen">
                <SegmentedControl options={["Yes", "No"]} value={onOx ? "Yes" : "No"} onChange={(x) => setOnOx(x === "Yes")} label="On oxygen" />
              </Field>
              {onOx && (
                <Field label="Oxygen Flow">
                  <Input placeholder="2" inputMode="decimal" value={o2} onChange={(e) => setO2(e.target.value)} suffix="L/min" className="tabular-nums" />
                </Field>
              )}
            </FormGrid>
          </FormSection>

          <FormSection
            title="Bedside Tests"
            help="Optional. Kept in the HIS only: the national vital signs message has no code for these."
            collapsible
            defaultOpen={hasLocal}
            filled={Object.keys(local).length}
            total={LOCAL_VITALS.length}
          >
            <FormGrid cols={2}>
              {LOCAL_VITALS.map((d) => {
                const raw = localVals[d.key] ?? "";
                const n = d.kind === "number" && raw.trim() !== "" ? Number(raw) : undefined;
                const flag = n !== undefined && !Number.isNaN(n) ? localFlag(d, n, age) : "";
                const off = n !== undefined && left.has(d.key) && (Number.isNaN(n) || (d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max));
                const set = (v: string) => setLocalVals((x) => ({ ...x, [d.key]: v }));
                return (
                  <Field
                    key={d.key}
                    name={d.key}
                    label={d.label}
                    hint={d.range ? `Normal ${d.range.low} to ${d.range.high}` : undefined}
                    error={off ? `Check this value. Expected ${d.min} to ${d.max}.` : undefined}
                  >
                    {d.kind === "number" ? (
                      <div className="flex items-center gap-2">
                        <Input type="number" step={d.step ?? 1} inputMode="decimal" value={raw} onChange={(e) => set(e.target.value)} onBlur={() => leave(d.key)} suffix={d.display} className={cn("tabular-nums", flag && !off && "border-warn")} />
                        {flag && <Badge tone="warn">{flag}</Badge>}
                      </div>
                    ) : (
                      <Select value={raw} onChange={(e) => set(e.target.value)}>
                        <option value="">Not tested</option>
                        {DIPSTICK.map((g) => <option key={g}>{g}</option>)}
                        {raw && !(DIPSTICK as readonly string[]).includes(raw) && <option>{raw}</option>}
                      </Select>
                    )}
                  </Field>
                );
              })}
            </FormGrid>
          </FormSection>

          <FormSection title={correcting ? "Note" : "When And Who"}>
            <FormGrid cols={2}>
              {!correcting && (
                <>
                  <Field label="Why It Was Taken">
                    <Select value={context} onChange={(e) => setContext(e.target.value as PanelContext)}>{CONTEXTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>
                  </Field>
                  <Field group label="Time Taken" hl7={dev ? "OBR-7, OBR-22" : undefined}>
                    <DateTimeInput value={at} onChange={setAt} max={nowLocal()} label="Time taken" />
                  </Field>
                  <Field label="Taken By" hl7={dev ? "OBR-16" : undefined}>
                    <Select value={by} onChange={(e) => setBy(e.target.value)}>
                      <option value="">Not recorded</option>
                      {by && !DOCTORS.some((d) => d.id === by) && <option value={by}>Signed-in user</option>}
                      {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                    </Select>
                  </Field>
                </>
              )}
              <Field label="Note" hl7={dev ? "OBR-NTE" : undefined} className="col-span-full">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
              </Field>
            </FormGrid>
          </FormSection>

          {score && (
            <div className="rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg-strong)] px-4 py-3 shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow)] sm:px-5" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md px-2 py-1 text-sm font-bold tabular-nums", newsTone(score.band))}>NEWS2 {score.total}</span>
                <span className="text-sm font-medium">{score.band} risk</span>
                {!score.complete && <Badge tone="neutral">Partial</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{score.note} Early warning score for adults. Not needed for insurance claims.</p>
              {age < 16 && <p className="mt-1 text-xs text-warn">NEWS2 is for adults. This patient is {age}.</p>}
            </div>
          )}
        </div>

        <FormActions
          className="px-4 sm:px-5"
          status={outOfRange.length > 0 ? <span className="text-warn">{outOfRange.length} {outOfRange.length > 1 ? "values look" : "value looks"} wrong. Check before saving.</span> : <span className="text-xs tabular-nums">{taken} of {VITALS.length} vital signs taken</span>}
          onCancel={close}
          extra={<ReasonButton reason={saveReason} onClick={() => save(false)}>{correcting ? "Save Correction" : "Save"}</ReasonButton>}
          onSave={() => save(true)}
          saveLabel="Save And Send To NPHIES"
          disabledReason={sendReason}
        />
        {dialog}
      </SheetContent>
    </Sheet>
  );
}
