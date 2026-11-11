import * as React from "react";
import { pushToast } from "@/lib/toast";
import type { MoveCheck, MoveResult, MoveVia } from "./types";

interface Options<C> {
  cards: C[];
  getId: (c: C) => string;
  stageOf: (c: C) => string;
  stageLabel: (stageId: string) => string;
  label: (c: C) => string;
  canMove: (c: C, from: string, to: string) => MoveCheck;
  onMove: (c: C, from: string, to: string, via: MoveVia) => MoveResult | Promise<MoveResult>;
  /** Called once a move has really happened: right away, or later when an editor or dialog saved. */
  onMoved?: (c: C, from: string, to: string, via: MoveVia) => void;
}

const DEFER_TTL = 10 * 60_000;

/**
 * Runs every move of a board: the rule check, the optimistic position, the rollback, the toast and the announcement.
 * The stage of a card always comes from the data (stageOf). The optimistic override only bridges the gap
 * until the data catches up, or is dropped at once when the action fails.
 */
export function useBoardMove<C>(opts: Options<C>) {
  const { cards, getId, stageOf, stageLabel, label } = opts;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;

  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [message, setMessage] = React.useState("");
  const [recent, setRecent] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState<{ id: string; n: number } | null>(null);
  const deferred = React.useRef<Record<string, { from: string; to: string; via: MoveVia; at: number }>>({});

  const stageNow = React.useCallback((c: C) => overrides[getId(c)] ?? stageOf(c), [overrides, getId, stageOf]);

  // The data caught up: drop the optimistic position. Deferred moves that landed are reported.
  React.useEffect(() => {
    setOverrides((prev) => {
      const keys = Object.keys(prev);
      if (!keys.length) return prev;
      const next: Record<string, string> = {};
      for (const id of keys) {
        const card = cards.find((c) => getId(c) === id);
        if (card && stageOf(card) !== prev[id]) next[id] = prev[id];
      }
      return Object.keys(next).length === keys.length ? prev : next;
    });
    const pending = deferred.current;
    for (const id of Object.keys(pending)) {
      const p = pending[id];
      const card = cards.find((c) => getId(c) === id);
      if (!card || Date.now() - p.at > DEFER_TTL) {
        delete pending[id];
        continue;
      }
      const now = stageOf(card);
      if (now === p.to) {
        delete pending[id];
        setRecent(id);
        setMessage(`${label(card)} moved to ${stageLabel(p.to)}.`);
        optsRef.current.onMoved?.(card, p.from, p.to, p.via);
      } else if (now !== p.from) {
        delete pending[id];
      }
    }
  }, [cards, getId, stageOf, stageLabel, label]);

  React.useEffect(() => {
    if (!recent) return;
    const t = window.setTimeout(() => setRecent(null), 1600);
    return () => window.clearTimeout(t);
  }, [recent]);

  const refuse = React.useCallback((card: C, reason: string) => {
    const id = getId(card);
    pushToast({ tone: "warn", text: reason });
    setMessage(`${label(card)} did not move. ${reason}`);
    setShake((s) => ({ id, n: (s?.n ?? 0) + 1 }));
  }, [getId, label]);

  const move = React.useCallback(
    (card: C, to: string, via: MoveVia) => {
      const o = optsRef.current;
      const id = o.getId(card);
      const from = overrides[id] ?? o.stageOf(card);
      if (from === to) return;
      const chk = o.canMove(card, from, to);
      if (!chk.ok) return refuse(card, chk.reason);

      const finish = (res: MoveResult) => {
        if (res === "deferred") {
          setOverrides((p) => omit(p, id));
          deferred.current[id] = { from, to, via, at: Date.now() };
          setMessage(`Opened the form for ${o.label(card)}. The card moves to ${o.stageLabel(to)} when you save.`);
          return;
        }
        if (res === false) {
          setOverrides((p) => omit(p, id));
          setMessage(`${o.label(card)} could not move to ${o.stageLabel(to)} and stays in ${o.stageLabel(from)}.`);
          setShake((s) => ({ id, n: (s?.n ?? 0) + 1 }));
          return;
        }
        setRecent(id);
        setMessage(`${o.label(card)} moved to ${o.stageLabel(to)}.`);
        o.onMoved?.(card, from, to, via);
        window.setTimeout(() => setOverrides((p) => omit(p, id)), 1500); // safety net if the data never catches up
      };

      setOverrides((p) => ({ ...p, [id]: to }));
      let res: MoveResult | Promise<MoveResult>;
      try {
        res = o.onMove(card, from, to, via);
      } catch {
        res = false;
      }
      if (res instanceof Promise) res.then(finish, () => finish(false));
      else finish(res);
    },
    [overrides, refuse],
  );

  return { stageNow, move, refuse, message, setMessage, recent, shake };
}

function omit(rec: Record<string, string>, key: string): Record<string, string> {
  if (!(key in rec)) return rec;
  const { [key]: _gone, ...rest } = rec; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}
