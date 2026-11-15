import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { IconArrowDown, IconArrowUp, IconCheck, IconChevronDown, IconCopy, IconDatabase, IconHelpCircle, IconRefresh, IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { AgentIcon } from "@/components/ai/AgentIcon";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { cn } from "@/components/ui/primitives";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { chatTopics } from "@/lib/ai/chat-history";

/**
 * The parts every Onasi AI chat is built from: the scrolling thread with "Jump To Latest", the two message shapes,
 * the thinking dots, the word-by-word reveal, the composer, suggestion chips, source chips and the reply actions.
 * Patterns adapted from 21st.dev (Hirael "Message Thread", "AI Message", "Suggestions", "AI Prompt Input",
 * "Conversation List") onto the Onasi light glass: white frosted cards, Dark Green #032C26 ink, Cyan #39EDD5 accents.
 */

export const MAX_CHARS = 500;

/** The one filled button colour in the assistant: Dark Green, Cyan in dark mode. */
export const BRAND_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#032C26] font-medium text-white shadow-[0_4px_14px_-8px_rgba(3,44,38,0.6)] transition-colors hover:bg-[#0a4036] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 dark:bg-[#39EDD5] dark:text-[#032C26] dark:hover:bg-[#52FCE3]";
/** A quiet outline button on glass. */
export const GLASS_BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[rgba(20,32,28,0.12)] bg-white/70 font-medium text-[#032C26] transition-colors hover:border-[#03C1AC]/60 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-foreground dark:hover:bg-white/10";
/** Icon-only button for toolbars on light surfaces. */
export const ICON_BTN =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[#032C26]/[0.06] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-white/10";
/** A suggestion or follow-up chip. */
export const CHIP =
  "rounded-full border border-[#03C1AC]/35 bg-white/75 px-3 py-1.5 text-left text-[0.8125rem] leading-snug text-[#032C26] transition-colors hover:border-[#03C1AC] hover:bg-[#39EDD5]/10 focus-visible:outline-2 focus-visible:outline-ring dark:border-[#39EDD5]/25 dark:bg-white/5 dark:text-foreground dark:hover:bg-[#39EDD5]/10";
/** Accent text that passes contrast: deep cyan on light, bright cyan on dark. */
export const CYAN_TEXT = "text-[#035D53] dark:text-[#52FCE3]";

/** A small status label in brand colours. Red is kept for urgent only. */
export function BrandBadge({ tone = "cyan", children }: { tone?: "cyan" | "ink" | "urgent"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium leading-none whitespace-nowrap",
      tone === "urgent" ? "bg-destructive/10 text-destructive" : tone === "ink" ? "bg-[#032C26]/[0.07] text-[#032C26] dark:bg-white/10 dark:text-foreground" : "bg-[#39EDD5]/15 text-[#035D53] dark:text-[#52FCE3]")}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ---------- Thread ---------- */

/**
 * The scrolling message list. It follows new content while the reader is at the bottom, stops when they scroll up,
 * and offers "Jump To Latest" until they come back. `stick` changes when the user sends, which pins it again.
 */
export function ChatThread({ children, label, stick, className, innerClassName }: {
  children: React.ReactNode; label: string; stick?: unknown; className?: string; innerClassName?: string;
}) {
  const viewport = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(true);
  const auto = React.useRef(false);
  const [atBottom, setAtBottom] = React.useState(true);
  const reduce = useReducedMotion();

  const toBottom = React.useCallback((smooth = true) => {
    const el = viewport.current;
    if (!el) return;
    pinned.current = true;
    auto.current = true;
    setAtBottom(true);
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, [reduce]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
    if (auto.current) { if (!near) return; auto.current = false; }
    pinned.current = near;
    setAtBottom(near);
  };

  // Content grows without this component re-rendering (a reply revealing word by word), so watch its size.
  React.useLayoutEffect(() => {
    const v = viewport.current, c = content.current;
    if (!v || !c || typeof ResizeObserver === "undefined") return;
    v.scrollTop = v.scrollHeight;
    const ro = new ResizeObserver(() => { if (pinned.current) v.scrollTop = v.scrollHeight; });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => { if (stick !== undefined) toBottom(false); }, [stick, toBottom]);

  return (
    <div className={cn("relative min-h-0 flex-1", className)}>
      <div ref={viewport} onScroll={onScroll} role="log" aria-label={label} className="h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        <div ref={content} className={innerClassName}>{children}</div>
      </div>
      {!atBottom && (
        <button type="button" onClick={() => toBottom()} className="glass-pill absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 px-3.5 py-1.5 text-[0.8125rem] font-medium text-[#032C26] shadow-lg hover:bg-white focus-visible:outline-2 focus-visible:outline-ring dark:text-foreground">
          <IconArrowDown className="size-4" aria-hidden="true" /> Jump To Latest
        </button>
      )}
    </div>
  );
}

/* ---------- Messages ---------- */

/** The user's message: a Dark Green bubble on the right. The time shows on hover, and always on touch screens. */
export function UserMessage({ text, at }: { text: string; at?: string }) {
  return (
    <div className="group flex flex-col items-end gap-1">
      <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-ee-md bg-[#032C26] px-4 py-2.5 text-[0.9375rem] leading-relaxed text-white shadow-[0_6px_18px_-12px_rgba(3,44,38,0.7)] dark:bg-[#0f3d35] dark:ring-1 dark:ring-[#39EDD5]/20">
        <span className="sr-only">You said: </span>{text}
      </p>
      {at && <time dateTime={at} className="px-1 text-xs tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">{clock(at)}</time>}
    </div>
  );
}

/** The assistant's side: the Onasi mark on the left, the reply beside it. */
export function AssistantMessage({ children, thinking = false }: { children: React.ReactNode; thinking?: boolean }) {
  return (
    <div className="group flex items-start gap-2.5 sm:gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#032C26] ring-2 ring-white/70 dark:ring-white/10" aria-hidden="true">
        <OnasiAiMark size={18} thinking={thinking} />
      </span>
      <div className="min-w-0 flex-1 space-y-2.5">{children}</div>
    </div>
  );
}

/** Three dots while the assistant works. Still under reduced motion. */
export function TypingDots({ label = `${ASSISTANT_NAME} is thinking` }: { label?: string }) {
  return (
    <div role="status" className="glass-card inline-flex items-center gap-2 rounded-2xl rounded-ss-md px-4 py-3">
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 160, 320].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-[#03C1AC] motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />)}
      </span>
      <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Reveals text a few words at a time, the way a streamed reply arrives. Off when `animate` is false or the user asks
 * for reduced motion. Waits until `start`. Returns the text to show and whether it is complete.
 */
export function useReveal(text: string, animate: boolean, start = true): [string, boolean] {
  const reduce = useReducedMotion();
  const words = React.useMemo(() => text.match(/\S+\s*/g) ?? [], [text]);
  const on = animate && !reduce;
  const [n, setN] = React.useState(on ? 0 : words.length);
  const step = Math.max(1, Math.ceil(words.length / 45));
  React.useEffect(() => {
    if (!on) { setN(words.length); return; }
    if (!start || n >= words.length) return;
    const t = window.setTimeout(() => setN((x) => Math.min(words.length, x + step)), 30);
    return () => window.clearTimeout(t);
  }, [on, start, n, words.length, step]);
  const done = n >= words.length;
  return [done ? text : words.slice(0, n).join(""), done];
}

/** Text that reveals as it streams. Screen readers get it once, whole, when it is complete. */
export function RevealText({ text, live, start = true, className }: { text: string; live: boolean; start?: boolean; className?: string }) {
  const [shown, done] = useReveal(text, live, start);
  if (done) return <p className={className}>{text}</p>;
  return (
    <p className={className} aria-hidden="true">
      {shown}
      <span className="ms-0.5 inline-block h-[1em] w-[0.45em] translate-y-[0.15em] animate-pulse rounded-[1px] bg-[#03C1AC] motion-reduce:animate-none" />
    </p>
  );
}

/** Small chips naming what was read. */
export function SourceChips({ sources }: { sources: string[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><IconDatabase className="size-3.5" aria-hidden="true" />Sources</span>
      <ul className="contents">
        {sources.map((s, i) => <li key={`${s}-${i}`} className="rounded-full border border-[rgba(20,32,28,0.1)] bg-white/70 px-2 py-0.5 text-xs text-[#032C26]/80 dark:border-white/10 dark:bg-white/5 dark:text-foreground/80">{s}</li>)}
      </ul>
    </div>
  );
}

/**
 * The quiet row under a reply: copy, the rating, Check Again, the sources and the time. It fades in on hover or
 * keyboard focus (always shown on touch screens and on the latest reply), so a finished reply reads clean.
 */
export function ReplyActions({ copyText, at, sources = [], onAgain, onRate, pinned = false }: {
  copyText: string; at?: string; sources?: string[]; onAgain?: () => void; onRate?: (v: "up" | "down") => void; pinned?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);
  const [vote, setVote] = React.useState<"up" | "down" | null>(null);
  const [showSrc, setShowSrc] = React.useState(false);
  const rate = (v: "up" | "down") => { if (vote === v) return; setVote(v); onRate?.(v); };
  const keep = pinned || vote || showSrc || copied;
  return (
    <div className="space-y-2">
      <div role="toolbar" aria-label="Reply actions" className={cn("flex flex-wrap items-center gap-0.5 transition-opacity motion-reduce:transition-none", !keep && "opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100")}>
        <button type="button" className={ICON_BTN} title={copied ? "Copied" : "Copy"} aria-label={copied ? "Copied" : "Copy the reply"} onClick={() => { void navigator.clipboard?.writeText(copyText).catch(() => undefined); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
          {copied ? <IconCheck className="size-4 text-[#03C1AC]" aria-hidden="true" /> : <IconCopy className="size-4" aria-hidden="true" />}
        </button>
        {onRate && (
          <>
            <button type="button" className={cn(ICON_BTN, vote === "up" && "bg-[#39EDD5]/15 text-[#035D53] dark:text-[#52FCE3]")} title="Helpful" aria-label="Helpful" aria-pressed={vote === "up"} onClick={() => rate("up")}><IconThumbUp className="size-4" aria-hidden="true" /></button>
            <button type="button" className={cn(ICON_BTN, vote === "down" && "bg-[#032C26]/[0.08] text-[#032C26] dark:bg-white/10 dark:text-foreground")} title="Not helpful" aria-label="Not helpful" aria-pressed={vote === "down"} onClick={() => rate("down")}><IconThumbDown className="size-4" aria-hidden="true" /></button>
          </>
        )}
        {onAgain && <button type="button" className={ICON_BTN} title="Check Again" aria-label="Check again" onClick={onAgain}><IconRefresh className="size-4" aria-hidden="true" /></button>}
        {sources.length > 0 && (
          <button type="button" className={cn(ICON_BTN, "w-auto gap-1 px-2 text-xs font-medium", showSrc && "bg-[#39EDD5]/12 text-[#035D53] dark:text-[#52FCE3]")} aria-expanded={showSrc} onClick={() => setShowSrc((s) => !s)}>
            <IconDatabase className="size-3.5" aria-hidden="true" />Sources
          </button>
        )}
        <span className="ms-1.5 text-xs text-muted-foreground" aria-live="polite">
          {vote ? "Thanks, rating recorded." : at ? <time dateTime={at}>{clock(at)}</time> : null}
        </span>
      </div>
      {showSrc && <SourceChips sources={sources} />}
    </div>
  );
}

/** A row of question chips. `scroll` keeps them on one line that scrolls sideways (above the composer). */
export function SuggestionChips({ items, onPick, label, scroll = false, max = 3 }: { items: string[]; onPick: (q: string) => void; label: string; scroll?: boolean; max?: number }) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className={cn("flex gap-1.5", scroll ? "overflow-x-auto p-0.5 [scrollbar-width:none]" : "flex-wrap")}>
      {items.slice(0, max).map((q) => (
        <li key={q} className="shrink-0">
          <button type="button" onClick={() => onPick(q)} className={cn(CHIP, scroll && "whitespace-nowrap")}>{q}</button>
        </li>
      ))}
    </ul>
  );
}

/* ---------- Composer ---------- */

/**
 * The box to type in. Grows with the text up to a limit, then scrolls. Enter sends, Shift+Enter starts a new line.
 * A visible count shows the character limit. `extra` sits on the left of the footer (for example the About list).
 */
export function Composer({ value, onChange, onSend, placeholder, label = `Ask ${ASSISTANT_NAME}`, busy = false, extra, inputRef, autoFocus }: {
  value: string; onChange: (v: string) => void; onSend: (v: string) => void; placeholder: string; label?: string; busy?: boolean;
  extra?: React.ReactNode; inputRef?: React.RefObject<HTMLTextAreaElement | null>; autoFocus?: boolean;
}) {
  const id = React.useId();
  const near = value.length >= MAX_CHARS * 0.9;
  const send = () => { if (value.trim() && !busy) onSend(value); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} className="glass-panel rounded-2xl p-1.5 transition-shadow focus-within:border-[#03C1AC]/60 focus-within:shadow-[0_0_0_4px_rgba(57,237,213,0.18)]">
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={value}
          autoFocus={autoFocus}
          maxLength={MAX_CHARS}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          rows={1}
          aria-label={label}
          aria-describedby={`${id}-count ${id}-keys`}
          placeholder={placeholder}
          className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[0.9375rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none"
        />
        <button type="submit" disabled={!value.trim() || busy} aria-label="Send" title="Send (Enter)" className={cn(BRAND_BTN, "mb-0.5 me-0.5 size-10 shrink-0 rounded-xl")}>
          <IconArrowUp className="size-5" stroke={2.25} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-0.5">
        {extra}
        <span id={`${id}-keys`} className="sr-only">Enter sends. Shift and Enter starts a new line.</span>
        <span id={`${id}-count`} className={cn("ms-auto text-xs tabular-nums", near ? "font-semibold text-[#032C26] dark:text-foreground" : "text-muted-foreground/80")} aria-live={near ? "polite" : "off"}>
          <span className="sr-only">Characters used: </span>{value.length}/{MAX_CHARS}
        </span>
      </div>
    </form>
  );
}

/* ---------- Welcome ---------- */

/** The empty chat: the mark, one line, and the topics with how many questions each holds. */
export function ChatWelcome({ onAsk, compact = false, title = `Welcome to ${ASSISTANT_NAME}` }: { onAsk: (q: string, fixed?: string) => void; compact?: boolean; title?: string }) {
  const topics = React.useMemo(() => chatTopics(), []);
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className={cn("mx-auto w-full max-w-3xl", compact ? "pt-2" : "pt-4 sm:pt-10")}>
      <div className={cn("flex items-center gap-3", !compact && "flex-col text-center")}>
        <span className={cn("flex shrink-0 items-center justify-center rounded-2xl bg-[#032C26] shadow-[0_10px_30px_-16px_rgba(3,44,38,0.8)]", compact ? "size-11" : "size-14")}>
          <OnasiAiMark size={compact ? 26 : 32} />
        </span>
        <h2 className={cn("font-semibold tracking-tight text-[#032C26] dark:text-foreground", compact ? "text-lg" : "text-2xl")}>{title}</h2>
      </div>
      <ul className={cn("space-y-2.5", compact ? "mt-5" : "mt-8")} aria-label="Topics">
        {topics.map((t) => {
          const on = open === t.id;
          return (
            <li key={t.id} className="glass-card overflow-hidden rounded-xl">
              <button type="button" onClick={() => setOpen(on ? null : t.id)} aria-expanded={on} aria-controls={`topic-${t.id}`}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring dark:hover:bg-white/5">
                {t.agent ? <AgentIcon agent={t.agent} /> : <span className="glass-icon flex size-9 shrink-0 items-center justify-center rounded-lg" aria-hidden="true"><IconHelpCircle className="size-5" stroke={1.75} /></span>}
                <span className="min-w-0 flex-1 text-sm font-semibold text-[#032C26] dark:text-foreground">{t.title}</span>
                <span className="rounded-full bg-[#39EDD5]/15 px-2 py-0.5 text-xs font-medium tabular-nums text-[#035D53] dark:text-[#52FCE3]">{t.questions.length}<span className="sr-only"> questions</span></span>
                <IconChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", on && "rotate-180")} aria-hidden="true" />
              </button>
              {on && (
                <ul id={`topic-${t.id}`} className="border-t border-[rgba(20,32,28,0.07)] py-1 dark:border-white/5">
                  {t.questions.map((x) => (
                    <li key={x.q}>
                      <button type="button" onClick={() => onAsk(x.q, x.a)} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#39EDD5]/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
                        <span className="size-1.5 shrink-0 rounded-full bg-[#03C1AC]" aria-hidden="true" />{x.q}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
