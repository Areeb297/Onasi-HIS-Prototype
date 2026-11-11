import * as React from "react";
import { Gate } from "@/components/emr/fhir-ui";
import { Button, Field, Hl7Tag, Input, Select, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { useDevMode } from "@/lib/devmode";
import { procByCode } from "@/lib/fhir/rad-catalog";
import type { RadOrder } from "@/lib/fhir/types";
import { applyReportTemplate, isRadPublished, publishRadReport, reportMissing, saveRadReport, setStudyImages } from "@/lib/radiology";
import { audit } from "@/lib/audit";
import { can } from "@/lib/session";
import { getState, patientName } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** Report writing for the radiologist: findings, impression, critical result, then publish or amend. */
export function RadReportEditor({ order }: { order: RadOrder }) {
  const dev = useDevMode();
  const [amendAs, setAmendAs] = React.useState<"amended" | "corrected">("amended");
  const proc = procByCode(order.procCode);
  const r = order.report;
  const published = isRadPublished(order);
  const canReport = can("rad.report");
  const editable = canReport && (order.status === "performed" || published);
  const missing = reportMissing(order);
  if (!r || !order.study) return null;

  const set = (patch: Partial<typeof r>) => saveRadReport(order.id, patch);

  return (
    <div className="space-y-4">
      {published && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          This report is published. Change the text, then press Publish Amendment to replace the earlier version in NPHIES.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Start From</span>
        {(["normal", "abnormal", "critical"] as const).map((k) => (
          <Gate key={k} allowed={canReport} reason="Your role cannot write radiology reports.">
            <Button size="sm" disabled={!editable} onClick={() => applyReportTemplate(order.id, k)}>
              {k === "normal" ? "Normal Study" : k === "abnormal" ? "Abnormal Study" : "Critical Finding"}
            </Button>
          </Gate>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={order.study.images} disabled={!editable} onChange={(e) => setStudyImages(order.id, e.target.checked)} />
          Images Available In PACS
          {dev && <Hl7Tag>ImagingStudy + Endpoint</Hl7Tag>}
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Technique" hl7="Procedures section">
          <Textarea value={r.technique} disabled={!editable} onChange={(e) => set({ technique: e.target.value })} placeholder={proc?.technique} />
        </Field>
        <Field label="Comparison" hl7="Comparison section">
          <Textarea value={r.comparison} disabled={!editable} onChange={(e) => set({ comparison: e.target.value })} placeholder="Previous studies, if any" />
        </Field>
        <Field label="Findings" hl7="Findings section" className="md:col-span-2">
          <Textarea className="min-h-24" value={r.findings} disabled={!editable} onChange={(e) => set({ findings: e.target.value })} />
        </Field>
        <Field label="Impression" hl7="Impression section" className="md:col-span-2">
          <Textarea className={cn("min-h-16", r.critical && "border-destructive")} value={r.impression} disabled={!editable} onChange={(e) => set({ impression: e.target.value })} />
        </Field>
        {published && (
          <Field label="Addendum" hl7="Addendum section" className="md:col-span-2">
            <Textarea value={r.addendum} disabled={!editable} onChange={(e) => set({ addendum: e.target.value })} placeholder="Add a note to the published report" />
          </Field>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={r.critical} disabled={!editable} onChange={(e) => set({ critical: e.target.checked })} />
          Critical Finding
        </label>
        {r.critical && (
          <Field label="Called To" className="w-64">
            <Input value={r.communicated} disabled={!editable} onChange={(e) => set({ communicated: e.target.value })} placeholder="Name of the clinician" />
          </Field>
        )}
        <p className="text-xs text-muted-foreground">Critical findings show in red on the chart.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Gate allowed={canReport} reason="Your role cannot write radiology reports.">
          <Button
            disabled={!editable}
            onClick={() => {
              const p = getState().patients.find((x) => x.id === order.patientId);
              audit("update", `Radiology report ${order.id}`, { patient: p && patientName(p), detail: `Draft saved, visit ${order.visitNumber}` });
              pushToast({ tone: "ok", text: "Report saved.", detail: "It is not published until you press Publish Report." });
            }}
          >
            Save Report
          </Button>
        </Gate>
        {published ? (
          <>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Report Status
              <Select className="h-9 w-[130px]" value={amendAs} onChange={(e) => setAmendAs(e.target.value as "amended" | "corrected")} disabled={!editable}>
                <option value="amended">Amended</option>
                <option value="corrected">Corrected</option>
              </Select>
            </label>
            <Gate allowed={canReport} reason="Your role cannot publish radiology reports.">
              <Button variant="primary" disabled={!editable || !order.reportDirty || missing.length > 0} onClick={() => publishRadReport(order.id, amendAs)}>
                Publish Amendment
              </Button>
            </Gate>
            {!order.reportDirty && <span className="text-xs text-muted-foreground">Change the report to enable the amendment.</span>}
          </>
        ) : (
          <Gate allowed={canReport} reason="Your role cannot publish radiology reports.">
            <Button variant="primary" disabled={!editable || missing.length > 0} onClick={() => publishRadReport(order.id)}>
              Publish Report
            </Button>
          </Gate>
        )}
        {missing.length > 0 && editable && <span className="text-xs text-muted-foreground">Still empty: {missing.join(", ")}</span>}
      </div>
    </div>
  );
}
