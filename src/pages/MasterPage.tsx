import * as React from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { MASTERS } from "@/lib/masters-data";
import { getMasterRows, saveMasterRows, useRecords } from "@/lib/records";
import type { MasterColumn, MasterDef, Row } from "@/lib/schema";
import { can } from "@/lib/session";
import { useDevMode } from "@/lib/devmode";

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

function EditSheet({ def, open, initial, onClose, onSave }: { def: MasterDef; open: boolean; initial: Row; onClose: () => void; onSave: (r: Row) => void }) {
  const [v, setV] = React.useState<Row>(initial);
  React.useEffect(() => { if (open) setV(initial); }, [open, initial]);
  const missing = def.columns.filter((c) => c.field?.required && (v[c.key] === undefined || v[c.key] === ""));
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{def.title}</SheetTitle>
          <SheetDescription>Add or change a row.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {def.columns.map((c) => {
            const t = c.type === "bool" ? "checkbox" : (c.field?.type ?? (c.type === "number" ? "number" : c.type === "date" ? "date" : "text"));
            return (
              <Field key={c.key} label={c.field?.required ? `${c.label} (required)` : c.label}>
                {t === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!v[c.key]} onChange={(e) => setV({ ...v, [c.key]: e.target.checked })} className="size-4 accent-[var(--primary)]" /> Yes
                  </label>
                ) : t === "select" ? (
                  <Select value={String(v[c.key] ?? "")} onChange={(e) => setV({ ...v, [c.key]: e.target.value })}>
                    <option value="">Select</option>
                    {c.field?.options?.map((o) => { const val = typeof o === "string" ? o : o.value; const lab = typeof o === "string" ? o : o.label; return <option key={val} value={val}>{lab}</option>; })}
                  </Select>
                ) : (
                  <Input type={t === "number" ? "number" : t === "date" ? "date" : "text"} value={String(v[c.key] ?? "")} onChange={(e) => setV({ ...v, [c.key]: t === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value })} placeholder={c.field?.placeholder} />
                )}
              </Field>
            );
          })}
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t border-border">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={missing.length > 0} onClick={() => onSave(v)}>Save</Button>
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
  const [q, setQ] = React.useState("");
  const [edit, setEdit] = React.useState<{ index: number | null; row: Row } | null>(null);
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
              {def.columns.map((c) => <Th key={c.key}>{c.label}</Th>)}
              {!def.readOnly && <Th />}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><Td colSpan={def.columns.length + 1}><Empty>No rows.</Empty></Td></tr>}
            {shown.map(({ r, i }) => (
              <tr key={i} className="hover:bg-muted/40">
                {def.columns.map((c) => <Td key={c.key}><Cell c={c} v={r[c.key]} /></Td>)}
                {!def.readOnly && (
                  <Td className="text-right">
                    <span className="inline-flex gap-1">
                      <button aria-label="Edit" title="Edit" disabled={!canEdit} onClick={() => setEdit({ index: i, row: r })} className="rounded p-1 text-move hover:bg-move/10 disabled:opacity-40"><Pencil className="size-4" /></button>
                      <button aria-label="Delete" title="Delete" disabled={!canEdit} onClick={() => saveMasterRows(def.id, rows.filter((_, j) => j !== i))} className="rounded p-1 text-destructive hover:bg-destructive/10 disabled:opacity-40"><Trash2 className="size-4" /></button>
                    </span>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-4 py-2 text-xs text-muted-foreground">{rows.length} rows</p>
      </Card>
      <EditSheet
        def={def}
        open={!!edit}
        initial={edit?.row ?? {}}
        onClose={() => setEdit(null)}
        onSave={(row) => {
          saveMasterRows(def.id, edit?.index === null || edit === null ? [...rows, row] : rows.map((x, j) => (j === edit.index ? row : x)));
          setEdit(null);
        }}
      />
    </div>
  );
}
