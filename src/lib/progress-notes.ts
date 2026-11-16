import { audit } from "./audit";
import type { DeletedNote, Encounter, Note } from "./model";
import { currentUser, roleOf } from "./session";
import { getState, updateEncounter } from "./store";

/**
 * Progress notes on a visit: add, add an addendum (never rewrite), set Active or Inactive, delete with a reason.
 * Active notes stay in `enc.notes`, so the timeline, the handoff and the documents read active notes only.
 * Inactive notes move to `enc.notesInactive`; deleted ones to `enc.notesDeleted` with who removed them and why.
 * Progress notes are not part of the ADT message, so no change here marks the chart for an update.
 */

/** A short hash, so an older note without an id gets the same id every time it is read. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const noteId = (n: Note): string => n.id ?? `PN-${hash(`${n.at}|${n.author}|${n.text}`)}`;

export interface NoteRow { note: Note; id: string; active: boolean }

/** Active and inactive notes of the visit, newest first. Deleted notes are left out. */
export function notesOf(enc: Pick<Encounter, "notes" | "notesInactive">): NoteRow[] {
  const rows: NoteRow[] = [
    ...enc.notes.map((note) => ({ note, id: noteId(note), active: true })),
    ...(enc.notesInactive ?? []).map((note) => ({ note, id: noteId(note), active: false })),
  ];
  return rows.sort((a, b) => b.note.at.localeCompare(a.note.at));
}

function who(): { name: string; role: string } {
  try {
    const u = currentUser();
    return { name: u.name, role: roleOf(u).label };
  } catch {
    return { name: "Unknown", role: "None" };
  }
}

const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/* ---------- pure changes on an encounter (used by the store wrappers and the tests) ---------- */

/** Finds a note by id in the active or inactive list. */
function locate(e: Encounter, id: string): { list: "notes" | "notesInactive"; index: number } | null {
  const a = e.notes.findIndex((n) => noteId(n) === id);
  if (a >= 0) return { list: "notes", index: a };
  const b = (e.notesInactive ?? []).findIndex((n) => noteId(n) === id);
  return b >= 0 ? { list: "notesInactive", index: b } : null;
}

export function applyAdd(e: Encounter, text: string, by: { name: string; role: string }, at: string = localNow()): Note {
  const note: Note = { id: `PN-${Date.now().toString(36)}${hash(text).slice(0, 3)}`, at, author: by.name, role: by.role, text: text.trim() };
  e.notes = [...e.notes, note];
  return note;
}

/**
 * Adds an addendum. A saved note is never rewritten (CBAHI, JCI): the original text stays and the addendum is appended
 * with its author and time, all in the one text column the HIS has (emr.ProgressNote.Notes).
 */
export function applyEdit(e: Encounter, id: string, text: string, by: { name: string }, at: string = localNow()): Note | null {
  const loc = locate(e, id);
  if (!loc || !text.trim()) return null;
  const list = [...(e[loc.list] ?? [])];
  const old = list[loc.index];
  const addendum = `Addendum by ${by.name}, ${at.replace("T", " ")}: ${text.trim()}`;
  const next: Note = { ...old, id: noteId(old), text: `${old.text}\n\n${addendum}`, editedAt: new Date().toISOString(), editedBy: by.name };
  list[loc.index] = next;
  e[loc.list] = list;
  return next;
}

export function applyActive(e: Encounter, id: string, active: boolean): Note | null {
  const loc = locate(e, id);
  if (!loc) return null;
  const isActive = loc.list === "notes";
  const note = { ...(e[loc.list] ?? [])[loc.index] };
  note.id = noteId(note);
  if (isActive === active) return note;
  e[loc.list] = (e[loc.list] ?? []).filter((_, i) => i !== loc.index);
  if (active) e.notes = [...e.notes, note];
  else e.notesInactive = [...(e.notesInactive ?? []), note];
  return note;
}

export function applyDelete(e: Encounter, id: string, reason: string, by: { name: string }): DeletedNote | null {
  const loc = locate(e, id);
  if (!loc || !reason.trim()) return null;
  const old = (e[loc.list] ?? [])[loc.index];
  const gone: DeletedNote = { ...old, id: noteId(old), deletedAt: new Date().toISOString(), deletedBy: by.name, deleteReason: reason.trim() };
  e[loc.list] = (e[loc.list] ?? []).filter((_, i) => i !== loc.index);
  e.notesDeleted = [...(e.notesDeleted ?? []), gone];
  return gone;
}

/* ---------- store wrappers ---------- */

const patientOf = (visit: string) => getState().encounters.find((x) => x.visitNumber === visit)?.patientId;

export function addNote(visit: string, text: string): Note | null {
  if (!text.trim()) return null;
  const out: { note?: Note | null } = {};
  const by = who();
  updateEncounter(visit, (e) => { out.note = applyAdd(e, text, by); }, { touch: false });
  if (out.note) audit("create", `Progress note ${out.note.id}`, { patient: patientOf(visit), detail: `Visit ${visit}` });
  return out.note ?? null;
}

export function editNote(visit: string, id: string, text: string): boolean {
  const out: { note?: Note | null } = {};
  updateEncounter(visit, (e) => { out.note = applyEdit(e, id, text, who()); }, { touch: false });
  if (out.note) audit("update", `Progress note ${id}`, { patient: patientOf(visit), detail: `Visit ${visit}. Addendum added` });
  return !!out.note;
}

export function setNoteActive(visit: string, id: string, active: boolean): boolean {
  const out: { note?: Note | null } = {};
  updateEncounter(visit, (e) => { out.note = applyActive(e, id, active); }, { touch: false });
  if (out.note) audit("update", `Progress note ${id}`, { patient: patientOf(visit), detail: `Visit ${visit}. Set to ${active ? "Active" : "Inactive"}` });
  return !!out.note;
}

export function deleteNote(visit: string, id: string, reason: string): boolean {
  const out: { note?: DeletedNote | null } = {};
  updateEncounter(visit, (e) => { out.note = applyDelete(e, id, reason, who()); }, { touch: false });
  if (out.note) audit("delete", `Progress note ${id}`, { patient: patientOf(visit), detail: `Visit ${visit}. Reason: ${reason.trim()}` });
  return !!out.note;
}
