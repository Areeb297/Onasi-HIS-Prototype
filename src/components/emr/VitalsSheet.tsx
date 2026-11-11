import * as React from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Encounter, Patient } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { can } from "@/lib/session";
import { nowLocal } from "@/lib/store";
import { amendPanel, obsValue, savePanel, sendPanel, type VitalPanel } from "@/lib/vitals";
import {
  BP_POSITIONS, CONSCIOUSNESS, CONTEXTS, VITALS, bmiOf, flagFor, news2, refRangeText, type Consciousness, type PanelContext, type VitalKey,
} from "@/lib/vitals-spec";

const ageOf = (p: Patient) => Math.floor((Date.now() - new Date(p.dob).getTime()) / (365.25 * 86_400_000));

export function newsTone(band: string) {
  return band === "High" ? "bg-destructive text-white" : band === "Medium" ? "bg-ctas-2 text-white" : band === "Low-Medium" ? "bg-ctas-3 text-black/80" : "bg-ok/20 text-ok";
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
  const [by, setBy] = React.useState(panel?.recordedBy ?? enc.attending);
  const [note, setNote] = React.useState(panel?.note ?? "");

  const age = ageOf(patient);
  const num = (k: string) => (vals[k]?.trim() !== "" && !Number.isNaN(Number(vals[k])) ? Number(vals[k]) : undefined);
  const nums: Partial<Record<VitalKey, number>> = {};
  for (const v of VITALS) if (num(v.key) !== undefined && !absent[v.key]) nums[v.key] = num(v.key);
  const bmi = nums.weight !== undefined && nums.height !== undefined ? bmiOf(nums.weight, nums.height) : undefined;
  const score = news2(nums, onOx, cons);
  const outOfRange = VITALS.filter((v) => nums[v.key] !== undefined && (nums[v.key]! < v.min || nums[v.key]! > v.max));
  const something = Object.keys(nums).length > 0 || Object.keys(absent).length > 0;
  const canWrite = can("emr.write");

  function save(andSend: boolean) {
    const absences: Record<string, { code: string; label: string }> = {};
    for (const v of VITALS) {
      const code = absent[v.key];
      if (code) absences[v.key] = v.absence.find((a) => a.code === code) ?? { code, label: "Not obtained" };
    }
    let id: string | undefined;
    if (panel) {
      id = amendPanel(panel.id, { values: nums, absences, note })?.id;
    } else {
      id = savePanel({
        visit: enc.visitNumber, at, context, recordedBy: by, values: nums, absences, onOxygen: onOx,
        o2flow: o2 !== "" ? Number(o2) : undefined, position: pos || undefined, consciousness: cons, note: note || undefined,
      })?.id;
    }
    if (andSend && id && can("adt.send")) sendPanel(id);
    onClose();
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{correcting ? "Correct Vital Signs" : "Record Vital Signs"}</SheetTitle>
          <SheetDescription>
            {correcting ? `Panel ${panel!.businessId}. A change after sending goes out as a correction.` : "Take all eight if you can. NPHIES claims need each one, or a reason it was not obtained."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {VITALS.map((v) => {
              const n = num(v.key);
              const flag = n !== undefined && !absent[v.key] ? flagFor(v, n, age) : "";
              const off = n !== undefined && (n < v.min || n > v.max);
              return (
                <div key={v.key} className="rounded-lg border border-border p-2.5">
                  <Field label={`${v.label} (${v.display})`} hl7={dev ? `OBX ${v.loinc}` : undefined}>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" step={v.step ?? 1} inputMode="decimal" disabled={!!absent[v.key]} value={vals[v.key]}
                        onChange={(e) => setVals((x) => ({ ...x, [v.key]: e.target.value }))}
                        className={cn(flag && "border-destructive")} aria-label={v.label} aria-invalid={off}
                      />
                      {flag && <Badge tone={flag.length === 2 ? "danger" : "warn"}>{flag}</Badge>}
                    </div>
                  </Field>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-1.5 text-muted-foreground">
                      <input
                        type="checkbox" checked={!!absent[v.key]} className="accent-[var(--primary)]"
                        onChange={(e) => setAbsent((a) => { const n2 = { ...a }; if (e.target.checked) n2[v.key] = v.absence[0].code; else delete n2[v.key]; return n2; })}
                      />
                      Not obtained
                    </label>
                    {absent[v.key] && (
                      <Select className="h-7 flex-1 text-xs" value={absent[v.key]} aria-label={`${v.label} reason`} onChange={(e) => setAbsent((a) => ({ ...a, [v.key]: e.target.value }))}>
                        {v.absence.map((a) => <option key={a.code} value={a.code}>{a.label} ({a.code}){a.assumed ? " assumed" : ""}</option>)}
                      </Select>
                    )}
                    {!absent[v.key] && v.range && <span className="ms-auto text-muted-foreground">Normal {refRangeText(v)}</span>}
                  </div>
                  {off && <p className="mt-1 text-xs text-warn">Check this value. Expected {v.min} to {v.max}.</p>}
                </div>
              );
            })}
          </div>

          {bmi !== undefined && <p className="text-sm">BMI <strong>{bmi}</strong> kg/m2 <span className="text-xs text-muted-foreground">(calculated and sent as 39156-5)</span></p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Consciousness"><Select value={cons} onChange={(e) => setCons(e.target.value as Consciousness)}>{CONSCIOUSNESS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Blood pressure position" hl7={dev ? "OBX 8361-8" : undefined}><Select value={pos} onChange={(e) => setPos(e.target.value)}><option value="">Not recorded</option>{BP_POSITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={onOx} onChange={(e) => setOnOx(e.target.checked)} className="accent-[var(--primary)]" />On oxygen</label>
              {onOx && <Input className="w-40" placeholder="Flow L/min" inputMode="decimal" value={o2} onChange={(e) => setO2(e.target.value)} aria-label="Oxygen flow" />}
            </div>
          </div>

          {!correcting && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Why was it taken?"><Select value={context} onChange={(e) => setContext(e.target.value as PanelContext)}>{CONTEXTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select></Field>
              <Field label="Time taken" hl7={dev ? "OBR-7, OBR-22" : undefined}><Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
              <Field label="Taken by" hl7={dev ? "OBR-16" : undefined} className="sm:col-span-2"><Select value={by} onChange={(e) => setBy(e.target.value)}>{DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}</Select></Field>
            </div>
          )}
          <Field label="Note" hl7={dev ? "OBR-NTE" : undefined}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>

          {score && (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className={cn("rounded-md px-2 py-1 text-sm font-bold", newsTone(score.band))}>NEWS2 {score.total}</span>
                <span className="text-sm font-medium">{score.band} risk</span>
                {!score.complete && <Badge tone="neutral">Partial</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{score.note} General early warning score for adults. Not an NPHIES requirement.</p>
              {age < 16 && <p className="mt-1 text-xs text-warn">NEWS2 is for adults. This patient is {age}.</p>}
            </div>
          )}
        </div>

        <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t border-border">
          {outOfRange.length > 0 && <span className="me-auto text-xs text-warn">{outOfRange.length} value{outOfRange.length > 1 ? "s" : ""} look wrong.</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button disabled={!something || !canWrite} onClick={() => save(false)}>{correcting ? "Save Correction" : "Save"}</Button>
          <Button variant="primary" disabled={!something || !canWrite || !can("adt.send")} title={can("adt.send") ? undefined : "Your role cannot send messages"} onClick={() => save(true)}>
            Save And Send To NPHIES
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
