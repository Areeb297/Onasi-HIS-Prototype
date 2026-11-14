import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { PatientIdStrip } from "@/components/emr/PatientIdStrip";
import { Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { machinesFor, procByCode } from "@/lib/fhir/rad-catalog";
import type { PregnancyCheck, RadOrder } from "@/lib/fhir/types";
import type { Patient } from "@/lib/model";
import { PREGNANCY_TEXT, completeExam, examProblems, needsPregnancyCheck, type ExamDetails } from "@/lib/radiology";
import { toLocalInput } from "@/lib/store";

/**
 * The technologist step: machine, start and end time, contrast and the pregnancy check, then Mark Exam Done.
 * The report cannot start before this is saved.
 */
export function RadExamDialog({ order, patient, onClose, onDone }: { order: RadOrder; patient: Patient; onClose: () => void; onDone?: () => void }) {
  const proc = procByCode(order.procCode);
  const machines = machinesFor(order.procCode);
  const askPregnancy = needsPregnancyCheck(patient);
  const [machine, setMachine] = React.useState(machines.length === 1 ? machines[0] : "");
  const [start, setStart] = React.useState(() => toLocalInput(new Date(Date.now() - 15 * 60_000)));
  const [end, setEnd] = React.useState(() => toLocalInput(new Date()));
  const [contrast, setContrast] = React.useState<"" | "yes" | "no">("");
  const [amount, setAmount] = React.useState("");
  const [pregnancy, setPregnancy] = React.useState<PregnancyCheck | "">("");
  const [pregnancyNote, setPregnancyNote] = React.useState("");
  const [images, setImages] = React.useState(true);

  const details: ExamDetails = {
    machine, start, end,
    contrastGiven: contrast === "" ? null : contrast === "yes",
    contrastAmount: amount,
    pregnancy, pregnancyNote, images,
  };
  const problems = examProblems(details, patient);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record Exam"
      subtitle={proc?.display ?? order.procCode}
      wide
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            disabled={problems.length > 0}
            onClick={() => {
              if (completeExam(order.id, details)) {
                onDone?.();
                onClose();
              }
            }}
          >
            Mark Exam Done
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <PatientIdStrip patient={patient} visitNumber={order.visitNumber} />
        <p className="text-xs text-foreground">
          <span className="font-semibold">Reason for the exam:</span> {order.indication}
          {proc?.contrast && <span className="ml-2 font-semibold text-warn">This exam is normally done with contrast.</span>}
        </p>
        <RequiredNote />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Machine" required>
            <Select value={machine} aria-required="true" onChange={(e) => setMachine(e.target.value)}>
              <option value="">Choose machine</option>
              {machines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Start Time" required>
            <Input type="datetime-local" value={start} aria-required="true" onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End Time" required>
            <Input type="datetime-local" value={end} aria-required="true" onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Contrast Given" required>
            <Select value={contrast} aria-required="true" onChange={(e) => setContrast(e.target.value as "" | "yes" | "no")}>
              <option value="">Choose</option>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </Select>
          </Field>
          {contrast === "yes" && (
            <Field label="Contrast Amount" required className="sm:col-span-2">
              <Input value={amount} aria-required="true" onChange={(e) => setAmount(e.target.value)} placeholder="For example: 80 mL iohexol, intravenous" />
            </Field>
          )}
        </div>
        {askPregnancy && (
          <div className="grid gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 sm:grid-cols-3">
            <Field label="Pregnancy Check" required hint="Asked of women aged 12 to 55 before the exam.">
              <Select value={pregnancy} aria-required="true" onChange={(e) => setPregnancy(e.target.value as PregnancyCheck | "")}>
                <option value="">Choose</option>
                {(Object.keys(PREGNANCY_TEXT) as PregnancyCheck[]).map((k) => (
                  <option key={k} value={k}>{PREGNANCY_TEXT[k]}</option>
                ))}
              </Select>
            </Field>
            {(pregnancy === "pregnant" || pregnancy === "unsure") && (
              <Field label="What Was Done" required className="sm:col-span-2">
                <Input value={pregnancyNote} aria-required="true" onChange={(e) => setPregnancyNote(e.target.value)} placeholder="For example: radiologist informed, exam approved with shielding" />
              </Field>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />
          Images Sent To PACS
        </label>
        {problems.length > 0 && (
          <p className="text-xs font-medium text-warn" role="status">
            Still needed: {problems.join(" ")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
