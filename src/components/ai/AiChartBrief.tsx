import * as React from "react";
import { useDevMode } from "@/lib/devmode";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronDown, ChevronRight, RotateCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { cn } from "@/components/ui/primitives";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { runCds } from "@/lib/ai/cds";
import { ageOf, fullName, vitalsLine } from "@/lib/ai/context";
import { buildContext } from "@/lib/ai/live";
import { audit } from "@/lib/audit";
import { attentionFor, buildTimeline } from "@/lib/chart-review";
import type { Encounter, Patient } from "@/lib/model";
import { navigate } from "@/lib/router";
import { can } from "@/lib/session";

/**
 * The patient brief. When a chart opens, Onasi AI reads it and writes a short summary at the top:
 * who the patient is, what to watch, what happened last and what to do next. While it works it shows
 * the steps it is on. The brief is a draft from fixed rules (simulated), and it says so.
 */

export interface Brief {
  story: string;
  /** The same facts as short labelled chips, for the summary card. */
  facts: { label: string; value: string; tone?: "danger" | "muted" }[];
  watch: { level: "high" | "medium"; text: string }[];
  recent: { title: string; when: string }[];
  next: { label: string; section: string }[];
  sources: string[];
}

const CLS = { I: "inpatient care", O: "outpatient care", E: "the emergency department", P: "pre-admission" } as const;

/** Pure: builds the brief from the chart. */
export function buildBrief(enc: Encounter, patient: Patient, now: Date = new Date()): Brief {
  const ctx = buildContext(enc, patient, now);
  const reason = enc.complaints.map((c) => c.text).join(", ") || enc.reason;
  const meds = ctx.meds.map((m) => m.name);
  const story = [
    `${fullName(patient)} is a ${ageOf(patient.dob, now)} year old ${patient.sex === "M" ? "man" : "woman"} in ${CLS[enc.cls as keyof typeof CLS] ?? "care"}${reason ? `, here for ${reason.toLowerCase()}` : ""}.`,
    enc.dx.length ? `Working diagnosis: ${enc.dx.map((d) => d.text).join("; ")}.` : "No diagnosis is recorded yet.",
    enc.allergies.length ? `Allergic to ${enc.allergies.map((a) => a.text).join(", ")}.` : "No allergies are recorded.",
    enc.vitals ? `Latest vital signs: ${vitalsLine(enc.vitals)}` : "No vital signs have been taken on this visit.",
    meds.length ? `On ${meds.slice(0, 4).join(", ")}${meds.length > 4 ? ` and ${meds.length - 4} more` : ""}.` : "",
  ].filter(Boolean).join(" ");

  const facts: Brief["facts"] = [
    { label: "Patient", value: `${ageOf(patient.dob, now)} y, ${patient.sex === "M" ? "Male" : "Female"}` },
    { label: "Visit", value: ({ I: "Inpatient", O: "Outpatient", E: "Emergency", P: "Pre-Admission" } as Record<string, string>)[enc.cls] ?? "Visit" },
    ...(reason ? [{ label: "Reason", value: reason }] : []),
    { label: "Diagnosis", value: enc.dx.length ? enc.dx.map((d) => d.text).join("; ") : "Not recorded", tone: enc.dx.length ? undefined : ("muted" as const) },
    { label: "Allergies", value: enc.allergies.length ? enc.allergies.map((a) => a.text).join(", ") : "None recorded", tone: enc.allergies.length ? ("danger" as const) : ("muted" as const) },
    { label: "Vital Signs", value: enc.vitals ? vitalsLine(enc.vitals).replace(/\.$/, "") : "None taken", tone: enc.vitals ? undefined : ("muted" as const) },
    ...(meds.length ? [{ label: "Medicines", value: `${meds.slice(0, 3).join(", ")}${meds.length > 3 ? ` +${meds.length - 3}` : ""}` }] : []),
  ];

  const seen = new Set<string>();
  const watch: Brief["watch"] = [];
  for (const f of [...runCds(ctx), ...attentionFor(enc, patient)]) {
    if (f.level === "info" || seen.has(f.text)) continue;
    seen.add(f.text);
    watch.push({ level: f.level, text: f.text });
  }
  watch.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1));

  const recent = buildTimeline(enc).slice(0, 3).map((t) => ({
    title: t.title,
    when: new Date(t.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  }));

  const next: Brief["next"] = [];
  if (!enc.vitals) next.push({ label: "Record Vital Signs", section: "vitals" });
  if (!enc.dx.length) next.push({ label: "Add A Diagnosis", section: "diagnosis" });
  next.push({ label: "Draft A SOAP Note", section: "soap" });
  if (enc.status === "discharged") next.push({ label: "Write The Discharge Summary", section: "documents" });

  return { story, facts, watch: watch.slice(0, 4), recent, next: next.slice(0, 3), sources: ["Visit", "Chief Complaints", "Diagnosis", "Allergies", "Vital Signs", "Medicines", "Results", "Notes"] };
}

const STEPS = ["Opening the chart", "Reading vital signs, results and notes", "Checking the safety rules", "Writing the brief"];
const STEP_MS = 620;
/** Charts already briefed in this session, so the loading sequence plays once per chart, not on every visit to the tab. */
const briefed = new Set<string>();

function Loading({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-5" role="status" aria-live="polite">
      <div className="relative flex size-12 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-foreground/10 border-t-[#03C1AC] [animation-duration:1.1s]" aria-hidden="true" />
        <OnasiAiMark size={24} thinking />
      </div>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-semibold text-foreground">{STEPS[Math.min(step, STEPS.length - 1)]}</p>
        <ol className="mt-2 flex gap-1.5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <li key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i < step ? "bg-[#03C1AC]" : i === step ? "animate-pulse bg-[#03C1AC]/60" : "bg-foreground/10")} />
          ))}
        </ol>
      </div>
    </div>
  );
}

export function AiChartBrief({ enc, patient, onGo, inModal = false }: { enc: Encounter; patient: Patient; onGo?: () => void; inModal?: boolean }) {
  const reduce = useReducedMotion();
  const dev = useDevMode();
  const key = enc.visitNumber;
  const [step, setStep] = React.useState(() => (briefed.has(key) ? STEPS.length : 0));
  const [open, setOpen] = React.useState(true);
  const [vote, setVote] = React.useState<"up" | "down" | null>(null);
  const ready = step >= STEPS.length;

  React.useEffect(() => {
    if (ready) return;
    if (reduce) { setStep(STEPS.length); return; }
    const t = window.setTimeout(() => setStep((s) => s + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [step, ready, reduce]);

  React.useEffect(() => {
    if (!ready || briefed.has(key)) return;
    briefed.add(key);
    audit("ai-suggest", `Patient summary for visit ${key}`, { patient: fullName(patient), detail: "Written when the chart was opened." });
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can("ai.use")) return null;
  const brief = ready ? buildBrief(enc, patient) : null;
  const go = (s: string) => { onGo?.(); navigate("/chart", { visit: key, s }); };
  const again = () => { briefed.delete(key); setVote(null); setStep(0); setOpen(true); };
  const rate = (v: "up" | "down") => {
    setVote(v);
    audit(v === "up" ? "ai-accept" : "ai-reject", `Patient summary for visit ${key}`, { patient: fullName(patient), detail: v === "up" ? "Marked useful." : "Marked not useful." });
  };
  const line = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 * i, duration: 0.28 } });

  const label = "text-xs font-medium text-muted-foreground";
  return (
    <section aria-label={`Patient summary by ${ASSISTANT_NAME}`} className={cn("glass-card overflow-hidden text-foreground", inModal ? "rounded-2xl" : "rounded-xl")}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border/70 px-5 py-3">
        <OnasiAiMark size={18} thinking={!ready} />
        <h2 className="text-sm font-semibold">Patient Summary</h2>
        {dev && <span className="rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground">Simulated</span>}
        {ready && (
          <div className={cn("ms-auto flex items-center gap-1", inModal && "me-8")}>
            <button type="button" onClick={again} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              <RotateCw className="size-3.5" aria-hidden="true" /> Write Again
            </button>
            {!inModal && <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {open ? "Hide" : "Show"} <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
            </button>}
          </div>
        )}
      </header>

      {!brief ? (
        <Loading step={step} />
      ) : open ? (
        <div className="px-5 py-4">
          <p className="sr-only">{brief.story}</p>
          <motion.dl {...line(0)} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {brief.facts.map((f) => (
              <div key={f.label} className="glass-row min-w-0 rounded-lg px-3 py-2">
                <dt className={label}>{f.label}</dt>
                <dd className={cn("mt-0.5 line-clamp-2 text-sm font-medium", f.tone === "danger" ? "text-destructive" : f.tone === "muted" ? "text-muted-foreground" : "text-foreground")} title={f.value}>{f.value}</dd>
              </div>
            ))}
          </motion.dl>

          <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
            <motion.div {...line(1)}>
              <h3 className={label}>Watch</h3>
              {brief.watch.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {brief.watch.map((w, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", w.level === "high" ? "bg-destructive" : "bg-warn")} aria-hidden="true" />
                      <span><span className="sr-only">{w.level === "high" ? "Urgent: " : "Soon: "}</span>{w.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">Nothing urgent.</p>
              )}
            </motion.div>
            <motion.div {...line(2)}>
              <h3 className={label}>Latest</h3>
              {brief.recent.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {brief.recent.map((r, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">{r.title}</span>
                      <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.when}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-muted-foreground">Nothing recorded yet.</p>
              )}
            </motion.div>
          </div>

          <motion.div {...line(3)} className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3.5">
            {brief.next.map((n) => (
              <button key={n.section} type="button" onClick={() => go(n.section)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#03C1AC]/40 bg-[#39EDD5]/10 px-2.5 text-[0.8125rem] font-medium text-[#035D53] hover:bg-[#39EDD5]/20 focus-visible:outline-2 focus-visible:outline-ring dark:text-[#52FCE3]">
                {n.label} <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            ))}
            <div className="ms-auto flex items-center gap-1">
              {vote ? (
                <span className="text-xs text-muted-foreground">Thanks for the feedback.</span>
              ) : (
                <>
                  <button type="button" onClick={() => rate("up")} aria-label="Useful" title="Useful" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><ThumbsUp className="size-4" /></button>
                  <button type="button" onClick={() => rate("down")} aria-label="Not useful" title="Not useful" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><ThumbsDown className="size-4" /></button>
                </>
              )}
            </div>
          </motion.div>
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">AI draft, check before use. Sources</summary>
            <p className="mt-1">Read from: {brief.sources.join(", ")}.</p>
          </details>
        </div>
      ) : null}
    </section>
  );
}
