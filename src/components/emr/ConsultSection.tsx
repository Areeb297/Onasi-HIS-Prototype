import * as React from "react";
import { AlertTriangle, MessageSquarePlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
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
const dateTime = (t: string) => new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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

  return (
    <Card>
      <CardHeader
        title="Consult Requests"
        subtitle="Ask another specialty to see the patient. The times from request to accepted and to seen are measured."
        right={
          <span title={isDoctor ? undefined : "Only a doctor can ask for a consult"}>
            <Button variant="primary" disabled={!isDoctor || adding} onClick={() => setAdding(true)}><MessageSquarePlus className="size-4" aria-hidden="true" /> New Consult Request</Button>
          </span>
        }
      />
      {adding && <ConsultForm enc={enc} onClose={() => setAdding(false)} />}
      {list.length === 0 ? (
        <Empty>{isDoctor ? "No consults asked for on this visit. Choose New Consult Request to ask another specialty." : "No consults asked for on this visit. The doctor asks for one here."}</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((c) => <ConsultRow key={c.id} c={c} now={now} isDoctor={isDoctor} />)}
        </ul>
      )}
    </Card>
  );
}

function Step({ label, who, at, extra, done }: { label: string; who?: string; at?: string; extra?: string; done: boolean }) {
  return (
    <li className="min-w-[9.5rem] flex-1 rounded-md border border-border bg-card px-3 py-2">
      <div className="text-xs font-semibold">{label}</div>
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
  const [answer, setAnswer] = React.useState("");
  const [recs, setRecs] = React.useState("");
  const [why, setWhy] = React.useState("");
  const [error, setError] = React.useState("");
  const open = c.status === "requested" || c.status === "accepted";

  function saveAnswer() {
    const res = answerConsult(c.id, answer, recs);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "ok", text: `${c.specialty} consult answered`, detail: `Seen ${minutesText(consultTimes(res.value).toSeen ?? 0)} after the request.` });
    setAnswering(false); setError("");
  }
  function close() {
    const res = closeConsult(c.id, why);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "ok", text: `${c.specialty} consult closed` });
    setClosing(false); setWhy(""); setError("");
  }

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[c.status]}>{CONSULT_LABEL[c.status]}</Badge>
        <span className="text-[0.9375rem] font-semibold">{c.specialty}</span>
        <Badge tone={URGENCY_TONE[c.urgency]}>{URGENCY_LABEL[c.urgency]}</Badge>
        <span className="text-xs text-muted-foreground">Asked by {c.requestedBy}, {dateTime(c.requestedAt)}</span>
      </div>

      {t.overdue && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] font-medium text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Overdue. Waiting {minutesText(t.waiting ?? 0)}; the target for {URGENCY_LABEL[c.urgency].toLowerCase()} consults is {minutesText(t.target)}. Call the {c.specialty} doctor on call.
        </p>
      )}
      {open && !t.overdue && <p className="mt-2 text-xs text-muted-foreground">Waiting {minutesText(t.waiting ?? 0)}. Target: seen within {minutesText(t.target)}.</p>}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <div className="text-xs font-semibold">Clinical question</div>
          <p className="whitespace-pre-line text-sm">{c.question}</p>
        </div>
        {c.findings && (
          <div>
            <div className="text-xs font-semibold">Relevant findings</div>
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
        <div className="mt-3 rounded-md border border-ok/40 bg-ok/8 px-3 py-2">
          <div className="text-xs font-semibold">Answer from {c.seenBy}</div>
          <p className="whitespace-pre-line text-sm">{c.answer}</p>
          {c.recommendations && (
            <>
              <div className="mt-2 text-xs font-semibold">Recommendations</div>
              <p className="whitespace-pre-line text-sm">{c.recommendations}</p>
            </>
          )}
        </div>
      )}

      {answering && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-3" role="region" aria-label="Write the consult answer">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Answer To The Clinical Question" required>
              <Textarea value={answer} onChange={(e) => { setAnswer(e.target.value); setError(""); }} rows={3} className="bg-card" />
            </Field>
            <Field label="Recommendations" hint="What the treating team should do next.">
              <Textarea value={recs} onChange={(e) => setRecs(e.target.value)} rows={3} className="bg-card" />
            </Field>
          </div>
          {error && <p role="alert" className="mt-2 text-[0.8125rem] text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={saveAnswer}>Save Answer And Mark Seen</Button>
            <Button onClick={() => { setAnswering(false); setError(""); }}>Close Without Saving</Button>
          </div>
        </div>
      )}

      {c.status !== "closed" && !answering && (
        <div className="mt-3 flex flex-wrap gap-2" title={isDoctor ? undefined : "Only a doctor can change a consult"}>
          {c.status === "requested" && <Button size="sm" variant="primary" disabled={!isDoctor} onClick={() => { if (acceptConsult(c.id).ok) pushToast({ tone: "ok", text: `${c.specialty} consult accepted` }); }}>Accept Consult</Button>}
          {open && <Button size="sm" variant={c.status === "accepted" ? "primary" : "secondary"} disabled={!isDoctor} onClick={() => setAnswering(true)}>Write Answer</Button>}
          <Button size="sm" disabled={!isDoctor} onClick={() => setClosing(true)}>Close Consult</Button>
        </div>
      )}

      <Dialog
        open={closing}
        onClose={() => { setClosing(false); setError(""); }}
        title="Close Consult"
        subtitle={`${c.specialty}, ${URGENCY_LABEL[c.urgency].toLowerCase()}`}
        footer={<><Button onClick={() => { setClosing(false); setError(""); }}>Keep It Open</Button><Button variant="primary" onClick={close}>Close Consult</Button></>}
      >
        <div className="space-y-3 text-sm">
          <p>{c.status === "seen" ? "The patient was seen and the answer is in the chart. Closing means the treating team has read it." : "The patient was not seen yet. Give the reason for closing."}</p>
          <Field label="Reason" required={c.status !== "seen"}>
            <Input value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} />
          </Field>
          {error && <p role="alert" className="text-[0.8125rem] text-destructive">{error}</p>}
        </div>
      </Dialog>
    </li>
  );
}

function ConsultForm({ enc, onClose }: { enc: Encounter; onClose: () => void }) {
  const [specialty, setSpecialty] = React.useState("");
  const [urgency, setUrgency] = React.useState<Urgency>(enc.cls === "E" ? "urgent" : "routine");
  const [question, setQuestion] = React.useState("");
  const [findings, setFindings] = React.useState("");
  const [errors, setErrors] = React.useState<string[]>([]);

  function pull() {
    const text = chartFindings(enc);
    setFindings((f) => (f.trim() ? `${f.trim()}\n${text}` : text));
  }
  function save() {
    const res = requestConsult({ visit: enc.visitNumber, specialty, urgency, question, findings });
    if (!res.ok) { setErrors(res.errors); return; }
    pushToast({ tone: "ok", text: `${res.value.specialty} consult requested`, detail: `${URGENCY_LABEL[urgency]}. Target: seen within ${minutesText(consultTimes(res.value).target)}.` });
    onClose();
  }

  return (
    <div className="border-b border-border bg-muted/30 px-4 py-4" role="region" aria-label="New consult request">
      <h3 className="text-[0.9375rem] font-semibold">New Consult Request</h3>
      <RequiredNote className="mt-0.5" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Specialty" required>
          <Select value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">Choose a specialty</option>
            {SPECIALTIES.map((x) => <option key={x}>{x}</option>)}
          </Select>
        </Field>
        <Field label="Urgency" required hint={urgency === "emergency" ? "Emergency consults should be seen within 30 minutes. Call the doctor on call as well." : undefined}>
          <Select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)}>
            {(Object.keys(URGENCY_LABEL) as Urgency[]).map((u) => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
          </Select>
        </Field>
        <Field label="Clinical Question" required className="sm:col-span-2" hint="One clear question the consultant can answer.">
          <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} className="bg-card" placeholder="For example: new atrial fibrillation, should we start an anticoagulant?" />
        </Field>
        <Field label="Relevant Findings" className="sm:col-span-2" hint="You can edit the text after it is added.">
          <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={4} className="bg-card" />
        </Field>
      </div>
      <Button className="mt-2" size="sm" onClick={pull}>Add Findings From The Chart</Button>
      {errors.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="primary" onClick={save}>Send Consult Request</Button>
        <Button onClick={onClose}>Close Without Saving</Button>
      </div>
    </div>
  );
}
