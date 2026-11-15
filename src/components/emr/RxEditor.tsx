import * as React from "react";
import { IconPill, IconPlus, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { SafetyBanner, ControlBadge } from "@/components/emr/RxShared";
import { Button, Card, CardHeader, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Encounter } from "@/lib/model";
import { visitInsured } from "@/lib/order-fields";
import { nowLocal, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { can, currentUser } from "@/lib/session";
import { activeDrugsOnVisit, addDraftItem, defaultUsage, getDrug, itemQuantity, updateItem, useRx } from "@/lib/rx";
import { DRUG_BY_ID, DURATION_CHIPS, FREQUENCIES, QUICK_DRUG_IDS, ROUTES, drugLabel, searchDrugs } from "@/lib/rx-catalogue";
import {
  DOSE_TIMES, DURATION_UNITS, REGIMENS, daysBetween, endDateFor, fromDays, isControlled, itemDates, orderSteps, regimenDays, regimenOf, stepDates, toDays,
} from "@/lib/rx-logic";
import { checkSafety } from "@/lib/rx-safety";
import { ageOf, measuresFor } from "@/lib/rx-send";
import type { DoseStep, DoseTime, DurationUnit, Regimen, RxCoverage, UsageSetting } from "@/lib/rx-types";

/** Fast prescribing form: pick a drug, check dose and days, add. Safety notes stay quiet unless there is a real allergy conflict. */

export function reasonsFor(enc: Encounter) {
  return enc.dx.length ? enc.dx.map((d) => ({ code: d.code, text: d.text })) : [{ code: "R69", text: enc.reason || "Illness, unspecified" }];
}

interface Props {
  enc: Encounter;
  editing: { rxId: string; itemId: string } | null;
  onDone: () => void;
}

/** A split or taper row as typed. Numbers stay text until the form is saved. */
interface RowDraft {
  dose: string;
  frequencyId: string;
  days: string;
  time?: DoseTime;
}

const today = () => nowLocal().slice(0, 10);
const fmtDate = (d: string) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const parseRows = (rows: RowDraft[]): DoseStep[] =>
  rows.map((r) => ({ dose: parseFloat(r.dose) || 0, frequencyId: r.frequencyId, days: parseInt(r.days, 10) || 0, ...(r.time ? { time: r.time } : {}) }));

export function RxEditor({ enc, editing, onDone }: Props) {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canWrite = can("rx.write");
  const reasons = reasonsFor(enc);
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const insured = visitInsured(patient);

  const [drugId, setDrugId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [searchBy, setSearchBy] = React.useState<"generic" | "brand">("generic");
  const [regimen, setRegimen] = React.useState<Regimen>("normal");
  const [rows, setRows] = React.useState<RowDraft[]>([]);
  const [dose, setDose] = React.useState("1");
  const [freq, setFreq] = React.useState("BID");
  const [days, setDays] = React.useState("5");
  const [unit, setUnit] = React.useState<DurationUnit>("d");
  const [startDate, setStartDate] = React.useState(today());
  const [qty, setQty] = React.useState<string | null>(null);
  const [route, setRoute] = React.useState("PO");
  const [asNeeded, setAsNeeded] = React.useState(false);
  const [refills, setRefills] = React.useState("0");
  const [instr, setInstr] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reasonIdx, setReasonIdx] = React.useState(0);
  const [usage, setUsage] = React.useState<UsageSetting>(defaultUsage(enc.cls));
  const [overrideReason, setOverrideReason] = React.useState("");
  const [own, setOwn] = React.useState(false);
  const [coverage, setCoverage] = React.useState<RxCoverage>(insured ? "Insured" : "Cash");

  const editRx = editing ? s.prescriptions.find((p) => p.id === editing.rxId) : undefined;
  const editItem = editRx?.items.find((i) => i.id === editing?.itemId);

  // Load the item into the form when editing starts. Older items have no regimen, unit or start date and open as normal, in days.
  React.useEffect(() => {
    if (!editItem || !editRx) return;
    const reg = regimenOf(editItem);
    const shown = fromDays(editItem.durationDays, editItem.durationUnit ?? "d");
    setDrugId(editItem.drugId);
    setRegimen(reg);
    setRows(reg === "normal" ? [] : (editItem.schedule ?? []).map((r) => ({ dose: String(r.dose), frequencyId: r.frequencyId, days: String(r.days), time: r.time })));
    setDose(String(editItem.dose));
    setFreq(editItem.frequencyId);
    setDays(String(shown.value));
    setUnit(shown.unit);
    setStartDate(itemDates(editItem, editRx.authoredAt).start);
    setQty(editItem.quantityManual ? String(editItem.quantity) : null);
    setRoute(editItem.route);
    setAsNeeded(editItem.asNeeded);
    setRefills(String(editItem.refills));
    setInstr(editItem.patientInstruction);
    setNote(editItem.fulfillmentNote);
    const idx = reasons.findIndex((r) => r.code === editItem.reason.code);
    setReasonIdx(idx >= 0 ? idx : 0);
    setUsage(editRx.usage);
    setOverrideReason("");
    setOwn(!!editItem.patientProvided);
    setCoverage(editItem.coverage ?? (insured ? "Insured" : "Cash"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.rxId, editing?.itemId]);

  const drug = drugId ? DRUG_BY_ID[drugId] : undefined;
  const steps = parseRows(rows);
  const doseN = regimen === "normal" ? parseFloat(dose) : steps[0]?.dose ?? 0;
  const freqId = regimen === "normal" ? freq : steps[0]?.frequencyId ?? freq;
  const daysN = regimen === "normal" ? toDays(parseFloat(days) || 0, unit) : regimenDays(regimen, steps);
  const shape = { regimen, schedule: regimen === "normal" ? undefined : steps, dose: doseN, frequencyId: freqId, durationDays: daysN };
  const autoQty = drug && doseN > 0 && daysN > 0 ? itemQuantity(drug, shape) : 0;
  const qtyN = qty === null ? autoQty : parseFloat(qty);
  const endDate = daysN > 0 && startDate ? endDateFor(startDate, daysN) : "";
  const m = measuresFor(s, enc);
  const patientAge = ageOf(patient?.dob ?? "1990-01-01");
  const controlled = drug ? isControlled(drug.controlClass) : false;

  const findings = React.useMemo(
    () =>
      drug
        ? checkSafety({
            drug,
            dose: doseN,
            frequencyId: freqId,
            durationDays: daysN || 0,
            regimen,
            schedule: shape.schedule,
            route,
            refills: own ? 0 : parseInt(refills, 10) || 0,
            usage,
            allergies: enc.allergies,
            others: activeDrugsOnVisit(s, enc.visitNumber, editing?.itemId),
            heightCm: m.heightCm,
            weightKg: m.weightKg,
            ageYears: patientAge,
            patientProvided: own,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drug, doseN, freqId, daysN, regimen, JSON.stringify(rows), route, refills, usage, own, enc.allergies, s, enc.visitNumber, editing?.itemId, m.heightCm, m.weightKg, patientAge],
  );
  const blocks = findings.filter((f) => f.level === "block");
  const errors = findings.filter((f) => f.level === "error");
  const alreadyOverridden = !!editItem?.allergyOverride;
  const needOverride = blocks.length > 0 && !alreadyOverridden;
  const overrideOk = !needOverride || overrideReason.trim().length >= 5;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(startDate);
  const valid = !!drug && doseN > 0 && daysN > 0 && qtyN > 0 && dateOk && errors.length === 0 && overrideOk;

  function pick(id: string) {
    const d = getDrug(id);
    setDrugId(id);
    setQ("");
    setDose(String(d.defaultDose));
    setFreq(d.defaultFrequency);
    setDays(String(d.defaultDays));
    setUnit("d");
    setRegimen("normal");
    setRows([]);
    setRoute(d.defaultRoute);
    setQty(null);
    setRefills("0");
    setOverrideReason("");
    if (isControlled(d.controlClass) && usage === "inpatient" && enc.cls !== "I") setUsage("outpatient");
  }

  function reset() {
    setDrugId("");
    setQ("");
    setQty(null);
    setInstr("");
    setNote("");
    setOverrideReason("");
    setAsNeeded(false);
    setRefills("0");
    setRegimen("normal");
    setRows([]);
    setUnit("d");
    setStartDate(today());
    setOwn(false);
    setCoverage(insured ? "Insured" : "Cash");
  }

  /** Switching to split or taper starts two rows from what is in the form. Going back to normal keeps the first row. */
  function changeRegimen(next: Regimen) {
    if (next === regimen) return;
    if (next === "normal") {
      const first = rows[0];
      if (first) {
        setDose(first.dose);
        setFreq(first.frequencyId);
        setDays(first.days);
        setUnit("d");
      }
      setRows([]);
    } else if (rows.length >= 2) {
      setRows(rows.map((r, i) => ({ ...r, time: next === "split" ? r.time ?? (i === 0 ? "MORN" : "EVE") : undefined })));
    } else {
      const d = String(toDays(parseFloat(days) || 1, unit) || 1);
      setRows(
        next === "split"
          ? [{ dose, frequencyId: "OD", days: d, time: "MORN" }, { dose, frequencyId: "OD", days: d, time: "EVE" }]
          : [{ dose, frequencyId: freq, days: d }, { dose, frequencyId: freq, days: d }],
      );
    }
    setRegimen(next);
    setQty(null);
  }

  const setRow = (i: number, patch: Partial<RowDraft>) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setQty(null);
  };
  function addRow() {
    const last = rows[rows.length - 1] ?? { dose, frequencyId: freq, days: "1" };
    const used = new Set(rows.map((r) => r.time));
    const time = regimen === "split" ? DOSE_TIMES.find((t) => !used.has(t.id))?.id : undefined;
    setRows([...rows, { ...last, time }]);
    setQty(null);
  }

  /** Typing an end date changes the duration. It stays in the chosen unit when the days divide evenly, otherwise it shows days. */
  function changeEnd(end: string) {
    const n = daysBetween(startDate, end);
    if (n <= 0) return pushToast({ tone: "warn", text: "End date is before the start date", detail: "Pick an end date on or after the start date." });
    const next = fromDays(n, unit);
    setDays(String(next.value));
    setUnit(next.unit);
    setQty(null);
  }

  function submit() {
    if (!drug || !valid) return;
    const base = {
      dose: doseN,
      frequencyId: freqId,
      asNeeded,
      durationDays: daysN,
      route,
      patientInstruction: instr.trim(),
      fulfillmentNote: note.trim(),
      refills: own ? 0 : parseInt(refills, 10) || 0,
      reason: reasons[reasonIdx] ?? reasons[0],
      regimen,
      schedule: regimen === "normal" ? undefined : orderSteps(regimen, steps),
      durationUnit: regimen === "normal" ? unit : ("d" as DurationUnit),
      startDate,
      coverage,
    };
    if (editing) {
      updateItem(editing.rxId, editing.itemId, qty === null ? { ...base, quantityManual: false } : { ...base, quantity: qtyN });
      pushToast({ tone: "ok", text: "Item updated", detail: editRx?.sentAt ? "Send the update to nphies to replace the sent version." : undefined });
      onDone();
    } else {
      addDraftItem(enc, {
        ...base,
        drugId: drug.id,
        quantity: qty === null ? undefined : qtyN,
        usage,
        patientProvided: own,
        allergyOverride: needOverride
          ? { reason: overrideReason.trim(), by: currentUser().name, at: new Date().toISOString(), allergy: blocks.map((b) => b.allergy).join(", ") }
          : undefined,
      });
      pushToast({
        tone: needOverride ? "warn" : "ok",
        text: `${drug.generic} added`,
        detail: needOverride ? "Allergy override saved and logged." : own ? "Recorded as the patient's own medicine. It is not sent for dispensing." : "Added to the prescription. Send it when ready.",
      });
      reset();
    }
  }

  const results = q ? searchDrugs(q, 8, searchBy) : [];
  const rowDates = regimen === "normal" || !dateOk ? [] : stepDates(regimen, steps.map((x) => ({ ...x, days: Math.max(1, x.days) })), startDate);

  return (
    <Card>
      <CardHeader
        title={editing ? "Edit Prescription Item" : "New Prescription Item"}
        subtitle={editing ? "Change the item, then send the update." : "Pick a drug. Dose, days and quantity fill in for you."}
        right={editing ? <Button size="sm" onClick={onDone}><IconX className="size-4" />Cancel Edit</Button> : undefined}
      />
      <fieldset disabled={!canWrite} className="space-y-4 px-4 py-4">
        {!editing && (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-muted-foreground" id="rx-search-by">Search By</span>
              <div role="radiogroup" aria-labelledby="rx-search-by" className="inline-flex rounded-md border border-border p-0.5">
                {(["generic", "brand"] as const).map((b) => (
                  <button
                    key={b}
                    role="radio"
                    aria-checked={searchBy === b}
                    onClick={() => setSearchBy(b)}
                    className={cn("rounded px-2.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", searchBy === b ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted")}
                  >
                    {b === "generic" ? "Generic Name" : "Brand Name"}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={searchBy === "generic" ? "Search by generic name, for example paracetamol" : "Search by brand name, for example Paracip"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label={searchBy === "generic" ? "Search drug by generic name" : "Search drug by brand name"}
              />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                  {results.map((d) => (
                    <li key={d.id}>
                      <button onClick={() => pick(d.id)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                        <span>
                          {searchBy === "brand" ? (
                            <><b>{d.brand}</b> <span className="text-xs text-muted-foreground">{drugLabel(d)}</span></>
                          ) : (
                            <>{drugLabel(d)} <span className="text-xs text-muted-foreground">{d.brand}</span></>
                          )}
                        </span>
                        <ControlBadge cls={d.controlClass} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {q.trim() && results.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No drug found with that {searchBy === "generic" ? "generic" : "brand"} name.</p>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_DRUG_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => pick(id)}
                  className={cn("rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted", drugId === id && "border-primary bg-accent text-accent-foreground")}
                >
                  {getDrug(id).generic}
                </button>
              ))}
            </div>
          </div>
        )}

        {drug ? (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <IconPill className="size-4 text-move" />
              <b>{drugLabel(drug)}</b>
              <span className="text-xs text-muted-foreground">Brand {drug.brand}</span>
              <ControlBadge cls={drug.controlClass} />
              {dev && <span className="font-mono text-xs text-muted-foreground">{drug.code} (test code)</span>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Regimen Type" hint={REGIMENS.find((r) => r.id === regimen)?.help} hl7="dosageInstruction (dosing variant)">
                <Select value={regimen} onChange={(e) => changeRegimen(e.target.value as Regimen)}>
                  {REGIMENS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
              <Field label="Start Date" hl7="dosageInstruction.timing.repeat.boundsPeriod.start">
                <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} />
              </Field>
              <Field label="End Date" hint={regimen === "normal" ? "Changes the duration" : "Worked out from the rows"} hl7="dosageInstruction.timing.repeat.boundsPeriod.end">
                <Input type="date" value={endDate} min={startDate} disabled={regimen !== "normal" || !dateOk} onChange={(e) => e.target.value && changeEnd(e.target.value)} />
              </Field>
              <Field label={`Quantity (${drug.unit})`} hint={qty === null ? "Calculated" : "Typed by you"} hl7="dispenseRequest.quantity">
                <div className="flex gap-1.5">
                  <Input type="number" min="0" step="any" value={qty ?? String(autoQty)} onChange={(e) => setQty(e.target.value)} />
                  {qty !== null && <Button size="sm" onClick={() => setQty(null)} title="Go back to the calculated quantity">Auto</Button>}
                </div>
              </Field>
            </div>

            {regimen === "normal" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={`Dose (${drug.unit})`} hl7="dosageInstruction.doseAndRate.doseQuantity">
                    <Input type="number" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} />
                  </Field>
                  <Field label="Frequency" hl7="dosageInstruction.timing.repeat">
                    <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
                      {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Duration" hint={unit !== "d" && daysN > 0 ? `${daysN} days` : undefined} hl7="dispenseRequest.expectedSupplyDuration">
                    <Input type="number" min="1" value={days} onChange={(e) => { setDays(e.target.value); setQty(null); }} />
                  </Field>
                  <Field label="Duration Unit" hint={unit === "mo" ? "A month counts as 30 days" : undefined}>
                    <Select value={unit} onChange={(e) => { setUnit(e.target.value as DurationUnit); setQty(null); }}>
                      {DURATION_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_CHIPS.map((d) => (
                    <button key={d} onClick={() => { setDays(String(d)); setUnit("d"); setQty(null); }} className={cn("rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted", unit === "d" && daysN === d && "border-primary bg-accent text-accent-foreground")}>
                      {d} days
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <ScheduleRows
                regimen={regimen}
                rows={rows}
                dates={rowDates}
                unit={drug.unit}
                totalDays={daysN}
                onChange={setRow}
                onAdd={addRow}
                onRemove={(i) => { setRows(rows.filter((_, j) => j !== i)); setQty(null); }}
              />
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Route" hl7="dosageInstruction.route">
                <Select value={route} onChange={(e) => setRoute(e.target.value)}>
                  {ROUTES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                </Select>
              </Field>
              <Field label="Reason (Diagnosis)" hl7="reasonCode">
                <Select value={reasonIdx} onChange={(e) => setReasonIdx(Number(e.target.value))}>
                  {reasons.map((r, i) => <option key={r.code + i} value={i}>{r.code} {r.text}</option>)}
                </Select>
              </Field>
              <Field label="Setting" hl7="category[1]">
                <Select value={usage} onChange={(e) => setUsage(e.target.value as UsageSetting)} disabled={!!editing}>
                  <option value="outpatient">Outpatient</option>
                  <option value="inpatient">Inpatient</option>
                  <option value="discharge">Discharge</option>
                  <option value="community">Community</option>
                </Select>
              </Field>
              <Field label="Repeats" hint={controlled ? "None for N, C and R" : own ? "None for the patient's own medicine" : undefined} hl7="dispenseRequest.numberOfRepeatsAllowed">
                <Input type="number" min="0" max="11" value={controlled || own ? "0" : refills} disabled={controlled || own} onChange={(e) => setRefills(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Coverage" hint={insured ? "From the visit: insured" : "From the visit: cash"}>
                <Select value={coverage} onChange={(e) => setCoverage(e.target.value as RxCoverage)} disabled={own}>
                  <option value="Insured" disabled={!insured}>Insured</option>
                  <option value="Cash">Cash</option>
                </Select>
              </Field>
              <Field label="Instructions For Patient" hl7="dosageInstruction.patientInstruction" className="lg:col-span-2">
                <Input placeholder="For example: take after food" value={instr} onChange={(e) => setInstr(e.target.value)} />
              </Field>
              <Field label="Note For Pharmacist" hl7="note.text">
                <Input placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} className="size-4 accent-primary" />
                Only when needed
                {dev && <span className="font-mono text-xs text-update">asNeededBoolean</span>}
              </label>
              <label className="flex items-center gap-2 text-sm" title={editing ? "This cannot be changed on an existing item. Remove it and add it again." : undefined}>
                <input type="checkbox" checked={own} disabled={!!editing} onChange={(e) => { setOwn(e.target.checked); setQty(null); }} className="size-4 accent-primary" />
                Medication Provided By Patient
              </label>
            </div>
            {own && (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                Recorded on its own prescription as the patient's own medicine. It is checked for allergies and duplicates, but it is not sent to nphies and the pharmacy does not dispense it.
              </p>
            )}

            {enc.dx.length === 0 && (
              <SafetyBanner f={{ id: "dx", kind: "measure", level: "info", text: "No diagnosis on this visit yet. Add one in the Diagnosis tab. The visit reason is used until then." }} />
            )}
            {findings.length > 0 && (
              <div className="space-y-1.5" aria-live="polite">
                {findings.map((f) => <SafetyBanner key={f.id} f={f} />)}
              </div>
            )}
            {needOverride && (
              <div className="rounded-md border border-destructive/40 p-3">
                <Field label="Override Reason (Required)" hint="This is saved to the audit trail with your name.">
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="For example: allergy history checked with patient, benefit outweighs risk" />
                </Field>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Choose a drug above to start.</p>
        )}
        {drug && (
          <div className="flex justify-end">
            <span title={!canWrite ? "You do not have permission to prescribe" : !valid ? (needOverride && !overrideOk ? "Enter an override reason for the allergy conflict" : "Fix the items marked above") : undefined}>
              <Button variant="primary" disabled={!valid || !canWrite} onClick={submit}>
                {editing ? "Save Changes" : own ? "Record Patient's Own Medicine" : "Add To Prescription"}
              </Button>
            </span>
          </div>
        )}
      </fieldset>
    </Card>
  );
}

/* ---------- split and taper rows ---------- */

function ScheduleRows({
  regimen, rows, dates, unit, totalDays, onChange, onAdd, onRemove,
}: {
  regimen: Regimen;
  rows: RowDraft[];
  dates: { start: string; end: string }[];
  unit: string;
  totalDays: number;
  onChange: (i: number, patch: Partial<RowDraft>) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
}) {
  const split = regimen === "split";
  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="text-xs">
          <span className="font-semibold">{split ? "Split Doses" : "Taper Phases"}</span>
          <span className="text-muted-foreground"> · {split ? "taken together every day" : "one after the other"} · {totalDays} days in all</span>
        </div>
        <Button size="sm" onClick={onAdd} disabled={rows.length >= (split ? DOSE_TIMES.length : 8)}><IconPlus className="size-4" />Add Row</Button>
      </div>
      <div className="space-y-2 p-3">
        {rows.map((r, i) => (
          <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_auto]">
            {split ? (
              <Field label={`Time Of Day ${i + 1}`}>
                <Select value={r.time ?? ""} onChange={(e) => onChange(i, { time: (e.target.value || undefined) as DoseTime | undefined })}>
                  <option value="">Not set</option>
                  {DOSE_TIMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </Field>
            ) : (
              <div className="pb-2 text-sm">
                <div className="font-medium">Phase {i + 1}</div>
                {dates[i] && <div className="text-xs text-muted-foreground">{fmtDate(dates[i].start)} to {fmtDate(dates[i].end)}</div>}
              </div>
            )}
            <Field label={`Dose (${unit})`}>
              <Input type="number" min="0" step="any" value={r.dose} aria-label={`Row ${i + 1} dose`} onChange={(e) => onChange(i, { dose: e.target.value })} />
            </Field>
            <Field label="Frequency">
              <Select value={r.frequencyId} aria-label={`Row ${i + 1} frequency`} onChange={(e) => onChange(i, { frequencyId: e.target.value })}>
                {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </Field>
            <Field label="Days">
              <Input type="number" min="1" step="1" value={r.days} aria-label={`Row ${i + 1} days`} onChange={(e) => onChange(i, { days: e.target.value })} />
            </Field>
            <button
              onClick={() => onRemove(i)}
              disabled={rows.length <= 2}
              aria-label={`Remove row ${i + 1}`}
              title={rows.length <= 2 ? "A split or taper regimen needs two or more rows" : "Remove Row"}
              className="mb-1 flex size-8 items-center justify-center rounded-full text-cancel hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <IconTrash className="size-[18px]" stroke={1.75} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
