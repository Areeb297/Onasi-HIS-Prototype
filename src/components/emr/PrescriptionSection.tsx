import * as React from "react";
import { IconCircleX, IconHandStop, IconPencil, IconPlayerPause, IconPlayerPlay, IconSend, IconShieldCheck, IconShieldExclamation, IconTrash } from "@tabler/icons-react";
import { ConformancePanel, ControlBadge, ItemStatusBadge, MessageViewer } from "@/components/emr/RxShared";
import { RxEditor } from "@/components/emr/RxEditor";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Table, Td, Th } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import { dosageNarrative } from "@/lib/fhir/medication";
import type { Encounter } from "@/lib/model";
import { fillOf, getDrug, removeDraftItem, rxForVisit, setHeight, useRx } from "@/lib/rx";
import { isRaqeebScope, type PrescriptionAction } from "@/lib/rx-logic";
import { measuresFor, planPrescription, sendPrescription } from "@/lib/rx-send";
import type { ItemStatus, Prescription, RxItem } from "@/lib/rx-types";
import { can } from "@/lib/session";
import { nowLocal, updateEncounter, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

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
        <Card><Empty>No prescriptions on this visit yet.</Empty></Card>
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

  function saveH() {
    const n = parseFloat(h);
    if (n >= 30 && n <= 250 && n !== m.heightCm) setHeight(enc.visitNumber, enc.patientId, n);
  }
  function saveW() {
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
      <div className="grid gap-4 px-4 py-4 lg:grid-cols-[auto_auto_1fr]">
        <Field label="Height (cm)" hl7="Observation 50373000">
          <Input className="w-32" type="number" min="30" max="250" value={h} onChange={(e) => setH(e.target.value)} onBlur={saveH} disabled={!canWrite} placeholder="170" />
        </Field>
        <Field label="Weight (kg)" hl7="Observation 363808001">
          <Input className="w-32" type="number" min="0.5" max="400" step="any" value={w} onChange={(e) => setW(e.target.value)} onBlur={saveW} disabled={!canWrite} placeholder="70" />
        </Field>
        <div className="min-w-0 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Allergies</div>
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
      {missing && (
        <div className="mx-4 mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">
          Add {[!m.heightCm && "height", !m.weightKg && "weight"].filter(Boolean).join(" and ")} before sending. nphies rejects a prescription without them.
        </div>
      )}
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

function PillBtn({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="flex size-8 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function RxCard({ rx, onEdit }: { rx: Prescription; onEdit: (itemId: string) => void }) {
  const s = useRx();
  const dev = useDevMode();
  const his = useHis();
  const canWrite = can("rx.write");
  const [confirm, setConfirm] = React.useState<{ key: string; item: RxItem } | null>(null);
  const [reason, setReason] = React.useState("");
  const [showFhir, setShowFhir] = React.useState(false);
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const plan = React.useMemo(() => (dev && showFhir ? planPrescription(s, rx) : null), [dev, showFhir, s, rx]);
  const sends = s.sends.filter((x) => x.kind === "prescription" && x.targetId === rx.id);
  const last = sends[sends.length - 1];
  const raqeeb = isRaqeebScope(rx.controlled, rx.usage);
  const m = enc ? measuresFor(s, enc) : {};

  const state = !rx.sentAt
    ? rx.lastSend && !rx.lastSend.ok ? { label: "Rejected", tone: "danger" as const } : { label: "Draft, Not Sent", tone: "neutral" as const }
    : rx.dirty ? { label: "Changes Not Sent", tone: "warn" as const } : { label: "Sent", tone: "ok" as const };

  function send() {
    const out = sendPrescription(rx.id, rx.sentAt ? "update" : "create");
    if (!out) return;
    if (out.ok) pushToast({ tone: "ok", text: `${rx.number} sent to nphies`, detail: out.refId ? `Raqeeb reference id ${out.refId}` : "Accepted (201)." });
    else pushToast({ tone: "danger", text: `${rx.number} was rejected`, detail: firstError(out.record.checks) });
  }

  function doAction() {
    if (!confirm) return;
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
        subtitle={`Visit ${rx.visitNumber} · ${rx.usage[0].toUpperCase()}${rx.usage.slice(1)} · ${new Date(rx.authoredAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
        tag={dev ? `groupIdentifier ${rx.groupId}` : undefined}
        right={
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {rx.controlled && <Badge tone="danger">Narcotic, Controlled Or Restricted</Badge>}
            {rx.raqeebRef && <Badge tone="merge">Raqeeb Reference {rx.raqeebRef}</Badge>}
            <Badge tone={state.tone}>{state.label}</Badge>
          </div>
        }
      />
      {rx.controlled && !rx.raqeebRef && (
        <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
          {raqeeb ? "A Raqeeb reference id is given when nphies accepts this prescription. You need it to cancel or change it." : "Inpatient use is outside the Raqeeb scope. No Raqeeb reference id is given."}
        </p>
      )}
      <Table>
        <thead className="bg-muted/40">
          <tr><Th>Drug</Th><Th>Dose And Duration</Th><Th>Quantity</Th><Th>Dispensed</Th><Th>Status</Th><Th>Actions</Th></tr>
        </thead>
        <tbody>
          {rx.items.map((item) => {
            const drug = getDrug(item.drugId);
            const fill = fillOf(s, rx, item);
            const sent = !!rx.sentAt;
            const open = item.status === "active" || item.status === "on-hold";
            const noEdit = fill.dispensedTotal > 0;
            return (
              <tr key={item.id} className="hover:bg-muted/30">
                <Td>
                  <div className="font-medium">{drug.generic} {drug.strengthValue} {drug.strengthUnit}</div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {drug.form} <ControlBadge cls={drug.controlClass} />
                    {item.allergyOverride && <Badge tone="danger" className="whitespace-nowrap">Allergy Override</Badge>}
                    {dev && <span className="font-mono">{item.identifier} v{item.version}</span>}
                  </div>
                </Td>
                <Td className="max-w-[280px] text-xs">
                  {dosageNarrative(drug, item)}
                  {item.patientInstruction && <div className="text-muted-foreground">{item.patientInstruction}</div>}
                  <div className="text-muted-foreground">Reason: {item.reason.text}</div>
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{item.quantity} {drug.unit}{item.refills > 0 && <span className="text-xs text-muted-foreground"> · {item.refills} repeats</span>}</Td>
                <Td className="whitespace-nowrap tabular-nums text-xs">{sent ? `${round(fill.dispensedTotal)} of ${item.quantity}` : "Not yet"}</Td>
                <Td><ItemStatusBadge status={item.status} /></Td>
                <Td>
                  <div className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-1">
                    {open && (
                      <PillBtn title={!canWrite ? "You do not have permission to prescribe" : noEdit ? "Dispensing has started. This item cannot be edited." : "Edit Item"} disabled={!canWrite || noEdit} onClick={() => onEdit(item.id)}>
                        <IconPencil className="size-[18px] text-update" stroke={1.75} />
                      </PillBtn>
                    )}
                    {!sent && (
                      <PillBtn title="Remove Draft Item" disabled={!canWrite} onClick={() => removeDraftItem(rx.id, item.id)}>
                        <IconTrash className="size-[18px] text-cancel" stroke={1.75} />
                      </PillBtn>
                    )}
                    {sent && item.status === "active" && (
                      <PillBtn title={canWrite ? "Put On Hold" : "You do not have permission to prescribe"} disabled={!canWrite} onClick={() => setConfirm({ key: "hold", item })}>
                        <IconPlayerPause className="size-[18px] text-warn" stroke={1.75} />
                      </PillBtn>
                    )}
                    {sent && item.status === "on-hold" && (
                      <PillBtn title={canWrite ? "Resume" : "You do not have permission to prescribe"} disabled={!canWrite} onClick={() => setConfirm({ key: "resume", item })}>
                        <IconPlayerPlay className="size-[18px] text-ok" stroke={1.75} />
                      </PillBtn>
                    )}
                    {sent && open && fill.dispensedTotal > 0 && (
                      <PillBtn title={canWrite ? "Stop (Dispensing Started)" : "You do not have permission to prescribe"} disabled={!canWrite} onClick={() => setConfirm({ key: "stop", item })}>
                        <IconHandStop className="size-[18px] text-cancel" stroke={1.75} />
                      </PillBtn>
                    )}
                    {sent && ((open && fill.dispensedTotal === 0) || (item.status === "completed" && rx.controlled)) && (
                      <PillBtn title={canWrite ? (item.status === "completed" ? "Cancel Completed Item" : "Cancel Item") : "You do not have permission to prescribe"} disabled={!canWrite} onClick={() => setConfirm({ key: "cancel", item })}>
                        <IconCircleX className="size-[18px] text-cancel" stroke={1.75} />
                      </PillBtn>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {last ? (last.ok ? `Last send accepted at ${new Date(last.at).toLocaleTimeString("en-GB")}.` : `Last send was rejected: ${firstError(last.checks)}`) : "Not sent to nphies yet."}
          {!m.heightCm || !m.weightKg ? " Height and weight are missing." : ""}
        </div>
        <div className="flex items-center gap-2">
          {dev && <Button size="sm" onClick={() => setShowFhir(!showFhir)}>{showFhir ? "Hide" : "Show"} FHIR Details</Button>}
          <span title={!canWrite ? "You do not have permission to prescribe" : rx.sentAt && !rx.dirty ? "Nothing new to send" : undefined}>
            <Button variant="primary" disabled={!canWrite || (!!rx.sentAt && !rx.dirty)} onClick={send}>
              <IconSend className="size-4" />
              {rx.sentAt ? "Send Update To NPHIES" : "Send To NPHIES"}
            </Button>
          </span>
        </div>
      </div>
      {dev && showFhir && plan && (
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
            <p>{ACTION_TEXT[confirm.key].help}</p>
            {rx.raqeebRef && <p className="text-xs text-muted-foreground">Sent with Raqeeb reference id {rx.raqeebRef}.</p>}
            <Field label="Reason (Optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: patient changed treatment" />
            </Field>
          </div>
        )}
      </Dialog>
    </Card>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
export function firstError(checks: { level: string; text: string }[]): string {
  return checks.find((c) => c.level === "error")?.text ?? "Rejected.";
}
