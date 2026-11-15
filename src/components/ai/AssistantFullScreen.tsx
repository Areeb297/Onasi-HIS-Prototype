import * as React from "react";
import { IconHistory, IconMessagePlus, IconMinimize, IconRefresh, IconSearch, IconTrash, IconX } from "@tabler/icons-react";
import { Reply, askAssistant } from "@/components/ai/AssistantChat";
import { BRAND_BTN, ChatThread, ChatWelcome, Composer, MarkTile, SuggestionChips, UserMessage } from "@/components/ai/chat-parts";
import { ScopeSwitch, type AssistantScope } from "@/components/ai/ScopeSwitch";
import { cn } from "@/components/ui/primitives";
import { SUGGESTED, patientChoices } from "@/lib/ai/assistant";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { loadChats, putChat, removeChat, saveChats, searchChats, titleOf, type ChatTurn, type SavedChat } from "@/lib/ai/chat-history";

/**
 * Onasi AI on the whole screen: a Dark Green header bar, past chats on the left, and in the middle the welcome with
 * topics, or the open chat, with three suggested questions and the box to type in at the bottom.
 *
 * Chats are kept in the browser for each user (chat-history.ts). A chat opened from the list is a transcript: its
 * findings have no action buttons, since the record may have changed. "Check Again" asks afresh.
 */

const headerBtn = "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-[#032C26]/80 transition-colors hover:bg-[#032C26]/[0.07] hover:text-[#032C26] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:text-foreground/80 dark:hover:bg-white/10 dark:hover:text-foreground";
const headerSelect = "glass-pill h-9 max-w-52 truncate px-3.5 text-sm font-medium text-[#032C26] outline-none transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-ring dark:text-foreground dark:hover:bg-white/10 [&>option]:text-black";

export type { AssistantScope };

/** Past chats grouped by day, newest first. */
function groupChats(chats: SavedChat[], now = new Date()): { label: string; chats: SavedChat[] }[] {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const groups: Record<string, SavedChat[]> = {};
  const order = ["Today", "Yesterday", "Last 7 Days", "Older"];
  for (const c of chats) {
    const d = Math.round((day(now) - day(new Date(c.at))) / 86_400_000);
    const g = d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? "Last 7 Days" : "Older";
    (groups[g] ??= []).push(c);
  }
  return order.filter((g) => groups[g]).map((label) => ({ label, chats: groups[label] }));
}

export function AssistantFullScreen({
  userId, firstQuestion, scope, onScope, chartLabel, checks = 0, chartTools, onExitFull, onClose,
}: {
  userId: string;
  /** A question passed in from another page. Asked once. */
  firstQuestion?: string;
  scope: AssistantScope;
  onScope: (s: AssistantScope) => void;
  /** The open chart in words, for the scope list. Empty when no chart is open. */
  chartLabel: string;
  /** Safety checks waiting on the open chart, shown on the switch. */
  checks?: number;
  /** The tools for the open chart (the This Chart tab of the side panel). */
  chartTools: React.ReactNode;
  onExitFull: () => void;
  onClose: () => void;
}) {
  const [chats, setChats] = React.useState<SavedChat[]>(() => loadChats(userId));
  const [chatId, setChatId] = React.useState<string>(() => `C${Date.now()}`);
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  /** Turns asked in this sitting. Only these play the reveal and keep their action buttons. */
  const fresh = React.useRef(new Set<number>());
  const [text, setText] = React.useState("");
  const [about, setAbout] = React.useState("");
  const [find, setFind] = React.useState("");
  const [listOpen, setListOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);
  const asked = React.useRef("");
  const choices = React.useMemo(() => patientChoices(), []);

  // Another user signed in: show that user's chats and start clean.
  React.useEffect(() => {
    setChats(loadChats(userId));
    setTurns([]);
    setChatId(`C${Date.now()}`);
    fresh.current.clear();
  }, [userId]);

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
    const who = choices.find((c) => c.id === about);
    const turn = askAssistant(question, who ? { name: who.name, visits: who.visits } : undefined, fixed);
    fresh.current.add(turn.id);
    setTurns((t) => {
      const next = [...t, turn];
      keep(chatId, next);
      return next;
    });
    setText("");
    if (scope !== "hospital") onScope("hospital");
  }, [about, chatId, choices, keep, onScope, scope]);

  React.useEffect(() => {
    if (firstQuestion && asked.current !== firstQuestion) { asked.current = firstQuestion; ask(firstQuestion); }
  }, [firstQuestion, ask]);

  const newChat = () => {
    setTurns([]);
    setChatId(`C${Date.now()}`);
    fresh.current.clear();
    asked.current = "";
    setListOpen(false);
    onScope("hospital");
    window.setTimeout(() => boxRef.current?.focus(), 0);
  };
  const openChat = (c: SavedChat) => {
    fresh.current.clear();
    setChatId(c.id);
    setTurns(c.turns);
    setListOpen(false);
    onScope("hospital");
  };
  const deleteChat = (c: SavedChat) => {
    setChats((list) => { const out = removeChat(list, c.id); saveChats(userId, out); return out; });
    if (c.id === chatId) newChat();
  };

  const shown = searchChats(chats, find);
  const empty = turns.length === 0;
  const last = turns[turns.length - 1];
  const suggestions = !last || !last.answer.followUps.length ? SUGGESTED.map((s) => s.text) : last.answer.followUps;

  const history = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2.5 p-3">
        <button type="button" onClick={newChat} className={cn(BRAND_BTN, "h-10 w-full text-sm")}>
          <IconMessagePlus className="size-4" aria-hidden="true" /> New Chat
        </button>
        <label className="relative block">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Search chats"
            aria-label="Search past chats"
            className="h-9 w-full rounded-lg border border-[rgba(20,32,28,0.1)] bg-white/80 pl-8 pr-2.5 text-sm placeholder:text-muted-foreground/80 focus-visible:border-[#03C1AC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#39EDD5]/40 dark:border-white/10 dark:bg-white/5"
          />
        </label>
      </div>
      <nav aria-label="Past chats" className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {shown.length === 0 && <p className="px-2 py-3 text-sm text-muted-foreground">{chats.length ? "No match." : "No chats yet."}</p>}
        {groupChats(shown).map((g) => (
          <section key={g.label} className="mb-2">
            <h2 className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{g.label}</h2>
            <ul className="space-y-0.5">
              {g.chats.map((c) => {
                const on = c.id === chatId && !empty;
                return (
                  <li key={c.id} className={cn("group flex items-center rounded-lg transition-colors", on ? "bg-white shadow-[0_1px_2px_rgba(16,24,22,0.06)] ring-1 ring-[rgba(20,32,28,0.08)] dark:bg-white/10 dark:ring-white/10" : "hover:bg-white/70 dark:hover:bg-white/5")}>
                    <button type="button" onClick={() => openChat(c)} aria-current={on ? "true" : undefined} className="relative min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring">
                      {on && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#03C1AC]" aria-hidden="true" />}
                      <span className="block truncate text-sm text-[#032C26] dark:text-foreground">{c.title}</span>
                    </button>
                    <button type="button" onClick={() => deleteChat(c)} aria-label={`Delete the chat: ${c.title}`} title="Delete" className="me-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 pointer-coarse:opacity-70">
                      <IconTrash className="size-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );

  const scopeSwitch = <ScopeSwitch scope={scope} onScope={onScope} chartOpen={!!chartLabel} checks={checks} />;
  const aboutSelect = (cls: string) => (
    <select value={about} onChange={(e) => setAbout(e.target.value)} aria-label="Ask about one patient or all patients" className={cls}>
      <option value="">All Patients</option>
      {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f6faf8] dark:bg-background">
      {/* Header bar: Minty White with a faint mint wash, Dark Green ink, a thin border */}
      <header className="flex shrink-0 items-center gap-3 border-b border-[#032C26]/10 bg-[linear-gradient(90deg,#DAF0E4_0%,#DAF0E4_55%,rgba(104,252,188,0.22)_100%)] px-3 py-2.5 text-[#032C26] sm:px-5 dark:border-white/10 dark:bg-[linear-gradient(90deg,#0b2420,#0c2c26)] dark:text-foreground">
        <MarkTile size="sm" />
        <div className="min-w-0 flex-1 leading-tight">
          <h1 className="truncate text-base font-semibold">{ASSISTANT_NAME}</h1>
          <p className="hidden truncate text-xs text-[#032C26]/70 sm:block dark:text-muted-foreground">Patients, results and visits</p>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          {scopeSwitch}
          {scope === "hospital" && aboutSelect(headerSelect)}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" className={cn(headerBtn, "md:hidden")} onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} aria-label="Past chats" title="Past Chats">
            <IconHistory className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={headerBtn} onClick={() => (last && scope === "hospital" ? ask(last.question) : newChat())} aria-label={last ? "Check again" : "Start again"} title={last ? "Check Again" : "Start Again"}>
            <IconRefresh className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={headerBtn} onClick={onExitFull} aria-label="Exit full screen" title="Exit Full Screen">
            <IconMinimize className="size-5" aria-hidden="true" />
          </button>
          <button type="button" className={headerBtn} onClick={onClose} aria-label={`Close ${ASSISTANT_NAME}`} title="Close (Esc)">
            <IconX className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Past chats: a column from tablet width up, a drawer on a phone */}
        <aside className="hidden w-72 shrink-0 border-e border-[rgba(20,32,28,0.08)] bg-white/45 backdrop-blur-xl md:block dark:border-white/5 dark:bg-white/[0.02]" aria-label="Chats">{history}</aside>
        {listOpen && (
          <div className="absolute inset-0 z-20 flex md:hidden">
            <aside className="h-full w-[min(20rem,85%)] border-e border-border bg-[#f6faf8] shadow-xl dark:bg-background" aria-label="Chats">{history}</aside>
            <button type="button" className="flex-1 bg-[#032C26]/30 backdrop-blur-[2px]" aria-label="Close the list of chats" onClick={() => setListOpen(false)} />
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {/* The context lists move here when the header has no room */}
          <div className="flex gap-2 px-4 pt-3 lg:hidden">
            {scopeSwitch}
            {scope === "hospital" && aboutSelect("glass-pill h-9 min-w-0 flex-1 px-3 text-sm text-foreground")}
          </div>

          {scope === "chart" && chartLabel ? (
            <div className="mx-auto flex min-h-0 w-full max-w-[45rem] flex-1 flex-col">{chartTools}</div>
          ) : (
            <>
              <ChatThread label="Conversation" stick={last?.id ?? chatId} innerClassName="mx-auto w-full max-w-[45rem] px-4 py-6 sm:px-6">
                {empty ? (
                  <ChatWelcome onAsk={ask} />
                ) : (
                  <div className="space-y-6">
                    {turns.map((t, i) => (
                      <div key={t.id} className="space-y-4">
                        <UserMessage text={t.question} at={t.at} />
                        <Reply turn={t} live={i === turns.length - 1 && fresh.current.has(t.id)} onAsk={(q) => ask(q)} followUps={false} />
                      </div>
                    ))}
                  </div>
                )}
              </ChatThread>

              {/* Three suggested questions and the box to type in */}
              <div className="shrink-0">
                <div className="mx-auto w-full max-w-[45rem] space-y-2.5 px-4 pb-3 pt-2 sm:px-6">
                  <SuggestionChips label="Suggested questions" items={suggestions} onPick={(q) => ask(q)} scroll />
                  <Composer inputRef={boxRef} value={text} onChange={setText} onSend={(v) => ask(v)} placeholder="Ask about patients, results or beds" />
                  <p className="text-center text-xs text-muted-foreground">AI can make mistakes. Check important information.</p>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

