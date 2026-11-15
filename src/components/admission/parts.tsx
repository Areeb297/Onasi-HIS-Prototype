import * as React from "react";
import { BedDouble, Search, TriangleAlert, X } from "lucide-react";
import { Button, Input, cn } from "@/components/ui/primitives";
import { searchDiagnoses } from "@/lib/admission-requests";
import { bedInfos, bedProblem, unavailableLabel } from "@/lib/beds";
import { WARDS } from "@/lib/reference-data";
import { useHis } from "@/lib/store";

/** A labelled group for controls that are not a single input. Field is a <label>, which would pass clicks to the first button. */
export function Group({ label, required, hint, children, className }: { label: string; required?: boolean; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} role="group" aria-label={label}>
      <span className="flex min-h-5 items-center text-sm font-medium leading-5 text-foreground">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
            <span className="sr-only"> (required)</span>
          </>
        )}
      </span>
      {children}
      {hint && <span className="text-xs leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-5 text-sm font-semibold text-muted-foreground first:mt-0">{children}</h3>;
}

/** Problems that stop the confirm button. */
export function StillNeeded({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm" role="status">
      <div className="flex items-center gap-1.5 font-semibold text-warn"><TriangleAlert className="size-4" aria-hidden="true" /> Still needed</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {items.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

/** The consequences in plain words, shown before the confirm button. */
export function WhatWillHappen({ items }: { items: (string | false | undefined)[] }) {
  const list = items.filter((x): x is string => !!x);
  if (!list.length) return null;
  return (
    <div className="mt-4 rounded-lg border border-move/40 bg-move/8 px-3 py-2.5" role="note" aria-label="What will happen">
      <div className="text-sm font-semibold">What will happen</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {list.map((t) => <li key={t}>{t}</li>)}
      </ul>
    </div>
  );
}

/** ICD-10-AM search over the app's diagnosis list. One diagnosis is kept. */
export function DiagnosisSearch({ value, onChange }: { value?: { code: string; text: string }; onChange: (d: { code: string; text: string } | undefined) => void }) {
  const [q, setQ] = React.useState("");
  const hits = searchDiagnoses(q);
  const listId = React.useId();
  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-sm">
        <span className="min-w-0"><span className="font-mono font-medium">{value.code}</span> {value.text}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)} aria-label={`Remove ${value.code}`}><X className="size-4" /></Button>
      </div>
    );
  }
  return (
    <div className="[--field-h:2.5rem]">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by code or words, for example J18 or pneumonia"
          aria-label="Search ICD-10-AM diagnoses"
          aria-controls={listId}
        />
      </div>
      {q.trim() && (
        <ul id={listId} className="mt-1.5 max-h-48 overflow-y-auto rounded-lg border border-border" aria-label="Matching diagnoses">
          {hits.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No diagnosis matches. Try other words.</li>}
          {hits.map((d) => (
            <li key={d.code}>
              <button
                type="button"
                onClick={() => { onChange(d); setQ(""); }}
                className="flex w-full gap-2 border-b border-border/60 px-3 py-2 text-left text-sm last:border-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="w-16 shrink-0 font-mono font-medium">{d.code}</span>
                <span>{d.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const WARD_TEXT: Record<string, string> = { "3A": "text-move", "4B": "text-update", ICU: "text-cancel" };

/** Beds by ward, the department's ward first. Only a free bed, or the bed held for this patient, can be picked. */
export function BedPicker({ value, onPick, patientId, visit, ward, allowNone }: {
  value: string;
  onPick: (bedId: string) => void;
  patientId: string;
  visit?: string;
  ward?: string;
  allowNone?: boolean;
}) {
  const state = useHis();
  const infos = bedInfos(state);
  const who = { visit, patientId };
  const wards = [...WARDS].sort((a, b) => Number(b.ward === ward) - Number(a.ward === ward));
  const tile = (on: boolean, disabled: boolean) => cn(
    "flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled ? "cursor-not-allowed border-border bg-muted text-muted-foreground" : on ? "border-admit bg-admit/12" : "border-border bg-background hover:border-admit hover:bg-admit/10",
  );
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Bed">
      {allowNone && (
        <button type="button" role="radio" aria-checked={!value} onClick={() => onPick("")} className={cn(tile(!value, false), "w-full sm:w-auto")}>
          <span className="text-sm font-medium">No bed now{!value ? " (chosen)" : ""}</span>
        </button>
      )}
      {wards.map((w) => (
        <div key={w.ward}>
          <div className={cn("mb-1.5 text-xs font-semibold", WARD_TEXT[w.ward])}>{w.name}{w.ward === ward ? " (this department)" : ""}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {infos.filter((i) => i.bed.ward === w.ward).map((i) => {
              const why = bedProblem(state, i.bed.id, who, i) ? unavailableLabel(i, who) : "";
              const on = value === i.bed.id;
              return (
                <button key={i.bed.id} type="button" role="radio" aria-checked={on} disabled={!!why} onClick={() => onPick(i.bed.id)} className={tile(on, !!why)}>
                  <BedDouble className={cn("mt-0.5 size-4 shrink-0", why ? "text-muted-foreground" : "text-admit")} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{i.bed.room}-{i.bed.bed}{on ? " (chosen)" : ""}</span>
                    <span className="block text-xs">{why || (i.state === "reserved" ? "Reserved for this patient" : "Free")}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
