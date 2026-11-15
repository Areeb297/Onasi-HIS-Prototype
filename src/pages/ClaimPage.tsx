import * as React from "react";
import { ArrowLeft, ClipboardCheck, Plus, Save, Send, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { IconAlertTriangle, IconCircleCheck, IconHandStop, IconOctagon } from "@tabler/icons-react";
import { ReviewDialog, useClaimSend } from "@/components/claims/ClaimParts";
import { BrandChip, StatusChip, fmtDate, fmtDateTime } from "@/components/claims/RcmUi";
import { CommitInput, ServiceLinesCard } from "@/components/claims/ServiceLinesCard";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  addSupport, CARE_ROLE_LABEL, checkEligibility, CLAIM_TYPE_LABEL, claimFor, claimStatusOf, DX_TYPE_LABEL, ON_ADMISSION_LABEL, PRIORITY_LABEL, removeSupport,
  reviewModel, reviewSummary, runReview, saveCareTeam, saveClaim, saveDx, saveHeader, sendOptions, SEVERITY_LABEL, SUBTYPE_LABEL, SUPPORT_CATEGORIES, SUPPORT_LABEL,
  unconfirmedSoftStops, useClaims,
  type CareRole, type CareTeamMember, type ClaimModel, type ClaimPriority, type ClaimSubType, type ClaimType, type DxType, type Finding, type HeaderPatch, type OnAdmission, type Severity,
} from "@/lib/claims";
import { ensureInvoice, invoiceOf, useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { ADMISSION_METHODS, DISPOSITIONS, DOCTORS, SERVICES } from "@/lib/reference-data";
import { navigate, useRoute } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

const warn = (r: { ok: boolean; problems?: string[] }) => { if (!r.ok) pushToast({ tone: "warn", text: r.problems?.[0] ?? "Not saved." }); return r.ok; };
const CLASS_LABEL: Record<string, string> = { O: "Outpatient", E: "Emergency", I: "Inpatient" };
const STATUS_LABEL: Record<string, string> = { active: "In Progress", discharged: "Finished", preadmit: "Pre-Admission", cancelled: "Cancelled" };

/** The claim form in the order the HIS biller page uses. Each id is a "Go To Field" target. */
const SECTIONS: { id: string; label: string; inpatientOnly?: boolean }[] = [
  { id: "claim-details", label: "Claim Details" },
  { id: "claim-encounter", label: "Encounter" },
  { id: "claim-care-team", label: "Care Team" },
  { id: "claim-support", label: "Supporting Information" },
  { id: "claim-dx", label: "Diagnoses" },
  { id: "claim-drg", label: "AR-DRG", inpatientOnly: true },
  { id: "claim-lines", label: "Service Lines" },
  { id: "claim-financial", label: "Financial Summary" },
];

/** Where each review finding is fixed. */
function targetOf(f: Finding): { section: string; field: string } {
  if (f.lineKey) return { section: "claim-lines", field: `line-${f.lineKey}` };
  switch (f.rule) {
    case "no-principal-dx": case "many-principal-dx": return { section: "claim-dx", field: "claim-dx" };
    case "no-chief-complaint": return { section: "claim-support", field: "support-complaint" };
    case "no-vitals": case "vitals-missing": return { section: "claim-support", field: "claim-support" };
    case "auth-not-approved": return { section: "claim-details", field: "fact-preauth" };
    default: return { section: "claim-details", field: "claim-details" };
  }
}

/** Scrolls to the field, focuses the first control in it and marks it for a moment. */
function goToField(id: string) {
  // A service line has a table row and a phone card; use the one on screen.
  const el = [document.getElementById(id), document.getElementById(`${id}-m`)].find((x) => x && x.offsetParent !== null) ?? document.getElementById(id);
  if (!el) return;
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
  const control = el.matches("input,select,button,textarea") ? el : el.querySelector<HTMLElement>("input:not([disabled]),select:not([disabled]),button:not([disabled]),textarea:not([disabled])");
  (control ?? el).focus({ preventScroll: true });
  el.setAttribute("data-flash", "true");
  window.setTimeout(() => el.removeAttribute("data-flash"), 1800);
}
const flash = "transition-shadow data-[flash=true]:ring-2 data-[flash=true]:ring-[#03c1ac] data-[flash=true]:ring-offset-2 data-[flash=true]:ring-offset-background";

function Fact({ label, children, id }: { label: string; children: React.ReactNode; id?: string }) {
  return (
    <div id={id} tabIndex={id ? -1 : undefined} className={cn("min-w-0 rounded-lg", id && flash)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Section({ id, title, subtitle, right, children }: { id: string; title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} tabIndex={-1} className={cn("scroll-mt-48 rounded-2xl focus-visible:outline-none", flash)}>
      <Card>
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-[0.9375rem] font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 max-w-3xl text-[0.8125rem] text-muted-foreground">{subtitle}</p>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
        {children}
      </Card>
    </section>
  );
}

/** Claim for one insured visit: /claim?visit=V... */
export function ClaimPage() {
  const { params } = useRoute();
  const visit = params.get("visit") ?? "";
  const his = useHis();
  const lab = useLab();
  const rad = useRad();
  const rx = useRx();
  const fin = useFinancial();
  const invoices = useInvoices();
  useClaims();
  useVitals();
  useSession();
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [send, sendDialog] = useClaimSend();

  const enc = his.encounters.find((e) => e.visitNumber === visit);
  const billable = !!enc && enc.status !== "preadmit" && enc.status !== "cancelled";
  // Amounts come from the invoice: open it the same way the Invoice page does.
  React.useEffect(() => { if (billable) ensureInvoice(visit); }, [visit, billable, his, lab, rad, rx]);

  if (!visit) return <Card><Empty>No visit was given. Open a claim from the Billing Worklist.</Empty></Card>;
  const m = billable ? claimFor(visit) : null;
  if (!enc || !m) return <Card><Empty>Visit {visit} was not found or cannot be billed.</Empty></Card>;
  if (!m.payer || m.patient.extra?.visitPayType === "Cash") {
    return <Card><Empty>This is a cash visit. It is billed on the invoice, not by a claim.</Empty></Card>;
  }

  const allowed = can("billing");
  const readOnly = !allowed || m.locked;
  const claimFindings = reviewModel(m, "claim");
  const options = sendOptions(enc, fin);
  const status = claimStatusOf(m.fin);
  const inv = invoiceOf(visit, invoices);
  const sum = reviewSummary(claimFindings);
  const noRole = "Your role cannot send. This needs the billing permission.";
  // The step most likely next gets the filled button.
  const next = options.claim.enabled ? "claim" : options.priorAuth.enabled && m.authNeeded ? "priorauth" : null;
  const sections = SECTIONS.filter((s) => !s.inpatientOnly || m.drg);
  const sectionHits = new Map<string, Severity>();
  for (const f of claimFindings) {
    const s = targetOf(f).section;
    const prev = sectionHits.get(s);
    if (!prev || f.severity === "hard" || (f.severity === "soft" && prev === "warning")) sectionHits.set(s, f.severity);
  }

  const onSave = () => {
    (document.activeElement as HTMLElement | null)?.blur?.(); // commits a field still being typed in
    if (warn(saveClaim(visit))) pushToast({ tone: "ok", text: "Claim saved." });
  };

  return (
    <TooltipProvider delayDuration={250}>
      {/* Sticky header: who, which payer, where it stands, the money, and the actions. */}
      <div className="glass-panel sticky top-[3.4rem] z-20 -mt-1 mb-4 rounded-2xl">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4">
          <Button size="sm" variant="ghost" onClick={() => navigate("/billing")} aria-label="Back to the Billing Worklist" className="-ms-1 px-2"><ArrowLeft className="size-4" /></Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight">{patientName(m.patient)}</h1>
              <StatusChip status={status} />
            </div>
            <p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">
              {m.fin.claim ? <span className="font-mono font-semibold text-foreground">{m.fin.claim.claimNumber}</span> : "Claim not sent yet"}
              {", "}MRN <span className="font-mono">{m.patient.mrn}</span>, visit <span className="font-mono">{visit}</span>, {m.payer}, {CLAIM_TYPE_LABEL[m.type]} {SUBTYPE_LABEL[m.subType]}
            </p>
          </div>
          <div className="flex w-full items-center gap-1.5 sm:w-auto sm:gap-2">
            <Button size="sm" className="flex-1 sm:flex-none" onClick={() => { runReview(visit); setReviewOpen(true); }} aria-label={`Review, ${sum.hard} Hard Stops, ${sum.soft} Soft Stops, ${sum.warning} Warnings`}>
              <ClipboardCheck className="size-4" /> Review
              {sum.hard + sum.soft > 0 && <span aria-hidden="true" className={cn("rounded-full px-1.5 text-[0.6875rem] font-semibold leading-5 text-white", sum.hard ? "bg-destructive" : "bg-warn")}>{sum.hard || sum.soft}</span>}
            </Button>
            {options.eligibility.enabled && (
              <Button size="sm" className="flex-1 sm:flex-none" disabled={!allowed} title={allowed ? options.eligibility.why : noRole} onClick={() => warn(checkEligibility(visit))}><UserCheck className="size-4" /> <span className="sm:hidden">Eligibility</span><span className="hidden sm:inline">{options.eligibility.label}</span></Button>
            )}
            <Button size="sm" className="flex-1 sm:flex-none" variant={next === "priorauth" ? "primary" : "secondary"} disabled={!allowed || !options.priorAuth.enabled} title={!allowed ? noRole : options.priorAuth.enabled ? options.priorAuth.label : options.priorAuth.why} onClick={() => send(visit, "priorauth")}>
              <ShieldCheck className="size-4" /> <span className="sm:hidden">PreAuth</span><span className="hidden sm:inline">{options.priorAuth.label.replace("Prior Authorization", "PreAuth")}</span>
            </Button>
            <Button size="sm" className="flex-1 sm:flex-none" variant={next === "claim" ? "primary" : "secondary"} disabled={!allowed || !options.claim.enabled} title={!allowed ? noRole : options.claim.enabled ? options.claim.label : options.claim.why} onClick={() => send(visit, "claim")}>
              <Send className="size-4" /> <span className="sm:hidden">Claim</span><span className="hidden sm:inline">{options.claim.label}</span>
            </Button>
            <Button size="sm" disabled={readOnly} aria-label="Save" title={readOnly ? (m.locked ? "The payer holds this claim. It cannot be changed." : noRole) : m.draft?.savedAt ? `Last saved ${fmtDateTime(m.draft.savedAt)}` : "Not saved yet"} onClick={onSave}>
              <Save className="size-4" /> <span className="hidden sm:inline">Save</span>
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border/70 pe-4">
          <nav aria-label="Claim sections" className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]">
            {sections.map((s) => {
              const hit = sectionHits.get(s.id);
              return (
                <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); goToField(s.id); }}
                  className="relative inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {hit && <span aria-hidden="true" className={cn("size-1.5 rounded-full", hit === "hard" ? "bg-destructive" : hit === "soft" ? "bg-warn" : "bg-move")} />}
                  {s.label}
                  {hit && <span className="sr-only">, has a {SEVERITY_LABEL[hit]}</span>}
                </a>
              );
            })}
          </nav>
          <dl className="hidden shrink-0 items-baseline gap-4 text-sm lg:flex">
            <div className="flex items-baseline gap-1.5"><dt className="text-xs text-muted-foreground">Net</dt><dd className="font-semibold"><Sar value={m.net} /></dd></div>
            <div className="flex items-baseline gap-1.5"><dt className="text-xs text-muted-foreground">Insurance Share</dt><dd className="font-semibold"><Sar value={m.totals.insuranceAmount} /></dd></div>
          </dl>
        </div>
      </div>

      {/* Phone: what the sticky header leaves out. */}
      <Card className="mb-4 px-4 py-3 sm:hidden">
        <p className="text-xs text-muted-foreground">
          {m.fin.claim ? <span className="font-mono font-semibold text-foreground">{m.fin.claim.claimNumber}</span> : "Claim not sent yet"}, MRN <span className="font-mono">{m.patient.mrn}</span>, visit <span className="font-mono">{visit}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1"><BrandChip>{m.payer}</BrandChip><BrandChip>{CLAIM_TYPE_LABEL[m.type]}</BrandChip><BrandChip>{SUBTYPE_LABEL[m.subType]}</BrandChip></div>
        <dl className="mt-2 grid grid-cols-2 gap-2">
          <div><dt className="text-xs text-muted-foreground">Net Amount</dt><dd className="font-semibold"><Sar value={m.net} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Insurance Share</dt><dd className="font-semibold"><Sar value={m.totals.insuranceAmount} /></dd></div>
        </dl>
      </Card>

      {m.locked && <Card className="mb-4 border-move/40 px-4 py-3 text-sm">The payer is holding or has approved this claim, so it cannot be changed. Follow it on Submitted Transactions.</Card>}
      {!allowed && <Card className="mb-4 border-warn/40 px-4 py-3 text-sm">You can read this claim. Changing and sending it needs the billing permission.</Card>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DetailsSection m={m} readOnly={readOnly} />
          <EncounterSection m={m} />
          <CareTeamSection m={m} readOnly={readOnly} />
          <SupportSection m={m} readOnly={readOnly} />
          <DiagnosesSection m={m} readOnly={readOnly} />
          {m.drg && <DrgSection m={m} />}
          <section id="claim-lines" aria-label="Service Lines" tabIndex={-1} className={cn("scroll-mt-48 rounded-2xl focus-visible:outline-none", flash)}>
            <ServiceLinesCard m={m} findings={claimFindings} readOnly={readOnly} />
          </section>
          <FinancialSection m={m} invoiceNumber={inv?.number} />
        </div>
        <aside className="min-w-0" aria-label="Review">
          <div className="xl:sticky xl:top-[10.75rem]">
            <ReviewPanel m={m} findings={claimFindings} onRun={() => runReview(visit)} />
          </div>
        </aside>
      </div>

      <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} visit={visit} findings={claimFindings} ack={m.draft?.ack} />
      {sendDialog}
    </TooltipProvider>
  );
}

/* ---------- review panel ---------- */

const SEV_ICON: Record<Severity, typeof IconOctagon> = { hard: IconOctagon, soft: IconHandStop, warning: IconAlertTriangle };
const SEV_TEXT: Record<Severity, string> = { hard: "text-destructive", soft: "text-warn", warning: "text-move" };

function ReviewPanel({ m, findings, onRun }: { m: ClaimModel; findings: Finding[]; onRun: () => void }) {
  const confirmed = new Set(m.draft?.ack?.ids ?? []);
  const open = unconfirmedSoftStops(findings, m.draft?.ack).length;
  const groups: Severity[] = ["hard", "soft", "warning"];
  return (
    <Card>
      <CardHeader
        title="Review"
        subtitle={m.draft?.reviewedAt ? `Last run ${fmtDateTime(m.draft.reviewedAt)}` : "Checks run as you edit. Run Review records it."}
        right={<Button size="sm" onClick={onRun}>Run Review</Button>}
      />
      <div className="flex flex-col gap-3 p-4">
        {!findings.length && (
          <p className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2.5 text-sm text-ok"><IconCircleCheck className="size-4 shrink-0" stroke={1.75} aria-hidden="true" /> Nothing to fix. The claim can be sent.</p>
        )}
        {groups.map((sev) => {
          const list = findings.filter((f) => f.severity === sev);
          if (!list.length) return null;
          const Icon = SEV_ICON[sev];
          return (
            <div key={sev}>
              <h3 className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-semibold", SEV_TEXT[sev])}>
                <Icon className="size-3.5" stroke={2} aria-hidden="true" /> {SEVERITY_LABEL[sev]}{list.length > 1 ? `s` : ""} ({list.length})
              </h3>
              <ul className="flex flex-col gap-1.5">
                {list.map((f) => (
                  <li key={f.id} className={cn("rounded-lg border px-3 py-2", sev === "hard" ? "border-destructive/30 bg-destructive/[0.04]" : sev === "soft" ? "border-warn/30 bg-warn/[0.05]" : "border-border")}>
                    <p className="text-[0.8125rem] font-medium leading-snug">{f.text}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.fix}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => goToField(targetOf(f).field)} className="rounded text-xs font-semibold text-[#035d53] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-[#39edd5]">
                        Go To Field
                      </button>
                      {confirmed.has(f.id) && <Badge tone="ok">Confirmed</Badge>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {open > 0 && <p className="text-xs text-muted-foreground">{open} Soft Stop{open === 1 ? "" : "s"} will ask for a reason when you send.</p>}
        {m.draft?.ack && <p className="text-xs text-muted-foreground">Soft Stops confirmed by {m.draft.ack.by}: {m.draft.ack.reason}</p>}
      </div>
    </Card>
  );
}

/* ---------- claim details ---------- */

function DetailsSection({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const save = (patch: HeaderPatch) => warn(saveHeader(m.visit, patch));
  const { eligibility: el, authorization: au, claim: cl } = m.fin;
  return (
    <Section id="claim-details" title="Claim Details" subtitle="Type and sub-type follow the visit class unless you change them.">
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Claim Type" required>
          <Select value={m.type} disabled={readOnly} onChange={(e) => save({ type: e.target.value as ClaimType })}>
            {(Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Sub-Type" required>
          <Select value={m.subType} disabled={readOnly} onChange={(e) => save({ subType: e.target.value as ClaimSubType })}>
            {(Object.keys(SUBTYPE_LABEL) as ClaimSubType[]).map((t) => <option key={t} value={t}>{SUBTYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Priority" required>
          <Select value={m.priority} disabled={readOnly} onChange={(e) => save({ priority: e.target.value as ClaimPriority })}>
            {(Object.keys(PRIORITY_LABEL) as ClaimPriority[]).map((t) => <option key={t} value={t}>{PRIORITY_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Claim Date" required><CommitInput type="date" label="Claim Date" value={m.claimDate} disabled={readOnly} onCommit={(v) => save({ claimDate: v })} /></Field>
        <Field label="Accounting Date" required hint="The day the claim is booked in the accounts."><CommitInput type="date" label="Accounting Date" value={m.accountingDate} disabled={readOnly} onCommit={(v) => save({ accountingDate: v })} /></Field>
        <Field label="Service Start" required><CommitInput type="date" label="Service Start" value={m.start} disabled={readOnly} onCommit={(v) => save({ start: v, end: m.end })} /></Field>
        <Field label="Service End" required><CommitInput type="date" label="Service End" value={m.end} disabled={readOnly} onCommit={(v) => save({ start: m.start, end: v })} /></Field>
      </div>
      <dl className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Payer">{m.payer}</Fact>
        <Fact label="Eligibility">{el ? <>{el.status === "eligible" ? "Eligible" : "Not Eligible"} <span className="font-mono text-xs text-muted-foreground">{el.ref}</span></> : "Not Checked"}</Fact>
        <Fact label="Prior Authorization" id="fact-preauth">
          {au ? <>{au.status === "approved" ? "Approved" : au.status === "pended" ? "Waiting For Payer" : au.status === "denied" ? "Denied" : "Cancelled"} {au.authNumber && <span className="font-mono text-xs text-muted-foreground">{au.authNumber}</span>}</> : m.authNeeded ? <span className="text-warn">Required, Not Sent</span> : "Not Needed"}
        </Fact>
        <Fact label="Claim Number">{cl ? <span className="font-mono text-xs">{cl.claimNumber}</span> : "Given When Sent"}</Fact>
        {m.draft?.batch && <Fact label="Last Batch"><span className="font-mono text-xs">{m.draft.batch.id}</span> <span className="text-xs text-muted-foreground">{PRIORITY_LABEL[m.draft.batch.priority]}</span></Fact>}
        <Fact label="Last Saved">{m.draft?.savedAt ? <>{fmtDateTime(m.draft.savedAt)} <span className="text-xs text-muted-foreground">{m.draft.savedBy}</span></> : "Not saved yet"}</Fact>
      </dl>
    </Section>
  );
}

/* ---------- encounter ---------- */

function EncounterSection({ m }: { m: ClaimModel }) {
  const e = m.enc;
  const doc = (id?: string) => { const d = DOCTORS.find((x) => x.id === id); return d ? `Dr. ${d.given} ${d.family}` : "Not Recorded"; };
  const start = e.admitAt ?? e.ed?.arrivalAt;
  return (
    <Section id="claim-encounter" title="Encounter" subtitle="From the visit. Change it in registration or the chart, not here." right={<Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: m.visit })}>Open Chart</Button>}>
      <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Encounter Class">{CLASS_LABEL[e.cls]}</Fact>
        <Fact label="Encounter Status">{STATUS_LABEL[e.status] ?? e.status}</Fact>
        <Fact label="Start Date">{start ? fmtDateTime(start) : "Not Recorded"}</Fact>
        <Fact label="End Date">{e.dischargeAt ? fmtDateTime(e.dischargeAt) : e.cls === "I" ? "Still In Hospital" : "Not Recorded"}</Fact>
        <Fact label="Department">{SERVICES.find((s) => s.code === e.service)?.label ?? e.service}</Fact>
        <Fact label="Attending Doctor">{doc(e.attending)}</Fact>
        <Fact label="Reason For Visit">{e.reason || "Not Recorded"}</Fact>
        {e.cls === "I" && <Fact label="Admission Method">{ADMISSION_METHODS.find((a) => a.code === e.admissionMethod)?.label ?? "Not Recorded"}</Fact>}
        {e.cls === "E" && <Fact label="Triage Category">{e.ed?.ctas ? `CTAS ${e.ed.ctas}` : "Not Triaged"}</Fact>}
        {e.cls === "E" && <Fact label="Triage Date">{e.ed?.triageAt ? fmtDateTime(e.ed.triageAt) : "Not Recorded"}</Fact>}
        {e.cls === "E" && <Fact label="Arrival Mode">{e.ed?.arrivalMode ?? "Not Recorded"}</Fact>}
        {e.status === "discharged" && <Fact label="Discharge Disposition">{DISPOSITIONS.find((d) => d.code === e.disposition)?.label ?? "Not Recorded"}</Fact>}
      </dl>
    </Section>
  );
}

/* ---------- care team ---------- */

function CareTeamSection({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const team: CareTeamMember[] = m.careTeam.map((c) => ({ doctorId: c.doctorId, role: c.role }));
  const save = (next: CareTeamMember[]) => warn(saveCareTeam(m.visit, next));
  const free = DOCTORS.filter((d) => !team.some((t) => t.doctorId === d.id));
  return (
    <Section
      id="claim-care-team" title="Care Team" subtitle="Doctors who gave the care. Each service line links to one or more of them by number."
      right={<Button size="sm" disabled={readOnly || !free.length} onClick={() => save([...team, { doctorId: free[0].id, role: "assist" }])}><Plus className="size-4" /> Add Doctor</Button>}
    >
      <Table>
        <thead><tr><Th className="w-10">#</Th><Th>Doctor</Th><Th>Role</Th><Th>Qualification</Th><Th className="relative w-12"><span className="sr-only">Remove</span></Th></tr></thead>
        <tbody>
          {m.careTeam.length === 0 && <tr><Td colSpan={5}><Empty>No doctor on the care team.</Empty></Td></tr>}
          {m.careTeam.map((c, i) => (
            <tr key={c.doctorId}>
              <Td className="tabular-nums">{c.seq}</Td>
              <Td className="min-w-48">
                <Select aria-label={`Doctor ${c.seq}`} value={c.doctorId} disabled={readOnly} onChange={(e) => save(team.map((t, j) => (j === i ? { ...t, doctorId: e.target.value } : t)))}>
                  {DOCTORS.filter((d) => d.id === c.doctorId || !team.some((t) => t.doctorId === d.id)).map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                </Select>
              </Td>
              <Td className="min-w-36">
                <Select aria-label={`Role of doctor ${c.seq}`} value={c.role} disabled={readOnly} onChange={(e) => save(team.map((t, j) => (j === i ? { ...t, role: e.target.value as CareRole } : t)))}>
                  {(Object.keys(CARE_ROLE_LABEL) as CareRole[]).map((r) => <option key={r} value={r}>{CARE_ROLE_LABEL[r]}</option>)}
                </Select>
              </Td>
              <Td className="whitespace-nowrap">{c.qualification}</Td>
              <Td>
                <Button size="sm" variant="ghost" disabled={readOnly || team.length <= 1} aria-label={`Remove ${c.name}`} title="Remove" onClick={() => save(team.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

/* ---------- supporting information ---------- */

const STATE_TONE = { measured: "ok", absent: "warn", missing: "danger" } as const;
const STATE_LABEL = { measured: "Recorded", absent: "Absence Reason", missing: "Missing" } as const;

function SupportSection({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const [category, setCategory] = React.useState(SUPPORT_CATEGORIES[0].code);
  const [value, setValue] = React.useState("");
  const add = () => { if (warn(addSupport(m.visit, category, value))) setValue(""); };
  return (
    <Section
      id="claim-support" title="Supporting Information"
      subtitle="Vital signs and the chief complaint come from the chart. Fix them in the chart; add anything else the payer needs below."
      right={<Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: m.visit })}>Open Chart</Button>}
    >
      <Table>
        <thead><tr><Th>From The Chart</Th><Th>State</Th><Th>Value</Th></tr></thead>
        <tbody>
          {m.chart.map((l) => (
            <tr key={l.key} id={l.key === "complaint" ? "support-complaint" : undefined} tabIndex={l.key === "complaint" ? -1 : undefined} className={cn(l.state === "missing" && "bg-destructive/[0.03]", l.key === "complaint" && flash)}>
              <Td className="font-medium">{l.label}</Td>
              <Td><Badge tone={STATE_TONE[l.state]}>{STATE_LABEL[l.state]}</Badge></Td>
              <Td className="text-sm">{l.value ?? l.reason ?? <span className="text-muted-foreground">Not recorded</span>}</Td>
            </tr>
          ))}
          {m.support.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{SUPPORT_LABEL[s.category] ?? s.category}</Td>
              <Td><Badge tone="primary">Added On Claim</Badge></Td>
              <Td>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{s.value}</span>
                  <Button size="sm" variant="ghost" disabled={readOnly} aria-label={`Remove ${SUPPORT_LABEL[s.category]}`} title="Remove" onClick={() => warn(removeSupport(m.visit, s.id))}><Trash2 className="size-4" /></Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="grid gap-3 p-4 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <Field label="Category">
          <Select value={category} disabled={readOnly} onChange={(e) => setCategory(e.target.value)}>
            {SUPPORT_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Value"><Input value={value} disabled={readOnly} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
        <Button onClick={add} disabled={readOnly || !value.trim()} className="h-10"><Plus className="size-4" /> Add</Button>
      </div>
    </Section>
  );
}

/* ---------- diagnoses ---------- */

function DiagnosesSection({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const inpatient = m.enc.cls === "I";
  return (
    <Section id="claim-dx" title="Diagnoses" subtitle="ICD-10-AM diagnoses from the chart. Exactly one is Principal. For an inpatient, say whether each was present on admission.">
      <Table>
        <thead><tr><Th className="w-10">#</Th><Th>Code</Th><Th>Description</Th><Th>Type</Th><Th>On Admission</Th></tr></thead>
        <tbody>
          {m.dx.length === 0 && <tr><Td colSpan={5}><Empty>No diagnosis in the chart. Add one in the chart before sending.</Empty></Td></tr>}
          {m.dx.map((d) => (
            <tr key={d.code}>
              <Td className="tabular-nums">{d.seq}</Td>
              <Td className="font-mono text-xs">{d.code}</Td>
              <Td className="min-w-48">{d.text}</Td>
              <Td className="min-w-36">
                <Select aria-label={`Type of ${d.code}`} value={d.type} disabled={readOnly} onChange={(e) => warn(saveDx(m.visit, d.code, { type: e.target.value as DxType }))}>
                  {(Object.keys(DX_TYPE_LABEL) as DxType[]).map((t) => <option key={t} value={t}>{DX_TYPE_LABEL[t]}</option>)}
                </Select>
              </Td>
              <Td className="min-w-32">
                {inpatient ? (
                  <Select aria-label={`${d.code} present on admission`} value={d.onAdmission} disabled={readOnly} onChange={(e) => warn(saveDx(m.visit, d.code, { onAdmission: e.target.value as OnAdmission }))}>
                    {(Object.keys(ON_ADMISSION_LABEL) as OnAdmission[]).map((t) => <option key={t} value={t}>{ON_ADMISSION_LABEL[t]}</option>)}
                  </Select>
                ) : <span className="text-sm text-muted-foreground">Not Applicable</span>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Section>
  );
}

/* ---------- AR-DRG ---------- */

function DrgSection({ m }: { m: ClaimModel }) {
  const d = m.drg!;
  return (
    <Section id="claim-drg" title="AR-DRG" subtitle="Inpatient grouping, estimated from the claim diagnoses.">
      <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="AR-DRG">{d.code ? <span className="font-mono">{d.code}</span> : "Not Estimated"}</Fact>
        <Fact label="Description">{d.text}</Fact>
        <Fact label="Major Diagnostic Category">{d.mdc || "Not Estimated"}</Fact>
        <Fact label="Length Of Stay">{d.losDays} day{d.losDays === 1 ? "" : "s"}</Fact>
      </dl>
      <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{d.note} Admitted {fmtDate(m.enc.admitAt)}{m.enc.dischargeAt ? `, discharged ${fmtDate(m.enc.dischargeAt)}` : ", still in hospital"}.</p>
    </Section>
  );
}

/* ---------- financial summary ---------- */

function Row({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-sm", strong && "font-semibold")}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd><Sar value={value} minus={minus} /></dd>
    </div>
  );
}

function FinancialSection({ m, invoiceNumber }: { m: ClaimModel; invoiceNumber?: number }) {
  const t = m.totals;
  return (
    <Section
      id="claim-financial" title="Financial Summary"
      subtitle={invoiceNumber ? `From invoice #${invoiceNumber}. Read only: prices are set on the invoice.` : "From the visit charges. Read only."}
      right={invoiceNumber ? <Button size="sm" variant="ghost" onClick={() => navigate("/invoice", { visit: m.visit })}>Open Invoice</Button> : undefined}
    >
      <div className="grid gap-x-8 px-4 py-2 sm:grid-cols-3">
        <dl className="py-2"><Row label="Total Amount" value={t.gross} /><Row label="Discount" value={t.discount} minus /><Row label="Net Amount" value={t.taxable} strong /></dl>
        <dl className="border-t border-border py-2 sm:border-t-0 sm:border-s sm:ps-8"><Row label="Patient Share" value={t.patientAmount} /><Row label="Patient VAT" value={t.patientTax} /><Row label="Insurance Share" value={t.insuranceAmount} strong /></dl>
        <dl className="border-t border-border py-2 sm:border-t-0 sm:border-s sm:ps-8">
          {m.fin.claim?.approved !== undefined && <Row label="Approved By Payer" value={m.fin.claim.approved} />}
          <Row label="Paid By Payer" value={t.insurancePaid} />
          <Row label="Insurance Balance" value={t.insuranceBalance} strong />
        </dl>
      </div>
    </Section>
  );
}
