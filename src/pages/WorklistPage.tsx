import * as React from "react";
import { IconShieldCheck, IconShieldExclamation } from "@tabler/icons-react";
import { Plus, RotateCcw } from "lucide-react";
import { ActionLegend, RowActions, type ActionKey } from "@/components/RowActions";
import { DischargeProgress, useVisitActions } from "@/components/VisitActions";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui/primitives";
import { heldBedOf } from "@/lib/beds";
import { useDevMode } from "@/lib/devmode";
import { niceDate } from "@/lib/discharge";
import { can, hasGlass, useSession } from "@/lib/session";
import type { Encounter } from "@/lib/model";
import { DOCTORS, SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { bedLabel, patientName, toLocalInput, useHis } from "@/lib/store";

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

export function WorklistPage({ mode, embedded }: { mode: Mode; embedded?: boolean }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const { act, openRegister, openPatient, openClearances, openLeftWard, dialogs } = useVisitActions();

  const [start, setStart] = React.useState(day(mode !== "ipd" ? -7 : -14));
  const [end, setEnd] = React.useState(day(mode !== "ipd" ? 0 : 7));
  const [dept, setDept] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [q, setQ] = React.useState("");

  const statuses =
    mode === "ipd" ? ["Admitted", "Pre-Admit", "Discharged", "Cancelled"] : ["Arrived", "Checked In", "Discharged", "Cancelled"];

  const rows = state.encounters
    .filter((e) => (mode === "opd" ? e.cls === "O" : mode === "er" ? e.cls === "E" : e.cls === "I"))
    .filter((e) => {
      const d = dateOf(e).slice(0, 10);
      return !d || (d >= start && d <= end);
    })
    .filter((e) => !dept || e.service === dept)
    .filter((e) => !status || visitStatus(e).label === status)
    .filter((e) => {
      const p = state.patients.find((x) => x.id === e.patientId);
      return !q || `${patientName(p)} ${p?.mrn} ${e.visitNumber}`.toLowerCase().includes(q.toLowerCase());
    })
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)));

  function onAct(e: Encounter, key: ActionKey) {
    if (key === "CHART") return navigate("/chart", { visit: e.visitNumber });
    act(key, e.visitNumber);
  }

  function reset() {
    setStart(day(mode !== "ipd" ? -7 : -14));
    setEnd(day(mode !== "ipd" ? 0 : 7));
    setDept("");
    setStatus("");
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
          <div className="flex gap-2">
            {mode !== "ipd" ? (
              <>
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

      <Card className="mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
          <Field label="Start Date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End Date"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label={mode === "ipd" ? "Service" : "Department"}>
            <Select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All</option>
              {SERVICES.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
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
        <Table className="mt-3">
          <thead className="bg-move/8">
            <tr>
              <Th>Patient</Th>
              <Th>{mode === "ipd" ? "Admit Date" : "Date"}</Th>
              <Th>{mode === "ipd" ? "Ward and Bed" : "Department"}</Th>
              <Th>Doctor</Th>
              <Th>Status</Th>
              {mode === "ipd" && <Th>Discharge</Th>}
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={mode === "ipd" ? 7 : 6}><Empty>No visits match these filters.</Empty></Td></tr>
            )}
            {rows.map((e) => {
              const p = state.patients.find((x) => x.id === e.patientId);
              const st = visitStatus(e);
              const doc = DOCTORS.find((d) => d.id === e.attending);
              const dep = SERVICES.find((s) => s.code === e.service);
              const allergic = e.allergies.length > 0;
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
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{niceDate(dateOf(e))}</Td>
                  <Td>
                    {mode !== "ipd" ? (
                      <>
                        <div>{dep?.label ?? e.service}</div>
                        <div className="text-xs text-muted-foreground">{dep?.label} Clinic</div>
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
                  <Td>{doc ? `Dr. ${doc.given} ${doc.family}` : "None"}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {e.dirty && <Badge tone="warn" className="whitespace-nowrap">Changes Not Sent</Badge>}
                    </span>
                  </Td>
                  {mode === "ipd" && <Td><DischargeProgress enc={e} onClearances={openClearances} onLeftWard={openLeftWard} /></Td>}
                  <Td><RowActions enc={e} onAct={(k) => onAct(e, k)} /></Td>
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
