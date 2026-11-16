import * as React from "react";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { ActiveToggle, EmptyState, EntrySheet, FormField, RowMenu, Segmented, TextArea, useValidation } from "@/components/emr/entry-ui";
import { Badge, Button, Card, CardHeader, Input, Select, cn } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/format";
import type { Encounter } from "@/lib/model";
import { addNote, deleteNote, editNote, notesOf, setNoteActive } from "@/lib/progress-notes";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { confirmForVisit, confirmPatient } from "@/lib/wrong-patient";

/**
 * Chart section "Progress Notes". Notes can be edited, set to Active or Inactive, and deleted with a reason.
 * Every change goes to the audit trail. Inactive notes stay on this page but leave the timeline and the handoff.
 */

const when = (s?: string) =>
  fmtDateTime(s);

const DELETE_REASONS = ["Written on the wrong patient", "Written on the wrong visit", "Duplicate note", "Entered in error", "Other"];
type Filter = "all" | "active" | "inactive";
const FILTERS: { value: Filter; label: string }[] = [{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];

export function ProgressNotesSection({ enc: initial }: { enc: Encounter }) {
  const his = useHis();
  useSession();
  const enc = his.encounters.find((e) => e.visitNumber === initial.visitNumber) ?? initial;
  const mayWrite = can("emr.write");
  const [text, setText] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const [editing, setEditing] = React.useState<{ id: string; original: string } | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [showDeleted, setShowDeleted] = React.useState(false);
  const composer = React.useRef<HTMLTextAreaElement>(null);

  const rows = notesOf(enc);
  const shown = rows.filter((r) => filter === "all" || (filter === "active" ? r.active : !r.active));
  const deleted = [...(enc.notesDeleted ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  const add = async () => {
    if (!text.trim()) { setTried(true); composer.current?.focus(); return; }
    if (!(await confirmPatient(enc.patientId))) return;
    if (addNote(enc.visitNumber, text)) { setText(""); setTried(false); pushToast({ tone: "ok", text: "Progress note added" }); }
  };

  return (
    <Card>
      <CardHeader
        title="Progress Notes"
        subtitle="Notes on the patient's progress during this visit. Notes are not part of the ADT message."
      />
      {mayWrite ? (
        <div className="space-y-2 border-b border-border px-4 py-4">
          <FormField label="New Note" error={tried && !text.trim() ? "Write the note first." : undefined} help="Your name and the time are added when you save.">
            <TextArea ref={composer} value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="For example: pain is better, eating well, walking with help" />
          </FormField>
          <div className="flex justify-end">
            <Button variant="primary" onClick={add}><NotebookPen className="size-4" aria-hidden="true" /> Add Note</Button>
          </div>
        </div>
      ) : (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Your role can read progress notes but not write them.</p>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">{shown.length} of {rows.length} {rows.length === 1 ? "note" : "notes"}</span>
          <Segmented label="Show notes" value={filter} options={FILTERS} onChange={setFilter} />
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={<NotebookPen />} title={rows.length ? "No Notes Match This Filter" : "No Progress Notes Yet"} action={rows.length ? <Button size="sm" onClick={() => setFilter("all")}>Show All Notes</Button> : undefined}>
          {rows.length ? undefined : mayWrite ? "Write the first note in the box above." : "Notes written on this visit show here."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border/70" aria-label="Progress notes">
          {shown.map(({ note, id, active }) => (
            <li key={id} className={cn("flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3 text-sm", !active && "bg-muted/30")}>
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="text-sm font-medium text-foreground">{note.author}</span>
                  {note.role && <span>{note.role}</span>}
                  <span>{when(note.at)}</span>
                  {!active && <Badge tone="neutral">Inactive</Badge>}
                </div>
                <div className={cn("mt-1 whitespace-pre-wrap", !active && "text-muted-foreground")}>{note.text}</div>
                {note.editedAt && <div className="mt-1 text-xs text-muted-foreground">Edited by {note.editedBy}, {when(note.editedAt)}</div>}
              </div>
              {mayWrite && (
                <div className="ms-auto flex shrink-0 items-center gap-2">
                  <ActiveToggle on={active} label={active ? "Set this note to Inactive" : "Set this note to Active"} onChange={(v) => setNoteActive(enc.visitNumber, id, v)} />
                  <RowMenu
                    label={`Actions for the note of ${when(note.at)}`}
                    items={[
                      { label: "Edit Note", icon: <Pencil className="size-4" />, onSelect: () => setEditing({ id, original: note.text }) },
                      { label: "Delete Note", icon: <Trash2 className="size-4" />, onSelect: () => setDeleting(id), danger: true, separated: true },
                    ]}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleted.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <button type="button" className="rounded text-xs font-medium text-move underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
            {showDeleted ? "Hide" : "Show"} Deleted Notes ({deleted.length})
          </button>
          {showDeleted && (
            <ul className="mt-2 space-y-2">
              {deleted.map((n) => (
                <li key={`${n.id}-${n.deletedAt}`} className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{n.author} · {when(n.at)}. Deleted by {n.deletedBy} on {when(n.deletedAt)}. Reason: {n.deleteReason}</div>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground line-through">{n.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && <EditSheet key={editing.id} visit={enc.visitNumber} id={editing.id} original={editing.original} onClose={() => setEditing(null)} />}
      {deleting && <DeleteDialog key={deleting} visit={enc.visitNumber} id={deleting} onClose={() => setDeleting(null)} />}
    </Card>
  );
}

function EditSheet({ visit, id, original, onClose }: { visit: string; id: string; original: string; onClose: () => void }) {
  const [text, setText] = React.useState(original);
  const changed = text.trim() !== original.trim();
  const v = useValidation({ text: !text.trim() && "The note cannot be empty. To take it off the chart, delete it." });
  const save = async () => {
    if (!v.submit()) return;
    if (!changed) { onClose(); return; }
    if (!(await confirmForVisit(visit))) return;
    if (editNote(visit, id, text)) { pushToast({ tone: "ok", text: "Progress note updated" }); onClose(); }
  };
  return (
    <EntrySheet
      onClose={onClose}
      title="Edit Progress Note"
      subtitle="The note shows who edited it and when."
      dirty={changed}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Update Note</Button></>}
    >
      <FormField label="Note" required error={v.error("text")}>
        <TextArea rows={10} value={text} onChange={(e) => setText(e.target.value)} onBlur={v.blur("text")} />
      </FormField>
    </EntrySheet>
  );
}

function DeleteDialog({ visit, id, onClose }: { visit: string; id: string; onClose: () => void }) {
  const [reason, setReason] = React.useState(DELETE_REASONS[0]);
  const [detail, setDetail] = React.useState("");
  const other = reason === "Other";
  const v = useValidation({ detail: other && !detail.trim() && "Write the reason." });
  const confirm = () => {
    if (!v.submit()) return;
    const why = other ? detail.trim() : detail.trim() ? `${reason}: ${detail.trim()}` : reason;
    if (deleteNote(visit, id, why)) { pushToast({ tone: "warn", text: "Progress note deleted", detail: "The reason is kept in the audit trail." }); onClose(); }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete Progress Note"
      subtitle="The note leaves the chart. The note and your reason are kept in the audit trail."
      footer={<><Button variant="ghost" onClick={onClose}>Keep The Note</Button><Button variant="danger" onClick={confirm}>Delete Note</Button></>}
    >
      <div className="space-y-4">
        <FormField label="Reason" required>
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {DELETE_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </FormField>
        <FormField label="Details" required={other} error={v.error("detail")} help={other ? undefined : "Optional."}>
          <Input value={detail} onChange={(e) => setDetail(e.target.value)} onBlur={v.blur("detail")} placeholder="Add a short note" />
        </FormField>
      </div>
    </Dialog>
  );
}
