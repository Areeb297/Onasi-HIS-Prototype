import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { can, useSession } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";
import { EMR_FORM_BY_ID } from "@/lib/emr-forms";
import { ADULT_FROM_YEARS, ageYears, allergyText, computeValues, fitsAge, fluidDays, hasScores, prefillValues, scoreOf, scoreSummary, signedMl, SHIFT_NAMES } from "@/lib/flowsheet";
import type { Encounter } from "@/lib/model";
import { addFormRecord, deleteFormRecord, getFormRecords, updateFormRecord, useRecords } from "@/lib/records";
import { navigate } from "@/lib/router";
import type { FieldDef, FieldOption, FormDef, FormRecord } from "@/lib/schema";
import { useHis } from "@/lib/store";

type Values = FormRecord["values"];

const optValue = (o: string | FieldOption) => (typeof o === "string" ? o : o.value);
const optLabel = (o: string | FieldOption) => (typeof o === "string" ? o : o.label);

// The scoring rules live in src/lib/flowsheet.ts. Re-exported here for the callers that import it from this file.
export { scoreOf };

/** What the system fills in by itself: the signed-in user and the allergies in the chart. */
interface AutoContext {
  user: string;
  allergies: string;
}

/** Put the system values into a record: a new record gets the signed-in user, the allergies always follow the chart. */
function withAuto(form: FormDef, v: Values, ctx: AutoContext): Values {
  const out = { ...v };
  for (const f of form.fields) {
    if (f.auto === "user" && !out[f.key]) out[f.key] = ctx.user;
    if (f.auto === "allergies") out[f.key] = ctx.allergies;
  }
  return computeValues(form, out);
}

/** The total with its risk band, or a note that items are still missing. */
function ScoreBadge({ form, v }: { form: FormDef; v: Values }) {
  const s = scoreSummary(form, v);
  if (!s.complete) return <Badge tone="neutral">{s.answered === 0 ? "Not scored" : `Incomplete, ${s.answered} of ${s.items} items`}</Badge>;
  return <Badge tone={s.band?.tone ?? "update"}>{s.total}{s.band ? `, ${s.band.label}` : ""}</Badge>;
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

/** Same look as Input: clear outline, white fill, 2px blue focus ring. */
const textareaClass =
  "min-h-20 rounded-lg border-input bg-card px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/80 " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring md:text-sm dark:bg-background";
/** Choice chips for radio and multi-select fields. The chosen one is bold and outlined, not only tinted. */
const chip = (on: boolean) =>
  cn(
    "min-h-9 rounded-lg border px-3 py-1.5 text-sm transition-colors",
    on ? "border-admit bg-admit/14 font-semibold text-admit ring-1 ring-admit" : "border-input bg-card text-foreground hover:bg-muted dark:bg-background",
  );

function FieldInput({ f, v, onChange }: { f: FieldDef; v: Values; onChange: (val: Values[string]) => void }) {
  const val = v[f.key];
  if (f.compute) {
    return (
      <div className="flex items-center gap-2">
        <Input readOnly disabled value={val === undefined || val === "" ? "" : String(val)} placeholder="Enter the amounts above" aria-label={`${f.label}, worked out for you`} className="font-semibold tabular-nums" />
        {f.unit && <span className="shrink-0 text-sm text-muted-foreground">{f.unit}</span>}
      </div>
    );
  }
  if (f.auto) return <Input readOnly disabled value={(val as string) ?? ""} aria-label={f.label} />;
  switch (f.type) {
    case "textarea":
      return <Textarea value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={f.placeholder} aria-label={f.label} className={textareaClass} />;
    case "number":
      return (
        <div className="flex items-center gap-2">
          <Input type="number" min={f.min} max={f.max} value={(val as number | string) ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} aria-label={f.label} />
          {f.unit && <span className="shrink-0 text-sm text-muted-foreground">{f.unit}</span>}
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
              <button key={optValue(o)} type="button" role="radio" aria-checked={on} onClick={() => onChange(optValue(o))} className={chip(on)}>
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
              <button key={optValue(o)} type="button" aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== optValue(o)) : [...arr, optValue(o)])} className={chip(on)}>
                {optLabel(o)}
              </button>
            );
          })}
        </div>
      );
    case "checkbox":
      return (
        <label className="flex min-h-10 items-center gap-2.5 text-sm">
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
                className={cn("size-9 rounded-md border text-sm font-medium transition-colors", on ? cn(tone, "font-semibold ring-1 ring-current") : "border-input bg-card text-foreground hover:bg-muted dark:bg-background")}>
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
  form, open, initial, ctx, onClose, onSave,
}: { form: FormDef; open: boolean; initial: Values; ctx: AutoContext; onClose: () => void; onSave: (v: Values) => void }) {
  const dev = useDevMode();
  const [v, setV] = React.useState<Values>(() => withAuto(form, initial, ctx));
  React.useEffect(() => { if (open) setV(withAuto(form, initial, ctx)); }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const missing = form.fields.filter((f) => f.required && (v[f.key] === undefined || v[f.key] === "" || (Array.isArray(v[f.key]) && (v[f.key] as string[]).length === 0)));
  const sections: { name: string; fields: FieldDef[] }[] = [];
  for (const f of form.fields) {
    const name = f.section ?? "";
    const last = sections[sections.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else sections.push({ name, fields: [f] });
  }
  const score = scoreSummary(form, v);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{form.title}</SheetTitle>
          <SheetDescription>{form.description ?? "Fill in the form and save it to the chart."}{dev && form.nphies ? ` NPHIES: ${form.nphies}` : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {form.fields.some((f) => f.required) && <RequiredNote />}
          {form.legend && form.legend.length > 0 && (
            <dl className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed" aria-label="Short forms used on this form">
              <div className="mb-0.5 font-semibold text-foreground">Short forms used here</div>
              {form.legend.map(([short, meaning]) => (
                <div key={short}><dt className="inline font-semibold text-foreground">{short}: </dt><dd className="inline text-muted-foreground">{meaning}</dd></div>
              ))}
            </dl>
          )}
          {sections.map((s, i) => (
            <section key={i}>
              {s.name && <h3 className="mb-4 border-b border-border pb-2 text-sm font-semibold text-foreground">{s.name}</h3>}
              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <Field key={f.key} label={f.label} required={f.required} hint={f.hint} hl7={dev ? f.hl7 : undefined}
                    className={cn((f.full || f.type === "textarea" || f.type === "scale" || f.type === "radio" || f.type === "multiselect") && "sm:col-span-2")}>
                    <FieldInput f={f} v={v} onChange={(val) => setV((x) => computeValues(form, { ...x, [f.key]: val }))} />
                  </Field>
                ))}
              </div>
            </section>
          ))}
        </div>
        <SheetFooter className="flex-row items-center justify-between border-t border-border">
          <span className="min-w-0 text-sm text-muted-foreground">
            {hasScores(form) ? `${form.scoreLabel ?? "Total score"}: ` : ""}
            {hasScores(form) && (score.complete
              ? <strong className="text-foreground">{score.total}{score.band ? `, ${score.band.label}` : ""}</strong>
              : <strong className="text-foreground">{score.answered === 0 ? "not scored yet" : `${score.answered} of ${score.items} items answered`}</strong>)}
            {hasScores(form) && form.scoreAll && !score.complete && score.answered > 0 && <span className="block">Answer every item to get the total and the risk band.</span>}
            {missing.length > 0 && <span className="block">Still needed: {missing.map((m) => m.label).join(", ")}</span>}
          </span>
          <span className="flex shrink-0 gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={missing.length > 0} onClick={() => onSave(withAuto(form, v, ctx))} title={missing.length ? `Missing: ${missing.map((m) => m.label).join(", ")}` : undefined}>
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
  const his = useHis();
  const { user } = useSession();
  const records = getFormRecords(enc.visitNumber, form.id);
  const [editing, setEditing] = React.useState<{ id: string | null; initial: Values } | null>(null);
  const canWrite = can("emr.write");
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const age = patient ? ageYears(patient.dob) : NaN;
  const rightAge = fitsAge(form, age);
  const other = form.alternative ? EMR_FORM_BY_ID[form.alternative] : undefined;
  const ctx: AutoContext = { user: user.name, allergies: allergyText(enc.allergies) };
  const blocked = !canWrite ? "Your role cannot add records." : !rightAge ? `This tool is not for a patient aged ${age}.` : "";
  const keys = form.summaryKeys ?? form.fields.slice(0, 4).map((f) => f.key);
  const cols = keys.map((k) => form.fields.find((f) => f.key === k)).filter(Boolean) as FieldDef[];
  const scored = hasScores(form);

  return (
    <Card>
      <CardHeader
        title={form.title}
        subtitle={dev && form.nphies ? `NPHIES: ${form.nphies}` : form.description}
        right={<Button variant="primary" disabled={!!blocked} onClick={() => setEditing({ id: null, initial: prefillValues(form) })} title={blocked || undefined}><Plus className="size-4" />Add New</Button>}
      />
      {!rightAge && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-warn/10 px-4 py-3 text-sm" role="note">
          <span>
            This tool is for {form.audience === "child" ? `children under ${ADULT_FROM_YEARS} years` : `patients aged ${ADULT_FROM_YEARS} years and above`}. This patient is {age} years old.
            {other ? ` Use ${other.title} instead.` : ""}
          </span>
          {other && <Button size="sm" onClick={() => navigate("/chart", { visit: enc.visitNumber, s: other.id })}>Open {other.title}</Button>}
        </div>
      )}
      {form.rollup === "fluid-balance" && <FluidBalance records={records} />}
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
              <Td className="whitespace-nowrap text-sm tabular-nums text-foreground">{new Date(r.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Td>
              {cols.map((c) => <Td key={c.key} className="max-w-[260px] truncate">{display(c, r.values)}</Td>)}
              {scored && <Td><ScoreBadge form={form} v={r.values} /></Td>}
              <Td className="whitespace-nowrap text-sm text-muted-foreground">{r.author}</Td>
              <Td className="text-right">
                <span className="inline-flex gap-1.5">
                  <Button size="sm" disabled={!canWrite} title={canWrite ? undefined : "Your role cannot change records."} onClick={() => setEditing({ id: r.id, initial: r.values })}><Pencil className="size-4" />Edit</Button>
                  <Button size="sm" variant="danger" disabled={!canWrite} title={canWrite ? undefined : "Your role cannot delete records."} onClick={() => deleteFormRecord(enc.visitNumber, form.id, r.id, enc.patientId)}><Trash2 className="size-4" />Delete</Button>
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
        ctx={ctx}
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

/** Intake, output and balance for each shift, and the 24-hour balance of each date. Worked out from the saved records. */
function FluidBalance({ records }: { records: FormRecord[] }) {
  const days = fluidDays(records);
  if (days.length === 0) return null;
  const cell = (n: number | undefined) => (n === undefined ? <span className="text-muted-foreground">Not recorded</span> : <span className={cn("font-medium tabular-nums", n < 0 && "text-destructive")}>{signedMl(n)}</span>);
  return (
    <div className="border-b border-border">
      <h3 className="px-4 pt-3 text-sm font-semibold">Balance By Shift And 24 Hours</h3>
      <p className="px-4 pb-2 text-xs text-muted-foreground">Balance is intake minus output. A minus sign means more went out than came in.</p>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            {SHIFT_NAMES.map((s) => <Th key={s}>{s} balance</Th>)}
            <Th>24-hour intake</Th>
            <Th>24-hour output</Th>
            <Th>24-hour balance</Th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <Td className="whitespace-nowrap tabular-nums">{d.date}</Td>
              {SHIFT_NAMES.map((s) => <Td key={s}>{cell(d.shifts[s]?.balance)}</Td>)}
              <Td className="tabular-nums">{d.intake} mL</Td>
              <Td className="tabular-nums">{d.output} mL</Td>
              <Td>{cell(d.balance)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
