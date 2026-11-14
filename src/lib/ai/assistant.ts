import { hasGlass } from "../session";
import { getState, patientName } from "../store";
import { AGENTS, runAgent, type AgentId, type AgentRun, type Proposal } from "./agents";

/**
 * The Onasi AI assistant: a person types a question about the hospital, the assistant picks the agent that can answer it,
 * runs that agent on the live data and answers with what it found. When the question names a patient, the answer is
 * narrowed to that patient. The routing is fixed word matching, not a language model, so it only understands the
 * questions listed in TOPICS and says so when a question is outside them.
 */

interface Topic {
  agent: AgentId;
  /** Words that point to this topic. Whole words or phrases, lower case. */
  words: string[];
}

const TOPICS: Topic[] = [
  { agent: "critical", words: ["critical", "panic value", "abnormal result", "urgent result"] },
  { agent: "handoff", words: ["handoff", "hand off", "handover", "hand over", "sbar", "shift"] },
  { agent: "ed-flow", words: ["emergency", "triage", "ctas", "waiting room", "er ", "ed ", "waited too long", "waiting too long"] },
  { agent: "claim-guard", words: ["claim", "refuse", "denial", "denied", "payer", "authorization", "authorisation", "insurance", "revenue"] },
  { agent: "clearance", words: ["nphies", "send", "unsent", "not sent", "rejected", "outbox"] },
  { agent: "discharge", words: ["discharge", "go home", "going home", "leave", "inpatient", "bed", "blocker", "blocking"] },
];

export interface Answer {
  /** The agent that answered, or null when the question was not understood. */
  agent: AgentId | null;
  run?: AgentRun;
  /** One or two sentences, shown first. */
  text: string;
  /** The findings behind the answer, most urgent first. */
  items: Proposal[];
  /** The patient the answer was narrowed to. */
  patient?: string;
  /** Other questions worth asking next. */
  followUps: string[];
}

/** The patient a question names, by family name, given name or visit number. Confidential charts are never matched. */
export function patientIn(question: string): { name: string; visits: string[] } | undefined {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9 ]/g, " ")} `;
  const s = getState();
  for (const p of s.patients) {
    if (p.confidential && !hasGlass(p.id)) continue;
    const visits = s.encounters.filter((e) => e.patientId === p.id).map((e) => e.visitNumber);
    const named = [p.family, p.given].filter((w) => w && w.length > 2 && w !== "Unknown").some((w) => q.includes(` ${w.toLowerCase()} `));
    const byVisit = visits.some((v) => q.includes(` ${v.toLowerCase()} `));
    if (named || byVisit) return { name: patientName(p), visits };
  }
  return undefined;
}

/** The agent whose job matches the question, or null. */
export function topicOf(question: string): AgentId | null {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9 ]/g, " ")} `;
  let best: { agent: AgentId; score: number } | null = null;
  for (const t of TOPICS) {
    const score = t.words.filter((w) => q.includes(w.endsWith(" ") ? ` ${w}` : w)).length;
    if (score && (!best || score > best.score)) best = { agent: t.agent, score };
  }
  return best?.agent ?? null;
}

export const SUGGESTED: { agent: AgentId; text: string }[] = AGENTS.map((a) => ({ agent: a.id, text: a.ask }));

export function answer(question: string, now: Date = new Date()): Answer {
  const patient = patientIn(question);
  // A question that only names a patient is about that patient going home: the widest check of one chart.
  const agent = topicOf(question) ?? (patient ? "discharge" : null);
  if (!agent) {
    return {
      agent: null, items: [], followUps: SUGGESTED.map((s) => s.text),
      text: "I can answer questions about discharges, critical results, emergency waiting times, what is waiting to go to NPHIES, claims and the shift handoff. Try one of the questions below.",
    };
  }
  const run = runAgent(agent, now);
  const all = run.proposals;
  const items = patient ? all.filter((p) => patient.visits.includes(p.visit)) : all;
  const open = items.filter((p) => p.level !== "info").length;
  const text = patient
    ? items.length
      ? open ? `For ${patient.name}: ${open} ${open === 1 ? "item needs" : "items need"} attention.` : `For ${patient.name}: nothing needs attention.`
      : `I found nothing about ${patient.name} in this check. ${run.headline}`
    : run.headline;
  return { agent, run, text, items, patient: patient?.name, followUps: SUGGESTED.filter((s) => s.agent !== agent).slice(0, 3).map((s) => s.text) };
}
