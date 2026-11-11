import * as React from "react";
import { Check as CheckIcon, Copy, Download, FilePlus2, FileX2, Send, Skull, Trash2 } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { DocPreview, ProblemList } from "@/components/emr/clinical-docs/Preview";
import { AssumptionList, ConformancePanel } from "@/components/emr/clinical-docs/Conformance";
import { copyText, downloadText } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Table, Td, Th, cn } from "@/components/ui/primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { conformanceSteps } from "@/lib/cda/conformance";
import { DOC_SPECS } from "@/lib/cda/docspec";
import { renderRequest } from "@/lib/cda/iti41";
import { DOC_TYPES, type DocType } from "@/lib/cda/types";
import { errorsOf } from "@/lib/cda/validate";
import { useDevMode } from "@/lib/devmode";
import { amendDoc, currentDoc, deleteDraft, deathRecorded, eventsForVisit, generateDoc, publishDoc, recordDeath, useDocs, type DocRecord, type DocStatus } from "@/lib/docs";
import type { Check, Encounter } from "@/lib/model";
import { getFormRecords, useRecords } from "@/lib/records";
import { can, useSession } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** Chart tab "Clinical Documents": generate, check, publish (simulated), amend. CDA R2 over IHE ITI-41. */

interface Slot {
  key: string;
  type: DocType;
  procIndex?: number;
  label: string;
}

const STATUS_TONE: Record<DocStatus, "neutral" | "ok" | "warn"> = { draft: "warn", published: "ok", deprecated: "neutral" };
const STATUS_LABEL: Record<DocStatus, string> = { draft: "Draft", published: "Published", deprecated: "Replaced" };
const LEVEL_TONE = { error: "danger", warn: "warn", ok: "ok" } as const;

function XmlView({ name, text }: { name: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  const lines = text.split("\n");
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-card">
      <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-muted/60 px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{name}</span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => downloadText(name, text)}>
            <Download className="size-3.5" /> Download
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (await copyText(text)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }
            }}
          >
            {copied ? <CheckIcon className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </Button>
        </span>
      </figcaption>
      <pre className="max-h-[560px] overflow-auto py-2 font-mono text-sm leading-[1.6]">
        <code className="block min-w-max">
          {lines.map((l, i) => (
            <div key={i} className="flex hover:bg-muted/50">
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/60">{i + 1}</span>
              <span className="whitespace-pre pr-4">{l}</span>
            </div>
          ))}
        </code>
      </pre>
    </figure>
  );
}

function KeyValue({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y divide-border rounded-lg border border-border text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 px-3 py-1.5">
          <dt className="w-48 shrink-0 text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-all font-mono text-xs leading-5">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetadataView({ doc }: { doc: DocRecord }) {
  const m = doc.built.metadata;
  const d = m.documentEntry;
  const c = (x: { code: string; system: string; display: string }) => `${x.code} | ${x.display} | ${x.system}`;
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">XDS Document Entry (Document Metadata and Provide and Register optionality)</h4>
        <KeyValue
          rows={[
            ["entryUUID", d.entryUUID], ["uniqueId", d.uniqueId], ["patientId", d.patientId], ["sourcePatientId", d.sourcePatientId], ["title", d.title],
            ["typeCode", c(d.typeCode)], ["classCode", c(d.classCode)], ["formatCode", c(d.formatCode)], ["mimeType", d.mimeType],
            ["confidentialityCode", c(d.confidentialityCode)], ["creationTime (UTC)", d.creationTime], ["languageCode", d.languageCode],
            ["healthcareFacilityTypeCode", c(d.healthcareFacilityTypeCode)], ["practiceSettingCode", c(d.practiceSettingCode)],
            ["author.person", d.author.person], ["author.institution", d.author.institution], ["author.role", d.author.role], ["author.speciality", d.author.speciality],
            ["availabilityStatus", d.availabilityStatus], ["hash (SHA-1)", d.hash], ["size (bytes)", String(d.size)],
            ["referenceIdList", d.referenceIdList.join("  ")], ["objectType", d.objectType], ["eventCodeList", "Not present"], ["serviceStartTime / serviceStopTime", "Not present"],
            ...(d.comments ? ([["comments", d.comments]] as [string, string][]) : []),
          ]}
        />
      </div>
      <div>
        <h4 className="mb-1.5 text-xs font-semibold text-muted-foreground">XDS Submission Set</h4>
        <KeyValue
          rows={[
            ["entryUUID", m.submissionSet.entryUUID], ["uniqueId", m.submissionSet.uniqueId], ["sourceId", m.submissionSet.sourceId],
            ["submissionTime (UTC)", m.submissionSet.submissionTime], ["contentTypeCode", c(m.submissionSet.contentTypeCode)],
            ["patientId", m.submissionSet.patientId], ["intendedRecipient", m.submissionSet.intendedRecipient],
            ...(m.association ? ([["Association RPLC", `${m.association.source} replaces ${m.association.target}`]] as [string, string][]) : []),
          ]}
        />
      </div>
    </div>
  );
}

function ChecksView({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {checks.map((c, i) => (
        <li key={i} className="flex items-start gap-3 px-3 py-2 text-sm">
          <Badge tone={LEVEL_TONE[c.level]}>{c.level}</Badge>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ClinicalDocsSection({ enc }: { enc: Encounter }) {
  const dev = useDevMode();
  const his = useHis();
  const ds = useDocs();
  useRecords();
  useSession();
  const patient = his.patients.find((p) => p.id === enc.patientId);
  const visit = enc.visitNumber;
  const [selKey, setSelKey] = React.useState<string>("");
  const [amending, setAmending] = React.useState<DocRecord | null>(null);
  const [reason, setReason] = React.useState("");
  const [dying, setDying] = React.useState(false);
  const [tabRaw, setTab] = React.useState("preview");
  const tab = !dev && tabRaw !== "preview" && tabRaw !== "history" ? "preview" : tabRaw;

  const forms = (id: string) => getFormRecords(visit, id);
  const delivery = forms("delivery-outcomes");
  const stillbirth = delivery.some((r) => /^still/i.test(String(r.values.birthStatus ?? "")));
  const cesarean = delivery.some((r) => /cesarean/i.test(String(r.values.mode ?? "")));
  const dead = deathRecorded(visit, ds) || enc.disposition === "20";
  const mayPublish = can("docs.publish");
  const mayWrite = can("emr.write");

  const slots: Slot[] = [];
  for (const t of DOC_TYPES) {
    if (t === "operative") {
      if (enc.pr.length === 0) slots.push({ key: "operative:0", type: t, procIndex: 0, label: DOC_SPECS[t].label });
      enc.pr.forEach((p, n) => slots.push({ key: `operative:${n}`, type: t, procIndex: n, label: `${DOC_SPECS[t].label}: ${p.text}` }));
    } else slots.push({ key: t, type: t, label: DOC_SPECS[t].label });
  }
  const suggested = (t: DocType) =>
    (t === "outpatient" && (enc.cls === "O" || enc.cls === "E")) || (t === "discharge" && enc.cls === "I") ||
    ((t === "maternal" || t === "newborn") && delivery.length > 0) || (t === "operative" && (enc.pr.length > 0 || forms("operation-request").length > 0));

  const docOf = (s: Slot) => currentDoc(visit, s.type, ds, s.procIndex);
  const sel = slots.find((s) => s.key === selKey) ?? slots.find((s) => docOf(s)) ?? slots.find((s) => suggested(s.type)) ?? slots[0];
  const doc = docOf(sel);
  const versions = ds.docs.filter((d) => d.visit === visit && d.type === sel.type && (sel.procIndex === undefined || d.procIndex === sel.procIndex));

  if (!patient) return <Card><Empty>The patient for this visit was not found.</Empty></Card>;

  const report = (r: { ok: boolean; message: string }) => pushToast({ tone: r.ok ? "ok" : "danger", text: r.message });
  const blockedReason = (s: Slot): string | null =>
    dead ? "A patient death is recorded. Nothing is published." : s.type === "newborn" && stillbirth ? "A stillbirth is recorded. No Newborn Discharge Summary is created." : !mayWrite ? "Your role cannot create documents." : null;

  const steps = conformanceSteps({
    docs: ds.docs.filter((d) => d.visit === visit).map((d) => ({ type: d.type, version: d.version, status: d.status, accepted: !!d.response?.ok, replaces: !!d.replaces, publishedAt: d.publishedAt })),
    deathRecorded: deathRecorded(visit, ds), stillbirth, cesarean, hasDelivery: delivery.length > 0,
  });
  const events = eventsForVisit(visit, ds);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Clinical Documents"
          subtitle="Create a summary from the chart, check it, and publish it to nphies. In this app, publishing is simulated and nothing leaves the browser."
          tag="CDA R2 over ITI-41"
          right={
            <Button size="sm" variant="danger" disabled={dead || !mayWrite} onClick={() => setDying(true)} title="Exception flow: patient death">
              <Skull className="size-4" /> Record Patient Death
            </Button>
          }
        />
        {dead && (
          <p className="border-b border-border bg-destructive/8 px-4 py-2 text-sm text-destructive">
            A patient death is recorded for this visit. No clinical document is published to nphies. Death reporting is a separate process and is not sent to nphies.
          </p>
        )}
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {slots.map((s) => {
            const d = docOf(s);
            const block = blockedReason(s);
            return (
              <div
                key={s.key}
                className={cn("flex flex-col gap-2 rounded-lg border p-3 transition-colors", sel.key === s.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40")}
              >
                <button className="text-left" onClick={() => setSelKey(s.key)} aria-pressed={sel.key === s.key}>
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                    {s.label}
                    {suggested(s.type) && !d && <Badge tone="primary">Suggested</Badge>}
                    {d && <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]} v{d.version}</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{DOC_SPECS[s.type].blurb}</span>
                  {dev && <span className="mt-1 block font-mono text-xs text-muted-foreground">LOINC {DOC_SPECS[s.type].typeCode} · template {DOC_SPECS[s.type].templateId.split(".").slice(-2).join(".")}</span>}
                </button>
                <div className="mt-auto flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={d ? "secondary" : "primary"}
                    disabled={!!block || d?.status === "published"}
                    title={block ?? undefined}
                    onClick={() => {
                      setSelKey(s.key);
                      setTab("preview");
                      report(generateDoc(enc, patient, s.type, { procIndex: s.type === "operative" ? s.procIndex : undefined }));
                    }}
                  >
                    <FilePlus2 className="size-4" /> {d?.status === "draft" ? "Regenerate" : "Generate"}
                  </Button>
                  {block && <span className="text-xs text-muted-foreground">{block}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {!doc ? (
        <Card>
          <Empty>{blockedReason(sel) ?? `Press Generate on "${sel.label}" to fill it from the chart.`}</Empty>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`${doc.built.title}, version ${doc.version}`}
            subtitle={`${STATUS_LABEL[doc.status]}${doc.publishedAt ? `, published ${doc.publishedAt.slice(0, 16).replace("T", " ")} by ${doc.publishedBy}` : ""}`}
            right={
              <div className="flex flex-wrap items-center gap-2">
                {doc.status === "draft" && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => deleteDraft(doc.id)}>
                      <Trash2 className="size-4" /> Delete Draft
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!mayPublish || dead}
                      title={!mayPublish ? "Your role cannot publish documents." : undefined}
                      onClick={() => {
                        report(publishDoc(doc.id));
                        setTab(dev ? "response" : "preview");
                      }}
                    >
                      <Send className="size-4" /> Publish To NPHIES
                    </Button>
                  </>
                )}
                {doc.status === "published" && (
                  <Button size="sm" variant="secondary" disabled={!mayPublish || dead} title={!mayPublish ? "Your role cannot publish documents." : undefined} onClick={() => { setReason(""); setAmending(doc); }}>
                    <FileX2 className="size-4" /> Amend
                  </Button>
                )}
              </div>
            }
          />
          <div className="space-y-3 p-4">
            {doc.status === "draft" && <ProblemList checks={doc.checks} />}
            {doc.response && !doc.response.ok && doc.status === "draft" && (
              <p className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">The registry rejected the last attempt. Fix the problems above, press Regenerate, then publish again.</p>
            )}
            {doc.amendReason && <p className="rounded-md bg-muted px-3 py-2 text-sm">Amendment reason: {doc.amendReason}</p>}
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex-wrap">
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="history">Version History</TabsTrigger>
                {dev && <TabsTrigger value="xml">XML</TabsTrigger>}
                {dev && <TabsTrigger value="meta">ITI-41 Metadata</TabsTrigger>}
                {dev && <TabsTrigger value="request">ITI-41 Request</TabsTrigger>}
                {dev && <TabsTrigger value="validator">Validator</TabsTrigger>}
                {dev && <TabsTrigger value="response">Response</TabsTrigger>}
              </TabsList>
              <TabsContent value="preview" className="pt-3"><DocPreview doc={doc.built} dev={dev} /></TabsContent>
              <TabsContent value="history" className="pt-3">
                <Table>
                  <thead><tr><Th>Version</Th><Th>Document Id</Th><Th>Status</Th><Th>Published</Th><Th>Replaces</Th><Th>Reason</Th></tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.id}>
                        <Td>{v.version}</Td>
                        <Td className="font-mono text-xs">{v.id}</Td>
                        <Td><Badge tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Badge></Td>
                        <Td className="text-xs">{v.publishedAt ? `${v.publishedAt.slice(0, 16).replace("T", " ")} by ${v.publishedBy}` : "Not published"}</Td>
                        <Td className="font-mono text-xs">{v.replaces ?? "None"}</Td>
                        <Td className="text-xs">{v.amendReason ?? ""}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TabsContent>
              {dev && <TabsContent value="xml" className="pt-3"><XmlView name={`${doc.id}.xml`} text={doc.built.xml} /></TabsContent>}
              {dev && <TabsContent value="meta" className="pt-3"><MetadataView doc={doc} /></TabsContent>}
              {dev && <TabsContent value="request" className="pt-3"><XmlView name={`${doc.id}-iti41.xml`} text={renderRequest(doc.built)} /></TabsContent>}
              {dev && (
                <TabsContent value="validator" className="space-y-2 pt-3">
                  <p className="text-xs text-muted-foreground">{errorsOf(doc.checks).length} errors, {doc.checks.filter((c) => c.level === "warn").length} warnings.</p>
                  <ChecksView checks={doc.checks} />
                </TabsContent>
              )}
              {dev && (
                <TabsContent value="response" className="space-y-2 pt-3">
                  {doc.response ? (
                    <>
                      <p className="text-sm">
                        <Badge tone={doc.response.ok ? "ok" : "danger"}>{doc.response.ok ? "Success" : "Failure"}</Badge>{" "}
                        <span className="text-muted-foreground">Simulated registry response at {doc.response.at.slice(0, 19).replace("T", " ")} UTC. No network call was made.</span>
                      </p>
                      <XmlView name="RegistryResponse.xml" text={doc.response.xml} />
                    </>
                  ) : (
                    <Empty>Not published yet. Press Publish To NPHIES to see the registry response.</Empty>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </div>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader title="Document History" subtitle="Everything that happened to this visit's documents." />
          <ol className="divide-y divide-border">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <span className="w-36 shrink-0 font-mono text-xs text-muted-foreground">{e.at.slice(0, 16).replace("T", " ")}</span>
                <Badge tone={e.kind === "published" || e.kind === "amended" ? "ok" : e.kind === "rejected" || e.kind === "death" ? "danger" : "neutral"}>{e.kind}</Badge>
                <span className="min-w-0 flex-1">{e.text}</span>
                <span className="text-xs text-muted-foreground">{e.user}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {dev && <ConformancePanel steps={steps} />}
      {dev && <AssumptionList />}

      <Dialog
        open={!!amending}
        onClose={() => setAmending(null)}
        title="Amend This Document"
        subtitle="A new version is built from the current chart. It replaces the published one, which becomes deprecated."
        footer={
          <>
            <Button onClick={() => setAmending(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!reason.trim()}
              onClick={() => {
                if (amending) report(amendDoc(enc, patient, amending.id, reason));
                setAmending(null);
              }}
            >
              Publish Amendment
            </Button>
          </>
        }
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
          Reason for the amendment
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: allergy was missing" />
        </label>
      </Dialog>

      <Dialog
        open={dying}
        onClose={() => setDying(false)}
        title="Record Patient Death"
        subtitle="Exception flow. When a patient dies, no clinical summary or operative note is published to nphies."
        footer={
          <>
            <Button onClick={() => setDying(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                report(recordDeath(enc, patient));
                setDying(false);
              }}
            >
              Record Death
            </Button>
          </>
        }
      >
        <p className="text-sm">After this, Generate and Publish are blocked for every document on visit {visit}. Death reporting is a separate process.</p>
      </Dialog>
    </div>
  );
}
