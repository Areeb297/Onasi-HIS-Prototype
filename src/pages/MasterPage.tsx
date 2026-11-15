import * as React from "react";
import { CopyPlus, Database, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { BRAND_BUTTON, DataTable, ListPage, ListToolbar, useList, type Column, type FilterDef, type RowAction } from "@/components/list";
import { fmtDate } from "@/components/list/format";
import { fieldErrors, formSections, isDirty } from "@/components/list/master-form";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Card, Field, Input, RequiredNote, Select, cn } from "@/components/ui/primitives";
import { MASTERS } from "@/lib/masters-data";
import { allowsNegative, keyColumn, rowProblems } from "@/lib/masters/helpers";
import { getMasterRows, saveMasterRows, useRecords } from "@/lib/records";
import type { MasterColumn, MasterDef, Row } from "@/lib/schema";
import { can, useSession } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";
import { audit } from "@/lib/audit";
import { pushToast } from "@/lib/toast";

const badgeTone = (s: string) =>
  // Check the negative words first, so "Inactive" does not match "active".
  /reject|denied|fail|cancel|expired|inactive|overdue|disabled/i.test(s) ? "danger" : /pending|new|review|draft|submitted/i.test(s) ? "warn" : /active|approved|paid|accepted|complete|open|yes|success/i.test(s) ? "ok" : "neutral";

function Cell({ c, v }: { c: MasterColumn; v: Row[string] | undefined }) {
  if (v === undefined || v === "") return <span className="text-muted-foreground">None</span>;
  switch (c.type) {
    case "bool":
      return <Badge tone={v ? "ok" : "neutral"}>{v ? "Yes" : "No"}</Badge>;
    case "badge":
      return <Badge tone={badgeTone(String(v))}>{String(v)}</Badge>;
    case "mono":
      return <span className="font-mono text-xs whitespace-nowrap">{String(v)}</span>;
    case "date":
      return <span className="whitespace-nowrap">{fmtDate(String(v)) || String(v)}</span>;
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return <>{String(v)}</>;
      // Money gets two decimals; counts get thousands separators.
      const money = /price|sar|amount|fee|cost|tariff|charge|balance/i.test(`${c.key} ${c.label}`);
      return <>{n.toLocaleString("en-US", money ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 })}</>;
    }
    default:
      return <span className="inline-block max-w-72 truncate align-bottom" title={String(v)}>{String(v)}</span>;
  }
}

/** Filters a setup list offers: its dropdown and yes-or-no columns, the ones the list shows. */
function filtersFor(def: MasterDef, rows: Row[]): FilterDef<{ r: Row; i: number }>[] {
  return def.columns
    .filter((c) => !c.formOnly && (c.type === "bool" || c.type === "badge" || (c.field?.type === "select" && c.field.options?.length)))
    .slice(0, 4)
    .map((c, n) => {
      if (c.type === "bool") {
        return { id: c.key, label: c.label, quick: n < 2, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], test: ({ r }, v) => (v === "yes") === !!r[c.key] };
      }
      const seen = new Set(rows.map((r) => String(r[c.key] ?? "")).filter(Boolean));
      const opts = (c.field?.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label }));
      for (const s of seen) if (!opts.some((o) => o.value === s)) opts.push({ value: s, label: s });
      return { id: c.key, label: c.label, quick: n < 2, options: opts, test: ({ r }, v) => String(r[c.key] ?? "") === v };
    });
}

/** Generic setup page: a searchable, sortable list with add, edit and delete in a side sheet. Built from a MasterDef. */
export function MasterPage({ id }: { id: string }) {
  useRecords();
  useSession();
  const dev = useDevMode();
  const def = MASTERS.find((m) => m.id === id);
  if (!def) {
    return (
      <ListPage title="Setup Page" subtitle="This setup table does not exist.">
        <Card className="px-4 py-10 text-center text-sm text-muted-foreground">No setup table is defined for "{id}".</Card>
      </ListPage>
    );
  }
  return <MasterList def={def} dev={dev} />;
}

function MasterList({ def, dev }: { def: MasterDef; dev: boolean }) {
  const [edit, setEdit] = React.useState<{ index: number | null; row: Row } | null>(null);
  const [removing, setRemoving] = React.useState<number[] | null>(null);
  const canEdit = can("admin") || can("billing");
  const editable = !def.readOnly && canEdit;

  const rows = getMasterRows(def.id);
  const items = rows.map((r, i) => ({ r, i }));
  /** How a row is named in messages: its code, or its first filled value. */
  const nameOf = (r: Row | undefined) => {
    if (!r) return "this row";
    const key = keyColumn(def) ?? def.columns[0];
    const first = String(r[key.key] ?? "").trim() || String(Object.values(r).find((x) => x !== "" && x !== undefined) ?? "").trim();
    const second = def.columns[1] && def.columns[1].key !== key.key ? String(r[def.columns[1].key] ?? "").trim() : "";
    return [first, second].filter(Boolean).join(", ") || "this row";
  };

  const listed = def.columns.filter((c) => !c.formOnly);
  const columns: Column<{ r: Row; i: number }>[] = listed.map((c, n) => ({
    id: c.key,
    header: c.label,
    numeric: c.type === "number",
    hideable: n > 0,
    cell: ({ r }) => <Cell c={c} v={r[c.key]} />,
    value: ({ r }) => {
      const v = r[c.key];
      return c.type === "number" && v !== "" && v !== undefined ? Number(v) : (v as string | boolean | undefined);
    },
    className: cn("whitespace-nowrap", n === 0 && "font-medium"),
  }));
  const list = useList({
    id: `master:${def.id}`,
    title: def.title,
    rows: items,
    columns,
    getId: ({ i }) => String(i),
    search: ({ r }) => Object.values(r).join(" "),
    filters: filtersFor(def, rows),
    unit: ["row", "rows"],
  });

  const actions = ({ r, i }: { r: Row; i: number }): RowAction[] =>
    editable ? [
      { id: "edit", label: "Edit", icon: <Pencil />, onClick: () => setEdit({ index: i, row: r }) },
      { id: "copy", label: "Duplicate", icon: <CopyPlus />, onClick: () => { const key = keyColumn(def); setEdit({ index: null, row: key ? { ...r, [key.key]: "" } : { ...r } }); } },
      { id: "delete", label: "Delete", icon: <Trash2 />, danger: true, separate: true, onClick: () => setRemoving([i]) },
    ] : [];

  const [first, second, third] = listed;
  const removingRows = removing?.map((i) => rows[i]).filter(Boolean) ?? [];

  return (
    <ListPage
      title={def.title}
      subtitle={def.description ?? `${def.module} setup.`}
      primary={editable ? { label: `Add ${def.title}`, icon: <Plus className="size-4" aria-hidden="true" />, onClick: () => setEdit({ index: null, row: {} }) } : undefined}
      aside={!def.readOnly && !canEdit ? <span className="text-xs text-muted-foreground">View only. An administrator can change this list.</span> : undefined}
    >
      {dev && def.note && <p className="mb-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-xs">{def.note}</p>}
      <ListToolbar list={list} placeholder={`Search ${def.title.toLowerCase()}`} />
      <DataTable
        list={list}
        label={def.title}
        rowLabel={({ r }) => nameOf(r)}
        onRowClick={editable ? ({ r, i }) => setEdit({ index: i, row: r }) : undefined}
        actions={editable ? actions : undefined}
        selectable={editable}
        bulk={[{ label: "Delete", icon: <Trash2 aria-hidden="true" />, onClick: (sel) => setRemoving(sel.map((x) => x.i)) }]}
        card={({ r }) => ({
          title: first ? <span className={first.type === "mono" ? "font-mono text-[0.8125rem] whitespace-nowrap" : undefined}>{String(r[first.key] ?? "") || "None"}</span> : null,
          aside: listed.filter((c) => c.type === "badge" || c.type === "bool").slice(-1).map((c) => <Cell key={c.key} c={c} v={r[c.key]} />)[0],
          lines: [second && <span key="a" className="text-foreground"><Cell c={second} v={r[second.key]} /></span>, third && third.type !== "badge" && third.type !== "bool" && <span key="b">{third.label}: <Cell c={third} v={r[third.key]} /></span>],
        })}
        empty={{
          icon: <Database />,
          title: `No ${def.title} Rows Yet`,
          text: editable ? `Add the first row to start this list.` : "Rows appear here once an administrator adds them.",
          action: editable ? { label: `Add ${def.title}`, icon: <Plus className="size-4" aria-hidden="true" />, onClick: () => setEdit({ index: null, row: {} }) } : undefined,
        }}
      />
      <EditSheet
        def={def}
        open={!!edit}
        initial={edit?.row ?? {}}
        rows={rows}
        index={edit?.index ?? null}
        onClose={() => setEdit(null)}
        onSave={(row) => {
          const adding = edit?.index === null || edit === null;
          saveMasterRows(def.id, adding ? [...rows, row] : rows.map((x, j) => (j === edit.index ? row : x)));
          audit(adding ? "create" : "update", `${def.title} row`, { detail: nameOf(row) });
          pushToast({ tone: "ok", text: adding ? "Row added." : "Row saved.", detail: `${def.title}: ${nameOf(row)}.` });
          setEdit(null);
        }}
      />
      <Dialog
        open={removingRows.length > 0}
        onClose={() => setRemoving(null)}
        title={removingRows.length > 1 ? `Delete ${removingRows.length} Rows?` : "Delete This Row?"}
        subtitle={def.title}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>{removingRows.length > 1 ? "Keep Rows" : "Keep Row"}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!removing) return;
                const gone = new Set(removing);
                const names = removingRows.map(nameOf);
                saveMasterRows(def.id, rows.filter((_, j) => !gone.has(j)));
                names.forEach((name) => audit("delete", `${def.title} row`, { detail: name }));
                pushToast({ tone: "ok", text: names.length > 1 ? `${names.length} rows deleted.` : "Row deleted.", detail: `${def.title}: ${names.slice(0, 3).join("; ")}${names.length > 3 ? " and more" : ""}.` });
                list.clearSelection();
                setRemoving(null);
              }}
            >
              <Trash2 className="size-4" />{removingRows.length > 1 ? `Delete ${removingRows.length} Rows` : "Delete Row"}
            </Button>
          </>
        }
      >
        {removingRows.length > 1 ? (
          <div className="text-sm">
            <p>These rows will be removed from {def.title}. This cannot be undone.</p>
            <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 font-medium">{removingRows.map((r, k) => <li key={k}>{nameOf(r)}</li>)}</ul>
          </div>
        ) : (
          <p className="text-sm"><span className="font-semibold">{nameOf(removingRows[0])}</span> will be removed from {def.title}. This cannot be undone.</p>
        )}
      </Dialog>
    </ListPage>
  );
}

/* ---------- add and edit sheet ---------- */

function EditSheet({ def, open, initial, rows, index, onClose, onSave }: { def: MasterDef; open: boolean; initial: Row; rows: Row[]; index: number | null; onClose: () => void; onSave: (r: Row) => void }) {
  const [v, setV] = React.useState<Row>(initial);
  const [tried, setTried] = React.useState(false);
  const [confirmClose, setConfirmClose] = React.useState(false);
  const body = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => { if (open) { setV(initial); setTried(false); setConfirmClose(false); } }, [open, initial]);

  const dirty = isDirty(initial, v);
  // Missing fields show once Save is pressed. A code already used or a figure below zero shows as soon as it is typed.
  const errors = fieldErrors(def, v, rows, index, tried);
  const sections = formSections(def);
  const adding = index === null;
  const required = def.columns.some((c) => c.field?.required);

  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  const save = () => {
    setTried(true);
    if (rowProblems(def, v, rows, index).length === 0) { onSave(v); return; }
    // Take the user to the first field that needs attention.
    requestAnimationFrame(() => {
      const el = body.current?.querySelector<HTMLElement>("[aria-invalid=true]");
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };
  const problemCount = Object.keys(fieldErrors(def, v, rows, index, true)).length;

  const set = (c: MasterColumn, value: Row[string]) => setV((x) => ({ ...x, [c.key]: value }));

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent className="flex w-full flex-col gap-0 bg-[color:var(--glass-solid)] p-0 sm:max-w-[40rem]" onEscapeKeyDown={(e) => { if (confirmClose) { e.preventDefault(); setConfirmClose(false); } }}>
        <SheetHeader className="border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <p className="text-xs font-medium text-[#035d53] dark:text-[#39edd5]">{def.module}</p>
          <SheetTitle className="pr-8 text-lg tracking-tight text-[#032c26] dark:text-foreground">{adding ? `Add ${def.title}` : `Edit ${def.title}`}</SheetTitle>
          <SheetDescription>{adding ? `A new row in ${def.title}.` : `Changes are saved to this row only.`}</SheetDescription>
        </SheetHeader>

        <form ref={body} className="flex-1 overflow-y-auto px-5 py-5 sm:px-6" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
          {required && <RequiredNote className="mb-4" />}
          {tried && problemCount > 0 && (
            <div role="alert" className="mb-5 rounded-xl border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {problemCount === 1 ? "One field needs attention before this row can be saved." : `${problemCount} fields need attention before this row can be saved.`}
            </div>
          )}
          <div className="space-y-6">
            {sections.map((s) => (
              <fieldset key={s.title} className="min-w-0">
                {sections.length > 1 && <legend className="mb-3 w-full border-b border-border/70 pb-1.5 text-[0.8125rem] font-semibold text-[#032c26] dark:text-foreground">{s.title}</legend>}
                <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
                  {s.columns.map((c) => <FormField key={c.key} c={c} value={v[c.key]} error={errors[c.key]} onChange={(x) => set(c, x)} />)}
                </div>
              </fieldset>
            ))}
          </div>
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>

        <footer className="flex items-center justify-between gap-2 border-t border-border bg-[color:var(--glass-solid)] px-5 py-3 sm:px-6">
          <span className="text-xs text-muted-foreground" aria-live="polite">{dirty ? "Unsaved changes" : adding ? "" : "No changes yet"}</span>
          <div className="flex gap-2">
            <Button onClick={requestClose}>Cancel</Button>
            <Button variant="primary" className={BRAND_BUTTON} onClick={save}>{adding ? `Add ${def.title}` : "Save Changes"}</Button>
          </div>
        </footer>

        {confirmClose && (
          <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-text">
            <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
              <h2 id="discard-title" className="text-base font-semibold">Discard Your Changes?</h2>
              <p id="discard-text" className="mt-1 text-sm text-muted-foreground">The changes to this {def.title.toLowerCase()} have not been saved.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button autoFocus onClick={() => setConfirmClose(false)}>Keep Editing</Button>
                <Button variant="danger" onClick={() => { setConfirmClose(false); onClose(); }}>Discard Changes</Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FormField({ c, value, error, onChange }: { c: MasterColumn; value: Row[string] | undefined; error?: string; onChange: (v: Row[string]) => void }) {
  const errId = React.useId();
  const t = c.type === "bool" ? "checkbox" : (c.field?.type ?? (c.type === "number" ? "number" : c.type === "date" ? "date" : "text"));
  const invalid = error ? { "aria-invalid": true, "aria-describedby": errId } : {};
  const wide = t === "textarea" || /address|description|note|remarks/i.test(c.key);
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <Field label={c.label} required={c.field?.required}>
        {t === "checkbox" ? (
          <span className="flex min-h-10 items-center gap-2.5 text-sm">
            <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[#032c26] dark:accent-[#39edd5]" {...invalid} /> Yes
          </span>
        ) : t === "select" ? (
          <Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} {...invalid}>
            <option value="">Select</option>
            {c.field?.options?.map((o) => { const val = typeof o === "string" ? o : o.value; const lab = typeof o === "string" ? o : o.label; return <option key={val} value={val}>{lab}</option>; })}
          </Select>
        ) : (
          <Input type={t === "number" ? "number" : t === "date" ? "date" : "text"} min={t === "number" && !allowsNegative(c) ? 0 : undefined} value={String(value ?? "")}
            onChange={(e) => onChange(t === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} placeholder={c.field?.placeholder}
            className={c.type === "mono" ? "font-mono" : undefined} {...invalid} />
        )}
      </Field>
      {error && <p id={errId} className="mt-1.5 text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}
