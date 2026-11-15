import * as React from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, RequiredNote, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { CodeSearch, Checkbox, ProblemList, RadioRow, fmtWhen } from "@/components/emr/CodeSearch";
import { audit } from "@/lib/audit";
import { allergyProblems, categoryOf, groupCategory, isLiveAllergy, placeAllergy } from "@/lib/chart-entries";
import { useDevMode } from "@/lib/devmode";
import type { Allergy, AllergyReaction, Encounter } from "@/lib/model";
import {
  ALLERGENS, ALLERGY_CATEGORIES, ALLERGY_CLINICAL_STATUSES, ALLERGY_CRITICALITY, ALLERGY_REACTION_TYPES, ALLERGY_SEVERITIES, ALLERGY_SOURCES,
  ALLERGY_VERIFICATION, EXPOSURE_ROUTES, REACTION_OUTCOMES,
} from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import { nowLocal, updateEncounter } from "@/lib/store";
import { pushToast } from "@/lib/toast";

const SEV = { SV: "Severe", MO: "Moderate", MI: "Mild" } as const;
const GROUP_LABEL = { drug: "Drug", food: "Food", substance: "Substance" } as const;
type Ref = { list: "active" | "inactive"; index: number };

/** What the edit form starts from. Older records have only text, severity and reaction. */
function toDraft(a?: Allergy): Allergy {
  if (!a) return { text: "", severity: "MI", reaction: "", reactionType: "Allergy", clinicalStatus: "Active", reactions: [] };
  const legacy = !a.reactions && !!a.reaction;
  return {
    ...a,
    category: categoryOf(a),
    reactionType: a.reactionType ?? "Allergy",
    clinicalStatus: a.clinicalStatus ?? (a.active === false ? "Inactive" : "Active"),
    reactions: a.reactions ?? (legacy ? [{ manifestations: a.reaction.split(/,\s*/).filter(Boolean), severity: a.severity }] : []),
  };
}

const reactionSummary = (a: Allergy): string => {
  if (a.reactions?.length) {
    return a.reactions.map((r) => {
      const parts = [r.manifestations.join(", "), r.severity && SEV[r.severity], r.anaphylaxis && "anaphylaxis", r.route].filter(Boolean);
      return parts.join(", ");
    }).join("; ");
  }
  return a.reaction ? `${a.reaction}, ${SEV[a.severity].toLowerCase()}` : "None recorded";
};

/** Allergy list of the visit, as in the HIS: text or coded entry, statuses, reactions, Active or Inactive, Edit. */
export function AllergySection({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  const { user } = useSession();
  const write = can("emr.write");
  const inactive = enc.allergiesInactive ?? [];
  const [editing, setEditing] = React.useState<{ ref?: Ref; draft: Allergy } | null>(null);
  const [removing, setRemoving] = React.useState<Ref | null>(null);
  const rows: { a: Allergy; ref: Ref }[] = [
    ...enc.allergies.map((a, index) => ({ a, ref: { list: "active" as const, index } })),
    ...inactive.map((a, index) => ({ a, ref: { list: "inactive" as const, index } })),
  ];
  const get = (r: Ref) => (r.list === "active" ? enc.allergies : inactive)[r.index];

  const save = (draft: Allergy, ref?: Ref) => {
    const next = placeAllergy(enc.allergies, inactive, { ...draft, at: draft.at ?? nowLocal(), by: user.name }, ref);
    updateEncounter(enc.visitNumber, (e) => { e.allergies = next.allergies; e.allergiesInactive = next.allergiesInactive; });
    audit(ref ? "update" : "create", `Chart ${enc.visitNumber}`, { detail: `Allergy ${draft.text}` });
    const live = next.allergies.some((x) => x.text === draft.text.trim());
    pushToast({ tone: "ok", text: ref ? `Allergy ${draft.text} updated.` : `Allergy ${draft.text} added.`, detail: live ? undefined : "It is not active, so it is not shown in the allergy strip." });
  };

  const toggle = (ref: Ref, on: boolean) => {
    const a = get(ref);
    if (on && (a.verification === "Refuted" || a.verification === "Entered In Error")) {
      pushToast({ tone: "warn", text: `This allergy is marked ${a.verification}. Edit it and change the verification status first.` });
      return;
    }
    const changed: Allergy = on
      ? { ...a, active: true, clinicalStatus: a.clinicalStatus && a.clinicalStatus !== "Active" ? "Active" : a.clinicalStatus }
      : { ...a, active: false };
    const next = placeAllergy(enc.allergies, inactive, changed, ref);
    updateEncounter(enc.visitNumber, (e) => { e.allergies = next.allergies; e.allergiesInactive = next.allergiesInactive; });
    audit("update", `Chart ${enc.visitNumber}`, { detail: `Allergy ${a.text} set to ${on ? "Active" : "Inactive"}` });
  };

  const remove = (ref: Ref) => {
    const a = get(ref);
    updateEncounter(enc.visitNumber, (e) => {
      if (ref.list === "active") e.allergies = enc.allergies.filter((_, i) => i !== ref.index);
      else e.allergiesInactive = inactive.filter((_, i) => i !== ref.index);
    });
    audit("delete", `Chart ${enc.visitNumber}`, { detail: `Allergy ${a?.text} removed` });
    setRemoving(null);
  };

  return (
    <Card>
      <CardHeader
        title="Allergies"
        tag="AL1"
        subtitle="Active allergies show in the red strip at the top of the chart."
        right={write && <Button size="sm" variant="primary" onClick={() => setEditing({ draft: toDraft() })}><Plus className="size-4" /> Add Allergy</Button>}
      />
      <Table>
        <thead>
          <tr>
            <Th>Allergen</Th><Th>Category</Th><Th>Type</Th><Th>Criticality</Th><Th>Clinical Status</Th><Th>Verification</Th><Th>Reactions</Th><Th>Source</Th><Th>Status</Th><Th>Recorded</Th><Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={11}><Empty>No allergies recorded.</Empty></Td></tr>}
          {rows.map(({ a, ref }) => {
            const on = ref.list === "active";
            return (
              <tr key={`${ref.list}-${ref.index}-${a.text}`} className={cn(!on && "text-muted-foreground")}>
                <Td className="min-w-36">
                  <div className="font-medium">{a.text}</div>
                  <div className="text-xs text-muted-foreground">{a.code ? `SNOMED CT ${a.code}` : "Free text"}</div>
                  {a.notes && <div className="mt-0.5 text-xs text-muted-foreground">{a.notes}</div>}
                </Td>
                <Td>{categoryOf(a)}</Td>
                <Td>{a.reactionType ?? "Allergy"}</Td>
                <Td>{a.criticality ? <Badge tone={a.criticality === "High" ? "danger" : a.criticality === "Low" ? "neutral" : "warn"}>{a.criticality}</Badge> : "Not recorded"}</Td>
                <Td>{a.clinicalStatus ?? "Active"}</Td>
                <Td>{a.verification ?? "Not recorded"}</Td>
                <Td className="min-w-44 text-xs">
                  {reactionSummary(a)}
                  {dev && <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">AL1-2 {a.type ?? "DALG"}, AL1-4 {a.severity}</div>}
                </Td>
                <Td>{a.source ?? "Not recorded"}</Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Switch checked={on} disabled={!write} label={`${a.text} active`} onChange={(v) => toggle(ref, v)} />
                    <span className="text-xs">{on ? "Active" : "Inactive"}</span>
                  </span>
                </Td>
                <Td className="whitespace-nowrap text-xs">{a.by ? <>{a.by}<br /></> : null}{fmtWhen(a.at)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {write && (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`Edit ${a.text}`} title="Edit" onClick={() => setEditing({ ref, draft: toDraft(a) })}><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${a.text}`} title="Remove" className="text-destructive" onClick={() => setRemoving(ref)}><Trash2 className="size-4" /></Button>
                    </>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {dev && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Sent in AL1 for active allergies only. AL1-2 from the category (Medication DALG, Food FALG, others ALG), AL1-3 the SNOMED CT code or the text, AL1-4 the worst reaction severity (anaphylaxis is severe, otherwise the criticality), AL1-5 the manifestations.
        </p>
      )}

      {editing && (
        <AllergyDialog
          initial={editing.draft}
          isNew={!editing.ref}
          taken={enc.allergies.filter((_, i) => !(editing.ref?.list === "active" && editing.ref.index === i)).map((x) => x.text.toLowerCase())}
          onClose={() => setEditing(null)}
          onSave={(d) => { save(d, editing.ref); setEditing(null); }}
        />
      )}
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove Allergy"
        footer={<><Button onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={() => removing && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">
          Remove <strong>{removing ? get(removing)?.text : ""}</strong> from the chart? If the patient no longer has this allergy, set it to Inactive or change its clinical status instead, so the history is kept.
        </p>
      </Dialog>
    </Card>
  );
}

function AllergyDialog({ initial, isNew, taken, onClose, onSave }: {
  initial: Allergy;
  isNew: boolean;
  /** Lower-case names of the other active allergies. */
  taken: string[];
  onClose: () => void;
  onSave: (a: Allergy) => void;
}) {
  const [a, setA] = React.useState<Allergy>(initial);
  const [mode, setMode] = React.useState<"text" | "coded">(initial.code ? "coded" : "text");
  const [problems, setProblems] = React.useState<string[]>([]);
  const set = (p: Partial<Allergy>) => { setA((x) => ({ ...x, ...p })); setProblems([]); };
  const reactions = a.reactions ?? [];
  const setReaction = (i: number, p: Partial<AllergyReaction>) => set({ reactions: reactions.map((r, j) => (j === i ? { ...r, ...p } : r)) });

  const submit = () => {
    const out = allergyProblems(a);
    if (mode === "coded" && !a.code) out.unshift("Pick the allergen from the list, or switch to Text.");
    if (a.text.trim() && taken.includes(a.text.trim().toLowerCase())) out.unshift(`${a.text.trim()} is already recorded as an active allergy.`);
    if (out.length) { setProblems(out); return; }
    onSave({ ...a, reactions: reactions.map((r) => ({ ...r, manifestations: r.manifestations.map((m) => m.trim()).filter(Boolean) })) });
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={isNew ? "Add Allergy Record" : "Update Allergy Record"}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{isNew ? "Save Record" : "Update Record"}</Button></>}
    >
      <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
        <RequiredNote />
        <RadioRow
          name="allergy-entry"
          label="Entry Method"
          value={mode}
          options={[{ value: "text", label: "Text" }, { value: "coded", label: "Select From List" }]}
          onChange={(m) => { setMode(m); if (m === "text") set({ code: undefined }); else set({ code: undefined, text: "" }); }}
        />
        <Field label="Allergen" required>
          {mode === "text" ? (
            <Input value={a.text} placeholder="For example Penicillin" onChange={(e) => set({ text: e.target.value })} />
          ) : a.code ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-mono text-xs font-semibold">{a.code}</span>
              <span className="min-w-0 flex-1">{a.text}</span>
              <Button size="sm" variant="ghost" aria-label="Change allergen" title="Change" onClick={() => set({ code: undefined, text: "" })}><X className="size-4" /></Button>
            </div>
          ) : (
            <CodeSearch
              label="Search allergies"
              placeholder="Search allergies, for example peni or latex"
              items={ALLERGENS}
              meta={(t) => GROUP_LABEL[t.group]}
              onPick={(t) => set({ code: t.code, text: t.text, category: a.category && !isNew ? a.category : groupCategory(t.group) })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Pick label="Category" value={a.category} options={ALLERGY_CATEGORIES} onChange={(v) => set({ category: v as Allergy["category"] })} />
          <Pick label="Type" value={a.reactionType} options={ALLERGY_REACTION_TYPES} onChange={(v) => set({ reactionType: v as Allergy["reactionType"] })} />
          <Pick label="Clinical Status" value={a.clinicalStatus} options={ALLERGY_CLINICAL_STATUSES} onChange={(v) => set({ clinicalStatus: v as Allergy["clinicalStatus"] })} />
          <Pick label="Verification Status" value={a.verification} options={ALLERGY_VERIFICATION} onChange={(v) => set({ verification: v as Allergy["verification"] })} />
          <Pick label="Criticality" value={a.criticality} options={ALLERGY_CRITICALITY} onChange={(v) => set({ criticality: v as Allergy["criticality"] })} />
          <Pick label="Source" value={a.source} options={ALLERGY_SOURCES} onChange={(v) => set({ source: v })} />
        </div>

        <fieldset className="space-y-3">
          <legend className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
            Reactions
          </legend>
          {reactions.length === 0 && <p className="text-sm text-muted-foreground">No reactions added.</p>}
          {reactions.map((r, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Reaction {i + 1}</span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => set({ reactions: reactions.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              </div>
              <Manifestations value={r.manifestations} onChange={(m) => setReaction(i, { manifestations: m })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Severity">
                  <Select value={r.severity ?? ""} onChange={(e) => setReaction(i, { severity: (e.target.value || undefined) as AllergyReaction["severity"] })}>
                    <option value="">Select Severity</option>
                    {ALLERGY_SEVERITIES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
                  </Select>
                </Field>
                <Field label="Exposure Route">
                  <Select value={r.route ?? ""} onChange={(e) => setReaction(i, { route: e.target.value || undefined })}>
                    <option value="">Select Route</option>
                    {EXPOSURE_ROUTES.map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
                <Field label="Outcome">
                  <Select value={r.outcome ?? ""} onChange={(e) => setReaction(i, { outcome: e.target.value || undefined })}>
                    <option value="">Select Outcome</option>
                    {REACTION_OUTCOMES.map((s) => <option key={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
              <Checkbox checked={!!r.anaphylaxis} onChange={(v) => setReaction(i, { anaphylaxis: v })} label="Anaphylaxis" hint="Sent as a severe reaction." />
              <Field label="Reaction Notes">
                <Input value={r.notes ?? ""} maxLength={500} onChange={(e) => setReaction(i, { notes: e.target.value })} />
              </Field>
            </div>
          ))}
          <Button size="sm" onClick={() => set({ reactions: [...reactions, { manifestations: [] }] })}><Plus className="size-4" /> Add Reaction</Button>
        </fieldset>

        <Field label="Notes">
          <textarea
            value={a.notes ?? ""}
            maxLength={1000}
            rows={2}
            onChange={(e) => set({ notes: e.target.value })}
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Field>
        {!isLiveAllergy(a) && a.text && <p className="text-sm text-muted-foreground">With this status the allergy is saved as Inactive and is not sent or shown in the allergy strip.</p>}
        <ProblemList problems={problems} />
      </div>
    </Dialog>
  );
}

function Pick({ label, value, options, onChange }: { label: string; value?: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label} required>
      <Select value={value ?? ""} aria-invalid={!value || undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Select {label}</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </Select>
    </Field>
  );
}

/** Manifestations of one reaction, typed one at a time and shown as removable chips. */
function Manifestations({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = React.useState("");
  const add = () => {
    const s = t.trim();
    if (s && !value.some((x) => x.toLowerCase() === s.toLowerCase())) onChange([...value, s]);
    setT("");
  };
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">Manifestations <span aria-hidden="true" className="font-semibold text-destructive">*</span></div>
      <div className="flex gap-2">
        <Input value={t} placeholder="For example Rash, Hives" aria-label="Manifestation" onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button disabled={!t.trim()} onClick={add}>Add</Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {value.length === 0 && <span className="text-xs text-muted-foreground">No manifestations added.</span>}
        {value.map((m) => (
          <span key={m} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs">
            {m}
            <button type="button" aria-label={`Remove ${m}`} className="rounded text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onChange(value.filter((x) => x !== m))}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
