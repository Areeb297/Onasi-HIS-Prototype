import type { AgentId } from "./agents";
import { AGENTS } from "./agents";
import type { Answer } from "./assistant";

/**
 * Past chats with Onasi AI, kept in the browser for each user. Used by the full screen view of the assistant.
 *
 * A saved chat is a transcript: the questions and what was answered at the time. The buttons that act on a finding
 * (Approve, Open) are not saved, because the record may have changed since. To act, the user asks again.
 */

export interface ChatTurn {
  id: number;
  at: string;
  question: string;
  answer: Answer;
}

export interface SavedChat {
  id: string;
  title: string;
  /** When the chat last changed. ISO time. */
  at: string;
  turns: ChatTurn[];
}

export const MAX_CHATS = 30;
const KEY = "onasi-ai-chats-v1";
const keyOf = (userId: string) => `${KEY}:${userId}`;

/** The chat's name in the list: its first question, shortened. */
export function titleOf(question: string): string {
  const t = question.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}...` : t || "New chat";
}

/** The answer as it is kept: without the action buttons of its findings. */
export function forStorage(a: Answer): Answer {
  return { ...a, items: a.items.map(({ action: _action, ...rest }) => rest) };
}

export function loadChats(userId: string): SavedChat[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(keyOf(userId));
    const list = raw ? (JSON.parse(raw) as SavedChat[]) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.id === "string" && Array.isArray(c.turns)) : [];
  } catch {
    return [];
  }
}

export function saveChats(userId: string, chats: SavedChat[]): void {
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(chats));
  } catch {
    /* storage may be full or blocked: the chat still works, it is just not kept */
  }
}

/** Adds or replaces a chat. Newest first, and only the newest MAX_CHATS are kept. */
export function putChat(chats: SavedChat[], chat: SavedChat): SavedChat[] {
  const kept = { ...chat, turns: chat.turns.map((t) => ({ ...t, answer: forStorage(t.answer) })) };
  return [kept, ...chats.filter((c) => c.id !== chat.id)].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_CHATS);
}

export const removeChat = (chats: SavedChat[], id: string): SavedChat[] => chats.filter((c) => c.id !== id);

/** Chats whose title or questions hold the words typed. */
export function searchChats(chats: SavedChat[], q: string): SavedChat[] {
  const term = q.trim().toLowerCase();
  if (!term) return chats;
  return chats.filter((c) => c.title.toLowerCase().includes(term) || c.turns.some((t) => t.question.toLowerCase().includes(term)));
}

/** "Today, 14:05", "Yesterday, 09:30" or "12 Nov 2026". */
export function chatDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ---------- topics for the welcome screen ---------- */

export interface TopicQuestion {
  q: string;
  /** A fixed answer. Without one the question is put to the assistant, which reads the live record. */
  a?: string;
}

export interface ChatTopic {
  id: string;
  title: string;
  /** The agent that answers these questions, for the icon. None for the questions about the assistant itself. */
  agent?: AgentId;
  questions: TopicQuestion[];
}

/** More ways to ask each agent. Every one holds a word the assistant matches to that agent. */
const MORE_QUESTIONS: Partial<Record<AgentId, string[]>> = {
  critical: ["Which critical laboratory results are still waiting for a doctor?", "Is there a critical imaging report nobody has opened?"],
  discharge: ["What still blocks each inpatient from discharge?", "Which beds will be free after today's discharges?"],
  handoff: ["Who are the sickest inpatients for the next shift?", "Give me the SBAR handover for the ward."],
  "ed-flow": ["Who in emergency is past the triage target?"],
  clearance: ["What is still not sent to NPHIES?"],
  "claim-guard": ["Which visits are missing a prior authorization for the claim?"],
};

/** Questions staff ask before they trust an assistant, answered plainly. */
export const ABOUT_QUESTIONS: Required<TopicQuestion>[] = [
  { q: "What can I ask?", a: "Three things for now: are there critical results the doctor has not seen, who can go home today and what still blocks them, and the shift handoff. You can name a patient or choose one in the About box to narrow the answer." },
  { q: "Does it change anything in the record?", a: "No. It reads the record and points at what needs you. The Critical Result Chaser also notifies the attending doctor by itself, which changes nothing in the record. Where a step would send something, it shows an Approve button and waits." },
  { q: "Where do the answers come from?", a: "From the live record in this system: the visit lists, charts, orders, results and the NPHIES send list. Each answer shows what was read before it shows what was found. It does not use the internet or outside data." },
  { q: "Which patients can it read?", a: "The same ones you can. It works with your role and permissions. Confidential charts stay closed unless you have broken the glass, and it will not match a confidential patient by name." },
  { q: "Is this a language model?", a: "Not in this version. The checks are fixed rules and the chat matches your words to one of its topics. When a question is outside them it says so. A language model can be connected later behind the same screens." },
  { q: "Who can see what I asked?", a: "Every question, approval and dismissal is written to the audit trail with your name and the time. Compliance staff can review it on the Audit page." },
  { q: "Can it give a diagnosis or choose a treatment?", a: "No. It finds missing data, waiting results and late steps. Clinical decisions stay with the doctor and the nurse. It is not a medical device." },
];

/** One topic for each agent that is switched on, then the questions about the assistant itself. */
export function chatTopics(): ChatTopic[] {
  return [
    ...AGENTS.map((a) => ({ id: a.id, title: a.name, agent: a.id, questions: [a.ask, ...(MORE_QUESTIONS[a.id] ?? [])].map((q) => ({ q })) })),
    { id: "about", title: "About Onasi AI", questions: ABOUT_QUESTIONS },
  ];
}

/** The reply to a question that has a fixed answer. It reads nothing from the record. */
export function fixedAnswer(text: string): Answer {
  return { agent: null, text, items: [], followUps: [], sources: [] };
}
