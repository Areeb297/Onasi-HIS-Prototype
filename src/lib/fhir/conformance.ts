/**
 * Maps Seha conformance steps to live status, from the documents the app has sent.
 * Steps follow conformance-seha.md in the nphies-uhr skill: x.1 main flow, x.2 amended flow;
 * sub-steps .1 send, .2 successful response, .3 view in the NPHIES provider portal (manual, ticked by the tester).
 */

import type { MinStep } from "./lab-validate";
import type { Json } from "./common";
import type { SendRecord } from "./types";

export type StepState = "none" | "progress" | "done" | "failed";

export interface ConfSub {
  id: string;
  text: string;
  state: StepState;
  detail?: string;
  /** The tester ticks this by hand (viewing the portal). */
  manual?: boolean;
}

export interface ConfStep {
  id: string;
  title: string;
  state: StepState;
  /** Plain language hint of what to do next. */
  hint: string;
  subs: ConfSub[];
  /** Minimum content checks for the best document sent so far. */
  mins: ConfSub[];
}

export const STATE_LABEL: Record<StepState, string> = {
  none: "Not Started",
  progress: "In Progress",
  done: "Done",
  failed: "Failed",
};

const noErrors = (s: SendRecord) => s.checks.every((c) => c.level !== "error");

export function conformanceStep(args: {
  id: string;
  title: string;
  /** What the tester sends in this step. */
  what: string;
  sends: SendRecord[];
  /** true = amendment step (version 2 or higher). */
  amendment: boolean;
  minimums?: (bundle: Json) => MinStep[];
  viewed: Record<string, boolean>;
  hint: string;
}): ConfStep {
  const { id, sends, amendment, minimums, viewed } = args;
  const mine = sends.filter((s) => (amendment ? s.version > 1 : s.version === 1));
  const valid = mine.filter(noErrors);
  const good = minimums ? valid.filter((s) => minimums(s.bundle).every((m) => m.met)) : valid;
  const accepted = good.filter((s) => s.response.status === "accepted");

  const sendState: StepState = good.length ? "done" : mine.length ? "failed" : "none";
  const respState: StepState = accepted.length ? "done" : good.length ? "failed" : mine.length && mine.every((s) => s.response.status === "rejected") ? "failed" : "none";
  const viewKey = `${id}.3`;
  const viewState: StepState = viewed[viewKey] ? "done" : "none";

  const subs: ConfSub[] = [
    { id: `${id}.1`, text: `Send ${args.what}`, state: sendState, detail: mine.length ? `${mine.length} sent, ${valid.length} without errors${minimums ? `, ${good.length} with the minimum content` : ""}` : undefined },
    { id: `${id}.2`, text: "Receive a successful response from NPHIES", state: respState, detail: accepted.length ? `Transaction ${accepted[accepted.length - 1].response.transactionId}` : undefined },
    { id: viewKey, text: "View it in the NPHIES provider portal", state: viewState, manual: true },
  ];

  let mins: ConfSub[] = [];
  if (minimums && valid.length) {
    const scored = valid.map((s) => ({ s, m: minimums(s.bundle) }));
    scored.sort((a, b) => b.m.filter((x) => x.met).length - a.m.filter((x) => x.met).length);
    mins = scored[0].m.map((m) => ({ id: m.id, text: m.text, state: m.met ? "done" : "failed", detail: m.detail }));
  } else if (minimums) {
    mins = minimums({}).map((m) => ({ id: m.id, text: m.text, state: "none" as StepState }));
  }

  const latest = mine[mine.length - 1];
  let state: StepState;
  if (sendState === "done" && respState === "done") state = "done";
  else if (!mine.length) state = "none";
  else if (!noErrors(latest) || latest.response.status === "rejected") state = "failed";
  else state = "progress";

  return { id, title: args.title, state, hint: args.hint, subs, mins };
}
