import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { PatientStrip } from "@/components/VisitActions";
import { Button, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import {
  CANCEL_REQUEST_REASONS, REJECT_REASONS, cancelRequest, departmentLabel, doctorLabel, rejectRequest, type AdmissionRequest,
} from "@/lib/admission-requests";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { StillNeeded, WhatWillHappen } from "./parts";

/** Reject or cancel a pending request, with a reason. No visit is made and no message is sent. */
export function DecisionDialog({ request: r, kind, onClose }: { request: AdmissionRequest; kind: "reject" | "cancel"; onClose: () => void }) {
  const state = useHis();
  const patient = state.patients.find((p) => p.id === r.patientId);
  const reasons = kind === "reject" ? REJECT_REASONS : CANCEL_REQUEST_REASONS;
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);
  const title = kind === "reject" ? "Reject Admission Request" : "Cancel Admission Request";
  const text = reason === "Other" ? note.trim() : note.trim() ? `${reason}: ${note.trim()}` : reason;
  const missing = !reason ? ["Choose a reason."] : reason === "Other" && note.trim().length < 3 ? ["Say what the reason is."] : [];

  function confirm() {
    const res = kind === "reject" ? rejectRequest(r.id, text) : cancelRequest(r.id, text);
    if (!res.ok) return setErrors(res.errors);
    pushToast({ tone: "ok", text: `Admission request ${r.id} ${kind === "reject" ? "rejected" : "cancelled"}.`, detail: "No visit was made and no ADT message was sent." });
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      wide
      title={title}
      subtitle={`Request ${r.id}, ${departmentLabel(r.department)}, requested by ${r.requestedBy}. Approver ${doctorLabel(r.approvingDoctor)}.`}
      footer={
        <>
          <Button onClick={onClose}>Go Back</Button>
          <Button variant="danger" disabled={missing.length > 0} onClick={confirm}>{kind === "reject" ? "Reject Request" : "Cancel Request"}</Button>
        </>
      }
    >
      <PatientStrip patient={patient} />
      <RequiredNote className="mb-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason" required>
          <Select value={reason} onChange={(e) => { setReason(e.target.value); setErrors([]); }}>
            <option value="">Choose a reason</option>
            {[...reasons, "Other"].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="More Detail" required={reason === "Other"} hint={reason === "Other" ? "Say what the reason is." : "Optional."}>
          <Input value={note} onChange={(e) => { setNote(e.target.value); setErrors([]); }} placeholder="Add a few words" />
        </Field>
      </div>
      <WhatWillHappen
        items={[
          `The request is marked ${kind === "reject" ? "Rejected" : "Cancelled"} with the reason, and kept in the audit log.`,
          "No visit is made and no message is sent to NPHIES.",
          r.fromVisit && `Visit ${r.fromVisit} stays as it is.`,
          "A new request can be raised for the patient later.",
        ]}
      />
      <StillNeeded items={errors} />
    </Dialog>
  );
}
