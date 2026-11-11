import * as React from "react";
import { IconBarcode, IconCheck, IconScan, IconSend, IconX } from "@tabler/icons-react";
import { MessageViewer, SafetyBanner } from "@/components/emr/RxShared";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Input, Select, Table, Td, Th } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import type { Patient } from "@/lib/model";
import { fillOf, getDrug, openItems, useRx } from "@/lib/rx";
import { classifyDispense, isRaqeebScope } from "@/lib/rx-logic";
import { allergyMatch } from "@/lib/rx-safety";
import { planDispense, sendDispense } from "@/lib/rx-send";
import type { Dispense, FillType, Prescription } from "@/lib/rx-types";
import { can } from "@/lib/session";
import { pushToast } from "@/lib/toast";
import { useHis } from "@/lib/store";

/** Dispense dialog: pick items and quantities, scan the wristband and the drugs, then send. */

const TYPE_TEXT: Record<FillType, string> = {
  FF: "Full Dispense",
  FFP: "Part Of The Fill",
  FFC: "Completes The Fill",
  RF: "Full Refill",
  RFP: "Part Of A Refill",
  RFC: "Completes A Refill",
};

const OVERRIDE_REASONS = ["Patient has no phone with them", "Code message not received", "Patient is a minor, guardian collects", "System unavailable"];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function DispenseDialog({ rx, onClose }: { rx: Prescription; onClose: () => void }) {
  const s = useRx();
  const his = useHis();
  const dev = useDevMode();
  const canDispense = can("rx.dispense");
  const patient = his.patients.find((p) => p.id === rx.patientId) as Patient | undefined;
  const items = openItems(s, rx);
  const raqeeb = isRaqeebScope(rx.controlled, rx.usage);

  const [picked, setPicked] = React.useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.id, true])));
  const [qty, setQty] = React.useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(fillOf(s, rx, i).remaining)])));
  const [lot, setLot] = React.useState<Record<string, string>>({});
  const [expiry, setExpiry] = React.useState<Record<string, string>>({});
  const [drugScan, setDrugScan] = React.useState<Record<string, string>>({});
  const [patientScan, setPatientScan] = React.useState("");
  const [skip, setSkip] = React.useState(false);
  const [skipReason, setSkipReason] = React.useState("");
  const [secureMode, setSecureMode] = React.useState<"authenticated" | "override">("authenticated");
  const [otp, setOtp] = React.useState("");
  const [justify, setJustify] = React.useState(OVERRIDE_REASONS[0]);
  const [problems, setProblems] = React.useState<string[]>([]);

  const patientOk = !!patient && (same(patientScan, patient.mrn) || same(patientScan, patient.healthId));
  const chosen = items.filter((i) => picked[i.id]);
  const drugOk = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return false;
    const d = getDrug(it.drugId);
    const v = drugScan[id] ?? "";
    return same(v, d.barcode) || same(v, d.code);
  };

  const request = {
    rxId: rx.id,
    lines: chosen.map((i) => ({ itemId: i.id, quantity: parseFloat(qty[i.id] ?? "0") || 0, lot: lot[i.id] || undefined, expiry: expiry[i.id] || undefined })),
    secure: raqeeb ? (secureMode === "authenticated" ? { mode: "authenticated" as const, value: otp.trim() } : { mode: "override" as const, justification: justify }) : undefined,
    verification: skip
      ? { patientScan: false, drugScans: [] as string[], skippedReason: skipReason.trim() }
      : { patientScan: patientOk, drugScans: chosen.filter((i) => drugOk(i.id)).map((i) => i.id) },
  };
  const plan = React.useMemo(() => planDispense(s, request, true), [s, JSON.stringify(request)]); // eslint-disable-line react-hooks/exhaustive-deps
  const secureMissing = raqeeb && secureMode === "authenticated" && otp.trim().length < 4;
  const skipMissing = skip && skipReason.trim().length < 5;
  const ready = canDispense && chosen.length > 0 && !skipMissing && !secureMissing;

  function submit() {
    const res = sendDispense(request);
    setProblems(res.problems);
    if (!res.outcome) return;
    if (res.outcome.ok) {
      pushToast({ tone: "ok", text: `Dispense sent to nphies`, detail: res.outcome.refId ? `Raqeeb reference id ${res.outcome.refId}` : "Accepted (201)." });
      onClose();
    } else {
      pushToast({ tone: "danger", text: "Dispense was rejected", detail: res.outcome.record.checks.find((c) => c.level === "error")?.text });
    }
  }

  const nums = new Set(s.dispenses.filter((d) => d.rxId === rx.id).map((d) => d.number));
  const sentHere = s.sends.filter((x) => x.kind === "dispense" && nums.has(x.targetId));
  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={`Dispense ${rx.number}`}
      subtitle={`${patient ? `${patient.given} ${patient.family} · ${patient.mrn}` : "Unknown patient"} · Visit ${rx.visitNumber}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <span title={!canDispense ? "You do not have permission to dispense" : chosen.length === 0 ? "Pick at least one item" : secureMissing ? "Enter the secure code from the patient" : skipMissing ? "Enter a reason for skipping the scan" : undefined}>
            <Button variant="primary" disabled={!ready} onClick={submit}>
              <IconSend className="size-4" />
              Dispense And Send To NPHIES
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {rx.items.map((i) => {
          const d = getDrug(i.drugId);
          const hits = (patient ? his.encounters.find((e) => e.visitNumber === rx.visitNumber)?.allergies ?? [] : []).filter((a) => allergyMatch(d, a.text) === "direct");
          return hits.length ? (
            <SafetyBanner
              key={i.id}
              f={{ id: i.id, kind: "allergy", level: "block", text: `${d.generic}: the patient is allergic to ${hits.map((h) => h.text).join(", ")}. ${i.allergyOverride ? `The prescriber overrode this: ${i.allergyOverride.reason}.` : "Check with the prescriber."}` }}
            />
          ) : null;
        })}

        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold"><IconScan className="size-4" />Closed-Loop Check</div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Scan Patient Wristband" hint={patientScan ? (patientOk ? undefined : "Does not match this patient. Check the wristband.") : "Scan the barcode, or type the MRN."}>
              <Input value={patientScan} onChange={(e) => setPatientScan(e.target.value)} placeholder={patient?.mrn} disabled={skip} />
            </Field>
            <div className="flex items-end gap-2">
              {patientScan && (patientOk ? <Badge tone="ok"><IconCheck className="size-3" />Matched</Badge> : <Badge tone="danger"><IconX className="size-3" />No Match</Badge>)}
              <Button size="sm" disabled={skip} onClick={() => setPatientScan(patient?.mrn ?? "")} title="Simulates a barcode scanner">Simulate Scan</Button>
            </div>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" className="size-4 accent-primary" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Scanner not available. Skip scanning and give a reason (logged).
          </label>
          {skip && <Input className="mt-2" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="Reason for skipping the scan" />}
        </div>

        {items.length === 0 ? (
          <p className="text-muted-foreground">Nothing left to dispense on this prescription.</p>
        ) : (
          <Table>
            <thead className="bg-muted/40">
              <tr><Th /><Th>Drug</Th><Th>Quantity</Th><Th>Scan Drug</Th><Th>Lot And Expiry</Th></tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const d = getDrug(i.drugId);
                const f = fillOf(s, rx, i);
                const q = parseFloat(qty[i.id] ?? "0") || 0;
                const type = classifyDispense(f, q);
                const scanned = drugScan[i.id] ?? "";
                return (
                  <tr key={i.id}>
                    <Td><input type="checkbox" className="size-4 accent-primary" checked={!!picked[i.id]} onChange={(e) => setPicked({ ...picked, [i.id]: e.target.checked })} aria-label={`Include ${d.generic}`} /></Td>
                    <Td>
                      <div className="font-medium">{d.generic} {d.strengthValue} {d.strengthUnit}</div>
                      <div className="text-xs text-muted-foreground">Product: {d.brand} · {f.remaining} {d.unit} left of {i.quantity}</div>
                      <div className="mt-0.5 flex items-center gap-1">
                        <Badge tone={type === "FF" || type === "RF" ? "ok" : type.endsWith("C") ? "move" : "warn"}>{TYPE_TEXT[type]}</Badge>
                        {dev && <span className="font-mono text-xs text-update">{type}</span>}
                      </div>
                    </Td>
                    <Td>
                      <Input className="w-24" type="number" min="0" step="any" value={qty[i.id] ?? ""} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} aria-label={`Quantity of ${d.generic}`} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Input className="w-36" value={scanned} onChange={(e) => setDrugScan({ ...drugScan, [i.id]: e.target.value })} placeholder="Scan barcode" disabled={skip} aria-label={`Scan ${d.generic}`} />
                        <Button size="sm" disabled={skip} onClick={() => setDrugScan({ ...drugScan, [i.id]: d.barcode })} title="Simulates a barcode scanner"><IconBarcode className="size-4" /></Button>
                        {scanned && (drugOk(i.id) ? <IconCheck className="size-4 text-ok" /> : <IconX className="size-4 text-destructive" />)}
                      </div>
                      {scanned && !drugOk(i.id) && <div className="mt-0.5 text-xs text-destructive">Wrong drug. Check the pack.</div>}
                    </Td>
                    <Td>
                      <div className="flex gap-1.5">
                        <Input className="w-24" placeholder="Lot" value={lot[i.id] ?? ""} onChange={(e) => setLot({ ...lot, [i.id]: e.target.value })} aria-label="Lot number" />
                        <Input className="w-36" type="date" value={expiry[i.id] ?? ""} onChange={(e) => setExpiry({ ...expiry, [i.id]: e.target.value })} aria-label="Expiry date" />
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {raqeeb && (
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold">Secure Code{dev && <span className="ml-2 font-mono text-xs text-update">meta.tag SecureCode</span>}</div>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <Select value={secureMode} onChange={(e) => setSecureMode(e.target.value as "authenticated" | "override")} className="sm:w-60" aria-label="Secure code mode">
                <option value="authenticated">Patient Gave The Code</option>
                <option value="override">Override The Code</option>
              </Select>
              {secureMode === "authenticated" ? (
                <Input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="Code from the patient (any 4 or more digits in this demo)" aria-label="Secure code" />
              ) : (
                <Select value={justify} onChange={(e) => setJustify(e.target.value)} aria-label="Override reason">
                  {OVERRIDE_REASONS.map((r) => <option key={r}>{r}</option>)}
                </Select>
              )}
            </div>
          </div>
        )}

        {problems.length > 0 && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/8 p-3 text-xs text-destructive">
            {problems.map((p) => <div key={p}>{p}</div>)}
          </div>
        )}
        {plan && plan.problems.length > 0 && chosen.length > 0 && problems.length === 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {plan.problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
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

/** Used by the page for the history rows. */
export function dispenseSummary(d: Dispense): string {
  return d.lines.map((l) => `${getDrug(l.drugId).generic} ${l.quantity} (${l.type}${l.status === "cancelled" ? ", cancelled" : ""})`).join("; ");
}
