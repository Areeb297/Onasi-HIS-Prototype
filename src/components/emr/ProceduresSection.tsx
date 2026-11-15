import * as React from "react";
import { CheckCircle2, Clock, Pencil, Plus, Scissors, Search, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";
import { fmtWhen } from "@/components/emr/CodeSearch";
import { EmptyState, EntryList, EntryRow, EntrySheet, FormField, FormGrid, FormSection, PickedCode, RowMenu, Segmented, useValidation } from "@/components/emr/entry-ui";
import { PROC_TYPES, newPr, readPr, searchAchi, type AchiItem } from "@/lib/achi-catalog";
import { audit } from "@/lib/audit";
import type { Encounter, Pr } from "@/lib/model";
import { DOCTORS, PR_TYPES } from "@/lib/reference-data";
import { can } from "@/lib/session";
import { nowLocal, patientName, updateEncounter, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

type Coverage = "Insured" | "Cash";
type Status = "Completed" | "Pending";
const doctorName = (id?: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : undefined;
};

/**
 * Procedures for a visit, coded in ACHI. Rows are the PR1 segments of the ADT messages.
 * Clinical procedure type, diagnosis link, coverage and status are kept in the HIS and are not sent.
 */
export function ProceduresSection({ enc }: { enc: Encounter }) {
  const st = useHis();
  const patient = st.patients.find((p) => p.id === enc.patientId);
  const visitPay = patient?.extra?.visitPayType;
  const write = can("emr.write");
  const who = patient ? patientName(patient) : undefined;

  /** `index` is the row being edited; null is a new procedure. */
  const [editing, setEditing] = React.useState<{ index: number | null } | null>(null);
  const [removing, setRemoving] = React.useState<number | null>(null);

  const patch = (i: number, change: Partial<Pr>) =>
    updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.map((x, j) => (j === i ? { ...x, ...change } : x)); });

  /** Returns the problem in words, or null when saved. */
  function save(row: Pr, index: number | null): string | null {
    const status = row.status ?? "Completed";
    if (enc.pr.some((x, j) => j !== index && x.code === row.code && (x.status ?? "Completed") === status)) {
      return `${row.code} is already on this visit as ${status}. Edit that entry instead.`;
    }
    if (index === null) {
      updateEncounter(enc.visitNumber, (e) => { e.pr = [...e.pr, row]; });
      audit("update", `Procedure ${row.code}`, { patient: who, detail: `Visit ${enc.visitNumber}, ${status}` });
      pushToast({ tone: "ok", text: `Procedure ${row.code} added.` });
    } else {
      patch(index, row);
      audit("update", `Procedure ${row.code}`, { patient: who, detail: `Visit ${enc.visitNumber}, edited, ${status}` });
      pushToast({ tone: "ok", text: `Procedure ${row.code} updated.` });
    }
    setEditing(null);
    return null;
  }

  function setStatus(i: number, status: Status) {
    const p = enc.pr[i];
    patch(i, { status });
    audit("update", `Procedure ${p.code}`, { patient: who, detail: `Visit ${enc.visitNumber}, set to ${status}` });
    pushToast({ tone: "ok", text: `Procedure ${p.code} set to ${status}.` });
  }

  function remove(i: number) {
    const p = enc.pr[i];
    updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.filter((_, j) => j !== i); });
    audit("delete", `Procedure ${p.code}`, { patient: who, detail: `Visit ${enc.visitNumber}, removed` });
    pushToast({ tone: "ok", text: `Procedure ${p.code} removed.` });
    setRemoving(null);
  }

  const addButton = (size: "sm" | "md") => <Button size={size} variant="primary" onClick={() => setEditing({ index: null })}><Plus className="size-4" /> Add Procedure</Button>;

  return (
    <Card>
      <CardHeader
        title="Procedures"
        tag="PR1"
        subtitle="Coded in ACHI. Clinical type, diagnosis, coverage and status stay in the HIS."
        right={write && enc.pr.length > 0 && addButton("sm")}
      />
      {enc.pr.length === 0 ? (
        <EmptyState icon={<Scissors />} title="No Procedures Yet" action={write && addButton("md")}>
          Add each procedure done or planned on this visit. Search the ACHI list by code or by name.
        </EmptyState>
      ) : (
        <EntryList label="Procedures">
          {enc.pr.map((raw, i) => {
            const p = readPr(raw, visitPay);
            const dx = p.dxCode ? enc.dx.find((d) => d.code === p.dxCode) : undefined;
            return (
              <EntryRow
                key={p.code + i}
                code={p.code}
                title={p.text}
                badges={
                  <>
                    <Badge tone={p.status === "Completed" ? "ok" : "warn"}>{p.status}</Badge>
                    <Badge tone={p.coverage === "Cash" ? "warn" : "neutral"}>{p.coverage}</Badge>
                  </>
                }
                meta={[
                  [p.status === "Pending" ? "Planned For" : "Started", p.at ? fmtWhen(p.at) : <span className="font-medium text-warn">Not recorded</span>],
                  ["Purpose", PR_TYPES.find((t) => t.code === p.type)?.short],
                  ["Clinical Type", p.procType],
                  ["Diagnosis", p.dxCode ? (dx ? `${dx.code} ${dx.text}` : `${p.dxCode} (removed from the visit)`) : "Not linked"],
                  ["Surgeon", doctorName(p.surgeon)],
                ]}
                right={
                  write && (
                    <RowMenu
                      label={`Actions for ${p.code}`}
                      items={[
                        { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditing({ index: i }) },
                        p.status === "Pending"
                          ? { label: "Mark Completed", icon: <CheckCircle2 className="size-4" />, onSelect: () => setStatus(i, "Completed") }
                          : { label: "Mark Pending", icon: <Clock className="size-4" />, onSelect: () => setStatus(i, "Pending") },
                        { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: () => setRemoving(i) },
                      ]}
                    />
                  )
                }
              />
            );
          })}
        </EntryList>
      )}

      {editing && (
        <ProcedureSheet
          enc={enc}
          visitPay={visitPay}
          initial={editing.index === null ? undefined : enc.pr[editing.index]}
          onClose={() => setEditing(null)}
          onSave={(row) => save(row, editing.index)}
        />
      )}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove Procedure"
        footer={<><Button onClick={() => setRemoving(null)}>Keep Procedure</Button><Button variant="danger" onClick={() => removing !== null && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">
          Remove <strong>{removing !== null ? `${enc.pr[removing]?.code} ${enc.pr[removing]?.text}` : ""}</strong> from this visit? It will no longer be sent with the visit.
        </p>
      </Dialog>
    </Card>
  );
}

function ProcedureSheet({ enc, visitPay, initial, onClose, onSave }: {
  enc: Encounter;
  visitPay?: "Cash" | "Insurance";
  /** The procedure being edited. None for a new one. */
  initial?: Pr;
  onClose: () => void;
  /** Returns the problem in words, or null when saved. */
  onSave: (row: Pr) => string | null;
}) {
  const start = React.useMemo<Pr>(() => {
    if (initial) return { ...readPr(initial, visitPay) };
    return { code: "", text: "", system: "ACHI", at: nowLocal(), coverage: visitPay === "Cash" ? "Cash" : "Insured", status: "Completed", dxCode: enc.dx.length === 1 ? enc.dx[0].code : undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [p, setP] = React.useState<Pr>(start);
  const [filter, setFilter] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [problem, setProblem] = React.useState<string | null>(null);
  const set = (change: Partial<Pr>) => { setP((x) => ({ ...x, ...change })); setProblem(null); };
  const results = React.useMemo(() => searchAchi(query, { procType: filter || undefined, limit: 12 }), [query, filter]);
  const pending = p.status === "Pending";
  const whenLabel = pending ? "Planned For" : "Started";
  const dxGone = p.dxCode && !enc.dx.some((d) => d.code === p.dxCode);

  const v = useValidation({
    code: !p.code && "Search and pick a procedure.",
    at: !p.at && `Enter the ${pending ? "planned" : "start"} date and time.`,
  });

  const pick = (item: AchiItem) => {
    const base = newPr(item, p.at ?? nowLocal(), visitPay, p.dxCode);
    set({ code: base.code, text: base.text, system: base.system, type: base.type, procType: filter || item.procType });
    setQuery("");
  };
  const submit = () => { if (v.submit()) setProblem(onSave(p)); };

  return (
    <EntrySheet
      onClose={onClose}
      dirty={JSON.stringify(p) !== JSON.stringify(start)}
      title={initial ? "Edit Procedure" : "Add Procedure"}
      subtitle={initial ? "Change the details of this procedure." : "Search the ACHI list, then check the details."}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? "Update Procedure" : "Save Procedure"}</Button></>}
    >
      <div className="space-y-6">
        <FormSection title="Procedure">
          {p.code ? (
            <FormField label="Procedure" required group error={problem ?? undefined} help={initial ? "To use another code, remove this procedure and add a new one." : undefined}>
              <PickedCode code={p.code} text={p.text} changeLabel="Change procedure" onChange={initial ? undefined : () => set({ code: "", text: "" })} />
            </FormField>
          ) : (
            <>
              <FormField label="Narrow By Type" help="Optional. Shows only procedures of this type.">
                <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All Types</option>
                  {PROC_TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </FormField>
              <FormField label="Procedure" required error={v.error("code")}>
                <span className="relative block">
                  <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="ps-9" autoFocus value={query} placeholder="For example 30445 or cholecystectomy" aria-label="Search ACHI procedures" onBlur={v.blur("code")} onChange={(e) => setQuery(e.target.value)} />
                </span>
              </FormField>
              {query.trim() !== "" && (
                <div role="listbox" aria-label="ACHI results" className="max-h-72 overflow-y-auto rounded-lg border border-border bg-card">
                  {results.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">No ACHI procedure matches. Try fewer words or another type.</p>}
                  {results.map((r) => (
                    <button
                      key={r.code} type="button" role="option" aria-selected={false} onClick={() => pick(r)}
                      className="flex w-full items-start gap-3 border-b border-border/70 px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
                    >
                      <span className="font-mono text-xs font-semibold">{r.code}</span>
                      <span className="min-w-0 flex-1">{r.text}<span className="block text-xs text-muted-foreground">{r.area}, {r.procType}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </FormSection>

        <FormSection title="Details">
          <FormGrid>
            <FormField label="Status" group>
              <Segmented value={p.status ?? "Completed"} options={[{ value: "Completed", label: "Completed" }, { value: "Pending", label: "Pending" }]} onChange={(s: Status) => set({ status: s })} />
            </FormField>
            <FormField label={whenLabel} required hl7="PR1-5" error={v.error("at")}>
              <Input type="datetime-local" value={p.at ?? ""} onBlur={v.blur("at")} onChange={(e) => set({ at: e.target.value })} />
            </FormField>
            <FormField label="Purpose" hl7="PR1-6" help="Sent with the visit.">
              <Select value={p.type ?? ""} onChange={(e) => set({ type: (e.target.value || undefined) as Pr["type"] })}>
                <option value="">Not Set</option>
                {PR_TYPES.map((t) => <option key={t.code} value={t.code}>{t.short}</option>)}
              </Select>
            </FormField>
            <FormField label="Clinical Type">
              <Select value={p.procType ?? ""} onChange={(e) => set({ procType: e.target.value || undefined })}>
                <option value="">Not Set</option>
                {PROC_TYPES.map((t) => <option key={t}>{t}</option>)}
                {p.procType && !(PROC_TYPES as readonly string[]).includes(p.procType) && <option>{p.procType}</option>}
              </Select>
            </FormField>
            <FormField label="Surgeon" hl7="PR1-11">
              <Select value={p.surgeon ?? ""} onChange={(e) => set({ surgeon: e.target.value || undefined })}>
                <option value="">None</option>
                {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
              </Select>
            </FormField>
            <FormField label="Coverage" group help={`This visit is ${visitPay === "Cash" ? "cash" : "insured"}.`}>
              <Segmented value={p.coverage ?? "Insured"} options={[{ value: "Insured", label: "Insured" }, { value: "Cash", label: "Cash" }]} onChange={(c: Coverage) => set({ coverage: c })} />
            </FormField>
            <FormField label="Diagnosis" className="sm:col-span-2" help={enc.dx.length === 0 ? "This visit has no diagnosis yet. Add one in Diagnosis to link it." : "The diagnosis this procedure is for."}>
              <Select value={p.dxCode ?? ""} disabled={enc.dx.length === 0 && !p.dxCode} onChange={(e) => set({ dxCode: e.target.value || undefined })}>
                <option value="">{enc.dx.length === 0 ? "No Diagnosis On This Visit" : "Not Linked"}</option>
                {enc.dx.map((d) => <option key={d.code} value={d.code}>{d.code} {d.text}</option>)}
                {dxGone && <option value={p.dxCode}>{p.dxCode} (removed from the visit)</option>}
              </Select>
            </FormField>
          </FormGrid>
        </FormSection>
      </div>
    </EntrySheet>
  );
}
