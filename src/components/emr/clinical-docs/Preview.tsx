import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { Badge, cn } from "@/components/ui/primitives";
import { SECTIONS } from "@/lib/cda/docspec";
import type { Block, BuiltDoc, SectionOut } from "@/lib/cda/types";
import type { Check } from "@/lib/model";

/** A readable version of the document, as a clinician would read it. */

const stamp = (hl7: string) => (hl7.length >= 12 ? `${hl7.slice(0, 4)}-${hl7.slice(4, 6)}-${hl7.slice(6, 8)} ${hl7.slice(8, 10)}:${hl7.slice(10, 12)}` : hl7);
const local = (s: string) => (s ? s.replace("T", " ") : "Not recorded");

function BlockView({ b }: { b: Block }) {
  if (b.kind === "p") return <p className="text-sm leading-relaxed">{b.text}</p>;
  if (b.kind === "list") {
    return (
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {b.items.map((i, n) => (
          <li key={n}>{i.text}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {b.head.map((h) => (
              <th key={h} className="border-b border-border px-2 py-1 text-left text-xs font-medium text-muted-foreground">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, n) => (
            <tr key={n}>
              {r.map((c, k) => (
                <td key={k} className="border-b border-border/60 px-2 py-1">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionView({ s, dev }: { s: SectionOut; dev: boolean }) {
  const needed = s.usage === "R" && !s.hasData;
  return (
    <section className={cn("rounded-lg border border-border p-3", needed && "border-warn/50 bg-warn/5")}>
      <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        {s.title}
        {needed && <Badge tone="warn">Needs Data</Badge>}
        {dev && (
          <>
            <Badge tone="update">{s.usage}</Badge>
            <span className="font-mono text-xs font-normal text-muted-foreground">LOINC {s.loinc}</span>
          </>
        )}
      </h4>
      <div className="mt-1.5 space-y-1.5">
        {s.blocks.map((b, n) => (
          <BlockView key={n} b={b} />
        ))}
      </div>
      {dev && (
        <p className="mt-2 text-xs text-muted-foreground">
          Spec page: {SECTIONS[s.key]?.page}. {s.sources.length ? `Chart fields used: ${s.sources.join(", ")}.` : "No chart field fed this section."} {s.entries.length ? `${s.entries.length} coded entr${s.entries.length === 1 ? "y" : "ies"}.` : "Narrative only."}
        </p>
      )}
    </section>
  );
}

/** Plain list of what needs fixing. Spec references are removed here. They stay in the Developer View validator. */
const plain = (t: string) => t.replace(/\s*\(Seha step[^)]*\)/g, "");

export function ProblemList({ checks }: { checks: Check[] }) {
  const errors = checks.filter((c) => c.level === "error").map((c) => ({ ...c, text: plain(c.text) }));
  const warns = checks.filter((c) => c.level === "warn" && !c.text.startsWith("Facility type")).map((c) => ({ ...c, text: plain(c.text) }));
  if (!errors.length && !warns.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-ok">
        <CheckCircle2 className="size-4" /> The document is ready to publish.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {errors.length > 0 && <p className="text-xs font-medium text-destructive">Fix these before the registry will accept the document ({errors.length})</p>}
      {errors.map((c, n) => (
        <p key={`e${n}`} className="flex items-start gap-2 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /> {c.text}
        </p>
      ))}
      {warns.length > 0 && <p className="pt-1 text-xs font-medium text-warn">Worth a look ({warns.length})</p>}
      {warns.map((c, n) => (
        <p key={`w${n}`} className="flex items-start gap-2 text-sm text-muted-foreground">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> {c.text}
        </p>
      ))}
    </div>
  );
}

export function DocPreview({ doc, dev }: { doc: BuiltDoc; dev: boolean }) {
  const h = doc.header;
  const shown = doc.sections.filter((s) => s.hasData || s.usage === "R");
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-muted/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">{doc.title}</h3>
          <Badge tone={h.status === "amended" ? "update" : "neutral"}>{h.status === "amended" ? "Amended" : "Final"} version {doc.version}</Badge>
        </div>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {([
            ["Patient", h.patientName],
            ["Health ID", h.healthId],
            ["Author and signer", h.authorName],
            ["Organisation", h.org],
            ["Visit", h.encounterId],
            ["Visit period", `${local(h.encounterStart)} to ${local(h.encounterEnd)}`],
            ["Created", stamp(h.createdAt)],
          ] as const).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {shown.map((s) => (
        <SectionView key={s.key} s={s} dev={dev} />
      ))}
    </div>
  );
}
