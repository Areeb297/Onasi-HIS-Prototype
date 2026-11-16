import { beforeEach, describe, expect, it } from "vitest";
import { buildTimeline, sbarFor } from "./chart-review";
import { addNote, deleteNote, editNote, noteId, notesOf, setNoteActive } from "./progress-notes";
import { saveSoap, signSoap } from "./ai/soap-store";
import { DETAIL_FIELDS, EMPTY_DETAIL, detailOf, fillFromChart, hasDetail, resetSoapDetails, saveSoapDetail, soapFileName, soapText } from "./soap-details";
import { switchUser } from "./session";
import { getState, resetAll } from "./store";

const enc = () => getState().encounters.find((e) => e.patientId === "P001" && e.status === "active")!;
const patient = () => getState().patients.find((p) => p.id === "P001")!;

beforeEach(() => {
  resetAll(); resetSoapDetails(); switchUser("U1");
});

describe("progress notes", () => {
  it("opens an older note without an id and gives it the same id each time", () => {
    const old = enc().notes[0];
    expect(old.id).toBeUndefined();
    expect(noteId(old)).toBe(noteId({ ...old }));
    expect(notesOf(enc())[0]).toMatchObject({ active: true, id: noteId(old) });
  });

  it("adds a note with the author and role, without marking the chart for an update", () => {
    const before = enc().dirty;
    const n = addNote(enc().visitNumber, "  Patient comfortable overnight.  ")!;
    expect(n).toMatchObject({ author: "Dr. Khalid Alharbi", role: "Physician", text: "Patient comfortable overnight." });
    expect(enc().notes).toHaveLength(2);
    expect(enc().dirty).toBe(before);
    expect(addNote(enc().visitNumber, "   ")).toBeNull();
  });

  it("adds an addendum to an older note, keeps the original text and the id", () => {
    const id = noteId(enc().notes[0]);
    const original = enc().notes[0].text;
    expect(editNote(enc().visitNumber, id, "")).toBe(false);
    expect(editNote(enc().visitNumber, id, "Corrected: chest X-ray done.")).toBe(true);
    const n = enc().notes[0];
    expect(n).toMatchObject({ id, editedBy: "Dr. Khalid Alharbi" });
    expect(n.text.startsWith(original)).toBe(true);
    expect(n.text).toMatch(/Addendum by Dr\. Khalid Alharbi, .+: Corrected: chest X-ray done\.$/);
    expect(n.editedAt).toBeTruthy();
  });

  it("sets a note Inactive, which takes it off the timeline and the handoff, and back to Active", () => {
    const v = enc().visitNumber;
    const id = noteId(enc().notes[0]);
    expect(setNoteActive(v, id, false)).toBe(true);
    expect(enc().notes).toHaveLength(0);
    expect(enc().notesInactive).toHaveLength(1);
    expect(notesOf(enc())[0]).toMatchObject({ id, active: false });
    expect(buildTimeline(enc()).some((i) => i.kind === "note")).toBe(false);
    expect(sbarFor(enc(), patient()).background).not.toContain("Last note");
    expect(setNoteActive(v, id, true)).toBe(true);
    expect(enc().notes).toHaveLength(1);
    expect(enc().notesInactive).toHaveLength(0);
  });

  it("deletes a note only with a reason, and keeps it with who deleted it", () => {
    const v = enc().visitNumber;
    const id = noteId(enc().notes[0]);
    expect(deleteNote(v, id, "  ")).toBe(false);
    expect(deleteNote(v, id, "Written on the wrong patient")).toBe(true);
    expect(notesOf(enc())).toHaveLength(0);
    expect(enc().notesDeleted?.[0]).toMatchObject({ id, deletedBy: "Dr. Khalid Alharbi", deleteReason: "Written on the wrong patient" });
    expect(deleteNote(v, id, "Again")).toBe(false);
  });
});

describe("SOAP note details", () => {
  it("saves the structured parts beside the note and locks them once signed", () => {
    const e = enc();
    const note = saveSoap(e.visitNumber, e.patientId, { subjective: "Cough for 3 days", objective: "", assessment: "Chest infection", plan: "Antibiotics" });
    expect(hasDetail(detailOf(note.id))).toBe(false);
    expect(saveSoapDetail(e.visitNumber, note.id, { ...EMPTY_DETAIL, hpi: "Started after a cold", riskFactors: ["Smoking", " Smoking ", ""] })).toBe(true);
    expect(detailOf(note.id)).toMatchObject({ hpi: "Started after a cold", riskFactors: ["Smoking"] });
    signSoap(note.id);
    expect(saveSoapDetail(e.visitNumber, note.id, { ...EMPTY_DETAIL, hpi: "Changed after signing" })).toBe(false);
    expect(detailOf(note.id).hpi).toBe("Started after a cold");
  });

  it("opens a note saved before details existed with every part empty", () => {
    expect(detailOf("SOAP-old")).toEqual(EMPTY_DETAIL);
  });

  it("fills only empty parts from the chart", () => {
    const d = fillFromChart({ ...EMPTY_DETAIL, diagnosis: "Typed by hand" }, enc());
    expect(d.chiefComplaint).toBe("Fever, Cough");
    expect(d.vitalSigns).toContain("BP 128/82 mmHg");
    expect(d.diagnosis).toBe("Typed by hand");
  });

  it("downloads as text with every part, saying Not recorded for empty ones", () => {
    const e = enc();
    const note = saveSoap(e.visitNumber, e.patientId, { subjective: "Cough", objective: "", assessment: "", plan: "" });
    const text = soapText(note, { ...EMPTY_DETAIL, familyHistory: "Father has asthma", riskFactors: ["Smoking"] }, patient(), "Demo General Hospital");
    for (const f of [...DETAIL_FIELDS.subjective, ...DETAIL_FIELDS.objective, ...DETAIL_FIELDS.assessment, ...DETAIL_FIELDS.plan]) expect(text).toContain(`${f.label}:`);
    expect(text).toContain("Family History: Father has asthma");
    expect(text).toContain("Risk Factors: Smoking");
    expect(text).toContain("Physical Examination: Not recorded");
    expect(text).toContain("Draft, not signed");
    expect(soapFileName(note)).toMatch(/^SOAP_Note_.+\.txt$/);
  });
});
