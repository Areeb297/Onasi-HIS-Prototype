import * as React from "react";
import { PenLine, Plus, Trash2 } from "lucide-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { Badge, Button, Card, CardHeader, Empty } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { AI_LABEL } from "@/lib/ai/context";
import { ruleEngine, type AiOutput } from "@/lib/ai/engine";
import { auditAccept, auditReject, auditSuggest, buildContext } from "@/lib/ai/live";
import { deleteSoap, saveSoap, signSoap, useSoapNotes, type SoapDraft, type SoapNote } from "@/lib/ai/soap-store";
import { useDevMode } from "@/lib/devmode";
import type { Encounter } from "@/lib/model";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** Chart tab "SOAP Notes". Notes can start from a simulated AI draft. The clinician edits, saves, and co-signs. */

const FIELDS: { key: keyof SoapDraft; letter: string; label: string; hint: string }[] = [
  { key: "subjective", letter: "S", label: "Subjective", hint: "What the patient says: complaints, history." },
  { key: "objective", letter: "O", label: "Objective", hint: "What you measure or see: vitals, examination." },
  { key: "assessment", letter: "A", label: "Assessment", hint: "Your diagnoses and reasoning." },
  { key: "plan", letter: "P", label: "Plan", hint: "Treatment, tests, follow-up, advice." },
];

const EMPTY: SoapDraft = { subjective: "", objective: "", assessment: "", plan: "" };
const stamp = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

interface Editing {
  /** Existing note id, or undefined for a new note. */
  id?: string;
  draft: SoapDraft;
  /** The AI output this started from, kept so Accept and Reject can be audited. */
  ai?: { out: AiOutput; original: SoapDraft };
}

export function SoapSection({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  const his = useHis();
  const all = useSoapNotes();
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
      setEdit({ draft: d, ai: { out, original: d } });
    } finally {
      setBusy(false);
    }
  }

  function save(andSign: boolean) {
    if (!edit || !patient) return;
    const note = saveSoap(enc.visitNumber, patient.id, edit.draft, { id: edit.id, aiDrafted: !!edit.ai });
    if (edit.ai) {
      const changed = (Object.keys(edit.ai.original) as (keyof SoapDraft)[]).some((k) => edit.ai!.original[k] !== edit.draft[k]);
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
              <Button size="sm" variant="primary" disabled={!!edit || !mayWrite} onClick={() => setEdit({ draft: { ...EMPTY } })}>
                <Plus className="size-4" /> New Note
              </Button>
            </div>
          }
        />
        {!mayWrite && <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Your role can read SOAP notes but not write them.</p>}
        {empty && <Empty>No SOAP notes yet. Press New Note, or Draft With Onasi AI to start from the chart.</Empty>}
      </Card>

      {edit && (
        <Card className="border-primary/50">
          <CardHeader title={edit.id ? "Edit SOAP Note" : "New SOAP Note"} />
          <div className="space-y-3 p-4">
            {edit.ai && (
              <div className="rounded-lg border border-warn/40 bg-warn/8 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <OnasiAiMark size={16} /> This note started from an AI draft <Badge tone="warn">{AI_LABEL}</Badge> <Badge tone="neutral">Simulated</Badge>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Read every line, fix what is wrong, and add what is missing. Sources used: {edit.ai.out.sources.join(", ") || "none"}.</p>
              </div>
            )}
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded bg-accent text-xs font-semibold text-accent-foreground">{f.letter}</span>
                  {f.label} <span className="font-normal">({f.hint})</span>
                </span>
                <Textarea value={edit.draft[f.key]} onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, [f.key]: e.target.value } })} className="min-h-24" />
              </label>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => save(false)}>Save Draft</Button>
              <Button variant="primary" onClick={() => save(true)} title="Saves the note and adds your e-signature stamp. The note is then locked.">
                <PenLine className="size-4" /> Save And Co-sign
              </Button>
              <Button variant="danger" onClick={discard}>{edit.ai ? "Reject AI Draft" : "Cancel"}</Button>
            </div>
          </div>
        </Card>
      )}

      {notes.map((n) => (
        <NoteCard key={n.id} n={n} dev={dev} mayWrite={mayWrite} editing={edit?.id === n.id} onEdit={() => setEdit({ id: n.id, draft: { subjective: n.subjective, objective: n.objective, assessment: n.assessment, plan: n.plan } })} />
      ))}
    </div>
  );
}

function NoteCard({ n, dev, mayWrite, editing, onEdit }: { n: SoapNote; dev: boolean; mayWrite: boolean; editing: boolean; onEdit: () => void }) {
  return (
    <Card>
      <CardHeader
        title={`SOAP note, ${stamp(n.at)}`}
        subtitle={`Started by ${n.author}`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {n.aiDrafted && <Badge tone="warn">Started from AI draft</Badge>}
            <Badge tone={n.status === "signed" ? "ok" : "neutral"}>{n.status === "signed" ? "Signed" : "Draft"}</Badge>
            {n.status === "draft" && (
              <>
                <Button size="sm" disabled={!mayWrite || editing} onClick={onEdit}>Edit</Button>
                <Button size="sm" variant="primary" disabled={!mayWrite} onClick={() => { signSoap(n.id); pushToast({ tone: "ok", text: "SOAP note co-signed." }); }}>
                  <PenLine className="size-4" /> Co-sign
                </Button>
                <Button size="sm" variant="ghost" disabled={!mayWrite} onClick={() => deleteSoap(n.id)} aria-label="Delete draft">
                  <Trash2 className="size-4" />
                </Button>
              </>
            )}
          </div>
        }
      />
      <dl className="grid gap-3 p-4 md:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <dt className="text-xs font-semibold text-muted-foreground">{f.letter}. {f.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-sm">{n[f.key] || <span className="text-muted-foreground">Empty</span>}</dd>
          </div>
        ))}
      </dl>
      {n.status === "signed" && (
        <p className="border-t border-border bg-ok/8 px-4 py-2 text-xs">
          <strong className="text-ok">Electronically signed</strong> by {n.signedBy} on {stamp(n.signedAt)}.
          {dev && " Simulated e-signature: name and time only, no certificate."}
        </p>
      )}
    </Card>
  );
}
