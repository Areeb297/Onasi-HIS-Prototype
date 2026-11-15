import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Badge, Button, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ComplicationsPicker, QuantityFields, SitePicker, qty } from "@/components/emr/EmarFields";
import {
  DOSE_WINDOW_MIN, OUTCOME_LABEL, REASONS_FOR, TIMING_REASONS, recordDoses, type AdminInput, type BatchProblem, type DoseOutcome, type DoseSlot,
} from "@/lib/emar";
import type { Encounter, Patient } from "@/lib/model";
import { patientName, toLocalInput } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { fmtDayHeading, fmtTime } from "@/lib/format";

/**
 * Record every medicine due at one hour in one dialog, as on a ward round.
 * Each medicine still needs its own outcome; nothing is saved as given by default. The high-alert second-nurse rule
 * applies to each high-alert medicine. If any medicine fails the checks, nothing in the round is saved.
 */

const hm = (t: number) => fmtTime(t);
const dayLabel = (t: number) => fmtDayHeading(t);

interface Row {
  outcome: DoseOutcome | null;
  checked: boolean;
  given: string;
  wasted: string;
  site: string;
  complications: string[];
  reason: string;
  timingReason: string;
  note: string;
  witnessName: string;
  witnessNo: string;
}

const blank = (d: DoseSlot): Row => ({
  outcome: null, checked: false, given: String(d.order.doseQty), wasted: "0", site: "", complications: [], reason: "", timingReason: "", note: "",
  witnessName: "", witnessNo: "",
});

export function EmarRoundDialog({ enc, patient, hour, doses, onClose }: { enc: Encounter; patient: Patient; hour: number; doses: DoseSlot[]; onClose: () => void }) {
  const [atText, setAtText] = React.useState(() => toLocalInput(new Date()));
  const [patientOk, setPatientOk] = React.useState(false);
  const [rows, setRows] = React.useState<Record<string, Row>>(() => Object.fromEntries(doses.map((d) => [d.id, blank(d)])));
  const [problems, setProblems] = React.useState<BatchProblem[]>([]);
  const at = new Date(atText).getTime();
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const chosen = doses.filter((d) => rows[d.id]?.outcome);

  function save() {
    if (chosen.some((d) => rows[d.id].outcome === "given") && Number.isNaN(at)) {
      setProblems([{ itemId: "", drugText: "", errors: ["Enter the time the doses were given."] }]);
      return;
    }
    const inputs: AdminInput[] = chosen.map((d) => {
      const r = rows[d.id];
      const given = r.outcome === "given";
      const off = d.dueAt !== null && !Number.isNaN(at) ? Math.abs(at - d.dueAt) / 60_000 : 0;
      return {
        visit: enc.visitNumber, itemId: d.order.itemId, slot: d.dueAt ?? undefined, outcome: r.outcome as DoseOutcome,
        at: given ? at : undefined,
        rights: given ? { patient: patientOk, drug: r.checked, dose: r.checked, route: r.checked, time: r.checked } : undefined,
        reason: given ? undefined : r.reason, note: r.note,
        timingReason: given && off > DOSE_WINDOW_MIN ? r.timingReason : undefined,
        witness: given && d.order.highAlert ? { name: r.witnessName, staffNo: r.witnessNo } : undefined,
        site: given && r.site ? r.site : undefined,
        qtyGiven: given ? qty(r.given) : undefined,
        qtyWasted: given ? qty(r.wasted) : undefined,
        complications: r.complications.length ? r.complications : undefined,
      };
    });
    const res = recordDoses(inputs);
    if (!res.ok) { setProblems(res.errors); return; }
    const givenN = res.records.filter((r) => r.outcome === "given").length;
    pushToast({ tone: "ok", text: `${res.records.length} dose${res.records.length === 1 ? "" : "s"} recorded for ${hm(hour)}`, detail: `${givenN} given, ${res.records.length - givenN} not given.` });
    onClose();
  }

  const problemFor = (itemId: string) => problems.find((p) => p.itemId === itemId);
  const general = problems.filter((p) => !p.itemId);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        <div className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="text-base">Record All Doses Due At {hm(hour)}</DialogTitle>
          <DialogDescription className="mt-1 text-[0.8125rem]">
            {dayLabel(hour)}. {doses.length} medicine{doses.length === 1 ? "" : "s"} for {patientName(patient)}. Choose what happened with each one. A medicine left without a choice is not recorded.
          </DialogDescription>
        </div>

        <div className="space-y-4 px-5 py-4">
          <RequiredNote />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Time Given" required hint="Used for every medicine marked as given.">
              <Input type="datetime-local" value={atText} max={toLocalInput(new Date())} onChange={(e) => setAtText(e.target.value)} />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 self-end rounded-md border border-border bg-card px-3 py-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={patientOk} onChange={(e) => setPatientOk(e.target.checked)} />
              <span><span className="font-medium">Right patient</span><span className="block text-xs text-muted-foreground">{patientName(patient)}, Health ID {patient.healthId}</span></span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.outcome ? v : { ...v, outcome: "given" as const }])))}>
              Set The Rest To Given
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRows(Object.fromEntries(doses.map((d) => [d.id, blank(d)])))}>Clear Choices</Button>
          </div>

          <ol className="space-y-3">
            {doses.map((d) => {
              const r = rows[d.id];
              const o = d.order;
              const prob = problemFor(o.itemId);
              const off = d.dueAt !== null && !Number.isNaN(at) ? Math.round((at - d.dueAt) / 60_000) : 0;
              const otherNote = r.reason === "Other" || r.timingReason === "Other" || r.complications.includes("Other");
              return (
                <li key={d.id} className={cn("rounded-lg border bg-card p-3", prob ? "border-destructive/60" : "border-border")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{o.drugText}</div>
                      <div className="text-xs text-muted-foreground">{o.doseText} · {o.routeText} · due {d.dueAt !== null ? hm(d.dueAt) : "as needed"}{d.state === "overdue" ? ", overdue" : ""}</div>
                      {o.highAlert && <Badge tone="danger" className="mt-1">High Alert: {o.highAlert}</Badge>}
                    </div>
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Outcome for ${o.drug.generic}`}>
                      {(Object.keys(OUTCOME_LABEL) as DoseOutcome[]).map((k) => (
                        <Button key={k} size="sm" aria-pressed={r.outcome === k} variant={r.outcome === k ? "primary" : "secondary"} onClick={() => set(d.id, { outcome: r.outcome === k ? null : k, reason: "" })}>
                          {OUTCOME_LABEL[k]}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {r.outcome === "given" && (
                    <div className="mt-3 space-y-3">
                      <label className="flex cursor-pointer items-start gap-2 text-sm">
                        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={r.checked} onChange={(e) => set(d.id, { checked: e.target.checked })} />
                        <span>Right drug, dose, route and time checked<span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span></span>
                      </label>
                      <QuantityFields order={o} given={r.given} wasted={r.wasted} onChange={(g, w) => set(d.id, { given: g, wasted: w })} />
                      <SitePicker idPrefix={`round-${d.id}`} value={r.site} route={o.route} onChange={(v) => set(d.id, { site: v })} />
                      {Math.abs(off) > DOSE_WINDOW_MIN && (
                        <Field label={`Reason For The ${off < 0 ? "Early" : "Late"} Dose`} required hint={`${Math.abs(off)} minutes from the dose time.`}>
                          <Select value={r.timingReason} onChange={(e) => set(d.id, { timingReason: e.target.value })}>
                            <option value="">Choose a reason</option>
                            {TIMING_REASONS.map((x) => <option key={x}>{x}</option>)}
                          </Select>
                        </Field>
                      )}
                      {o.highAlert && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Second Nurse Name" required hint="The second nurse types their own name.">
                            <Input value={r.witnessName} onChange={(e) => set(d.id, { witnessName: e.target.value })} autoComplete="off" />
                          </Field>
                          <Field label="Second Nurse Staff Number" required>
                            <Input value={r.witnessNo} onChange={(e) => set(d.id, { witnessNo: e.target.value })} autoComplete="off" />
                          </Field>
                        </div>
                      )}
                    </div>
                  )}
                  {r.outcome && r.outcome !== "given" && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Field label={`Reason The Dose Was ${OUTCOME_LABEL[r.outcome]}`} required>
                        <Select value={r.reason} onChange={(e) => set(d.id, { reason: e.target.value })}>
                          <option value="">Choose a reason</option>
                          {REASONS_FOR[r.outcome].map((x) => <option key={x}>{x}</option>)}
                        </Select>
                      </Field>
                    </div>
                  )}
                  {r.outcome && (
                    <div className="mt-3 space-y-3">
                      <ComplicationsPicker value={r.complications} onChange={(v) => set(d.id, { complications: v })} />
                      <Field label="Note" required={otherNote} hint={otherNote ? "You chose Other. Write the details here." : undefined}>
                        <Textarea value={r.note} onChange={(e) => set(d.id, { note: e.target.value })} rows={2} className="bg-card" />
                      </Field>
                    </div>
                  )}
                  {prob && (
                    <ul role="alert" className="mt-3 space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive">
                      {prob.errors.map((e) => <li key={e} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{e}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          {general.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[0.8125rem] text-destructive">
              {general.flatMap((p) => p.errors).map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {problems.length > 0 && <p className="text-xs text-muted-foreground">Nothing was saved. Fix the medicines marked in red and save again.</p>}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-5 py-3">
          <span className="mr-auto text-xs text-muted-foreground">{chosen.length} of {doses.length} chosen</span>
          <Button onClick={onClose}>Close Without Saving</Button>
          <Button variant="primary" disabled={chosen.length === 0} onClick={save}>Save {chosen.length || ""} Dose{chosen.length === 1 ? "" : "s"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
