import * as React from "react";
import { useDevMode } from "@/lib/devmode";
import { Check, Copy, Pencil, X } from "lucide-react";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { BrandBadge } from "@/components/ai/chat-parts";
import { copyText } from "@/components/ui/code-block";
import { Button, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { AI_LABEL } from "@/lib/ai/context";
import type { AiOutput } from "@/lib/ai/engine";
import { addAiNote, addDiagnoses, auditAccept, auditReject } from "@/lib/ai/live";
import { parseSoapText } from "@/lib/ai/soap";
import { saveSoap } from "@/lib/ai/soap-store";
import type { Encounter, Patient } from "@/lib/model";
import { can } from "@/lib/session";
import { pushToast } from "@/lib/toast";

/**
 * One AI answer with the human-in-the-loop controls: Accept, Edit, Reject.
 * It always shows the label, that the assistant is simulated, and which chart fields fed the answer.
 */

type Verdict = "open" | "accepted" | "rejected";

/** What Accept does for each use case. Shown under the buttons so nothing happens by surprise. */
const ACCEPT_HINT: Partial<Record<AiOutput["useCase"], string>> = {
  soap: "Accept saves a draft SOAP note. You still co-sign it yourself.",
  discharge: "Accept adds this text to the Progress Notes as an AI-assisted note.",
  summary: "Accept adds this text to the Progress Notes as an AI-assisted note.",
  codes: "Accept adds the ticked codes to Diagnosis as working diagnoses.",
};

export function OutputCard({ out, enc, patient }: { out: AiOutput; enc: Encounter; patient: Patient }) {
  const dev = useDevMode();
  const [text, setText] = React.useState(out.text);
  const [editing, setEditing] = React.useState(false);
  const [verdict, setVerdict] = React.useState<Verdict>("open");
  const [alt, setAlt] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set(out.codes?.map((c) => c.icd) ?? []));
  const mayWrite = can("emr.write");
  const edited = text !== out.text;
  const shown = alt && out.alt ? out.alt.text : text;
  const rtl = alt && out.alt?.rtl;
  const isRtl = rtl || (!alt && /[؀-ۿ]/.test(text.slice(0, 40)));

  function accept() {
    let what = "Nothing was written to the chart.";
    const visit = enc.visitNumber;
    if (mayWrite) {
      if (out.useCase === "soap" && out.soap) {
        const parts = parseSoapText(text, out.soap);
        saveSoap(visit, patient.id, parts, { aiDrafted: true });
        what = "Saved as a draft SOAP note.";
      } else if (out.useCase === "discharge" || out.useCase === "summary") {
        addAiNote(visit, text);
        what = "Added to Progress Notes.";
      } else if (out.useCase === "codes" && out.codes) {
        const chosen = out.codes.filter((c) => picked.has(c.icd)).map((c) => ({ code: c.icd, text: c.text }));
        const n = addDiagnoses(visit, chosen);
        what = `${n} diagnosis code${n === 1 ? "" : "s"} added as working diagnoses.`;
      }
    } else if (ACCEPT_HINT[out.useCase]) {
      what = "Your role cannot write to the chart, so only your decision was recorded.";
    }
    auditAccept(out, enc, patient, edited, what);
    setVerdict("accepted");
    setEditing(false);
    pushToast({ tone: "ok", text: `Accepted. ${what}` });
  }

  function reject() {
    auditReject(out, enc, patient);
    setVerdict("rejected");
    setEditing(false);
  }

  const segment = "flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
  const edge = verdict === "rejected" ? "before:bg-muted-foreground/40" : verdict === "accepted" ? "before:bg-[#032C26] dark:before:bg-[#39EDD5]" : "before:bg-[#03C1AC]";

  return (
    <article
      className={cn("glass-card relative overflow-hidden rounded-2xl rounded-ss-md p-4 text-sm before:absolute before:inset-y-0 before:left-0 before:w-[3px]", edge, verdict === "rejected" && "opacity-60")}
      aria-label={out.title}
    >
      <header className="flex items-start gap-2.5">
        <span className="glass-icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
          <UseCaseIcon id={out.useCase} className="size-[1.1rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight text-[#032C26] dark:text-foreground">{out.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{AI_LABEL}</span>
            {dev && out.simulated && <span className="font-mono text-xs text-muted-foreground">simulated</span>}
            {verdict === "accepted" && <BrandBadge>Accepted{edited ? " (edited)" : ""}</BrandBadge>}
            {verdict === "rejected" && <BrandBadge tone="ink">Rejected</BrandBadge>}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label={copied ? "Copied" : "Copy the draft"}
          title="Copy"
          onClick={async () => {
            if (await copyText(shown)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }
          }}
        >
          {copied ? <Check className="size-3.5 text-[#03C1AC]" /> : <Copy className="size-3.5" />}
        </Button>
      </header>

      {out.alt && (
        <div className="glass-pill mt-3 inline-flex p-0.5 text-xs" role="group" aria-label="Language">
          {[false, true].map((a) => (
            <button key={String(a)} type="button" onClick={() => setAlt(a)} aria-pressed={alt === a} className={cn("rounded-full px-2.5 py-1", alt === a ? "bg-[#032C26] font-medium text-white dark:bg-[#39EDD5] dark:text-[#032C26]" : "text-muted-foreground hover:text-foreground")}>
              {a ? out.alt!.label : out.alt!.label === "English" ? "Arabic" : "English"}
            </button>
          ))}
        </div>
      )}

      {out.useCase === "codes" && out.codes && out.codes.length > 0 && verdict === "open" && (
        <ul className="mt-3 space-y-1.5">
          {out.codes.map((c) => (
            <li key={c.icd}>
              <label className="glass-row flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 hover:border-[#03C1AC]/50">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[#03C1AC]"
                  checked={picked.has(c.icd)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(c.icd) : n.delete(c.icd); return n; })}
                />
                <span className="min-w-0">
                  <span className="font-medium">{c.text}</span>
                  <span className="block text-xs text-muted-foreground">ICD-10-AM <span className="font-mono">{c.icd}</span>, SNOMED CT <span className="font-mono">{c.snomed}</span></span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {editing && !alt ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-3 min-h-40 text-sm" aria-label="Edit the draft" />
      ) : (
        <div dir={isRtl ? "rtl" : "ltr"} className={cn("mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-white/60 px-3.5 py-3 text-sm leading-relaxed dark:bg-white/[0.03]", isRtl && "text-right")}>
          {shown}
        </div>
      )}

      {verdict === "open" && out.useCase !== "help" && (
        <>
          <div className="mt-3 grid grid-cols-3 divide-x divide-[rgba(20,32,28,0.08)] overflow-hidden rounded-xl border border-[rgba(20,32,28,0.1)] bg-white/50 dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.03]" role="group" aria-label="Your decision">
            <button type="button" onClick={accept} className={cn(segment, "bg-[#032C26] text-white hover:bg-[#0a4036] dark:bg-[#39EDD5] dark:text-[#032C26] dark:hover:bg-[#52FCE3]")}>
              <Check className="size-3.5" /> Accept
            </button>
            <button type="button" onClick={() => { setAlt(false); setEditing((v) => !v); }} className={cn(segment, "text-foreground hover:bg-white/80 dark:hover:bg-white/5")}>
              <Pencil className="size-3.5" /> {editing ? "Done" : "Edit"}
            </button>
            <button type="button" onClick={reject} className={cn(segment, "text-destructive hover:bg-destructive/10")}>
              <X className="size-3.5" /> Reject
            </button>
          </div>
          {ACCEPT_HINT[out.useCase] && <p className="mt-1.5 text-xs text-muted-foreground">{ACCEPT_HINT[out.useCase]}</p>}
        </>
      )}

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium hover:text-foreground">Sources ({out.sources.length})</summary>
        {out.sources.length ? (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {out.sources.map((s, i) => <li key={`${s}-${i}`} className="rounded-full border border-[rgba(20,32,28,0.1)] bg-white/70 px-2 py-0.5 dark:border-white/10 dark:bg-white/5">{s}</li>)}
          </ul>
        ) : (
          <p className="mt-1">No chart fields.</p>
        )}
        {dev && <p className="mt-1.5">Made by {out.engine}. It uses only the open chart. Nothing leaves the browser.</p>}
      </details>
    </article>
  );
}
