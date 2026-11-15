import * as React from "react";
import { Check, FileClock, Pencil, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Table, Td, Th, cn } from "@/components/ui/primitives";
import {
  AttentionLink, CheckRow, ChipMulti, ChipSingle, ChoiceSelect, DateTimeInput, ErrorSummary, FormActions, FormGrid, FormSection, SegmentedControl,
  clearDraft, countIn, draftTime, fitsSegmented, focusField, isBlank, isDirty, loadDraft, rules, saveDraft, summaryItems, useFormErrors, useUnsavedChangesGuard, type Errors,
} from "@/components/forms";
import { pushToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";
import { EMR_FORM_BY_ID, sexProblem } from "@/lib/emr-forms";
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

const toOpt = (o: string | FieldOption) => ({ value: optValue(o), label: optLabel(o) });

/** A radio field with two to four short choices is a segmented control. Longer lists are chips. */
const segmented = (f: FieldDef) => f.type === "radio" && fitsSegmented((f.options ?? []).map(toOpt));

/** Fields that take the whole row of the grid: long text and rows of choices. */
const wide = (f: FieldDef) =>
  !!f.full || f.type === "textarea" || f.type === "scale" || f.type === "multiselect" || f.type === "checkbox" || (f.type === "radio" && !segmented(f));

/** Fields shown as a labelled group rather than a <label>, because they hold more than one control. */
const grouped = (f: FieldDef) => f.type === "radio" || f.type === "multiselect" || f.type === "scale" || f.type === "checkbox" || f.type === "datetime";

function FieldInput({ f, v, onChange }: { f: FieldDef; v: Values; onChange: (val: Values[string]) => void }) {
  const val = v[f.key];
  if (f.compute) {
    return <Input readOnly disabled value={val === undefined || val === "" ? "" : String(val)} placeholder="Enter the amounts above" aria-label={`${f.label}, worked out for you`} className="font-semibold tabular-nums" suffix={f.unit} />;
  }
  if (f.auto) return <Input readOnly disabled value={(val as string) ?? ""} aria-label={f.label} />;
  switch (f.type) {
    case "textarea":
      return <Textarea value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} placeholder={f.placeholder} aria-label={f.label} />;
    case "number":
      return (
        <Input type="number" inputMode="decimal" min={f.min} max={f.max} value={(val as number | string) ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} aria-label={f.label} suffix={f.unit} className="tabular-nums" />
      );
    case "datetime":
      return <DateTimeInput value={(val as string) ?? ""} onChange={(x) => onChange(x)} label={f.label} />;
    case "date":
    case "time":
      return <Input type={f.type} value={(val as string) ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={f.label} />;
    case "select":
      return <ChoiceSelect options={(f.options ?? []).map(toOpt)} value={(val as string) ?? ""} onChange={(x) => onChange(x)} placeholder="Select" label={f.label} />;
    case "radio":
      return segmented(f)
        ? <SegmentedControl options={(f.options ?? []).map(toOpt)} value={(val as string) ?? ""} onChange={(x) => onChange(x)} label={f.label} />
        : <ChipSingle options={(f.options ?? []).map(toOpt)} value={(val as string) ?? ""} onChange={(x) => onChange(x)} label={f.label} />;
    case "multiselect":
      return <ChipMulti options={(f.options ?? []).map(toOpt)} value={Array.isArray(val) ? val : []} onChange={(x) => onChange(x)} label={f.label} />;
    case "checkbox":
      return <CheckRow checked={!!val} onChange={(x) => onChange(x)}>{f.placeholder ?? "Yes"}</CheckRow>;
    case "scale": {
      const max = f.max ?? 10;
      return (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={f.label}>
          {Array.from({ length: max + 1 }, (_, i) => {
            const on = val === i;
            const tone = i / max >= 0.7 ? "border-cancel bg-cancel text-white" : i / max >= 0.4 ? "border-warn bg-warn text-white" : "border-[#035D53] bg-[#035D53] text-white";
            return (
              <button key={i} type="button" role="radio" aria-checked={on} onClick={() => onChange(i)}
                className={cn("size-10 rounded-lg border text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1", on ? cn(tone, "font-semibold shadow-sm") : "border-input bg-card text-foreground hover:border-foreground/45 hover:bg-muted dark:bg-background")}>
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

/** The problem with one field's value: required and empty, or a number outside its range. */
function fieldErrors(form: FormDef, v: Values): Errors {
  const out: Errors = {};
  for (const f of form.fields) {
    if (!isEntry(f)) continue;
    const val = v[f.key];
    if (f.required && isBlank(val)) {
      out[f.key] = ["select", "radio", "multiselect", "scale"].includes(f.type) ? "Choose an option." : f.type === "checkbox" ? "Tick to confirm." : "Enter a value.";
      continue;
    }
    if (f.type === "number" && (f.min !== undefined || f.max !== undefined)) {
      const msg = rules.range(f.min, f.max)(val, v);
      if (msg) out[f.key] = msg;
    }
  }
  return out;
}

/* ---------- the form in a side sheet ---------- */

const isEmpty = (val: Values[string] | undefined) => val === undefined || val === "" || val === false || (Array.isArray(val) && val.length === 0);
/** Fields the user fills in. The ones the system works out or fills by itself are not counted. */
const isEntry = (f: FieldDef) => !f.compute && !f.auto;

interface Part {
  name: string;
  fields: FieldDef[];
}

/** Fields in the order of the form, grouped under their section headings. */
function formSections(form: FormDef): Part[] {
  const out: Part[] = [];
  for (const f of form.fields) {
    const name = f.section ?? "";
    const last = out[out.length - 1];
    if (last && last.name === name) last.fields.push(f);
    else out.push({ name, fields: [f] });
  }
  return out;
}

/** How much of a list of fields is filled in. */
function fillCount(fields: FieldDef[], v: Values) {
  const entry = fields.filter(isEntry);
  return { total: entry.length, filled: entry.filter((f) => !isEmpty(v[f.key])).length };
}

/** A form is long when it has enough sections and fields that it is easier to work one section at a time. */
const LONG_FORM_FIELDS = 30;
const LONG_FORM_SECTIONS = 4;

function FormSheet({
  form, open, initial, ctx, draftKey, onClose, onSave,
}: { form: FormDef; open: boolean; initial: Values; ctx: AutoContext; draftKey: string; onClose: () => void; onSave: (v: Values) => void }) {
  const dev = useDevMode();
  const [v, setV] = React.useState<Values>(() => withAuto(form, initial, ctx));
  /** The values the form opened with. A change from these asks before closing. */
  const [base, setBase] = React.useState<Values>(v);
  const [draftAt, setDraftAt] = React.useState<string | null>(null);
  const sections = React.useMemo(() => formSections(form), [form]);
  const named = sections.filter((s) => s.name).length;
  const long = form.fields.length >= LONG_FORM_FIELDS && named >= LONG_FORM_SECTIONS;
  const collapsible = named >= 2;
  /** Which sections are open. A long form opens with only its first section showing. */
  const startOpen = React.useCallback(() => sections.map((s, i) => !long || i === 0 || !s.name), [long, sections]);
  const [openParts, setOpenParts] = React.useState<boolean[]>(startOpen);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const summaryRef = React.useRef<HTMLDivElement>(null);
  const order = React.useMemo(() => form.fields.map((f) => f.key), [form]);
  const labels = React.useMemo(() => Object.fromEntries(form.fields.map((f) => [f.key, f.label])), [form]);

  const errors = fieldErrors(form, v);
  const fe = useFormErrors(errors, order);

  React.useEffect(() => {
    if (!open) return;
    const start = withAuto(form, initial, ctx);
    const d = loadDraft<Values>(draftKey);
    const restored = d ? withAuto(form, { ...initial, ...d.values }, ctx) : start;
    setV(restored);
    setBase(restored);
    setDraftAt(d ? d.savedAt : null);
    setOpenParts(startOpen());
    fe.reset();
  }, [open, initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = open && isDirty(base, v);
  const all = fillCount(form.fields, v);
  const score = scoreSummary(form, v);
  const shownCount = Object.keys(fe.shown).length;

  function saveDraftAndClose() {
    saveDraft(draftKey, v);
    pushToast({ tone: "ok", text: "Draft saved", detail: `${form.title} is kept on this computer. Open it again to finish and save it to the chart.` });
    onClose();
  }
  const { guard, dialog } = useUnsavedChangesGuard(dirty, { onSaveDraft: () => { saveDraft(draftKey, v); pushToast({ tone: "ok", text: "Draft saved", detail: form.title }); } });
  const close = () => guard(onClose);

  function save() {
    if (!fe.attempt()) {
      requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ block: "nearest" }));
      return;
    }
    clearDraft(draftKey);
    onSave(withAuto(form, v, ctx));
  }

  function discardDraft() {
    clearDraft(draftKey);
    const start = withAuto(form, initial, ctx);
    setV(start); setBase(start); setDraftAt(null); fe.reset();
  }

  /** Opens a section and brings it to the top of the form. */
  const jump = (i: number) => {
    setOpenParts((o) => o.map((x, j) => (j === i ? true : x)));
    requestAnimationFrame(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(`[data-part="${i}"]`);
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  };
  const allOpen = openParts.every(Boolean);

  const fieldsOf = (fields: FieldDef[]) => (
    <FormGrid cols={long ? 3 : 2}>
      {fields.map((f) => (
        <div key={f.key} className={cn("min-w-0", wide(f) && "col-span-full")}>
          <Field name={f.key} group={grouped(f)} label={f.label} required={f.required} hint={f.hint} error={fe.shown[f.key]} hl7={dev ? f.hl7 : undefined}>
            <FieldInput f={f} v={v} onChange={(val) => setV((x) => computeValues(form, { ...x, [f.key]: val }))} />
          </Field>
        </div>
      ))}
    </FormGrid>
  );

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className={cn("flex w-full flex-col gap-0 bg-background", long ? "sm:max-w-4xl" : "sm:max-w-2xl")}>
        <SheetHeader className="border-b border-border bg-[color:var(--glass-solid)] px-5 pr-12">
          <SheetTitle className="text-lg">{form.title}</SheetTitle>
          <SheetDescription>{form.description ?? "Fill in the form and save it to the chart."}{dev && form.nphies ? ` NPHIES: ${form.nphies}` : ""}</SheetDescription>
        </SheetHeader>
        {collapsible && (
          <nav aria-label="Sections of this form" className="flex items-center gap-2 border-b border-border bg-[color:var(--glass-solid)] px-5 py-2">
            <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:thin]">
              {sections.map((s, i) => {
                if (!s.name) return null;
                const c = fillCount(s.fields, v);
                const done = c.total > 0 && c.filled === c.total;
                const bad = countIn(fe.shown, s.fields.map((f) => f.key));
                return (
                  <li key={i} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => jump(i)}
                      aria-label={`Go to ${s.name}, ${c.filled} of ${c.total} filled${bad ? `, ${bad} to fix` : ""}`}
                      className={cn(
                        "flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        bad ? "border-destructive/50 bg-destructive/[0.06] text-foreground" : done ? "border-[#03C1AC] bg-card text-foreground" : "border-border bg-card text-foreground",
                      )}
                    >
                      {done && !bad && <Check className="size-3.5 text-[#035D53] dark:text-[#39EDD5]" aria-hidden="true" />}
                      {s.name}
                      <span className={cn("tabular-nums", bad ? "font-semibold text-destructive" : "text-muted-foreground")}>{bad ? `${bad} to fix` : `${c.filled}/${c.total}`}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setOpenParts(sections.map(() => !allOpen))}>
              {allOpen ? "Collapse All" : "Expand All"}
            </Button>
          </nav>
        )}
        <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" {...fe.bind}>
          {draftAt && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#03C1AC]/60 bg-card px-4 py-2.5 text-sm">
              <FileClock className="size-4 shrink-0 text-[#035D53] dark:text-[#39EDD5]" aria-hidden="true" />
              <span className="min-w-0 flex-1">Your draft from {draftTime(draftAt)} is filled in. Check it and save it to the chart.</span>
              <Button size="sm" variant="ghost" onClick={discardDraft}>Discard Draft</Button>
            </div>
          )}
          <ErrorSummary
            ref={summaryRef}
            items={summaryItems(fe.shown, order, labels).map((i) => ({ key: i.key, text: `${i.label}: ${i.message}` }))}
            onJump={(k) => focusField(k, bodyRef.current ?? document)}
          />
          {form.fields.some((f) => f.required) && <RequiredNote />}
          {form.legend && form.legend.length > 0 && (
            <dl className="rounded-xl border border-border bg-card px-4 py-2.5 text-xs leading-relaxed" aria-label="Short forms used on this form">
              <div className="mb-0.5 font-semibold text-foreground">Short forms used here</div>
              {form.legend.map(([short, meaning]) => (
                <div key={short}><dt className="inline font-semibold text-foreground">{short}: </dt><dd className="inline text-muted-foreground">{meaning}</dd></div>
              ))}
            </dl>
          )}
          {sections.map((s, i) => {
            const c = fillCount(s.fields, v);
            const bad = countIn(fe.shown, s.fields.map((f) => f.key));
            if (!s.name) {
              return <div key={i} data-part={i} className="rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg-strong)] px-4 py-5 shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow)] sm:px-5">{fieldsOf(s.fields)}</div>;
            }
            return (
              <div key={i} data-part={i} className="scroll-mt-2">
                <FormSection
                  title={s.name}
                  filled={c.filled}
                  total={c.total}
                  attention={bad}
                  collapsible={collapsible}
                  open={collapsible ? openParts[i] : true}
                  onOpenChange={(o) => setOpenParts((x) => x.map((y, j) => (j === i ? o : y)))}
                >
                  {fieldsOf(s.fields)}
                </FormSection>
              </div>
            );
          })}
        </div>
        <FormActions
          className="bg-[color:var(--glass-solid)] px-4 sm:px-5"
          onCancel={close}
          onDraft={saveDraftAndClose}
          onSave={save}
          status={
            <span className="flex flex-col gap-1">
              {shownCount > 0 ? (
                <AttentionLink count={shownCount} onClick={() => summaryRef.current?.focus()} />
              ) : (
                <span className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="block h-full rounded-full bg-[#03C1AC] transition-[width] motion-reduce:transition-none" style={{ width: `${all.total ? Math.round((all.filled / all.total) * 100) : 0}%` }} />
                  </span>
                  <span className="tabular-nums">{all.filled} of {all.total} filled</span>
                </span>
              )}
              {hasScores(form) && (
                <span className="text-xs">
                  {form.scoreLabel ?? "Total score"}:{" "}
                  {score.complete
                    ? <strong className="text-foreground">{score.total}{score.band ? `, ${score.band.label}` : ""}</strong>
                    : <strong className="text-foreground">{score.answered === 0 ? "not scored yet" : `${score.answered} of ${score.items} items answered`}</strong>}
                  {form.scoreAll && !score.complete && score.answered > 0 && <span className="block">Answer every item to get the total and the risk band.</span>}
                </span>
              )}
            </span>
          }
        />
        {dialog}
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
  const wrongSex = sexProblem(form, patient?.sex);
  const other = form.alternative ? EMR_FORM_BY_ID[form.alternative] : undefined;
  const ctx: AutoContext = { user: user.name, allergies: allergyText(enc.allergies) };
  const blocked = !canWrite ? "Your role cannot add records." : wrongSex ? wrongSex : !rightAge ? `This tool is not for a patient aged ${age}.` : "";
  const keys = form.summaryKeys ?? form.fields.slice(0, 4).map((f) => f.key);
  const cols = keys.map((k) => form.fields.find((f) => f.key === k)).filter(Boolean) as FieldDef[];
  const scored = hasScores(form);
  const hasDraft = !blocked && !editing && !!loadDraft(`${enc.visitNumber}:${form.id}:new`);

  return (
    <Card>
      <CardHeader
        title={form.title}
        subtitle={dev && form.nphies ? `NPHIES: ${form.nphies}` : form.description}
        right={
          <Button variant="primary" disabled={!!blocked} onClick={() => setEditing({ id: null, initial: prefillValues(form) })} title={blocked || undefined}>
            {hasDraft ? <><FileClock className="size-4" />Continue Draft</> : <><Plus className="size-4" />Add New</>}
          </Button>
        }
      />
      {wrongSex && (
        <div className="border-b border-border bg-warn/10 px-4 py-3 text-sm" role="note">
          {wrongSex} A new record cannot be added.{records.length > 0 ? " Records saved earlier are shown below." : ""}
        </div>
      )}
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
              <Td className="whitespace-nowrap text-sm tabular-nums text-foreground">{fmtDateTime(r.at)}</Td>
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
        draftKey={`${enc.visitNumber}:${form.id}:${editing?.id ?? "new"}`}
        onClose={() => setEditing(null)}
        onSave={(v) => {
          if (editing?.id) updateFormRecord(enc.visitNumber, form.id, editing.id, v, enc.patientId);
          else if (!wrongSex) addFormRecord(enc.visitNumber, form.id, v, enc.patientId); // a new record needs the right sex, as it needs the right age
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
