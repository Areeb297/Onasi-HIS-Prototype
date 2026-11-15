import * as React from "react";
import { IconBed, IconCalendarPlus, IconCircleX, IconDoorExit, IconShieldCheck, IconShieldExclamation, IconStethoscope, IconUserCheck } from "@tabler/icons-react";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { BedDouble, ChevronDown, ClipboardList, Plus, Receipt, RotateCcw, Route } from "lucide-react";
import { ActionLegend, RowActions, type ActionKey } from "@/components/RowActions";
import { PatientFlagBadges } from "@/components/PatientBanner";
import { DischargeProgress, useVisitActions } from "@/components/VisitActions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { SUB_DEPARTMENTS, canRequestAdmission, useAdmissionRequests } from "@/lib/admission-requests";
import { useAppointments } from "@/lib/appointments";
import { heldBedOf } from "@/lib/beds";
import { coveragesOf, useCoverages } from "@/lib/coverage";
import { useDevMode } from "@/lib/devmode";
import { niceDate } from "@/lib/discharge";
import { can, hasGlass, useSession } from "@/lib/session";
import type { Encounter } from "@/lib/model";
import { caseOf, useFinancial } from "@/lib/nphies-financial";
import { DOCTORS, SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { bedLabel, patientName, toLocalInput, useHis } from "@/lib/store";
import { appointmentLabel, appointmentOf, appointmentTone, eligibilityCell, subDepartmentOf } from "@/lib/worklist";

type Mode = "opd" | "ipd" | "er";

export function visitStatus(e: Encounter): { label: string; tone: "admit" | "move" | "ok" | "cancel" | "merge" | "neutral" } {
  if (e.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (e.status === "discharged") return { label: "Discharged", tone: "cancel" };
  if (e.status === "preadmit") return { label: "Pre-Admit", tone: "merge" };
  if (e.cls === "I") return { label: "Admitted", tone: "ok" };
  return e.checkedIn ? { label: "Checked In", tone: "move" } : { label: "Arrived", tone: "admit" };
}

function age(dob: string): number {
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));
}

function dateOf(e: Encounter): string {
  return e.admitAt ?? e.expectedAdmitAt ?? e.dischargeAt ?? "";
}

const day = (offset: number) => toLocalInput(new Date(Date.now() + offset * 86_400_000)).slice(0, 10);

/** Links to screens the visit already has: medication chart, patient journey, invoice, and an admission request. */
function VisitLinks({ e }: { e: Encounter }) {
  const requestable = e.status === "active" && (e.cls === "O" || e.cls === "E") && canRequestAdmission();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Go to a screen for visit ${e.visitNumber}`}>
          Go To <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem className="gap-3 py-2 text-sm" onClick={() => navigate("/chart", { visit: e.visitNumber, s: "emar" })}>
          <ClipboardList className="size-4 text-move" />Open Medication Chart
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-3 py-2 text-sm" onClick={() => navigate("/chart", { visit: e.visitNumber, s: "overview" })}>
          <Route className="size-4 text-update" />Patient Journey
        </DropdownMenuItem>
        {can("billing") && (
          <DropdownMenuItem className="gap-3 py-2 text-sm" onClick={() => navigate("/invoice", { visit: e.visitNumber })}>
            <Receipt className="size-4 text-ok" />Invoice
          </DropdownMenuItem>
        )}
        {requestable && (
          <DropdownMenuItem className="gap-3 py-2 text-sm" onClick={() => navigate("/admission-requests", { new: "1", patient: e.patientId, visit: e.visitNumber })}>
            <BedDouble className="size-4 text-admit" />Request Admission
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorklistPage({ mode, embedded }: { mode: Mode; embedded?: boolean }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const { appointments } = useAppointments();
  const { requests } = useAdmissionRequests();
  const coverageStore = useCoverages();
  const fin = useFinancial();
  const { act, openRegister, openPatient, openClearances, openLeftWard, dialogs } = useVisitActions();

  const [start, setStart] = React.useState(day(mode !== "ipd" ? -7 : -14));
  const [end, setEnd] = React.useState(day(mode !== "ipd" ? 0 : 7));
  const [dept, setDept] = React.useState("");
  const [sub, setSub] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [elig, setElig] = React.useState("");
  const [q, setQ] = React.useState("");
  const today = day(0);

  const statuses =
    mode === "ipd" ? ["Admitted", "Pre-Admit", "Discharged", "Cancelled"] : ["Arrived", "Checked In", "Discharged", "Cancelled"];

  const subOf = (e: Encounter) => subDepartmentOf(e, requests, appointments);
  const eligOf = (e: Encounter) =>
    eligibilityCell(state.patients.find((x) => x.id === e.patientId), caseOf(e.visitNumber, fin), coveragesOf(e.patientId, coverageStore, state.patients), today);

  const ofMode = state.encounters.filter((e) => (mode === "opd" ? e.cls === "O" : mode === "er" ? e.cls === "E" : e.cls === "I"));
  const subOptions = dept
    ? [...new Set([...(SUB_DEPARTMENTS[dept] ?? []), ...ofMode.filter((e) => e.service === dept).map(subOf)])].sort()
    : [];

  const scoped = ofMode
    .filter((e) => {
      const d = dateOf(e).slice(0, 10);
      return !d || (d >= start && d <= end);
    })
    .filter((e) => !dept || e.service === dept)
    .filter((e) => !sub || subOf(e) === sub)
    .filter((e) => !elig || eligOf(e).label === elig)
    .filter((e) => {
      const p = state.patients.find((x) => x.id === e.patientId);
      return !q || `${patientName(p)} ${p?.mrn} ${e.visitNumber}`.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  /** The counts in the strip follow every filter except Status, so each tile still shows its number while one status is chosen. */
  const byStatus = (label: string) => scoped.filter((e) => visitStatus(e).label === label).length;
  const rows = scoped.filter((e) => !status || visitStatus(e).label === status);
  const STATUS_ICON: Record<string, React.ReactNode> = {
    Arrived: <IconUserCheck stroke={1.75} />, "Checked In": <IconStethoscope stroke={1.75} />, Admitted: <IconBed stroke={1.75} />,
    "Pre-Admit": <IconCalendarPlus stroke={1.75} />, Discharged: <IconDoorExit stroke={1.75} />, Cancelled: <IconCircleX stroke={1.75} />,
  };

  function onAct(e: Encounter, key: ActionKey) {
    if (key === "CHART") return navigate("/chart", { visit: e.visitNumber });
    act(key, e.visitNumber);
  }

  function reset() {
    setStart(day(mode !== "ipd" ? -7 : -14));
    setEnd(day(mode !== "ipd" ? 0 : 7));
    setDept("");
    setSub("");
    setStatus("");
    setElig("");
    setQ("");
  }

  const title = mode === "opd" ? "OPD Worklist" : mode === "er" ? "Emergency Worklist" : "IPD Worklist";

  return (
    <div>
      {!embedded && (
      <PageHeader
        title={title}
        subtitle={
          mode !== "ipd"
            ? "Outpatient visits. Use the icons on each row. Most actions send an ADT message in one click, and the toast has an Undo."
            : "Inpatients and pre-admissions. Each action shows what will happen before you confirm. Discharge needs the four clearances, and the bed stays held until the patient leaves the ward."
        }
        right={
          <div className="flex flex-wrap gap-2">
            {mode !== "ipd" ? (
              <>
                {mode === "opd" && <Button onClick={() => navigate("/reclassified")}>Reclassified To Outpatient</Button>}
                {mode === "opd" && <Button onClick={() => openRegister("A04")}>
                  <Plus className="size-4" />
                  Register Visit
                </Button>}
                <Button variant="primary" disabled={!can("patient.register")} onClick={() => openPatient(mode === "er" ? "E" : "O")}>
                  <Plus className="size-4" />
                  Register Patient
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => navigate("/ward-view")}><BedDouble className="size-4" />Ward View</Button>
                <Button onClick={() => openRegister("A05")}>
                  <Plus className="size-4" />
                  Pre-Admit Patient
                </Button>
                <Button variant="primary" onClick={() => openRegister("A01")}>
                  <Plus className="size-4" />
                  Admit Patient
                </Button>
              </>
            )}
          </div>
        }
      />
      )}

      {!embedded && (
        <KpiStrip label="Visits by status" className="mb-4 grid-cols-2 lg:grid-cols-4">
          {statuses.map((s) => (
            <KpiTile key={s} icon={STATUS_ICON[s]} label={s} value={byStatus(s).toLocaleString("en-US")}
              note={status === s ? "Shown below" : `Show ${s.toLowerCase()}`} tone={status === s ? "ok" : undefined}
              className={status === s ? "outline-2 outline-offset-0 outline-[#03C1AC]" : undefined} onClick={() => setStatus(status === s ? "" : s)} />
          ))}
        </KpiStrip>
      )}

      <Card className="mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
          <Field label="Start Date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End Date"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label={mode === "ipd" ? "Service" : "Department"}>
            <Select value={dept} onChange={(e) => { setDept(e.target.value); setSub(""); }}>
              <option value="">All</option>
              {SERVICES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Sub-Department">
            <Select value={sub} disabled={!dept} onChange={(e) => setSub(e.target.value)}>
              <option value="">{dept ? "All" : `Choose the ${mode === "ipd" ? "service" : "department"} first`}</option>
              {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Eligibility">
            <Select value={elig} onChange={(e) => setElig(e.target.value)}>
              <option value="">All</option>
              {["Eligible", "Not Eligible", "Cash"].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Patient"><Input placeholder="Name, MRN or visit" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
          <div className="flex items-end">
            <Button onClick={reset} aria-label="Reset filters"><RotateCcw className="size-4" />Reset</Button>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-4">
          <h2 className="text-lg font-semibold">{mode === "opd" ? "OPD Patients" : mode === "er" ? "Emergency Patients" : "IPD Patients"}</h2>
          <Badge tone="neutral">{rows.length} total</Badge>
        </div>
        <Table className="relative mt-3">
          <thead className="bg-move/8">
            <tr>
              <Th>Patient</Th>
              <Th>{mode === "ipd" ? "Admit Date" : "Date"}</Th>
              <Th>{mode === "ipd" ? "Ward and Bed" : "Department"}</Th>
              <Th>Doctor</Th>
              <Th>Eligibility</Th>
              <Th>Status</Th>
              {mode === "ipd" && <Th>Discharge</Th>}
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={mode === "ipd" ? 8 : 7}><Empty>No visits match these filters.</Empty></Td></tr>
            )}
            {rows.map((e) => {
              const p = state.patients.find((x) => x.id === e.patientId);
              const st = visitStatus(e);
              const doc = DOCTORS.find((d) => d.id === e.attending);
              const dep = SERVICES.find((s) => s.code === e.service);
              const allergic = e.allergies.length > 0;
              const el = eligOf(e);
              const appt = mode === "opd" ? appointmentOf(e.visitNumber, appointments) : undefined;
              return (
                <tr key={e.visitNumber} className="hover:bg-muted/40">
                  <Td>
                    <div className="flex items-center gap-3">
                      <span
                        className={allergic ? "flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive" : "flex size-8 shrink-0 items-center justify-center rounded-full bg-ok/12 text-ok"}
                        title={allergic ? `Allergies: ${e.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"}
                      >
                        {allergic ? <IconShieldExclamation className="size-[18px]" stroke={1.75} /> : <IconShieldCheck className="size-[18px]" stroke={1.75} />}
                      </span>
                      <div>
                        <button onClick={() => navigate("/chart", { visit: e.visitNumber })} className="text-sm font-semibold text-move hover:underline">
                          {p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p)}
                        </button>
                        <div className="text-xs text-muted-foreground">
                          {p?.mrn} · {p ? age(p.dob) : "?"} / {p?.sex === "M" ? "Male" : "Female"}
                          {dev && <span className="ml-2 font-mono">{e.visitNumber}</span>}
                        </div>
                        <PatientFlagBadges patient={p} className="mt-1" />
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{niceDate(dateOf(e))}</Td>
                  <Td>
                    {mode !== "ipd" ? (
                      <>
                        <div>{dep?.label ?? e.service}</div>
                        <div className="text-xs text-muted-foreground">{subOf(e)}</div>
                      </>
                    ) : e.status === "active" ? (
                      <div className="font-medium">{bedLabel(e.bedId)}</div>
                    ) : heldBedOf(e) ? (
                      <>
                        <div className="font-medium">{bedLabel(heldBedOf(e))}</div>
                        <div className="text-xs text-muted-foreground">Held until the patient leaves</div>
                      </>
                    ) : e.status === "preadmit" && e.reservedBedId ? (
                      <>
                        <div className="font-medium">{bedLabel(e.reservedBedId)}</div>
                        <div className="text-xs text-muted-foreground">Reserved</div>
                      </>
                    ) : (
                      <div className="text-muted-foreground">{e.status === "preadmit" ? "Not assigned yet" : "None"}</div>
                    )}
                  </Td>
                  <Td>
                    <div className="whitespace-nowrap">{doc ? `Dr. ${doc.given} ${doc.family}` : "None"}</div>
                    {mode === "ipd" && <div className="text-xs text-muted-foreground">{subOf(e)}</div>}
                  </Td>
                  <Td>
                    <span className="inline-flex flex-col items-start gap-0.5" title={el.basis}>
                      <Badge tone={el.tone}>{el.label}</Badge>
                      {el.label !== "Cash" && <span className="max-w-40 truncate text-xs text-muted-foreground">{el.payer}</span>}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {e.dirty && <Badge tone="warn" className="whitespace-nowrap">Changes Not Sent</Badge>}
                    </span>
                    {appt && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Appointment <Badge tone={appointmentTone(appt)} className="ms-1">{appointmentLabel(appt)}</Badge>
                      </div>
                    )}
                  </Td>
                  {mode === "ipd" && <Td><DischargeProgress enc={e} onClearances={openClearances} onLeftWard={openLeftWard} /></Td>}
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      <RowActions enc={e} onAct={(k) => onAct(e, k)} />
                      <VisitLinks e={e} />
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <ActionLegend />
      {dialogs}
    </div>
  );
}
