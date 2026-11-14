import * as React from "react";
import { IconArrowUp, IconCheck, IconChevronDown, IconCopy, IconDatabase, IconMessagePlus, IconRefresh, IconThumbDown, IconThumbUp, IconUserSearch } from "@tabler/icons-react";
import { Check, ChevronRight } from "lucide-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { approveTask, checkNow, dismissTask, isShortcut, runAction, useAgentWork } from "@/lib/ai/agent-work";
import { AGENT_BY_ID, type Proposal } from "@/lib/ai/agents";
import { SUGGESTED, answer, patientChoices, type Answer } from "@/lib/ai/assistant";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { audit } from "@/lib/audit";

/**
 * Ask Onasi AI: a chat about the whole hospital. Each answer shows what the assistant read first, then what it found.
 * A finding that changes a record carries an Approve button. Nothing is changed by asking.
 */

interface Turn {
  id: number;
  at: string;
  question: string;
  answer: Answer;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** The answer as plain text, for the Copy button. */
function plain(t: Turn): string {
  const a = t.answer;
  return [`Question: ${t.question}`, a.text, ...a.items.map((p) => `- ${p.patient}${p.visit ? ` (${p.visit})` : ""}: ${p.text} Why: ${p.why}`)].join("\n");
}

/** The quiet bar under a reply: copy, check again, and whether the answer helped. */
function ReplyActions({ turn, onAgain }: { turn: Turn; onAgain: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const [vote, setVote] = React.useState<"up" | "down" | null>(null);
  const btn = "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";
  function rate(v: "up" | "down") {
    if (vote === v) return;
    setVote(v);
    audit(v === "up" ? "ai-accept" : "ai-reject", `Assistant answer rated ${v === "up" ? "helpful" : "not helpful"}`, { detail: `${turn.question} ${turn.answer.text}` });
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <button type="button" className={btn} title="Copy the answer" aria-label="Copy the answer" onClick={() => { void navigator.clipboard?.writeText(plain(turn)).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
        {copied ? <IconCheck className="size-4 text-ok" aria-hidden="true" /> : <IconCopy className="size-4" aria-hidden="true" />}
      </button>
      <button type="button" className={btn} title="Check again" aria-label="Check again" onClick={onAgain}><IconRefresh className="size-4" aria-hidden="true" /></button>
      <button type="button" className={cn(btn, vote === "up" && "bg-ok/10 text-ok")} title="Helpful" aria-label="Helpful" aria-pressed={vote === "up"} onClick={() => rate("up")}><IconThumbUp className="size-4" aria-hidden="true" /></button>
      <button type="button" className={cn(btn, vote === "down" && "bg-destructive/10 text-destructive")} title="Not helpful" aria-label="Not helpful" aria-pressed={vote === "down"} onClick={() => rate("down")}><IconThumbDown className="size-4" aria-hidden="true" /></button>
      <span className="ms-2 text-xs text-muted-foreground">{vote ? "Thank you. Your rating is recorded." : `Answered ${clock(turn.at)} from the live record`}</span>
    </div>
  );
}

const STEP_MS = 380;

/** Questions staff ask before they trust an assistant, answered plainly. */
const FAQ: { q: string; a: string }[] = [
  { q: "What can I ask?", a: "Three things for now: are there critical results the doctor has not seen, who can go home today and what still blocks them, and the shift handoff. You can name a patient or choose one in the About box to narrow the answer." },
  { q: "Does it change anything in the record?", a: "No. It reads the record and points at what needs you. The Critical Result Chaser also notifies the attending doctor by itself, which changes nothing in the record. Where a step would send something, it shows an Approve button and waits." },
  { q: "Where do the answers come from?", a: "From the live record in this system: the visit lists, charts, orders, results and the NPHIES send list. Each answer shows what was read before it shows what was found. It does not use the internet or outside data." },
  { q: "Which patients can it read?", a: "The same ones you can. It works with your role and permissions. Confidential charts stay closed unless you have broken the glass, and it will not match a confidential patient by name." },
  { q: "Is this a language model?", a: "Not in this version. The checks are fixed rules and the chat matches your words to one of its topics. When a question is outside them it says so. A language model can be connected later behind the same screens." },
  { q: "Who can see what I asked?", a: "Every question, approval and dismissal is written to the audit trail with your name and the time. Compliance staff can review it on the Audit page." },
  { q: "Can it give a diagnosis or choose a treatment?", a: "No. It finds missing data, waiting results and late steps. Clinical decisions stay with the doctor and the nurse. It is not a medical device." },
];

function Finding({ p }: { p: Proposal }) {
  const work = useAgentWork();
  const task = work.tasks[p.id];
  const opens = isShortcut(p.action);
  const status = task?.status;
  const closed = status && status !== "waiting";
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", p.level === "high" ? "bg-destructive" : p.level === "medium" ? "bg-warn" : "bg-ok")} aria-hidden="true" />
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{p.patient}</span>
          {p.level === "high" && <Badge tone="danger">Urgent</Badge>}
          {p.level === "medium" && <Badge tone="warn">Soon</Badge>}
        </div>
        <p className="mt-0.5 text-sm">{p.text}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Why: {p.why}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {status === "done-user" && <Badge tone="ok">Approved</Badge>}
        {status === "done-agent" && <Badge tone="ok">Done By The Agent</Badge>}
        {status === "resolved" && <Badge tone="ok">Fixed</Badge>}
        {status === "dismissed" && <Badge tone="neutral">Dismissed</Badge>}
        {status === "failed" && <Badge tone="danger">Did Not Go Through</Badge>}
        {!closed && p.action && (
          <>
            <Button size="sm" variant={opens ? "secondary" : "primary"} onClick={() => (task ? approveTask(p.id) : runAction(p.action!))}>
              {opens ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              {opens ? p.action.label : `Approve: ${p.action.label}`}
            </Button>
            {!opens && task && <Button size="sm" variant="ghost" onClick={() => dismissTask(p.id)}>Dismiss</Button>}
          </>
        )}
      </div>
    </li>
  );
}

function Reply({ turn, live, onAsk, onSettled }: { turn: Turn; live: boolean; onAsk: (q: string) => void; onSettled: () => void }) {
  const a = turn.answer;
  const steps = a.run?.steps ?? [];
  const [shown, setShown] = React.useState(live ? 0 : steps.length);
  const [open, setOpen] = React.useState(live);
  const [all, setAll] = React.useState(false);
  const done = shown >= steps.length;

  React.useEffect(() => {
    if (done) { if (live) { setOpen(false); onSettled(); } return; }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(steps.length); return; }
    const t = window.setTimeout(() => setShown((n) => n + 1), STEP_MS);
    return () => window.clearTimeout(t);
    // onSettled is stable enough for this: it only scrolls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, done, live, steps.length]);

  const items = all ? a.items : a.items.slice(0, 6);
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-deep)] text-[var(--brand-mint)]">
        <OnasiAiMark size={19} thinking={!done} />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        {a.agent && steps.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/50">
              <AgentIcon agent={a.agent} size="sm" />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                <span className="font-semibold">{AGENT_BY_ID[a.agent].name}</span>
                <span className="text-muted-foreground"> {done ? `checked ${steps.length} things` : "is checking"}</span>
              </span>
              <IconChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
            </button>
            {open && (
              <ol className="space-y-1.5 border-t border-border bg-muted/30 px-3.5 py-3">
                {steps.slice(0, shown).map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[0.8125rem]">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden="true" />
                    <span>{s.did} <span className="text-muted-foreground">{s.found}</span></span>
                  </li>
                ))}
                {!done && <li className="flex items-center gap-2.5 text-[0.8125rem] text-muted-foreground"><span className="size-3.5 shrink-0 animate-pulse rounded-full bg-muted-foreground/40" aria-hidden="true" />Reading the record</li>}
              </ol>
            )}
          </div>
        )}

        {done && (
          <>
            <p className="text-[0.9375rem] leading-relaxed">{a.text}</p>
            {a.items.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <ul className="divide-y divide-border">{items.map((p) => <Finding key={p.id} p={p} />)}</ul>
                {a.items.length > 6 && (
                  <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-border px-4 py-2 text-left text-[0.8125rem] font-medium text-move hover:bg-muted/50">
                    {all ? "Show Fewer" : `Show All ${a.items.length}`}
                  </button>
                )}
              </div>
            )}
            {a.sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <IconDatabase className="size-3.5" aria-hidden="true" /><span className="font-medium">Read from</span>
                {a.sources.map((s) => <span key={s} className="rounded-md border border-border bg-card px-1.5 py-0.5">{s}</span>)}
              </div>
            )}
            <ReplyActions turn={turn} onAgain={() => onAsk(turn.question)} />
            {a.followUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {a.followUps.map((q) => (
                  <button key={q} type="button" onClick={() => onAsk(q)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[0.8125rem] hover:bg-muted">{q}</button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AssistantChat({ firstQuestion }: { firstQuestion?: string }) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [text, setText] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const asked = React.useRef("");
  const [about, setAbout] = React.useState("");
  const choices = React.useMemo(() => patientChoices(), []);

  const scroll = React.useCallback(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), []);

  const ask = React.useCallback((q: string) => {
    const question = q.trim();
    if (!question) return;
    checkNow(); // so every finding in the answer is a tracked task with its real state
    const who = choices.find((c) => c.id === about);
    const a = answer(question, new Date(), who ? { name: who.name, visits: who.visits } : undefined);
    audit("ai-suggest", `Assistant question: ${question}`, { detail: a.agent ? `${AGENT_BY_ID[a.agent].name}. ${a.text}` : "Not understood" });
    setTurns((t) => [...t, { id: Date.now(), at: new Date().toISOString(), question, answer: a }]);
    setText("");
    window.setTimeout(scroll, 60);
  }, [scroll, about, choices]);

  // A question passed in from an agent card is asked once.
  React.useEffect(() => {
    if (firstQuestion && asked.current !== firstQuestion) { asked.current = firstQuestion; ask(firstQuestion); }
  }, [firstQuestion, ask]);

  const empty = turns.length === 0;
  const composer = (
      <form
        onSubmit={(e) => { e.preventDefault(); ask(text); }}
        className={cn("rounded-2xl text-left", empty ? "mt-6" : "sticky bottom-4", " border border-border bg-card p-2 shadow-lg transition-shadow focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/10")}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={boxRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(text); } }}
            rows={1}
            aria-label={`Ask ${ASSISTANT_NAME}`}
            placeholder="Ask a question, for example: is Almutairi ready to go home?"
            className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[0.9375rem] outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" disabled={!text.trim()} aria-label="Send the question" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35">
            <IconArrowUp className="size-5" stroke={2.25} aria-hidden="true" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-2 pt-1.5">
          <label className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-[0.8125rem]">
            <IconUserSearch className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">About</span>
            <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="Ask about one patient or all patients" className="max-w-44 truncate bg-transparent font-medium outline-none">
              <option value="">All patients</option>
              {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <p className="px-3 pb-1 pt-1.5 text-xs text-muted-foreground">Asking changes nothing. A step that changes a record waits for your approval and goes to the audit trail.</p>
      </form>
  );
  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      {empty ? (
        <div className="pb-6 pt-8 text-center sm:pt-14">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--brand-deep)] text-[var(--brand-mint)]"><OnasiAiMark size={34} /></span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight">Ask about the hospital</h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">{ASSISTANT_NAME} reads the live record and answers with what it found and where. You can name a patient.</p>
          {composer}
          <ul className="mt-4 grid gap-2 text-left sm:grid-cols-3">
            {SUGGESTED.map((s) => (
              <li key={s.agent}>
                <button type="button" onClick={() => ask(s.text)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50">
                  <AgentIcon agent={s.agent} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{s.text}</span>
                    <span className="block truncate text-xs text-muted-foreground">{AGENT_BY_ID[s.agent].name}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section aria-labelledby="ai-faq" className="mt-8 text-left">
            <h3 id="ai-faq" className="text-sm font-semibold">Questions and answers</h3>
            <Accordion type="single" collapsible className="mt-2 rounded-xl border border-border bg-card px-4">
              {FAQ.map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger className="text-left text-sm font-medium">{f.q}</AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-muted-foreground">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </div>
      ) : (
        <div className="space-y-6 pb-6 pt-2" aria-live="polite">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => { setTurns([]); asked.current = ""; }}><IconMessagePlus className="size-4" aria-hidden="true" />New Chat</Button>
          </div>
          {turns.map((t, i) => (
            <div key={t.id} className="space-y-4">
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[0.9375rem] text-primary-foreground">{t.question}</p>
              </div>
              <Reply turn={t} live={i === turns.length - 1} onAsk={ask} onSettled={scroll} />
            </div>
          ))}
        </div>
      )}

      {!empty && composer}
      <div ref={endRef} className="h-4" />
    </div>
  );
}
