import * as React from "react";
import { ArrowLeft, Pencil, Plus, Search } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { fmtDate } from "@/components/claims/RcmUi";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { navigate } from "@/lib/router";
import { FIELD_KEYS, saveField, setFieldActive, useRules, type FieldMap } from "@/lib/rule-engine";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/** Claim Scrubbing Field Mapping: where each field a rule reads comes from. HIS rcm/field-mapping. */
export function FieldMappingPage() {
  const { fields, rules } = useRules();
  useSession();
  const allowed = can("billing");
  const [q, setQ] = React.useState("");
  const [scope, setScope] = React.useState<"" | "claim" | "line">("");
  const [editing, setEditing] = React.useState<{ field?: FieldMap } | null>(null);
  const term = q.trim().toLowerCase();
  const shown = fields.filter((f) => (!scope || f.scope === scope) && (!term || `${f.name} ${f.source} ${f.nphiesPath} ${f.key}`.toLowerCase().includes(term)));
  const usedBy = (f: FieldMap) => rules.filter((r) => r.conditions?.some((c) => c.field === f.key));
  const toggle = (f: FieldMap, v: boolean) => {
    const r = setFieldActive(f.id, v);
    if (!r.ok) { pushToast({ tone: "warn", text: r.problems[0] }); return; }
    if (r.stopped?.length) pushToast({ tone: "warn", text: `${f.name} switched off.`, detail: `Rules that use it were switched off: ${r.stopped.join(", ")}.` });
  };
  return (
    <div>
      <PageHeader
        title="Claim Scrubbing Field Mapping"
        subtitle="Where each claim field a rule reads comes from in the HIS, and which element of the NPHIES message it fills. A field that is switched off cannot be used by a rule."
        right={<div className="flex flex-wrap gap-2">
          <Button onClick={() => navigate("/rule-engine")}><ArrowLeft className="size-4" /> Rule Engine</Button>
          <Button variant="primary" disabled={!allowed || fields.length >= FIELD_KEYS.length} title={!allowed ? "Needs the billing permission" : fields.length >= FIELD_KEYS.length ? "Every claim value is mapped" : undefined} onClick={() => setEditing({})}><Plus className="size-4" /> Add Mapping</Button>
        </div>}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
          <label className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
            <span className="sr-only">Search fields</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Field, source or NPHIES path" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <Select aria-label="Filter by level" className="w-full sm:w-56" value={scope} onChange={(e) => setScope(e.target.value as "" | "claim" | "line")}>
            <option value="">Claim And Line Fields</option>
            <option value="claim">Claim Fields</option>
            <option value="line">Service Line Fields</option>
          </Select>
          <p className="ms-auto text-sm text-muted-foreground">{fields.filter((f) => f.active).length} of {fields.length} active</p>
        </div>
        <div className="hidden md:block">
          <Table>
            <thead><tr><Th>Field</Th><Th>Source</Th><Th>NPHIES Path</Th><Th>Level</Th><Th>Used By</Th><Th>Active</Th><Th>Last Updated</Th><Th className="relative w-12"><span className="sr-only">Edit</span></Th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><Td colSpan={8}><Empty>No field matches.</Empty></Td></tr>}
              {shown.map((f) => {
                const used = usedBy(f);
                return (
                  <tr key={f.id} className={cn("hover:bg-muted/40", !f.active && "text-muted-foreground")}>
                    <Td className="min-w-48"><div className="font-medium text-foreground">{f.name}</div><div className="font-mono text-xs text-muted-foreground">{f.id}</div></Td>
                    <Td className="font-mono text-xs">{f.source}</Td>
                    <Td className="font-mono text-xs">{f.nphiesPath || "None"}</Td>
                    <Td><Badge tone={f.scope === "line" ? "info" : "primary"}>{f.scope === "line" ? "Service Line" : "Claim"}</Badge></Td>
                    <Td className="text-sm">{used.length ? <span title={used.map((r) => r.id).join(", ")}>{used.length} rule{used.length === 1 ? "" : "s"}</span> : <span className="text-muted-foreground">None</span>}</Td>
                    <Td><Switch checked={f.active} disabled={!allowed} onChange={(v) => toggle(f, v)} label={`${f.active ? "Switch off" : "Switch on"} ${f.name}`} /></Td>
                    <Td className="whitespace-nowrap text-sm">{fmtDate(f.updatedAt)}</Td>
                    <Td><Button size="sm" variant="ghost" disabled={!allowed} aria-label={`Edit ${f.name}`} title="Edit" onClick={() => setEditing({ field: f })}><Pencil className="size-4" /></Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <ul className="flex flex-col gap-2.5 p-3 md:hidden" aria-label="Field mappings">
          {shown.map((f) => (
            <li key={f.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="font-medium">{f.name}</p><p className="font-mono text-xs text-muted-foreground">{f.source}</p></div>
                <Switch checked={f.active} disabled={!allowed} onChange={(v) => toggle(f, v)} label={`${f.active ? "Switch off" : "Switch on"} ${f.name}`} />
              </div>
              <p className="mt-1.5 break-all font-mono text-xs">{f.nphiesPath}</p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Badge tone={f.scope === "line" ? "info" : "primary"}>{f.scope === "line" ? "Service Line" : "Claim"}</Badge>
                <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => setEditing({ field: f })}><Pencil className="size-4" /> Edit</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <FieldDialog open={!!editing} field={editing?.field} taken={fields.map((f) => f.key)} onClose={() => setEditing(null)} />
    </div>
  );
}

function FieldDialog({ open, field, taken, onClose }: { open: boolean; field?: FieldMap; taken: string[]; onClose: () => void }) {
  const free = FIELD_KEYS.filter((k) => k.key === field?.key || !taken.includes(k.key));
  const blank = () => ({ key: free[0]?.key ?? "", name: free[0]?.name ?? "", source: "", nphiesPath: "", active: true });
  const [form, setForm] = React.useState(blank);
  const [errors, setErrors] = React.useState<string[]>([]);
  React.useEffect(() => { if (open) { setForm(field ? { key: field.key, name: field.name, source: field.source, nphiesPath: field.nphiesPath, active: field.active } : blank()); setErrors([]); } }, [open, field]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = FIELD_KEYS.find((k) => k.key === form.key);
  const save = () => {
    const r = saveField({ ...form, id: field?.id, type: meta?.type ?? "text", scope: meta?.scope ?? "claim" });
    if (!r.ok) { setErrors(r.problems); return; }
    pushToast({ tone: "ok", text: field ? `${form.name} saved.` : `${form.name} added.` });
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title={field ? `Edit ${field.name}` : "Add Mapping"} subtitle="The claim value is what the rule engine reads; source and NPHIES path say where it comes from and where it goes."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>{field ? "Save Mapping" : "Add Mapping"}</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Claim Value" required hint={meta ? `${meta.scope === "line" ? "Read once per service line" : "Read once per claim"}, ${meta.type === "number" ? "a number" : meta.type === "list" ? "one of a list" : "text"}.` : undefined}>
          <Select value={form.key} disabled={!!field} onChange={(e) => { const k = FIELD_KEYS.find((x) => x.key === e.target.value); setForm((f) => ({ ...f, key: e.target.value, name: f.name || k?.name || "" })); }}>
            {free.map((k) => <option key={k.key} value={k.key}>{k.name}</option>)}
          </Select>
        </Field>
        <Field label="Field Name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Source" required hint="HIS table and column, for example ClaimDiagnosis.Icd10Code."><Input className="font-mono" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} /></Field>
        <Field label="NPHIES Path" hint="The element of the NPHIES message, for example Claim.diagnosis.type."><Input className="font-mono" value={form.nphiesPath} onChange={(e) => setForm((f) => ({ ...f, nphiesPath: e.target.value }))} /></Field>
        {errors.length > 0 && <ul role="alert" className="list-disc ps-5 text-sm text-destructive">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      </div>
    </Dialog>
  );
}
