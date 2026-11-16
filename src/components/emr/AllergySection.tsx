import * as React from "react";
import { Pencil, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";
import { CodeSearch, fmtWhen } from "@/components/emr/CodeSearch";
import {
  ActiveToggle, EmptyState, EntryList, EntryRow, EntrySheet, ErrorSummary, FormField, FormGrid, FormSection, PickedCode, RowMenu, Segmented, TextArea, YesNo, useValidation,
} from "@/components/emr/entry-ui";
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

  const addButton = (size: "sm" | "md") => <Button size={size} variant="primary" onClick={() => setEditing({ draft: toDraft() })}><Plus className="size-4" /> Add Allergy</Button>;

  return (
    <Card>
      <CardHeader
        title="Allergies"
        tag="AL1"
        subtitle="Active allergies show in the red strip at the top of the chart."
        right={write && rows.length > 0 && addButton("sm")}
      />
      {rows.length === 0 ? (
        <EmptyState icon={<ShieldAlert />} title="No Allergies Recorded" action={write && addButton("md")}>
          Ask the patient about medicine, food and other allergies, then record each one here.
        </EmptyState>
      ) : (
        <EntryList label="Allergies">
          {rows.map(({ a, ref }) => {
            const on = ref.list === "active";
            return (
              <EntryRow
                key={`${ref.list}-${ref.index}-${a.text}`}
                title={a.text}
                muted={!on}
                badges={
                  <>
                    <Badge tone="neutral">{categoryOf(a)}</Badge>
                    {a.criticality && <Badge tone={!on ? "neutral" : a.criticality === "High" ? "danger" : a.criticality === "Low" ? "neutral" : "warn"}>{a.criticality === "Unable To Assess" ? "Criticality Not Assessed" : `${a.criticality} Criticality`}</Badge>}
                  </>
                }
                meta={[
                  ["Reactions", reactionSummary(a)],
                  ["Type", a.reactionType ?? "Allergy"],
                  ["Clinical Status", a.clinicalStatus ?? "Active"],
                  ["Verification", a.verification ?? "Not recorded"],
                  ["Source", a.source ?? "Not recorded"],
                  ["Code", a.code ? `SNOMED CT ${a.code}` : "Free text"],
                  ["Recorded", `${a.by ? `${a.by}, ` : ""}${fmtWhen(a.at)}`],
                  dev && ["AL1", <span className="font-mono">AL1-2 {a.type ?? "DALG"}, AL1-4 {a.severity}</span>],
                ]}
                right={
                  <>
                    <ActiveToggle on={on} disabled={!write} label={`${a.text} active`} onChange={(v) => toggle(ref, v)} />
                    {write && (
                      <RowMenu
                        label={`Actions for ${a.text}`}
                        items={[
                          { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => setEditing({ ref, draft: toDraft(a) }) },
                          { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: () => setRemoving(ref) },
                        ]}
                      />
                    )}
                  </>
                }
              >
                {a.notes && <p className="mt-1 text-xs text-muted-foreground">Note: {a.notes}</p>}
              </EntryRow>
            );
          })}
        </EntryList>
      )}
      {dev && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Sent in AL1 for active allergies only. AL1-2 from the category (Medication DALG, Food FALG, others ALG), AL1-3 the SNOMED CT code or the text, AL1-4 the worst reaction severity (anaphylaxis is severe, otherwise the criticality), AL1-5 the manifestations.
        </p>
      )}

      {editing && (
        <AllergySheet
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
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Keep Allergy</Button><Button variant="danger" onClick={() => removing && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">
          Remove <strong>{removing ? get(removing)?.text : ""}</strong> from the chart? If the patient no longer has this allergy, set it to Inactive or change its clinical status instead, so the history is kept.
        </p>
      </Dialog>
    </Card>
  );
}

const seg = (list: readonly string[]) => list.map((x) => ({ value: x, label: x }));

function AllergySheet({ initial, isNew, taken, onClose, onSave }: {
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
  const name = a.text.trim();

  const errors: Record<string, string | false | undefined> = {
    text: mode === "coded" && !a.code
      ? "Pick the allergen from the list, or switch to Text."
      : !name ? "Enter the allergen." : taken.includes(name.toLowerCase()) && `${name} is already recorded as an active allergy.`,
    category: !a.category && "Choose the category.",
    verification: !a.verification && "Choose the verification status.",
    criticality: !a.criticality && "Choose the criticality.",
    source: !a.source && "Choose the source.",
  };
  reactions.forEach((r, i) => { errors[`r${i}`] = !r.manifestations.some((m) => m.trim()) && `Reaction ${i + 1} needs at least one manifestation.`; });
  const v = useValidation(errors);

  const submit = () => {
    if (!v.submit()) return;
    const out = allergyProblems(a);
    if (out.length) { setProblems(out); return; }
    onSave({ ...a, reactions: reactions.map((r) => ({ ...r, manifestations: r.manifestations.map((m) => m.trim()).filter(Boolean) })) });
  };

  return (
    <EntrySheet
      onClose={onClose}
      dirty={JSON.stringify(a) !== JSON.stringify(initial)}
      title={isNew ? "Add Allergy" : "Edit Allergy"}
      subtitle="Fields marked * are required."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{isNew ? "Save Allergy" : "Update Allergy"}</Button></>}
    >
      <div className="space-y-6">
        <ErrorSummary problems={v.summary.length > 1 ? v.summary : problems} />

        <FormSection title="Allergen">
          <FormField label="How To Record It" group>
            <Segmented
              value={mode}
              options={[{ value: "text", label: "Type It" }, { value: "coded", label: "Pick From List" }]}
              onChange={(m) => { setMode(m); if (m === "text") set({ code: undefined }); else set({ code: undefined, text: "" }); }}
            />
          </FormField>
          <FormField label="Allergen" required error={v.error("text")} group={mode === "coded" && !!a.code}>
            {mode === "text" ? (
              <Input value={a.text} placeholder="For example Penicillin" onBlur={v.blur("text")} onChange={(e) => set({ text: e.target.value })} />
            ) : a.code ? (
              <PickedCode code={a.code} text={a.text} changeLabel="Change allergen" onChange={() => set({ code: undefined, text: "" })} />
            ) : (
              <CodeSearch
                label="Search allergies"
                placeholder="For example peni or latex"
                items={ALLERGENS}
                meta={(t) => GROUP_LABEL[t.group]}
                onBlur={v.blur("text")}
                onPick={(t) => set({ code: t.code, text: t.text, category: a.category && !isNew ? a.category : groupCategory(t.group) })}
              />
            )}
          </FormField>
        </FormSection>

        <FormSection title="Details">
          <FormGrid>
            <FormField label="Category" required error={v.error("category")}>
              <Select value={a.category ?? ""} onBlur={v.blur("category")} onChange={(e) => set({ category: e.target.value as Allergy["category"] })}>
                <option value="" disabled>Select Category</option>
                {ALLERGY_CATEGORIES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                {a.category && !ALLERGY_CATEGORIES.some((o) => o.value === a.category) && <option value={a.category}>{a.category}</option>}
              </Select>
            </FormField>
            <FormField label="Type" required group>
              <Segmented value={a.reactionType ?? ""} options={seg(ALLERGY_REACTION_TYPES)} onChange={(x) => set({ reactionType: x as Allergy["reactionType"] })} />
            </FormField>
            <FormField label="Criticality" required group error={v.error("criticality")} className="sm:col-span-2">
              <Segmented value={a.criticality ?? ""} options={seg(ALLERGY_CRITICALITY)} onChange={(x) => set({ criticality: x as Allergy["criticality"] })} />
            </FormField>
            <FormField label="Clinical Status" required group className="sm:col-span-2">
              <Segmented value={a.clinicalStatus ?? ""} options={seg(ALLERGY_CLINICAL_STATUSES)} onChange={(x) => set({ clinicalStatus: x as Allergy["clinicalStatus"] })} />
            </FormField>
            <FormField label="Verification Status" required error={v.error("verification")}>
              <Select value={a.verification ?? ""} onBlur={v.blur("verification")} onChange={(e) => set({ verification: e.target.value as Allergy["verification"] })}>
                <option value="" disabled>Select Verification Status</option>
                {ALLERGY_VERIFICATION.map((o) => <option key={o}>{o}</option>)}
                {a.verification && !((ALLERGY_VERIFICATION as readonly string[]).includes(a.verification)) && <option>{a.verification}</option>}
              </Select>
            </FormField>
            <FormField label="Source" required error={v.error("source")} help="Who told you about it.">
              <Select value={a.source ?? ""} onBlur={v.blur("source")} onChange={(e) => set({ source: e.target.value })}>
                <option value="" disabled>Select Source</option>
                {ALLERGY_SOURCES.map((o) => <option key={o}>{o}</option>)}
                {a.source && !((ALLERGY_SOURCES as readonly string[]).includes(a.source)) && <option>{a.source}</option>}
              </Select>
            </FormField>
          </FormGrid>
          {!isLiveAllergy(a) && a.text && (
            <p role="status" className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">With this status the allergy is saved as Inactive. It is not sent and not shown in the allergy strip.</p>
          )}
        </FormSection>

        <FormSection
          title="Reactions"
          description="What happened when the patient was exposed."
          right={<Button size="sm" onClick={() => set({ reactions: [...reactions, { manifestations: [] }] })}><Plus className="size-4" /> Add Reaction</Button>}
        >
          {reactions.length === 0 && <p className="text-sm text-muted-foreground">No reactions added. Add one if the patient can describe it.</p>}
          {reactions.map((r, i) => (
            <div key={i} className="space-y-4 rounded-xl border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Reaction {i + 1}</span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => set({ reactions: reactions.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              </div>
              <Manifestations value={r.manifestations} error={v.error(`r${i}`)} onChange={(m) => setReaction(i, { manifestations: m })} />
              <FormField label="Severity" group>
                <Segmented value={r.severity ?? ""} options={ALLERGY_SEVERITIES.map((s) => ({ value: s.code, label: s.label }))} onChange={(x) => setReaction(i, { severity: x })} />
              </FormField>
              <FormGrid>
                <FormField label="Exposure Route">
                  <Select value={r.route ?? ""} onChange={(e) => setReaction(i, { route: e.target.value || undefined })}>
                    <option value="">Not Recorded</option>
                    {EXPOSURE_ROUTES.map((s) => <option key={s}>{s}</option>)}
                    {r.route && !((EXPOSURE_ROUTES as readonly string[]).includes(r.route)) && <option>{r.route}</option>}
                  </Select>
                </FormField>
                <FormField label="Outcome">
                  <Select value={r.outcome ?? ""} onChange={(e) => setReaction(i, { outcome: e.target.value || undefined })}>
                    <option value="">Not Recorded</option>
                    {REACTION_OUTCOMES.map((s) => <option key={s}>{s}</option>)}
                    {r.outcome && !((REACTION_OUTCOMES as readonly string[]).includes(r.outcome)) && <option>{r.outcome}</option>}
                  </Select>
                </FormField>
              </FormGrid>
              <FormField label="Anaphylaxis" group help="Yes is sent as a severe reaction.">
                <YesNo value={!!r.anaphylaxis} onChange={(x) => setReaction(i, { anaphylaxis: x })} />
              </FormField>
              <FormField label="Reaction Notes">
                <Input value={r.notes ?? ""} maxLength={500} onChange={(e) => setReaction(i, { notes: e.target.value })} />
              </FormField>
            </div>
          ))}
        </FormSection>

        <FormField label="Notes" help={`${(a.notes ?? "").length} of 1000 characters`}>
          <TextArea value={a.notes ?? ""} maxLength={1000} rows={2} onChange={(e) => set({ notes: e.target.value })} />
        </FormField>
      </div>
    </EntrySheet>
  );
}

/** Manifestations of one reaction, typed one at a time and shown as removable chips. Leaving the box adds what was typed. */
function Manifestations({ value, error, onChange }: { value: string[]; error?: string; onChange: (v: string[]) => void }) {
  const [t, setT] = React.useState("");
  const add = () => {
    const s = t.trim();
    if (s && !value.some((x) => x.toLowerCase() === s.toLowerCase())) onChange([...value, s]);
    setT("");
  };
  return (
    <FormField label="Manifestations" required group error={error} help="Type one and press Enter. For example Rash, Hives.">
      <div className="flex gap-2">
        <Input value={t} placeholder="For example Rash" aria-label="Manifestation" aria-invalid={error ? true : undefined} onChange={(e) => setT(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button className="h-10" disabled={!t.trim()} onClick={add}>Add</Button>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Manifestations added">
          {value.map((m) => (
            <li key={m} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-primary/40 bg-accent/40 py-0.5 ps-2.5 pe-1 text-xs">
              {m}
              <button type="button" aria-label={`Remove ${m}`} className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onChange(value.filter((x) => x !== m))}>
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FormField>
  );
}
