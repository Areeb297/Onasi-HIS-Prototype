import * as React from "react";
import { IconCircleX, IconHandStop, IconMessageReply, IconPencil, IconPill, IconPlayerPause, IconPlayerPlay, IconSend, IconShieldCheck, IconShieldExclamation, IconTrash } from "@tabler/icons-react";
import { ConformancePanel, ControlBadge, ItemStatusBadge, MessageViewer, RxPatientStrip, VerifyBadge, VerifyTrail } from "@/components/emr/RxShared";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { answerQuery, verifyStatusOf } from "@/lib/rx-verify";
import { RxEditor } from "@/components/emr/RxEditor";
import { Dialog } from "@/components/Dialog";
import { EmptyState, FormField, RowMenu, TextArea, WithUnit, useValidation } from "@/components/emr/entry-ui";
import { Badge, Button, Card, CardHeader, Input, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import { dosageNarrative } from "@/lib/fhir/medication";
import type { Encounter } from "@/lib/model";
import { fillOf, getDrug, removeDraftItem, rxForVisit, setHeight, useRx } from "@/lib/rx";
import { isPatientOwn, isRaqeebScope, itemDates, regimenOf, unitCount, type PrescriptionAction } from "@/lib/rx-logic";
import { measuresFor, planPrescription, sendPrescription } from "@/lib/rx-send";
import type { ItemStatus, Prescription, RxItem } from "@/lib/rx-types";
import { can } from "@/lib/session";
import { nowLocal, updateEncounter, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { confirmPatient } from "@/lib/wrong-patient";

/** The chart "Prescription" tab: measurements, a fast editor, the prescriptions of this visit and the conformance panel. */

export function PrescriptionSection({ enc }: { enc: Encounter }) {
  const s = useRx();
  const [editing, setEditing] = React.useState<{ rxId: string; itemId: string } | null>(null);
  const rxs = rxForVisit(s, enc.visitNumber);
  return (
    <div className="space-y-4">
      <MeasuresCard enc={enc} />
      <RxEditor enc={enc} editing={editing} onDone={() => setEditing(null)} />
      {rxs.length === 0 ? (
        <Card>
          <EmptyState icon={<IconPill stroke={1.75} />} title="No Prescriptions On This Visit">
            Pick a drug in New Prescription Item above, check the dose, then choose Add To Prescription.
          </EmptyState>
        </Card>
      ) : (
        rxs.map((rx) => <RxCard key={rx.id} rx={rx} onEdit={(itemId) => { setEditing({ rxId: rx.id, itemId }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />)
      )}
      <ConformancePanel />
    </div>
  );
}

/* ---------- height, weight and allergies ---------- */

function MeasuresCard({ enc }: { enc: Encounter }) {
  const s = useRx();
  const dev = useDevMode();
  const canWrite = can("rx.write");
  const m = measuresFor(s, enc);
  const [h, setH] = React.useState(m.heightCm ? String(m.heightCm) : "");
  const [w, setW] = React.useState(m.weightKg ? String(m.weightKg) : "");
  React.useEffect(() => setH(m.heightCm ? String(m.heightCm) : ""), [m.heightCm, enc.visitNumber]);
  React.useEffect(() => setW(m.weightKg ? String(m.weightKg) : ""), [m.weightKg, enc.visitNumber]);

  const hBad = h.trim() !== "" && !(parseFloat(h) >= 30 && parseFloat(h) <= 250);
  const wBad = w.trim() !== "" && !(parseFloat(w) >= 0.5 && parseFloat(w) <= 400);
  const v = useValidation({
    height: hBad && "Enter a height from 30 to 250 cm.",
    weight: wBad && "Enter a weight from 0.5 to 400 kg.",
  });

  function saveH() {
    v.blur("height")();
    const n = parseFloat(h);
    if (n >= 30 && n <= 250 && n !== m.heightCm) setHeight(enc.visitNumber, enc.patientId, n);
  }
  function saveW() {
    v.blur("weight")();
    const n = parseFloat(w);
    if (!(n >= 0.5 && n <= 400) || n === m.weightKg) return;
    updateEncounter(
      enc.visitNumber,
      (e) => {
        e.vitals = { bp: "", pulse: "", temp: "", spo2: "", rr: "", ...(e.vitals ?? { weight: "", at: "" }), weight: String(n), at: e.vitals?.at || nowLocal() };
      },
      { touch: false },
    );
    audit("update", "Weight (vitals)", { patient: enc.patientId, detail: `Visit ${enc.visitNumber}. ${n} kg` });
  }

  const missing = !m.heightCm || !m.weightKg;
  return (
    <Card>
      <CardHeader title="Measurements And Allergies" subtitle="Height and weight go with every prescription. Weight comes from the chart vitals." right={dev ? <Badge tone="update">Visit {enc.visitNumber}</Badge> : undefined} />
      <div className="grid gap-4 px-4 py-4 sm:grid-cols-[10rem_10rem_1fr]">
        <FormField label="Height" error={v.error("height")} hl7="Observation 50373000">
          <WithUnit unit="cm">
            <Input className="pe-10" type="number" min="30" max="250" value={h} onChange={(e) => setH(e.target.value)} onBlur={saveH} disabled={!canWrite} placeholder="170" />
          </WithUnit>
        </FormField>
        <FormField label="Weight" error={v.error("weight")} hl7="Observation 363808001">
          <WithUnit unit="kg">
            <Input className="pe-10" type="number" min="0.5" max="400" step="any" value={w} onChange={(e) => setW(e.target.value)} onBlur={saveW} disabled={!canWrite} placeholder="70" />
          </WithUnit>
        </FormField>
        <div className="min-w-0 text-sm">
          <div className="mb-1.5 text-sm font-medium leading-5">Allergies</div>
          {enc.allergies.length ? (
            <div className="flex flex-wrap gap-1.5">
              {enc.allergies.map((a) => (
                <span key={a.text} className="inline-flex items-center gap-1 rounded-md bg-destructive/12 px-2 py-1 text-xs font-medium text-destructive">
                  <IconShieldExclamation className="size-3.5" stroke={1.75} />
                  {a.text}, {a.severity === "SV" ? "severe" : a.severity === "MO" ? "moderate" : "mild"}
                  {a.reaction ? `, ${a.reaction}` : ""}
                </span>
              ))}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-ok"><IconShieldCheck className="size-4" stroke={1.75} />No allergies recorded</span>
          )}
        </div>
      </div>
      {/* Always one line tall. If this box came and went, the page below would jump when Height is saved on blur, and the first click on a drug would land on the wrong thing. */}
      <div
        role="status"
        className={cn("mx-4 mb-4 rounded-md border px-3 py-2 text-xs", missing ? "border-warn/40 bg-warn/10" : "border-ok/40 bg-ok/10")}
      >
        {missing
          ? `Add ${[!m.heightCm && "height", !m.weightKg && "weight"].filter(Boolean).join(" and ")} before sending. nphies rejects a prescription without them.`
          : "Height and weight are recorded. They go with every prescription."}
      </div>
    </Card>
  );
}

/* ---------- one prescription ---------- */

const ACTION_TEXT: Record<string, { title: string; verb: string; status: ItemStatus; action: PrescriptionAction; help: string }> = {
  cancel: { title: "Cancel Item", verb: "Cancel", status: "cancelled", action: "cancel", help: "The item is cancelled and cannot be dispensed." },
  hold: { title: "Put Item On Hold", verb: "Hold", status: "on-hold", action: "hold", help: "The pharmacy cannot dispense it until you resume it." },
  resume: { title: "Resume Item", verb: "Resume", status: "active", action: "resume", help: "The item becomes active again." },
  stop: { title: "Stop Item", verb: "Stop", status: "stopped", action: "stop", help: "Dispensing already started. No more of this item will be dispensed." },
};

const NO_RX = "You do not have permission to prescribe";
const LABEL = "mb-0.5 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground";

function RxCard({ rx, onEdit }: { rx: Prescription; onEdit: (itemId: string) => void }) {
  const s = useRx();
  const dev = useDevMode();
  const his = useHis();
  const canWrite = can("rx.write");
  const [confirm, setConfirm] = React.useState<{ key: string; item: RxItem } | null>(null);
  const [reason, setReason] = React.useState("");
  const [showFhir, setShowFhir] = React.useState(false);
  const [answering, setAnswering] = React.useState<RxItem | null>(null);
  const [answer, setAnswer] = React.useState("");
  const [answerProblem, setAnswerProblem] = React.useState("");
  const [removing, setRemoving] = React.useState<RxItem | null>(null);
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const atPharmacy = rx.sentAt ? rx.items.filter((i) => i.status === "active" && !fillOf(s, rx, i).done) : [];
  const nQuery = atPharmacy.filter((i) => verifyStatusOf(i) === "queried").length;
  const nRejected = atPharmacy.filter((i) => verifyStatusOf(i) === "rejected").length;

  function sendAnswer() {
    if (!answering) return;
    if (answer.trim().length < 2) return setAnswerProblem("Type your answer first.");
    const res = answerQuery(rx.id, answering.id, answer);
    if (!res.ok) return setAnswerProblem(res.problem ?? "The answer could not be saved.");
    pushToast({ tone: "ok", text: "Answer sent to the pharmacy", detail: "The pharmacist checks the item again." });
    setAnswering(null);
  }
  const plan = React.useMemo(() => (dev && showFhir ? planPrescription(s, rx) : null), [dev, showFhir, s, rx]);
  const sends = s.sends.filter((x) => x.kind === "prescription" && x.targetId === rx.id);
  const last = sends[sends.length - 1];
  const own = isPatientOwn(rx);
  const raqeeb = isRaqeebScope(rx.controlled, rx.usage) && !own;
  const m = enc ? measuresFor(s, enc) : {};

  const state = own
    ? { label: "Recorded, Not Sent", tone: "neutral" as const }
    : !rx.sentAt
      ? rx.lastSend && !rx.lastSend.ok ? { label: "Rejected", tone: "danger" as const } : { label: "Draft, Not Sent", tone: "neutral" as const }
      : rx.dirty ? { label: "Changes Not Sent", tone: "warn" as const } : { label: "Sent", tone: "ok" as const };

  async function send() {
    if (!(await confirmPatient(rx.patientId))) return;
    const out = sendPrescription(rx.id, rx.sentAt ? "update" : "create");
    if (!out) return;
    if (out.ok) pushToast({ tone: "ok", text: `${rx.number} sent to nphies`, detail: out.refId ? `Raqeeb reference id ${out.refId}` : "Accepted (201)." });
    else pushToast({ tone: "danger", text: `${rx.number} was rejected`, detail: firstError(out.record.checks) });
  }

  async function doAction() {
    if (!confirm) return;
    if (!(await confirmPatient(rx.patientId))) return;
    const t = ACTION_TEXT[confirm.key];
    const out = sendPrescription(rx.id, t.action, { itemId: confirm.item.id, status: t.status, reason: reason.trim() || undefined });
    audit("update", `Prescription item ${confirm.item.identifier}`, {
      patient: rx.patientId,
      detail: `Visit ${rx.visitNumber}. ${t.verb} ${getDrug(confirm.item.drugId).generic}${reason.trim() ? `. Reason: ${reason.trim()}` : ""}`,
    });
    if (out?.ok) pushToast({ tone: "ok", text: `${t.verb} sent to nphies`, detail: out.refId ? `Raqeeb reference id ${out.refId}` : undefined });
    else if (out) pushToast({ tone: "danger", text: `${t.verb} was rejected`, detail: firstError(out.record.checks) });
    setConfirm(null);
    setReason("");
  }

  return (
    <Card>
      <CardHeader
        title={`${rx.number}`}
        subtitle={`Visit ${rx.visitNumber} · ${rx.usage[0].toUpperCase()}${rx.usage.slice(1)} · ${fmtDateTime(rx.authoredAt)}`}
        tag={dev ? `groupIdentifier ${rx.groupId}` : undefined}
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {own && <Badge tone="move">Provided By Patient</Badge>}
            {rx.controlled && <Badge tone="danger">Narcotic, Controlled Or Restricted</Badge>}
            {rx.raqeebRef && <Badge tone="merge">Raqeeb Reference {rx.raqeebRef}</Badge>}
            {!rx.raqeebRef && rx.nationalRef && <Badge tone="neutral">NPHIES Reference {rx.nationalRef}</Badge>}
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
        }
      />
      {own && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          Medicine the patient brought. It is part of the chart and the safety checks, but it is not sent to nphies and the pharmacy does not dispense it.
        </p>
      )}
      {rx.controlled && !rx.raqeebRef && !own && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {raqeeb ? "A Raqeeb reference id is given when nphies accepts this prescription. You need it to cancel or change it." : "Inpatient use is outside the Raqeeb scope. It gets a normal NPHIES reference id, not a Raqeeb one."}
        </p>
      )}
      {nQuery + nRejected > 0 && (
        <p role="alert" className="border-b border-border bg-warn/10 px-4 py-2 text-xs">
          {[nQuery > 0 && `The pharmacy asked a question about ${nQuery} ${nQuery === 1 ? "item" : "items"}`, nRejected > 0 && `The pharmacy rejected ${nRejected} ${nRejected === 1 ? "item" : "items"}`].filter(Boolean).join(". ")}. These items are not dispensed until this is settled.
        </p>
      )}
      <ul aria-label={`Items of ${rx.number}`} className="divide-y divide-border/70">
        {rx.items.map((item) => {
          const drug = getDrug(item.drugId);
          const fill = fillOf(s, rx, item);
          const sent = !!rx.sentAt;
          const open = item.status === "active" || item.status === "on-hold";
          const noEdit = fill.dispensedTotal > 0;
          const vstatus = verifyStatusOf(item, fill.dispensedTotal);
          const name = `${drug.generic} ${drug.strengthValue} ${drug.strengthUnit}`;
          const off = !canWrite ? NO_RX : undefined;
          return (
            <li key={item.id} className="relative flex flex-wrap gap-x-6 gap-y-3 px-4 py-3 pe-14">
              <div className="min-w-0 flex-1 basis-52">
                <div className="text-sm font-medium">{name}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {drug.form} <ControlBadge cls={drug.controlClass} />
                  {item.allergyOverride && <Badge tone="danger" className="whitespace-nowrap">Allergy Override</Badge>}
                  {dev && <span className="font-mono">{item.identifier} v{item.version}</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
                  <Badge tone={item.patientProvided ? "move" : "neutral"}>{item.patientProvided ? "Provided By Patient" : "Pharmacy"}</Badge>
                  {item.coverage ? <Badge tone={item.coverage === "Insured" ? "ok" : "warn"}>{item.coverage}</Badge> : <span className="text-muted-foreground">Coverage not recorded</span>}
                </div>
              </div>
              <div className="min-w-0 flex-[1.4] basis-64 text-xs">
                <div className={LABEL}>Dose And Duration</div>
                {regimenOf(item) !== "normal" && <Badge tone="update" className="mb-1">{regimenOf(item) === "split" ? "Split Regimen" : "Taper Regimen"}</Badge>}
                <div className="text-sm">{dosageNarrative(drug, item)}</div>
                <div className="text-muted-foreground">{dateRange(item, rx.authoredAt)}</div>
                {item.patientInstruction && <div className="text-muted-foreground">{item.patientInstruction}</div>}
                <div className="text-muted-foreground">Reason: {item.reason.text}</div>
              </div>
              <div className="basis-36 tabular-nums">
                <div className={LABEL}>Supply</div>
                <div className="text-sm font-medium">{unitCount(item.quantity, drug.unit)}{item.refills > 0 && <span className="text-xs font-normal text-muted-foreground"> · {item.refills} repeats</span>}</div>
                <div className="text-xs text-muted-foreground">{item.patientProvided ? "Not dispensed" : sent ? `${round(fill.dispensedTotal)} of ${item.quantity} dispensed` : "Not dispensed yet"}</div>
              </div>
              <div className="min-w-0 flex-1 basis-48">
                <div className={LABEL}>Status And Pharmacy Check</div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <ItemStatusBadge status={item.status} />
                  {sent && item.status === "active" && !fill.done && <VerifyBadge status={vstatus} />}
                </div>
                {sent && item.status === "active" && (
                  <div className="mt-1">
                    <VerifyTrail item={item} status={vstatus} />
                    {vstatus === "rejected" && <div className="text-xs text-muted-foreground">Edit the item to send it for a new check, or cancel it.</div>}
                    {vstatus === "queried" && (
                      <span className="mt-1 inline-flex" title={off}>
                        <Button size="sm" variant="primary" disabled={!canWrite} onClick={() => { setAnswering(item); setAnswer(""); setAnswerProblem(""); }}>
                          <IconMessageReply className="size-4" />Answer The Pharmacist
                        </Button>
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="absolute end-3 top-2.5">
                <RowMenu
                  label={`Actions for ${name}`}
                  items={[
                    open && {
                      label: "Edit Item",
                      icon: <IconPencil className="size-4 text-update" stroke={1.75} />,
                      disabled: !canWrite || noEdit,
                      title: off ?? (noEdit ? "Dispensing has started. This item cannot be edited." : undefined),
                      onSelect: () => onEdit(item.id),
                    },
                    sent && item.status === "active" && {
                      label: "Put On Hold",
                      icon: <IconPlayerPause className="size-4 text-warn" stroke={1.75} />,
                      disabled: !canWrite,
                      title: off,
                      onSelect: () => setConfirm({ key: "hold", item }),
                    },
                    sent && item.status === "on-hold" && {
                      label: "Resume",
                      icon: <IconPlayerPlay className="size-4 text-ok" stroke={1.75} />,
                      disabled: !canWrite,
                      title: off,
                      onSelect: () => setConfirm({ key: "resume", item }),
                    },
                    sent && open && fill.dispensedTotal > 0 && {
                      label: "Stop",
                      icon: <IconHandStop className="size-4 text-cancel" stroke={1.75} />,
                      disabled: !canWrite,
                      title: off ?? "Dispensing has started. No more of this item will be dispensed.",
                      danger: true,
                      separated: true,
                      onSelect: () => setConfirm({ key: "stop", item }),
                    },
                    sent && ((open && fill.dispensedTotal === 0) || (item.status === "completed" && rx.controlled)) && {
                      label: item.status === "completed" ? "Cancel Completed Item" : "Cancel Item",
                      icon: <IconCircleX className="size-4" stroke={1.75} />,
                      disabled: !canWrite,
                      title: off,
                      danger: true,
                      separated: true,
                      onSelect: () => setConfirm({ key: "cancel", item }),
                    },
                    !sent && {
                      label: "Remove Draft Item",
                      icon: <IconTrash className="size-4" stroke={1.75} />,
                      disabled: !canWrite,
                      title: off,
                      danger: true,
                      separated: open,
                      onSelect: () => setRemoving(item),
                    },
                  ]}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {own
            ? "Recorded on the chart only. Nothing is sent to nphies or to the pharmacy."
            : <>
                {last ? (last.ok ? `Last send accepted at ${fmtTime(last.at)}.` : `Last send was rejected: ${firstError(last.checks)}`) : "Not sent to nphies yet."}
                {!m.heightCm || !m.weightKg ? " Height and weight are missing." : ""}
              </>}
        </div>
        {!own && (
          <div className="flex items-center gap-2">
            {dev && <Button size="sm" onClick={() => setShowFhir(!showFhir)}>{showFhir ? "Hide" : "Show"} FHIR Details</Button>}
            <span title={!canWrite ? "You do not have permission to prescribe" : rx.sentAt && !rx.dirty ? "Nothing new to send" : undefined}>
              <Button variant="primary" disabled={!canWrite || (!!rx.sentAt && !rx.dirty)} onClick={send}>
                <IconSend className="size-4" />
                {rx.sentAt ? "Send Update To NPHIES" : "Send To NPHIES"}
              </Button>
            </span>
          </div>
        )}
      </div>
      {dev && showFhir && plan && !own && (
        <div className="border-t border-border p-4">
          <MessageViewer title={rx.number} bundle={plan.bundle} checks={plan.checks} record={last} history={sends} />
        </div>
      )}
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? ACTION_TEXT[confirm.key].title : ""}
        subtitle={confirm ? `${getDrug(confirm.item.drugId).generic}, ${rx.number}` : undefined}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Keep As Is</Button>
            <Button variant="primary" onClick={doAction}>
              <IconSend className="size-4" />
              {confirm ? `${ACTION_TEXT[confirm.key].verb} And Send To NPHIES` : "Send"}
            </Button>
          </>
        }
      >
        {confirm && (
          <div className="space-y-3 text-sm">
            <RxPatientStrip rx={rx} />
            <p>{ACTION_TEXT[confirm.key].help}</p>
            {(rx.raqeebRef ?? rx.nationalRef) && <p className="text-xs text-muted-foreground">Sent with {rx.raqeebRef ? "Raqeeb" : "NPHIES"} reference id {rx.raqeebRef ?? rx.nationalRef}.</p>}
            <FormField label="Reason" help="Optional. Kept in the audit trail.">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: patient changed treatment" />
            </FormField>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!answering}
        onClose={() => setAnswering(null)}
        title="Answer The Pharmacist"
        subtitle={answering ? `${getDrug(answering.drugId).generic} ${getDrug(answering.drugId).strengthValue} ${getDrug(answering.drugId).strengthUnit}, ${rx.number}` : undefined}
        footer={
          <>
            <Button onClick={() => setAnswering(null)}>Close</Button>
            <Button variant="primary" onClick={sendAnswer}>Send Answer To Pharmacy</Button>
          </>
        }
      >
        {answering && (
          <div className="space-y-3 text-sm">
            <RxPatientStrip rx={rx} />
            <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
              <div className="font-semibold">Question from {answering.verify?.by}</div>
              <div className="mt-0.5">{answering.verify?.query?.text}</div>
            </div>
            <p className="text-xs text-muted-foreground">{dosageNarrative(getDrug(answering.drugId), answering)}. To change the dose, close this and edit the item. An edited item goes back to the pharmacy for a new check.</p>
            <FormField label="Your Answer" required error={answerProblem || undefined}>
              <TextArea rows={3} value={answer} onChange={(e) => { setAnswer(e.target.value); setAnswerProblem(""); }} />
            </FormField>
          </div>
        )}
      </Dialog>
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove Draft Item"
        subtitle={removing ? `${getDrug(removing.drugId).generic}, ${rx.number}` : undefined}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep Item</Button>
            <Button variant="danger" onClick={() => { if (removing) removeDraftItem(rx.id, removing.id); setRemoving(null); }}>Remove Item</Button>
          </>
        }
      >
        <p className="text-sm">This item was not sent yet. Removing it takes it off the prescription.</p>
      </Dialog>
    </Card>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
const fmtDay = (d: string) => fmtDate(`${d}T00:00:00`);
/** "From 3 Nov 2026 to 7 Nov 2026". Older items without a start date start on the day the prescription was written. */
function dateRange(item: RxItem, authoredAt: string): string {
  const d = itemDates(item, authoredAt);
  return `From ${fmtDay(d.start)} to ${fmtDay(d.end)}`;
}
export function firstError(checks: { level: string; text: string }[]): string {
  return checks.find((c) => c.level === "error")?.text ?? "Rejected.";
}
