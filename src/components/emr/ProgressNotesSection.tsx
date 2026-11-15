import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Switch, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import type { Encounter } from "@/lib/model";
import { addNote, deleteNote, editNote, notesOf, setNoteActive } from "@/lib/progress-notes";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/**
 * Chart section "Progress Notes". Notes can be edited, set to Active or Inactive, and deleted with a reason.
 * Every change goes to the audit trail. Inactive notes stay on this page but leave the timeline and the handoff.
 */

const when = (s?: string) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

const DELETE_REASONS = ["Written on the wrong patient", "Written on the wrong visit", "Duplicate note", "Entered in error", "Other"];
type Filter = "all" | "active" | "inactive";

export function ProgressNotesSection({ enc: initial }: { enc: Encounter }) {
  const his = useHis();
  useSession();
  const enc = his.encounters.find((e) => e.visitNumber === initial.visitNumber) ?? initial;
  const mayWrite = can("emr.write");
  const [text, setText] = React.useState("");
  const [editing, setEditing] = React.useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = React.useState<{ id: string; reason: string; detail: string } | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [showDeleted, setShowDeleted] = React.useState(false);

  const rows = notesOf(enc);
  const shown = rows.filter((r) => filter === "all" || (filter === "active" ? r.active : !r.active));
  const deleted = [...(enc.notesDeleted ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  const add = () => {
    if (addNote(enc.visitNumber, text)) { setText(""); pushToast({ tone: "ok", text: "Progress note added" }); }
  };
  const saveEdit = () => {
    if (!editing) return;
    if (editNote(enc.visitNumber, editing.id, editing.text)) { setEditing(null); pushToast({ tone: "ok", text: "Progress note updated" }); }
  };
  const confirmDelete = () => {
    if (!deleting) return;
    const reason = deleting.reason === "Other" ? deleting.detail.trim() : deleting.detail.trim() ? `${deleting.reason}: ${deleting.detail.trim()}` : deleting.reason;
    if (deleteNote(enc.visitNumber, deleting.id, reason)) { setDeleting(null); pushToast({ tone: "warn", text: "Progress note deleted", detail: "The reason is kept in the audit trail." }); }
  };

  return (
    <Card>
      <CardHeader
        title="Progress Notes"
        subtitle="Notes on the patient's progress during this visit. Notes are not part of the ADT message."
        right={
          <Select className="h-8 w-36" value={filter} aria-label="Show notes" onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All Notes</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </Select>
        }
      />
      {mayWrite ? (
        <div className="space-y-2 border-b border-border px-4 py-3">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Write a note" aria-label="New progress note" />
          <Button variant="primary" disabled={!text.trim()} onClick={add}>Add Note</Button>
        </div>
      ) : (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">Your role can read progress notes but not write them.</p>
      )}

      <ul className="divide-y divide-border">
        {shown.length === 0 && <li><Empty>{rows.length ? "No notes match this filter." : "No notes yet."}</Empty></li>}
        {shown.map(({ note, id, active }) => {
          const isEditing = editing?.id === id;
          const isDeleting = deleting?.id === id;
          return (
            <li key={id} className={cn("px-4 py-3 text-sm", !active && "bg-muted/30")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{note.author}</span>
                  {note.role ? ` (${note.role})` : ""} · {when(note.at)}
                  {note.editedAt && <> · Edited by {note.editedBy} on {when(note.editedAt)}</>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={active ? "ok" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>
                  {mayWrite && (
                    <>
                      <Switch checked={active} label={active ? "Set this note to Inactive" : "Set this note to Active"} onChange={(v) => setNoteActive(enc.visitNumber, id, v)} />
                      <Button size="sm" variant="ghost" aria-label="Edit note" title="Edit" disabled={isEditing} onClick={() => { setEditing({ id, text: note.text }); setDeleting(null); }}>
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label="Delete note" title="Delete" disabled={isDeleting} onClick={() => { setDeleting({ id, reason: DELETE_REASONS[0], detail: "" }); setEditing(null); }}>
                        <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="mt-2 space-y-2">
                  <Textarea value={editing.text} onChange={(e) => setEditing({ id, text: e.target.value })} rows={3} aria-label="Edit progress note" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" disabled={!editing.text.trim() || editing.text.trim() === note.text} onClick={saveEdit}>Update</Button>
                    <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className={cn("mt-1 whitespace-pre-wrap", !active && "text-muted-foreground")}>{note.text}</div>
              )}
              {isDeleting && (
                <div className="mt-3 space-y-2 rounded-lg border border-destructive/40 bg-destructive/6 p-3" role="region" aria-label="Delete note">
                  <p className="text-[0.8125rem] font-medium">Delete this note? It leaves the chart. The note and your reason are kept in the audit trail.</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Reason" required>
                      <Select value={deleting.reason} onChange={(e) => setDeleting({ ...deleting, reason: e.target.value })}>
                        {DELETE_REASONS.map((r) => <option key={r}>{r}</option>)}
                      </Select>
                    </Field>
                    <Field label="Details" required={deleting.reason === "Other"}>
                      <Input value={deleting.detail} onChange={(e) => setDeleting({ ...deleting, detail: e.target.value })} placeholder="Add a short note" />
                    </Field>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="danger" disabled={deleting.reason === "Other" && !deleting.detail.trim()} onClick={confirmDelete}>Delete Note</Button>
                    <Button size="sm" onClick={() => setDeleting(null)}>Keep The Note</Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {deleted.length > 0 && (
        <div className="border-t border-border px-4 py-2.5">
          <button type="button" className="text-xs font-medium text-move underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring" aria-expanded={showDeleted} onClick={() => setShowDeleted(!showDeleted)}>
            {showDeleted ? "Hide" : "Show"} Deleted Notes ({deleted.length})
          </button>
          {showDeleted && (
            <ul className="mt-2 space-y-2">
              {deleted.map((n) => (
                <li key={`${n.id}-${n.deletedAt}`} className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
                  <div className="text-muted-foreground">{n.author} · {when(n.at)}. Deleted by {n.deletedBy} on {when(n.deletedAt)}. Reason: {n.deleteReason}</div>
                  <div className="mt-1 whitespace-pre-wrap text-muted-foreground line-through">{n.text}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
