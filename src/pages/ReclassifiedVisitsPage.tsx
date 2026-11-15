import * as React from "react";
import { CalendarPlus, FolderOpen } from "lucide-react";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { useAdmissionRequests } from "@/lib/admission-requests";
import { dayLabel, doctorName, useAppointments } from "@/lib/appointments";
import { useDevMode } from "@/lib/devmode";
import { SERVICES } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { bedLabel, patientName, useHis } from "@/lib/store";
import { visitStatus } from "@/pages/WorklistPage";
import { appointmentLabel, appointmentTone, followUpAfter, isOpenAppointment, reclassifiedVisits, subDepartmentOf } from "@/lib/worklist";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Reclassified To Outpatient: inpatient stays changed to outpatient with A07. These patients usually need a clinic slot.
 * A follow-up after a normal discharge is an ordinary appointment and does not show here.
 */
export function ReclassifiedVisitsPage() {
  const state = useHis();
  const { appointments } = useAppointments();
  const { requests } = useAdmissionRequests();
  const dev = useDevMode();
  useSession();
  const [q, setQ] = React.useState("");

  const rows = reclassifiedVisits(state).filter(({ enc }) => {
    const p = state.patients.find((x) => x.id === enc.patientId);
    return !q || `${patientName(p)} ${p?.mrn} ${enc.visitNumber}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div>
      <PageHeader
        title="Reclassified To Outpatient"
        subtitle="Inpatient stays changed to outpatient (A07). Book each patient a clinic follow-up. A follow-up after a normal discharge is an ordinary appointment and is not listed here."
        right={<Badge tone="neutral">{rows.length} total</Badge>}
      />

      <Card className="mb-4 px-4 py-3">
        <Field label="Patient" className="max-w-sm"><Input placeholder="Name, MRN or visit" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </Card>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Visit</Th>
              <Th>Department</Th>
              <Th>Doctor</Th>
              <Th>Reclassified On</Th>
              <Th>Previous Bed</Th>
              <Th>Visit Status</Th>
              <Th>Follow-Up</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><Td colSpan={9}><Empty>No visits have been changed from inpatient to outpatient.</Empty></Td></tr>
            )}
            {rows.map(({ enc, at, fromBed }) => {
              const p = state.patients.find((x) => x.id === enc.patientId);
              const dep = SERVICES.find((s) => s.code === enc.service);
              const st = visitStatus(enc);
              const appt = followUpAfter(enc.patientId, at, appointments);
              const booked = !!appt && isOpenAppointment(appt);
              const name = p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
              return (
                <tr key={enc.visitNumber} className="hover:bg-muted/40">
                  <Td>
                    <div className="font-semibold">{name}</div>
                    <div className="text-xs text-muted-foreground">{p?.mrn}</div>
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{enc.visitNumber}</Td>
                  <Td>
                    <div>{dep?.label ?? enc.service}</div>
                    <div className="text-xs text-muted-foreground">{subDepartmentOf(enc, requests, appointments)}</div>
                  </Td>
                  <Td className="whitespace-nowrap">{doctorName(enc.attending)}</Td>
                  <Td className="whitespace-nowrap">{when(at)}{dev && <span className="ms-1 font-mono text-xs text-muted-foreground">A07</span>}</Td>
                  <Td className="whitespace-nowrap">{fromBed ? bedLabel(fromBed) : "None"}</Td>
                  <Td><Badge tone={st.tone}>{st.label}</Badge></Td>
                  <Td>
                    {appt ? (
                      <div className="space-y-0.5">
                        <Badge tone={appointmentTone(appt)}>{appointmentLabel(appt)}</Badge>
                        <div className="text-xs text-muted-foreground">{dayLabel(appt.date)}, {appt.start}</div>
                      </div>
                    ) : <Badge tone="warn">Not Booked</Badge>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      {booked ? (
                        <Badge tone="ok">Appointment Booked</Badge>
                      ) : (
                        <Button size="sm" variant="primary" onClick={() => navigate("/appointments")}><CalendarPlus className="size-4" />Book Follow-Up</Button>
                      )}
                      <Button size="sm" onClick={() => navigate("/chart", { visit: enc.visitNumber })}><FolderOpen className="size-4" />Open Chart</Button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
