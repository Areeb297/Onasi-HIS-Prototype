import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { can } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";
import type { Encounter } from "@/lib/model";
import { addFormRecord, deleteFormRecord, getFormRecords, updateFormRecord, useRecords } from "@/lib/records";
import type { FieldDef, FieldOption, FormDef, FormRecord } from "@/lib/schema";

type Values = FormRecord["values"];

const optValue = (o: string | FieldOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: string | FieldOption) => (typeof o === "string" ? o : o.label);
const optScore = (o: string | FieldOption) => (typeof o === "string" ? 0 : (o.score ?? 0));

/** Sum of the scores of every scale, radio and select field that has scored options. */
export function scoreOf(form: FormDef, v: Values): number {
  let total = 0;
  for (const f of form.fields) {
    const val = v[f.key];
    if (f.type === "scale" && typeof val === "number") total += val;
    if ((f.type === "radio" || f.type === "select") && typeof val === "string") {
      const o = f.options?.find((x) => optValue(x) === val);
      if (o) total += optScore(o);
    }
  }
  return total;
}

function hasScores(form: FormDef): boolean {
  return form.fields.some((f) => f.type === "scale" || f.options?.some((o) => typeof o !== "string" && o.score !== undefined));
}

function display(f: FieldDef, v: Values): string {
  const val = v[f.key];
  if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) return "None";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (f.type === "datetime" && typeof val === "string") return val.replace("T", " ");
  return String(val) + (f.unit ? ` ${f.unit}` : "");
}

/* ---------- field input ---------- */

function FieldInput({ f, v, onChange }: { f: FieldDef; v: Values; onChange: (val: Values[string]) => void }) {
  const val = v[f.key];
  switch (f.type) {
    case "textarea":
      return <Textarea value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={f.placeholder} aria-label={f.label} />;
    case "number":
      return (
        <div className="flex items-center gap-2">
          <Input type="number" min={f.min} max={f.max} value={(val as number | string) ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} aria-label={f.label} />
          {f.unit && <span className="text-xs text-muted-foreground">{f.unit}</span>}
        </div>
      );
    case "date":
    case "datetime":
    case "time":
      return <Input type={f.type === "datetime" ? "datetime-local" : f.type} value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={f.label} />;
    case "select":
      return (
        <Select value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={f.label}>
          <option value="">Select</option>
          {f.options?.map((o) => <option key={optValue(o)} value={optValue(o)}>{optLabel(o)}</option>)}
        </Select>
      );
    case "radio":
      return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={f.label}>
          {f.options?.map((o) => {
            const on = val === optValue(o);
            return (
              <button key={optValue(o)} type="button" role="radio" aria-checked={on} onClick={() => onChange(optValue(o))}
                className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", on ? "border-admit bg-admit/12 text-admit" : "border-border hover:bg-muted")}>
                {optLabel(o)}
              </button>
            );
          })}
        </div>
      );
    case "multiselect":
      return (
        <div className="flex flex-wrap gap-2">
          {f.options?.map((o) => {
            const arr = Array.isArray(val) ? val : [];
            const on = arr.includes(optValue(o));
            return (
              <button key={optValue(o)} type="button" aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== optValue(o)) : [...arr, optValue(o)])}
                className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors", on ? "border-admit bg-admit/12 text-admit" : "border-border hover:bg-muted")}>
                {optLabel(o)}
              </button>
            );
          })}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!val} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--primary)]" />
          {f.placeholder ?? "Yes"}
        </label>
      );
    case "scale": {
      const max = f.max ?? 10;
      return (
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={f.label}>
          {Array.from({ length: max + 1 }, (_, i) => {
            const on = val === i;
            const tone = i / max >= 0.7 ? "border-cancel bg-cancel/15 text-cancel" : i / max >= 0.4 ? "border-merge bg-merge/15 text-merge" : "border-admit bg-admit/15 text-admit";
            return (
              <button key={i} type="button" role="radio" aria-checked={on} onClick={() => onChange(i)}
                className={cn("size-9 rounded-md border text-sm font-medium transition-colors", on ? tone : "border-border hover:bg-muted")}>
                {i}
              </button>
            );
          })}
        </div>
      );
    }
    default:
      return <Input value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} aria-label={f.label} />;
  }
}

/* ---------- the form in a side sheet ---------- */

function FormSheet({
  form, open, initial, onClose, onSave,
}: { form: FormDef; open: boolean; initial: Values; onClose: () => void; onSave: (v: Values) => void }) {
  const dev = useDevMode();
  const [v, setV] = React.useState<Values>(initial);
  React.useEffect(() => { if (open) setV(initial); }, [open, initial]);

  const missing = form.fields.filter((f) => f.required && (v[f.key] === undefined || v[f.key] === "" || (Array.isArray(v[f.key]) && (v[f.key] as string[]).length === 0)));
  const sections: { name: string; fields: FieldDef[] }[] = [];
  for (const f of form.fields) {
    const name = f.section ?? "";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else sections.push({ name, fields: [f] });
  }
  const score = scoreOf(form, v);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{form.title}</SheetTitle>
          <SheetDescription>{form.description ?? "Fill in the form and save it to the chart."}{dev && form.nphies ? ` NPHIES: ${form.nphies}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {sections.map((s, i) => (
            <section key={i}>
              {s.name && <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{s.name}</h3>}
              <div className="grid gap-3 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <Field key={f.key} label={f.required ? `${f.label} (required)` : f.label} hint={f.hint} hl7={dev ? f.hl7 : undefined}
                    className={cn((f.full || f.type === "textarea" || f.type === "scale" || f.type === "radio" || f.type === "multiselect") && "sm:col-span-2")}>
                    <FieldInput f={f} v={v} onChange={(val) => setV((x) => ({ ...x, [f.key]: val }))} />
                  </Field>
                ))}
              </div>
            </section>
          ))}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <span className="text-sm text-muted-foreground">
            {hasScores(form) ? `${form.scoreLabel ?? "Total score"}: ` : ""}
            {hasScores(form) && <strong className="text-foreground">{score}</strong>}
          </span>
          <span className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={missing.length > 0} onClick={() => onSave(v)} title={missing.length ? `Missing: ${missing.map((m) => m.label).join(", ")}` : undefined}>
              Save
            </Button>
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Generic EMR page: a table of records for one visit, with Add New. Built from a FormDef. */
export function EmrFormPage({ form, enc }: { form: FormDef; enc: Encounter }) {
  useRecords();
  const dev = useDevMode();
  const records = getFormRecords(enc.visitNumber, form.id);
  const [editing, setEditing] = React.useState<{ id: string | null; initial: Values } | null>(null);
  const canWrite = can("emr.write");
  const keys = form.summaryKeys ?? form.fields.slice(0, 4).map((f) => f.key);
  const cols = keys.map((k) => form.fields.find((f) => f.key === k)).filter(Boolean) as FieldDef[];
  const scored = hasScores(form);

  return (
    <Card>
      <CardHeader
        title={form.title}
        subtitle={dev && form.nphies ? `NPHIES: ${form.nphies}` : form.description}
        right={<Button variant="primary" disabled={!canWrite} onClick={() => setEditing({ id: null, initial: {} })} title={canWrite ? undefined : "Your role cannot add records"}><Plus className="size-4" />Add New</Button>}
      />
      <Table>
        <thead>
          <tr>
            <Th>Date and Time</Th>
            {cols.map((c) => <Th key={c.key}>{c.label}</Th>)}
            {scored && <Th>{form.scoreLabel ?? "Score"}</Th>}
            <Th>By</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && <tr><Td colSpan={cols.length + 4}><Empty>No records yet. Use Add New.</Empty></Td></tr>}
          {[...records].reverse().map((r) => (
            <tr key={r.id} className="hover:bg-muted/40">
              <Td className="whitespace-nowrap font-mono text-xs text-muted-foreground">{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Td>
              {cols.map((c) => <Td key={c.key} className="max-w-[260px] truncate">{display(c, r.values)}</Td>)}
              {scored && <Td><Badge tone="update">{scoreOf(form, r.values)}</Badge></Td>}
              <Td className="text-xs text-muted-foreground">{r.author}</Td>
              <Td className="text-right">
                <span className="inline-flex gap-1">
                  <button aria-label="Edit" title="Edit" disabled={!canWrite} onClick={() => setEditing({ id: r.id, initial: r.values })} className="rounded p-1 text-move hover:bg-move/10 disabled:opacity-40"><Pencil className="size-4" /></button>
                  <button aria-label="Delete" title="Delete" disabled={!canWrite} onClick={() => deleteFormRecord(enc.visitNumber, form.id, r.id, enc.patientId)} className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="size-4" /></button>
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <FormSheet
        form={form}
        open={!!editing}
        initial={editing?.initial ?? {}}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (editing?.id) updateFormRecord(enc.visitNumber, form.id, editing.id, v, enc.patientId);
          else addFormRecord(enc.visitNumber, form.id, v, enc.patientId);
          setEditing(null);
        }}
      />
    </Card>
  );
}
