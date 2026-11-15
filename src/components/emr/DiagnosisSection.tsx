import * as React from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Card, CardHeader, Empty, Field, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { CodeSearch, Checkbox, ProblemList, fmtWhen } from "@/components/emr/CodeSearch";
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

const KIND_TONE: Record<DxKind, "admit" | "neutral" | "info" | "warn"> = { P: "admit", S: "neutral", AD: "info", DF: "warn" };

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
    setRemoving(null);
  };

  const rows: { d: Dx; i: number; on: boolean }[] = [...active.map((d, i) => ({ d, i, on: true })), ...inactive.map((d, i) => ({ d, i, on: false }))];

  return (
    <Card>
      <CardHeader
        title="Diagnosis"
        tag="DG1"
        subtitle="ICD-10-AM. One Principal diagnosis is mandatory, and only one is allowed."
        right={write && <Button size="sm" variant="primary" onClick={startAdd}><Plus className="size-4" /> Add Diagnosis</Button>}
      />
      {problems.length > 0 && (
        <p role="alert" className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">{problems[0]} Edit a diagnosis and set its type to Principal.</p>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Code</Th><Th>Description</Th><Th>Type</Th><Th>On Admission</Th><Th>Status</Th><Th>Doctor</Th><Th>Date And Time</Th><Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><Td colSpan={8}><Empty>No diagnoses yet. A discharge needs at least one, and the first must be Principal.</Empty></Td></tr>}
          {rows.map(({ d, i, on }) => {
            const kind = on ? dxKind(d, i) : d.kind ?? "S";
            return (
              <tr key={`${on ? "a" : "i"}-${d.code}-${i}`} className={cn(!on && "text-muted-foreground")}>
                <Td className="font-mono text-xs font-semibold">{d.code}</Td>
                <Td className="min-w-48">{d.text}</Td>
                <Td>
                  <Badge tone={on ? KIND_TONE[kind] : "neutral"}>{dxKindLabel(kind)}</Badge>
                  {dev && <div className="mt-1 font-mono text-[0.6875rem] text-muted-foreground">DG1-6 {d.type}</div>}
                </Td>
                <Td>{d.onAdmission ?? d.onset === "2" ? "Yes" : "No"}</Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <Switch checked={on} disabled={!write} label={`${d.code} active`} onChange={(v) => setActive(i, v, d)} />
                    <span className="text-xs">{on ? "Active" : "Inactive"}</span>
                  </span>
                </Td>
                <Td className="whitespace-nowrap">{d.by ?? fallbackBy}</Td>
                <Td className="whitespace-nowrap text-xs">{fmtWhen(d.at)}</Td>
                <Td className="text-right whitespace-nowrap">
                  {write && on && (
                    <>
                      <Button size="sm" variant="ghost" aria-label={`Edit ${d.code}`} title="Edit" onClick={() => startEdit(i)}><Pencil className="size-4" /></Button>
                      <Button
                        size="sm" variant="ghost" aria-label={`Remove ${d.code}`} title="Remove" className="text-destructive"
                        onClick={() => { const b = canRetireDx(active, i); if (b) pushToast({ tone: "warn", text: b }); else setRemoving(i); }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
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
          Sent in DG1. DG1-15 is 1 for the Principal diagnosis. DG1-6: Admitting is A, Differential is W, Principal and Secondary are W while the visit is open and F in the discharge (A03) and the discharge update (A08). On Admission sets ZDG1-3 (2 present on admission, 1 arose during the stay) for inpatients. Inactive diagnoses are not sent.
        </p>
      )}

      {editing && (
        <DxDialog
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
        footer={<><Button onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" onClick={() => removing !== null && remove(removing)}>Remove</Button></>}
      >
        <p className="text-sm">
          Remove <strong>{removing !== null ? `${active[removing]?.code} ${active[removing]?.text}` : ""}</strong> from this visit? Set it to Inactive instead if it was entered correctly but no longer applies.
        </p>
      </Dialog>
    </Card>
  );
}

function DxDialog({ editing, active, inpatient, onClose, onSave }: {
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

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={editing.index === null ? "Add Diagnosis" : "Edit Diagnosis"}
      subtitle="Search the ICD-10-AM list by name or code."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!d.code} onClick={() => setError(onSave(d))}>{editing.index === null ? "Save" : "Update"}</Button></>}
    >
      <div className="space-y-4">
        <Field label="Diagnosis" required>
          {d.code ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-mono text-xs font-semibold">{d.code}</span>
              <span className="min-w-0 flex-1">{d.text}</span>
              <Button size="sm" variant="ghost" aria-label="Change diagnosis" title="Change" onClick={() => set({ code: "", text: "" })}><X className="size-4" /></Button>
            </div>
          ) : (
            <CodeSearch label="Search diagnosis codes" placeholder="Search diagnosis codes, for example pneu or J18" items={ICD10AM_DIAGNOSES} exclude={taken} autoFocus onPick={(t) => set({ code: t.code, text: t.text })} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" required hint={!otherPrincipal ? "This visit has no Principal diagnosis yet, so this one must be Principal." : undefined}>
            <Select value={d.kind} onChange={(e) => set({ kind: e.target.value as DxKind, onAdmission: e.target.value === "AD" ? true : d.onAdmission })}>
              {DX_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
            </Select>
          </Field>
          <div className="sm:pt-7">
            <Checkbox
              checked={d.onAdmission}
              onChange={(v) => set({ onAdmission: v })}
              label="On Admission"
              hint={inpatient ? "The condition was present when the patient was admitted." : "Recorded for the chart. Sent only for inpatients."}
            />
          </div>
        </div>
        {d.kind === "P" && otherPrincipal && (
          <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
            Only one Principal diagnosis is allowed. <strong>{otherPrincipal.code} {otherPrincipal.text}</strong> will become Secondary.
          </p>
        )}
        <ProblemList problems={error ? [error] : []} />
      </div>
    </Dialog>
  );
}
