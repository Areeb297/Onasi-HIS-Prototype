import * as React from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { UseCaseIcon } from "@/components/ai/UseCaseIcon";
import { cn } from "@/components/ui/primitives";
import { USE_CASES, type UseCaseId } from "@/lib/ai/engine";

/**
 * The tools for the open chart. Three do most of a doctor's work and are shown large, with a line that says what they do.
 * The rest are a short list behind More Tools.
 */

export const MAIN_TOOLS: { id: UseCaseId; name: string; about: string }[] = [
  { id: "summary", name: "Patient Summary", about: "A short read of this visit." },
  { id: "soap", name: "Draft A SOAP Note", about: "A first draft for you to edit." },
  { id: "cds", name: "Safety Checks", about: "Allergies, interactions and gaps." },
];

export const MORE_TOOLS: { id: UseCaseId; name: string }[] = [
  { id: "codes", name: "Suggest Diagnosis Codes" },
  { id: "orders", name: "Suggest Orders" },
  { id: "discharge", name: "Discharge Summary" },
  { id: "education", name: "Patient Leaflet" },
  { id: "quality", name: "Documentation Check" },
  { id: "nphies-error", name: "Explain An NPHIES Error" },
];

/** Every use case is reachable: a new one in the engine that is not listed above still shows under More Tools. */
export function moreTools(): { id: UseCaseId; name: string }[] {
  const shown = new Set<UseCaseId>([...MAIN_TOOLS.map((t) => t.id), ...MORE_TOOLS.map((t) => t.id)]);
  return [...MORE_TOOLS, ...USE_CASES.filter((u) => !shown.has(u.id)).map((u) => ({ id: u.id, name: u.chip }))];
}

export function ChartToolGrid({ busy, onRun }: { busy: boolean; onRun: (id: UseCaseId, label: string) => void }) {
  const [more, setMore] = React.useState(false);
  const label = (id: UseCaseId) => USE_CASES.find((u) => u.id === id)?.label ?? id;
  return (
    <div className="space-y-2.5" role="group" aria-label="Chart tools">
      <ul className="grid gap-2 sm:grid-cols-3">
        {MAIN_TOOLS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRun(t.id, label(t.id))}
              className="group/tool glass-card flex h-full w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-colors hover:border-[#03C1AC]/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 sm:flex-col sm:items-start sm:gap-2.5"
            >
              <span className="glass-icon flex size-9 shrink-0 items-center justify-center rounded-lg"><UseCaseIcon id={t.id} className="size-5" /></span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight text-[#032C26] dark:text-foreground">{t.name}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t.about}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => setMore((o) => !o)}
        aria-expanded={more}
        aria-controls="ai-more-tools"
        className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-xs font-medium text-[#035D53] hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-[#52FCE3]"
      >
        More Tools
        <IconChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", more && "rotate-180")} aria-hidden="true" />
      </button>
      {more && (
        <ul id="ai-more-tools" className="flex flex-wrap gap-1.5">
          {moreTools().map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRun(t.id, label(t.id))}
                className="glass-pill inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-[#032C26] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 dark:text-foreground dark:hover:bg-white/10"
              >
                <UseCaseIcon id={t.id} className="size-3.5" />{t.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
