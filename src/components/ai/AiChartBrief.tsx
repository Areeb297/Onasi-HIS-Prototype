import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, ChevronDown, ChevronRight, RotateCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { cn } from "@/components/ui/primitives";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import { runCds } from "@/lib/ai/cds";
import { AI_LABEL, ageOf, fullName, vitalsLine } from "@/lib/ai/context";
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

  return { story, watch: watch.slice(0, 4), recent, next: next.slice(0, 3), sources: ["Visit", "Chief Complaints", "Diagnosis", "Allergies", "Vital Signs", "Medicines", "Results", "Notes"] };
}

const STEPS = ["Opening the chart", "Reading vital signs, results and notes", "Checking the safety rules", "Writing the brief"];
const STEP_MS = 620;
/** Charts already briefed in this session, so the loading sequence plays once per chart, not on every visit to the tab. */
const briefed = new Set<string>();

function Loading({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-5" role="status" aria-live="polite">
      <div className="relative flex size-14 shrink-0 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-white/15 border-t-[var(--brand-mint)] [animation-duration:1.1s]" aria-hidden="true" />
        <OnasiAiMark size={28} thinking className="text-[var(--brand-mint)]" />
      </div>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-semibold text-white">{STEPS[Math.min(step, STEPS.length - 1)]}</p>
        <ol className="mt-2 flex gap-1.5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <li key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i < step ? "bg-[var(--brand-mint)]" : i === step ? "animate-pulse bg-[var(--brand-mint)]/70" : "bg-white/15")} />
          ))}
        </ol>
        <div className="mt-3 space-y-1.5" aria-hidden="true">
          <div className="h-2.5 w-11/12 animate-pulse rounded bg-white/12" />
          <div className="h-2.5 w-8/12 animate-pulse rounded bg-white/12 [animation-delay:150ms]" />
        </div>
      </div>
    </div>
  );
}

export function AiChartBrief({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const reduce = useReducedMotion();
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
    audit("ai-suggest", `Patient brief for visit ${key}`, { patient: fullName(patient), detail: "Written when the chart was opened." });
  }, [ready, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can("ai.use")) return null;
  const brief = ready ? buildBrief(enc, patient) : null;
  const go = (s: string) => navigate("/chart", { visit: key, s });
  const again = () => { briefed.delete(key); setVote(null); setStep(0); setOpen(true); };
  const rate = (v: "up" | "down") => {
    setVote(v);
    audit(v === "up" ? "ai-accept" : "ai-reject", `Patient brief for visit ${key}`, { patient: fullName(patient), detail: v === "up" ? "Marked useful." : "Marked not useful." });
  };
  const line = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 * i, duration: 0.28 } });

  return (
    <section aria-label={`Patient brief by ${ASSISTANT_NAME}`} className="overflow-hidden rounded-xl bg-[var(--brand-deep)] text-white shadow-sm">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/10 px-5 py-2.5">
        <OnasiAiMark size={18} thinking={!ready} className="text-[var(--brand-mint)]" />
        <h2 className="text-sm font-semibold">Patient brief by {ASSISTANT_NAME}</h2>
        <span className="rounded border border-dashed border-white/40 px-1.5 py-0.5 text-xs text-white/80">Simulated</span>
        {ready && (
          <div className="ms-auto flex items-center gap-1">
            <button type="button" onClick={again} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
              <RotateCw className="size-3.5" aria-hidden="true" /> Write Again
            </button>
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
              {open ? "Hide" : "Show"} <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden="true" />
            </button>
          </div>
        )}
      </header>

      {!brief ? (
        <Loading step={step} />
      ) : open ? (
        <div className="px-5 py-4">
          <motion.p {...line(0)} className="max-w-4xl text-[0.9375rem] leading-relaxed text-white/95">{brief.story}</motion.p>

          <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
            <motion.div {...line(1)}>
              <h3 className="text-xs font-semibold text-[var(--brand-mint)]">Watch</h3>
              {brief.watch.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {brief.watch.map((w, i) => (
                    <li key={i} className="flex gap-2 text-sm text-white/90">
                      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", w.level === "high" ? "text-[#ff9a9a]" : "text-[#fbd38d]")} aria-hidden="true" />
                      <span><span className="font-semibold">{w.level === "high" ? "Urgent. " : "Soon. "}</span>{w.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-white/80">Nothing urgent found in the chart.</p>
              )}
            </motion.div>
            <motion.div {...line(2)}>
              <h3 className="text-xs font-semibold text-[var(--brand-mint)]">Latest</h3>
              {brief.recent.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {brief.recent.map((r, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 text-sm text-white/90">
                      <span className="min-w-0 truncate">{r.title}</span>
                      <time className="shrink-0 text-xs text-white/65">{r.when}</time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-white/80">Nothing recorded on this visit yet.</p>
              )}
            </motion.div>
          </div>

          <motion.div {...line(3)} className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3.5">
            <span className="text-xs font-semibold text-[var(--brand-mint)]">Next</span>
            {brief.next.map((n) => (
              <button key={n.section} type="button" onClick={() => go(n.section)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/10 px-2.5 text-[0.8125rem] font-medium text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white">
                {n.label} <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            ))}
            <div className="ms-auto flex items-center gap-1">
              {vote ? (
                <span className="text-xs text-white/75">Thanks. Your answer is in the audit trail.</span>
              ) : (
                <>
                  <span className="text-xs text-white/65">Was this useful?</span>
                  <button type="button" onClick={() => rate("up")} aria-label="Useful" className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><ThumbsUp className="size-4" /></button>
                  <button type="button" onClick={() => rate("down")} aria-label="Not useful" className="rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white"><ThumbsDown className="size-4" /></button>
                </>
              )}
            </div>
          </motion.div>
          <p className="mt-2.5 text-xs text-white/60">{AI_LABEL} Read from: {brief.sources.join(", ")}.</p>
        </div>
      ) : null}
    </section>
  );
}

