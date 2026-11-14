import * as React from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { LabBoard } from "@/components/board/LabBoard";
import { ViewToggle, useWorklistView } from "@/components/board/ViewToggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConformancePanel, DocViewer, Gate, LAB_STATUS_UI, NphiesPill, PRIORITY_UI, StatusBadge } from "@/components/emr/fhir-ui";
import { LabResultEntry } from "@/components/emr/LabResultEntry";
import { LabResultsTable } from "@/components/emr/LabResultsTable";
import { LabVerifyDialog } from "@/components/emr/LabVerifyDialog";
import { PatientIdStrip, ageYears } from "@/components/emr/PatientIdStrip";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { LAB_ASSUMPTIONS } from "@/lib/fhir/assumptions";
import { SPECIMEN_TYPES, catalogRangeProblems, testByCode } from "@/lib/fhir/lab-catalog";
import { personFromDoctor } from "@/lib/fhir/people";
import type { LabOrder, LabStatus } from "@/lib/fhir/types";
import type { Patient } from "@/lib/model";
import {
  awaitingVerification, collectSpecimens, createConformanceSampleOrder, hasCritical, isPublished, labConformance, labSendsOf, leafTests, orderNphiesState,
  resetLab, resultNphiesState, setRejectNext, startProcessing, toggleViewed, useLab,
} from "@/lib/lab";
import { can, useSession } from "@/lib/session";
import { patientName, toLocalInput, useHis } from "@/lib/store";

const FILTERS: { id: "all" | LabStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "received", label: "Received" },
  { id: "collected", label: "Specimen Collected" },
  { id: "in-progress", label: "In Progress" },
  { id: "resulted", label: "Resulted" },
  { id: "amended", label: "Amended" },
  { id: "cancelled", label: "Cancelled" },
];

const PRIORITY_RANK: Record<string, number> = { stat: 0, asap: 1, urgent: 2, routine: 3 };

const when = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

const RANGE_PROBLEMS = catalogRangeProblems();

/** Worklist for the laboratory: collect, process, enter results, send for verification, verify and release, amend. */
export function LabWorklistPage() {
  const lab = useLab();
  const his = useHis();
  const dev = useDevMode();
  useSession();
  const [filter, setFilter] = React.useState<"all" | LabStatus>("all");
  const [q, setQ] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [view, setView] = useWorklistView("lab");
  const [editorHint, setEditorHint] = React.useState("");
  const [collectId, setCollectId] = React.useState<string | null>(null);
  const [collectAt, setCollectAt] = React.useState(() => toLocalInput(new Date()));
  const [verifyId, setVerifyId] = React.useState<string | null>(null);
  const activeVisits = his.encounters.filter((e) => e.status === "active");
  const [sampleVisit, setSampleVisit] = React.useState("");

  const canResult = can("lab.result");
  const counts = (s: "all" | LabStatus) => lab.orders.filter((o) => s === "all" || o.status === s).length;

  const rows = lab.orders
    .filter((o) => filter === "all" || o.status === filter)
    .filter((o) => {
      if (!q.trim()) return true;
      const p = his.patients.find((x) => x.id === o.patientId);
      return `${patientName(p)} ${p?.mrn} ${o.visitNumber} ${o.id}`.toLowerCase().includes(q.trim().toLowerCase());
    })
    .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || a.orderedAt.localeCompare(b.orderedAt));

  const boardOrders = lab.orders.filter((o) => {
    if (!q.trim()) return true;
    const p = his.patients.find((x) => x.id === o.patientId);
    return `${patientName(p)} ${p?.mrn} ${o.visitNumber} ${o.id}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const open = lab.orders.find((o) => o.id === openId);
  const openPatient = open && his.patients.find((p) => p.id === open.patientId);
  const collecting = lab.orders.find((o) => o.id === collectId);
  const collectingPatient = collecting && his.patients.find((p) => p.id === collecting.patientId);
  const verifying = lab.orders.find((o) => o.id === verifyId && awaitingVerification(o));
  const verifyingPatient = verifying && his.patients.find((p) => p.id === verifying.patientId);
  /** The sign-off is a dialog, so the side sheet closes first. Two layers would trap the keyboard. */
  const openVerify = (id: string) => {
    if (view === "board") setOpenId(null);
    setVerifyId(id);
  };

  function rowActions(o: LabOrder) {
    const toggle = (label: string) => (
      <Button size="sm" variant={openId === o.id ? "primary" : "secondary"} onClick={() => setOpenId(openId === o.id ? null : o.id)}>
        {openId === o.id ? "Close" : label}
      </Button>
    );
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {o.status === "received" && (
          <Gate allowed={canResult} reason="Your role cannot collect specimens.">
            <Button
              size="sm"
              variant="primary"
              disabled={!canResult}
              onClick={() => {
                setCollectAt(toLocalInput(new Date()));
                setCollectId(o.id);
              }}
            >
              Collect Specimen
            </Button>
          </Gate>
        )}
        {o.status === "collected" && (
          <Gate allowed={canResult} reason="Your role cannot process specimens.">
            <Button size="sm" variant="primary" disabled={!canResult} onClick={() => startProcessing(o.id)}>Start Processing</Button>
          </Gate>
        )}
        {o.status === "in-progress" && awaitingVerification(o) && (
          <Gate allowed={canResult} reason="Your role cannot verify laboratory results.">
            <Button size="sm" variant="primary" disabled={!canResult} onClick={() => openVerify(o.id)}>Verify Result</Button>
          </Gate>
        )}
        {o.status === "in-progress" && toggle(awaitingVerification(o) ? "Details" : "Enter Results")}
        {isPublished(o) && toggle("View Or Amend")}
        {(o.status === "received" || o.status === "collected" || o.status === "cancelled") && toggle("Details")}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Laboratory Worklist"
        subtitle="Collect specimens, enter results, then a second user verifies and releases them. Send them to NPHIES from NPHIES Clinical. STAT and urgent orders are listed first."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {dev && (
              <Button variant="ghost" size="sm" onClick={() => { resetLab(); setOpenId(null); }} title="Brings back the demo orders and clears everything sent">
                <RotateCcw className="size-4" />
                Reset Lab Demo Data
              </Button>
            )}
          </div>
        }
      />

      {dev && RANGE_PROBLEMS.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <div className="font-semibold text-destructive">Test catalogue: {RANGE_PROBLEMS.length} range problem{RANGE_PROBLEMS.length === 1 ? "" : "s"}</div>
            <p className="text-xs text-foreground">A critical range must lie outside the normal range. Fix these rows in lab-catalog.ts.</p>
            {RANGE_PROBLEMS.map((r) => (
              <div key={r.code}>
                {r.short} <span className="font-mono text-xs">{r.code}</span>: {r.problems.join(" ")}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "board" ? (
        <>
          <Card className="mb-4 px-4 py-3">
            <Field label="Patient" className="w-full sm:w-72">
              <Input placeholder="Name, MRN, visit or order" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
          </Card>
          <LabBoard
            orders={boardOrders}
            onCollect={(id) => {
              setCollectAt(toLocalInput(new Date()));
              setCollectId(id);
            }}
            onOpenEditor={(id, hint) => {
              setEditorHint(hint);
              setOpenId(id);
            }}
            onVerify={openVerify}
            onOpen={(id) => {
              setEditorHint("");
              setOpenId(id);
            }}
          />
        </>
      ) : (
        <>
          <Card className="mb-4 px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Status filter">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                    )}
                  >
                    {f.label} <span className="opacity-70">{counts(f.id)}</span>
                  </button>
                ))}
              </div>
              <Field label="Patient" className="ml-auto w-56">
                <Input placeholder="Name, MRN, visit or order" value={q} onChange={(e) => setQ(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <Table>
              <thead className="bg-update/8">
                <tr>
                  <Th>Patient</Th>
                  <Th>Tests</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                  <Th>NPHIES</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><Td colSpan={6}><Empty>No orders match.</Empty></Td></tr>
                )}
                {rows.map((o) => {
                  const p = his.patients.find((x) => x.id === o.patientId);
                  const nph = orderNphiesState(o);
                  const res = resultNphiesState(o);
                  return (
                    <tr key={o.id} className={cn("hover:bg-muted/40", openId === o.id && "bg-accent/40")}>
                      <Td>
                        <div className="font-semibold">{patientName(p)}</div>
                        <div className="text-xs text-muted-foreground">
                          {p?.mrn} · Ordered {when(o.orderedAt)} by {personFromDoctor(o.orderedById).name}
                        </div>
                        {dev && <div className="font-mono text-xs text-muted-foreground">{o.id} · Visit {o.visitNumber}</div>}
                      </Td>
                      <Td>
                        <div className="flex max-w-[260px] flex-wrap gap-1">
                          {o.codes.map((c) => (
                            <Badge key={c} tone="neutral">{testByCode(c)?.short ?? c}</Badge>
                          ))}
                        </div>
                      </Td>
                      <Td><StatusBadge map={PRIORITY_UI} status={o.priority} /></Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge map={LAB_STATUS_UI} status={o.status} />
                          {awaitingVerification(o) && <Badge tone="update">Awaiting Verification</Badge>}
                          {!awaitingVerification(o) && o.status === "in-progress" && o.sentBack && <Badge tone="warn">Sent Back</Badge>}
                          {hasCritical(o) && <Badge tone="danger">Critical</Badge>}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <NphiesPill label={`Order ${nph.label}`} tone={nph.tone} />
                          {(isPublished(o) || labSendsOf(o, "lab-result").length > 0) && <NphiesPill label={`Result ${res.label}`} tone={res.tone} />}
                        </div>
                      </Td>
                      <Td>{rowActions(o)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {open && openPatient && <Card className="mt-4"><OrderDetail order={open} patient={openPatient} dev={dev} onClose={() => setOpenId(null)} onVerify={() => openVerify(open.id)} /></Card>}
        </>
      )}

      <Sheet open={view === "board" && !!open && !!openPatient} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-3xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Laboratory Order</SheetTitle>
            <SheetDescription>Enter results for this order and send them for verification.</SheetDescription>
          </SheetHeader>
          {editorHint && <p className="mx-4 mt-10 rounded-md border border-update/40 bg-update/10 px-3 py-2 text-xs">{editorHint}</p>}
          {open && openPatient && <div className="mt-10"><OrderDetail order={open} patient={openPatient} dev={dev} onClose={() => setOpenId(null)} onVerify={() => openVerify(open.id)} /></div>}
        </SheetContent>
      </Sheet>

      <ConformancePanel
        steps={labConformance(lab)}
        onToggleViewed={toggleViewed}
        rejectNext={lab.rejectNext}
        onRejectNext={setRejectNext}
        assumptions={LAB_ASSUMPTIONS}
        actions={
          dev ? (
            <>
              <Select className="w-64" aria-label="Visit for the sample order" value={sampleVisit || activeVisits[0]?.visitNumber || ""} onChange={(e) => setSampleVisit(e.target.value)}>
                {activeVisits.map((e) => (
                  <option key={e.visitNumber} value={e.visitNumber}>
                    {patientName(his.patients.find((p) => p.id === e.patientId))} ({e.visitNumber})
                  </option>
                ))}
              </Select>
              <Gate allowed={can("order.lab") && canResult} reason="Needs the order.lab and lab.result permissions. Switch to the System Administrator role.">
                <Button
                  disabled={!(can("order.lab") && canResult)}
                  onClick={() => {
                    const enc = activeVisits.find((e) => e.visitNumber === (sampleVisit || activeVisits[0]?.visitNumber));
                    const o = enc && createConformanceSampleOrder(enc);
                    if (o) setOpenId(o.id);
                  }}
                  title="Orders CBC, CRP, urinalysis and a urine culture, collects the specimens and fills the results, so the report meets 2.1.1."
                >
                  Create Sample Order
                </Button>
              </Gate>
            </>
          ) : undefined
        }
      />

      <Dialog
        open={!!collecting}
        onClose={() => setCollectId(null)}
        title="Collect Specimen"
        subtitle={collecting ? `${collecting.codes.map((c) => testByCode(c)?.short).join(", ")}` : undefined}
        footer={
          <>
            <Button onClick={() => setCollectId(null)}>Close</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (collecting && collectSpecimens(collecting.id, new Date(collectAt).toISOString())) setCollectId(null);
              }}
            >
              Confirm Collection
            </Button>
          </>
        }
      >
        {collecting && (
          <div className="space-y-3">
            {collectingPatient && <PatientIdStrip patient={collectingPatient} visitNumber={collecting.visitNumber} />}
            <p className="text-sm">Specimens to collect:</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {[...new Set(leafTests(collecting).map((t) => t.specimen))].map((k) => (
                <li key={k}>
                  {SPECIMEN_TYPES[k].display}
                  {dev && <span className="ml-1.5 font-mono text-xs text-muted-foreground">SNOMED CT {SPECIMEN_TYPES[k].code}</span>}
                </li>
              ))}
            </ul>
            <Field label="Collected At" required hl7="Specimen.collection.collectedDateTime">
              <Input type="datetime-local" value={collectAt} aria-required="true" onChange={(e) => setCollectAt(e.target.value)} />
            </Field>
          </div>
        )}
      </Dialog>

      {verifying && verifyingPatient && <LabVerifyDialog key={verifying.id} order={verifying} patient={verifyingPatient} onClose={() => setVerifyId(null)} />}
    </div>
  );
}

/** The open order: specimens, result entry or the read only results, and in Developer View the FHIR bundles. */
function OrderDetail({ order: open, patient: openPatient, dev, onClose, onVerify }: { order: LabOrder; patient: Patient; dev: boolean; onClose: () => void; onVerify: () => void }) {
  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {patientName(openPatient)} · {open.codes.map((c) => testByCode(c)?.short).join(", ")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            MRN {openPatient.mrn} · {ageYears(openPatient.dob)} years, {openPatient.sex === "M" ? "Male" : "Female"}
            {dev && <span className="ml-2 font-mono">{open.id} · Visit {open.visitNumber} · Health ID {openPatient.healthId}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge map={LAB_STATUS_UI} status={open.status} />
          {awaitingVerification(open) && <Badge tone="update">Awaiting Verification</Badge>}
          <Button size="sm" variant="ghost" onClick={() => onClose()}>Close</Button>
        </div>
      </header>
      <div className="space-y-5 px-4 py-4">
        {open.specimens.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {open.specimens.map((s) => (
              <span key={s.id} className="rounded-md border border-border px-2 py-1">
                {SPECIMEN_TYPES[s.key].display}
                {dev && <span className="ml-1 font-mono">{s.id}</span>} · collected {when(s.collectedAt)}
                {s.receivedAt && ` · received ${when(s.receivedAt)}`}
              </span>
            ))}
          </div>
        )}
        {open.status === "in-progress" || isPublished(open) ? (
          <LabResultEntry order={open} patient={openPatient} onVerify={onVerify} />
        ) : (
          <div className="rounded-lg border border-border">
            <LabResultsTable order={open} sex={openPatient.sex} />
          </div>
        )}
        {dev && (
          <div className="space-y-5 border-t border-border pt-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Laboratory Report Bundle</h3>
              <DocViewer key={`${open.id}-r${labSendsOf(open, "lab-result").length}`} records={labSendsOf(open, "lab-result")} filenamePrefix={`lab-result-${open.id}`} empty="Not sent yet. Release the result, then send it from NPHIES Clinical." />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Laboratory Order Bundle</h3>
              <DocViewer key={`${open.id}-o${labSendsOf(open, "lab-order").length}`} records={labSendsOf(open, "lab-order")} filenamePrefix={`lab-order-${open.id}`} empty="The ordering clinician has not sent this order to NPHIES yet." />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
