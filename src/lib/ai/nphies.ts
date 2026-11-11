import type { Check, LogEntry } from "../model";

/** Explains the checks on an ADT message in plain words and says how to fix them. */

export interface Explained {
  level: Check["level"];
  check: string;
  meaning: string;
  fix: string;
}

const FIELD_HELP: Record<string, { meaning: string; fix: string }> = {
  "PID-3": { meaning: "The patient is identified in NPHIES by the NHIC Health ID. Without it the message is rejected.", fix: "Open the patient record and enter the Health ID. Then resend." },
  "PID-7": { meaning: "NPHIES needs the date of birth.", fix: "Edit the patient and enter the date of birth." },
  "PID-8": { meaning: "Administrative sex is expected when it is known.", fix: "Edit the patient and choose the sex." },
  "PID-11": { meaning: "The address must be the Saudi Post short address: 4 letters then 4 digits.", fix: "Edit the patient and enter the short address, for example RHAD3100." },
  "PID-16": { meaning: "Marital status is expected when it is known.", fix: "Edit the patient and choose a marital status." },
  "PID-28": { meaning: "Nationality is expected. Use 999 if it is unknown.", fix: "Edit the patient and choose a nationality." },
  "PV1-2": { meaning: "The patient class (inpatient, outpatient, emergency) is empty.", fix: "Set the visit class on the visit." },
  "PV1-3": { meaning: "An inpatient message should say which bed the patient is in.", fix: "Assign a bed, then send the update." },
  "PV1-6": { meaning: "A transfer should say where the patient was before.", fix: "Check the transfer was made from a bed." },
  "PV1-8": { meaning: "Registration messages (A04, A05) expect the referring doctor.", fix: "Choose the referring doctor when you register the visit." },
  "PV1-19": { meaning: "The visit number links every message for the visit in NPHIES.", fix: "Make sure the visit has a visit number." },
  "PV1-44": { meaning: "Registration should carry the admit or registration time.", fix: "Enter the registration time." },
  "PV1-45": { meaning: "A discharge should carry the discharge time.", fix: "Enter the discharge date and time, then resend." },
  "PV2-8": { meaning: "A pre-admit should carry the expected admit time.", fix: "Enter the expected admit date and time." },
  "MRG-1": { meaning: "A merge needs the old patient's Health ID.", fix: "Select the patient to merge from, and check they have a Health ID." },
  "MRG-5": { meaning: "A merge needs the old visit number.", fix: "Select the old visit." },
  "DG1-3": { meaning: "A diagnosis has no code.", fix: "Open Diagnosis and pick an ICD-10-AM code." },
  "MSH-9": { meaning: "The message type does not match the event.", fix: "This is a system setting. Ask your integration team." },
  "MSH-12": { meaning: "The HL7 version must be 2.5.1.", fix: "This is a system setting. Ask your integration team." },
};

const SEGMENT_HELP: Record<string, { meaning: string; fix: string }> = {
  DG1: { meaning: "A diagnosis is required for this event.", fix: "Open Diagnosis, add at least one diagnosis, then resend." },
  PR1: { meaning: "A procedure segment is expected.", fix: "Open Procedures and add the procedure with its date." },
  PV1: { meaning: "The visit segment is required in every message.", fix: "Check that the visit exists and is selected." },
  PID: { meaning: "The patient segment is required in every message.", fix: "Check the patient is selected." },
  MRG: { meaning: "Merge events need the merge segment.", fix: "Fill in the merge fields on the event form." },
  AL1: { meaning: "Allergies are optional here.", fix: "Add allergies if the patient has any." },
};

export function explainCheck(c: Check): Explained {
  const field = /\b([A-Z0-9]{3}-\d+)\b/.exec(c.text)?.[1];
  const seg = /^([A-Z][A-Z0-9]{2}) (is required|must not be present|is out of order|is part of)/.exec(c.text)?.[1];
  let meaning = "";
  let fix = "";
  if (c.level === "ok") {
    meaning = "This check passed.";
    fix = "Nothing to do.";
  } else if (field && FIELD_HELP[field]) {
    ({ meaning, fix } = FIELD_HELP[field]);
  } else if (seg && /is required/.test(c.text) && SEGMENT_HELP[seg]) {
    ({ meaning, fix } = SEGMENT_HELP[seg]);
  } else if (/must not be present/.test(c.text)) {
    meaning = "This event does not allow that segment. NPHIES will reject the message.";
    fix = "Turn the segment off for this event (Developer View, message builder).";
  } else if (/out of order|MERGE_INFO/.test(c.text)) {
    meaning = "The segments are in the wrong order.";
    fix = "This is a system problem. Rebuild the message from the event form.";
  } else {
    meaning = "No built-in explanation for this check.";
    fix = "Look up the field in the Segment Table (Developer View) and the NPHIES integration guide.";
  }
  return { level: c.level, check: c.text, meaning, fix };
}

/** The most recent message for this visit that has errors or warnings, else the most recent message. */
export function latestProblemEntry(log: LogEntry[]): LogEntry | undefined {
  const sorted = [...log].sort((a, b) => b.seq - a.seq);
  return sorted.find((e) => e.errors > 0 || e.warnings > 0) ?? sorted[0];
}

export function explainEntry(entry: LogEntry | undefined): { entry?: LogEntry; items: Explained[] } {
  if (!entry) return { items: [] };
  const rank = { error: 0, warn: 1, ok: 2 } as const;
  return { entry, items: entry.checks.map(explainCheck).sort((a, b) => rank[a.level] - rank[b.level]) };
}
