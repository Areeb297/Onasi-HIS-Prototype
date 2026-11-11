import * as React from "react";
import { Check, Copy, Pencil, X } from "lucide-react";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { copyText } from "@/components/ui/code-block";
import { Badge, Button, cn } from "@/components/ui/primitives";
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

  const ruled = {
    lineHeight: "24px",
    backgroundImage: "linear-gradient(transparent 23px, color-mix(in srgb, var(--foreground) 7%, transparent) 24px)",
    backgroundSize: "100% 24px",
  } as React.CSSProperties;
  const segment = "flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium transition-colors";

  return (
    <article
      className={cn("rounded-lg border border-border border-l-[3px] bg-card p-3 text-sm", verdict === "rejected" ? "border-l-destructive opacity-60" : verdict === "accepted" ? "border-l-ok" : "border-l-admit")}
      aria-label={out.title}
    >
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
          <UseCaseIcon id={out.useCase} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{out.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-sm border border-dashed border-warn px-1.5 py-0.5 text-xs font-semiboldst text-warn">{AI_LABEL}</span>
            {out.simulated && <span className="font-mono text-xsr text-muted-foreground">simulated</span>}
            {verdict === "accepted" && <Badge tone="ok">Accepted{edited ? " (edited)" : ""}</Badge>}
            {verdict === "rejected" && <Badge tone="danger">Rejected</Badge>}
          </div>
        </div>
      </header>

      {out.alt && (
        <div className="mt-2 inline-flex rounded-md border border-border bg-muted p-0.5 text-xs" role="group" aria-label="Language">
          {[false, true].map((a) => (
            <button key={String(a)} onClick={() => setAlt(a)} aria-pressed={alt === a} className={cn("rounded px-2 py-0.5", alt === a ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
              {a ? out.alt!.label : out.alt!.label === "English" ? "Arabic" : "English"}
            </button>
          ))}
        </div>
      )}

      {out.useCase === "codes" && out.codes && out.codes.length > 0 && verdict === "open" && (
        <ul className="mt-2 space-y-1">
          {out.codes.map((c) => (
            <li key={c.icd}>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-muted/50">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--admit)]"
                  checked={picked.has(c.icd)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(c.icd) : n.delete(c.icd); return n; })}
                />
                <span>
                  <span className="font-medium">{c.text}</span>
                  <span className="block font-mono text-xs text-muted-foreground">ICD-10-AM {c.icd} · SNOMED CT {c.snomed} · matched "{c.matched}" in {c.from}</span>
                  <span className="font-mono text-xsr text-muted-foreground">suggestion</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {editing && !alt ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="mt-2 min-h-40 font-mono text-xs" aria-label="Edit the draft" />
      ) : (
        <pre dir={isRtl ? "rtl" : "ltr"} style={ruled} className={cn("mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background px-3 py-1 font-sans text-sm", isRtl && "text-right")}>
          {shown}
        </pre>
      )}

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Sources used ({out.sources.length})</summary>
        {out.sources.length ? (
          <ol className="mt-1.5 flex flex-wrap gap-1">
            {out.sources.map((s) => <li key={s} className="rounded border border-border px-1.5 py-0.5 font-mono text-xs">{s}</li>)}
          </ol>
        ) : (
          <p className="mt-1">No chart fields.</p>
        )}
        <p className="mt-1.5">Made by {out.engine}. It uses only the open chart. Nothing leaves the browser.</p>
      </details>

      {verdict === "open" && out.useCase !== "help" && (
        <>
          <div className="mt-3 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border" role="group" aria-label="Your decision">
            <button onClick={accept} className={cn(segment, "bg-admit/10 text-admit hover:bg-admit/20")}>
              <Check className="size-3.5" /> Accept
            </button>
            <button onClick={() => { setAlt(false); setEditing((v) => !v); }} className={cn(segment, "hover:bg-muted")}>
              <Pencil className="size-3.5" /> {editing ? "Done" : "Edit"}
            </button>
            <button onClick={reject} className={cn(segment, "text-destructive hover:bg-destructive/10")}>
              <X className="size-3.5" /> Reject
            </button>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {ACCEPT_HINT[out.useCase] ? <p className="text-xs text-muted-foreground">{ACCEPT_HINT[out.useCase]}</p> : <span />}
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (await copyText(shown)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                }
              }}
            >
              <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </>
      )}
    </article>
  );
}
