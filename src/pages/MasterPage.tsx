import * as React from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, RequiredNote, Select, Table, Td, Th } from "@/components/ui/primitives";
import { MASTERS } from "@/lib/masters-data";
import { allowsNegative, keyColumn, rowProblems } from "@/lib/masters/helpers";
import { getMasterRows, saveMasterRows, useRecords } from "@/lib/records";
import type { MasterColumn, MasterDef, Row } from "@/lib/schema";
import { can } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";
import { audit } from "@/lib/audit";
import { pushToast } from "@/lib/toast";

function Cell({ c, v }: { c: MasterColumn; v: Row[string] | undefined }) {
  if (v === undefined || v === "") return <span className="text-muted-foreground">None</span>;
  switch (c.type) {
    case "bool":
      return <Badge tone={v ? "ok" : "neutral"}>{v ? "Yes" : "No"}</Badge>;
    case "badge": {
      const s = String(v);
      // Check the negative words first, so "Inactive" does not match "active".
      const tone = /reject|denied|fail|cancel|expired|inactive|overdue/i.test(s) ? "danger" : /pending|new|review|draft|submitted/i.test(s) ? "warn" : /active|approved|paid|accepted|complete|open|yes|success/i.test(s) ? "ok" : "neutral";
      return <Badge tone={tone}>{s}</Badge>;
    }
    case "mono":
      return <span className="font-mono text-xs">{String(v)}</span>;
    default:
      return <>{String(v)}</>;
  }
}

function EditSheet({ def, open, initial, rows, index, onClose, onSave }: { def: MasterDef; open: boolean; initial: Row; rows: Row[]; index: number | null; onClose: () => void; onSave: (r: Row) => void }) {
  const [v, setV] = React.useState<Row>(initial);
  const [tried, setTried] = React.useState(false);
  React.useEffect(() => { if (open) { setV(initial); setTried(false); } }, [open, initial]);
  const missing = def.columns.filter((c) => c.field?.required && (v[c.key] === undefined || v[c.key] === ""));
  // Missing fields keep Save off. The other problems (a code already used, a figure below zero) show as soon as they are typed.
  const problems = rowProblems(def, v, rows, index).filter((p) => tried || !p.startsWith("Enter "));
  const blocked = problems.filter((p) => !p.startsWith("Enter "));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{def.title}</SheetTitle>
          <SheetDescription>{index === null ? "Add a row." : "Change this row."}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {def.columns.some((c) => c.field?.required) && <RequiredNote />}
          {blocked.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              <p className="font-medium">This row cannot be saved yet:</p>
              <ul className="mt-1 list-disc pl-5">{blocked.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
          {def.columns.map((c) => {
            const t = c.type === "bool" ? "checkbox" : (c.field?.type ?? (c.type === "number" ? "number" : c.type === "date" ? "date" : "text"));
            return (
              <Field key={c.key} label={c.label} required={c.field?.required}>
                {t === "checkbox" ? (
                  <label className="flex min-h-10 items-center gap-2.5 text-sm">
                    <input type="checkbox" checked={!!v[c.key]} onChange={(e) => setV({ ...v, [c.key]: e.target.checked })} className="size-4 accent-[var(--primary)]" /> Yes
                  </label>
                ) : t === "select" ? (
                  <Select value={String(v[c.key] ?? "")} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                    <option value="">Select</option>
                    {c.field?.options?.map((o) => { const val = typeof o === "string" ? o : o.value; const lab = typeof o === "string" ? o : o.label; return <option key={val} value={val}>{lab}</option>; })}
                  </Select>
                ) : (
                  <Input type={t === "number" ? "number" : t === "date" ? "date" : "text"} min={t === "number" && !allowsNegative(c) ? 0 : undefined} value={String(v[c.key] ?? "")} onChange={(e) => setV({ ...v, [c.key]: t === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })} placeholder={c.field?.placeholder} />
                )}
              </Field>
            );
          })}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={missing.length > 0 || blocked.length > 0} title={missing.length ? `Missing: ${missing.map((m) => m.label).join(", ")}` : blocked[0]} onClick={() => { setTried(true); if (rowProblems(def, v, rows, index).length === 0) onSave(v); }}>Save</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Generic setup page: searchable table with add, edit and delete. Built from a MasterDef. */
export function MasterPage({ id }: { id: string }) {
  useRecords();
  const dev = useDevMode();
  const def = MASTERS.find((m) => m.id === id);
  const listed = def ? def.columns.filter((c) => !c.formOnly) : [];
  const [q, setQ] = React.useState("");
  const [edit, setEdit] = React.useState<{ index: number | null; row: Row } | null>(null);
  const [removing, setRemoving] = React.useState<number | null>(null);
  const canEdit = can("admin") || can("billing");

  if (!def) {
    return (
      <div>
        <PageHeader title="Setup page" />
        <Card><Empty>No setup table is defined for "{id}".</Empty></Card>
      </div>
    );
  }

  const rows = getMasterRows(def.id);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || Object.values(r).join(" ").toLowerCase().includes(q.toLowerCase()));
  /** How a row is named in messages: its code, or its first filled value. */
  const nameOf = (r: Row | undefined) => {
    if (!r) return "this row";
    const key = keyColumn(def) ?? def.columns[0];
    const first = String(r[key.key] ?? "").trim() || String(Object.values(r).find((x) => x !== "" && x !== undefined) ?? "").trim();
    const second = def.columns[1] && def.columns[1].key !== key.key ? String(r[def.columns[1].key] ?? "").trim() : "";
    return [first, second].filter(Boolean).join(", ") || "this row";
  };
  const removingRow = removing === null ? undefined : rows[removing];

  return (
    <div>
      <PageHeader
        title={def.title}
        subtitle={def.description ?? `${def.module} setup.`}
        right={
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            </div>
            {!def.readOnly && (
              <Button variant="primary" disabled={!canEdit} onClick={() => setEdit({ index: null, row: {} })} title={canEdit ? undefined : "Your role cannot change setup data"}>
                <Plus className="size-4" />Add New
              </Button>
            )}
          </div>
        }
      />
      {dev && def.note && <p className="mb-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs">{def.note}</p>}
      <Card>
        <Table>
          <thead>
            <tr>
              {listed.map((c) => <Th key={c.key}>{c.label}</Th>)}
              {!def.readOnly && <Th />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><Td colSpan={listed.length + 1}><Empty>No rows.</Empty></Td></tr>}
            {shown.map(({ r, i }) => (
              <tr key={i} className="hover:bg-muted/40">
                {listed.map((c) => <Td key={c.key}><Cell c={c} v={r[c.key]} /></Td>)}
                {!def.readOnly && (
                  <Td className="text-right">
                    <span className="inline-flex gap-1">
                      <button aria-label={`Edit ${nameOf(r)}`} title="Edit" disabled={!canEdit} onClick={() => setEdit({ index: i, row: r })} className="rounded p-1 text-move hover:bg-move/10 disabled:opacity-40"><Pencil className="size-4" /></button>
                      <button aria-label={`Delete ${nameOf(r)}`} title="Delete" disabled={!canEdit} onClick={() => setRemoving(i)} className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="size-4" /></button>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted-foreground">{q ? `${shown.length} of ${rows.length} rows shown` : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}</p>
      </Card>
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
        open={removing !== null && !!removingRow}
        onClose={() => setRemoving(null)}
        title="Delete This Row?"
        subtitle={def.title}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>Keep Row</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing === null || !removingRow) return;
                const name = nameOf(removingRow);
                saveMasterRows(def.id, rows.filter((_, j) => j !== removing));
                audit("delete", `${def.title} row`, { detail: name });
                pushToast({ tone: "ok", text: "Row deleted.", detail: `${def.title}: ${name}.` });
                setRemoving(null);
              }}
            >
              <Trash2 className="size-4" />Delete Row
            </Button>
          </>
        }
      >
        <p className="text-sm"><span className="font-semibold">{nameOf(removingRow)}</span> will be removed from {def.title}. This cannot be undone.</p>
      </Dialog>
    </div>
  );
}
