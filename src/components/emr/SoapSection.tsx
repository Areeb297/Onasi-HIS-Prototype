import * as React from "react";
import { AlertCircle, Check, ChevronDown, ChevronUp, Download, FileText, PenLine, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { EmptyState, FormField, FormGrid, FormSection, RowMenu, TextArea } from "@/components/emr/entry-ui";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { fmtDateTime } from "@/lib/format";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { Badge, Button, Card, CardHeader, Empty, Input, Select, cn } from "@/components/ui/primitives";
import { AI_LABEL } from "@/lib/ai/context";
import { ruleEngine, type AiOutput } from "@/lib/ai/engine";
import { auditAccept, auditReject, auditSuggest, buildContext } from "@/lib/ai/live";
import { deleteSoap, saveSoap, signSoap, useSoapNotes, type SoapDraft, type SoapNote } from "@/lib/ai/soap-store";
import { audit } from "@/lib/audit";
import { useDevMode } from "@/lib/devmode";
import type { Encounter, Patient } from "@/lib/model";
import { FACILITY_NAME } from "@/lib/reference-data";
import { can, useSession } from "@/lib/session";
import {
  DETAIL_FIELDS, EMPTY_DETAIL, RISK_FACTORS, deleteSoapDetail, detailOf, fillFromChart, hasDetail, saveSoapDetail, soapFileName, soapText,
  useSoapDetails, type SoapDetail,
} from "@/lib/soap-details";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { confirmPatient } from "@/lib/wrong-patient";

/**
 * Chart tab "SOAP Notes". Each letter has a summary and the structured parts the HIS keeps (history of present
 * illness, past medical, family and social history, examination, risk factors, follow-up, patient education).
 * Notes can start from a simulated AI draft. The clinician edits, saves, and co-signs; a signed note is locked.
 * Note History lists the notes of every visit of the patient. Any note can be downloaded as text.
 * The HIS can record the consultation audio; this app does not record audio.
 */

type Letter = keyof SoapDraft;
const FIELDS: { key: Letter; letter: string; label: string; hint: string }[] = [
  { key: "subjective", letter: "S", label: "Subjective", hint: "What the patient says: complaints, history." },
  { key: "objective", letter: "O", label: "Objective", hint: "What you measure or see: vitals, examination." },
  { key: "assessment", letter: "A", label: "Assessment", hint: "Your diagnoses and reasoning." },
  { key: "plan", letter: "P", label: "Plan", hint: "Treatment, tests, follow-up, advice." },
];

const EMPTY: SoapDraft = { subjective: "", objective: "", assessment: "", plan: "" };
const stamp = (iso?: string) => fmtDateTime(iso);

interface Editing {
  /** Existing note id, or undefined for a new note. */
  id?: string;
  draft: SoapDraft;
  detail: SoapDetail;
  /** The AI output this started from, kept so Accept and Reject can be audited. */
  ai?: { out: AiOutput; original: SoapDraft };
}

function download(note: SoapNote, detail: SoapDetail, patient: Patient) {
  try {
    const blob = new Blob([soapText(note, detail, patient, FACILITY_NAME)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = soapFileName(note);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    audit("export", `SOAP note ${note.id}`, { patient: note.patientId, detail: `Visit ${note.visit}. Downloaded as text` });
    pushToast({ tone: "ok", text: "SOAP note downloaded as text" });
  } catch {
    pushToast({ tone: "warn", text: "Could not download the note." });
  }
}

export function SoapSection({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  const his = useHis();
  const all = useSoapNotes();
  const details = useSoapDetails();
  useSession();
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const notes = all.filter((n) => n.visit === enc.visitNumber).sort((a, b) => b.at.localeCompare(a.at));
  const [edit, setEdit] = React.useState<Editing | null>(null);
  const [busy, setBusy] = React.useState(false);
  const mayWrite = can("emr.write");
  const mayAi = can("ai.use");

  if (!patient) return <Card><Empty>The patient for this visit was not found.</Empty></Card>;

  async function draftWithAi() {
    if (!patient) return;
    setBusy(true);
    try {
      const out = await ruleEngine.run({ useCase: "soap", ctx: buildContext(enc, patient) });
      auditSuggest(out, enc, patient);
      const s = out.soap!;
      const d = { subjective: s.subjective, objective: s.objective, assessment: s.assessment, plan: s.plan };
      setEdit({ draft: d, detail: fillFromChart({ ...EMPTY_DETAIL }, enc), ai: { out, original: d } });
    } finally {
      setBusy(false);
    }
  }

  async function save(andSign: boolean) {
    if (!edit || !patient) return;
    if (andSign && !(await confirmPatient(patient.id))) return;
    const note = saveSoap(enc.visitNumber, patient.id, edit.draft, { id: edit.id, aiDrafted: !!edit.ai });
    saveSoapDetail(enc.visitNumber, note.id, edit.detail);
    if (edit.ai) {
      const changed = (Object.keys(edit.ai.original) as Letter[]).some((k) => edit.ai!.original[k] !== edit.draft[k]);
      auditAccept(edit.ai.out, enc, patient, changed, andSign ? "Saved as a SOAP note and co-signed." : "Saved as a draft SOAP note.");
    }
    if (andSign) signSoap(note.id);
    pushToast({ tone: "ok", text: andSign ? "SOAP note saved and co-signed." : "SOAP note saved as a draft." });
    setEdit(null);
  }

  function discard() {
    if (edit?.ai && patient) auditReject(edit.ai.out, enc, patient, "Closed without saving");
    setEdit(null);
  }

  const empty = !edit && notes.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="SOAP Notes"
          subtitle="Subjective, Objective, Assessment, Plan. Signed notes are locked."
          tag={dev ? "Feeds HPI, Physical Examination, Assessment and Plan, and Care Plan in the clinical documents" : undefined}
          right={
            <div className="flex flex-wrap gap-2">
              {mayAi && (
                <Button size="sm" disabled={!!edit || busy || !mayWrite} onClick={draftWithAi} title="Fills the note from the chart. A clinician must review it.">
                  <UseCaseIcon id="soap" className="size-4" /> {`Draft With ${ASSISTANT_NAME}`}
                </Button>
              )}
              <Button size="sm" variant="primary" disabled={!!edit || !mayWrite} onClick={() => setEdit({ draft: { ...EMPTY }, detail: { ...EMPTY_DETAIL } })}>
                <Plus className="size-4" /> New Note
              </Button>
            </div>
          }
        />
        {!mayWrite && <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Your role can read SOAP notes but not write them.</p>}
        {empty && (
          <EmptyState
            icon={<FileText />}
            title="No SOAP Notes On This Visit"
            action={mayWrite ? <Button size="sm" variant="primary" onClick={() => setEdit({ draft: { ...EMPTY }, detail: { ...EMPTY_DETAIL } })}><Plus className="size-4" /> New Note</Button> : undefined}
          >
            {mayWrite ? (mayAi ? `Start a new note, or use Draft With ${ASSISTANT_NAME} to start from the chart.` : "Start a new note for this visit.") : "Notes written on this visit show here."}
          </EmptyState>
        )}
      </Card>

      {edit && <NoteEditor enc={enc} edit={edit} setEdit={setEdit} onSave={save} onDiscard={discard} />}

      {notes.map((n) => (
        <NoteCard
          key={n.id} n={n} detail={detailOf(n.id, details)} patient={patient} dev={dev} mayWrite={mayWrite} editing={edit?.id === n.id}
          onEdit={() => setEdit({ id: n.id, draft: { subjective: n.subjective, objective: n.objective, assessment: n.assessment, plan: n.plan }, detail: detailOf(n.id, details) })}
        />
      ))}

      <NoteHistory enc={enc} patient={patient} notes={all} details={details} />
    </div>
  );
}

/* ---------- editor ---------- */

function NoteEditor({ enc, edit, setEdit, onSave, onDiscard }: { enc: Encounter; edit: Editing; setEdit: (e: Editing) => void; onSave: (sign: boolean) => void; onDiscard: () => void }) {
  const dev = useDevMode();
  const [tried, setTried] = React.useState(false);
  const setDetail = (patch: Partial<SoapDetail>) => setEdit({ ...edit, detail: { ...edit.detail, ...patch } });
  const blank = FIELDS.every((f) => !edit.draft[f.key].trim()) && !hasDetail(edit.detail);
  const save = (sign: boolean) => {
    if (blank) { setTried(true); return; }
    onSave(sign);
  };
  return (
    <Card className="border-primary/50">
      <CardHeader
        title={edit.id ? "Edit SOAP Note" : "New SOAP Note"}
        subtitle="Fill the parts you need. Empty parts are left out."
        right={<Button size="sm" onClick={() => setEdit({ ...edit, detail: fillFromChart(edit.detail, enc) })} title="Fills empty parts with the complaints, latest vital signs and diagnoses of this visit.">Fill From Chart</Button>}
      />
      <div className="space-y-6 p-4">
        {edit.ai && (
          <div className="rounded-lg border border-warn/40 bg-warn/8 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <OnasiAiMark size={16} /> This note started from an AI draft <Badge tone="warn">{AI_LABEL}</Badge>{dev && <> <Badge tone="neutral">Simulated</Badge></>}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Read every line, fix what is wrong, and add what is missing. Sources used: {edit.ai.out.sources.join(", ") || "none"}.</p>
          </div>
        )}
        {FIELDS.map((f) => (
          <FormSection
            key={f.key}
            title={f.label}
            description={f.hint}
            right={<span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">{f.letter}</span>}
          >
            <FormField label="Summary">
              <TextArea value={edit.draft[f.key]} onChange={(e) => { setEdit({ ...edit, draft: { ...edit.draft, [f.key]: e.target.value } }); setTried(false); }} rows={3} />
            </FormField>
            <FormGrid>
              {DETAIL_FIELDS[f.key].map((d) => (
                <FormField key={d.key} label={d.label} help={d.hint}>
                  <TextArea value={edit.detail[d.key]} onChange={(e) => { setDetail({ [d.key]: e.target.value }); setTried(false); }} rows={2} />
                </FormField>
              ))}
            </FormGrid>
            {f.key === "assessment" && <RiskFactorPicker value={edit.detail.riskFactors} onChange={(v) => setDetail({ riskFactors: v })} />}
          </FormSection>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-border bg-card px-4 py-3">
        {tried && blank && (
          <p role="alert" className="me-auto flex items-center gap-1 text-xs font-medium text-destructive">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" /> Write at least one part before saving.
          </p>
        )}
        <Button variant={edit.ai ? "danger" : "ghost"} onClick={onDiscard}>{edit.ai ? "Reject AI Draft" : "Cancel"}</Button>
        <Button onClick={() => save(false)}>Save Draft</Button>
        <Button variant="primary" onClick={() => save(true)} title="Saves the note and adds your e-signature stamp. The note is then locked.">
          <PenLine className="size-4" /> Save And Co-sign
        </Button>
      </div>
    </Card>
  );
}

function RiskFactorPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [other, setOther] = React.useState("");
  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  const extra = value.filter((v) => !RISK_FACTORS.includes(v));
  const add = () => { const t = other.trim(); if (t && !value.includes(t)) onChange([...value, t]); setOther(""); };
  return (
    <FormField label="Risk Factors" group help="Choose any that apply, or add another.">
      <div className="flex flex-wrap gap-1.5">
        {[...RISK_FACTORS, ...extra].map((r) => {
          const on = value.includes(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(r)}
              className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary/60 bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted")}
            >
              {on && <Check className="size-3" aria-hidden="true" />} {r}
            </button>
          );
        })}
      </div>
      <div className="flex max-w-md gap-2">
        <Input value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Another risk factor" aria-label="Another risk factor" />
        <Button onClick={add} disabled={!other.trim()}>Add</Button>
      </div>
    </FormField>
  );
}

/* ---------- a saved note ---------- */

function DetailView({ n, detail }: { n: SoapNote; detail: SoapDetail }) {
  return (
    <dl className="grid gap-4 p-4 md:grid-cols-2">
      {FIELDS.map((f) => {
        const parts = DETAIL_FIELDS[f.key].filter((d) => detail[d.key].trim());
        const risks = f.key === "assessment" && detail.riskFactors.length > 0;
        return (
          <div key={f.key}>
            <dt className="text-xs font-semibold text-muted-foreground">{f.letter}. {f.label}</dt>
            <dd className="mt-0.5 space-y-1.5 text-sm">
              <div className="whitespace-pre-wrap">{n[f.key] || (parts.length || risks ? null : <span className="text-muted-foreground">Empty</span>)}</div>
              {parts.map((d) => (
                <div key={d.key}>
                  <span className="text-xs font-medium text-muted-foreground">{d.label}: </span>
                  <span className="whitespace-pre-wrap">{detail[d.key]}</span>
                </div>
              ))}
              {risks && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-xs font-medium text-muted-foreground">Risk Factors:</span>
                  {detail.riskFactors.map((r) => <Badge key={r} tone="info">{r}</Badge>)}
                </div>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function NoteCard({ n, detail, patient, dev, mayWrite, editing, onEdit }: { n: SoapNote; detail: SoapDetail; patient: Patient; dev: boolean; mayWrite: boolean; editing: boolean; onEdit: () => void }) {
  const [removing, setRemoving] = React.useState(false);
  const draft = n.status === "draft";
  return (
    <Card>
      <CardHeader
        title={`SOAP Note, ${stamp(n.at)}`}
        subtitle={`Started by ${n.author}`}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            {draft && (
              <Button size="sm" variant="primary" disabled={!mayWrite} onClick={async () => { if (!(await confirmPatient(n.patientId))) return; signSoap(n.id); pushToast({ tone: "ok", text: "SOAP note co-signed." }); }}>
                <PenLine className="size-4" /> Co-sign
              </Button>
            )}
            <RowMenu
              label={`Actions for the SOAP note of ${stamp(n.at)}`}
              items={[
                draft && { label: "Edit Note", icon: <Pencil className="size-4" />, onSelect: onEdit, disabled: !mayWrite || editing },
                { label: "Download As Text", icon: <Download className="size-4" />, onSelect: () => download(n, detail, patient) },
                draft && { label: "Delete Draft", icon: <Trash2 className="size-4" />, onSelect: () => setRemoving(true), disabled: !mayWrite, danger: true, separated: true },
              ]}
            />
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
        <Badge tone={draft ? "neutral" : "ok"}>{draft ? "Draft" : "Signed"}</Badge>
        {n.aiDrafted && <Badge tone="warn">Started From AI Draft</Badge>}
      </div>
      <DetailView n={n} detail={detail} />
      {n.status === "signed" && (
        <p className="rounded-b-2xl border-t border-border bg-ok/8 px-4 py-2 text-xs">
          <strong className="text-ok">Electronically signed</strong> by {n.signedBy} on {stamp(n.signedAt)}. The note is locked.
          {dev && " Simulated e-signature: name and time only, no certificate."}
        </p>
      )}
      <Dialog
        open={removing}
        onClose={() => setRemoving(false)}
        title="Delete Draft Note"
        footer={<><Button variant="ghost" onClick={() => setRemoving(false)}>Keep The Draft</Button><Button variant="danger" onClick={() => { deleteSoap(n.id); deleteSoapDetail(n.id); setRemoving(false); pushToast({ tone: "warn", text: "Draft SOAP note deleted" }); }}>Delete Draft</Button></>}
      >
        <p className="text-sm">Delete the draft SOAP note of <strong>{stamp(n.at)}</strong>? It was not signed, so nothing of it stays in the chart.</p>
      </Dialog>
    </Card>
  );
}

/* ---------- history across the patient's visits ---------- */

function NoteHistory({ enc, patient, notes, details }: { enc: Encounter; patient: Patient; notes: SoapNote[]; details: Record<string, SoapDetail> }) {
  const his = useHis();
  const visits = his.encounters
    .filter((e) => e.patientId === patient.id)
    .map((e) => ({ enc: e, notes: notes.filter((n) => n.visit === e.visitNumber).sort((a, b) => b.at.localeCompare(a.at)) }))
    .filter((v) => v.notes.length > 0 || v.enc.visitNumber === enc.visitNumber)
    .sort((a, b) => (b.enc.admitAt ?? b.enc.expectedAdmitAt ?? "").localeCompare(a.enc.admitAt ?? a.enc.expectedAdmitAt ?? ""));
  const [visit, setVisit] = React.useState(enc.visitNumber);
  const [open, setOpen] = React.useState<string | null>(null);
  const chosen = visits.find((v) => v.enc.visitNumber === visit) ?? visits[0];
  const total = visits.reduce((n, v) => n + v.notes.length, 0);
  return (
    <Card>
      <CardHeader
        title="Note History"
        subtitle={`${total} SOAP note${total === 1 ? "" : "s"} across this patient's visits. Pick a visit to read its notes.`}
        right={
          <Select className="h-8 w-56" value={chosen?.enc.visitNumber ?? ""} aria-label="Visit" onChange={(e) => { setVisit(e.target.value); setOpen(null); }}>
            {visits.map((v) => (
              <option key={v.enc.visitNumber} value={v.enc.visitNumber}>
                {v.enc.visitNumber}{v.enc.visitNumber === enc.visitNumber ? " (this visit)" : ""} · {v.notes.length} note{v.notes.length === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        }
      />
      {!chosen || chosen.notes.length === 0 ? (
        <Empty>No SOAP notes on this visit.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {chosen.notes.map((n) => {
            const d = detailOf(n.id, details);
            const isOpen = open === n.id;
            return (
              <li key={n.id}>
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : n.id)} className="flex min-w-0 items-center gap-2 rounded-md text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {isOpen ? <ChevronUp className="size-4 shrink-0" aria-hidden="true" /> : <ChevronDown className="size-4 shrink-0" aria-hidden="true" />}
                    <span className="font-medium">{stamp(n.at)}</span>
                    <span className="text-muted-foreground">by {n.author}</span>
                  </button>
                  <div className="flex items-center gap-2">
                    {hasDetail(d) && <Badge tone="neutral">Structured</Badge>}
                    <Badge tone={n.status === "signed" ? "ok" : "neutral"}>{n.status === "signed" ? "Signed" : "Draft"}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => download(n, d, patient)} aria-label={`Download the note of ${stamp(n.at)}`}><Download className="size-4" aria-hidden="true" /></Button>
                  </div>
                </div>
                {isOpen && <div className="border-t border-border bg-muted/20"><DetailView n={n} detail={d} /></div>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
