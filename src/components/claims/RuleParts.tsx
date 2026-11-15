import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { IconAlertTriangle, IconCircleCheck, IconHandStop, IconOctagon } from "@tabler/icons-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { claimFor, claimFacts, CLAIM_TYPE_LABEL, insuredVisits, reviewClaim, reviewInputOf, type ClaimType } from "@/lib/claims";
import {
  BUILT_IN_LABEL, conditionText, FIELD_KEYS, NO_VALUE, OPERATOR_LABEL, saveRule, SEVERITY_NAME, TRIGGER_LABEL,
  type Condition, type FieldMap, type Operator, type Rule, type RuleInput, type RuleSource, type RuleTrigger, type Severity,
} from "@/lib/rule-engine";
import { patientName } from "@/lib/store";
import { pushToast } from "@/lib/toast";

export const SEVERITY_TONE: Record<Severity, "danger" | "warn" | "info"> = { hard: "danger", soft: "warn", warning: "info" };
const SEVERITY_CLASS: Record<Severity, string> = { hard: "bg-destructive/12 text-destructive", soft: "bg-warn/16 text-warn", warning: "bg-move/12 text-move" };
const SEVERITY_ICON: Record<Severity, typeof IconOctagon> = { hard: IconOctagon, soft: IconHandStop, warning: IconAlertTriangle };

export function SeverityChip({ severity }: { severity: Severity }) {
  const Icon = SEVERITY_ICON[severity];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap", SEVERITY_CLASS[severity])}>
      <Icon className="size-3" stroke={2} aria-hidden="true" /> {SEVERITY_NAME[severity]}
    </span>
  );
}

/** What the rule checks, in words. */
export function ruleCondition(r: Rule, fields: FieldMap[]): string {
  if (r.check) return `Built-in check: ${BUILT_IN_LABEL[r.check].toLowerCase()}`;
  if (!r.conditions?.length) return "No condition yet";
  return r.conditions.map((c) => conditionText(c, fields)).join(", and ");
}

const CLAIM_TYPES = Object.keys(CLAIM_TYPE_LABEL) as ClaimType[];

/** Add or edit a rule. A built-in rule shows its check instead of the condition builder. */
export function RuleDialog({ open, onClose, rule, source, fields }: { open: boolean; onClose: () => void; rule?: Rule; source: RuleSource; fields: FieldMap[] }) {
  const blank = (): RuleInput => ({
    source, name: "", description: "", category: source === "nphies" ? "NPHIES" : "Claim", severity: "warning", trigger: "both", claimTypes: [], active: true,
    conditions: [{ field: "claim.net", op: "greater", value: "" }], message: "", fix: "", nphiesCode: "", relatedElement: "",
  });
  const [form, setForm] = React.useState<RuleInput>(blank);
  const [errors, setErrors] = React.useState<string[]>([]);
  React.useEffect(() => { if (open) { setForm(rule ? { ...rule, conditions: rule.conditions?.map((c) => ({ ...c })) } : blank()); setErrors([]); } }, [open, rule]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof RuleInput>(k: K, v: RuleInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const active = fields.filter((f) => f.active);
  const setCond = (i: number, patch: Partial<Condition>) => set("conditions", (form.conditions ?? []).map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = () => {
    const r = saveRule(form);
    if (!r.ok) { setErrors(r.problems); return; }
    pushToast({ tone: "ok", text: rule ? `Rule ${rule.id} saved.` : `Rule ${r.id} added.` });
    onClose();
  };
  const builtIn = !!rule?.check;
  return (
    <Dialog open={open} onClose={onClose} wide title={rule ? `Edit Rule ${rule.id}` : source === "nphies" ? "Add NPHIES Rule" : "Add Rule"}
      subtitle={builtIn ? "A built-in check of the claim review. You can change its severity, when it runs and its wording." : "The rule fires when every condition holds."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{rule ? "Save Rule" : "Add Rule"}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {!rule && source === "nphies" && <Field label="Rule ID" required hint="As in the NPHIES workbook, for example BV-00501."><Input value={form.id ?? ""} onChange={(e) => set("id", e.target.value)} /></Field>}
          <Field label="Rule Name" required className={!rule && source === "nphies" ? undefined : "sm:col-span-2"}><Input value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Severity" required>
            <Select value={form.severity} onChange={(e) => set("severity", e.target.value as Severity)}>
              {(Object.keys(SEVERITY_NAME) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_NAME[s]}</option>)}
            </Select>
          </Field>
          <Field label="Trigger" required hint="When the review runs this rule.">
            <Select value={form.trigger} onChange={(e) => set("trigger", e.target.value as RuleTrigger)}>
              {(Object.keys(TRIGGER_LABEL) as RuleTrigger[]).map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
            </Select>
          </Field>
          <Field label="Category"><Input value={form.category} onChange={(e) => set("category", e.target.value)} /></Field>
          <Field label="NPHIES Code"><Input value={form.nphiesCode ?? ""} placeholder="BV-00000" onChange={(e) => set("nphiesCode", e.target.value)} /></Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Claim Types</legend>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Claim types">
            <button type="button" aria-pressed={!form.claimTypes.length} onClick={() => set("claimTypes", [])}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !form.claimTypes.length ? "border-[#035d53] bg-[#035d53] text-white" : "border-border bg-card text-muted-foreground hover:bg-muted")}>
              All Types
            </button>
            {CLAIM_TYPES.map((t) => {
              const on = form.claimTypes.includes(t);
              return (
                <button key={t} type="button" aria-pressed={on} onClick={() => set("claimTypes", on ? form.claimTypes.filter((x) => x !== t) : [...form.claimTypes, t])}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-[#035d53] bg-[#035d53] text-white" : "border-border bg-card text-muted-foreground hover:bg-muted")}>
                  {CLAIM_TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </fieldset>
        {builtIn ? (
          <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm"><span className="font-medium">Built-in check:</span> {BUILT_IN_LABEL[rule!.check!]}. The review words each finding itself.</p>
        ) : (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Conditions <span className="font-normal text-muted-foreground">(all must hold)</span></legend>
            <ul className="flex flex-col gap-2">
              {(form.conditions ?? []).map((c, i) => (
                <li key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-2.5 sm:grid-cols-12 sm:items-center">
                  <Select aria-label={`Field of condition ${i + 1}`} className="sm:col-span-5" value={c.field} onChange={(e) => setCond(i, { field: e.target.value })}>
                    {active.map((f) => <option key={f.key} value={f.key}>{f.name}{f.scope === "line" ? " (each line)" : ""}</option>)}
                  </Select>
                  <Select aria-label={`Operator of condition ${i + 1}`} className="sm:col-span-3" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Operator })}>
                    {(Object.keys(OPERATOR_LABEL) as Operator[]).map((o) => <option key={o} value={o}>{OPERATOR_LABEL[o]}</option>)}
                  </Select>
                  <Input aria-label={`Value of condition ${i + 1}`} className="sm:col-span-3" value={c.value} disabled={NO_VALUE.includes(c.op)} placeholder={NO_VALUE.includes(c.op) ? "No value needed" : FIELD_KEYS.find((k) => k.key === c.field)?.type === "number" ? "A number" : "Value"} onChange={(e) => setCond(i, { value: e.target.value })} />
                  <Button size="sm" variant="ghost" className="justify-self-end sm:col-span-1" aria-label={`Remove condition ${i + 1}`} disabled={(form.conditions ?? []).length <= 1} onClick={() => set("conditions", (form.conditions ?? []).filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                </li>
              ))}
            </ul>
            <Button size="sm" className="mt-2" onClick={() => set("conditions", [...(form.conditions ?? []), { field: active[0]?.key ?? "claim.net", op: "equals", value: "" }])}><Plus className="size-4" /> Add Condition</Button>
          </fieldset>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Message" required hint="What the review shows when the rule fires."><Input value={form.message} onChange={(e) => set("message", e.target.value)} /></Field>
          <Field label="How To Fix It"><Input value={form.fix} onChange={(e) => set("fix", e.target.value)} /></Field>
        </div>
        {errors.length > 0 && <ul role="alert" className="list-disc ps-5 text-sm text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
    </Dialog>
  );
}

/** Runs one rule against one claim, for prior authorization and for the claim, and shows the field values it read. */
export function TestRuleDialog({ rule, fields, onClose }: { rule: Rule | null; fields: FieldMap[]; onClose: () => void }) {
  const visits = React.useMemo(() => (rule ? insuredVisits().sort((a, b) => (b.enc.admitAt ?? "").localeCompare(a.enc.admitAt ?? "")) : []), [rule]);
  const [visit, setVisit] = React.useState("");
  React.useEffect(() => { if (rule) setVisit(visits[0]?.enc.visitNumber ?? ""); }, [rule, visits]);
  const m = rule && visit ? claimFor(visit) : null;
  const one = rule ? { rules: [{ ...rule, active: true }], fields } : null;
  const results = m && one ? (["priorauth", "claim"] as const).map((use) => ({ use, findings: reviewClaim(reviewInputOf(m), use, one) })) : [];
  const facts = m ? claimFacts(m) : null;
  return (
    <Dialog open={!!rule} onClose={onClose} wide title={rule ? `Test Rule ${rule.id}` : "Test Rule"} subtitle={rule ? `${rule.name}. The rule runs on the chosen claim even if it is switched off.` : undefined} footer={<Button onClick={onClose}>Close</Button>}>
      <Field label="Claim">
        <Select value={visit} onChange={(e) => setVisit(e.target.value)}>
          {visits.map((v) => <option key={v.enc.visitNumber} value={v.enc.visitNumber}>{patientName(v.patient)}, visit {v.enc.visitNumber}, {v.payer}</option>)}
        </Select>
      </Field>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {results.map(({ use, findings }) => (
          <div key={use} className={cn("rounded-xl border px-3 py-2.5", findings.length ? "border-warn/40 bg-warn/[0.05]" : "border-ok/30 bg-ok/[0.06]")}>
            <p className="text-xs font-medium text-muted-foreground">{use === "priorauth" ? "Prior Authorization Review" : "Claim Review"}</p>
            {rule && rule.trigger !== "both" && rule.trigger !== use ? (
              <p className="mt-1 text-sm text-muted-foreground">Does not run here ({TRIGGER_LABEL[rule.trigger]}).</p>
            ) : findings.length ? (
              <ul className="mt-1 flex flex-col gap-1.5">{findings.map((f) => <li key={f.id} className="text-sm"><SeverityChip severity={f.severity} /> <span className="ms-1">{f.text}</span></li>)}</ul>
            ) : (
              <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-ok"><IconCircleCheck className="size-4" stroke={1.75} aria-hidden="true" /> Passes</p>
            )}
          </div>
        ))}
      </div>
      {rule?.conditions && facts && (
        <div className="mt-4">
          <h3 className="mb-1.5 text-sm font-semibold">Values The Rule Read</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {rule.conditions.map((c, i) => {
              const f = fields.find((x) => x.key === c.field);
              const values = f?.scope === "line" ? facts.lines.map((l) => `Line ${l.seq}: ${l.values[c.field] ?? "empty"}`).join("; ") : String(facts.claim[c.field] ?? "") || "empty";
              return <li key={i} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/60 px-3 py-1.5"><span>{conditionText(c, fields)}</span><span className="font-mono text-xs text-muted-foreground">{values}</span></li>;
            })}
          </ul>
        </div>
      )}
    </Dialog>
  );
}
