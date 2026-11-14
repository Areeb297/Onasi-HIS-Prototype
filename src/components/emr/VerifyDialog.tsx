import * as React from "react";
import { IconAlertTriangle, IconCircleCheck, IconInfoCircle, IconShieldExclamation } from "@tabler/icons-react";
import { ControlBadge, PatientStrip, VerifyBadge, VerifyTrail } from "@/components/emr/RxShared";
import { Dialog } from "@/components/Dialog";
import { Button, Field, RequiredNote, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { useLab } from "@/lib/lab";
import { DOCTORS } from "@/lib/reference-data";
import { activeDrugsOnVisit, fillOf, getDrug, useRx } from "@/lib/rx";
import { ageOf, measuresFor } from "@/lib/rx-send";
import type { Prescription } from "@/lib/rx-types";
import {
  buildCheckSheet, kidneyNotes, orderLine, queryPrescriber, rejectItem, sheetNeedsNote, verifyItem, verifyStatusOf, type SheetLevel,
} from "@/lib/rx-verify";
import { can } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * The pharmacist check sheet for one prescription item.
 * It shows what the chart knows (allergies, duplicates, interactions, dose, weight, kidney) and takes the decision:
 * Verify, Query The Prescriber or Reject. All three are hospital records. Nothing is sent to nphies.
 */

type Choice = "verify" | "query" | "reject";

const LEVEL: Record<SheetLevel, { word: string; cls: string; icon: React.ReactNode }> = {
  stop: { word: "Serious", cls: "border-destructive/40 bg-destructive/8", icon: <IconShieldExclamation className="size-4 text-destructive" stroke={1.75} /> },
  caution: { word: "Check", cls: "border-warn/40 bg-warn/10", icon: <IconAlertTriangle className="size-4 text-warn" stroke={1.75} /> },
  clear: { word: "No problem found", cls: "border-border bg-card", icon: <IconCircleCheck className="size-4 text-ok" stroke={1.75} /> },
  info: { word: "For information", cls: "border-border bg-card", icon: <IconInfoCircle className="size-4 text-muted-foreground" stroke={1.75} /> },
};

const CHOICES: { id: Choice; label: string; help: string }[] = [
  { id: "verify", label: "Verify", help: "The item is safe to dispense." },
  { id: "query", label: "Query The Prescriber", help: "Ask a question. The prescriber sees it on the prescription in the chart." },
  { id: "reject", label: "Reject", help: "The item must not be dispensed as written." },
];

export function VerifyDialog({ rx, itemId, onClose }: { rx: Prescription; itemId: string; onClose: () => void }) {
  const s = useRx();
  const his = useHis();
  const lab = useLab();
  const allowed = can("rx.dispense");
  const item = rx.items.find((i) => i.id === itemId);
  const patient = his.patients.find((p) => p.id === rx.patientId);
  const enc = his.encounters.find((e) => e.visitNumber === rx.visitNumber);
  const [choice, setChoice] = React.useState<Choice>("verify");
  const [text, setText] = React.useState("");
  const [problem, setProblem] = React.useState("");

  if (!item) return null;
  const drug = getDrug(item.drugId);
  const m = enc ? measuresFor(s, enc) : {};
  const status = verifyStatusOf(item, fillOf(s, rx, item).dispensedTotal);
  const sheet = buildCheckSheet({
    drug,
    dose: item.dose,
    frequencyId: item.frequencyId,
    durationDays: item.durationDays,
    route: item.route,
    refills: item.refills,
    usage: rx.usage,
    allergies: enc?.allergies ?? [],
    others: activeDrugsOnVisit(s, rx.visitNumber, item.id),
    heightCm: m.heightCm,
    weightKg: m.weightKg,
    ageYears: patient ? ageOf(patient.dob) : undefined,
    kidney: kidneyNotes(enc?.dx ?? [], lab.orders, rx.patientId),
    allergyOverride: item.allergyOverride,
  });
  const needNote = sheetNeedsNote(sheet);
  const o = orderLine(drug, item);
  const doctor = DOCTORS.find((d) => d.id === rx.prescriberId);
  const textOk = choice === "verify" ? !needNote || text.trim().length >= 5 : text.trim().length >= 5;
  const done = status === "verified";

  function save() {
    const res = choice === "verify" ? verifyItem(rx.id, item!.id, text, needNote) : choice === "query" ? queryPrescriber(rx.id, item!.id, text) : rejectItem(rx.id, item!.id, text);
    if (!res.ok) return setProblem(res.problem ?? "This could not be saved.");
    pushToast({
      tone: choice === "reject" ? "danger" : "ok",
      text: choice === "verify" ? `${drug.generic} verified` : choice === "query" ? "Question sent to the prescriber" : `${drug.generic} rejected`,
      detail: choice === "verify" ? "It can be dispensed now." : "The prescriber sees it on the prescription in the chart.",
    });
    onClose();
  }

  const fieldLabel = choice === "verify" ? "Note" : choice === "query" ? "Question For The Prescriber" : "Reason For Rejecting";
  const required = choice !== "verify" || needNote;
  const blockedWhy = !allowed ? "Your role cannot verify medicines" : done ? "This item is already verified" : !textOk ? `Type the ${choice === "verify" ? "note" : choice === "query" ? "question" : "reason"} first` : undefined;

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title="Pharmacist Check"
      subtitle={`${drug.generic} ${drug.strengthValue} ${drug.strengthUnit} · ${rx.number}`}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <span title={blockedWhy}>
            <Button variant={choice === "reject" ? "danger" : "primary"} disabled={!!blockedWhy} onClick={save}>
              {choice === "verify" ? "Verify Item" : choice === "query" ? "Send Question To Prescriber" : "Reject Item"}
            </Button>
          </span>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <PatientStrip patient={patient} allergies={enc?.allergies ?? []} weightKg={m.weightKg} visit={rx.visitNumber} />

        <div className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{drug.generic} {drug.strengthValue} {drug.strengthUnit}</span>
            <span className="text-xs text-muted-foreground">{drug.form}</span>
            <ControlBadge cls={drug.controlClass} />
            <VerifyBadge status={status} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
            <Fact label="Dose" value={o.dose} />
            <Fact label="Route" value={o.route} />
            <Fact label="Frequency" value={o.frequency} />
            <Fact label="Duration" value={o.duration} />
            <Fact label="Quantity" value={`${item.quantity} ${drug.unit}${item.refills ? `, ${item.refills} repeats` : ""}`} />
            <Fact label="Prescriber" value={doctor ? `Dr. ${doctor.given} ${doctor.family}` : rx.prescriberId} />
            <Fact label="Reason" value={item.reason.text} wide />
            {item.fulfillmentNote && <Fact label="Note To Pharmacy" value={item.fulfillmentNote} wide />}
            {item.patientInstruction && <Fact label="Instructions For The Patient" value={item.patientInstruction} wide />}
          </dl>
          <div className="mt-2"><VerifyTrail item={item} status={status} /></div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">Check Sheet</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sheet.map((sec) => {
              const v = LEVEL[sec.level];
              return (
                <li key={sec.id} className={cn("rounded-md border px-3 py-2", v.cls)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold">{v.icon}{sec.title}</span>
                    <span className="text-xs text-muted-foreground">{v.word}</span>
                  </div>
                  <ul className="mt-1 space-y-1 text-xs leading-snug">
                    {sec.lines.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                </li>
              );
            })}
          </ul>
        </div>

        {!done && (
          <div className="rounded-lg border border-border p-3">
            <div role="radiogroup" aria-label="Decision" className="grid gap-2 sm:grid-cols-3">
              {CHOICES.map((c) => (
                <label key={c.id} className={cn("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2", choice === c.id ? "border-primary bg-accent/50" : "border-border")}>
                  <input type="radio" name="verify-choice" className="mt-0.5 size-4 accent-primary" checked={choice === c.id} disabled={!allowed} onChange={() => { setChoice(c.id); setProblem(""); }} />
                  <span>
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.help}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field
              className="mt-3"
              label={fieldLabel}
              required={required}
              hint={choice === "verify" ? (needNote ? "The check sheet shows a serious finding. Say why it is safe to go ahead." : "Optional.") : choice === "reject" ? "The prescriber sees this reason. Nothing is sent to NPHIES until the prescriber cancels the item." : "The item waits until the prescriber answers and you verify it."}
            >
              <Textarea rows={3} value={text} disabled={!allowed} onChange={(e) => { setText(e.target.value); setProblem(""); }} />
            </Field>
            {required && <RequiredNote className="mt-2" />}
            {!allowed && <p className="mt-2 text-xs text-muted-foreground">Your role cannot verify medicines. A pharmacist does this step.</p>}
            {problem && <p role="alert" className="mt-2 text-xs text-destructive">{problem}</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 sm:col-span-3" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}
