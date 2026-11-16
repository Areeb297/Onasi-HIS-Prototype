import * as React from "react";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Badge, Button, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import {
  INSURERS, PAYER_TYPES, PLANS, RELATIONSHIPS, TPAS, coverageProblems, coveragesOf, markCoverageInactive, primaryCoverage, saveCoverage, sortCoverages, useCoverages,
  type Coverage, type CoverageInput, type PayerType,
} from "@/lib/coverage";
import { listName } from "@/lib/registration";
import { can, hasGlass, useSession } from "@/lib/session";
import { nowLocal, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { EligibilityBadge } from "./EligibilityDialog";
import { ActionIcon } from "@/components/ui/action-icons";

const blank = (priority: number): CoverageInput => {
  const today = nowLocal().slice(0, 10);
  return {
    priority, payerType: "Insurance", insurer: "", tpa: "None", plan: "", memberId: "", policyNo: "", network: "", relationship: "Self", subscriberId: "",
    copayPercent: 0, coinsurancePercent: 0, startDate: today, endDate: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`, offlineApproval: false, approvalNo: "",
  };
};

const toInput = (c: Coverage): CoverageInput => {
  const { id: _id, patientId: _p, eligibility: _e, answer: _a, ...rest } = c;
  return rest;
};

/** Patient Coverage: the policies a patient holds, in priority order. Add, change or mark a coverage inactive. */
export function CoverageDialog({ patientId, onClose }: { patientId: string | null; onClose: () => void }) {
  const state = useHis();
  const store = useCoverages();
  useSession();
  const [editing, setEditing] = React.useState<{ id?: string; form: CoverageInput } | null>(null);
  const [tried, setTried] = React.useState(false);
  const [confirmInactive, setConfirmInactive] = React.useState<Coverage | null>(null);

  React.useEffect(() => { setEditing(null); setTried(false); setConfirmInactive(null); }, [patientId]);

  const patient = state.patients.find((p) => p.id === patientId);
  if (!patientId || !patient) return null;
  const list = sortCoverages(coveragesOf(patientId, store, state.patients));
  const allowed = can("patient.register");
  const name = listName(patient, hasGlass(patient.id));

  const primary = primaryCoverage(list, nowLocal().slice(0, 10));
  const nextPriority = Math.max(0, ...list.filter((c) => c.active).map((c) => c.priority)) + 1;
  const others = editing ? list.filter((c) => c.id !== editing.id) : [];
  const problems = editing ? coverageProblems(editing.form, others) : [];
  const set = <K extends keyof CoverageInput>(k: K, v: CoverageInput[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  function save() {
    if (!editing) return;
    setTried(true);
    const r = saveCoverage(patientId!, editing.form, editing.id);
    if (!r.ok) return;
    audit(editing.id ? "update" : "create", `Patient coverage ${patient!.mrn}`, {
      patient: name, detail: `${r.value.insurer || r.value.tpa} ${r.value.memberId}, priority ${r.value.priority}`,
    });
    pushToast({ tone: "ok", text: editing.id ? "Coverage saved." : "Coverage added.", detail: `${r.value.insurer || r.value.tpa}, priority ${r.value.priority}.` });
    setEditing(null); setTried(false);
  }

  function inactive(c: Coverage) {
    if (markCoverageInactive(patientId!, c.id)) {
      audit("update", `Patient coverage ${patient!.mrn}`, { patient: name, detail: `${c.insurer || c.tpa} ${c.memberId} marked inactive` });
      pushToast({ tone: "ok", text: "Coverage marked inactive." });
    }
    setConfirmInactive(null);
  }

  const f = editing?.form;
  return (
    <Dialog open onClose={onClose} wide title="Patient Coverage" subtitle={`${name}, ${patient.mrn}. Priority 1 is the primary coverage that the registration check uses.`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Patient Coverages</h3>
        {!editing && (
          <Button size="sm" variant="primary" disabled={!allowed} onClick={() => { setEditing({ form: blank(nextPriority) }); setTried(false); }}>
            <Plus className="size-4" />Add New Coverage
          </Button>
        )}
      </div>
      {!allowed && <p className="mt-1 text-xs text-muted-foreground">Your role can see coverages but not change them.</p>}

      <Table className="mt-3 rounded-lg border border-border">
        <thead>
          <tr><Th>Priority</Th><Th>Payer</Th><Th>Member Number</Th><Th>Relationship</Th><Th>Eligibility</Th><Th>Co-Pay / Co-Ins</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr>
        </thead>
        <tbody>
          {list.length === 0 && <tr><Td colSpan={8} className="py-6 text-center text-sm text-muted-foreground">No coverages. The patient pays cash.</Td></tr>}
          {list.map((c) => (
            <tr key={c.id} className={cn(!c.active && "opacity-60")}>
              <Td className="tabular-nums">{c.priority}{c.id === primary?.id && <span className="ms-1.5 text-xs text-muted-foreground">Primary</span>}</Td>
              <Td><div className="font-medium">{c.insurer || c.tpa}</div><div className="text-xs text-muted-foreground">{[c.payerType, c.tpa !== "None" && c.insurer ? c.tpa : "", c.plan].filter(Boolean).join(", ")}</div></Td>
              <Td className="font-mono text-xs">{c.memberId}</Td>
              <Td>{c.relationship}</Td>
              <Td><EligibilityBadge answer={c.eligibility} /></Td>
              <Td className="tabular-nums">{c.copayPercent}% / {c.coinsurancePercent}%</Td>
              <Td><Badge tone={c.active ? "ok" : "neutral"}>{c.active ? "Active" : "Inactive"}</Badge></Td>
              <Td className="text-right">
                {c.active && (
                  <span className="inline-flex gap-1.5">
                    <ActionIcon kind="edit" name={`coverage ${c.memberId}`} disabled={!allowed} onClick={() => { setEditing({ id: c.id, form: toInput(c) }); setTried(false); }} />
                    <Button size="sm" variant="danger" disabled={!allowed} onClick={() => setConfirmInactive(c)}>Mark Inactive</Button>
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {confirmInactive && (
        <div role="alertdialog" aria-label="Confirm mark inactive" className="mt-3 rounded-lg border border-warn/50 bg-warn/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><TriangleAlert className="size-4 shrink-0" />Mark the {confirmInactive.insurer || confirmInactive.tpa} coverage inactive?</p>
          <p className="mt-1">It stays on file but is no longer used for the coverage check or for new visits.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="danger" onClick={() => inactive(confirmInactive)}>Mark Inactive</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmInactive(null)}>Keep It Active</Button>
          </div>
        </div>
      )}

      {f && (
        <form className="mt-4 rounded-lg border border-border p-4" onSubmit={(e) => { e.preventDefault(); save(); }} aria-label={editing?.id ? "Edit coverage" : "New coverage"}>
          <h3 className="mb-3 text-sm font-semibold">{editing?.id ? "Edit Coverage" : "New Coverage"}</h3>
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <Field label="Coverage Priority" required hint="1 is the primary coverage.">
              <Input type="number" min={1} step={1} value={Number.isFinite(f.priority) ? f.priority : ""} onChange={(e) => set("priority", e.target.value === "" ? NaN : Number(e.target.value))} />
            </Field>
            <Field label="Payer Type" required>
              <Select value={f.payerType} onChange={(e) => set("payerType", e.target.value as PayerType)}>{PAYER_TYPES.map((x) => <option key={x}>{x}</option>)}</Select>
            </Field>
            <Field label="Insurance" required={f.payerType === "Insurance"}>
              <Select value={f.insurer} onChange={(e) => set("insurer", e.target.value)}>
                <option value="">Select Insurance</option>
                {!INSURERS.includes(f.insurer) && f.insurer && <option>{f.insurer}</option>}
                {INSURERS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="TPA / Group">
              <Select value={f.tpa} onChange={(e) => set("tpa", e.target.value)}>{TPAS.map((x) => <option key={x}>{x}</option>)}</Select>
            </Field>
            <Field label="Class / Plan">
              <Select value={f.plan} onChange={(e) => set("plan", e.target.value)}>
                <option value="">Select Insurance Class</option>
                {!PLANS.includes(f.plan) && f.plan && <option>{f.plan}</option>}
                {PLANS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="Member Number" required><Input className="font-mono" value={f.memberId} onChange={(e) => set("memberId", e.target.value)} dir="ltr" /></Field>
            <Field label="Relationship To Subscriber" required>
              <Select value={f.relationship} onChange={(e) => set("relationship", e.target.value)}>{RELATIONSHIPS.map((x) => <option key={x}>{x}</option>)}</Select>
            </Field>
            <Field label="Subscriber National ID" required={f.relationship !== "Self"} hint={f.relationship === "Self" ? "Not needed when the patient is the subscriber." : undefined}>
              <Input className="font-mono" inputMode="numeric" value={f.subscriberId} onChange={(e) => set("subscriberId", e.target.value.replace(/\D/g, "").slice(0, 10))} dir="ltr" />
            </Field>
            <Field label="Co-Pay %"><Input type="number" min={0} max={100} value={Number.isFinite(f.copayPercent) ? f.copayPercent : ""} onChange={(e) => set("copayPercent", e.target.value === "" ? 0 : Number(e.target.value))} /></Field>
            <Field label="Co-Insurance %"><Input type="number" min={0} max={100} value={Number.isFinite(f.coinsurancePercent) ? f.coinsurancePercent : ""} onChange={(e) => set("coinsurancePercent", e.target.value === "" ? 0 : Number(e.target.value))} /></Field>
            <Field label="Start Date" required><Input type="date" value={f.startDate} onChange={(e) => set("startDate", e.target.value)} /></Field>
            <Field label="End Date" required><Input type="date" value={f.endDate} onChange={(e) => set("endDate", e.target.value)} /></Field>
          </div>
          <label className="mt-4 flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={f.offlineApproval} onChange={(e) => set("offlineApproval", e.target.checked)} className="size-4 accent-[var(--primary)]" />
            <span className="font-medium">Offline Approval</span>
            <span className="text-xs text-muted-foreground">The payer approved by phone or letter.</span>
          </label>
          {f.offlineApproval && (
            <Field className="mt-3 sm:max-w-xs" label="Approval Number" required><Input className="font-mono" value={f.approvalNo} onChange={(e) => set("approvalNo", e.target.value)} dir="ltr" /></Field>
          )}
          {tried && problems.length > 0 && (
            <ul role="alert" className="mt-3 list-disc space-y-0.5 rounded-lg border border-destructive/50 bg-destructive/10 py-2 ps-7 pe-3 text-sm">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => { setEditing(null); setTried(false); }}>Cancel</Button>
            <Button type="submit" variant="primary">Save Coverage</Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
