import * as React from "react";
import { ArrowLeft, ClipboardCheck, Plus, Send, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { ClaimStatusBadge, ReviewCounts, ReviewDialog, useClaimSend } from "@/components/claims/ClaimParts";
import { CommitInput, ServiceLinesCard } from "@/components/claims/ServiceLinesCard";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import {
  addSupport, CARE_ROLE_LABEL, checkEligibility, CLAIM_TYPE_LABEL, claimFor, claimStatusOf, DX_TYPE_LABEL, ON_ADMISSION_LABEL, PRIORITY_LABEL, removeSupport,
  reviewModel, runReview, saveCareTeam, saveDx, saveHeader, sendOptions, SUBTYPE_LABEL, SUPPORT_CATEGORIES, SUPPORT_LABEL, useClaims,
  type CareRole, type CareTeamMember, type ClaimModel, type ClaimPriority, type ClaimSubType, type ClaimType, type DxType, type HeaderPatch, type OnAdmission,
} from "@/lib/claims";
import { ensureInvoice, invoiceOf, useInvoices } from "@/lib/invoice";
import { useLab } from "@/lib/lab";
import { useFinancial } from "@/lib/nphies-financial";
import { useRad } from "@/lib/radiology";
import { DOCTORS } from "@/lib/reference-data";
import { navigate, useRoute } from "@/lib/router";
import { useRx } from "@/lib/rx";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";
import { useVitals } from "@/lib/vitals";

const day = (iso: string | undefined) => (iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not Recorded");
const warn = (r: { ok: boolean; problems?: string[] }) => { if (!r.ok) pushToast({ tone: "warn", text: r.problems?.[0] ?? "Not saved." }); return r.ok; };

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
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

  return (
    <div>
      <PageHeader
        title={`Claim For ${patientName(m.patient)}`}
        subtitle={`Visit ${visit}, MRN ${m.patient.mrn}. Payer ${m.payer}. Amounts come from the visit invoice and cannot be changed here.`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ClaimStatusBadge status={status} />
            <Button onClick={() => navigate("/billing")}><ArrowLeft className="size-4" /> Billing Worklist</Button>
          </div>
        }
      />
      {m.locked && (
        <Card className="mb-4 border-move/40 bg-move/5 px-4 py-3 text-sm">
          The payer is holding or has approved this claim, so it cannot be changed. Follow it on NPHIES Financial.
        </Card>
      )}
      {!allowed && <Card className="mb-4 border-warn/40 bg-warn/5 px-4 py-3 text-sm">You can read this claim. Changing and sending it needs the billing permission.</Card>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <HeaderCard m={m} readOnly={readOnly} />
          <CareTeamCard m={m} readOnly={readOnly} />
          <SupportCard m={m} readOnly={readOnly} />
          <DiagnosesCard m={m} readOnly={readOnly} />
          <ServiceLinesCard m={m} findings={claimFindings} readOnly={readOnly} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <TotalsCard m={m} invoiceNumber={inv?.number} />
          {m.drg && <DrgCard m={m} />}
          <Card>
            <CardHeader title="Review" subtitle={m.draft?.reviewedAt ? `Last run ${new Date(m.draft.reviewedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not run yet"} />
            <div className="p-4"><ReviewCounts findings={claimFindings} /></div>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-30 mt-4 rounded-xl border border-border bg-card/95 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
          <p className="me-auto hidden min-w-0 text-xs text-muted-foreground md:block">
            {options.claim.enabled ? options.claim.why : options.priorAuth.enabled ? options.priorAuth.why : options.eligibility.enabled ? options.eligibility.why : options.claim.why}
          </p>
          <Button onClick={() => { runReview(visit); setReviewOpen(true); }}><ClipboardCheck className="size-4" /> Review</Button>
          {options.eligibility.enabled && (
            <Button disabled={!allowed} onClick={() => warn(checkEligibility(visit))}><UserCheck className="size-4" /> {options.eligibility.label}</Button>
          )}
          <Button disabled={!allowed || !options.priorAuth.enabled} title={options.priorAuth.enabled ? undefined : options.priorAuth.why} onClick={() => send(visit, "priorauth")}>
            <ShieldCheck className="size-4" /> {options.priorAuth.label}
          </Button>
          <Button variant="primary" disabled={!allowed || !options.claim.enabled} title={options.claim.enabled ? undefined : options.claim.why} onClick={() => send(visit, "claim")}>
            <Send className="size-4" /> {options.claim.label}
          </Button>
        </div>
      </div>

      <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} visit={visit} findings={claimFindings} ack={m.draft?.ack} />
      {sendDialog}
    </div>
  );
}

/* ---------- header ---------- */

function HeaderCard({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const save = (patch: HeaderPatch) => warn(saveHeader(m.visit, patch));
  const { eligibility: el, authorization: au, claim: cl } = m.fin;
  return (
    <Card>
      <CardHeader title="Claim" subtitle="Type, sub-type and dates of the claim. The type follows the visit class unless you change it." />
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Claim Type">
          <Select value={m.type} disabled={readOnly} onChange={(e) => save({ type: e.target.value as ClaimType })}>
            {(Object.keys(CLAIM_TYPE_LABEL) as ClaimType[]).map((t) => <option key={t} value={t}>{CLAIM_TYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Sub-Type">
          <Select value={m.subType} disabled={readOnly} onChange={(e) => save({ subType: e.target.value as ClaimSubType })}>
            {(Object.keys(SUBTYPE_LABEL) as ClaimSubType[]).map((t) => <option key={t} value={t}>{SUBTYPE_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={m.priority} disabled={readOnly} onChange={(e) => save({ priority: e.target.value as ClaimPriority })}>
            {(Object.keys(PRIORITY_LABEL) as ClaimPriority[]).map((t) => <option key={t} value={t}>{PRIORITY_LABEL[t]}</option>)}
          </Select>
        </Field>
        <Field label="Claim Date"><CommitInput type="date" label="Claim Date" value={m.claimDate} disabled={readOnly} onCommit={(v) => save({ claimDate: v })} /></Field>
        <Field label="Service Start"><CommitInput type="date" label="Service Start" value={m.start} disabled={readOnly} onCommit={(v) => save({ start: v, end: m.end })} /></Field>
        <Field label="Service End"><CommitInput type="date" label="Service End" value={m.end} disabled={readOnly} onCommit={(v) => save({ start: m.start, end: v })} /></Field>
      </div>
      <dl className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Payer">{m.payer}</Fact>
        <Fact label="Eligibility">{el ? <>{el.status === "eligible" ? "Eligible" : "Not Eligible"} <span className="font-mono text-xs text-muted-foreground">{el.ref}</span></> : "Not Checked"}</Fact>
        <Fact label="Prior Authorization">
          {au ? <>{au.status === "approved" ? "Approved" : au.status === "pended" ? "Waiting For Payer" : au.status === "denied" ? "Denied" : "Cancelled"} {au.authNumber && <span className="font-mono text-xs text-muted-foreground">{au.authNumber}</span>}</> : m.authNeeded ? "Required, Not Sent" : "Not Needed"}
        </Fact>
        <Fact label="Claim Number">{cl ? <span className="font-mono text-xs">{cl.claimNumber}</span> : "Given When Sent"}</Fact>
      </dl>
    </Card>
  );
}

/* ---------- care team ---------- */

function CareTeamCard({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const team: CareTeamMember[] = m.careTeam.map((c) => ({ doctorId: c.doctorId, role: c.role }));
  const save = (next: CareTeamMember[]) => warn(saveCareTeam(m.visit, next));
  const free = DOCTORS.filter((d) => !team.some((t) => t.doctorId === d.id));
  return (
    <Card>
      <CardHeader title="Care Team" subtitle="Doctors who gave the care. Each service line links to one or more of them." />
      <Table>
        <thead><tr><Th>#</Th><Th>Doctor</Th><Th>Role</Th><Th>Qualification</Th><Th><span className="sr-only">Remove</span></Th></tr></thead>
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
              <Td>{c.qualification}</Td>
              <Td>
                <Button size="sm" variant="ghost" disabled={readOnly || team.length <= 1} aria-label={`Remove ${c.name}`} title="Remove" onClick={() => save(team.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex justify-end border-t border-border px-4 py-3">
        <Button size="sm" disabled={readOnly || !free.length} onClick={() => save([...team, { doctorId: free[0].id, role: "assist" }])}><Plus className="size-4" /> Add Doctor</Button>
      </div>
    </Card>
  );
}

/* ---------- supporting information ---------- */

const STATE_TONE = { measured: "ok", absent: "warn", missing: "danger" } as const;
const STATE_LABEL = { measured: "Recorded", absent: "Absence Reason", missing: "Missing" } as const;

function SupportCard({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const [category, setCategory] = React.useState(SUPPORT_CATEGORIES[0].code);
  const [value, setValue] = React.useState("");
  const add = () => { if (warn(addSupport(m.visit, category, value))) setValue(""); };
  return (
    <Card>
      <CardHeader
        title="Supporting Information"
        subtitle="Vital signs and the chief complaint are taken from the chart. Fix them in the chart; add anything else the payer needs below."
        right={<Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: m.visit })}>Open Chart</Button>}
      />
      <Table>
        <thead><tr><Th>From The Chart</Th><Th>State</Th><Th>Value</Th></tr></thead>
        <tbody>
          {m.chart.map((l) => (
            <tr key={l.key}>
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
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-[220px_1fr_auto] sm:items-end">
        <Field label="Category">
          <Select value={category} disabled={readOnly} onChange={(e) => setCategory(e.target.value)}>
            {SUPPORT_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Value"><Input value={value} disabled={readOnly} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} /></Field>
        <Button onClick={add} disabled={readOnly || !value.trim()}><Plus className="size-4" /> Add</Button>
      </div>
    </Card>
  );
}

/* ---------- diagnoses ---------- */

function DiagnosesCard({ m, readOnly }: { m: ClaimModel; readOnly: boolean }) {
  const inpatient = m.enc.cls === "I";
  return (
    <Card>
      <CardHeader title="Diagnoses" subtitle="ICD-10-AM diagnoses from the chart. You can change the type and, for an inpatient, whether it was present on admission." />
      <Table>
        <thead><tr><Th>#</Th><Th>Code</Th><Th>Description</Th><Th>Type</Th><Th>On Admission</Th></tr></thead>
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
    </Card>
  );
}

/* ---------- totals and AR-DRG ---------- */

function Row({ label, value, strong, minus }: { label: string; value: number; strong?: boolean; minus?: boolean }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-sm", strong && "font-semibold")}>
      <span className={strong ? undefined : "text-muted-foreground"}>{label}</span>
      <Sar value={value} minus={minus} />
    </div>
  );
}

function TotalsCard({ m, invoiceNumber }: { m: ClaimModel; invoiceNumber?: number }) {
  const t = m.totals;
  return (
    <Card>
      <CardHeader
        title="Financial Details"
        subtitle={invoiceNumber ? `From invoice #${invoiceNumber}. Read only.` : "From the visit charges. Read only."}
        right={invoiceNumber ? <Button size="sm" variant="ghost" onClick={() => navigate("/invoice", { visit: m.visit })}>Invoice</Button> : undefined}
      />
      <div className="divide-y divide-border px-4 py-2">
        <div>
          <Row label="Total Amount" value={t.gross} />
          <Row label="Discount" value={t.discount} minus />
          <Row label="Net Amount" value={t.taxable} strong />
        </div>
        <div>
          <Row label="Patient Share" value={t.patientAmount} />
          <Row label="Patient VAT" value={t.patientTax} />
          <Row label="Insurance Share" value={t.insuranceAmount} />
        </div>
        <div>
          {m.fin.claim?.approved !== undefined && <Row label="Approved By Payer" value={m.fin.claim.approved} />}
          <Row label="Paid By Payer" value={t.insurancePaid} />
          <Row label="Insurance Balance" value={t.insuranceBalance} strong />
        </div>
      </div>
    </Card>
  );
}

function DrgCard({ m }: { m: ClaimModel }) {
  const d = m.drg!;
  return (
    <Card>
      <CardHeader title="AR-DRG" subtitle="Inpatient grouping, estimated from the claim diagnoses." />
      <dl className="grid grid-cols-2 gap-4 p-4">
        <Fact label="AR-DRG">{d.code ? <span className="font-mono">{d.code}</span> : "Not Estimated"}</Fact>
        <Fact label="Length Of Stay">{d.losDays} day{d.losDays === 1 ? "" : "s"}</Fact>
        <div className="col-span-2"><Fact label="Description">{d.text}</Fact></div>
        {d.mdc && <div className="col-span-2"><Fact label="Major Diagnostic Category">{d.mdc}</Fact></div>}
        <p className="col-span-2 text-xs text-muted-foreground">{d.note} Admitted {day(m.enc.admitAt)}{m.enc.dischargeAt ? `, discharged ${day(m.enc.dischargeAt)}` : ", still in hospital"}.</p>
      </dl>
    </Card>
  );
}
