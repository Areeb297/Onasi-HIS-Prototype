import * as React from "react";
import { IconBed, IconCalendarPlus, IconCircleX, IconDoorExit, IconShieldCheck, IconShieldExclamation, IconStethoscope, IconUserCheck } from "@tabler/icons-react";
import { BedDouble, ClipboardList, FolderOpen, Plus, Receipt, Route, Stethoscope, UserPlus } from "lucide-react";
import { ActionLegend, actionsFor, type ActionDef, type ActionKey } from "@/components/RowActions";
import { PatientFlagBadges } from "@/components/PatientBanner";
import { DischargeProgress, useVisitActions } from "@/components/VisitActions";
import {
  CellSub, DataTable, ListPage, ListToolbar, StatFilters, applyFilters, inRange, joinRange, matchesQuery, useList, type Column, type FilterDef, type RowAction,
} from "@/components/list";
import { fmtDateTime, fmtShort } from "@/lib/format";
import { Badge, cn } from "@/components/ui/primitives";
import { SUB_DEPARTMENTS, canRequestAdmission, useAdmissionRequests } from "@/lib/admission-requests";
import { useAppointments } from "@/lib/appointments";
import { heldBedOf } from "@/lib/beds";
import { clearanceList } from "@/lib/discharge";
import { coveragesOf, useCoverages } from "@/lib/coverage";
import { useDevMode } from "@/lib/devmode";
import { can, hasGlass, useSession } from "@/lib/session";
import type { Encounter } from "@/lib/model";
import { caseOf, useFinancial } from "@/lib/nphies-financial";
import { DOCTORS, SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { bedLabel, patientName, toLocalInput, useHis } from "@/lib/store";
import { appointmentLabel, appointmentOf, eligibilityCell, subDepartmentOf } from "@/lib/worklist";
import { patientShareDue } from "@/lib/copay";
import { useInvoices } from "@/lib/invoice";

type Mode = "opd" | "ipd" | "er";

export function visitStatus(e: Encounter): { label: string; tone: "admit" | "move" | "ok" | "cancel" | "merge" | "neutral" } {
  if (e.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (e.status === "discharged") return { label: e.cls === "O" ? "Visit Ended" : "Discharged", tone: "cancel" };
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

/** The one step most likely to come next for a visit. Same order as the row actions elsewhere in the app. */
function suggested(enc: Encounter, list: ActionDef[]): ActionDef | undefined {
  const has = (k: ActionKey) => list.find((a) => a.key === k);
  if (enc.dirty) return has("A08");
  if (enc.status === "preadmit") return has("A01");
  if (enc.status === "active") {
    if (enc.cls === "I") return has("A02");
    if (!enc.checkedIn && enc.cls !== "E") return has("CHECKIN");
    return has("A03");
  }
  return undefined;
}
/** Corrections and cancellations sit apart at the end of the menu. Only the cancellations are red. */
const DANGER: ActionKey[] = ["A11", "A38"];
const LAST: ActionKey[] = ["A45", ...DANGER];

/** The four discharge clearances as one short pill: how many are given, with each one in the tooltip. Opens the clearances. */
function ClearanceCell({ enc, onOpen }: { enc: Encounter; onOpen: () => void }) {
  const list = clearanceList(enc);
  const done = list.filter((c) => c.done).length;
  const tip = list.map((c) => `${c.label}: ${c.done ? `given by ${c.done.by}` : `waiting for the ${c.who.toLowerCase()}`}`).join(". ");
  return (
    <button type="button" onClick={onOpen} title={tip} aria-label={`Discharge clearances, ${done} of ${list.length} given. Open to give or withdraw.`}
      className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 whitespace-nowrap hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      <span className="flex gap-0.5" aria-hidden="true">{list.map((c) => <span key={c.key} className={cn("h-2 w-3 rounded-sm", c.done ? "bg-[#03c1ac]" : "bg-muted-foreground/25")} />)}</span>
      <Badge tone={done === list.length ? "ok" : "neutral"}>{done} of {list.length} Cleared</Badge>
    </button>
  );
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  Arrived: <IconUserCheck stroke={1.75} />, "Checked In": <IconStethoscope stroke={1.75} />, Admitted: <IconBed stroke={1.75} />,
  "Pre-Admit": <IconCalendarPlus stroke={1.75} />, Discharged: <IconDoorExit stroke={1.75} />, "Visit Ended": <IconDoorExit stroke={1.75} />, Cancelled: <IconCircleX stroke={1.75} />,
};

export function WorklistPage({ mode, embedded }: { mode: Mode; embedded?: boolean }) {
  const state = useHis();
  const dev = useDevMode();
  useSession();
  const { appointments } = useAppointments();
  const { requests } = useAdmissionRequests();
  const coverageStore = useCoverages();
  const fin = useFinancial();
  useInvoices(); // the Not Paid pill clears when the cashier takes the payment
  const { act, openRegister, openPatient, openClearances, openLeftWard, dialogs } = useVisitActions();
  const ipd = mode === "ipd";
  const today = day(0);

  const statuses = ipd ? ["Admitted", "Pre-Admit", "Discharged", "Cancelled"] : ["Arrived", "Checked In", mode === "opd" ? "Visit Ended" : "Discharged", "Cancelled"];
  const subOf = (e: Encounter) => subDepartmentOf(e, requests, appointments);
  const ofMode = state.encounters.filter((e) => (mode === "opd" ? e.cls === "O" : mode === "er" ? e.cls === "E" : e.cls === "I"));

  const rows = ofMode.map((e) => {
    const p = state.patients.find((x) => x.id === e.patientId);
    const hidden = !!p?.confidential && !hasGlass(p.id);
    return {
      e, p, hidden,
      name: hidden ? "Confidential Patient" : patientName(p),
      status: visitStatus(e),
      elig: eligibilityCell(p, caseOf(e.visitNumber, fin), coveragesOf(e.patientId, coverageStore, state.patients), today),
      sub: subOf(e),
      doctor: DOCTORS.find((d) => d.id === e.attending),
      dept: SERVICES.find((s) => s.code === e.service),
      appt: mode === "opd" ? appointmentOf(e.visitNumber, appointments) : undefined,
      // Practice: the patient's share is paid at the cashier before the doctor. Shown, never blocking.
      unpaid: mode === "opd" && e.status === "active" && !!p && !patientShareDue(e, p).paid,
    };
  });
  type Row = (typeof rows)[number];

  const subOptions = (dept: string) => [...new Set([...(SUB_DEPARTMENTS[dept] ?? []), ...ofMode.filter((e) => e.service === dept).map(subOf)])].sort();
  const deptWord = ipd ? "Service" : "Department";
  const filters: FilterDef<Row>[] = [
    { id: "date", label: ipd ? "Admit Date" : "Date", kind: "dateRange", test: (r, v) => { const d = dateOf(r.e); return !d || inRange(d, v); } },
    { id: "dept", label: deptWord, quick: true, options: SERVICES.map((s) => ({ value: s.code, label: s.label })), test: (r, v) => r.e.service === v },
    { id: "sub", label: "Sub-Department", dependsOn: "dept", options: [], test: (r, v) => r.sub === v },
    { id: "status", label: "Status", options: statuses.map((s) => ({ value: s, label: s })), test: (r, v) => r.status.label === v },
    { id: "elig", label: "Eligibility", quick: true, options: ["Eligible", "Not Eligible", "Cash"].map((s) => ({ value: s, label: s })), test: (r, v) => r.elig.label === v },
  ];

  const columns: Column<Row>[] = [
    {
      id: "patient", header: "Patient", hideable: false, value: (r) => r.name,
      cell: (r) => {
        const allergic = r.e.allergies.length > 0;
        return (
          <div className="flex min-w-56 items-center gap-2">
            <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", allergic ? "bg-destructive/12 text-destructive" : "bg-ok/10 text-ok")}
              title={allergic ? `Allergies: ${r.e.allergies.map((a) => a.text).join(", ")}` : "No allergies recorded"} role="img" aria-label={allergic ? "Has allergies" : "No allergies recorded"}>
              {allergic ? <IconShieldExclamation className="size-3.5" stroke={1.75} /> : <IconShieldCheck className="size-3.5" stroke={1.75} />}
            </span>
            <span className="font-semibold whitespace-nowrap text-[#032c26] dark:text-foreground">{r.name}</span>
            <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{r.p?.mrn}</span>
            {dev && <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{r.e.visitNumber}</span>}
            <PatientFlagBadges patient={r.p} className="flex-nowrap" />
          </div>
        );
      },
    },
    {
      id: "age", header: "Age", value: (r) => (r.p ? age(r.p.dob) : undefined), csv: (r) => (r.p ? `${age(r.p.dob)} y, ${r.p.sex === "M" ? "Male" : "Female"}` : ""),
      cell: (r) => <span className="whitespace-nowrap tabular-nums" title={r.p?.sex === "M" ? "Male" : "Female"}>{r.p ? `${age(r.p.dob)} ${r.p.sex === "M" ? "M" : "F"}` : "None"}</span>,
    },
    { id: "date", header: ipd ? "Admit Date" : "Date", value: (r) => dateOf(r.e), csv: (r) => fmtDateTime(dateOf(r.e)), cell: (r) => <span className="whitespace-nowrap tabular-nums" title={fmtDateTime(dateOf(r.e))}>{fmtShort(dateOf(r.e)) || "None"}</span> },
    ipd ? {
      id: "bed", header: "Ward And Bed",
      value: (r) => (r.e.status === "active" ? bedLabel(r.e.bedId) : heldBedOf(r.e) ? bedLabel(heldBedOf(r.e)) : r.e.reservedBedId ? bedLabel(r.e.reservedBedId) : ""),
      cell: (r) => r.e.status === "active" ? <span className="font-medium whitespace-nowrap">{bedLabel(r.e.bedId)}</span>
        : heldBedOf(r.e) ? <span title="Held until the patient leaves the ward"><span className="font-medium whitespace-nowrap">{bedLabel(heldBedOf(r.e))}</span> <span className="text-xs text-muted-foreground">Held</span></span>
        : r.e.status === "preadmit" && r.e.reservedBedId ? <span><span className="font-medium whitespace-nowrap">{bedLabel(r.e.reservedBedId)}</span> <span className="text-xs text-muted-foreground">Reserved</span></span>
        : <span className="text-muted-foreground">{r.e.status === "preadmit" ? "Not Assigned" : "None"}</span>,
    } : {
      id: "dept", header: "Department", value: (r) => r.dept?.label ?? r.e.service,
      cell: (r) => <div className="min-w-32"><div className="whitespace-nowrap">{r.dept?.label ?? r.e.service}</div>{r.sub && r.sub !== r.dept?.label && <CellSub>{r.sub}</CellSub>}</div>,
    },
    {
      id: "doctor", header: "Doctor", value: (r) => (r.doctor ? `${r.doctor.given} ${r.doctor.family}` : ""),
      cell: (r) => <div><div className="whitespace-nowrap">{r.doctor ? `Dr. ${r.doctor.given} ${r.doctor.family}` : "None"}</div>{ipd && r.sub && <CellSub>{r.sub}</CellSub>}</div>,
    },
    {
      id: "elig", header: "Eligibility", value: (r) => r.elig.label, csv: (r) => `${r.elig.label}${r.elig.label !== "Cash" ? `, ${r.elig.payer}` : ""}`,
      cell: (r) => <span title={`${r.elig.payer}. ${r.elig.basis}`}><Badge tone={r.elig.tone}>{r.elig.label}</Badge></span>,
    },
    ...(mode === "opd" ? [{
      id: "appt", header: "Appointment", defaultHidden: true, value: (r: Row) => (r.appt ? appointmentLabel(r.appt) : ""),
      cell: (r: Row) => (r.appt ? <span className="whitespace-nowrap">{appointmentLabel(r.appt)}</span> : <span className="text-muted-foreground">Walk-In</span>),
    }] : []),
    {
      id: "status", header: "Status", value: (r) => r.status.label,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Badge tone={r.status.tone}>{r.status.label}</Badge>
          {r.unpaid && <span title="The patient's share is not paid at the cashier yet"><Badge tone="warn">Not Paid</Badge></span>}
          {r.e.dirty && <span className="size-2 rounded-full bg-warn" title="Changes not sent" role="img" aria-label="Changes not sent" />}
        </span>
      ),
    },
    ...(ipd ? [{
      id: "discharge", header: "Discharge",
      value: (r: Row) => (r.e.status === "active" ? clearanceList(r.e).filter((c) => c.done).length : undefined),
      csv: (r: Row) => (r.e.status === "active" ? `${clearanceList(r.e).filter((c) => c.done).length} of ${clearanceList(r.e).length} clearances` : ""),
      cell: (r: Row) => r.e.status === "active" ? <ClearanceCell enc={r.e} onOpen={() => openClearances(r.e.visitNumber)} /> : <DischargeProgress enc={r.e} onClearances={openClearances} onLeftWard={openLeftWard} />,
    }] : []),
  ];

  const list = useList({
    id: `worklist:${mode}`,
    title: mode === "opd" ? "OPD Worklist" : mode === "er" ? "Emergency Worklist" : "IPD Worklist",
    rows,
    columns,
    getId: (r) => r.e.visitNumber,
    filters,
    initialFilters: { date: joinRange(day(ipd ? -14 : -7), day(ipd ? 7 : 0)) },
    initialSort: { key: "date", dir: "desc" },
    unit: ["visit", "visits"],
    search: (r) => `${r.name} ${r.p?.mrn ?? ""} ${r.e.visitNumber}`,
  });
  // Sub-department choices follow the department chosen.
  const subDef = filters.find((f) => f.id === "sub")!;
  subDef.options = list.filterValues.dept ? subOptions(list.filterValues.dept).map((s) => ({ value: s, label: s })) : [];

  // The chips count every filter except Status, so each still shows its number while one status is chosen.
  const { status: _status, ...others } = list.filterValues;
  const scoped = applyFilters(rows.filter((r) => matchesQuery(`${r.name} ${r.p?.mrn ?? ""} ${r.e.visitNumber}`, list.query)), others, filters);
  const stats = statuses.map((s) => ({ id: s, label: s, value: scoped.filter((r) => r.status.label === s).length, icon: STATUS_ICON[s] }));

  const allowed = can("adt.send");
  const code = (a: ActionDef) => (dev && a.key !== "CHART" && a.key !== "CHECKIN" ? ` (${a.key})` : "");
  const actions = (r: Row): RowAction[] => {
    const e = r.e;
    const all = actionsFor(e).filter((a) => allowed || a.key === "CHART");
    const rest = all.filter((a) => a.key !== "CHART");
    const next = suggested(e, rest);
    const chart: RowAction = { id: "CHART", label: "Open Chart", icon: <FolderOpen />, onClick: () => navigate("/chart", { visit: e.visitNumber }) };
    const out: RowAction[] = next
      ? [{ id: next.key, label: next.label, icon: next.icon, emphasis: true, dot: next.dot, title: `${next.label}${code(next)}`, onClick: () => act(next.key as Exclude<ActionKey, "CHART">, e.visitNumber) }, chart]
      : [chart];
    rest.filter((a) => a !== next).forEach((a, i, arr) => out.push({
      id: a.key, label: `${a.label}${code(a)}`, icon: a.icon, dot: a.dot, danger: DANGER.includes(a.key),
      separate: LAST.includes(a.key) && (i === 0 || !LAST.includes(arr[i - 1].key)),
      onClick: () => act(a.key as Exclude<ActionKey, "CHART">, e.visitNumber),
    }));
    const links: RowAction[] = [
      { id: "emar", label: "Medication Chart", icon: <ClipboardList />, onClick: () => navigate("/chart", { visit: e.visitNumber, s: "emar" }) },
      { id: "journey", label: "Patient Journey", icon: <Route />, onClick: () => navigate("/chart", { visit: e.visitNumber, s: "overview" }) },
    ];
    if (can(["billing", "cashier"])) links.push({ id: "invoice", label: "Invoice", icon: <Receipt />, onClick: () => navigate("/invoice", { visit: e.visitNumber }) });
    if (e.status === "active" && (e.cls === "O" || e.cls === "E") && canRequestAdmission()) {
      links.push({ id: "request", label: "Request Admission", icon: <BedDouble />, onClick: () => navigate("/admission-requests", { new: "1", patient: e.patientId, visit: e.visitNumber }) });
    }
    links[0].separate = true;
    return [...out, ...links];
  };

  const title = list.title;
  const table = (
    <>
      <ListToolbar list={list} placeholder="Name, MRN or visit" />
      <DataTable
        list={list}
        label={ipd ? "IPD visits" : mode === "er" ? "Emergency visits" : "OPD visits"}
        rowLabel={(r) => r.name}
        onRowClick={(r) => navigate("/chart", { visit: r.e.visitNumber })}
        actions={actions}
        inline={1}
        card={(r) => ({
          title: r.name,
          aside: <Badge tone={r.status.tone}>{r.status.label}</Badge>,
          lines: [
            <span key="a">{ipd ? (r.e.status === "active" ? bedLabel(r.e.bedId) : r.sub) : r.dept?.label ?? r.e.service}{r.doctor ? `, Dr. ${r.doctor.given} ${r.doctor.family}` : ""}</span>,
            <span key="b" className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="tabular-nums">{fmtDateTime(dateOf(r.e))}</span><Badge tone={r.elig.tone}>{r.elig.label}</Badge></span>,
          ],
        })}
        empty={{
          icon: <Stethoscope />,
          title: ipd ? "No Inpatients Yet" : "No Visits Yet",
          text: ipd
            ? "Admitted and pre-admitted patients appear here. Discharge needs the four clearances, and the bed stays held until the patient leaves the ward."
            : "Visits appear here once a patient is registered. Most row actions send an ADT message in one click, and the toast has an Undo.",
          action: ipd ? (allowed ? { label: "Admit Patient", icon: <Plus className="size-4" />, onClick: () => openRegister("A01") } : undefined)
            : can("patient.register") ? { label: "Register Patient", icon: <UserPlus className="size-4" />, onClick: () => openPatient(mode === "er" ? "E" : "O") } : undefined,
        }}
      />
      <ActionLegend />
      {dialogs}
    </>
  );

  if (embedded) return <div>{table}</div>;

  return (
    <ListPage
      title={title}
      subtitle={ipd ? "Inpatients and pre-admissions. Open a row to go to the chart." : "Outpatient visits. Open a row to go to the chart."}
      primary={ipd
        ? (allowed ? { label: "Admit Patient", icon: <Plus className="size-4" aria-hidden="true" />, onClick: () => openRegister("A01") } : undefined)
        : (can("patient.register") ? { label: "Register Patient", icon: <UserPlus className="size-4" aria-hidden="true" />, onClick: () => openPatient(mode === "er" ? "E" : "O") } : undefined)}
      more={ipd ? [
        allowed && { label: "Pre-Admit Patient", icon: <IconCalendarPlus className="size-4" stroke={1.75} />, onClick: () => openRegister("A05") },
        { label: "Ward View", icon: <BedDouble className="size-4" />, onClick: () => navigate("/ward-view") },
      ] : [
        mode === "opd" && allowed && { label: "Register Visit", icon: <Plus className="size-4" />, onClick: () => openRegister("A04") },
        mode === "opd" && { label: "Reclassified To Outpatient", icon: <Route className="size-4" />, onClick: () => navigate("/reclassified") },
      ]}
      kpis={<StatFilters label="Visits by status" items={stats} value={list.filterValues.status ?? ""} onChange={(v) => list.setFilter("status", v)} />}
    >
      {table}
    </ListPage>
  );
}
