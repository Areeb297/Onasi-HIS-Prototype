import * as React from "react";
import { IconBarcode, IconCheck, IconScan, IconSend, IconUsers, IconX } from "@tabler/icons-react";
import { ControlBadge, MessageViewer, PatientStrip, SafetyBanner, VerifyBadge } from "@/components/emr/RxShared";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Patient } from "@/lib/model";
import { DOCTORS } from "@/lib/reference-data";
import { fillOf, getDrug, useRx } from "@/lib/rx";
import { OVERRIDE_REASONS } from "@/lib/rx-catalogue";
import { classifyDispense, isControlled, isRaqeebScope } from "@/lib/rx-logic";
import { allergyMatch } from "@/lib/rx-safety";
import { measuresFor, planDispense } from "@/lib/rx-send";
import { batchesFor, firstUsableBatch, fmtExpiry, isExpired, stockProblem, totalOnHand } from "@/lib/rx-stock";
import type { Dispense, FillType, Prescription } from "@/lib/rx-types";
import { dispenseChecked, dispenseGate, orderLine, pharmacyItems, secureProblems, witnessProblems } from "@/lib/rx-verify";
import { can, currentUser } from "@/lib/session";
import { pushToast } from "@/lib/toast";
import { useHis } from "@/lib/store";

/**
 * Dispense dialog. For each verified item: the order (dose, route, frequency, prescriber), the patient's allergies and weight,
 * the batch to take from and the quantity. Then the wristband and drug scans, the witness for controlled drugs,
 * the Raqeeb secure code choice, and send.
 */

const TYPE_TEXT: Record<FillType, string> = {
  FF: "Full Dispense",
  FFP: "Part Of The Fill",
  FFC: "Completes The Fill",
  RF: "Full Refill",
  RFP: "Part Of A Refill",
  RFC: "Completes A Refill",
};

type SecureMode = "" | "authenticated" | "override";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const round = (n: number) => Math.round(n * 1e4) / 1e4;

export function DispenseDialog({ rx, focusItemId, onClose }: { rx: Prescription; focusItemId?: string; onClose: () => void }) {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canDispense = can("rx.dispense");
  const user = currentUser();
  const patient = his.patients.find((p) => p.id === rx.patientId) as Patient | undefined;
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const allergies = enc?.allergies ?? [];
  const weightKg = enc ? measuresFor(s, enc).weightKg : undefined;
  const doctor = DOCTORS.find((d) => d.id === rx.prescriberId);
  const all = pharmacyItems(s, rx);
  const items = all.filter((x) => x.status === "verified").map((x) => x.item);
  const waiting = all.filter((x) => x.status !== "verified");
  const raqeeb = isRaqeebScope(rx.controlled, rx.usage);

  const [picked, setPicked] = React.useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, !focusItemId || i.id === focusItemId])));
  const [qty, setQty] = React.useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(fillOf(s, rx, i).remaining)])));
  const [lot, setLot] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((i) => [i.id, firstUsableBatch(batchesFor(getDrug(i.drugId), s.dispenses))?.lot ?? ""])),
  );
  const [drugScan, setDrugScan] = React.useState<Record<string, string>>({});
  const [patientScan, setPatientScan] = React.useState("");
  const [skip, setSkip] = React.useState(false);
  const [skipReason, setSkipReason] = React.useState("");
  const [secureMode, setSecureMode] = React.useState<SecureMode>("");
  const [otp, setOtp] = React.useState("");
  const [justify, setJustify] = React.useState("");
  const [witnessName, setWitnessName] = React.useState("");
  const [witnessNo, setWitnessNo] = React.useState("");
  const [problems, setProblems] = React.useState<string[]>([]);

  const patientOk = !!patient && (same(patientScan, patient.mrn) || same(patientScan, patient.healthId));
  const chosen = items.filter((i) => picked[i.id]);
  const anyControlled = chosen.some((i) => isControlled(getDrug(i.drugId).controlClass));
  const drugOk = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return false;
    const d = getDrug(it.drugId);
    const v = drugScan[id] ?? "";
    return same(v, d.barcode) || same(v, d.code);
  };

  const secure: Dispense["secure"] = !raqeeb || !secureMode ? undefined : secureMode === "authenticated" ? { mode: "authenticated", value: otp.trim() } : { mode: "override", justification: justify };
  const witness = anyControlled ? { name: witnessName, staffNo: witnessNo } : undefined;
  const request = {
    rxId: rx.id,
    lines: chosen.map((i) => {
      const batch = batchesFor(getDrug(i.drugId), s.dispenses).find((b) => b.lot === lot[i.id]);
      return { itemId: i.id, quantity: parseFloat(qty[i.id] ?? "0") || 0, lot: batch?.lot, expiry: batch?.expiry };
    }),
    secure,
    witness,
    verification: skip
      ? { patientScan: false, drugScans: [] as string[], skippedReason: skipReason.trim() }
      : { patientScan: patientOk, drugScans: chosen.filter((i) => drugOk(i.id)).map((i) => i.id) },
  };
  const key = JSON.stringify(request);
  const plan = React.useMemo(() => planDispense(s, request, true), [s, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const gate = React.useMemo(() => dispenseGate(s, request), [s, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const skipMissing = skip && skipReason.trim().length < 5;

  // Stock messages sit beside the batch. Everything else that is still needed goes in one list above the buttons.
  const stockText: Record<string, string | null> = {};
  for (const i of chosen) {
    const d = getDrug(i.drugId);
    const line = request.lines.find((l) => l.itemId === i.id);
    stockText[i.id] = stockProblem(d, batchesFor(d, s.dispenses), line?.lot, line?.quantity ?? 0, fillOf(s, rx, i).remaining);
  }
  const shownBeside = new Set(Object.values(stockText).filter(Boolean) as string[]);
  const needed = [
    ...(chosen.length === 0 ? [] : gate.filter((g) => !shownBeside.has(g))),
    ...(chosen.length === 0 ? ["Pick at least one item."] : plan?.problems ?? []),
    ...(skipMissing ? ["Type the reason for skipping the scan."] : []),
  ].filter((x, i, a) => a.indexOf(x) === i);
  const ready = canDispense && chosen.length > 0 && gate.length === 0 && (plan?.problems.length ?? 1) === 0 && !skipMissing;

  function submit() {
    const res = dispenseChecked(request);
    setProblems(res.problems);
    if (!res.outcome) return;
    if (res.outcome.ok) {
      const left = chosen
        .map((i) => ({ d: getDrug(i.drugId), rest: round(fillOf(s, rx, i).remaining - (request.lines.find((l) => l.itemId === i.id)?.quantity ?? 0)) }))
        .filter((x) => x.rest > 0);
      pushToast({
        tone: "ok",
        text: left.length ? "Part dispensed and sent to nphies" : "Dispense sent to nphies",
        detail: left.length
          ? `Still on the worklist: ${left.map((x) => `${x.d.generic} ${x.rest} ${x.d.unit}`).join(", ")}.`
          : res.outcome.refId ? `Raqeeb reference id ${res.outcome.refId}` : "Accepted (201).",
      });
      onClose();
    } else {
      pushToast({ tone: "danger", text: "Dispense was rejected", detail: res.outcome.record.checks.find((c) => c.level === "error")?.text });
    }
  }

  const witnessIssues = anyControlled ? witnessProblems(witness, user) : [];
  const witnessSame = witnessIssues.find((w) => w.startsWith("The witness cannot"));
  const secureIssue = secureProblems(raqeeb, secure)[0];
  const nums = new Set(s.dispenses.filter((d) => d.rxId === rx.id).map((d) => d.number));
  const sentHere = s.sends.filter((x) => x.kind === "dispense" && nums.has(x.targetId));
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`Dispense ${rx.number}`}
      subtitle={`${rx.usage === "discharge" ? "Take-home medicine at discharge" : `${rx.usage[0].toUpperCase()}${rx.usage.slice(1)} prescription`} · Prescriber ${doctor ? `Dr. ${doctor.given} ${doctor.family}` : rx.prescriberId}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <span title={!canDispense ? "You do not have permission to dispense" : !ready ? needed[0] ?? Object.values(stockText).find(Boolean) ?? undefined : undefined}>
            <Button variant="primary" disabled={!ready} onClick={submit}>
              <IconSend className="size-4" />
              Dispense And Send To NPHIES
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <PatientStrip patient={patient} allergies={allergies} weightKg={weightKg} visit={rx.visitNumber} />
        <RequiredNote />

        {rx.items.map((i) => {
          const d = getDrug(i.drugId);
          const hits = allergies.filter((a) => allergyMatch(d, a.text) === "direct");
          return hits.length ? (
            <SafetyBanner
              key={i.id}
              f={{ id: i.id, kind: "allergy", level: "block", text: `${d.generic}: the patient is allergic to ${hits.map((h) => h.text).join(", ")}. ${i.allergyOverride ? `The prescriber overrode this: ${i.allergyOverride.reason}.` : "Check with the prescriber."}` }}
            />
          ) : null;
        })}

        {waiting.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
            <div className="mb-1 font-semibold">Not Ready To Dispense</div>
            <ul className="space-y-1">
              {waiting.map(({ item, status }) => {
                const d = getDrug(item.drugId);
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-2">
                    <span>{d.generic} {d.strengthValue} {d.strengthUnit}</span>
                    <VerifyBadge status={status} />
                    <span className="text-muted-foreground">Only a verified item can be dispensed.</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-muted-foreground">{waiting.length ? "No verified item on this prescription yet. Open the check sheet from the worklist first." : "Nothing left to dispense on this prescription."}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((i) => {
              const d = getDrug(i.drugId);
              const f = fillOf(s, rx, i);
              const q = parseFloat(qty[i.id] ?? "0") || 0;
              const type = classifyDispense(f, q);
              const scanned = drugScan[i.id] ?? "";
              const o = orderLine(d, i);
              const batches = batchesFor(d, s.dispenses);
              const on = !!picked[i.id];
              const rest = round(f.remaining - q);
              return (
                <li key={i.id} className="rounded-lg border border-border p-3">
                  <label className="flex flex-wrap items-center gap-2">
                    <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })} />
                    <span className="font-semibold">{d.generic} {d.strengthValue} {d.strengthUnit}</span>
                    <span className="text-xs text-muted-foreground">{d.form} · Product {d.brand}</span>
                    <ControlBadge cls={d.controlClass} />
                    {dev && <span className="font-mono text-xs text-update">{i.identifier}</span>}
                  </label>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <dl className="space-y-1 text-xs">
                      <Row label="Dose" value={o.dose} />
                      <Row label="Route" value={o.route} />
                      <Row label="Frequency" value={`${o.frequency}, ${o.duration}`} />
                      <Row label="Prescriber" value={doctor ? `Dr. ${doctor.given} ${doctor.family}` : rx.prescriberId} />
                      <Row label="Allergies" value={allergies.length ? allergies.map((a) => a.text).join(", ") : "None recorded"} strong={allergies.length > 0} />
                      <Row label="Weight" value={weightKg ? `${weightKg} kg` : "Not recorded"} />
                      {i.fulfillmentNote && <Row label="Note To Pharmacy" value={i.fulfillmentNote} />}
                      {i.verify?.status === "verified" && <Row label="Verified By" value={`${i.verify.by} (${i.verify.byId})`} />}
                    </dl>
                    <div className="space-y-2">
                      <div className="text-xs font-medium">
                        Remaining {f.remaining} of {i.quantity} {d.unit}
                        <span className="ml-2 font-normal text-muted-foreground">In stock: {totalOnHand(batches)} {d.unit}</span>
                      </div>
                      <Field label="Batch" required hint="Earliest expiry first.">
                        <Select value={lot[i.id] ?? ""} disabled={!on} onChange={(e) => setLot({ ...lot, [i.id]: e.target.value })}>
                          <option value="">Choose a batch</option>
                          {batches.map((b) => (
                            <option key={b.lot} value={b.lot} disabled={b.onHand <= 0 || isExpired(b)}>
                              {b.lot}, expires {fmtExpiry(b.expiry)}, {b.onHand} {d.unit} in stock{isExpired(b) ? " (expired)" : b.onHand <= 0 ? " (empty)" : ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={`Quantity To Dispense (${d.unit})`} required>
                        <Input type="number" min="0" step="any" value={qty[i.id] ?? ""} disabled={!on} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
                      </Field>
                      {on && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={type === "FF" || type === "RF" ? "ok" : type.endsWith("C") ? "move" : "warn"}>{TYPE_TEXT[type]}</Badge>
                          {dev && <span className="font-mono text-xs text-update">{type}</span>}
                          {q > 0 && rest > 0 && <span className="text-xs text-muted-foreground">Part dispense. {rest} {d.unit} stay on the worklist.</span>}
                        </div>
                      )}
                      {on && stockText[i.id] && <div role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-xs leading-snug">{stockText[i.id]}</div>}
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <Field label="Scan Drug" required={!skip} hint={scanned && !drugOk(i.id) ? undefined : "Scan the pack barcode."}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Input className="w-44" value={scanned} onChange={(e) => setDrugScan({ ...drugScan, [i.id]: e.target.value })} placeholder="Barcode" disabled={skip || !on} />
                        <Button size="sm" disabled={skip || !on} onClick={() => setDrugScan({ ...drugScan, [i.id]: d.barcode })} title="Fills in the barcode as a scanner would">
                          <IconBarcode className="size-4" />Simulate Scan
                        </Button>
                        {scanned && (drugOk(i.id) ? <Badge tone="ok"><IconCheck className="size-3" />Matched</Badge> : <Badge tone="danger"><IconX className="size-3" />Wrong Drug</Badge>)}
                      </div>
                    </Field>
                    {scanned && !drugOk(i.id) && <div className="mt-1 text-xs text-destructive">Wrong drug. Check the pack.</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><IconScan className="size-4" />Closed-Loop Check</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Scan Patient Wristband" required={!skip} hint={patientScan ? (patientOk ? undefined : "Does not match this patient. Check the wristband.") : "Scan the barcode, or type the MRN."}>
              <Input value={patientScan} onChange={(e) => setPatientScan(e.target.value)} placeholder={patient?.mrn} disabled={skip} />
            </Field>
            <div className="flex items-end gap-2">
              {patientScan && (patientOk ? <Badge tone="ok"><IconCheck className="size-3" />Matched</Badge> : <Badge tone="danger"><IconX className="size-3" />No Match</Badge>)}
              <Button size="sm" disabled={skip} onClick={() => setPatientScan(patient?.mrn ?? "")} title="Fills in the MRN as a scanner would">Simulate Scan</Button>
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Scanner not available. Skip scanning and give a reason (logged).
          </label>
          {skip && (
            <Field className="mt-2" label="Reason For Skipping The Scan" required>
              <Input value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
            </Field>
          )}
        </div>

        {anyControlled && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold"><IconUsers className="size-4" />Controlled Drug Witness</div>
            <p className="mb-2 text-xs text-muted-foreground">
              A second member of staff checks the drug, the quantity and the patient{rx.usage === "discharge" ? ". This also applies to take-home medicine at discharge" : ""}. You are dispensing as {user.name} ({user.id}).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Witness Name" required>
                <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Witness Staff Number" required>
                <Input value={witnessNo} onChange={(e) => setWitnessNo(e.target.value)} autoComplete="off" />
              </Field>
            </div>
            {witnessSame && <p role="alert" className="mt-2 text-xs text-destructive">{witnessSame}</p>}
          </div>
        )}

        {raqeeb ? (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold">Raqeeb Secure Code{dev && <span className="ml-2 font-mono text-xs text-update">meta.tag SecureCode</span>}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="How Is The Code Handled" required hint="This dispense is reported to Raqeeb either way.">
                <Select value={secureMode} onChange={(e) => setSecureMode(e.target.value as SecureMode)}>
                  <option value="">Choose one</option>
                  <option value="authenticated">Patient Gave The Code</option>
                  <option value="override">Dispense Without The Code</option>
                </Select>
              </Field>
              {secureMode === "authenticated" && (
                <Field label="Secure Code From The Patient" required hint="Any 4 or more digits work here.">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="off" />
                </Field>
              )}
              {secureMode === "override" && (
                <Field label="Reason For No Code" required hint="The reason is sent to Raqeeb and logged.">
                  <Select value={justify} onChange={(e) => setJustify(e.target.value)}>
                    <option value="">Choose a reason</option>
                    {OVERRIDE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            {secureMode !== "" && secureIssue && <p className="mt-2 text-xs text-muted-foreground">{secureIssue}</p>}
          </div>
        ) : (
          rx.controlled && <p className="text-xs text-muted-foreground">Inpatient supply. Raqeeb covers outpatient, discharge and community prescriptions, so no secure code is asked for here. The witness is still needed.</p>
        )}

        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/8 p-3 text-xs text-destructive">
            {problems.map((p) => <div key={p}>{p}</div>)}
          </div>
        )}
        {needed.length > 0 && problems.length === 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="font-medium text-foreground">Still Needed Before You Can Dispense</div>
            <ul className="mt-1 list-disc pl-5">
              {needed.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        )}

        {dev && plan && (
          <MessageViewer
            title={plan.dispense.number}
            bundle={plan.bundle}
            checks={plan.checks}
            record={sentHere.at(-1)}
            history={sentHere}
          />
        )}
      </div>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold text-destructive" : "font-medium"}>{value}</dd>
    </div>
  );
}

/** Used by the page for the history rows. */
export function dispenseSummary(d: Dispense): string {
  return d.lines.map((l) => `${getDrug(l.drugId).generic} ${l.quantity} (${l.type}${l.status === "cancelled" ? ", cancelled" : ""})`).join("; ");
}
