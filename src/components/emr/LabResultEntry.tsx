import * as React from "react";
import { Ban, RotateCcw } from "lucide-react";
import { FlagPill, Gate, TestCodeNote } from "@/components/emr/fhir-ui";
import { shortRange } from "@/components/emr/LabResultsTable";
import { Badge, Button, Hl7Tag, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { ANTIBIOTICS, ORGANISMS, refTextFor, testByCode, unitText, type Interp, type LabTest } from "@/lib/fhir/lab-catalog";
import {
  cancelLabResult, fillSampleResults, isPublished, missingResults, noteResultsSaved, publishLabResult, saveLabResult,
} from "@/lib/lab";
import type { Patient } from "@/lib/model";
import { can } from "@/lib/session";
import type { LabOrder } from "@/lib/fhir/types";

const INTERPS: Interp[] = ["N", "H", "L", "HH", "LL", "A", "POS", "NEG"];

function ResultRow({ order, test, sex, editable, indent }: { order: LabOrder; test: LabTest; sex: "M" | "F"; editable: boolean; indent: boolean }) {
  const dev = useDevMode();
  const r = order.results[test.code];
  const published = isPublished(order);
  const cancelled = r?.status === "cancelled";
  const canCancel = editable && !!r && (published || r.status !== "cancelled");
  const unit = unitText(test);

  return (
    <>
      <tr className={cn((r?.interp === "HH" || r?.interp === "LL") && !cancelled && "bg-destructive/10")}>
        <Td className={cn(indent && "pl-6")}>
          <div className={cn("font-medium", cancelled && "line-through opacity-60")}>{test.short}</div>
          {dev && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Hl7Tag>Observation.code LOINC {test.code}</Hl7Tag>
              <TestCodeNote madeUp={test.madeUp} />
            </div>
          )}
        </Td>
        <Td>
          {test.kind === "organism" ? (
            <Select
              aria-label={`${test.short} organism`}
              value={r?.organism?.code ?? (r?.value === "No growth" ? "none" : "")}
              disabled={!editable}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "none") saveLabResult(order.id, test.code, { value: "No growth", organism: null, sens: [] });
                else if (v) {
                  const org = ORGANISMS.find((o) => o.code === v)!;
                  saveLabResult(order.id, test.code, { value: r?.value && r.value !== "No growth" ? r.value : ">100,000 CFU/mL", organism: org });
                } else saveLabResult(order.id, test.code, { value: "", organism: null });
              }}
            >
              <option value="">Choose result</option>
              <option value="none">No growth</option>
              {ORGANISMS.map((o) => (
                <option key={o.code} value={o.code}>{o.display}</option>
              ))}
            </Select>
          ) : (
            <div className="flex items-center gap-1.5">
              <Input
                aria-label={`${test.short} result`}
                className="min-w-[90px]"
                list={test.choices ? `choices-${test.code}` : undefined}
                value={r?.value ?? ""}
                disabled={!editable}
                inputMode={test.choices ? "text" : "decimal"}
                onChange={(e) => saveLabResult(order.id, test.code, { value: e.target.value })}
              />
              {test.choices && (
                <datalist id={`choices-${test.code}`}>
                  {test.choices.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              )}
              {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
            </div>
          )}
        </Td>
        <Td className="max-w-[240px] text-xs text-muted-foreground">
          <span title={refTextFor(test, sex)}>{shortRange(test, sex).length > 60 ? `${shortRange(test, sex).slice(0, 57)}...` : shortRange(test, sex)}</span>
          {dev && <div className="mt-0.5 font-mono text-xs">{refTextFor(test, sex).length} characters in referenceRange.text</div>}
        </Td>
        <Td>
          {r ? (
            <div className="flex items-center gap-1.5">
              <FlagPill interp={r.interp} />
              {editable && (
                <Select
                  aria-label={`${test.short} flag`}
                  className="h-8 w-[86px] px-1.5 text-xs"
                  value={r.interp}
                  onChange={(e) => saveLabResult(order.id, test.code, { interp: e.target.value as Interp })}
                >
                  {INTERPS.map((i) => (
                    <option key={i} value={i}>{i}</option>
                  ))}
                </Select>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Empty</span>
          )}
        </Td>
        <Td>
          <div className="flex items-center gap-1.5">
            {r?.status === "corrected" && <Badge tone="update">Corrected</Badge>}
            {cancelled && <Badge tone="neutral">Cancelled</Badge>}
            {canCancel && (
              <Button
                size="sm"
                variant="ghost"
                title={cancelled ? "Restore this result" : "Cancel this result. It stays in the report with status cancelled."}
                onClick={() => cancelLabResult(order.id, test.code, !cancelled)}
              >
                {cancelled ? <RotateCcw className="size-3.5" /> : <Ban className="size-3.5" />}
                {cancelled ? "Restore" : "Cancel Result"}
              </Button>
            )}
          </div>
        </Td>
      </tr>
      {test.kind === "organism" && r?.organism && (
        <tr>
          <Td colSpan={5} className="bg-muted/30">
            <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                Growth
                <Input value={r.value} disabled={!editable} onChange={(e) => saveLabResult(order.id, test.code, { value: e.target.value })} />
              </label>
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Sensitivity {dev && <span className="ml-1 font-normal">(antibiotic codes are test codes)</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {ANTIBIOTICS.map((a) => {
                    const cur = r.sens?.find((s) => s.key === a.key)?.result ?? "";
                    return (
                      <label key={a.key} className="flex items-center gap-1 text-xs">
                        {a.display.replace(" [Susceptibility]", "")}
                        <Select
                          aria-label={`${a.display} result`}
                          className="h-8 w-[64px] px-1.5 text-xs"
                          value={cur}
                          disabled={!editable}
                          onChange={(e) => {
                            const rest = (r.sens ?? []).filter((s) => s.key !== a.key);
                            const v = e.target.value as "S" | "I" | "R" | "";
                            saveLabResult(order.id, test.code, { sens: v ? [...rest, { key: a.key, result: v }] : rest });
                          }}
                        >
                          <option value="">-</option>
                          <option value="S">S</option>
                          <option value="I">I</option>
                          <option value="R">R</option>
                        </Select>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </Td>
        </tr>
      )}
    </>
  );
}

/** Result entry for one order: quantitative, textual and microbiology results, then publish or amend. */
export function LabResultEntry({ order, patient }: { order: LabOrder; patient: Patient }) {
  const dev = useDevMode();
  const [amendAs, setAmendAs] = React.useState<"amended" | "corrected">("corrected");
  const published = isPublished(order);
  const canEnter = can("lab.result");
  const editable = canEnter && (order.status === "in-progress" || published);
  const missing = missingResults(order);
  const sex = patient.sex;

  const groups = order.codes.map((c) => testByCode(c)).filter((t): t is LabTest => !!t);

  return (
    <div className="space-y-4">
      {!editable && order.status !== "resulted" && order.status !== "amended" && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {canEnter ? "Start processing the specimen before entering results." : "Your role cannot enter laboratory results."}
        </p>
      )}
      {published && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          This result is published. Changing a value or flag marks it as corrected. Cancel a result to remove it from the report. Then press Publish Amendment to replace the earlier version in NPHIES.
        </p>
      )}

      <div className="rounded-lg border border-border">
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
            {groups.flatMap((t) =>
              t.panel
                ? [
                    <tr key={`h-${t.code}`} className="bg-muted/40">
                      <Td colSpan={5} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.short} {dev && <span className="ml-1 font-mono normal-case">Observation panel, LOINC {t.code}, members in hasMember</span>}
                      </Td>
                    </tr>,
                    ...t.panel.map((m) => testByCode(m)).filter((m): m is LabTest => !!m).map((m) => (
                      <ResultRow key={m.code} order={order} test={m} sex={sex} editable={editable} indent />
                    )),
                  ]
                : [<ResultRow key={t.code} order={order} test={t} sex={sex} editable={editable} indent={false} />],
            )}
          </tbody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {dev && (
          <Gate allowed={canEnter} reason="Your role cannot enter laboratory results.">
            <Button disabled={!editable} onClick={() => fillSampleResults(order.id)} title="Fills empty results so the report meets the Seha minimum content (2.1.1) when the order has CBC, CRP, urinalysis and a culture.">
              Fill Conformance Sample Values
            </Button>
          </Gate>
        )}
        <Gate allowed={canEnter} reason="Your role cannot enter laboratory results.">
          <Button disabled={!editable} onClick={() => noteResultsSaved(order.id)}>Save Results</Button>
        </Gate>
        {published ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Report Status
              <Select className="h-9 w-[130px]" value={amendAs} onChange={(e) => setAmendAs(e.target.value as "amended" | "corrected")} disabled={!editable}>
                <option value="corrected">Corrected</option>
                <option value="amended">Amended</option>
              </Select>
            </label>
            <Gate allowed={canEnter} reason="Your role cannot publish laboratory results.">
              <Button variant="primary" disabled={!editable || !order.resultDirty || missing.length > 0} onClick={() => publishLabResult(order.id, amendAs)}>
                Publish Amendment
              </Button>
            </Gate>
            {!order.resultDirty && <span className="text-xs text-muted-foreground">Change a result to enable the amendment.</span>}
          </>
        ) : (
          <Gate allowed={canEnter} reason="Your role cannot publish laboratory results.">
            <Button variant="primary" disabled={!editable || missing.length > 0} onClick={() => publishLabResult(order.id)}>
              Publish Result
            </Button>
          </Gate>
        )}
        {missing.length > 0 && editable && <span className="text-xs text-muted-foreground">Still empty: {missing.map((m) => m.short).join(", ")}</span>}
      </div>
    </div>
  );
}
