import * as React from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { PROC_TYPES, newPr, readPr, searchAchi, type AchiItem } from "@/lib/achi-catalog";
import { audit } from "@/lib/audit";
import type { Encounter, Pr } from "@/lib/model";
import { DOCTORS, PR_TYPES } from "@/lib/reference-data";
import { can } from "@/lib/session";
import { nowLocal, patientName, updateEncounter, useHis } from "@/lib/store";

/**
 * Procedures for a visit, coded in ACHI. Rows are the PR1 segments of the ADT messages.
 * Clinical procedure type, diagnosis link, coverage and status are kept in the HIS and are not sent.
 */
export function ProceduresSection({ enc }: { enc: Encounter }) {
  const st = useHis();
  const patient = st.patients.find((p) => p.id === enc.patientId);
  const visitPay = patient?.extra?.visitPayType;
  const write = can("emr.write");

  const [procType, setProcType] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<AchiItem | null>(null);
  const [dxCode, setDxCode] = React.useState(enc.dx.length === 1 ? enc.dx[0].code : "");
  const [coverage, setCoverage] = React.useState<"Insured" | "Cash">(visitPay === "Cash" ? "Cash" : "Insured");
  const [status, setStatus] = React.useState<"Completed" | "Pending">("Completed");
  const [at, setAt] = React.useState(nowLocal());

  const results = React.useMemo(() => searchAchi(query, { procType: procType || undefined, limit: 12 }), [query, procType]);
  const dxText = (code?: string) => (code ? enc.dx.find((d) => d.code === code)?.text : undefined);

  const patch = (i: number, change: Partial<Pr>) =>
    updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.map((x, j) => (j === i ? { ...x, ...change } : x)); });

  function add() {
    if (!picked) return;
    const row: Pr = { ...newPr(picked, at, visitPay, dxCode || undefined), procType: procType || picked.procType, coverage, status };
    let added = false;
    updateEncounter(enc.visitNumber, (e) => {
      if (e.pr.some((x) => x.code === row.code && (x.status ?? "Completed") === row.status)) return;
      e.pr = [...e.pr, row];
      added = true;
    });
    if (added) audit("update", `Procedure ${row.code}`, { patient: patient ? patientName(patient) : undefined, detail: `Visit ${enc.visitNumber}, ${row.status}` });
    setPicked(null);
    setQuery("");
    setAt(nowLocal());
  }

  return (
    <Card>
      <CardHeader title="Procedures" tag="PR1" subtitle="Coded in ACHI. Clinical type, diagnosis, coverage and status stay in the HIS." />

      {write && (
        <div className="space-y-3 border-b border-border bg-muted/30 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Procedure Type">
              <Select value={procType} onChange={(e) => { setProcType(e.target.value); setPicked(null); }}>
                <option value="">All Types</option>
                {PROC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Search ACHI" className="sm:col-span-1 lg:col-span-3">
              <div className="relative">
                <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="ps-9" value={query} placeholder="Type a code or words, for example 30445 or cholecystectomy"
                  onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
                />
              </div>
            </Field>
          </div>

          {!picked && query.trim() !== "" && (
            <div role="listbox" aria-label="ACHI results" className="max-h-60 overflow-y-auto rounded-lg border border-border bg-card">
              {results.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No ACHI procedure matches. Try fewer words or another type.</p>}
              {results.map((r) => (
                <button
                  key={r.code} role="option" aria-selected={false} onClick={() => setPicked(r)}
                  className="flex w-full items-start gap-3 border-b border-border/70 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="font-mono text-xs font-semibold">{r.code}</span>
                  <span className="min-w-0 flex-1">{r.text}<span className="block text-xs text-muted-foreground">{r.area} · {r.procType}</span></span>
                </button>
              ))}
            </div>
          )}

          {picked && (
            <div className="space-y-3 rounded-lg border border-admit/40 bg-card p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs font-semibold">{picked.code}</span>
                <span className="font-medium">{picked.text}</span>
                <button className="ms-auto text-xs text-move underline" onClick={() => setPicked(null)}>Change</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Diagnosis" hint={enc.dx.length === 0 ? "This visit has no diagnosis yet. Add one in Diagnosis to link it." : undefined}>
                  <Select value={dxCode} disabled={enc.dx.length === 0} onChange={(e) => setDxCode(e.target.value)}>
                    <option value="">{enc.dx.length === 0 ? "No Diagnosis On This Visit" : "Not Linked"}</option>
                    {enc.dx.map((d) => <option key={d.code} value={d.code}>{d.code} {d.text}</option>)}
                  </Select>
                </Field>
                <Field label="Coverage" hint={`Visit is ${visitPay === "Cash" ? "cash" : "insured"}.`}>
                  <Select value={coverage} onChange={(e) => setCoverage(e.target.value as "Insured" | "Cash")}>
                    <option>Insured</option>
                    <option>Cash</option>
                  </Select>
                </Field>
                <Field label="Status">
                  <Select value={status} onChange={(e) => setStatus(e.target.value as "Completed" | "Pending")}>
                    <option>Completed</option>
                    <option>Pending</option>
                  </Select>
                </Field>
                <Field label={status === "Pending" ? "Planned For" : "Started"} hl7="PR1-5">
                  <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button variant="primary" onClick={add}><Plus className="size-4" />Add Procedure</Button>
              </div>
            </div>
          )}
        </div>
      )}

      <Table>
        <thead>
          <tr>
            <Th>Code</Th><Th>Description</Th><Th>Started</Th><Th>Type</Th><Th>Clinical Type</Th><Th>Diagnosis</Th><Th>Coverage</Th><Th>Status</Th><Th>Surgeon</Th><Th />
          </tr>
        </thead>
        <tbody>
          {enc.pr.length === 0 && <tr><Td colSpan={10}><Empty>No procedures yet.</Empty></Td></tr>}
          {enc.pr.map((raw, i) => {
            const p = readPr(raw, visitPay);
            const dx = dxText(p.dxCode);
            return (
              <tr key={p.code + i}>
                <Td className="font-mono text-xs font-semibold">{p.code}</Td>
                <Td className="min-w-48">{p.text}</Td>
                <Td>
                  <Input className="h-8 w-48" type="datetime-local" value={p.at ?? ""} disabled={!write} aria-label="Procedure start date and time" onChange={(ev) => patch(i, { at: ev.target.value })} />
                </Td>
                <Td>
                  <Select className="h-8 w-32" value={p.type ?? ""} disabled={!write} aria-label="Procedure type" onChange={(ev) => patch(i, { type: (ev.target.value || undefined) as Pr["type"] })}>
                    <option value="">Not set</option>
                    {PR_TYPES.map((t) => <option key={t.code} value={t.code}>{t.short}</option>)}
                  </Select>
                </Td>
                <Td>
                  <Select className="h-8 w-40" value={p.procType ?? ""} disabled={!write} aria-label="Clinical procedure type" onChange={(ev) => patch(i, { procType: ev.target.value || undefined })}>
                    <option value="">Not set</option>
                    {PROC_TYPES.map((t) => <option key={t}>{t}</option>)}
                    {p.procType && !(PROC_TYPES as readonly string[]).includes(p.procType) && <option>{p.procType}</option>}
                  </Select>
                </Td>
                <Td>
                  {enc.dx.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{p.dxCode ? p.dxCode : "No diagnosis on this visit"}</span>
                  ) : (
                    <Select className="h-8 w-48" value={p.dxCode ?? ""} disabled={!write} aria-label="Linked diagnosis" title={dx} onChange={(ev) => patch(i, { dxCode: ev.target.value || undefined })}>
                      <option value="">Not linked</option>
                      {enc.dx.map((d) => <option key={d.code} value={d.code}>{d.code} {d.text}</option>)}
                      {p.dxCode && !dx && <option value={p.dxCode}>{p.dxCode} (removed)</option>}
                    </Select>
                  )}
                </Td>
                <Td>
                  <Select className={cn("h-8 w-28", p.coverage === "Cash" && "text-warn")} value={p.coverage} disabled={!write} aria-label="Coverage" onChange={(ev) => patch(i, { coverage: ev.target.value as "Insured" | "Cash" })}>
                    <option>Insured</option>
                    <option>Cash</option>
                  </Select>
                </Td>
                <Td>
                  {write ? (
                    <Select className="h-8 w-32" value={p.status} aria-label="Status" onChange={(ev) => patch(i, { status: ev.target.value as "Completed" | "Pending" })}>
                      <option>Completed</option>
                      <option>Pending</option>
                    </Select>
                  ) : (
                    <Badge tone={p.status === "Completed" ? "ok" : "warn"}>{p.status}</Badge>
                  )}
                </Td>
                <Td>
                  <Select className="h-8 w-44" value={p.surgeon ?? ""} disabled={!write} aria-label="Surgeon" onChange={(ev) => patch(i, { surgeon: ev.target.value || undefined })}>
                    <option value="">None</option>
                    {DOCTORS.map((d) => <option key={d.id} value={d.id}>Dr. {d.given} {d.family}</option>)}
                  </Select>
                </Td>
                <Td className="text-right">
                  {write && (
                    <button
                      onClick={() => updateEncounter(enc.visitNumber, (e) => { e.pr = e.pr.filter((_, j) => j !== i); })}
                      aria-label={`Remove ${p.code}`} title="Remove" className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
