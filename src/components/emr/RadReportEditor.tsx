import * as React from "react";
import { PenLine } from "lucide-react";
import { Gate } from "@/components/emr/fhir-ui";
import { Badge, Button, Field, Hl7Tag, Input, Select, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { useDevMode } from "@/lib/devmode";
import { procByCode, reportTemplatesFor } from "@/lib/fhir/rad-catalog";
import type { RadOrder } from "@/lib/fhir/types";
import {
  PREGNANCY_TEXT, addRadAddendum, applyReportTemplate, canSignRadReport, isRadPublished, publishRadReport, releaseRadReport, reopenRadDraft,
  reportMissing, saveRadReport, setStudyImages, signRadReport,
} from "@/lib/radiology";
import { audit } from "@/lib/audit";
import { can, useSession } from "@/lib/session";
import { getState, patientName } from "@/lib/store";
import { pushToast } from "@/lib/toast";

const stamp = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** What the technologist recorded: machine, times, contrast and the pregnancy check. */
export function ExamSummary({ order }: { order: RadOrder }) {
  const s = order.study;
  if (!s) return null;
  const item = "rounded-md border border-border px-2 py-1";
  return (
    <div className="flex flex-wrap gap-2 text-xs text-foreground">
      <span className={item}>Exam done {stamp(s.performedEnd)} by {s.performedBy}</span>
      <span className={item}>Start {clock(s.performedStart)}, end {clock(s.performedEnd)}</span>
      {s.machine && <span className={item}>Machine: {s.machine}</span>}
      {s.contrastGiven !== undefined && <span className={item}>Contrast: {s.contrastGiven ? `given, ${s.contrastAmount}` : "not given"}</span>}
      {s.pregnancy && (
        <span className={cn(item, s.pregnancy !== "not-pregnant" && "border-warn/50 bg-warn/10 font-medium")}>
          Pregnancy check: {PREGNANCY_TEXT[s.pregnancy]}
          {s.pregnancyNote && `. ${s.pregnancyNote}`}
        </span>
      )}
    </div>
  );
}

/** Who reported and when: the signature line of a report. */
export function ReportSignature({ order }: { order: RadOrder }) {
  const r = order.report;
  if (!r) return null;
  return r.signedAt && r.signedBy ? (
    <p className="text-xs text-foreground">
      <span className="font-semibold">Reporting radiologist:</span> {r.signedBy.name}. Signed {stamp(r.signedAt)}.
    </p>
  ) : (
    <p className="text-xs text-foreground">
      <span className="font-semibold">Reporting radiologist:</span> not signed{r.reportedAt ? `. Released ${stamp(r.reportedAt)}.` : "."}
    </p>
  );
}

function Section({ title, children, strong, danger }: { title: string; children: React.ReactNode; strong?: boolean; danger?: boolean }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <p className={cn("whitespace-pre-wrap", strong && "font-medium", danger && "text-destructive")}>{children}</p>
    </div>
  );
}

/** The report as people read it, in the chart and under a signed report: the signed text first, addenda after it. */
export function RadReportView({ order }: { order: RadOrder }) {
  const dev = useDevMode();
  const r = order.report;
  if (!r) return null;
  const addenda = r.addenda ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      {r.technique && <Section title="Technique">{r.technique}</Section>}
      {r.findings && <Section title="Findings">{r.findings}</Section>}
      <Section title="Impression" strong danger={r.critical}>{r.impression}</Section>
      {r.critical && r.communicated && <p className="text-xs font-medium text-destructive">Critical finding told to {r.communicated}.</p>}
      {addenda.length > 0
        ? addenda.map((a, i) => (
            <div key={i} className="border-t border-border pt-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Addendum {i + 1}</div>
              <p className="whitespace-pre-wrap">{a.text}</p>
              <p className="text-xs text-muted-foreground">Added by {a.by}, {stamp(a.at)}</p>
            </div>
          ))
        : r.addendum && <Section title="Addendum">{r.addendum}</Section>}
      <div className="space-y-1.5 border-t border-border pt-2">
        <ReportSignature order={order} />
        <ExamSummary order={order} />
        <div className="text-xs text-muted-foreground">
          {order.study?.images ? "Images are available in PACS." : "No images are linked to this report."}
          {dev && order.study && <span className="ml-2 font-mono">Accession {order.study.accession} · Study {order.study.studyUid.slice(0, 24)}...</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * Report writing for the radiologist. Draft: pick a template for the study type, write Technique, Findings and
 * Impression. Then Sign Report (radiologist only), then Release Report. A signed report only takes addenda.
 */
export function RadReportEditor({ order }: { order: RadOrder }) {
  const dev = useDevMode();
  const { user } = useSession();
  const [amendAs, setAmendAs] = React.useState<"amended" | "corrected">("amended");
  const [template, setTemplate] = React.useState("normal");
  const [signing, setSigning] = React.useState(false);
  const [addendum, setAddendum] = React.useState("");
  const proc = procByCode(order.procCode);
  const r = order.report;
  const published = isRadPublished(order);
  const canReport = can("rad.report");
  const mayRadiologist = canReport && canSignRadReport(user);
  const missing = reportMissing(order);
  if (!r || !order.study) return null;

  const signed = !!r.signedAt;
  // The text is open while it is a draft. A report released before sign-off existed stays editable, as before.
  const editable = canReport && !signed && (order.status === "performed" || published);
  const templates = reportTemplatesFor(order.procCode);
  const set = (patch: Partial<typeof r>) => saveRadReport(order.id, patch);
  const criticalGap = r.critical && !r.communicated.trim();
  const canSignNow = mayRadiologist && order.status === "performed" && !signed && missing.length === 0 && !criticalGap;

  return (
    <div className="space-y-4">
      <ExamSummary order={order} />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={signed ? "ok" : "warn"}>{signed ? "Signed" : "Draft"}</Badge>
        <ReportSignature order={order} />
      </div>

      {published && !signed && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          This report is released. Change the text, then press Publish Amendment to replace the earlier version in NPHIES.
        </p>
      )}
      {signed && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          This report is signed, so its text cannot change. {published ? "Add an addendum for anything new." : "Release it to the chart, or reopen the draft to change it."}
        </p>
      )}

      {signed ? (
        <RadReportView order={order} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Template" className="w-64" hint={`Wording for ${proc?.short ?? "this exam"}. It replaces the text below.`}>
              <Select value={template} disabled={!editable} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </Select>
            </Field>
            <Gate allowed={canReport} reason="Your role cannot write radiology reports.">
              <Button className="mb-[1.375rem]" disabled={!editable} onClick={() => applyReportTemplate(order.id, template)}>
                Use Template
              </Button>
            </Gate>
            <label className="mb-[1.375rem] ml-auto flex items-center gap-2 text-sm">
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
            <Field label="Findings" required hl7="Findings section" className="md:col-span-2">
              <Textarea className="min-h-24" value={r.findings} aria-required="true" disabled={!editable} onChange={(e) => set({ findings: e.target.value })} />
            </Field>
            <Field label="Impression" required hl7="Impression section" className="md:col-span-2">
              <Textarea className={cn("min-h-16", r.critical && "border-destructive")} value={r.impression} aria-required="true" disabled={!editable} onChange={(e) => set({ impression: e.target.value })} />
            </Field>
            {published && (
              <Field label="Addendum" hl7="Addendum section" className="md:col-span-2">
                <Textarea value={r.addendum} disabled={!editable} onChange={(e) => set({ addendum: e.target.value })} placeholder="Add a note to the released report" />
              </Field>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={r.critical} disabled={!editable} onChange={(e) => set({ critical: e.target.checked })} />
              Critical Finding
            </label>
            {r.critical && (
              <Field label="Told To" required className="w-64">
                <Input value={r.communicated} aria-required="true" disabled={!editable} onChange={(e) => set({ communicated: e.target.value })} placeholder="Name of the clinician" />
              </Field>
            )}
            <p className="text-xs text-muted-foreground">Critical findings show in red on the chart.</p>
          </div>
        </>
      )}

      {signed && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <Field label="New Addendum" hl7="Addendum section" hint="An addendum is added after the signed text. The signed text stays as it is.">
            <Textarea value={addendum} disabled={!mayRadiologist} onChange={(e) => setAddendum(e.target.value)} placeholder="For example: compared with the outside study of last month, no change" />
          </Field>
          <Gate allowed={mayRadiologist} reason="Only a radiologist can add an addendum.">
            <Button disabled={!mayRadiologist || !addendum.trim()} onClick={() => { if (addRadAddendum(order.id, addendum)) setAddendum(""); }}>
              Add Addendum
            </Button>
          </Gate>
        </div>
      )}

      {signing && !signed && (
        <div role="group" aria-label="Sign report" className="space-y-2 rounded-lg border border-admit/50 bg-admit/10 p-3">
          <p className="text-sm">
            <span className="font-semibold">Sign as {user.name}?</span> You become the reporting radiologist. After signing, the text cannot change. Later notes go in as addenda.
          </p>
          <p className="text-sm"><span className="font-semibold">Impression:</span> {r.impression}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!canSignNow} onClick={() => { if (signRadReport(order.id)) setSigning(false); }}>
              <PenLine className="size-4" aria-hidden="true" />
              Confirm And Sign
            </Button>
            <Button onClick={() => setSigning(false)}>Keep Editing</Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!signed && (
          <Gate allowed={canReport} reason="Your role cannot write radiology reports.">
            <Button
              disabled={!editable}
              onClick={() => {
                const p = getState().patients.find((x) => x.id === order.patientId);
                audit("update", `Radiology report ${order.id}`, { patient: p && patientName(p), detail: `Draft saved, visit ${order.visitNumber}` });
                pushToast({ tone: "ok", text: "Draft saved.", detail: published ? "Publish the amendment to replace the earlier version." : "A radiologist must sign it before it can be released." });
              }}
            >
              Save Draft
            </Button>
          </Gate>
        )}
        {order.status === "performed" && !signed && !signing && (
          <Gate allowed={mayRadiologist} reason="Only a radiologist can sign a report.">
            <Button variant="primary" disabled={!canSignNow} onClick={() => setSigning(true)}>
              <PenLine className="size-4" aria-hidden="true" />
              Sign Report
            </Button>
          </Gate>
        )}
        {order.status === "performed" && signed && (
          <>
            <Gate allowed={canReport} reason="Your role cannot release radiology reports.">
              <Button variant="primary" disabled={!canReport} onClick={() => releaseRadReport(order.id)}>Release Report</Button>
            </Gate>
            <Gate allowed={mayRadiologist} reason="Only a radiologist can reopen a signed report.">
              <Button disabled={!mayRadiologist} onClick={() => reopenRadDraft(order.id)}>Reopen Draft</Button>
            </Gate>
          </>
        )}
        {published && (
          <>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Report Status
              <Select className="h-9 w-[130px]" value={amendAs} onChange={(e) => setAmendAs(e.target.value as "amended" | "corrected")} disabled={!canReport}>
                <option value="amended">Amended</option>
                <option value="corrected">Corrected</option>
              </Select>
            </label>
            <Gate allowed={canReport} reason="Your role cannot publish radiology reports.">
              <Button variant="primary" disabled={!canReport || !order.reportDirty || missing.length > 0} onClick={() => publishRadReport(order.id, amendAs)}>
                Publish Amendment
              </Button>
            </Gate>
            {!order.reportDirty && <span className="text-xs text-muted-foreground">{signed ? "Add an addendum to enable the amendment." : "Change the report to enable the amendment."}</span>}
          </>
        )}
        {order.status === "performed" && !signed && (
          <span className="text-xs font-medium text-warn" role="status">
            {missing.length > 0
              ? `Still empty: ${missing.join(", ")}.`
              : criticalGap
                ? "Say who was told about the critical finding."
                : !mayRadiologist
                  ? "Only a radiologist can sign. An unsigned report cannot be released."
                  : "Sign the report, then release it."}
          </span>
        )}
      </div>
    </div>
  );
}
