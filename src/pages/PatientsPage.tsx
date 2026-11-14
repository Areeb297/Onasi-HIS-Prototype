import * as React from "react";
import { Search } from "lucide-react";
import { ClassBadge, StatusBadge } from "@/components/badges";
import { Badge, Card, Empty, Input, PageHeader, Table, Td, Th, Button } from "@/components/ui/primitives";
import { bedLabel, patientName, useHis } from "@/lib/store";
import { navigate, useRoute } from "@/lib/router";
import { PatientFlagBadges, PatientNameAr } from "@/components/PatientBanner";
import { WristbandDialog } from "@/components/Wristband";
import { ageLabel, arabicName } from "@/lib/registration";

export function PatientsPage() {
  const state = useHis();
  const route = useRoute();
  /** Set when another screen opens one patient, for example from the duplicate check at registration. */
  const only = route.params.get("patient");
  const [q, setQ] = React.useState("");
  const [band, setBand] = React.useState<string | null>(null);

  const rows = state.patients
    .map((p) => {
      const encs = state.encounters.filter((e) => e.patientId === p.id && e.status !== "cancelled");
      const latest = [...encs].reverse().find((e) => e.status === "active" || e.status === "preadmit") ?? encs[encs.length - 1];
      return { p, latest, count: encs.length };
    })
    .filter(({ p }) => !only || p.id === only)
    .filter(({ p }) => `${p.given} ${p.family} ${p.mrn} ${p.nationalId} ${p.extra?.idNumber ?? ""} ${p.healthId} ${arabicName(p)}`.toLowerCase().includes(q.trim().toLowerCase()));

  const count = (f: (e: (typeof state.encounters)[number]) => boolean) => state.encounters.filter(f).length;
  const tiles = [
    { label: "Inpatients", value: count((e) => e.status === "active" && e.cls === "I"), color: "admit" },
    { label: "Outpatients", value: count((e) => e.status === "active" && e.cls !== "I"), color: "move" },
    { label: "Pre-Admits", value: count((e) => e.status === "preadmit"), color: "merge" },
    { label: "Discharged", value: count((e) => e.status === "discharged"), color: "update" },
    { label: "Cancelled", value: count((e) => e.status === "cancelled"), color: "cancel" },
  ] as const;
  const tileClass = {
    admit: "border-t-admit text-admit",
    move: "border-t-move text-move",
    merge: "border-t-merge text-merge",
    update: "border-t-update text-update",
    cancel: "border-t-cancel text-cancel",
  };

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Made-up patients only. No real hospital or patient data. Pick a patient to see visits, or start an event from the Events menu."
        right={
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, MRN or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
          </div>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-xl border border-t-4 border-border bg-card px-4 py-3 ${tileClass[t.color]}`}>
            <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
            <div className="text-xs font-medium text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
      {only && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
          <span>Showing one patient.</span>
          <Button size="sm" onClick={() => navigate("/patients")}>Show All Patients</Button>
        </div>
      )}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Patient</Th>
              <Th>Health ID</Th>
              <Th>Age / Sex</Th>
              <Th>Current Visit</Th>
              <Th>Status</Th>
              <Th>Location</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <Td colSpan={7}>
                  <Empty>No patients match your search.</Empty>
                </Td>
              </tr>
            )}
            {rows.map(({ p, latest }) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <Td>
                  <div className="font-medium">{patientName(p)}</div>
                  <PatientNameAr patient={p} className="text-start" />
                  <div className="text-xs text-muted-foreground">{p.mrn}</div>
                  <PatientFlagBadges patient={p} className="mt-1" />
                </Td>
                <Td className="font-mono text-xs">{p.healthId}</Td>
                <Td>
                  {ageLabel(p.dob) || "Not known"} / {p.sex === "M" ? "Male" : "Female"}
                </Td>
                <Td>
                  {latest ? (
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">{latest.visitNumber}</span>
                      <ClassBadge cls={latest.cls} />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </Td>
                <Td>{latest ? <StatusBadge status={latest.status} /> : <Badge>No Visit</Badge>}</Td>
                <Td>{latest?.status === "active" ? bedLabel(latest.bedId) : "None"}</Td>
                <Td className="text-right">
                  <span className="inline-flex gap-1.5">
                    {latest && (
                      <Button size="sm" onClick={() => navigate("/encounters", { visit: latest.visitNumber })}>
                        View Timeline
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setBand(p.id)}>Print Wristband</Button>
                    <Button size="sm" variant="primary" onClick={() => navigate("/event/A31", { patient: p.id, enc: latest?.visitNumber })}>
                      Update Identity
                    </Button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <WristbandDialog patientId={band} onClose={() => setBand(null)} />
    </div>
  );
}
