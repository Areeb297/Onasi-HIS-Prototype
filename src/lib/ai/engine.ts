import { runCds, type Flag } from "./cds";
import { suggestCodes, type CodeSuggestion } from "./coding";
import { AI_LABEL, chartText, fullName, SIM_NOTE, type AiContext } from "./context";
import { pickLeaflet, renderLeaflet } from "./education";
import { explainEntry, latestProblemEntry, type Explained } from "./nphies";
import { suggestOrders } from "./orders";
import { draftSoap, soapAsText, type SoapText } from "./soap";
import { draftDischargeSummary, qualityCheck, summariseChart, type QualityIssue } from "./summaries";

/**
 * The assistant contract. The app ships one implementation, `ruleEngine`, which uses fixed rules and templates.
 * A real model would implement the same `AiEngine` interface. Nothing else in the app would change.
 */

export type UseCaseId = "soap" | "cds" | "codes" | "discharge" | "summary" | "education" | "orders" | "nphies-error" | "quality" | "help";

export interface UseCase {
  id: Exclude<UseCaseId, "help">;
  label: string;
  /** Short label for a quick-action chip. */
  chip: string;
}

export const USE_CASES: UseCase[] = [
  { id: "soap", label: "Draft a SOAP note", chip: "Draft SOAP Note" },
  { id: "cds", label: "Clinical decision support", chip: "Check Safety" },
  { id: "codes", label: "Suggest diagnosis codes", chip: "Suggest Codes" },
  { id: "discharge", label: "Draft discharge summary text", chip: "Discharge Summary" },
  { id: "summary", label: "Summarise the chart", chip: "Summarise Chart" },
  { id: "education", label: "Patient education leaflet", chip: "Patient Leaflet" },
  { id: "orders", label: "Suggest orders", chip: "Suggest Orders" },
  { id: "nphies-error", label: "Explain an NPHIES validation error", chip: "Explain NPHIES Error" },
  { id: "quality", label: "Documentation quality check", chip: "Quality Check" },
];

export interface AiOutput {
  id: string;
  useCase: UseCaseId;
  title: string;
  /** The draft. The clinician may edit it before accepting. */
  text: string;
  /** A second version of the text, for example Arabic. */
  alt?: { label: string; text: string; rtl?: boolean };
  soap?: SoapText;
  codes?: CodeSuggestion[];
  flags?: Flag[];
  quality?: QualityIssue[];
  explained?: Explained[];
  /** Which chart fields fed the answer. */
  sources: string[];
  label: typeof AI_LABEL;
  simulated: boolean;
  engine: string;
  at: string;
}

export interface AiRequest {
  useCase: UseCaseId;
  ctx: AiContext;
  /** What the user typed, if anything. */
  message?: string;
}

export interface AiEngine {
  name: string;
  simulated: boolean;
  detectIntent(message: string): UseCaseId;
  run(req: AiRequest): Promise<AiOutput>;
}

const INTENTS: [UseCaseId, RegExp][] = [
  ["nphies-error", /nphies|hl7|validation|rejected|reject|\berror|\back\b|message (failed|problem)/i],
  ["discharge", /discharge/i],
  ["soap", /\bsoap\b|subjective|progress note draft|write (a )?note/i],
  ["education", /leaflet|educat|patient (information|info|advice)|explain to (the )?patient|arabic|handout/i],
  ["codes", /\bicd|snomed|\bcodes?\b|coding|code (this|the) diagnos/i],
  ["orders", /\borders?\b|which tests|lab test|\blabs?\b|imaging|x-?ray|investigat|work-?up|workup/i],
  ["cds", /allerg|interaction|decision|alert|qsofa|sepsis|abnormal|safety|safe\b|vitals? (check|concern)|red flag|risk/i],
  ["quality", /quality|missing|incomplete|complete|documentation|gaps?|audit my/i],
  ["summary", /summar|overview|brief|tell me about|what is going on/i],
];

let counter = 0;
const newId = () => `ai-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** What the assistant says when it does not understand, or when it is asked for help. Needs no chart. */
export const helpText = () =>
  ["I am a simulated assistant. I follow fixed rules and templates over the open chart.", SIM_NOTE, "", "Try one of these:", ...USE_CASES.map((u) => `- ${u.label}`)].join("\n");

const bullet = (arr: string[]) => arr.map((x) => `- ${x}`).join("\n");
const flagWord = { high: "HIGH", medium: "CHECK", info: "NOTE" } as const;

const ENGINE_NAME = "Rule engine v1 (simulated)";

export const ruleEngine: AiEngine = {
  name: ENGINE_NAME,
  simulated: true,

  detectIntent(message) {
    const m = message.trim();
    for (const [id, re] of INTENTS) if (re.test(m)) return id;
    return "help";
  },

  async run({ useCase, ctx, message = "" }) {
    const base = { id: newId(), label: AI_LABEL, simulated: true, engine: ENGINE_NAME, at: ctx.now.toISOString() } as const;
    const who = fullName(ctx.patient);

    switch (useCase) {
      case "soap": {
        const s = draftSoap(ctx);
        return { ...base, useCase, title: `SOAP note draft for ${who}`, text: soapAsText(s), soap: s, sources: s.sources };
      }
      case "cds": {
        const flags = runCds(ctx);
        const text = flags.length
          ? `${bullet(flags.map((f) => `${flagWord[f.level]}: ${f.text}`))}\n\nThese are simple screening rules. They do not replace clinical judgement.`
          : "No alerts from the built-in rules. This does not mean the patient is safe. Use clinical judgement.";
        return { ...base, useCase, title: "Clinical decision support", text, flags, sources: [...new Set(flags.map((f) => f.source)), "Allergies", "Vitals", "Prescriptions"] };
      }
      case "codes": {
        const e = ctx.enc;
        const sug = suggestCodes([
          ...e.complaints.map((x) => ({ from: "Chief Complaints", text: x.text })),
          { from: "Visit reason", text: e.reason },
          ...e.notes.map((n) => ({ from: "Progress Notes", text: n.text })),
          ...ctx.soap.map((s) => ({ from: "SOAP Notes", text: `${s.subjective} ${s.assessment}` })),
          ...(message && !/^(suggest|code|icd|snomed)/i.test(message) ? [{ from: "Your question", text: message }] : []),
        ]);
        const have = new Set(e.dx.map((d) => d.code));
        const text = sug.length
          ? `${bullet(sug.map((s) => `${s.text}: ICD-10-AM ${s.icd}, SNOMED CT ${s.snomed}. Matched "${s.matched}" in ${s.from}.${have.has(s.icd) ? " Already on the chart." : ""}`))}\n\nSuggestions only. A coder or clinician must confirm each code against the official code sets.`
          : "No suggestions. The chart has no words that match the small built-in dictionary. Add a complaint or a note, or search the code list by hand.";
        return { ...base, useCase, title: "Diagnosis code suggestions", text, codes: sug, sources: [...new Set(sug.map((s) => s.from))] };
      }
      case "discharge": {
        const d = draftDischargeSummary(ctx);
        return { ...base, useCase, title: `Discharge summary draft for ${who}`, text: d.text, sources: d.sources };
      }
      case "summary": {
        const s = summariseChart(ctx);
        return { ...base, useCase, title: `Chart summary for ${who}`, text: s.text, sources: s.sources };
      }
      case "education": {
        const topicText = message.replace(/\b(leaflet|educat\w*|patient|arabic|for|about|in|on|the|a)\b/gi, " ").trim() || `${ctx.enc.dx.map((d) => d.text).join(" ")} ${chartText(ctx)}`;
        const leaflet = pickLeaflet(topicText.length > 2 ? topicText : chartText(ctx));
        const first = ctx.patient.given;
        const wantAr = /arabic|عرب/i.test(message);
        const en = renderLeaflet(leaflet, first, false);
        const ar = leaflet.ar ? renderLeaflet(leaflet, first, true) : undefined;
        const note = ar ? "" : "\n\n(No Arabic version is built in for this topic.)";
        return {
          ...base, useCase, title: `Patient leaflet: ${leaflet.title}`,
          text: wantAr && ar ? ar : en + note,
          alt: ar ? (wantAr ? { label: "English", text: en } : { label: "Arabic", text: ar, rtl: true }) : undefined,
          sources: ["Diagnosis", "Chief Complaints", "Your question"],
        };
      }
      case "orders": {
        const q = `${message} ${ctx.enc.complaints.map((x) => x.text).join(" ")} ${ctx.enc.reason}`;
        const sets = suggestOrders(q);
        const text = sets.length
          ? `${sets
              .map((s) => `For ${s.label.toLowerCase()}:\nLabs: ${s.labs.join("; ") || "none suggested"}.\nImaging: ${s.imaging.join("; ") || "none suggested"}.${s.note ? `\n${s.note}` : ""}`)
              .join("\n\n")}\n\nThe clinician decides what to order. Place orders in the Laboratory and Radiology tabs.`
          : "No order set matches the complaint. Add a complaint, or tell me the problem, for example: orders for chest pain.";
        return { ...base, useCase, title: "Suggested orders", text, sources: ["Chief Complaints", "Visit reason", "Your question"] };
      }
      case "nphies-error": {
        const entry = latestProblemEntry(ctx.log);
        const { items } = explainEntry(entry);
        if (!entry) return { ...base, useCase, title: "NPHIES validation", text: "There is no ADT message for this visit yet, so there is nothing to explain.", explained: [], sources: ["ADT message log"] };
        const probs = items.filter((i) => i.level !== "ok");
        const text = probs.length
          ? `Message ${entry.trigger} sent ${entry.sentAt.slice(0, 16).replace("T", " ")} (control id ${entry.controlId}) has ${entry.errors} error${entry.errors === 1 ? "" : "s"} and ${entry.warnings} warning${entry.warnings === 1 ? "" : "s"}.\n\n${probs.map((p) => `${p.level === "error" ? "ERROR" : "WARNING"}: ${p.check}\n  Meaning: ${p.meaning}\n  Fix: ${p.fix}`).join("\n\n")}`
          : `Message ${entry.trigger} (control id ${entry.controlId}) passed all ${items.length} checks. There is nothing to fix.`;
        return { ...base, useCase, title: `NPHIES checks for ${entry.trigger}`, text, explained: items, sources: [`ADT message log: ${entry.controlId}`] };
      }
      case "quality": {
        const q = qualityCheck(ctx);
        const text = q.length ? `${bullet(q.map((i) => `${i.text} ${i.fix}`))}` : "No gaps found by the built-in checks.";
        return { ...base, useCase, title: "Documentation quality check", text, quality: q, sources: ["Allergies", "Diagnosis", "Procedures", "Chief Complaints", "Vitals", "Notes"] };
      }
      default:
        return { ...base, useCase: "help", title: "What I can do", text: helpText(), sources: [] };
    }
  },
};
