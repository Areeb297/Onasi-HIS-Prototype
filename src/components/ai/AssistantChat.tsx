import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { IconChevronDown, IconHelpCircle } from "@tabler/icons-react";
import { Check, ChevronRight, X } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import {
  AssistantMessage, BRAND_BTN, BrandBadge, ChatThread, Composer, GLASS_BTN, ICON_BTN, MarkTile, ReplyActions, RevealText, SuggestionChips, TypingDots, UserMessage,
} from "@/components/ai/chat-parts";
import { cn } from "@/components/ui/primitives";
import { approveTask, checkNow, dismissTask, isShortcut, runAction, useAgentWork } from "@/lib/ai/agent-work";
import { AGENT_BY_ID, type Proposal } from "@/lib/ai/agents";
import { SUGGESTED, answer } from "@/lib/ai/assistant";
import { ABOUT_QUESTIONS, fixedAnswer, type ChatTurn } from "@/lib/ai/chat-history";
import { audit } from "@/lib/audit";

/**
 * Ask Onasi AI: a chat about the whole hospital. Each reply shows what the assistant read, then what it found.
 * A finding that changes a record carries an Approve button. Nothing is changed by asking.
 */

type Turn = ChatTurn;

/** The answer as plain text, for the Copy button. */
function plain(t: Turn): string {
  const a = t.answer;
  return [`Question: ${t.question}`, a.text, ...a.items.map((p) => `- ${p.patient}${p.visit ? ` (${p.visit})` : ""}: ${p.text} Why: ${p.why}`)].join("\n");
}

const STEP_MS = 360;
/** The Help link asks the first of the questions about the assistant. The rest live in the full screen view. */
const HELP = ABOUT_QUESTIONS[0];
const THINK_MS = 450;

function Finding({ p }: { p: Proposal }) {
  const work = useAgentWork();
  const task = work.tasks[p.id];
  const opens = isShortcut(p.action);
  const status = task?.status;
  const closed = status && status !== "waiting";
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", p.level === "high" ? "bg-destructive" : p.level === "medium" ? "bg-[#032C26]/60 dark:bg-white/60" : "bg-[#03C1AC]")} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-[#032C26] dark:text-foreground">{p.patient}</span>
          {p.level === "high" && <BrandBadge tone="urgent">Urgent</BrandBadge>}
          {p.level === "medium" && <BrandBadge tone="ink">Soon</BrandBadge>}
        </div>
        <p className="mt-0.5 text-sm" title={`Why: ${p.why}`}>{p.text}</p>
        <span className="sr-only">Why: {p.why}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {status === "done-user" && <BrandBadge>Approved</BrandBadge>}
        {status === "done-agent" && <BrandBadge>Done By The Agent</BrandBadge>}
        {status === "resolved" && <BrandBadge>Fixed</BrandBadge>}
        {status === "dismissed" && <BrandBadge tone="ink">Dismissed</BrandBadge>}
        {status === "failed" && <BrandBadge tone="urgent">Did Not Go Through</BrandBadge>}
        {!closed && p.action && (
          <>
            <button type="button" className={cn(opens ? GLASS_BTN : BRAND_BTN, "h-8 px-2.5 text-[0.8125rem]")} onClick={() => (task ? approveTask(p.id) : runAction(p.action!))}>
              {opens ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              {opens ? p.action.label : `Approve: ${p.action.label}`}
            </button>
            {!opens && task && (
              <button type="button" className={ICON_BTN} onClick={() => dismissTask(p.id)} aria-label={`Dismiss the task for ${p.patient}`} title="Dismiss"><X className="size-4" aria-hidden="true" /></button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

/**
 * One reply. Live, it plays: thinking dots, then what the agent read step by step, then the answer word by word,
 * then the findings, sources and actions. A reply from the past, or under reduced motion, shows whole at once.
 */
export function Reply({ turn, live, onAsk, followUps = true }: { turn: Turn; live: boolean; onAsk: (q: string) => void; followUps?: boolean }) {
  const reduce = useReducedMotion();
  const play = live && !reduce;
  const a = turn.answer;
  const steps = a.run?.steps ?? [];
  const [thinking, setThinking] = React.useState(play);
  const [shown, setShown] = React.useState(play ? 0 : steps.length);
  const [open, setOpen] = React.useState(play);
  const [all, setAll] = React.useState(false);
  const stepsDone = shown >= steps.length;
  const [textDone, setTextDone] = React.useState(!play);

  React.useEffect(() => {
    if (!thinking) return;
    const t = window.setTimeout(() => setThinking(false), THINK_MS);
    return () => window.clearTimeout(t);
  }, [thinking]);

  React.useEffect(() => {
    if (thinking || stepsDone) return;
    const t = window.setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [thinking, stepsDone, shown]);

  // Once the steps are read, fold them away so the answer leads.
  React.useEffect(() => { if (play && stepsDone && !thinking && steps.length) { const t = window.setTimeout(() => setOpen(false), 300); return () => window.clearTimeout(t); } }, [play, stepsDone, thinking, steps.length]);

  if (thinking) return <AssistantMessage thinking><TypingDots /></AssistantMessage>;

  const items = all ? a.items : a.items.slice(0, 6);
  return (
    <AssistantMessage thinking={!textDone}>
      <div className="glass-card overflow-hidden rounded-2xl rounded-ss-md">
        {a.agent && steps.length > 0 && (
          <div className="border-b border-[rgba(20,32,28,0.07)] dark:border-white/5">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:hover:bg-white/5">
              <AgentIcon agent={a.agent} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                <span className="font-semibold text-[#032C26] dark:text-foreground">{AGENT_BY_ID[a.agent].name}</span>
                <span className="text-muted-foreground"> {stepsDone ? `checked ${steps.length} things` : "is checking"}</span>
              </span>
              <IconChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
            </button>
            {open && (
              <ol className="space-y-1.5 px-4 pb-3 pt-0.5">
                {steps.slice(0, shown).map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[0.8125rem]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-[#03C1AC]" aria-hidden="true" />
                    <span>{s.did} <span className="text-muted-foreground">{s.found}</span></span>
                  </li>
                ))}
                {!stepsDone && <li className="flex items-center gap-2.5 text-[0.8125rem] text-muted-foreground"><span className="size-3.5 shrink-0 animate-pulse rounded-full bg-[#39EDD5]/50 motion-reduce:animate-none" aria-hidden="true" />Reading the record</li>}
              </ol>
            )}
          </div>
        )}
        {stepsDone && (
          <div className="px-4 py-3">
            <RevealOnce text={a.text} live={play} onDone={() => setTextDone(true)} />
          </div>
        )}
        {textDone && a.items.length > 0 && (
          <div className="border-t border-[rgba(20,32,28,0.07)] dark:border-white/5">
            <ul className="divide-y divide-[rgba(20,32,28,0.07)] dark:divide-white/5">{items.map((p) => <Finding key={p.id} p={p} />)}</ul>
            {a.items.length > 6 && (
              <button type="button" onClick={() => setAll((v) => !v)} className={cn("w-full border-t border-[rgba(20,32,28,0.07)] px-4 py-2 text-left text-[0.8125rem] font-medium hover:bg-white/50 dark:border-white/5 dark:hover:bg-white/5", "text-[#035D53] dark:text-[#52FCE3]")}>
                {all ? "Show Fewer" : `Show All ${a.items.length}`}
              </button>
            )}
          </div>
        )}
      </div>
      {textDone && (
        <>
          <ReplyActions
            copyText={plain(turn)}
            at={turn.at}
            sources={a.sources}
            pinned={live}
            onAgain={a.agent ? () => onAsk(turn.question) : undefined}
            onRate={(v) => audit(v === "up" ? "ai-accept" : "ai-reject", `Assistant answer rated ${v === "up" ? "helpful" : "not helpful"}`, { detail: `${turn.question} ${a.text}` })}
          />
          {followUps && <SuggestionChips label="Ask next" items={a.followUps} onPick={onAsk} />}
        </>
      )}
    </AssistantMessage>
  );
}

/** The answer text, revealed once, telling the reply when it is complete. */
function RevealOnce({ text, live, onDone }: { text: string; live: boolean; onDone: () => void }) {
  const [done, setDone] = React.useState(!live);
  React.useEffect(() => {
    if (!live) { setDone(true); return; }
    // Mirror useReveal's pace: about 45 frames of 30ms at most.
    const words = (text.match(/\S+\s*/g) ?? []).length;
    const frames = Math.min(45, words);
    const t = window.setTimeout(() => setDone(true), frames * 30 + 60);
    return () => window.clearTimeout(t);
  }, [live, text]);
  React.useEffect(() => { if (done) onDone(); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  return <RevealText text={text} live={live && !done} className="text-[0.9375rem] leading-relaxed text-foreground" />;
}

/** Asks a question: a fixed answer from the topics list, or the live record. */
export function askAssistant(question: string, about?: { name: string; visits: string[] }, fixed?: string): Turn {
  let a;
  if (fixed) {
    a = fixedAnswer(fixed);
    audit("ai-suggest", `Assistant question: ${question}`, { detail: "Answered from the questions and answers list" });
  } else {
    checkNow(); // so every finding in the answer is a tracked task with its real state
    a = answer(question, new Date(), about);
    audit("ai-suggest", `Assistant question: ${question}`, { detail: a.agent ? `${AGENT_BY_ID[a.agent].name}. ${a.text}` : "Not understood" });
  }
  return { id: Date.now(), at: new Date().toISOString(), question, answer: a };
}

/** The hospital chat in the side panel: thread above, composer docked at the bottom. */
export function AssistantChat({ firstQuestion, resetKey, onCount }: { firstQuestion?: string; resetKey?: number; onCount?: (n: number) => void }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [text, setText] = React.useState("");
  const asked = React.useRef("");
  const boxRef = React.useRef<HTMLTextAreaElement>(null);

  // The side panel keeps it simple: a patient is named in the question. The About list lives in the full screen view.
  const ask = React.useCallback((q: string, fixed?: string) => {
    const question = q.trim();
    if (!question) return;
    const turn = askAssistant(question, undefined, fixed);
    setTurns((t) => [...t, turn]);
    setText("");
  }, []);

  // A question passed in from another page is asked once.
  React.useEffect(() => {
    if (firstQuestion && asked.current !== firstQuestion) { asked.current = firstQuestion; ask(firstQuestion); }
  }, [firstQuestion, ask]);

  // New Chat from the panel header.
  React.useEffect(() => { if (resetKey) { setTurns([]); setText(""); asked.current = ""; boxRef.current?.focus(); } }, [resetKey]);
  React.useEffect(() => { onCount?.(turns.length); }, [turns.length, onCount]);

  const last = turns[turns.length - 1];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatThread label="Conversation" stick={last?.id} innerClassName="space-y-5 px-4 py-4">
        {turns.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <MarkTile size="xl" />
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={t.id} className="space-y-4">
              <UserMessage text={t.question} at={t.at} />
              <Reply turn={t} live={i === turns.length - 1} onAsk={(q) => ask(q)} />
            </div>
          ))
        )}
      </ChatThread>
      <div className="shrink-0 space-y-2.5 px-3 pb-3 pt-2">
        {turns.length === 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SuggestionChips label="Suggested questions" items={SUGGESTED.map((s) => s.text)} onPick={(q) => ask(q)} />
            <button type="button" onClick={() => ask(HELP.q, HELP.a)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[0.8125rem] font-medium text-[#035D53] hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-[#52FCE3]">
              <IconHelpCircle className="size-4" aria-hidden="true" />Help
            </button>
          </div>
        )}
        <Composer
          inputRef={boxRef}
          value={text}
          onChange={setText}
          onSend={(v) => ask(v)}
          placeholder="Ask about patients, results or beds"
        />
      </div>
    </div>
  );
}
