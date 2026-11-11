import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Badge, Table, Td, Th, cn } from "@/components/ui/primitives";
import { FlagPill } from "@/components/emr/fhir-ui";
import { ANTIBIOTICS, refTextFor, rangeFor, testByCode, unitText, type LabTest } from "@/lib/fhir/lab-catalog";
import { formatResult } from "@/lib/fhir/lab-bundles";
import type { LabOrder } from "@/lib/fhir/types";

/** Short reference range for the table: "13 - 17 g/dL" when it has both ends, otherwise the narrative. */
export function shortRange(t: LabTest, sex: "M" | "F"): string {
  const { low, high } = rangeFor(t, sex);
  const u = unitText(t);
  if (t.kind === "quantity" && low !== undefined && high !== undefined) return `${low} - ${high}${u ? ` ${u}` : ""}`;
  return refTextFor(t, sex);
}

/** Results of one order: abnormal flags, critical rows in red, corrected and cancelled results marked. */
export function LabResultsTable({ order, sex }: { order: LabOrder; sex: "M" | "F" }) {
  const rows: { t: LabTest; indent: boolean; panel: boolean }[] = [];
  for (const code of order.codes) {
    const t = testByCode(code);
    if (!t) continue;
    if (t.panel) {
      rows.push({ t, indent: false, panel: true });
      for (const m of t.panel) {
        const mt = testByCode(m);
        if (mt) rows.push({ t: mt, indent: true, panel: false });
      }
    } else rows.push({ t, indent: false, panel: false });
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Test</Th>
          <Th>Result</Th>
          <Th>Reference</Th>
          <Th>Flag</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, indent, panel }) => {
          if (panel) {
            return (
              <tr key={`p-${t.code}`} className="bg-muted/40">
                <Td colSpan={5} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.short}
                </Td>
              </tr>
            );
          }
          const r = order.results[t.code];
          const critical = r && (r.interp === "HH" || r.interp === "LL") && r.status !== "cancelled";
          return (
            <React.Fragment key={t.code}>
              <tr className={cn(critical && "bg-destructive/10")}>
                <Td className={cn(indent && "pl-6", critical && "border-l-2 border-l-destructive")}>
                  <span className={cn("font-medium", r?.status === "cancelled" && "line-through opacity-60")}>{t.short}</span>
                </Td>
                <Td className={cn("tabular-nums", critical && "font-semibold text-destructive", r?.status === "cancelled" && "line-through opacity-60")}>
                  {r ? formatResult(t, r) : <span className="text-muted-foreground">Pending</span>}
                  {critical && <ShieldAlert className="ml-1.5 inline size-4 text-destructive" aria-label="Critical result" />}
                </Td>
                <Td className="max-w-[260px] text-xs text-muted-foreground" >
                  <span title={refTextFor(t, sex)}>{shortRange(t, sex).length > 70 ? `${shortRange(t, sex).slice(0, 67)}...` : shortRange(t, sex)}</span>
                </Td>
                <Td>{r ? <FlagPill interp={r.interp} /> : null}</Td>
                <Td>
                  {r?.status === "corrected" && <Badge tone="update">Corrected</Badge>}
                  {r?.status === "amended" && <Badge tone="update">Amended</Badge>}
                  {r?.status === "cancelled" && <Badge tone="neutral">Cancelled</Badge>}
                  {r?.status === "final" && <span className="text-xs text-muted-foreground">Final</span>}
                </Td>
              </tr>
              {r?.sens && r.sens.length > 0 && (
                <tr>
                  <Td colSpan={5} className="pl-6 text-xs">
                    <span className="mr-2 text-muted-foreground">Sensitivity</span>
                    {r.sens.map((s) => (
                      <span
                        key={s.key}
                        className={cn("mr-1.5 inline-block rounded px-1.5 py-0.5 font-medium", s.result === "R" ? "bg-destructive/12 text-destructive" : s.result === "I" ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok")}
                      >
                        {ANTIBIOTICS.find((a) => a.key === s.key)?.display.replace(" [Susceptibility]", "") ?? s.key}: {s.result}
                      </span>
                    ))}
                  </Td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}
