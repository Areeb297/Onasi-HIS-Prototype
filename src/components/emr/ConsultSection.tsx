import * as React from "react";
import { AlertTriangle, Check, MessageSquarePlus, PenLine, Stethoscope, XCircle } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { EmptyState, EntrySheet, ErrorSummary, FormField, FormGrid, RowMenu, Segmented, TextArea, useValidation } from "@/components/emr/entry-ui";
import { Badge, Button, Card, CardHeader, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { fmtShort } from "@/lib/format";
import {
  CONSULT_LABEL, SPECIALTIES, URGENCY_LABEL, acceptConsult, answerConsult, chartFindings, closeConsult, consultTimes, consultsOf, minutesText, requestConsult,
  useCareRequests, type Consult, type ConsultStatus, type Urgency,
} from "@/lib/care-requests";
import type { Encounter } from "@/lib/model";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/** The chart "Consult Requests" tab: ask another specialty, then follow the request until the patient is seen. */

const STATUS_TONE: Record<ConsultStatus, "warn" | "info" | "ok" | "neutral"> = { requested: "warn", accepted: "info", seen: "ok", closed: "neutral" };
const URGENCY_TONE: Record<Urgency, "neutral" | "warn" | "danger"> = { routine: "neutral", urgent: "warn", emergency: "danger" };
const dateTime = (t: string) => fmtShort(t);

function useNow(everyMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

export function ConsultSection({ enc }: { enc: Encounter }) {
  const s = useCareRequests();
  const { role } = useSession();
  const now = useNow();
  const list = consultsOf(enc.visitNumber, s);
  const isDoctor = can("emr.write") && (role.id === "physician" || role.id === "admin");
  const [adding, setAdding] = React.useState(false);
  const addButton = (
    <span title={isDoctor ? undefined : "Only a doctor can ask for a consult"}>
      <Button size="sm" variant="primary" disabled={!isDoctor} onClick={() => setAdding(true)}><MessageSquarePlus className="size-4" aria-hidden="true" /> New Consult Request</Button>
    </span>
  );

  return (
    <Card>
      <CardHeader
        title="Consult Requests"
        subtitle="Ask another specialty to see the patient. The time to accepted and to seen is measured."
        right={list.length > 0 ? addButton : undefined}
      />
      {list.length === 0 ? (
        <EmptyState icon={<Stethoscope />} title="No Consults On This Visit" action={isDoctor ? addButton : undefined}>
          {isDoctor ? "Ask another specialty to see the patient." : "The doctor asks for a consult here."}
        </EmptyState>
      ) : (
        <ul className="space-y-3 p-3 sm:p-4" aria-label="Consult requests">
          {list.map((c) => <ConsultRow key={c.id} c={c} now={now} isDoctor={isDoctor} />)}
        </ul>
      )}
      {adding && <ConsultForm enc={enc} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function Step({ label, who, at, extra, done }: { label: string; who?: string; at?: string; extra?: string; done: boolean }) {
  return (
    <li className="min-w-[9.5rem] flex-1 rounded-lg border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <span aria-hidden="true" className={done && at ? "size-1.5 rounded-full bg-ok" : "size-1.5 rounded-full bg-border"} />
        {label}
      </div>
      {done && at ? (
        <>
          <div className="text-[0.8125rem] tabular-nums">{dateTime(at)}</div>
          <div className="text-xs text-muted-foreground">{who}</div>
          {extra && <div className="mt-0.5 text-xs font-medium">{extra}</div>}
        </>
      ) : (
        <div className="text-xs text-muted-foreground">Not yet</div>
      )}
    </li>
  );
}

function ConsultRow({ c, now, isDoctor }: { c: Consult; now: number; isDoctor: boolean }) {
  const t = consultTimes(c, now);
  const [answering, setAnswering] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [why, setWhy] = React.useState("");
  const [error, setError] = React.useState("");
  const open = c.status === "requested" || c.status === "accepted";
  const needsWhy = c.status !== "seen";
  const off = isDoctor ? undefined : "Only a doctor can change a consult";

  function accept() {
    if (acceptConsult(c.id).ok) pushToast({ tone: "ok", text: `${c.specialty} consult accepted` });
  }
  function close() {
    if (needsWhy && !why.trim()) { setError("Write why the consult is closed."); return; }
    const res = closeConsult(c.id, why);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "ok", text: `${c.specialty} consult closed` });
    setClosing(false); setWhy(""); setError("");
  }
  const stopClosing = () => { setClosing(false); setWhy(""); setError(""); };

  return (
    <li className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9375rem] font-semibold">{c.specialty}</span>
            <Badge tone={STATUS_TONE[c.status]}>{CONSULT_LABEL[c.status]}</Badge>
            <Badge tone={URGENCY_TONE[c.urgency]}>{URGENCY_LABEL[c.urgency]}</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">Asked by {c.requestedBy}, {dateTime(c.requestedAt)}</div>
        </div>
        {c.status !== "closed" && (
          <div className="ms-auto flex shrink-0 items-center gap-1.5" title={off}>
            {c.status === "requested" && <Button size="sm" variant="primary" disabled={!isDoctor} onClick={accept}><Check className="size-4" aria-hidden="true" /> Accept Consult</Button>}
            {c.status === "accepted" && <Button size="sm" variant="primary" disabled={!isDoctor} onClick={() => setAnswering(true)}><PenLine className="size-4" aria-hidden="true" /> Write Answer</Button>}
            {c.status === "seen" && <Button size="sm" disabled={!isDoctor} onClick={() => setClosing(true)}>Close Consult</Button>}
            {isDoctor && open && (
              <RowMenu
                label={`More actions for the ${c.specialty} consult`}
                items={[
                  c.status === "requested" && { label: "Write Answer", icon: <PenLine className="size-4" />, onSelect: () => setAnswering(true) },
                  { label: "Close Consult", icon: <XCircle className="size-4" />, onSelect: () => setClosing(true), danger: true },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {t.overdue && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Overdue. Waiting {minutesText(t.waiting ?? 0)}; the target for {URGENCY_LABEL[c.urgency].toLowerCase()} consults is {minutesText(t.target)}. Call the {c.specialty} doctor on call.
        </p>
      )}
      {open && !t.overdue && <p className="mt-2 text-xs text-muted-foreground">Waiting {minutesText(t.waiting ?? 0)}. Target: seen within {minutesText(t.target)}.</p>}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-muted-foreground">Clinical Question</div>
          <p className="whitespace-pre-line text-sm">{c.question}</p>
        </div>
        {c.findings && (
          <div>
            <div className="text-xs font-semibold text-muted-foreground">Relevant Findings</div>
            <p className="whitespace-pre-line text-[0.8125rem] text-muted-foreground">{c.findings}</p>
          </div>
        )}
      </div>

      <ol className="mt-3 flex flex-wrap gap-2" aria-label="Consult steps">
        <Step label="Requested" done who={c.requestedBy} at={c.requestedAt} />
        <Step label="Accepted" done={!!c.acceptedAt} who={c.acceptedBy} at={c.acceptedAt} extra={t.toAccepted !== undefined ? `${minutesText(t.toAccepted)} after the request` : undefined} />
        <Step label="Seen" done={!!c.seenAt} who={c.seenBy} at={c.seenAt} extra={t.toSeen !== undefined ? `${minutesText(t.toSeen)} after the request${t.seenLate ? `, past the ${minutesText(t.target)} target` : ""}` : undefined} />
        <Step label="Closed" done={!!c.closedAt} who={c.closedBy} at={c.closedAt} extra={c.closeReason ? `Reason: ${c.closeReason}` : undefined} />
      </ol>

      {c.answer && (
        <div className="mt-3 rounded-lg border border-ok/40 bg-ok/8 px-3 py-2">
          <div className="text-xs font-semibold">Answer From {c.seenBy}</div>
          <p className="whitespace-pre-line text-sm">{c.answer}</p>
          {c.recommendations && (
            <>
              <div className="mt-2 text-xs font-semibold">Recommendations</div>
              <p className="whitespace-pre-line text-sm">{c.recommendations}</p>
            </>
          )}
        </div>
      )}

      {answering && <AnswerSheet c={c} onClose={() => setAnswering(false)} />}

      <Dialog
        open={closing}
        onClose={stopClosing}
        title="Close Consult"
        subtitle={`${c.specialty}, ${URGENCY_LABEL[c.urgency].toLowerCase()}`}
        footer={<><Button variant="ghost" onClick={stopClosing}>Keep It Open</Button><Button variant="primary" onClick={close}>Close Consult</Button></>}
      >
        <div className="space-y-3 text-sm">
          <p>{c.status === "seen" ? "The patient was seen and the answer is in the chart. Closing means the treating team has read it." : "The patient was not seen yet. Give the reason for closing."}</p>
          <FormField label="Reason" required={needsWhy} error={error || undefined} help={needsWhy ? undefined : "Optional."}>
            <Input value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} placeholder={needsWhy ? "For example: patient transferred" : undefined} />
          </FormField>
        </div>
      </Dialog>
    </li>
  );
}

function AnswerSheet({ c, onClose }: { c: Consult; onClose: () => void }) {
  const [answer, setAnswer] = React.useState("");
  const [recs, setRecs] = React.useState("");
  const [failed, setFailed] = React.useState<string[]>([]);
  const v = useValidation({ answer: !answer.trim() && "Write the answer to the clinical question." });

  function save() {
    if (!v.submit()) return;
    const res = answerConsult(c.id, answer, recs);
    if (!res.ok) { setFailed(res.errors); return; }
    pushToast({ tone: "ok", text: `${c.specialty} consult answered`, detail: `Seen ${minutesText(consultTimes(res.value).toSeen ?? 0)} after the request.` });
    onClose();
  }

  return (
    <EntrySheet
      onClose={onClose}
      title="Write Consult Answer"
      subtitle={`${c.specialty}, asked by ${c.requestedBy}`}
      dirty={!!(answer.trim() || recs.trim())}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save Answer And Mark Seen</Button></>}
    >
      <div className="space-y-4">
        <ErrorSummary problems={failed} title="The answer was not saved" />
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
          <div className="text-xs font-semibold text-muted-foreground">Clinical Question</div>
          <p className="whitespace-pre-line text-sm">{c.question}</p>
        </div>
        <FormField label="Answer" required error={v.error("answer")}>
          <TextArea rows={5} value={answer} onChange={(e) => { setAnswer(e.target.value); setFailed([]); }} onBlur={v.blur("answer")} />
        </FormField>
        <FormField label="Recommendations" help="What the treating team should do next.">
          <TextArea rows={4} value={recs} onChange={(e) => setRecs(e.target.value)} />
        </FormField>
      </div>
    </EntrySheet>
  );
}

const URGENCY_OPTIONS = (Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => ({ value: u, label: URGENCY_LABEL[u] }));

function ConsultForm({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const [specialty, setSpecialty] = React.useState("");
  const [urgency, setUrgency] = React.useState<Urgency>(enc.cls === "E" ? "urgent" : "routine");
  const [question, setQuestion] = React.useState("");
  const [findings, setFindings] = React.useState("");
  const [failed, setFailed] = React.useState<string[]>([]);
  const v = useValidation({
    specialty: !specialty && "Choose the specialty.",
    question: !question.trim() && "Write the clinical question.",
  });

  function pull() {
    const text = chartFindings(enc);
    setFindings((f) => (f.trim() ? `${f.trim()}\n${text}` : text));
  }
  function save() {
    if (!v.submit()) return;
    const res = requestConsult({ visit: enc.visitNumber, specialty, urgency, question, findings });
    if (!res.ok) { setFailed(res.errors); return; }
    pushToast({ tone: "ok", text: `${res.value.specialty} consult requested`, detail: `${URGENCY_LABEL[urgency]}. Target: seen within ${minutesText(consultTimes(res.value).target)}.` });
    onClose();
  }

  return (
    <EntrySheet
      onClose={onClose}
      title="New Consult Request"
      subtitle="Ask another specialty to see this patient."
      dirty={!!(specialty || question.trim() || findings.trim())}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Send Consult Request</Button></>}
    >
      <div className="space-y-4">
        <RequiredNote />
        <ErrorSummary problems={failed.length ? failed : v.summary} />
        <FormGrid>
          <FormField label="Specialty" required error={v.error("specialty")}>
            <Select value={specialty} onChange={(e) => { setSpecialty(e.target.value); setFailed([]); }} onBlur={v.blur("specialty")}>
              <option value="">Choose A Specialty</option>
              {SPECIALTIES.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </FormField>
          <FormField label="Urgency" required group help={urgency === "emergency" ? "Seen within 30 minutes. Call the doctor on call as well." : undefined}>
            <Segmented value={urgency} options={URGENCY_OPTIONS} onChange={setUrgency} />
          </FormField>
        </FormGrid>
        <FormField label="Clinical Question" required error={v.error("question")} help="One clear question the consultant can answer.">
          <TextArea rows={3} value={question} onChange={(e) => { setQuestion(e.target.value); setFailed([]); }} onBlur={v.blur("question")} placeholder="For example: new atrial fibrillation, should we start an anticoagulant?" />
        </FormField>
        <FormField label="Relevant Findings" help="You can edit the text after it is added.">
          <TextArea rows={5} value={findings} onChange={(e) => setFindings(e.target.value)} />
        </FormField>
        <Button size="sm" onClick={pull}>Add Findings From The Chart</Button>
      </div>
    </EntrySheet>
  );
}
