import * as React from "react";
import { IconPill, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { SafetyBanner, ControlBadge } from "@/components/emr/RxShared";
import { ErrorSummary, FormField, FormGrid, FormSection, Segmented, WithUnit, YesNo, useValidation, type SegOption } from "@/components/emr/entry-ui";
import { Button, Card, CardHeader, Input, Select, cn } from "@/components/ui/primitives";
import { fmtDate as fmtDay } from "@/lib/format";
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

const SEARCH_BY: SegOption<"generic" | "brand">[] = [{ value: "generic", label: "Generic Name" }, { value: "brand", label: "Brand Name" }];
const REGIMEN_OPTIONS: SegOption<Regimen>[] = REGIMENS.map((r) => ({ value: r.id, label: r.label }));
const UNIT_OPTIONS: SegOption<DurationUnit>[] = DURATION_UNITS.map((u) => ({ value: u.id, label: u.label }));
const USAGE_OPTIONS: SegOption<UsageSetting>[] = [
  { value: "outpatient", label: "Outpatient" },
  { value: "inpatient", label: "Inpatient" },
  { value: "discharge", label: "Discharge" },
  { value: "community", label: "Community" },
];

const today = () => nowLocal().slice(0, 10);
const fmtDate = (d: string) => (d ? fmtDay(`${d}T00:00:00`) : "");
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
  /** What is wrong, field by field. Shown under the field once it is left, or once the add button is pressed. */
  const v = useValidation({
    dose: regimen === "normal" && !(doseN > 0) && "Enter a dose more than 0.",
    days: regimen === "normal" && !(daysN > 0) && "Enter a duration of 1 or more.",
    rows: regimen !== "normal" && !(doseN > 0 && daysN > 0) && "Every row needs a dose and a number of days more than 0.",
    start: !dateOk && "Choose a start date.",
    qty: !(qtyN > 0) && "Enter a quantity more than 0.",
    safety: errors.length > 0 && "Fix the safety problem shown under Safety Checks.",
    override: needOverride && !overrideOk && "Enter the reason for the override, 5 letters or more.",
  });

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
    v.reset();
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
    if (!v.submit() || !drug || !valid) return;
    v.reset();
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
      />
      <fieldset disabled={!canWrite} className="space-y-6 px-4 py-4">
        {!canWrite && <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Your role can read prescriptions but not write them.</p>}
        {drug && <ErrorSummary problems={v.summary} />}

        <FormSection title="Drug" description={editing ? "The drug of an existing item cannot change. Remove the item and add a new one instead." : undefined}>
          {!editing && (
            <div className="space-y-3">
              <FormField group label="Search By">
                <Segmented value={searchBy} options={SEARCH_BY} onChange={setSearchBy} />
              </FormField>
              <div className="relative [--field-h:2.5rem]">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
                        <button onClick={() => pick(d.id)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
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
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Often Prescribed</div>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_DRUG_IDS.map((id) => (
                    <button
                      key={id}
                      aria-pressed={drugId === id}
                      onClick={() => pick(id)}
                      className={cn("min-h-8 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", drugId === id && "border-primary bg-accent text-accent-foreground")}
                    >
                      {getDrug(id).generic}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {drug ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-accent/40 px-3 py-2 text-sm">
              <IconPill className="size-4 text-move" aria-hidden="true" />
              <b>{drugLabel(drug)}</b>
              <span className="text-xs text-muted-foreground">Brand {drug.brand}</span>
              <ControlBadge cls={drug.controlClass} />
              {dev && <span className="font-mono text-xs text-muted-foreground">{drug.code} (test code)</span>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Choose a drug to see the dose, duration and supply fields.</p>
          )}
        </FormSection>

        {drug && (
          <>
            <FormSection title="Dose And Duration">
              <FormField group label="Regimen Type" help={REGIMENS.find((r) => r.id === regimen)?.help} hl7="dosageInstruction (dosing variant)">
                <Segmented value={regimen} options={REGIMEN_OPTIONS} onChange={changeRegimen} />
              </FormField>

              {regimen === "normal" ? (
                <>
                  <FormGrid className="sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.8fr)_auto]">
                    <FormField label="Dose" required error={v.error("dose")} hl7="dosageInstruction.doseAndRate.doseQuantity">
                      <WithUnit unit={drug.unit}>
                        <Input className="pe-16" type="number" min="0" step="any" value={dose} onBlur={v.blur("dose")} onChange={(e) => setDose(e.target.value)} />
                      </WithUnit>
                    </FormField>
                    <FormField label="Frequency" required hl7="dosageInstruction.timing.repeat">
                      <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
                        {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </Select>
                    </FormField>
                    <FormField label="Duration" required error={v.error("days")} help={unit !== "d" && daysN > 0 ? `${daysN} days${unit === "mo" ? ". A month counts as 30 days." : "."}` : undefined} hl7="dispenseRequest.expectedSupplyDuration">
                      <Input type="number" min="1" value={days} onBlur={v.blur("days")} onChange={(e) => { setDays(e.target.value); setQty(null); }} />
                    </FormField>
                    <FormField group label="Duration Unit">
                      <Segmented value={unit} options={UNIT_OPTIONS} onChange={(u) => { setUnit(u); setQty(null); }} />
                    </FormField>
                  </FormGrid>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Quick Duration</span>
                    {DURATION_CHIPS.map((d) => (
                      <button
                        key={d}
                        aria-pressed={unit === "d" && daysN === d}
                        onClick={() => { setDays(String(d)); setUnit("d"); setQty(null); }}
                        className={cn("min-h-7 rounded-full border border-border bg-card px-2.5 py-0.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", unit === "d" && daysN === d && "border-primary bg-accent text-accent-foreground")}
                      >
                        {d} days
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
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
                  {v.error("rows") && (
                    <p role="alert" className="flex items-start gap-1 text-xs font-medium text-destructive">{v.error("rows")}</p>
                  )}
                </>
              )}

              <FormGrid cols={4}>
                <FormField label="Start Date" required error={v.error("start")} hl7="dosageInstruction.timing.repeat.boundsPeriod.start">
                  <Input type="date" value={startDate} onBlur={v.blur("start")} onChange={(e) => { setStartDate(e.target.value); }} />
                </FormField>
                <FormField label="End Date" help={regimen === "normal" ? "Changing it changes the duration." : "Worked out from the rows."} hl7="dosageInstruction.timing.repeat.boundsPeriod.end">
                  <Input type="date" value={endDate} min={startDate} disabled={regimen !== "normal" || !dateOk} onChange={(e) => e.target.value && changeEnd(e.target.value)} />
                </FormField>
                <FormField group label="Only When Needed" hl7="asNeededBoolean" className="sm:col-span-2">
                  <YesNo value={asNeeded} onChange={setAsNeeded} />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Supply">
              <FormGrid cols={4}>
                <FormField label="Quantity" required error={v.error("qty")} help={qty === null ? "Calculated from the dose and duration." : "Typed by you."} hl7="dispenseRequest.quantity">
                  <span className="flex gap-1.5">
                    <span className="min-w-0 flex-1">
                      <WithUnit unit={drug.unit}>
                        <Input className="pe-16" type="number" min="0" step="any" value={qty ?? String(autoQty)} onBlur={v.blur("qty")} onChange={(e) => setQty(e.target.value)} />
                      </WithUnit>
                    </span>
                    {qty !== null && <Button className="h-10" onClick={() => setQty(null)} title="Go back to the calculated quantity">Auto</Button>}
                  </span>
                </FormField>
                <FormField label="Repeats" help={controlled ? "None for narcotic, controlled and restricted drugs." : own ? "None for the patient's own medicine." : "How many times it can be dispensed again."} hl7="dispenseRequest.numberOfRepeatsAllowed">
                  <Input type="number" min="0" max="11" value={controlled || own ? "0" : refills} disabled={controlled || own} onChange={(e) => setRefills(e.target.value)} />
                </FormField>
                <FormField group label="Coverage" help={insured ? "The visit is insured." : "The visit is cash, so Insured is off."}>
                  <Segmented value={coverage} options={[{ value: "Insured", label: "Insured", disabled: !insured }, { value: "Cash", label: "Cash" }]} disabled={own} onChange={setCoverage} />
                </FormField>
                <FormField group label="Medication Provided By Patient" help={editing ? "Cannot change on an existing item. Remove it and add it again." : undefined}>
                  <YesNo value={own} disabled={!!editing} onChange={(x) => { setOwn(x); setQty(null); }} />
                </FormField>
              </FormGrid>
              {own && (
                <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                  Recorded on its own prescription as the patient's own medicine. It is checked for allergies and duplicates, but it is not sent to nphies and the pharmacy does not dispense it.
                </p>
              )}
            </FormSection>

            <FormSection title="Details">
              <FormGrid>
                <FormField label="Route" hl7="dosageInstruction.route">
                  <Select value={route} onChange={(e) => setRoute(e.target.value)}>
                    {ROUTES.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </Select>
                </FormField>
                <FormField label="Reason (Diagnosis)" hl7="reasonCode">
                  <Select value={reasonIdx} onChange={(e) => setReasonIdx(Number(e.target.value))}>
                    {reasons.map((r, i) => <option key={r.code + i} value={i}>{r.code} {r.text}</option>)}
                  </Select>
                </FormField>
                <FormField group label="Setting" hl7="category[1]" help={editing ? "Cannot change on an existing item." : undefined} className="sm:col-span-2">
                  <Segmented value={usage} options={USAGE_OPTIONS} disabled={!!editing} onChange={setUsage} />
                </FormField>
                <FormField label="Instructions For Patient" hl7="dosageInstruction.patientInstruction">
                  <Input placeholder="For example: take after food" value={instr} onChange={(e) => setInstr(e.target.value)} />
                </FormField>
                <FormField label="Note For Pharmacist" help="Optional." hl7="note.text">
                  <Input placeholder="For example: patient cannot swallow tablets" value={note} onChange={(e) => setNote(e.target.value)} />
                </FormField>
              </FormGrid>
            </FormSection>

            {(enc.dx.length === 0 || findings.length > 0 || needOverride) && (
              <FormSection title="Safety Checks">
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
                    <FormField label="Override Reason" required error={v.error("override")} help="Saved to the audit trail with your name.">
                      <Input value={overrideReason} onBlur={v.blur("override")} onChange={(e) => setOverrideReason(e.target.value)} placeholder="For example: allergy history checked with patient, benefit outweighs risk" />
                    </FormField>
                  </div>
                )}
              </FormSection>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              {editing ? <Button onClick={() => { v.reset(); onDone(); }}>Cancel Edit</Button> : <Button onClick={() => { v.reset(); reset(); }}>Clear</Button>}
              <span title={!canWrite ? "You do not have permission to prescribe" : undefined}>
                <Button variant="primary" disabled={!canWrite} onClick={submit}>
                  {editing ? "Save Changes" : own ? "Record Patient's Own Medicine" : "Add To Prescription"}
                </Button>
              </span>
            </div>
          </>
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
              <FormField label={`Time Of Day ${i + 1}`}>
                <Select value={r.time ?? ""} onChange={(e) => onChange(i, { time: (e.target.value || undefined) as DoseTime | undefined })}>
                  <option value="">Not set</option>
                  {DOSE_TIMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              </FormField>
            ) : (
              <div className="pb-2 text-sm">
                <div className="font-medium">Phase {i + 1}</div>
                {dates[i] && <div className="text-xs text-muted-foreground">{fmtDate(dates[i].start)} to {fmtDate(dates[i].end)}</div>}
              </div>
            )}
            <FormField label="Dose">
              <WithUnit unit={unit}>
                <Input className="pe-16" type="number" min="0" step="any" value={r.dose} aria-label={`Row ${i + 1} dose`} onChange={(e) => onChange(i, { dose: e.target.value })} />
              </WithUnit>
            </FormField>
            <FormField label="Frequency">
              <Select value={r.frequencyId} aria-label={`Row ${i + 1} frequency`} onChange={(e) => onChange(i, { frequencyId: e.target.value })}>
                {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            </FormField>
            <FormField label="Days">
              <Input type="number" min="1" step="1" value={r.days} aria-label={`Row ${i + 1} days`} onChange={(e) => onChange(i, { days: e.target.value })} />
            </FormField>
            <button
              onClick={() => onRemove(i)}
              disabled={rows.length <= 2}
              aria-label={`Remove row ${i + 1}`}
              title={rows.length <= 2 ? "A split or taper regimen needs two or more rows" : "Remove Row"}
              className="mb-1 flex size-8 items-center justify-self-end justify-center rounded-full text-cancel hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <IconTrash className="size-[18px]" stroke={1.75} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
