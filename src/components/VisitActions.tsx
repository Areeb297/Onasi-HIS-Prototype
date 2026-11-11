import * as React from "react";
import { BedDouble, UserPlus } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { checkIn, dischargeWith, quickCreate, quickSend } from "@/lib/actions";
import { useDevMode } from "@/lib/devmode";
import type { Dx } from "@/lib/model";
import { COMPLAINT_SAMPLES, DISPOSITIONS, DOCTORS, DX_SAMPLES, SERVICES, WARDS } from "@/lib/reference-data";
import type { EventId } from "@/lib/spec";
import { navigate } from "@/lib/router";
import { freeBeds, getState, nowLocal, patientName, useHis } from "@/lib/store";

type BedDlg = { kind: "bed"; event: "A01" | "A02" | "A06"; visit?: string; patientId?: string };
type DischargeDlg = { kind: "discharge"; visit: string };
type RegisterDlg = { kind: "register"; type: "A04" | "A01" | "A05"; patientId?: string; bedId?: string };
type Dlg = BedDlg | DischargeDlg | RegisterDlg;

/**
 * One place for every HIS action. A button calls act(event, visit). The hook runs the ADT event,
 * or opens a small dialog only when a choice is needed (which bed, which diagnosis).
 */
export function useVisitActions() {
  const [dlg, setDlg] = React.useState<Dlg | null>(null);
  const close = React.useCallback(() => setDlg(null), []);

  function act(eventId: EventId | "CHECKIN", visit: string) {
    const enc = getState().encounters.find((e) => e.visitNumber === visit);
    if (!enc) return;
    if (eventId === "CHECKIN") return checkIn(visit);
    if (eventId === "A02" || eventId === "A06") return setDlg({ kind: "bed", event: eventId, visit });
    if (eventId === "A01") return setDlg({ kind: "bed", event: "A01", visit, patientId: enc.patientId });
    if (eventId === "A03" && enc.dx.length === 0) return setDlg({ kind: "discharge", visit });
    quickSend(eventId, visit);
  }

  const openRegister = (type: "A04" | "A01" | "A05", opts: { patientId?: string; bedId?: string } = {}) =>
    setDlg({ kind: "register", type, ...opts });
  /** Full patient registration is its own page, with the ID lookup and card retrieval. */
  const openPatient = (cls: "O" | "E" = "O") => navigate("/registration", { cls: cls === "E" ? "E" : undefined });

  const dialogs = (
    <>
      {dlg?.kind === "bed" && <BedDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "discharge" && <DischargeDialog dlg={dlg} onClose={close} />}
      {dlg?.kind === "register" && <RegisterDialog dlg={dlg} onClose={close} onNewPatient={() => openPatient()} />}
    </>
  );
  return { act, openRegister, openPatient, dialogs };
}

/* ---------- Bed picker ---------- */

const WARD_TEXT: Record<string, string> = { "3A": "text-move", "4B": "text-update", ICU: "text-cancel" };

function BedDialog({ dlg, onClose }: { dlg: BedDlg; onClose: () => void }) {
  const state = useHis();
  const enc = dlg.visit ? state.encounters.find((e) => e.visitNumber === dlg.visit) : undefined;
  const free = freeBeds(state).filter((b) => b.id !== enc?.bedId);
  const title = dlg.event === "A02" ? "Transfer To Bed" : dlg.event === "A06" ? "Admit To Inpatient" : "Admit To Bed";

  function pick(bedId: string) {
    onClose();
    if (dlg.event === "A01") {
      quickCreate("A01", {
        patientId: dlg.patientId ?? "",
        attending: enc?.attending ?? DOCTORS[0].id,
        service: enc?.service ?? "MED",
        reason: enc?.reason ?? "",
        bedId,
      });
    } else {
      quickSend(dlg.event, dlg.visit!, (f) => {
        f.bedId = bedId;
      });
    }
  }

  return (
    <Dialog open onClose={onClose} title={title} subtitle="Pick a free bed. The message is sent as soon as you pick.">
      <div className="space-y-4">
        {WARDS.map((w) => {
          const beds = free.filter((b) => b.ward === w.ward);
          return (
            <div key={w.ward}>
              <div className={cn("mb-1.5 text-xs font-semibold", WARD_TEXT[w.ward])}>{w.name}</div>
              <div className="flex flex-wrap gap-2">
                {beds.length === 0 && <span className="text-xs text-muted-foreground">No free beds.</span>}
                {beds.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => pick(b.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:border-admit hover:bg-admit/10"
                  >
                    <BedDouble className="size-4 text-admit" />
                    {b.room}-{b.bed}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/* ---------- Discharge ---------- */

function DischargeDialog({ dlg, onClose }: { dlg: DischargeDlg; onClose: () => void }) {
  const dev = useDevMode();
  const [picked, setPicked] = React.useState<Dx[]>([]);
  const [disp, setDisp] = React.useState("01");
  const toggle = (d: Dx) => setPicked((p) => (p.some((x) => x.code === d.code) ? p.filter((x) => x.code !== d.code) : [...p, d]));
  return (
    <Dialog
      open
      onClose={onClose}
      title="Discharge Patient"
      subtitle={
        dev
          ? "A03 needs at least one diagnosis (DG1 is required). This visit has none yet."
          : "A final diagnosis is needed before discharge. This visit has none yet."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={picked.length === 0}
            onClick={() => {
              onClose();
              dischargeWith(dlg.visit, picked, disp);
            }}
          >
            Discharge
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Final Diagnosis</div>
          <div className="flex flex-wrap gap-2">
            {DX_SAMPLES.map((d) => {
              const on = picked.some((x) => x.code === d.code);
              return (
                <button
                  key={d.code}
                  onClick={() => toggle(d)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
                    on ? "border-admit bg-admit/12 text-admit" : "border-border hover:bg-muted",
                  )}
                >
                  <span className="font-mono font-semibold">{d.code}</span> {d.text}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Discharge Disposition" hl7="PV1-36">
          <Select value={disp} onChange={(e) => setDisp(e.target.value)}>
            {DISPOSITIONS.map((d) => (
              <option key={d.code} value={d.code}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/* ---------- Register, admit, pre-admit ---------- */

function RegisterDialog({ dlg, onClose, onNewPatient }: { dlg: RegisterDlg; onClose: () => void; onNewPatient: () => void }) {
  const state = useHis();
  const dev = useDevMode();
  const [patientId, setPatientId] = React.useState(dlg.patientId ?? "");
  const [attending, setAttending] = React.useState(DOCTORS[0].id);
  const [service, setService] = React.useState(dlg.type === "A04" ? "OPD" : "MED");
  const [reason, setReason] = React.useState("");
  const [bedId, setBedId] = React.useState(dlg.bedId ?? "");
  const [expected, setExpected] = React.useState(() => {
    const t = new Date(Date.now() + 86_400_000);
    t.setHours(8, 0, 0, 0);
    return nowLocal((t.getTime() - Date.now()) / 60_000);
  });

  const free = freeBeds(state);
  const titles = { A04: "Register Visit", A01: "Admit Patient", A05: "Pre-Admit Patient" } as const;
  const subs = {
    A04: "Outpatient or same-day visit. Sends A04.",
    A01: "Inpatient admission with a bed. Sends A01.",
    A05: "Planned admission with an expected date. Sends A05.",
  } as const;
  const needBed = dlg.type === "A01";
  const ready = !!patientId && (!needBed || !!bedId) && (dlg.type !== "A05" || !!expected);

  function submit() {
    const d = DOCTORS.find((x) => x.id === attending);
    onClose();
    quickCreate(dlg.type, {
      patientId,
      attending,
      service: dlg.type === "A04" ? service : (d?.service ?? service),
      reason,
      bedId,
      expectedAdmitAt: expected,
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={titles[dlg.type]}
      subtitle={dev ? subs[dlg.type] : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            {titles[dlg.type]}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patient" hl7="PID-3" className="sm:col-span-2">
          <div className="flex gap-2">
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)} aria-label="Patient">
              <option value="">Select a patient</option>
              {state.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {patientName(p)} ({p.mrn})
                </option>
              ))}
            </Select>
            <Button onClick={onNewPatient} title="Register a new patient">
              <UserPlus className="size-4" />
              New Patient
            </Button>
          </div>
        </Field>
        <Field label="Doctor" hl7="PV1-7">
          <Select value={attending} onChange={(e) => setAttending(e.target.value)}>
            {DOCTORS.map((d) => (
              <option key={d.id} value={d.id}>
                Dr. {d.given} {d.family}
              </option>
            ))}
          </Select>
        </Field>
        {dlg.type === "A04" && (
          <Field label="Department" hl7="PV1-10">
            <Select value={service} onChange={(e) => setService(e.target.value)}>
              {SERVICES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {needBed && (
          <Field label="Bed" hl7="PV1-3">
            <Select value={bedId} onChange={(e) => setBedId(e.target.value)} aria-label="Bed">
              <option value="">Select a bed</option>
              {free.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.wardName}, {b.room}-{b.bed}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {dlg.type === "A05" && (
          <Field label="Expected Admit Date" hl7="PV2-8">
            <Input type="datetime-local" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
        )}
        <Field label="Reason for Visit" hl7="PV2-3" className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Type a reason, or tap one below" />
          <div className="mt-1 flex flex-wrap gap-1.5">
            {COMPLAINT_SAMPLES.map((c) => (
              <button key={c.code} type="button" onClick={() => setReason(c.text)} className="rounded-md bg-muted px-2 py-1 text-xs hover:bg-accent">
                {c.text}
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
