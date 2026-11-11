import * as React from "react";
import { IconPill, IconSearch, IconX } from "@tabler/icons-react";
import { SafetyBanner, ControlBadge } from "@/components/emr/RxShared";
import { Button, Card, CardHeader, Field, Input, Select, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Encounter } from "@/lib/model";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { can, currentUser } from "@/lib/session";
import { activeDrugsOnVisit, addDraftItem, defaultUsage, getDrug, quantityFor, updateItem, useRx } from "@/lib/rx";
import { DRUG_BY_ID, DURATION_CHIPS, FREQUENCIES, QUICK_DRUG_IDS, ROUTES, drugLabel, searchDrugs } from "@/lib/rx-catalogue";
import { isControlled } from "@/lib/rx-logic";
import { checkSafety } from "@/lib/rx-safety";
import { ageOf, measuresFor } from "@/lib/rx-send";
import type { UsageSetting } from "@/lib/rx-types";

/** Fast prescribing form: pick a drug, check dose and days, add. Safety notes stay quiet unless there is a real allergy conflict. */

export function reasonsFor(enc: Encounter) {
  return enc.dx.length ? enc.dx.map((d) => ({ code: d.code, text: d.text })) : [{ code: "R69", text: enc.reason || "Illness, unspecified" }];
}

interface Props {
  enc: Encounter;
  editing: { rxId: string; itemId: string } | null;
  onDone: () => void;
}

export function RxEditor({ enc, editing, onDone }: Props) {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canWrite = can("rx.write");
  const reasons = reasonsFor(enc);

  const [drugId, setDrugId] = React.useState("");
  const [q, setQ] = React.useState("");
  const [dose, setDose] = React.useState("1");
  const [freq, setFreq] = React.useState("BID");
  const [days, setDays] = React.useState("5");
  const [qty, setQty] = React.useState<string | null>(null);
  const [route, setRoute] = React.useState("PO");
  const [asNeeded, setAsNeeded] = React.useState(false);
  const [refills, setRefills] = React.useState("0");
  const [instr, setInstr] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reasonIdx, setReasonIdx] = React.useState(0);
  const [usage, setUsage] = React.useState<UsageSetting>(defaultUsage(enc.cls));
  const [overrideReason, setOverrideReason] = React.useState("");

  const editRx = editing ? s.prescriptions.find((p) => p.id === editing.rxId) : undefined;
  const editItem = editRx?.items.find((i) => i.id === editing?.itemId);

  // Load the item into the form when editing starts.
  React.useEffect(() => {
    if (!editItem || !editRx) return;
    setDrugId(editItem.drugId);
    setDose(String(editItem.dose));
    setFreq(editItem.frequencyId);
    setDays(String(editItem.durationDays));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.rxId, editing?.itemId]);

  const drug = drugId ? DRUG_BY_ID[drugId] : undefined;
  const doseN = parseFloat(dose);
  const daysN = parseInt(days, 10);
  const autoQty = drug && doseN > 0 && daysN > 0 ? quantityFor(drug, doseN, freq, daysN) : 0;
  const qtyN = qty === null ? autoQty : parseFloat(qty);
  const m = measuresFor(s, enc);
  const patientAge = ageOf(his.patients.find((p) => p.id === enc.patientId)?.dob ?? "1990-01-01");

  const findings = React.useMemo(
    () =>
      drug
        ? checkSafety({
            drug,
            dose: doseN,
            frequencyId: freq,
            durationDays: daysN || 0,
            route,
            refills: parseInt(refills, 10) || 0,
            usage,
            allergies: enc.allergies,
            others: activeDrugsOnVisit(s, enc.visitNumber, editing?.itemId),
            heightCm: m.heightCm,
            weightKg: m.weightKg,
            ageYears: patientAge,
          })
        : [],
    [drug, doseN, freq, daysN, route, refills, usage, enc.allergies, s, enc.visitNumber, editing?.itemId, m.heightCm, m.weightKg, patientAge],
  );
  const blocks = findings.filter((f) => f.level === "block");
  const errors = findings.filter((f) => f.level === "error");
  const alreadyOverridden = !!editItem?.allergyOverride;
  const needOverride = blocks.length > 0 && !alreadyOverridden;
  const overrideOk = !needOverride || overrideReason.trim().length >= 5;
  const valid = !!drug && doseN > 0 && daysN > 0 && qtyN > 0 && errors.length === 0 && overrideOk;

  function pick(id: string) {
    const d = getDrug(id);
    setDrugId(id);
    setQ("");
    setDose(String(d.defaultDose));
    setFreq(d.defaultFrequency);
    setDays(String(d.defaultDays));
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
  }

  function submit() {
    if (!drug || !valid) return;
    const base = {
      dose: doseN,
      frequencyId: freq,
      asNeeded,
      durationDays: daysN,
      route,
      patientInstruction: instr.trim(),
      fulfillmentNote: note.trim(),
      refills: parseInt(refills, 10) || 0,
      reason: reasons[reasonIdx] ?? reasons[0],
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
        allergyOverride: needOverride
          ? { reason: overrideReason.trim(), by: currentUser().name, at: new Date().toISOString(), allergy: blocks.map((b) => b.allergy).join(", ") }
          : undefined,
      });
      pushToast({ tone: needOverride ? "warn" : "ok", text: `${drug.generic} added`, detail: needOverride ? "Allergy override saved and logged." : "Added to the prescription. Send it when ready." });
      reset();
    }
  }

  const results = q ? searchDrugs(q, 8) : [];
  const controlled = drug ? isControlled(drug.controlClass) : false;

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
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search drug, brand or class" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search drug" />
              {results.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
                  {results.map((d) => (
                    <li key={d.id}>
                      <button onClick={() => pick(d.id)} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                        <span>
                          {drugLabel(d)} <span className="text-xs text-muted-foreground">{d.brand}</span>
                        </span>
                        <ControlBadge cls={d.controlClass} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              <ControlBadge cls={drug.controlClass} />
              {dev && <span className="font-mono text-xs text-muted-foreground">{drug.code} (test code)</span>}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={`Dose (${drug.unit})`} hl7="dosageInstruction.doseAndRate.doseQuantity">
                <Input type="number" min="0" step="any" value={dose} onChange={(e) => setDose(e.target.value)} />
              </Field>
              <Field label="Frequency" hl7="dosageInstruction.timing.repeat">
                <Select value={freq} onChange={(e) => setFreq(e.target.value)}>
                  {FREQUENCIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </Field>
              <Field label="Duration (days)" hl7="dispenseRequest.expectedSupplyDuration">
                <Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
              </Field>
              <Field label={`Quantity (${drug.unit})`} hint={qty === null ? "Calculated" : "Typed by you"} hl7="dispenseRequest.quantity">
                <div className="flex gap-1.5">
                  <Input type="number" min="0" step="any" value={qty ?? String(autoQty)} onChange={(e) => setQty(e.target.value)} />
                  {qty !== null && <Button size="sm" onClick={() => setQty(null)} title="Go back to the calculated quantity">Auto</Button>}
                </div>
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_CHIPS.map((d) => (
                <button key={d} onClick={() => setDays(String(d))} className={cn("rounded-full border border-border px-2.5 py-0.5 text-xs hover:bg-muted", daysN === d && "border-primary bg-accent text-accent-foreground")}>
                  {d} days
                </button>
              ))}
            </div>

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
              <Field label="Repeats" hint={controlled ? "None for N, C and R" : undefined} hl7="dispenseRequest.numberOfRepeatsAllowed">
                <Input type="number" min="0" max="11" value={controlled ? "0" : refills} disabled={controlled} onChange={(e) => setRefills(e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Instructions For Patient" hl7="dosageInstruction.patientInstruction">
                <Input placeholder="For example: take after food" value={instr} onChange={(e) => setInstr(e.target.value)} />
              </Field>
              <Field label="Note For Pharmacist" hl7="note.text">
                <Input placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} className="size-4 accent-primary" />
              Only when needed
              {dev && <span className="font-mono text-xs text-update">asNeededBoolean</span>}
            </label>

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
                {editing ? "Save Changes" : "Add To Prescription"}
              </Button>
            </span>
          </div>
        )}
      </fieldset>
    </Card>
  );
}
