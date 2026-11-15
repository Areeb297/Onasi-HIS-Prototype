import * as React from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button, Card, CardHeader, Empty, Field, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { CodeSearch, ProblemList, RadioRow, fmtWhen } from "@/components/emr/CodeSearch";
import { audit } from "@/lib/audit";
import { COMPLAINT_MAX, complaintProblems, complaintSystemLabel, reasonFromComplaints } from "@/lib/chart-entries";
import type { Complaint, Encounter } from "@/lib/model";
import { DOCTORS, ICD10AM_DIAGNOSES, SNOMED_COMPLAINTS, type CodedTerm } from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import { nowLocal, updateEncounter } from "@/lib/store";
import { pushToast } from "@/lib/toast";

type System = NonNullable<Complaint["system"]>;
type Ref = { list: "active" | "inactive"; index: number };

/** Chief complaints of the visit, as in the HIS: SNOMED CT or ICD-10-AM codes (several at once) or free text. */
export function ComplaintsSection({ enc }: { enc: Encounter }) {
  const { user } = useSession();
  const write = can("emr.write");
  const inactive = enc.complaintsInactive ?? [];
  const [editing, setEditing] = React.useState<{ ref?: Ref; c?: Complaint } | null>(null);
  const [removing, setRemoving] = React.useState<Ref | null>(null);
  const attending = DOCTORS.find((d) => d.id === enc.attending);
  const fallbackBy = attending ? `Dr. ${attending.given} ${attending.family}` : "Not recorded";
  const rows: { c: Complaint; ref: Ref }[] = [
    ...enc.complaints.map((c, index) => ({ c, ref: { list: "active" as const, index } })),
    ...inactive.map((c, index) => ({ c, ref: { list: "inactive" as const, index } })),
  ];
  const get = (r: Ref) => (r.list === "active" ? enc.complaints : inactive)[r.index];

  /** Writes both lists and keeps the visit reason (PV2) in step with the active complaints. */
  const write2 = (active: Complaint[], ina: Complaint[]) =>
    updateEncounter(enc.visitNumber, (e) => { e.complaints = active; e.complaintsInactive = ina; e.reason = reasonFromComplaints(active); });

  const save = (items: Complaint[]) => {
    const ref = editing?.ref;
    let act = [...enc.complaints];
    let ina = [...inactive];
    const [first, ...more] = items;
    if (ref?.list === "active") act[ref.index] = { ...act[ref.index], ...first };
    else if (ref?.list === "inactive") ina[ref.index] = { ...ina[ref.index], ...first };
    else act.push(first);
    const skipped: string[] = [];
    for (const m of more) {
      if (act.some((x) => x.code && x.code === m.code)) skipped.push(m.text);
      else act.push(m);
    }
    act = act.filter((x, i) => !x.code || act.findIndex((y) => y.code === x.code) === i);
    ina = ina.filter(Boolean);
    write2(act, ina);
    audit(ref ? "update" : "create", `Chart ${enc.visitNumber}`, { detail: `Chief complaint: ${items.map((x) => x.text).join(", ")}` });
    pushToast({ tone: "ok", text: ref ? "Chief complaint updated." : items.length > 1 ? `${items.length} chief complaints added.` : "Chief complaint added.", detail: skipped.length ? `Already in the list: ${skipped.join(", ")}.` : undefined });
    setEditing(null);
  };

  const toggle = (ref: Ref, on: boolean) => {
    const c = get(ref);
    if (on) write2([...enc.complaints, c], inactive.filter((_, i) => i !== ref.index));
    else write2(enc.complaints.filter((_, i) => i !== ref.index), [...inactive, c]);
    audit("update", `Chart ${enc.visitNumber}`, { detail: `Chief complaint ${c.text} set to ${on ? "Active" : "Inactive"}` });
  };

  const remove = (ref: Ref) => {
    const c = get(ref);
    if (ref.list === "active") write2(enc.complaints.filter((_, i) => i !== ref.index), inactive);
    else write2(enc.complaints, inactive.filter((_, i) => i !== ref.index));
    audit("delete", `Chart ${enc.visitNumber}`, { detail: `Chief complaint ${c?.text} removed` });
    setRemoving(null);
  };

  return (
    <Card>
      <CardHeader
        title="Chief Complaints"
        tag="PV2"
        subtitle="Active complaints, in words, become the reason for the visit."
        right={write && <Button size="sm" variant="primary" onClick={() => setEditing({})}><Plus className="size-4" /> Add Chief Complaint</Button>}
      />
      <Table>
        <thead><tr><Th>Date And Time</Th><Th>Doctor</Th><Th>Complaint</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={5}><Empty>No complaints yet.</Empty></Td></tr>}
          {rows.map(({ c, ref }) => {
            const on = ref.list === "active";
            return (
              <tr key={`${ref.list}-${ref.index}`} className={cn(!on && "text-muted-foreground")}>
                <Td className="whitespace-nowrap text-xs">{fmtWhen(c.at ?? enc.admitAt ?? enc.expectedAdmitAt)}</Td>
                <Td className="whitespace-nowrap">{c.by ?? fallbackBy}</Td>
                <Td className="min-w-56">
                  <div className="font-medium">{c.code ? `${c.code} - ` : ""}{c.text}</div>
                  <div className="text-xs text-muted-foreground">Type: {c.code ? complaintSystemLabel(c) : "Free text"}</div>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Switch checked={on} disabled={!write} label={`${c.text} active`} onChange={(v) => toggle(ref, v)} />
                    <span className="text-xs">{on ? "Active" : "Inactive"}</span>
                  </span>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {write && (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`Edit ${c.text}`} title="Edit" onClick={() => setEditing({ ref, c })}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${c.text}`} title="Remove" className="text-destructive" onClick={() => setRemoving(ref)}><Trash2 className="size-4" /></Button>
                    </>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      {editing && (
        <ComplaintDialog
          initial={editing.c}
          taken={enc.complaints.filter((_, i) => !(editing.ref?.list === "active" && editing.ref.index === i)).map((x) => x.code).filter(Boolean)}
          onClose={() => setEditing(null)}
          onSave={(items) => save(items.map((x) => ({ ...x, at: editing.c?.at ?? nowLocal(), by: user.name })))}
        />
      )}
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove Chief Complaint"
        footer={<><Button onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={() => removing && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">Remove <strong>{removing ? get(removing)?.text : ""}</strong> from this visit?</p>
      </Dialog>
    </Card>
  );
}

function ComplaintDialog({ initial, taken, onClose, onSave }: {
  initial?: Complaint;
  /** Codes of the other active complaints. */
  taken: string[];
  onClose: () => void;
  onSave: (items: Complaint[]) => void;
}) {
  const [system, setSystem] = React.useState<System>(initial?.system ?? "SNOMED");
  const [codes, setCodes] = React.useState<(CodedTerm & { system: System })[]>(initial?.code ? [{ code: initial.code, text: initial.text, system: initial.system ?? "SNOMED" }] : []);
  const [text, setText] = React.useState(initial && !initial.code ? initial.text : "");
  const [problems, setProblems] = React.useState<string[]>([]);
  const list = system === "SNOMED" ? SNOMED_COMPLAINTS : ICD10AM_DIAGNOSES;
  const codeMode = codes.length > 0;

  const submit = () => {
    const p = complaintProblems(codes, text);
    if (p.length) { setProblems(p); return; }
    onSave(codeMode ? codes.map((c) => ({ code: c.code, text: c.text, system: c.system })) : [{ code: "", text: text.trim() }]);
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={initial ? "Edit Chief Complaint" : "Add Chief Complaint"}
      subtitle="Select one or more codes, or enter free text. Not both."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? "Update" : "Save"}</Button></>}
    >
      <div className="space-y-4">
        <RadioRow
          name="complaint-system"
          label="Code System"
          value={system}
          options={[{ value: "SNOMED", label: "SNOMED CT" }, { value: "ICD10AM", label: "ICD-10-AM" }]}
          onChange={(v) => { setSystem(v); setProblems([]); }}
        />
        <Field label="Code" hint={text.trim() ? "Clear the free text to select codes." : "You can select several codes. Each one is saved as its own complaint."}>
          {text.trim() ? (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Free text is entered below.</p>
          ) : (
            <CodeSearch
              label="Search complaint codes"
              placeholder={system === "SNOMED" ? "Type to search, for example fever or 3866" : "Type to search, for example cough or R05"}
              items={list}
              exclude={[...taken, ...codes.map((c) => c.code)]}
              onPick={(t) => { setCodes((x) => [...x, { code: t.code, text: t.text, system }]); setProblems([]); }}
            />
          )}
        </Field>
        {codeMode && (
          <ul className="flex flex-wrap gap-1.5" aria-label="Selected codes">
            {codes.map((c) => (
              <li key={c.code} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs">
                <span className="font-mono font-semibold">{c.code}</span> {c.text}
                <span className="text-muted-foreground">({c.system === "ICD10AM" ? "ICD-10-AM" : "SNOMED CT"})</span>
                <button type="button" aria-label={`Remove ${c.text}`} className="rounded text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setCodes((x) => x.filter((y) => y.code !== c.code))}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Field label="Complaint Text" hint={codeMode ? "Remove the selected code(s) to enter free text." : `${text.length}/${COMPLAINT_MAX}`}>
          <textarea
            value={text}
            disabled={codeMode}
            maxLength={COMPLAINT_MAX}
            rows={3}
            placeholder={codeMode ? "Remove the selected code(s) to enter free text" : `Enter chief complaint free text (up to ${COMPLAINT_MAX} characters)`}
            onChange={(e) => { setText(e.target.value); setProblems([]); }}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted"
          />
        </Field>
        <ProblemList problems={problems} />
      </div>
    </Dialog>
  );
}
