import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { IconListDetails } from "@tabler/icons-react";
import { Sar } from "@/components/invoice/InvoiceParts";
import { Badge, Button, Card, Empty, Input, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { addProcedureLine, removeExtraLine, saveLine, type ClaimModel, type ClaimServiceLine, type CodeSystem, type Finding, type LineEdit } from "@/lib/claims";
import { pushToast } from "@/lib/toast";
import { ActionIcon } from "@/components/ui/action-icons";

const KIND_LABEL: Record<ClaimServiceLine["kind"], string> = { visit: "Visit", lab: "Laboratory", rad: "Radiology", rx: "Medication", proc: "Procedure" };
const flash = "transition-shadow data-[flash=true]:ring-2 data-[flash=true]:ring-inset data-[flash=true]:ring-[#03c1ac]";

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

/** Numbered toggles that link a line to diagnoses or care team members. */
function Chips({ options, selected, onToggle, disabled, label }: { options: { id: string; seq: number; title: string }[]; selected: string[]; onToggle: (id: string) => void; disabled?: boolean; label: string }) {
  if (!options.length) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button
            key={o.id} type="button" disabled={disabled} aria-pressed={on} title={o.title} aria-label={`${o.seq}, ${o.title}`} onClick={() => onToggle(o.id)}
            className={cn(
              "h-7 min-w-7 rounded-md border px-1.5 text-xs font-semibold tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              on ? "border-[#035d53] bg-[#035d53] text-white dark:border-[#39edd5] dark:bg-[#39edd5] dark:text-[#032c26]" : "border-border bg-card text-muted-foreground hover:bg-muted",
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
  const remove = (l: ClaimServiceLine) => { const r = removeExtraLine(visit, l.key); if (!r.ok) pushToast({ tone: "warn", text: r.problems[0] }); };

  const codeFields = (l: ClaimServiceLine) => (
    <div className="flex gap-1">
      <Select aria-label={`Code system, line ${l.seq}`} className="w-[5.5rem] shrink-0" value={l.system} disabled={readOnly} onChange={(e) => save(l.key, { system: e.target.value as CodeSystem })}>
        <option value="SBS">SBS</option>
        <option value="ACHI">ACHI</option>
      </Select>
      <CommitInput label={`Service code, line ${l.seq}`} className="font-mono text-xs" value={l.code} disabled={readOnly} onCommit={(v) => save(l.key, { code: v.trim() })} />
    </div>
  );
  const dateFields = (l: ClaimServiceLine, row: boolean) => (
    <div className={cn("flex gap-1", row ? "flex-row" : "flex-col")}>
      <CommitInput type="date" label={`Start date, line ${l.seq}`} value={l.start} disabled={readOnly} onCommit={(v) => save(l.key, { start: v })} />
      <CommitInput type="date" label={`End date, line ${l.seq}`} value={l.end} disabled={readOnly} onCommit={(v) => save(l.key, { end: v })} />
    </div>
  );
  const flags = (l: ClaimServiceLine) => (flagged.get(l.key) ?? []).map((f) => <Badge key={f.id} tone={f.severity === "soft" ? "warn" : "info"}>{f.rule === "line-no-dx" ? "No Diagnosis" : "No Cost"}</Badge>);

  return (
    <Card>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span aria-hidden="true" className="glass-icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg"><IconListDetails className="size-[1.05rem]" stroke={1.75} /></span>
        <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold">Service Lines</h2>
        <p className="mt-0.5 max-w-3xl text-[0.8125rem] text-muted-foreground">
          One line per consultation, test, exam and medicine on the invoice, at the invoice price. Codes are SBS, or ACHI for a procedure. Tick the numbered diagnoses and care team members each line is for.
        </p>
        </div>
      </header>

      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th className="w-8 px-2">#</Th>
              <Th>Service And Code</Th>
              <Th>Dates</Th>
              <Th numeric>Amount</Th>
              <Th>Linked To</Th>
              <Th className="relative w-10"><span className="sr-only">Remove</span></Th>
            </tr>
          </thead>
          <tbody>
            {m.lines.length === 0 && <tr><Td colSpan={6}><Empty>No services on the invoice yet.</Empty></Td></tr>}
            {m.lines.map((l) => {
              const soft = (flagged.get(l.key) ?? []).some((f) => f.severity === "soft");
              return (
                <tr key={l.key} id={`line-${l.key}`} tabIndex={-1} className={cn("align-top focus-visible:outline-none", soft && "bg-warn/[0.05]", flash)}>
                  <Td className="px-2 tabular-nums">{l.seq}</Td>
                  <Td className="min-w-60">
                    <div className="font-medium leading-snug">{l.text}</div>
                    <div className="mt-1 flex flex-wrap gap-1"><Badge>{KIND_LABEL[l.kind]}</Badge>{flags(l)}</div>
                    <div className="mt-2">{codeFields(l)}</div>
                  </Td>
                  <Td className="w-40">{dateFields(l, false)}</Td>
                  <Td numeric className="whitespace-nowrap">
                    <div className="font-semibold"><Sar value={l.net} /></div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{l.quantity} x <Sar value={l.unitCost} /></div>
                    {l.discount > 0 && <div className="text-xs text-muted-foreground">Discount <Sar value={l.discount} /></div>}
                  </Td>
                  <Td>
                    <p className="mb-1 text-xs text-muted-foreground">Diagnoses</p>
                    <Chips label={`Diagnoses for line ${l.seq}`} options={dxOptions} selected={l.dxCodes} disabled={readOnly} onToggle={(id) => toggle(l, "dxCodes", id)} />
                    <p className="mb-1 mt-2 text-xs text-muted-foreground">Care Team</p>
                    <Chips label={`Care team for line ${l.seq}`} options={careOptions} selected={l.careIds} disabled={readOnly} onToggle={(id) => toggle(l, "careIds", id)} />
                  </Td>
                  <Td className="px-2">
                    {l.extra && <Button size="sm" variant="ghost" disabled={readOnly} aria-label={`Remove line ${l.seq}`} title="Remove" onClick={() => remove(l)}><Trash2 className="size-4" /></Button>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Phone: one card per line. */}
      <ol className="flex flex-col gap-2.5 p-3 md:hidden" aria-label="Service lines">
        {m.lines.length === 0 && <li><Empty>No services on the invoice yet.</Empty></li>}
        {m.lines.map((l) => (
          <li key={l.key} id={`line-${l.key}-m`} tabIndex={-1} className={cn("rounded-xl border border-border bg-card p-3 focus-visible:outline-none", flash)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium"><span className="tabular-nums text-muted-foreground">{l.seq}.</span> {l.text}</p>
                <div className="mt-1 flex flex-wrap gap-1"><Badge>{KIND_LABEL[l.kind]}</Badge>{flags(l)}</div>
              </div>
              <div className="text-right">
                <Sar value={l.net} className="text-sm font-semibold" />
                <p className="text-xs text-muted-foreground">{l.quantity} x <Sar value={l.unitCost} /></p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-col gap-2">
              {codeFields(l)}
              {dateFields(l, true)}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="mb-1 text-xs text-muted-foreground">Diagnoses</p><Chips label={`Diagnoses for line ${l.seq}`} options={dxOptions} selected={l.dxCodes} disabled={readOnly} onToggle={(id) => toggle(l, "dxCodes", id)} /></div>
                <div><p className="mb-1 text-xs text-muted-foreground">Care Team</p><Chips label={`Care team for line ${l.seq}`} options={careOptions} selected={l.careIds} disabled={readOnly} onToggle={(id) => toggle(l, "careIds", id)} /></div>
                {l.extra && <ActionIcon kind="delete" label="Remove" name={`line ${l.seq}, ${l.text}`} disabled={readOnly} onClick={() => remove(l)} />}
              </div>
            </div>
          </li>
        ))}
      </ol>

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
