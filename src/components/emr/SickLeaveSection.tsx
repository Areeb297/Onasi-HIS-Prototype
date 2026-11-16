import * as React from "react";
import { BadgeCheck, Ban, CalendarHeart, CalendarPlus, Printer, ShieldCheck } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { EmptyState, EntryList, EntryRow, EntrySheet, ErrorSummary, FormField, FormGrid, RowMenu, Segmented, TextArea, useValidation } from "@/components/emr/entry-ui";
import { Badge, Button, Card, CardHeader, Input, RequiredNote, Select } from "@/components/ui/primitives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useCallLog } from "@/lib/integrations/call-log";
import {
  EMPLOYER_LABEL, LEAVE_TYPE_LABEL, MAX_DAYS, RELATIONS, cancelSickLeave, issueBlock, issueSickLeave, leaveEnd, leavesOf, licenceOfCurrentUser, recordPrint,
  sickLeavePrint, useSeha, verifySickLeave, type EmployerType, type LeaveType, type SickLeave, type Verification,
} from "@/lib/integrations/seha";
import type { Encounter } from "@/lib/model";
import { printDocument, printableName } from "@/lib/print-doc";
import { useSession } from "@/lib/session";
import { nowLocal, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { ActionIcon } from "@/components/ui/action-icons";

/** The chart "Sick Leave" tab: a doctor issues a sick leave or a companion leave on Seha, prints it, checks it or cancels it. */

const title = (l: SickLeave) => `${LEAVE_TYPE_LABEL[l.type]}, ${l.days} ${l.days === 1 ? "Day" : "Days"}`;

export function SickLeaveSection({ enc }: { enc: Encounter }) {
  const s = useSeha();
  useSession(); // who may issue depends on who is signed in
  useCallLog(); // so does whether Seha is switched on
  const patient = useHis().patients.find((p) => p.id === enc.patientId);
  const list = leavesOf(enc.visitNumber, s);
  const block = issueBlock();
  const [adding, setAdding] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<SickLeave | null>(null);
  const [why, setWhy] = React.useState("");
  const [error, setError] = React.useState("");
  const [checked, setChecked] = React.useState<Verification | null>(null);

  const closeCancel = () => { setCancelling(null); setWhy(""); setError(""); };

  function print(l: SickLeave) {
    if (printDocument(sickLeavePrint(l))) recordPrint(l.number);
  }
  function verify(l: SickLeave) {
    const res = verifySickLeave(l.number, patient?.nationalId ?? "");
    if (res.ok) setChecked(res.value);
    else pushToast({ tone: "warn", text: res.errors[0] });
  }
  function cancel() {
    if (!cancelling) return;
    const res = cancelSickLeave(cancelling.number, why);
    if (!res.ok) { setError(res.errors[0]); return; }
    pushToast({ tone: "warn", text: "Sick leave cancelled on Seha", detail: res.value.number });
    closeCancel();
  }

  const addButton = (
    <span title={block ?? undefined}>
      <Button size="sm" variant="primary" disabled={!!block} onClick={() => setAdding(true)}><CalendarPlus className="size-4" aria-hidden="true" /> New Sick Leave</Button>
    </span>
  );

  return (
    <Card>
      <CardHeader
        title="Sick Leave"
        subtitle="Issued on the Seha platform of the Ministry of Health. A leave on paper alone is not valid."
        right={list.length > 0 ? addButton : undefined}
      />
      {list.length === 0 ? (
        <EmptyState icon={<CalendarHeart />} title="No Sick Leave Issued" action={block ? undefined : addButton}>
          {block ?? "Issue a sick leave for the patient, or a companion leave for the person staying with them."}
        </EmptyState>
      ) : (
        <EntryList label="Sick leaves">
          {list.map((l) => (
            <EntryRow
              key={l.number}
              code={l.number}
              title={title(l)}
              badges={<Badge tone={l.status === "Issued" ? "ok" : "neutral"}>{l.status}</Badge>}
              muted={l.status === "Cancelled"}
              meta={[
                ["From", fmtDate(l.startDate)],
                ["To", fmtDate(l.endDate)],
                ["Diagnosis", `${l.dxCode} ${l.dxText}`],
                l.type === "companion" && ["Companion", `${l.companionName} (${l.companionRelation})`],
                ["Employer", EMPLOYER_LABEL[l.employerType]],
                ["Doctor", `${l.doctor}, licence ${l.licence}`],
              ]}
              right={(
                <>
                  <ActionIcon kind="print" name="sick leave" onClick={() => print(l)} />
                  <RowMenu
                    label={`More actions for ${l.number}`}
                    items={[
                      { label: "Verify On Seha", icon: <ShieldCheck className="size-4" />, onSelect: () => verify(l) },
                      l.status === "Issued" && { label: "Cancel Sick Leave", icon: <Ban className="size-4" />, onSelect: () => { setCancelling(l); setError(""); }, danger: true, disabled: !!block, title: block ?? undefined },
                    ]}
                  />
                </>
              )}
            >
              {l.notes && <p className="mt-1 text-xs"><span className="text-muted-foreground">Notes: </span>{l.notes}</p>}
              {l.status === "Cancelled" && <p className="mt-1 text-xs text-muted-foreground">Cancelled by {l.cancelledBy}, {fmtDateTime(l.cancelledAt)}: {l.cancelReason}</p>}
              <details className="mt-1.5 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Audit Trail ({l.trail.length})</summary>
                <ol className="mt-1 space-y-0.5">
                  {l.trail.map((t, i) => <li key={i}><span className="tabular-nums text-muted-foreground">{fmtDateTime(t.at)}</span> {t.by}: {t.text}</li>)}
                </ol>
              </details>
            </EntryRow>
          ))}
        </EntryList>
      )}

      {adding && <SickLeaveForm enc={enc} patientLine={`${printableName(patient)}, ID ${patient?.nationalId ?? "not on file"}, MRN ${patient?.mrn ?? ""}`} onClose={() => setAdding(false)} />}

      <Dialog
        open={!!cancelling}
        onClose={closeCancel}
        title="Cancel Sick Leave"
        subtitle={cancelling ? `${cancelling.number}. Seha marks the leave as cancelled.` : undefined}
        footer={<><Button variant="ghost" onClick={closeCancel}>Keep The Leave</Button><Button variant="danger" onClick={cancel}>Cancel Sick Leave</Button></>}
      >
        <FormField label="Reason" required error={error || undefined}>
          <Input value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} placeholder="For example: issued with the wrong dates" />
        </FormField>
      </Dialog>

      <Dialog
        open={!!checked}
        onClose={() => setChecked(null)}
        title="Seha Verification"
        subtitle="What an employer sees when they check this leave on Seha."
        footer={<Button variant="primary" onClick={() => setChecked(null)}>Done</Button>}
      >
        {checked && (
          <div className="space-y-3">
            <p className={checked.valid ? "flex items-center gap-2 text-sm font-semibold text-ok" : "flex items-center gap-2 text-sm font-semibold text-destructive"}>
              {checked.valid ? <BadgeCheck className="size-5" aria-hidden="true" /> : <Ban className="size-5" aria-hidden="true" />} {checked.message}
            </p>
            {checked.leave && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                {([
                  ["Leave Number", checked.leave.number], ["Patient", printableName(patient)], ["Type", LEAVE_TYPE_LABEL[checked.leave.type]],
                  ["From", fmtDate(checked.leave.startDate)], ["To", fmtDate(checked.leave.endDate)], ["Days", String(checked.leave.days)],
                  ["Doctor", checked.leave.doctor], ["Status", checked.leave.status],
                ] as const).map(([k, v]) => <React.Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></React.Fragment>)}
              </dl>
            )}
          </div>
        )}
      </Dialog>
    </Card>
  );
}

const TYPE_OPTIONS = (Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((v) => ({ value: v, label: LEAVE_TYPE_LABEL[v] }));
const EMPLOYER_OPTIONS = (Object.keys(EMPLOYER_LABEL) as EmployerType[]).map((v) => ({ value: v, label: EMPLOYER_LABEL[v] }));

function SickLeaveForm({ enc, patientLine, onClose }: { enc: Encounter; patientLine: string; onClose: () => void }) {
  const { user } = useSession();
  const today = nowLocal().slice(0, 10);
  const [type, setType] = React.useState<LeaveType>("sick");
  const [companionName, setCompanionName] = React.useState("");
  const [companionRelation, setCompanionRelation] = React.useState("");
  const [startDate, setStartDate] = React.useState(today);
  const [days, setDays] = React.useState("1");
  const [dxCode, setDxCode] = React.useState((enc.dx.find((d) => d.kind === "P") ?? enc.dx[0])?.code ?? "");
  const [employerType, setEmployerType] = React.useState<EmployerType>("private");
  const [notes, setNotes] = React.useState("");
  const [failed, setFailed] = React.useState<string[]>([]);
  const n = Number(days);
  const daysOk = days.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_DAYS;
  const companion = type === "companion";
  const v = useValidation({
    companionName: companion && !companionName.trim() && "Enter the companion's name.",
    companionRelation: companion && !companionRelation && "Choose the relation.",
    startDate: !startDate && "Enter the first day of the leave.",
    days: !daysOk && `Enter a whole number, 1 to ${MAX_DAYS}.`,
    dxCode: !dxCode && (enc.dx.length ? "Choose the diagnosis." : "Add a diagnosis to the visit first."),
  });
  const dirty = companion || !!companionName || startDate !== today || days !== "1" || employerType !== "private" || !!notes.trim();

  function save() {
    if (!v.submit()) return;
    const res = issueSickLeave({ visit: enc.visitNumber, type, companionName, companionRelation, startDate, days: n, dxCode, employerType, notes });
    if (!res.ok) { setFailed(res.errors); return; }
    pushToast({ tone: "ok", text: "Sick leave issued on Seha", detail: `${res.value.number}, ${fmtDate(res.value.startDate)} to ${fmtDate(res.value.endDate)}.` });
    onClose();
  }

  return (
    <EntrySheet
      onClose={onClose}
      title="New Sick Leave"
      subtitle={patientLine}
      dirty={dirty}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Issue On Seha</Button></>}
    >
      <div className="space-y-4">
        <RequiredNote />
        <ErrorSummary problems={failed.length ? failed : v.summary} />
        <FormField label="Leave Type" required group help={companion ? "For the person who stays with the patient." : undefined}>
          <Segmented value={type} options={TYPE_OPTIONS} onChange={(t) => { setType(t); setFailed([]); }} />
        </FormField>
        {companion && (
          <FormGrid>
            <FormField label="Companion Name" required error={v.error("companionName")}>
              <Input value={companionName} onChange={(e) => { setCompanionName(e.target.value); setFailed([]); }} onBlur={v.blur("companionName")} />
            </FormField>
            <FormField label="Relation To The Patient" required error={v.error("companionRelation")}>
              <Select value={companionRelation} onChange={(e) => { setCompanionRelation(e.target.value); setFailed([]); }} onBlur={v.blur("companionRelation")}>
                <option value="">Choose A Relation</option>
                {RELATIONS.map((r) => <option key={r}>{r}</option>)}
              </Select>
            </FormField>
          </FormGrid>
        )}
        <FormGrid>
          <FormField label="Start Date" required error={v.error("startDate")}>
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setFailed([]); }} onBlur={v.blur("startDate")} />
          </FormField>
          <FormField label="Number Of Days" required error={v.error("days")} help={daysOk && startDate ? `Last day: ${fmtDate(leaveEnd(startDate, n))}.` : undefined}>
            <Input type="number" inputMode="numeric" min={1} max={MAX_DAYS} step={1} value={days} onChange={(e) => { setDays(e.target.value); setFailed([]); }} onBlur={v.blur("days")} />
          </FormField>
        </FormGrid>
        <FormField label="Diagnosis (ICD-10-AM)" required error={v.error("dxCode")} help="Taken from the diagnoses of this visit.">
          <Select value={dxCode} onChange={(e) => { setDxCode(e.target.value); setFailed([]); }} onBlur={v.blur("dxCode")}>
            {enc.dx.length === 0 && <option value="">No Diagnosis On This Visit</option>}
            {enc.dx.map((d) => <option key={d.code} value={d.code}>{d.code} {d.text}</option>)}
          </Select>
        </FormField>
        <FormGrid>
          <FormField label="Issuing Doctor"><Input value={user.name} disabled /></FormField>
          <FormField label="Licence Number"><Input value={licenceOfCurrentUser()} disabled /></FormField>
        </FormGrid>
        <FormField label="Employer Type" required group>
          <Segmented value={employerType} options={EMPLOYER_OPTIONS} onChange={setEmployerType} />
        </FormField>
        <FormField label="Notes">
          <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="For example: light duties for one week after the leave" />
        </FormField>
      </div>
    </EntrySheet>
  );
}
