import * as React from "react";
import { RotateCcw } from "lucide-react";
import { RadBoard } from "@/components/board/RadBoard";
import { ViewToggle, useWorklistView } from "@/components/board/ViewToggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConformancePanel, DocViewer, Gate, NphiesPill, PRIORITY_UI, RAD_STATUS_UI, StatusBadge } from "@/components/emr/fhir-ui";
import { PatientIdStrip, ageYears } from "@/components/emr/PatientIdStrip";
import { RadExamDialog } from "@/components/emr/RadExamDialog";
import { ExamSummary, RadReportEditor } from "@/components/emr/RadReportEditor";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { RAD_ASSUMPTIONS } from "@/lib/fhir/assumptions";
import { personFromDoctor } from "@/lib/fhir/people";
import { BODY_REGIONS, MODALITIES, procByCode } from "@/lib/fhir/rad-catalog";
import type { RadOrder, RadStatus } from "@/lib/fhir/types";
import type { Patient } from "@/lib/model";
import {
  createRadConformanceSample, isRadPublished, isRadSigned, radConformance, radOrderNphiesState, radReportNphiesState, radSendsOf,
  resetRad, setRadRejectNext, toggleRadViewed, useRad,
} from "@/lib/radiology";
import { can, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";

const FILTERS: { id: "all" | RadStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "received", label: "Received" },
  { id: "performed", label: "Exam Performed" },
  { id: "resulted", label: "Reported" },
  { id: "amended", label: "Amended" },
  { id: "cancelled", label: "Cancelled" },
];

const PRIORITY_RANK: Record<string, number> = { stat: 0, asap: 1, urgent: 2, routine: 3 };

const when = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

/** Worklist for radiology: record the exam, write the report, sign it, release it, add addenda. */
export function RadiologyWorklistPage() {
  const rad = useRad();
  const his = useHis();
  const dev = useDevMode();
  useSession();
  const [filter, setFilter] = React.useState<"all" | RadStatus>("all");
  const [q, setQ] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [view, setView] = useWorklistView("rad");
  const [editorHint, setEditorHint] = React.useState("");
  const [examId, setExamId] = React.useState<string | null>(null);
  const activeVisits = his.encounters.filter((e) => e.status === "active");
  const [sampleVisit, setSampleVisit] = React.useState("");
  const canReport = can("rad.report");

  const counts = (s: "all" | RadStatus) => rad.orders.filter((o) => s === "all" || o.status === s).length;
  const rows = rad.orders
    .filter((o) => filter === "all" || o.status === filter)
    .filter((o) => {
      if (!q.trim()) return true;
      const p = his.patients.find((x) => x.id === o.patientId);
      return `${patientName(p)} ${p?.mrn} ${o.visitNumber} ${o.id} ${procByCode(o.procCode)?.short}`.toLowerCase().includes(q.trim().toLowerCase());
    })
    .sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || a.orderedAt.localeCompare(b.orderedAt));

  const boardOrders = rad.orders.filter((o) => {
    if (!q.trim()) return true;
    const p = his.patients.find((x) => x.id === o.patientId);
    return `${patientName(p)} ${p?.mrn} ${o.visitNumber} ${o.id} ${procByCode(o.procCode)?.short}`.toLowerCase().includes(q.trim().toLowerCase());
  });
  const open = rad.orders.find((o) => o.id === openId);
  const openPatient = open && his.patients.find((p) => p.id === open.patientId);
  const examOrder = rad.orders.find((o) => o.id === examId && o.status === "received");
  const examPatient = examOrder && his.patients.find((p) => p.id === examOrder.patientId);
  /** The exam record is a dialog, so the side sheet closes first. */
  const openExam = (id: string) => {
    if (view === "board") setOpenId(null);
    setExamId(id);
  };

  function rowActions(o: RadOrder) {
    const toggle = (label: string, primary = false) => (
      <Button size="sm" variant={openId === o.id ? "primary" : primary ? "primary" : "secondary"} onClick={() => setOpenId(openId === o.id ? null : o.id)}>
        {openId === o.id ? "Close" : label}
      </Button>
    );
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {o.status === "received" && (
          <Gate allowed={canReport} reason="Your role cannot record exams.">
            <Button size="sm" variant="primary" disabled={!canReport} onClick={() => openExam(o.id)}>
              Mark Exam Done
            </Button>
          </Gate>
        )}
        {o.status === "performed" && toggle(isRadSigned(o) ? "Release Report" : o.report?.impression.trim() ? "Sign Report" : "Write Report", true)}
        {isRadPublished(o) && toggle("View Or Amend")}
        {(o.status === "received" || o.status === "cancelled") && toggle("Details")}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Radiology Worklist"
        subtitle="Record the exam, write the report, then a radiologist signs and releases it. Send it to NPHIES from NPHIES Clinical. STAT and urgent orders are listed first."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            {dev && (
              <Button variant="ghost" size="sm" onClick={() => { resetRad(); setOpenId(null); }} title="Brings back the demo orders and clears everything sent">
                <RotateCcw className="size-4" />
                Reset Radiology Demo Data
              </Button>
            )}
          </div>
        }
      />

      {view === "board" ? (
        <>
          <Card className="mb-4 px-4 py-3">
            <Field label="Patient" className="w-full sm:w-72">
              <Input placeholder="Name, MRN, visit or exam" value={q} onChange={(e) => setQ(e.target.value)} />
            </Field>
          </Card>
          <RadBoard
            orders={boardOrders}
            onPerform={openExam}
            onOpenEditor={(id, hint) => {
              setEditorHint(hint);
              setOpenId(id);
            }}
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
                <Input placeholder="Name, MRN, visit or exam" value={q} onChange={(e) => setQ(e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <Table>
              <thead className="bg-move/8">
                <tr>
                  <Th>Patient</Th>
                  <Th>Exam</Th>
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
                  const proc = procByCode(o.procCode);
                  const nph = radOrderNphiesState(o);
                  const rep = radReportNphiesState(o);
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
                        <div className="font-medium">{proc?.short ?? o.procCode}</div>
                        <div className="text-xs text-muted-foreground">
                          {proc && `${MODALITIES[proc.modality].display} · ${BODY_REGIONS[proc.region].display}`}
                        </div>
                        {o.indication && <div className="text-xs text-muted-foreground">Reason: {o.indication}</div>}
                      </Td>
                      <Td><StatusBadge map={PRIORITY_UI} status={o.priority} /></Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge map={RAD_STATUS_UI} status={o.status} />
                          {o.status === "performed" && <Badge tone={isRadSigned(o) ? "ok" : "warn"}>{isRadSigned(o) ? "Report Signed" : "Report Draft"}</Badge>}
                          {o.report?.critical && isRadPublished(o) && <Badge tone="danger">Critical</Badge>}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-col items-start gap-1">
                          <NphiesPill label={`Order ${nph.label}`} tone={nph.tone} />
                          {(isRadPublished(o) || radSendsOf(o, "rad-report").length > 0) && <NphiesPill label={`Report ${rep.label}`} tone={rep.tone} />}
                        </div>
                      </Td>
                      <Td>{rowActions(o)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          {open && openPatient && <Card className="mt-4"><OrderDetail order={open} patient={openPatient} dev={dev} onClose={() => setOpenId(null)} /></Card>}
        </>
      )}

      <Sheet open={view === "board" && !!open && !!openPatient} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-3xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Radiology Order</SheetTitle>
            <SheetDescription>Write, sign and release the report for this exam.</SheetDescription>
          </SheetHeader>
          {editorHint && <p className="mx-4 mt-10 rounded-md border border-update/40 bg-update/10 px-3 py-2 text-xs">{editorHint}</p>}
          {open && openPatient && <div className="mt-10"><OrderDetail order={open} patient={openPatient} dev={dev} onClose={() => setOpenId(null)} /></div>}
        </SheetContent>
      </Sheet>

      <ConformancePanel
        steps={radConformance(rad)}
        onToggleViewed={toggleRadViewed}
        rejectNext={rad.rejectNext}
        onRejectNext={setRadRejectNext}
        assumptions={RAD_ASSUMPTIONS}
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
              <Gate allowed={can("order.rad") && canReport} reason="Needs the order.rad and rad.report permissions. Switch to the System Administrator role.">
                <Button
                  disabled={!(can("order.rad") && canReport)}
                  onClick={() => {
                    const enc = activeVisits.find((e) => e.visitNumber === (sampleVisit || activeVisits[0]?.visitNumber));
                    const o = enc && createRadConformanceSample(enc);
                    if (o) setOpenId(o.id);
                  }}
                  title="Orders a chest X-ray, marks the exam done and types a normal report, ready to publish."
                >
                  Create Sample Exam
                </Button>
              </Gate>
            </>
          ) : undefined
        }
      />

      {examOrder && examPatient && (
        <RadExamDialog
          key={examOrder.id}
          order={examOrder}
          patient={examPatient}
          onClose={() => setExamId(null)}
          onDone={() => {
            setEditorHint("");
            setOpenId(examOrder.id);
          }}
        />
      )}
    </div>
  );
}

/** The open order: exam details, the report editor, and in Developer View the FHIR bundles. */
function OrderDetail({ order: open, patient: openPatient, dev, onClose }: { order: RadOrder; patient: Patient; dev: boolean; onClose: () => void }) {
  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {patientName(openPatient)} · {procByCode(open.procCode)?.display}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            MRN {openPatient.mrn} · {ageYears(openPatient.dob)} years, {openPatient.sex === "M" ? "Male" : "Female"}
            {open.indication && ` · Reason: ${open.indication}`}
            {dev && <span className="ml-2 font-mono">{open.id} · Visit {open.visitNumber} · Health ID {openPatient.healthId}</span>}
          </p>
          {open.clinicalInfo && <p className="mt-0.5 text-xs text-muted-foreground">History: {open.clinicalInfo}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge map={RAD_STATUS_UI} status={open.status} />
          <Button size="sm" variant="ghost" onClick={() => onClose()}>Close</Button>
        </div>
      </header>
      <div className="space-y-5 px-4 py-4">
        {open.study && dev && (
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-md border border-border px-2 py-1 font-mono">Accession {open.study.accession}</span>
            <span className="rounded-md border border-border px-2 py-1 font-mono">Study UID {open.study.studyUid.slice(0, 32)}...</span>
          </div>
        )}
        {open.status === "cancelled" && open.study && <ExamSummary order={open} />}
        {open.status === "performed" || isRadPublished(open) ? (
          <RadReportEditor order={open} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {open.status === "cancelled" ? "This order was cancelled." : "The report cannot start until the exam is marked done. Close this panel and press Mark Exam Done."}
          </p>
        )}
        {dev && (
          <div className="space-y-5 border-t border-border pt-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Radiology Report Bundle</h3>
              <DocViewer key={`${open.id}-r${radSendsOf(open, "rad-report").length}`} records={radSendsOf(open, "rad-report")} filenamePrefix={`rad-report-${open.id}`} empty="Not sent yet. Release the report, then send it from NPHIES Clinical." />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Radiology Order Bundle</h3>
              <DocViewer key={`${open.id}-o${radSendsOf(open, "rad-order").length}`} records={radSendsOf(open, "rad-order")} filenamePrefix={`rad-order-${open.id}`} empty="The ordering clinician has not sent this order to NPHIES yet." />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
