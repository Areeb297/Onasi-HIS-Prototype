import { useSyncExternalStore } from "react";
import { quickSend } from "../actions";
import { audit } from "../audit";
import { buildOutbox, sendRow } from "../nphies-outbox";
import { DOCTORS } from "../reference-data";
import { navigate } from "../router";
import { can, currentUser, roleOf } from "../session";
import { getState } from "../store";
import { pushToast } from "../toast";
import { AGENTS, AGENT_BY_ID, STARTER, runAgent, type AgentId, type AgentStep, type Proposal, type ProposalAction } from "./agents";

/**
 * The work the agents do in the background. Each agent checks the live hospital data on a timer. What it finds becomes a task.
 * A task the agent may finish by itself (and is set to Automatic for) is done and written to the activity list.
 * Every other task waits for a person. A task closes by itself when the problem is fixed in the chart.
 * Nothing here calls a language model: the checks are fixed rules. Browser storage only.
 */

export type Mode = "ask" | "auto";
export type TaskStatus = "waiting" | "done-agent" | "done-user" | "dismissed" | "failed" | "resolved";

export interface Task {
  id: string;
  agent: AgentId;
  level: "high" | "medium";
  patient: string;
  visit: string;
  text: string;
  why: string;
  action?: ProposalAction;
  status: TaskStatus;
  /** ISO time the agent first found it. */
  foundAt: string;
  /** ISO time it was closed. */
  closedAt?: string;
}

export interface FeedItem {
  id: number;
  at: string;
  agent: AgentId;
  /** Who did it. */
  by: "agent" | "user";
  kind: "found" | "done" | "dismissed" | "failed" | "resolved" | "setting";
  text: string;
  patient?: string;
}

export interface LastCheck {
  at: string;
  headline: string;
  steps: AgentStep[];
}

interface State {
  modes: Partial<Record<AgentId, Mode>>;
  paused: Partial<Record<AgentId, boolean>>;
  tasks: Record<string, Task>;
  last: Partial<Record<AgentId, LastCheck>>;
  feed: FeedItem[];
  seq: number;
}

const KEY = "onasi-emr-agent-work-v1";
const FEED_MAX = 80;
let state: State = { modes: {}, paused: {}, tasks: {}, last: {}, feed: [], seq: 1 };
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...state, ...(JSON.parse(raw) as Partial<State>) };
} catch {
  /* storage may be blocked */
}

const listeners = new Set<() => void>();
function commit(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useAgentWork(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

export const getAgentWork = (): State => state;

/** Clears tasks, activity and settings. Used by tests and the reset button. */
export function resetAgentWork() {
  commit({ modes: {}, paused: {}, tasks: {}, last: {}, feed: [], seq: 1 });
}

/* ---------- reading ---------- */

export const modeOf = (id: AgentId, s: State = state): Mode => s.modes[id] ?? (AGENT_BY_ID[id].autoByDefault ? "auto" : "ask");
export const isPaused = (id: AgentId, s: State = state): boolean => !!s.paused[id];

const sameDay = (iso: string | undefined, now: Date) => !!iso && new Date(iso).toDateString() === now.toDateString();
const RANK = { high: 0, medium: 1 } as const;

export const waitingTasks = (s: State = state): Task[] =>
  Object.values(s.tasks).filter((t) => t.status === "waiting" && STARTER.includes(t.agent)).sort((a, b) => RANK[a.level] - RANK[b.level] || a.foundAt.localeCompare(b.foundAt));

/** The doctor record of the signed-in user, when that user is a physician. Matched on the name. */
export function myDoctorId(): string | undefined {
  const u = currentUser();
  if (roleOf(u).id !== "physician") return undefined;
  return DOCTORS.find((d) => u.name.includes(d.given) && u.name.includes(d.family))?.id;
}

/** The tasks for patients this doctor is attending. */
export function tasksOfDoctor(tasks: Task[], doctorId: string): Task[] {
  const mine = new Set(getState().encounters.filter((e) => e.attending === doctorId).map((e) => e.visitNumber));
  return tasks.filter((t) => mine.has(t.visit));
}

export interface AgentProgress {
  waiting: number;
  doneByAgent: number;
  doneByStaff: number;
  /** Closed today, any way, plus still waiting. */
  total: number;
  done: number;
}

/** Today's work for one agent, or for all of them. */
export function progressOf(id?: AgentId, now: Date = new Date(), s: State = state): AgentProgress {
  const mine = Object.values(s.tasks).filter((t) => (id ? t.agent === id : STARTER.includes(t.agent)));
  const waiting = mine.filter((t) => t.status === "waiting").length;
  const today = mine.filter((t) => t.status !== "waiting" && sameDay(t.closedAt, now));
  const doneByAgent = today.filter((t) => t.status === "done-agent").length;
  const doneByStaff = today.filter((t) => t.status === "done-user" || t.status === "resolved").length;
  const done = doneByAgent + doneByStaff;
  return { waiting, doneByAgent, doneByStaff, done, total: done + waiting };
}

/* ---------- doing ---------- */

const doctorName = (id: string) => {
  const d = DOCTORS.find((x) => x.id === id);
  return d ? `Dr. ${d.given} ${d.family}` : "the attending doctor";
};

/** A step a person only opens or copies. The agent cannot finish these; they close when the chart is fixed. */
export const isShortcut = (a: ProposalAction | undefined): boolean => a?.kind === "open" || a?.kind === "copy";

/** What was done, in the past tense, for the activity list. */
function doneText(a: ProposalAction, t: Pick<Task, "text">): string {
  switch (a.kind) {
    case "notify": return `Notified ${doctorName(a.to)}. ${t.text}`;
    case "send-row": return `Sent to NPHIES. ${t.text.replace(/^[^:]{1,40}: /, "")}`;
    case "send-update": return "Sent the visit update to NPHIES.";
    default: return t.text;
  }
}

/** Carries out one step. Quiet: no message on screen, for work the agent does in the background. */
function carryOut(a: ProposalAction, quiet: boolean): boolean {
  switch (a.kind) {
    case "send-row": {
      const row = buildOutbox().find((r) => r.key === a.rowKey);
      return !!row && sendRow(row) === "accepted";
    }
    case "send-update":
      return quickSend("A08", a.visit).ok;
    case "open":
      navigate(a.path, a.params);
      return true;
    case "notify":
      if (!quiet) pushToast({ tone: "ok", text: `${doctorName(a.to)} notified.`, detail: a.message });
      return true;
    case "copy":
      void navigator.clipboard?.writeText(a.text).catch(() => undefined);
      pushToast({ tone: "ok", text: "Copied." });
      return true;
  }
}

function feed(s: State, item: Omit<FeedItem, "id" | "at">, at: string): State {
  return { ...s, seq: s.seq + 1, feed: [{ ...item, id: s.seq, at }, ...s.feed].slice(0, FEED_MAX) };
}

const asTask = (agent: AgentId, p: Proposal, at: string): Task => ({
  id: p.id, agent, level: p.level === "high" ? "high" : "medium", patient: p.patient, visit: p.visit, text: p.text, why: p.why, action: p.action, status: "waiting", foundAt: at,
});

/**
 * One round of checks. Each agent that is not paused reads the live data. New findings become tasks,
 * tasks whose problem is gone are closed, and steps the agent may do itself are done.
 * Returns how many steps the agents finished in this round.
 */
export function checkNow(now: Date = new Date()): number {
  if (!can("ai.use")) return 0;
  const at = now.toISOString();
  let s = state;
  let finished = 0;
  for (const def of AGENTS) {
    if (isPaused(def.id, s)) continue;
    const run = runAgent(def.id, now);
    // A handoff sheet is a document to copy, not a task to close.
    const found = run.proposals.filter((p) => p.level !== "info" && p.action && p.action.kind !== "copy");
    const tasks = { ...s.tasks };
    // The problem is gone: close the task.
    for (const t of Object.values(tasks)) {
      if (t.agent === def.id && t.status === "waiting" && !found.some((p) => p.id === t.id)) {
        tasks[t.id] = { ...t, status: "resolved", closedAt: at };
        s = feed(s, { agent: def.id, by: "user", kind: "resolved", text: `Fixed in the record, task closed. ${t.text}`, patient: t.patient }, at);
      }
    }
    for (const p of found) {
      const old = tasks[p.id];
      if (old && old.status !== "waiting") {
        // Done or dismissed today stays closed. A problem that comes back on a later day is a new task.
        if (sameDay(old.closedAt, now) || old.status === "done-agent" || old.status === "done-user") continue;
      }
      const task = old?.status === "waiting" ? { ...old, text: p.text, why: p.why, action: p.action, level: p.level === "high" ? "high" as const : "medium" as const } : asTask(def.id, p, at);
      const auto = modeOf(def.id, s) === "auto" && !!p.action && def.autoKinds.includes(p.action.kind);
      if (auto && p.action) {
        const ok = carryOut(p.action, true);
        tasks[p.id] = { ...task, status: ok ? "done-agent" : "waiting", closedAt: ok ? at : undefined };
        if (ok) {
          finished++;
          audit("ai-accept", `Agent step done automatically: ${p.action.label}`, { patient: p.patient, detail: `${def.name}. ${p.text}` });
          s = feed(s, { agent: def.id, by: "agent", kind: "done", text: doneText(p.action, task), patient: p.patient }, at);
        } else if (!old) {
          s = feed(s, { agent: def.id, by: "agent", kind: "failed", text: `Could not finish by itself, needs a person. ${p.text}`, patient: p.patient }, at);
        }
      } else {
        tasks[p.id] = task;
        if (!old || old.status !== "waiting") s = feed(s, { agent: def.id, by: "agent", kind: "found", text: p.text, patient: p.patient }, at);
      }
    }
    s = { ...s, tasks, last: { ...s.last, [def.id]: { at, headline: run.headline, steps: run.steps } } };
  }
  commit(s);
  return finished;
}

/** A person approves a waiting task, or opens the place to fix it. */
export function approveTask(id: string): boolean {
  const t = state.tasks[id];
  if (!t || t.status !== "waiting" || !t.action) return false;
  const ok = carryOut(t.action, false);
  if (isShortcut(t.action)) return ok; // Opening the chart does not close the task. It closes when the problem is fixed.
  const at = new Date().toISOString();
  audit("ai-accept", `Agent task approved: ${t.action.label}`, { patient: t.patient, detail: `${AGENT_BY_ID[t.agent].name}. ${t.text}` });
  let s: State = { ...state, tasks: { ...state.tasks, [id]: { ...t, status: ok ? "done-user" : "failed", closedAt: at } } };
  s = feed(s, { agent: t.agent, by: "user", kind: ok ? "done" : "failed", text: ok ? `Approved. ${doneText(t.action, t)}` : `Did not go through. ${t.text}`, patient: t.patient }, at);
  commit(s);
  return ok;
}

export function dismissTask(id: string) {
  const t = state.tasks[id];
  if (!t || t.status !== "waiting") return;
  const at = new Date().toISOString();
  audit("ai-reject", `Agent task dismissed: ${t.text}`, { patient: t.patient, detail: AGENT_BY_ID[t.agent].name });
  let s: State = { ...state, tasks: { ...state.tasks, [id]: { ...t, status: "dismissed", closedAt: at } } };
  s = feed(s, { agent: t.agent, by: "user", kind: "dismissed", text: `Dismissed. ${t.text}`, patient: t.patient }, at);
  commit(s);
}

/** Ask First or Automatic. Only agents with a step they can finish may be set to Automatic. */
export function setMode(id: AgentId, mode: Mode) {
  const def = AGENT_BY_ID[id];
  if (mode === "auto" && !def.autoKinds.length) return;
  const at = new Date().toISOString();
  audit("update", `Agent setting: ${def.name}`, { detail: mode === "auto" ? "Set to Automatic" : "Set to Ask First" });
  commit(feed({ ...state, modes: { ...state.modes, [id]: mode } }, { agent: id, by: "user", kind: "setting", text: mode === "auto" ? "Set to Automatic." : "Set to Ask First." }, at));
}

export function setPaused(id: AgentId, paused: boolean) {
  const at = new Date().toISOString();
  audit("update", `Agent setting: ${AGENT_BY_ID[id].name}`, { detail: paused ? "Paused" : "Resumed" });
  commit(feed({ ...state, paused: { ...state.paused, [id]: paused } }, { agent: id, by: "user", kind: "setting", text: paused ? "Paused. It checks nothing until it is resumed." : "Resumed." }, at));
}

/** How often the agents check, in milliseconds. */
export const CHECK_EVERY_MS = 60_000;

/** Carries out a step a person pressed in the assistant, when it is not a tracked task. */
export const runAction = (a: ProposalAction): boolean => carryOut(a, false);
