import * as React from "react";
import { IconArrowsMaximize, IconMessagePlus, IconX } from "@tabler/icons-react";
import { AssistantChat } from "@/components/ai/AssistantChat";
import { ChartToolGrid } from "@/components/ai/ChartToolGrid";
import { ScopeSwitch } from "@/components/ai/ScopeSwitch";
import { AssistantFullScreen } from "@/components/ai/AssistantFullScreen";
import { AssistantMessage, ChatThread, Composer, ICON_BTN, MarkTile, TypingDots, UserMessage } from "@/components/ai/chat-parts";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { OutputCard } from "@/components/ai/OutputCard";
import { cn } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { fullName } from "@/lib/ai/context";
import { helpText, ruleEngine, type AiOutput, type UseCaseId } from "@/lib/ai/engine";
import { onOpenAssistant } from "@/lib/ai/launcher";
import { auditSuggest, buildContext, visitFromHash } from "@/lib/ai/live";
import { audit } from "@/lib/audit";
import { chartChecks, checkCounts } from "@/lib/chart-review";
import { useDevMode } from "@/lib/devmode";
import type { Encounter, Patient } from "@/lib/model";
import { useRoute } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { getState, useHis } from "@/lib/store";

/**
 * Onasi AI, the assistant. Rendered once at the app root: a floating launcher, a side panel with two tabs (The Hospital
 * and This Chart), and a full screen mode. It reads the open chart from the address (#/chart?visit=...).
 * Esc closes it and focus goes back to the launcher.
 */

const FULL_KEY = "onasi-ai-full-screen";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Item =
  | { id: number; at: string; kind: "user"; text: string }
  | { id: number; at: string; kind: "note"; text: string }
  | { id: number; at: string; kind: "ai"; out: AiOutput; enc: Encounter; patient: Patient };

type Mode = "hospital" | "chart";

export function AiAssistant() {
  const { user } = useSession();
  useRoute(); // re-render when the address changes, so the open chart stays current
  const st = useHis();
  const [open, setOpen] = React.useState(false);
  // The panel can fill the whole screen. The choice is kept for the session.
  const [full, setFullState] = React.useState(() => { try { return sessionStorage.getItem(FULL_KEY) === "1"; } catch { return false; } });
  const setFull = (on: boolean) => { setFullState(on); try { sessionStorage.setItem(FULL_KEY, on ? "1" : "0"); } catch { /* storage may be blocked */ } };
  const [items, setItems] = React.useState<Item[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>("hospital");
  const [question, setQuestion] = React.useState<string | undefined>(undefined);
  const [chatReset, setChatReset] = React.useState(0);
  const [chatCount, setChatCount] = React.useState(0);
  const idRef = React.useRef(1);
  const launcher = React.useRef<HTMLButtonElement>(null);

  const visit = visitFromHash();
  const enc = visit ? st.encounters.find((e) => e.visitNumber === visit) : undefined;
  const patient = enc ? st.patients.find((p) => p.id === enc.patientId) : undefined;
  const restricted = !!patient?.confidential && !hasGlass(patient.id);

  // Number of safety checks waiting on the open chart. Shown on the launcher.
  const checks = React.useMemo(() => {
    if (!enc || !patient || restricted) return 0;
    // The same list and count as Needs Attention on the chart overview, so the two numbers agree.
    return checkCounts(chartChecks(enc, patient)).toAct;
  }, [enc, patient, restricted]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Another page asked a question: open the chat with it.
  React.useEffect(() => onOpenAssistant((q) => { setMode("hospital"); setQuestion(q); setOpen(true); }), []);

  const onCount = React.useCallback((n: number) => setChatCount(n), []);

  if (!can("ai.use")) return null;

  const push = (i: DistributiveOmit<Item, "id" | "at">) => setItems((prev) => [...prev, { ...i, id: idRef.current++, at: new Date().toISOString() } as Item]);

  async function run(useCase: UseCaseId, message = "") {
    const now = getState();
    const e = visitFromHash() ? now.encounters.find((x) => x.visitNumber === visitFromHash()) : undefined;
    const p = e ? now.patients.find((x) => x.id === e.patientId) : undefined;
    if (useCase === "help") { push({ kind: "note", text: helpText() }); return; }
    if (!e || !p) { push({ kind: "note", text: "Open a patient chart first." }); return; }
    if (p.confidential && !hasGlass(p.id)) {
      audit("denied", `AI on confidential chart ${e.visitNumber}`, { patient: fullName(p), detail: "The assistant does not read confidential charts unless the glass was broken." });
      push({ kind: "note", text: "This chart is confidential. Break the glass first." });
      return;
    }
    setBusy(true);
    try {
      const out = await ruleEngine.run({ useCase, ctx: buildContext(e, p), message });
      auditSuggest(out, e, p);
      push({ kind: "ai", out, enc: e, patient: p });
    } finally {
      setBusy(false);
    }
  }

  function send(text: string) {
    const t = text.trim();
    if (!t) return;
    push({ kind: "user", text: t });
    setDraft("");
    void run(ruleEngine.detectIntent(t), t);
  }

  const chartWho = enc && patient ? (restricted ? "Confidential chart" : fullName(patient)) : "";
  const chartTools = (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatThread label="Chart conversation" stick={items.length} innerClassName={cn("space-y-4 px-4 py-4", full && "sm:px-6")}>
        {/* The open chart, then the tools as a quiet grid */}
        <div className="glass-card flex items-center gap-3 rounded-xl px-3.5 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">
            <span className="font-semibold text-[#032C26] dark:text-foreground">{chartWho}</span>
            {enc && <span className="text-muted-foreground"> visit {enc.visitNumber}</span>}
          </span>
          {checks > 0 && <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{checks} safety {checks === 1 ? "check" : "checks"}</span>}
        </div>
        <ChartToolGrid busy={busy} onRun={(id, label) => { push({ kind: "user", text: label }); void run(id); }} />
        {items.map((i) =>
          i.kind === "user" ? (
            <UserMessage key={i.id} text={i.text} at={i.at} />
          ) : i.kind === "note" ? (
            <AssistantMessage key={i.id}>
              <p className="glass-card inline-block whitespace-pre-wrap rounded-2xl rounded-ss-md px-4 py-3 text-[0.9375rem] leading-relaxed">{i.text}</p>
            </AssistantMessage>
          ) : (
            <AssistantMessage key={i.id}><OutputCard out={i.out} enc={i.enc} patient={i.patient} /></AssistantMessage>
          ),
        )}
        {busy && <AssistantMessage thinking><TypingDots label="Reading the chart" /></AssistantMessage>}
      </ChatThread>
      <div className="shrink-0 px-3 pb-3 pt-2">
        <Composer value={draft} onChange={setDraft} onSend={send} busy={busy} label="Ask about this chart" placeholder="Ask about this chart" />
      </div>
    </div>
  );

  const chartOn = mode === "chart" && !!enc;
  const hasContent = chartOn ? items.length > 0 : chatCount > 0;
  return (
    <>
      {/* Launcher: fixed at the bottom right. The red number is the safety checks waiting on this chart. */}
      <button
        ref={launcher}
        type="button"
        onClick={() => { setMode(enc ? "chart" : "hospital"); setOpen(true); }}
        aria-label={`Ask ${ASSISTANT_NAME}${checks ? `. ${checks} safety checks on this chart.` : ""}`}
        title={`Ask ${ASSISTANT_NAME} (Ctrl+J)`}
        className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center gap-2.5 rounded-full bg-white/90 text-[#032C26] shadow-[0_12px_32px_-14px_rgba(3,44,38,0.45)] ring-1 ring-[#39EDD5]/70 backdrop-blur-xl transition-transform dark:bg-[#0d2a24]/95 dark:text-foreground dark:ring-[#39EDD5]/35 hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none motion-reduce:hover:scale-100 md:size-auto md:py-2 md:pl-3 md:pr-4"
      >
        <span className="relative">
          <OnasiAiMark size={24} />
          {checks > 0 && <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-destructive text-xs font-bold text-white">{checks}</span>}
        </span>
        <span className="hidden text-sm font-semibold md:inline">Ask {ASSISTANT_NAME}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className={cn("h-dvh w-full gap-0 border-[rgba(20,32,28,0.08)] bg-[#f6faf8] p-0 dark:border-white/5 dark:bg-background", full ? "max-w-none sm:max-w-none" : "sm:max-w-lg")}
          aria-describedby="nabd-desc"
          showCloseButton={false}
          onCloseAutoFocus={(e) => { e.preventDefault(); launcher.current?.focus(); }}
        >
          <SheetTitle className="sr-only">Ask {ASSISTANT_NAME}</SheetTitle>
          <SheetDescription id="nabd-desc" className="sr-only">Ask about the hospital or the open chart. A clinician must review every answer.</SheetDescription>
          {full ? (
            <AssistantFullScreen
              userId={user.id}
              firstQuestion={question}
              scope={chartOn ? "chart" : "hospital"}
              onScope={setMode}
              chartLabel={enc && patient ? `${chartWho}, visit ${enc.visitNumber}` : ""}
              checks={checks}
              chartTools={chartTools}
              onExitFull={() => setFull(false)}
              onClose={() => setOpen(false)}
            />
          ) : (
            <>
              <header className="shrink-0 space-y-2.5 px-4 pb-2 pt-3.5">
                <div className="flex items-center gap-2.5">
                  <MarkTile size="sm" />
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-[#032C26] dark:text-foreground">{ASSISTANT_NAME}</span>
                  {hasContent && (
                    <button type="button" className={ICON_BTN} onClick={() => (chartOn ? setItems([]) : (setQuestion(undefined), setChatReset((n) => n + 1)))} aria-label="New chat" title="New Chat">
                      <IconMessagePlus className="size-[1.15rem]" aria-hidden="true" />
                    </button>
                  )}
                  <button type="button" className={ICON_BTN} onClick={() => setFull(true)} aria-label="Full screen" title="Full Screen">
                    <IconArrowsMaximize className="size-[1.15rem]" aria-hidden="true" />
                  </button>
                  <button type="button" className={ICON_BTN} onClick={() => setOpen(false)} aria-label={`Close ${ASSISTANT_NAME}`} title="Close (Esc)">
                    <IconX className="size-[1.15rem]" aria-hidden="true" />
                  </button>
                </div>
                <ScopeSwitch scope={mode} onScope={setMode} chartOpen={!!enc} checks={checks} panels />
              </header>
              <div id="ai-panel-hospital" role="tabpanel" aria-labelledby="ai-tab-hospital" hidden={chartOn} className={cn("min-h-0 flex-1 flex-col", chartOn ? "hidden" : "flex")}>
                <AssistantChat firstQuestion={question} resetKey={chatReset} onCount={onCount} />
              </div>
              {chartOn && (
                <div id="ai-panel-chart" role="tabpanel" aria-labelledby="ai-tab-chart" className="flex min-h-0 flex-1 flex-col">{chartTools}</div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
