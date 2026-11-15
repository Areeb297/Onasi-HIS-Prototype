import * as React from "react";
import { BadgeCheck, ChevronDown, GitMerge, IdCard, Search, ShieldCheck } from "lucide-react";
import { ClassBadge, StatusBadge } from "@/components/badges";
import { Dialog } from "@/components/Dialog";
import { Badge, Card, Empty, Input, PageHeader, Table, Td, Th, Button } from "@/components/ui/primitives";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { bedLabel, nowLocal, useHis } from "@/lib/store";
import { navigate, useRoute } from "@/lib/router";
import { PatientFlagBadges, PatientNameAr } from "@/components/PatientBanner";
import { WristbandDialog } from "@/components/Wristband";
import { CoverageDialog } from "@/components/patient/CoverageDialog";
import { EligibilityBadge, EligibilityDialog } from "@/components/patient/EligibilityDialog";
import { MergePatientsDialog } from "@/components/patient/MergePatientsDialog";
import { audit } from "@/lib/audit";
import { coverageLabel, coveragesOf, latestEligibility, primaryCoverage, useCoverages } from "@/lib/coverage";
import type { Patient } from "@/lib/model";
import { ageLabel, arabicName, fetchHealthId, listName } from "@/lib/registration";
import { can, hasGlass, useSession } from "@/lib/session";

/** National Health ID: the Health ID on file, and a check against the national registry with the ID number and date of birth. */
function HealthIdDialog({ patient, onClose }: { patient: Patient | undefined; onClose: () => void }) {
  const [answer, setAnswer] = React.useState<ReturnType<typeof fetchHealthId> | null>(null);
  React.useEffect(() => setAnswer(null), [patient?.id]);
  if (!patient) return null;
  const idNumber = patient.extra?.idNumber || patient.nationalId;
  const name = listName(patient, hasGlass(patient.id));
  function check() {
    const a = fetchHealthId(idNumber, patient!.dob, nowLocal().slice(0, 10));
    setAnswer(a);
    audit("view", "National registry Health ID lookup", { patient: name, detail: a.ok ? (a.healthId === patient!.healthId ? "Matches the file" : "Differs from the file") : a.message });
  }
  return (
    <Dialog open onClose={onClose} title="National Health ID" subtitle={`${name}, ${patient.mrn}`} footer={<Button onClick={onClose}>Close</Button>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Health ID</dt><dd className="font-mono font-semibold">{patient.healthId || "None"}</dd>
        <dt className="text-muted-foreground">ID Number</dt><dd className="font-mono">{idNumber || "None"}</dd>
        <dt className="text-muted-foreground">Date of Birth</dt><dd>{patient.dob || "Not known"}</dd>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">The Health ID is issued by the NHIC patient registry. Every message to the national platform carries it.</p>
      <Button className="mt-3" onClick={check} disabled={!idNumber || !patient.dob}><ShieldCheck className="size-4" />Check With The Registry</Button>
      {answer && (
        <p role="status" className={`mt-3 rounded-md border px-3 py-2 text-sm ${answer.ok && answer.healthId === patient.healthId ? "border-ok/40 bg-ok/10" : "border-warn/50 bg-warn/10"}`}>
          {!answer.ok ? answer.message : answer.healthId === patient.healthId
            ? "The registry returned the same Health ID. The file is correct."
            : `The registry returned ${answer.healthId}, which differs from the file. Correct it with Update Identity.`}
        </p>
      )}
    </Dialog>
  );
}

export function PatientsPage() {
  const state = useHis();
  const covers = useCoverages();
  useSession();
  const route = useRoute();
  /** Set when another screen opens one patient, for example from the duplicate check at registration. */
  const only = route.params.get("patient");
  const [q, setQ] = React.useState("");
  const [band, setBand] = React.useState<string | null>(null);
  const [coverageFor, setCoverageFor] = React.useState<string | null>(null);
  const [eligibilityFor, setEligibilityFor] = React.useState<string | null>(null);
  const [healthIdFor, setHealthIdFor] = React.useState<string | null>(null);
  const [merge, setMerge] = React.useState(false);
  const today = nowLocal().slice(0, 10);

  const rows = state.patients
    .filter((p) => !p.mergedInto)
    .map((p) => {
      const encs = state.encounters.filter((e) => e.patientId === p.id && e.status !== "cancelled");
      const latest = [...encs].reverse().find((e) => e.status === "active" || e.status === "preadmit") ?? encs[encs.length - 1];
      const list = coveragesOf(p.id, covers, state.patients);
      return { p, latest, count: encs.length, primary: primaryCoverage(list, today), eligibility: latestEligibility(list), opened: hasGlass(p.id) };
    })
    .filter(({ p }) => !only || p.id === only)
    .filter(({ p, opened }) => {
      // A confidential patient is found by nick name, file number or Health ID, not by the real name, until the record is opened.
      const hidden = p.confidential && !opened;
      const text = hidden
        ? `${p.extra?.nickName ?? ""} ${p.mrn} ${p.healthId}`
        : `${p.given} ${p.family} ${p.extra?.nickName ?? ""} ${p.mrn} ${p.nationalId} ${p.extra?.idNumber ?? ""} ${p.healthId} ${p.extra?.mobile ?? ""} ${arabicName(p)}`;
      return text.toLowerCase().includes(q.trim().toLowerCase());
    });

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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search name, MRN, ID or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search patients" />
            </div>
            <Button onClick={() => setMerge(true)} disabled={!can("patient.register")} title={can("patient.register") ? undefined : "Needs the patient registration permission"}>
              <GitMerge className="size-4" />Merge Patients
            </Button>
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
              <Th>Phone</Th>
              <Th>Coverage</Th>
              <Th>Eligibility</Th>
              <Th>Current Visit</Th>
              <Th>Status</Th>
              <Th>Location</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <Td colSpan={10}>
                  <Empty>No patients match your search.</Empty>
                </Td>
              </tr>
            )}
            {rows.map(({ p, latest, primary, eligibility, opened }) => {
              const hidden = !!p.confidential && !opened;
              return (
                <tr key={p.id} className="hover:bg-muted/40">
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5 font-medium">
                      {listName(p, opened)}
                      {p.confidential && <Badge tone="warn">Confidential</Badge>}
                      {p.extra?.newborn && <Badge tone="info">Newborn</Badge>}
                    </div>
                    {!hidden && <PatientNameAr patient={p} className="text-start" />}
                    <div className="text-xs text-muted-foreground">{p.mrn}</div>
                    <PatientFlagBadges patient={p} className="mt-1" />
                  </Td>
                  <Td className="font-mono text-xs">{p.healthId}</Td>
                  <Td>
                    {ageLabel(p.dob) || "Not known"} / {p.sex === "M" ? "Male" : "Female"}
                  </Td>
                  <Td className="font-mono text-xs whitespace-nowrap">{hidden ? "Hidden" : p.extra?.mobile || "None"}</Td>
                  <Td>
                    {primary ? (
                      <span className="block min-w-28">
                        <span className="block text-sm">{coverageLabel(primary)}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{primary.memberId}</span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Cash</span>
                    )}
                  </Td>
                  <Td><EligibilityBadge answer={eligibility} /></Td>
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
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" aria-label={`More actions for ${p.mrn}`}>More <ChevronDown className="size-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          <DropdownMenuItem onClick={() => setCoverageFor(p.id)} className="gap-3 py-2 text-sm"><ShieldCheck className="size-4 text-move" />Patient Coverage</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEligibilityFor(p.id)} className="gap-3 py-2 text-sm"><BadgeCheck className="size-4 text-ok" />Eligibility Request</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setHealthIdFor(p.id)} className="gap-3 py-2 text-sm"><IdCard className="size-4 text-update" />National Health ID</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <WristbandDialog patientId={band} onClose={() => setBand(null)} />
      <CoverageDialog patientId={coverageFor} onClose={() => setCoverageFor(null)} />
      <EligibilityDialog patientId={eligibilityFor} onClose={() => setEligibilityFor(null)} />
      <HealthIdDialog patient={state.patients.find((p) => p.id === healthIdFor)} onClose={() => setHealthIdFor(null)} />
      <MergePatientsDialog open={merge} onClose={() => setMerge(false)} />
    </div>
  );
}
