import * as React from "react";
import { CornerDownLeft, Trash2 } from "lucide-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { OutputCard } from "@/components/ai/OutputCard";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { Button, cn } from "@/components/ui/primitives";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ASSISTANT_NAME, ASSISTANT_NAME_AR, ASSISTANT_ROLE } from "@/lib/ai/brand";
import { runCds } from "@/lib/ai/cds";
import { fullName, SIM_NOTE } from "@/lib/ai/context";
import { helpText, ruleEngine, USE_CASES, type AiOutput, type UseCaseId } from "@/lib/ai/engine";
import { auditSuggest, buildContext, visitFromHash } from "@/lib/ai/live";
import { audit } from "@/lib/audit";
import type { Encounter, Patient } from "@/lib/model";
import { useRoute } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { getState, useHis } from "@/lib/store";

/**
 * Onasi AI, the chart assistant. Rendered once at the app root. It reads the open chart from the address
 * (#/chart?visit=...) and answers with the rule engine. The engine is simulated. A real model could
 * replace it behind the AiEngine interface.
 *
 * Design: no chat bubbles. Commands show as lines in a log, answers as draft sheets on ruled paper
 * with a DRAFT stamp, and the launcher is a tab docked to the screen edge.
 */

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "note"; text: string }
  | { id: number; kind: "ai"; out: AiOutput; enc: Encounter; patient: Patient };

const SUGGESTIONS = ["Is there a drug allergy problem?", "What orders for chest pain?", "Give me a diabetes leaflet in Arabic", "What documentation is missing?"];

export function AiAssistant() {
  useSession();
  useRoute(); // re-render when the address changes, so the open chart stays current
  const st = useHis();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Item[]>([]);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const idRef = React.useRef(1);
  const endRef = React.useRef<HTMLDivElement>(null);

  const visit = visitFromHash();
  const enc = visit ? st.encounters.find((e) => e.visitNumber === visit) : undefined;
  const patient = enc ? st.patients.find((p) => p.id === enc.patientId) : undefined;
  const restricted = !!patient?.confidential && !hasGlass(patient.id);

  // Number of safety checks waiting on the open chart. Shown on the launcher.
  const checks = React.useMemo(() => {
    if (!enc || !patient || restricted) return 0;
    return runCds(buildContext(enc, patient)).filter((f) => f.level !== "info").length;
  }, [enc, patient, restricted]);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, busy, open]);

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

  if (!can("ai.use")) return null;

  const push = (i: DistributiveOmit<Item, "id">) => setItems((prev) => [...prev, { ...i, id: idRef.current++ } as Item]);

  async function run(useCase: UseCaseId, message = "") {
    const now = getState();
    const e = visitFromHash() ? now.encounters.find((x) => x.visitNumber === visitFromHash()) : undefined;
    const p = e ? now.patients.find((x) => x.id === e.patientId) : undefined;
    if (useCase === "help") {
      push({ kind: "note", text: helpText() });
      return;
    }
    if (!e || !p) {
      push({ kind: "note", text: "Open a patient chart first. I only look at the chart that is open, and I need it to answer." });
      return;
    }
    if (p.confidential && !hasGlass(p.id)) {
      audit("denied", `AI on confidential chart ${e.visitNumber}`, { patient: fullName(p), detail: "The assistant does not read confidential charts unless the glass was broken." });
      push({ kind: "note", text: "This chart is marked confidential. The assistant does not read confidential charts unless the glass was broken." });
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

  return (
    <>
      {/* Launcher: a floating button at the bottom right, clear of the tables. The red number is the safety checks waiting on this chart. */}
      <button
        onClick={() => setOpen(true)}
        aria-label={`Open ${ASSISTANT_NAME}, the chart assistant${checks ? `. ${checks} safety checks on this chart.` : ""}`}
        title={`${ASSISTANT_NAME} (Ctrl+J)`}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2.5 rounded-full bg-[var(--brand-deep)] py-2 pl-3 pr-4 text-white shadow-lg ring-1 ring-white/10 transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-primary dark:text-primary-foreground"
      >
        <span className="relative">
          <OnasiAiMark size={24} />
          {checks > 0 && (
            <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-destructive text-xs font-bold text-white">{checks}</span>
          )}
        </span>
        <span className="text-sm font-semibold">{ASSISTANT_NAME}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-xl" aria-describedby="nabd-desc">
          <SheetHeader className="gap-3 border-b border-border pr-12">
            <SheetTitle className="sr-only">{ASSISTANT_NAME}, the chart assistant</SheetTitle>
            <SheetDescription id="nabd-desc" className="sr-only">{SIM_NOTE}</SheetDescription>
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
                <OnasiAiMark size={28} thinking={busy} />
              </div>
              <div className="leading-tight">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-semibold tracking-tight">{ASSISTANT_NAME}</span>
                  <span dir="rtl" lang="ar" className="text-base text-muted-foreground">{ASSISTANT_NAME_AR}</span>
                </div>
                <div className="text-xs text-muted-foreground">{ASSISTANT_ROLE}. Ctrl+J opens and closes it.</div>
              </div>
              <span className="ms-auto rounded-sm border border-dashed border-warn px-1.5 py-0.5 text-xs font-semibold text-warn" title={SIM_NOTE}>Simulated</span>
            </div>
            <div className={cn("border-s-2 ps-3 text-sm", enc ? "border-admit" : "border-border text-muted-foreground")}>
              {enc && patient ? (
                <>
                  <strong>{restricted ? "Confidential chart" : fullName(patient)}</strong>
                  <span className="text-muted-foreground"> · visit {enc.visitNumber}</span>
                  {checks > 0 && <span className="ms-2 rounded bg-destructive/12 px-1.5 py-0.5 text-xs font-medium text-destructive">{checks} safety {checks === 1 ? "check" : "checks"}</span>}
                </>
              ) : (
                "No chart is open. Open a patient chart to use the chart tools."
              )}
            </div>
            <p className="text-xs leading-snug text-muted-foreground">{SIM_NOTE}</p>
          </SheetHeader>

          {/* Use case tiles */}
          <div className="grid grid-cols-3 gap-2 border-b border-border p-3" role="group" aria-label="What I can do">
            {USE_CASES.map((u) => (
              <button
                key={u.id}
                disabled={busy}
                title={u.label}
                onClick={() => { push({ kind: "user", text: u.label }); void run(u.id); }}
                className="group flex flex-col items-start gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-admit hover:bg-admit/5 disabled:opacity-50"
              >
                <UseCaseIcon id={u.id} className="size-5 text-foreground group-hover:text-admit" />
                <span className="text-xs font-medium leading-tight">{u.chip}</span>
              </button>
            ))}
          </div>

          {/* Log */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {items.length === 0 && (
              <div className="border-s-2 border-border ps-3 text-sm">
                <p className="text-muted-foreground">I work on the open chart only. Pick a tool above, or ask in your own words:</p>
                <ul className="mt-2 space-y-1">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button onClick={() => send(s)} className="flex items-center gap-2 text-start font-mono text-sm text-foreground hover:text-admit">
                        <span className="text-admit">›</span>{s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {items.map((i) =>
              i.kind === "user" ? (
                <div key={i.id} className="flex gap-2 font-mono text-sm text-muted-foreground"><span className="text-admit">›</span><span>{i.text}</span></div>
              ) : i.kind === "note" ? (
                <div key={i.id} className="whitespace-pre-wrap border-s-2 border-border ps-3 text-sm">{i.text}</div>
              ) : (
                <OutputCard key={i.id} out={i.out} enc={i.enc} patient={i.patient} />
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <OnasiAiMark size={22} thinking /> Reading the chart
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form
            className="flex items-center gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <span className="font-mono text-admit" aria-hidden="true">›</span>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about this chart"
              aria-label="Message"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 font-mono text-sm placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" variant="primary" disabled={!draft.trim() || busy}>
              Run <CornerDownLeft className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" onClick={() => setItems([])} aria-label="Clear the log" title="Clear the log">
              <Trash2 className="size-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
