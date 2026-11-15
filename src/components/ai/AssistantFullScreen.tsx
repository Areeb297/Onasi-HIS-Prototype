import * as React from "react";
import {
  IconArrowUp, IconChevronDown, IconHelpCircle, IconHistory, IconMessagePlus, IconMinimize, IconRefresh, IconSearch, IconTrash, IconX,
} from "@tabler/icons-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { Reply } from "@/components/ai/AssistantChat";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { cn } from "@/components/ui/primitives";
import { checkNow } from "@/lib/ai/agent-work";
import { AGENT_BY_ID } from "@/lib/ai/agents";
import { SUGGESTED, answer, patientChoices } from "@/lib/ai/assistant";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import {
  chatDate, chatTopics, fixedAnswer, loadChats, putChat, removeChat, saveChats, searchChats, titleOf, type ChatTurn, type SavedChat,
} from "@/lib/ai/chat-history";
import { audit } from "@/lib/audit";

/**
 * Onasi AI on the whole screen: a dark green header bar, past chats on the left, and in the middle a welcome with
 * topics and suggested questions, or the open chat, with the box to type in at the bottom.
 *
 * The chats are kept in the browser for each user (chat-history.ts). A chat opened from the list is a transcript:
 * its findings have no action buttons, since the record may have changed. "Check Again" under a reply asks afresh.
 *
 * Colours: Onasi Dark Green #032C26 for the header and Cyan #39EDD5 for accents. Cards are plain, with no green tint.
 */

const DEEP = "bg-[#032C26]";
const headerBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#39EDD5]";
const headerSelect = "h-9 max-w-44 truncate rounded-lg border border-white/20 bg-white/10 px-2.5 text-sm text-white outline-none transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-[#39EDD5] [&>option]:text-black";

export type AssistantScope = "hospital" | "chart";

export function AssistantFullScreen({
  userId, firstQuestion, scope, onScope, chartLabel, chartTools, onExitFull, onClose,
}: {
  userId: string;
  /** A question passed in from another page. Asked once. */
  firstQuestion?: string;
  scope: AssistantScope;
  onScope: (s: AssistantScope) => void;
  /** The open chart in words, for the scope list. Empty when no chart is open. */
  chartLabel: string;
  /** The tools for the open chart (the This Chart tab of the side panel). */
  chartTools: React.ReactNode;
  onExitFull: () => void;
  onClose: () => void;
}) {
  const [chats, setChats] = React.useState<SavedChat[]>(() => loadChats(userId));
  const [chatId, setChatId] = React.useState<string>(() => `C${Date.now()}`);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  /** Turns asked in this sitting. Only these play the "reading the record" steps and keep their action buttons. */
  const fresh = React.useRef(new Set<number>());
  const [text, setText] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [find, setFind] = React.useState("");
  const [openTopic, setOpenTopic] = React.useState<string | null>(null);
  const [listOpen, setListOpen] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const asked = React.useRef("");
  const choices = React.useMemo(() => patientChoices(), []);
  const topics = React.useMemo(() => chatTopics(), []);

  // Another user signed in: show that user's chats and start clean.
  React.useEffect(() => {
    setChats(loadChats(userId));
    setTurns([]);
    setChatId(`C${Date.now()}`);
    fresh.current.clear();
  }, [userId]);

  const scroll = React.useCallback(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), []);

  const keep = React.useCallback((id: string, next: ChatTurn[]) => {
    setChats((list) => {
      const out = putChat(list, { id, title: titleOf(next[0].question), at: next[next.length - 1].at, turns: next });
      saveChats(userId, out);
      return out;
    });
  }, [userId]);

  const ask = React.useCallback((q: string, fixed?: string) => {
    const question = q.trim();
    if (!question) return;
    let a;
    if (fixed) {
      a = fixedAnswer(fixed);
      audit("ai-suggest", `Assistant question: ${question}`, { detail: "Answered from the questions and answers list" });
    } else {
      checkNow(); // so every finding in the answer is a tracked task with its real state
      const who = choices.find((c) => c.id === about);
      a = answer(question, new Date(), who ? { name: who.name, visits: who.visits } : undefined);
      audit("ai-suggest", `Assistant question: ${question}`, { detail: a.agent ? `${AGENT_BY_ID[a.agent].name}. ${a.text}` : "Not understood" });
    }
    const turn: ChatTurn = { id: Date.now(), at: new Date().toISOString(), question, answer: a };
    fresh.current.add(turn.id);
    setTurns((t) => {
      const next = [...t, turn];
      keep(chatId, next);
      return next;
    });
    setText("");
    if (scope !== "hospital") onScope("hospital");
    window.setTimeout(scroll, 60);
  }, [about, chatId, choices, keep, onScope, scope, scroll]);

  React.useEffect(() => {
    if (firstQuestion && asked.current !== firstQuestion) { asked.current = firstQuestion; ask(firstQuestion); }
  }, [firstQuestion, ask]);

  const newChat = () => {
    setTurns([]);
    setChatId(`C${Date.now()}`);
    fresh.current.clear();
    asked.current = "";
    setOpenTopic(null);
    setListOpen(false);
    onScope("hospital");
    boxRef.current?.focus();
  };
  const openChat = (c: SavedChat) => {
    fresh.current.clear();
    setChatId(c.id);
    setTurns(c.turns);
    setListOpen(false);
    onScope("hospital");
    window.setTimeout(scroll, 60);
  };
  const deleteChat = (c: SavedChat) => {
    setChats((list) => { const out = removeChat(list, c.id); saveChats(userId, out); return out; });
    if (c.id === chatId) newChat();
  };

  const shownChats = searchChats(chats, find);
  const empty = turns.length === 0;
  const last = turns[turns.length - 1];

  const history = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="p-3">
        <button type="button" onClick={newChat} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#032C26] text-sm font-semibold text-white transition-colors hover:bg-[#06443b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <IconMessagePlus className="size-4 text-[#39EDD5]" aria-hidden="true" /> New
        </button>
        <label className="relative mt-3 block">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Search chats"
            aria-label="Search past chats"
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-2.5 text-sm placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>
      <h2 className="px-4 pb-1.5 text-xs font-semibold text-muted-foreground">Past Chats</h2>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="Past chats">
        {shownChats.length === 0 && (
          <li className="px-2 py-3 text-sm text-muted-foreground">{chats.length ? "No chat matches your search." : "No chats yet. Your chats are kept here, on this browser, for you only."}</li>
        )}
        {shownChats.map((c) => (
          <li key={c.id} className={cn("group flex items-center gap-1 rounded-lg", c.id === chatId && !empty ? "bg-card shadow-xs ring-1 ring-border" : "hover:bg-card")}>
            <button type="button" onClick={() => openChat(c)} aria-current={c.id === chatId && !empty ? "true" : undefined} className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
              <span className="block truncate text-sm font-medium">{c.title}</span>
              <span className="block text-xs text-muted-foreground">{chatDate(c.at)}</span>
            </button>
            <button type="button" onClick={() => deleteChat(c)} aria-label={`Delete the chat: ${c.title}`} title="Delete This Chat" className="me-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring md:opacity-0 md:group-hover:opacity-100">
              <IconTrash className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const aboutSelect = (cls: string) => (
    <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="Ask about one patient or all patients" className={cls}>
      <option value="">All Patients</option>
      {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
  const scopeSelect = (cls: string) => (
    <select value={scope} onChange={(e) => onScope(e.target.value as AssistantScope)} aria-label="What to ask about" className={cls}>
      <option value="hospital">The Hospital</option>
      <option value="chart" disabled={!chartLabel}>{chartLabel ? `This Chart: ${chartLabel}` : "This Chart (open a chart first)"}</option>
    </select>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header bar */}
      <header className={cn("flex shrink-0 items-center gap-3 px-3 py-2.5 text-white sm:px-5", DEEP)}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#39EDD5]"><OnasiAiMark size={26} /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-base font-semibold">{ASSISTANT_NAME}</h1>
          <p className="truncate text-xs text-white/70">Ask me anything about the patients, results and visits in this hospital.</p>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {scopeSelect(headerSelect)}
          {aboutSelect(headerSelect)}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={cn(headerBtn, "md:hidden")} onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} aria-label="Past chats" title="Past Chats">
            <IconHistory className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={headerBtn} onClick={() => (last && scope === "hospital" ? ask(last.question) : newChat())} aria-label={last ? "Check again" : "Start again"} title={last ? "Check Again: ask the last question against the record as it is now" : "Start Again"}>
            <IconRefresh className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={headerBtn} onClick={onExitFull} aria-label="Exit Full Screen" title="Exit Full Screen (Esc)">
            <IconMinimize className="size-5" aria-hidden="true" /><span className="hidden xl:inline">Exit Full Screen</span>
          </button>
          <button type="button" className={headerBtn} onClick={onClose} aria-label={`Close ${ASSISTANT_NAME}`} title="Close">
            <IconX className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Past chats: a column from tablet width up, a drawer on a phone */}
        <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/40 md:block" aria-label="Chats">{history}</aside>
        {listOpen && (
          <div className="absolute inset-0 z-20 flex md:hidden">
            <aside className="h-full w-[min(20rem,85%)] border-r border-border bg-background shadow-xl" aria-label="Chats">{history}</aside>
            <button type="button" className="flex-1 bg-black/40" aria-label="Close the list of chats" onClick={() => setListOpen(false)} />
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {/* The two lists move here when the header has no room for them */}
          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2 lg:hidden">
            {scopeSelect("h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-sm")}
            {scope === "hospital" && aboutSelect("h-9 min-w-0 flex-1 rounded-lg border border-input bg-card px-2.5 text-sm")}
          </div>

          {scope === "chart" && chartLabel ? (
            <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">{chartTools}</div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
                  {empty ? (
                    <>
                      <div className="text-center">
                        <span className={cn("mx-auto flex size-14 items-center justify-center rounded-2xl text-[#39EDD5]", DEEP)}><OnasiAiMark size={34} /></span>
                        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Welcome to {ASSISTANT_NAME}</h2>
                        <p className="mt-1.5 text-sm text-muted-foreground">Select a topic or ask a question below</p>
                      </div>
                      <ul className="mt-6 space-y-2.5" aria-label="Topics">
                        {topics.map((t) => {
                          const open = openTopic === t.id;
                          return (
                            <li key={t.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                              <button
                                type="button"
                                onClick={() => setOpenTopic(open ? null : t.id)}
                                aria-expanded={open}
                                aria-controls={`topic-${t.id}`}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                              >
                                {t.agent
                                  ? <AgentIcon agent={t.agent} />
                                  : <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true"><IconHelpCircle className="size-5" stroke={1.75} /></span>}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold">{t.title}</span>
                                  <span className="block text-xs text-muted-foreground">{t.questions.length} questions</span>
                                </span>
                                <IconChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
                              </button>
                              {open && (
                                <ul id={`topic-${t.id}`} className="divide-y divide-border border-t border-border">
                                  {t.questions.map((x) => (
                                    <li key={x.q}>
                                      <button type="button" onClick={() => ask(x.q, x.a)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                                        <span className="size-1.5 shrink-0 rounded-full bg-[#39EDD5]" aria-hidden="true" />{x.q}
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div className="space-y-6" aria-live="polite">
                      {turns.map((t, i) => (
                        <div key={t.id} className="space-y-4">
                          <div className="flex justify-end">
                            <p className={cn("max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-[0.9375rem] text-white", DEEP)}>{t.question}</p>
                          </div>
                          <Reply turn={t} live={i === turns.length - 1 && fresh.current.has(t.id)} onAsk={(q) => ask(q)} onSettled={scroll} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div ref={endRef} className="h-2" />
                </div>
              </div>

              {/* Suggested questions and the box to type in */}
              <div className="shrink-0 border-t border-border bg-background">
                <div className="mx-auto w-full max-w-4xl px-4 pb-2 pt-3 sm:px-6">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-semibold text-muted-foreground">Suggested Questions</span>
                    <ul className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:thin]">
                      {(empty ? SUGGESTED.map((s) => s.text) : last.answer.followUps.length ? last.answer.followUps : SUGGESTED.map((s) => s.text)).map((q) => (
                        <li key={q} className="shrink-0">
                          <button type="button" onClick={() => ask(q)} className="rounded-full border border-border bg-card px-3 py-1.5 text-[0.8125rem] whitespace-nowrap transition-colors hover:border-[#39EDD5] hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">{q}</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <form
                    onSubmit={(e) => { e.preventDefault(); ask(text); }}
                    className="mt-2.5 flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition-shadow focus-within:border-[#032C26]/50 focus-within:ring-4 focus-within:ring-[#39EDD5]/25"
                  >
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
                    <button type="submit" disabled={!text.trim()} aria-label="Send the question" className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl text-[#39EDD5] transition-opacity hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35", DEEP)}>
                      <IconArrowUp className="size-5" stroke={2.25} aria-hidden="true" />
                    </button>
                  </form>
                  <p className="pt-2 text-center text-xs text-muted-foreground">AI can make mistakes. Check important information.</p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
