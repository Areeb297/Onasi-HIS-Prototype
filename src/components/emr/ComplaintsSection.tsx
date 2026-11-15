import * as React from "react";
import { MessageSquareText, Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { CodeSearch, fmtWhen } from "@/components/emr/CodeSearch";
import { ActiveToggle, EmptyState, EntryList, EntryRow, EntrySheet, FormField, RowMenu, Segmented, TextArea, useValidation } from "@/components/emr/entry-ui";
import { audit } from "@/lib/audit";
import { COMPLAINT_MAX, complaintProblems, complaintSystemLabel, reasonFromComplaints } from "@/lib/chart-entries";
import type { Complaint, Encounter } from "@/lib/model";
import { DOCTORS, ICD10AM_DIAGNOSES, SNOMED_COMPLAINTS, type CodedTerm } from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import { nowLocal, updateEncounter } from "@/lib/store";
import { pushToast } from "@/lib/toast";

type System = NonNullable<Complaint["system"]>;
type Ref = { list: "active" | "inactive"; index: number };
type Mode = "codes" | "text";

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
    pushToast({ tone: "ok", text: "Chief complaint removed." });
    setRemoving(null);
  };

  const addButton = <Button size="sm" variant="primary" onClick={() => setEditing({})}><Plus className="size-4" /> Add Chief Complaint</Button>;

  return (
    <Card>
      <CardHeader
        title="Chief Complaints"
        tag="PV2"
        subtitle="Active complaints, in words, become the reason for the visit."
        right={write && rows.length > 0 && addButton}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<MessageSquareText />} title="No Chief Complaint Yet" action={write && <Button variant="primary" onClick={() => setEditing({})}><Plus className="size-4" /> Add Chief Complaint</Button>}>
          Record why the patient came. Pick codes or type it in the patient's words.
        </EmptyState>
      ) : (
        <EntryList label="Chief complaints">
          {rows.map(({ c, ref }) => {
            const on = ref.list === "active";
            return (
              <EntryRow
                key={`${ref.list}-${ref.index}`}
                code={c.code || undefined}
                title={c.text}
                muted={!on}
                badges={<Badge tone="neutral">{c.code ? complaintSystemLabel(c) : "Free Text"}</Badge>}
                meta={[["Doctor", c.by ?? fallbackBy], ["Recorded", fmtWhen(c.at ?? enc.admitAt ?? enc.expectedAdmitAt)]]}
                right={
                  <>
                    <ActiveToggle on={on} disabled={!write} label={`${c.text} active`} onChange={(v) => toggle(ref, v)} />
                    {write && (
                      <RowMenu
                        label={`Actions for ${c.text}`}
                        items={[
                          { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditing({ ref, c }) },
                          { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: () => setRemoving(ref) },
                        ]}
                      />
                    )}
                  </>
                }
              />
            );
          })}
        </EntryList>
      )}

      {editing && (
        <ComplaintSheet
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
        footer={<><Button onClick={() => setRemoving(null)}>Keep Complaint</Button><Button variant="danger" onClick={() => removing && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">Remove <strong>{removing ? get(removing)?.text : ""}</strong> from this visit?</p>
      </Dialog>
    </Card>
  );
}

function ComplaintSheet({ initial, taken, onClose, onSave }: {
  initial?: Complaint;
  /** Codes of the other active complaints. */
  taken: string[];
  onClose: () => void;
  onSave: (items: Complaint[]) => void;
}) {
  const [mode, setMode] = React.useState<Mode>(initial && !initial.code ? "text" : "codes");
  const [system, setSystem] = React.useState<System>(initial?.system ?? "SNOMED");
  const [codes, setCodes] = React.useState<(CodedTerm & { system: System })[]>(initial?.code ? [{ code: initial.code, text: initial.text, system: initial.system ?? "SNOMED" }] : []);
  const [text, setText] = React.useState(initial && !initial.code ? initial.text : "");
  const list = system === "SNOMED" ? SNOMED_COMPLAINTS : ICD10AM_DIAGNOSES;
  // Only the chosen way of entry is saved, so a code and free text can never be saved together.
  const problem = complaintProblems(mode === "codes" ? codes : [], mode === "text" ? text : "")[0];
  const v = useValidation({
    codes: mode === "codes" && problem ? "Pick at least one code from the list." : undefined,
    text: mode === "text" && problem ? (text.trim() ? problem : "Type the complaint.") : undefined,
  });
  const dirty = mode === "codes" ? codes.map((c) => c.code).join() !== (initial?.code ?? "") : text.trim() !== (initial && !initial.code ? initial.text : "");

  const submit = () => {
    if (!v.submit()) return;
    onSave(mode === "codes" ? codes.map((c) => ({ code: c.code, text: c.text, system: c.system })) : [{ code: "", text: text.trim() }]);
  };

  return (
    <EntrySheet
      onClose={onClose}
      dirty={dirty}
      title={initial ? "Edit Chief Complaint" : "Add Chief Complaint"}
      subtitle="Pick one or more codes, or type the complaint in words."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{initial ? "Update Complaint" : "Save Complaint"}</Button></>}
    >
      <div className="space-y-5">
        <FormField label="How To Record It" group>
          <Segmented value={mode} options={[{ value: "codes", label: "Pick Codes" }, { value: "text", label: "Free Text" }]} onChange={setMode} />
        </FormField>
        {mode === "codes" ? (
          <>
            <FormField label="Code System" group>
              <Segmented value={system} options={[{ value: "SNOMED", label: "SNOMED CT" }, { value: "ICD10AM", label: "ICD-10-AM" }]} onChange={setSystem} />
            </FormField>
            <FormField label="Complaint" required error={v.error("codes")} help={initial ? undefined : "You can pick several. Each one is saved as its own complaint."}>
              <CodeSearch
                label="Search complaint codes"
                placeholder={system === "SNOMED" ? "For example fever or 3866" : "For example cough or R05"}
                items={list}
                exclude={[...taken, ...codes.map((c) => c.code)]}
                autoFocus
                onBlur={v.blur("codes")}
                onPick={(t) => setCodes((x) => [...x, { code: t.code, text: t.text, system }])}
              />
            </FormField>
            {codes.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Selected codes">
                {codes.map((c) => (
                  <li key={c.code} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-primary/40 bg-accent/40 py-1 ps-3 pe-1.5 text-xs">
                    <span className="font-mono font-semibold">{c.code}</span> {c.text}
                    <span className="text-muted-foreground">{c.system === "ICD10AM" ? "ICD-10-AM" : "SNOMED CT"}</span>
                    <button type="button" aria-label={`Remove ${c.text}`} className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setCodes((x) => x.filter((y) => y.code !== c.code))}>
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <FormField label="Complaint" required error={v.error("text")} help={`${text.length} of ${COMPLAINT_MAX} characters`}>
            <TextArea value={text} maxLength={COMPLAINT_MAX} rows={4} autoFocus placeholder="For example: chest pain since this morning" onBlur={v.blur("text")} onChange={(e) => setText(e.target.value)} />
          </FormField>
        )}
      </div>
    </EntrySheet>
  );
}
