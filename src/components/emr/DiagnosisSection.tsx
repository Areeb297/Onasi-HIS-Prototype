import * as React from "react";
import { Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Select } from "@/components/ui/primitives";
import { CodeSearch, fmtWhen } from "@/components/emr/CodeSearch";
import { ActiveToggle, EmptyState, EntryList, EntryRow, EntrySheet, ErrorSummary, FormField, PickedCode, RowMenu, YesNo, useValidation } from "@/components/emr/entry-ui";
import { audit } from "@/lib/audit";
import {
  DX_KINDS, canRetireDx, dxKind, dxKindLabel, dxListProblems, normalizeDx, reactivateDx, saveDx, type DxDraft, type DxKind,
} from "@/lib/chart-entries";
import { useDevMode } from "@/lib/devmode";
import type { Dx, Encounter } from "@/lib/model";
import { DOCTORS, ICD10AM_DIAGNOSES } from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import { nowLocal, updateEncounter } from "@/lib/store";
import { pushToast } from "@/lib/toast";

const KIND_TONE: Record<DxKind, "admit" | "neutral" | "info" | "warn" | "ok"> = { P: "admit", S: "neutral", WK: "neutral", AD: "info", FN: "ok", DF: "warn", DC: "ok" };

type Editing = { index: number | null; draft: DxDraft };

/** Diagnosis list of the visit, as in the HIS: search, Principal rules, On Admission, Active or Inactive, Edit. */
export function DiagnosisSection({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  const { user } = useSession();
  const write = can("emr.write");
  const active = normalizeDx(enc.dx);
  const inactive = enc.dxInactive ?? [];
  const problems = dxListProblems(enc.dx);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [removing, setRemoving] = React.useState<number | null>(null);
  const discharged = enc.status === "discharged";
  const inpatient = enc.cls === "I";
  const attending = DOCTORS.find((d) => d.id === enc.attending);
  const fallbackBy = attending ? `Dr. ${attending.given} ${attending.family}` : "Not recorded";

  const startAdd = () => {
    const hasP = active.some((d) => d.kind === "P");
    setEditing({ index: null, draft: { code: "", text: "", kind: hasP ? "S" : "P", onAdmission: false } });
  };
  const startEdit = (i: number) => {
    const d = active[i];
    setEditing({ index: i, draft: { code: d.code, text: d.text, kind: dxKind(d, i), onAdmission: d.onAdmission ?? d.onset === "2" } });
  };

  const setActive = (i: number, on: boolean, d: Dx) => {
    if (!on) {
      const block = canRetireDx(active, i);
      if (block) { pushToast({ tone: "warn", text: block }); return; }
      updateEncounter(enc.visitNumber, (e) => {
        e.dx = normalizeDx(active.filter((_, j) => j !== i));
        e.dxInactive = [...inactive, d];
      });
      audit("update", `Chart ${enc.visitNumber}`, { detail: `Diagnosis ${d.code} set to Inactive` });
      return;
    }
    const j = inactive.indexOf(d);
    const r = reactivateDx(active, d, discharged);
    if (r.error) { pushToast({ tone: "warn", text: r.error }); return; }
    updateEncounter(enc.visitNumber, (e) => {
      e.dx = r.list;
      e.dxInactive = inactive.filter((_, k) => k !== j);
    });
    audit("update", `Chart ${enc.visitNumber}`, { detail: `Diagnosis ${d.code} set to Active` });
  };

  const remove = (i: number) => {
    const d = active[i];
    updateEncounter(enc.visitNumber, (e) => { e.dx = normalizeDx(active.filter((_, j) => j !== i)); });
    audit("delete", `Chart ${enc.visitNumber}`, { detail: `Diagnosis ${d.code} removed` });
    pushToast({ tone: "ok", text: `Diagnosis ${d.code} removed.` });
    setRemoving(null);
  };
  const askRemove = (i: number) => {
    const b = canRetireDx(active, i);
    if (b) pushToast({ tone: "warn", text: b });
    else setRemoving(i);
  };

  const rows: { d: Dx; i: number; on: boolean }[] = [...active.map((d, i) => ({ d, i, on: true })), ...inactive.map((d, i) => ({ d, i, on: false }))];

  return (
    <Card>
      <CardHeader
        title="Diagnosis"
        tag="DG1"
        subtitle="ICD-10-AM. Each visit needs one Principal diagnosis, and only one."
        right={write && rows.length > 0 && <Button size="sm" variant="primary" onClick={startAdd}><Plus className="size-4" /> Add Diagnosis</Button>}
      />
      {problems.length > 0 && rows.length > 0 && (
        <p role="alert" className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">{problems[0]} Edit a diagnosis and set its type to Principal.</p>
      )}
      {rows.length === 0 ? (
        <EmptyState
          icon={<Stethoscope />}
          title="No Diagnosis Yet"
          action={write && <Button variant="primary" onClick={startAdd}><Plus className="size-4" /> Add Diagnosis</Button>}
        >
          A discharge needs at least one diagnosis. The first one is saved as Principal.
        </EmptyState>
      ) : (
        <EntryList label="Diagnoses">
          {rows.map(({ d, i, on }) => {
            const kind = on ? dxKind(d, i) : d.kind ?? "S";
            return (
              <EntryRow
                key={`${on ? "a" : "i"}-${d.code}-${i}`}
                code={d.code}
                title={d.text}
                muted={!on}
                badges={<Badge tone={on ? KIND_TONE[kind] : "neutral"}>{dxKindLabel(kind)}</Badge>}
                meta={[
                  ["On Admission", d.onAdmission ?? d.onset === "2" ? "Yes" : "No"],
                  ["Doctor", d.by ?? fallbackBy],
                  ["Recorded", fmtWhen(d.at)],
                  dev && ["DG1-6", <span className="font-mono">{d.type}</span>],
                ]}
                right={
                  <>
                    <ActiveToggle on={on} disabled={!write} label={`${d.code} active`} onChange={(v) => setActive(i, v, d)} />
                    {write && on && (
                      <RowMenu
                        label={`Actions for ${d.code}`}
                        items={[
                          { label: "Edit", icon: <Pencil className="size-4" />, onSelect: () => startEdit(i) },
                          { label: "Remove", icon: <Trash2 className="size-4" />, danger: true, separated: true, onSelect: () => askRemove(i) },
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
      {dev && (
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Sent in DG1. DG1-15 is 1 for the Principal diagnosis. DG1-6: Admitting is A, Working and Differential are W, Final and Discharge are F, Principal and Secondary are W while the visit is open and F in the discharge (A03) and the discharge update (A08). On Admission sets ZDG1-3 (2 present on admission, 1 arose during the stay) for inpatients. Inactive diagnoses are not sent.
        </p>
      )}

      {editing && (
        <DxSheet
          editing={editing}
          active={active}
          onClose={() => setEditing(null)}
          onSave={(draft) => {
            const r = saveDx(enc.dx, draft, editing.index, { discharged, inpatient, by: user.name, at: nowLocal() });
            if (r.error) return r.error;
            updateEncounter(enc.visitNumber, (e) => { e.dx = r.list; });
            audit(editing.index === null ? "create" : "update", `Chart ${enc.visitNumber}`, { detail: `Diagnosis ${draft.code} (${dxKindLabel(draft.kind)})` });
            pushToast({ tone: "ok", text: editing.index === null ? `Diagnosis ${draft.code} added.` : `Diagnosis ${draft.code} updated.`, detail: r.demoted ? `${r.demoted} is now Secondary.` : undefined });
            setEditing(null);
            return null;
          }}
          inpatient={inpatient}
        />
      )}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove Diagnosis"
        footer={<><Button variant="ghost" onClick={() => setRemoving(null)}>Keep Diagnosis</Button><Button variant="danger" onClick={() => removing !== null && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">
          Remove <strong>{removing !== null ? `${active[removing]?.code} ${active[removing]?.text}` : ""}</strong> from this visit? Set it to Inactive instead if it was entered correctly but no longer applies.
        </p>
      </Dialog>
    </Card>
  );
}

function DxSheet({ editing, active, inpatient, onClose, onSave }: {
  editing: Editing;
  active: Dx[];
  inpatient: boolean;
  onClose: () => void;
  /** Returns the problem in words, or null when saved. */
  onSave: (d: DxDraft) => string | null;
}) {
  const [d, setD] = React.useState<DxDraft>(editing.draft);
  const [error, setError] = React.useState<string | null>(null);
  const others = active.filter((_, i) => i !== editing.index);
  const otherPrincipal = others.find((x) => x.kind === "P");
  const taken = others.map((x) => x.code);
  const set = (p: Partial<DxDraft>) => { setD((x) => ({ ...x, ...p })); setError(null); };
  const v = useValidation({ code: !d.code && "Pick a diagnosis from the list." });
  const isNew = editing.index === null;
  const dirty = JSON.stringify(d) !== JSON.stringify(editing.draft);
  const submit = () => { if (v.submit()) setError(onSave(d)); };

  return (
    <EntrySheet
      onClose={onClose}
      dirty={dirty}
      title={isNew ? "Add Diagnosis" : "Edit Diagnosis"}
      subtitle="Search the ICD-10-AM list by name or code."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>{isNew ? "Save Diagnosis" : "Update Diagnosis"}</Button></>}
    >
      <div className="space-y-5">
        <ErrorSummary problems={error ? [error] : []} />
        <FormField label="Diagnosis" required error={v.error("code")} group={!!d.code}>
          {d.code ? (
            <PickedCode code={d.code} text={d.text} changeLabel="Change diagnosis" onChange={() => set({ code: "", text: "" })} />
          ) : (
            <CodeSearch label="Search diagnosis codes" placeholder="For example pneu or J18" items={ICD10AM_DIAGNOSES} exclude={taken} autoFocus onBlur={v.blur("code")} onPick={(t) => set({ code: t.code, text: t.text })} />
          )}
        </FormField>
        <FormField label="Type" required help={!otherPrincipal ? "This visit has no Principal diagnosis yet, so this one must be Principal." : undefined}>
          <Select value={d.kind} onChange={(e) => { const k = e.target.value as DxKind; set({ kind: k, onAdmission: k === "AD" ? true : d.onAdmission }); }}>
            {DX_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
          </Select>
        </FormField>
        {d.kind === "P" && otherPrincipal && (
          <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            Only one Principal diagnosis is allowed. <strong>{otherPrincipal.code} {otherPrincipal.text}</strong> will become Secondary.
          </p>
        )}
        <FormField label="On Admission" group help={inpatient ? "Yes when the condition was present when the patient was admitted." : "Recorded for the chart. Sent only for inpatients."}>
          <YesNo value={d.onAdmission} onChange={(x) => set({ onAdmission: x })} />
        </FormField>
      </div>
    </EntrySheet>
  );
}
