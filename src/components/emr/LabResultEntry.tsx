import * as React from "react";
import { Ban, RotateCcw, TriangleAlert } from "lucide-react";
import { FlagPill, Gate, TestCodeNote } from "@/components/emr/fhir-ui";
import { LabSignOff, shortRange } from "@/components/emr/LabResultsTable";
import { Badge, Button, Hl7Tag, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { ANTIBIOTICS, ORGANISMS, critTextFor, rangeProblems, refTextFor, testByCode, unitText, type LabTest } from "@/lib/fhir/lab-catalog";
import {
  awaitingVerification, cancelLabResult, fillSampleResults, isPublished, leafTests, missingResults, noteResultsSaved, publishLabResult,
  saveLabResult, submitForVerification,
} from "@/lib/lab";
import type { Patient } from "@/lib/model";
import { can } from "@/lib/session";
import type { LabOrder } from "@/lib/fhir/types";

const COLS = 7;

const stamp = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** One analyte: value, unit, reference range, critical range and the flag the system works out. */
function ResultRow({ order, test, sex, editable, indent }: { order: LabOrder; test: LabTest; sex: "M" | "F"; editable: boolean; indent: boolean }) {
  const dev = useDevMode();
  const r = order.results[test.code];
  const published = isPublished(order);
  const cancelled = r?.status === "cancelled";
  const canCancel = editable && !!r && (published || r.status !== "cancelled");
  const unit = unitText(test);
  const range = shortRange(test, sex);
  const crit = critTextFor(test);
  const critical = (r?.interp === "HH" || r?.interp === "LL") && !cancelled;
  const filled = !!r && (!!r.value.trim() || !!r.organism);

  return (
    <>
      <tr className={cn(critical && "bg-destructive/10")}>
        <Td className={cn("py-1.5", indent && "pl-6", critical && "border-l-2 border-l-destructive")}>
          <div className={cn("font-medium", cancelled && "line-through opacity-60")}>{test.short}</div>
          {dev && (
            <div className="mt-0.5 flex items-center gap-1.5">
              <Hl7Tag>Observation.code LOINC {test.code}</Hl7Tag>
              <TestCodeNote madeUp={test.madeUp} />
            </div>
          )}
        </Td>
        <Td className="py-1.5">
          {test.kind === "organism" ? (
            <Select
              aria-label={`${test.short} organism`}
              className="h-9 min-w-[150px]"
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
          ) : test.choices ? (
            <Select
              aria-label={`${test.short} result`}
              className="h-9 min-w-[120px]"
              value={r?.value ?? ""}
              disabled={!editable}
              onChange={(e) => saveLabResult(order.id, test.code, { value: e.target.value })}
            >
              <option value="">Choose result</option>
              {test.choices.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
              {r?.value && !test.choices.includes(r.value) && <option value={r.value}>{r.value}</option>}
            </Select>
          ) : (
            <Input
              aria-label={`${test.short} result`}
              aria-required="true"
              className="h-9 w-[110px] tabular-nums"
              value={r?.value ?? ""}
              disabled={!editable}
              inputMode="decimal"
              onChange={(e) => saveLabResult(order.id, test.code, { value: e.target.value })}
            />
          )}
        </Td>
        <Td className="py-1.5 text-xs whitespace-nowrap text-foreground">{unit}</Td>
        <Td className="max-w-[220px] py-1.5 text-xs text-foreground">
          <span title={refTextFor(test, sex)}>{range.length > 60 ? `${range.slice(0, 57)}...` : range}</span>
          {dev && <div className="mt-0.5 font-mono text-xs text-muted-foreground">{refTextFor(test, sex).length} characters in referenceRange.text</div>}
        </Td>
        <Td className="py-1.5 text-xs text-foreground">
          {crit ? <span className="font-medium text-destructive">{crit}</span> : <span className="text-muted-foreground">None set</span>}
        </Td>
        <Td className="py-1.5">{filled && r ? <FlagPill interp={r.interp} /> : <span className="text-xs text-muted-foreground">Empty</span>}</Td>
        <Td className="py-1.5">
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
          <Td colSpan={COLS} className="bg-muted/30">
            <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
              <label className="flex flex-col gap-1 text-xs font-medium text-foreground">
                Growth
                <Input value={r.value} disabled={!editable} onChange={(e) => saveLabResult(order.id, test.code, { value: e.target.value })} />
              </label>
              <div>
                <div className="mb-1 text-xs font-medium text-foreground">
                  Sensitivity {dev && <span className="ml-1 font-normal text-muted-foreground">(LOINC susceptibility codes)</span>}
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

/**
 * Result entry for one order, as one compact table: a row per analyte with the value, unit, reference range,
 * critical range and flag. The flag comes from the value and the ranges. When every result is in, the technologist
 * sends the order for verification; a second user verifies and releases it.
 */
export function LabResultEntry({ order, patient, onVerify }: { order: LabOrder; patient: Patient; onVerify?: () => void }) {
  const dev = useDevMode();
  const [amendAs, setAmendAs] = React.useState<"amended" | "corrected">("corrected");
  const published = isPublished(order);
  const waiting = awaitingVerification(order);
  const canEnter = can("lab.result");
  const editable = canEnter && !waiting && (order.status === "in-progress" || published);
  const missing = missingResults(order);
  const sex = patient.sex;

  const groups = order.codes.map((c) => testByCode(c)).filter((t): t is LabTest => !!t);
  const badRanges = dev ? leafTests(order).map((t) => ({ t, problems: rangeProblems(t) })).filter((x) => x.problems.length > 0) : [];

  return (
    <div className="space-y-4">
      {!editable && !waiting && order.status !== "resulted" && order.status !== "amended" && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {canEnter ? "Start processing the specimen before entering results." : "Your role cannot enter laboratory results."}
        </p>
      )}
      {order.sentBack && !waiting && !published && (
        <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <span className="font-semibold">Sent back by {order.sentBack.by}, {stamp(order.sentBack.at)}.</span> Reason: {order.sentBack.reason} Check the results, then send them for verification again.
        </p>
      )}
      {waiting && (
        <p className="rounded-lg border border-update/40 bg-update/10 px-3 py-2 text-sm">
          <span className="font-semibold">Waiting for verification.</span> The results cannot change now. A second user checks them, then releases them or sends them back.
        </p>
      )}
      {published && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          This result is released. Changing a value marks it as corrected. Cancel a result to remove it from the report. Then press Publish Amendment to replace the earlier version in NPHIES.
        </p>
      )}
      {badRanges.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <div className="font-semibold text-destructive">Catalogue range problem</div>
            {badRanges.map(({ t, problems }) => (
              <div key={t.code}>{t.short}: {problems.join(" ")}</div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border">
        <Table>
          <thead>
            <tr>
              <Th>Test</Th>
              <Th>
                Result
                {editable && !published && (
                  <>
                    <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
                    <span className="sr-only"> (required)</span>
                  </>
                )}
              </Th>
              <Th>Unit</Th>
              <Th>Reference Range</Th>
              <Th>Critical Range</Th>
              <Th>Flag</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((t) =>
              t.panel
                ? [
                    <tr key={`h-${t.code}`} className="bg-muted/40">
                      <Td colSpan={COLS} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                        {t.short} {dev && <span className="ml-1 font-mono font-normal normal-case text-muted-foreground">Observation panel, LOINC {t.code}, members in hasMember</span>}
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
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          The flag is worked out from the value and the ranges. It cannot be picked by hand.
        </p>
        <LabSignOff order={order} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {dev && !published && (
          <Gate allowed={canEnter} reason="Your role cannot enter laboratory results.">
            <Button disabled={!editable} onClick={() => fillSampleResults(order.id)} title="Fills empty results so the report meets the Seha minimum content (2.1.1) when the order has CBC, CRP, urinalysis and a culture.">
              Fill Sample Values
            </Button>
          </Gate>
        )}
        {!waiting && (
          <Gate allowed={canEnter} reason="Your role cannot enter laboratory results.">
            <Button disabled={!editable} onClick={() => noteResultsSaved(order.id)}>Save Results</Button>
          </Gate>
        )}
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
        ) : waiting ? (
          onVerify && (
            <Gate allowed={canEnter} reason="Your role cannot verify laboratory results.">
              <Button variant="primary" disabled={!canEnter} onClick={onVerify}>Verify Result</Button>
            </Gate>
          )
        ) : (
          <Gate allowed={canEnter} reason="Your role cannot enter laboratory results.">
            <Button variant="primary" disabled={!editable || missing.length > 0} onClick={() => submitForVerification(order.id)}>
              Send For Verification
            </Button>
          </Gate>
        )}
        {missing.length > 0 && editable && (
          <span className="text-xs font-medium text-warn" role="status">
            Still empty: {missing.map((m) => m.short).join(", ")}.{!published && ` Enter ${missing.length === 1 ? "it" : "them"} before you send for verification.`}
          </span>
        )}
      </div>
    </div>
  );
}
