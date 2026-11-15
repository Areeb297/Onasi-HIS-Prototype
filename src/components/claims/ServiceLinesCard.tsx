import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Card, CardHeader, Empty, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { addProcedureLine, removeExtraLine, saveLine, type ClaimModel, type ClaimServiceLine, type CodeSystem, type Finding, type LineEdit } from "@/lib/claims";
import { pushToast } from "@/lib/toast";

const KIND_LABEL: Record<ClaimServiceLine["kind"], string> = { visit: "Visit", lab: "Laboratory", rad: "Radiology", rx: "Medication", proc: "Procedure" };

/** A text field that saves when it loses focus or on Enter, so a half-typed code is never saved. */
export function CommitInput({ value, onCommit, disabled, label, className, type = "text" }: { value: string; onCommit: (v: string) => boolean; disabled?: boolean; label: string; className?: string; type?: string }) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value && !onCommit(text)) setText(value); };
  return (
    <Input
      aria-label={label} type={type} value={text} disabled={disabled} className={className}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
    />
  );
}

function Chips({ options, selected, onToggle, disabled, label }: { options: { id: string; seq: number; title: string }[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean; label: string }) {
  if (!options.length) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id} type="button" disabled={disabled} aria-pressed={on} title={o.title} onClick={() => onToggle(o.id)}
            className={cn(
              "h-7 min-w-7 rounded-md border px-1.5 text-xs font-semibold tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {o.seq}
          </button>
        );
      })}
    </div>
  );
}

export function ServiceLinesCard({ m, findings, readOnly }: { m: ClaimModel; findings: Finding[]; readOnly: boolean }) {
  const [proc, setProc] = React.useState("");
  const visit = m.visit;
  const save = (key: string, patch: LineEdit): boolean => {
    const r = saveLine(visit, key, patch);
    if (!r.ok) pushToast({ tone: "warn", text: r.problems[0] });
    return r.ok;
  };
  const toggle = (l: ClaimServiceLine, field: "dxCodes" | "careIds", id: string) => {
    const cur = l[field];
    save(l.key, { [field]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  const flagged = new Map<string, Finding[]>();
  for (const f of findings) if (f.lineKey) flagged.set(f.lineKey, [...(flagged.get(f.lineKey) ?? []), f]);
  const dxOptions = m.dx.map((d) => ({ id: d.code, seq: d.seq, title: `${d.code} ${d.text}` }));
  const careOptions = m.careTeam.map((c) => ({ id: c.doctorId, seq: c.seq, title: c.name }));
  const procedures = m.enc.pr.filter((p) => p.status !== "Pending");

  const addProc = () => {
    const p = procedures.find((x, i) => `${x.code}:${i}` === proc);
    if (!p) return;
    const r = addProcedureLine(visit, p);
    if (!r.ok) pushToast({ tone: "warn", text: r.problems[0] });
    else { pushToast({ tone: "ok", text: `ACHI ${p.code} added as a service line.`, detail: "It has no price on the invoice, so the review warns about it." }); setProc(""); }
  };

  return (
    <Card>
      <CardHeader
        title="Products And Services"
        subtitle="One line per test, exam and medicine on the invoice, at the invoice price. Tick the diagnoses and care team members each line is for."
      />
      <Table>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Service</Th>
            <Th>Code</Th>
            <Th>Dates</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit Cost</Th>
            <Th className="text-right">Discount</Th>
            <Th className="text-right">Net</Th>
            <Th>Diagnoses</Th>
            <Th>Care Team</Th>
            <Th><span className="sr-only">Remove</span></Th>
          </tr>
        </thead>
        <tbody>
          {m.lines.length === 0 && <tr><Td colSpan={11}><Empty>No services on the invoice yet.</Empty></Td></tr>}
          {m.lines.map((l) => {
            const issues = flagged.get(l.key) ?? [];
            return (
              <tr key={l.key} className={cn("align-top", issues.some((f) => f.severity === "soft") && "bg-warn/5")}>
                <Td className="tabular-nums">{l.seq}</Td>
                <Td className="min-w-48">
                  <div className="font-medium">{l.text}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <Badge>{KIND_LABEL[l.kind]}</Badge>
                    {issues.map((f) => <Badge key={f.id} tone={f.severity === "soft" ? "warn" : "info"}>{f.rule === "line-no-dx" ? "No Diagnosis" : "No Cost"}</Badge>)}
                  </div>
                </Td>
                <Td className="min-w-52">
                  <div className="flex gap-1">
                    <Select aria-label={`Code system, line ${l.seq}`} className="w-24" value={l.system} disabled={readOnly} onChange={(e) => save(l.key, { system: e.target.value as CodeSystem })}>
                      <option value="SBS">SBS</option>
                      <option value="ACHI">ACHI</option>
                    </Select>
                    <CommitInput label={`Service code, line ${l.seq}`} className="font-mono text-xs" value={l.code} disabled={readOnly} onCommit={(v) => save(l.key, { code: v.trim() })} />
                  </div>
                </Td>
                <Td className="min-w-40">
                  <div className="flex flex-col gap-1">
                    <CommitInput type="date" label={`Start date, line ${l.seq}`} value={l.start} disabled={readOnly} onCommit={(v) => save(l.key, { start: v })} />
                    <CommitInput type="date" label={`End date, line ${l.seq}`} value={l.end} disabled={readOnly} onCommit={(v) => save(l.key, { end: v })} />
                  </div>
                </Td>
                <Td className="text-right tabular-nums">{l.quantity}</Td>
                <Td className="text-right"><Sar value={l.unitCost} /></Td>
                <Td className="text-right"><Sar value={l.discount} /></Td>
                <Td className="text-right font-semibold"><Sar value={l.net} /></Td>
                <Td><Chips label={`Diagnoses for line ${l.seq}`} options={dxOptions} selected={l.dxCodes} disabled={readOnly} onToggle={(id) => toggle(l, "dxCodes", id)} /></Td>
                <Td><Chips label={`Care team for line ${l.seq}`} options={careOptions} selected={l.careIds} disabled={readOnly} onToggle={(id) => toggle(l, "careIds", id)} /></Td>
                <Td>
                  {l.extra && (
                    <Button size="sm" variant="ghost" disabled={readOnly} aria-label={`Remove line ${l.seq}`} title="Remove" onClick={() => { const r = removeExtraLine(visit, l.key); if (!r.ok) pushToast({ tone: "warn", text: r.problems[0] }); }}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 sm:max-w-md">
          <span className="text-sm font-medium">Add A Procedure From The Chart</span>
          <Select value={proc} disabled={readOnly || !procedures.length} onChange={(e) => setProc(e.target.value)}>
            <option value="">{procedures.length ? "Choose a procedure" : "No completed procedures in the chart"}</option>
            {procedures.map((p, i) => <option key={`${p.code}:${i}`} value={`${p.code}:${i}`}>ACHI {p.code} {p.text}</option>)}
          </Select>
        </label>
        <Button onClick={addProc} disabled={readOnly || !proc}><Plus className="size-4" /> Add Line</Button>
      </div>
    </Card>
  );
}
