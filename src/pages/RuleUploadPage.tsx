import * as React from "react";
import { ArrowLeft, Download, FileSpreadsheet, RotateCcw, Save, Search } from "lucide-react";
import { SeverityChip } from "@/components/claims/RuleParts";
import { downloadText } from "@/components/ui/code-block";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { readTable } from "@/lib/rcm-import";
import { navigate } from "@/lib/router";
import { conditionText, readRuleRows, sampleRulesCsv, saveUploadedRules, UPLOAD_COLUMNS, useRules, type UploadRow, type UploadStatus } from "@/lib/rule-engine";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

const STATUS_TONE: Record<UploadStatus, "ok" | "warn" | "info" | "danger"> = { Ready: "ok", "Needs Review": "warn", "Existing Rule": "info", Invalid: "danger" };

/** Upload And Review NPHIES Rules: read the NPHIES workbook, review each rule, save the chosen ones. HIS rcm/rule-engine/upload. */
export function RuleUploadPage() {
  const { fields, rules } = useRules();
  useSession();
  const allowed = can("billing");
  const [file, setFile] = React.useState("");
  const [rows, setRows] = React.useState<UploadRow[] | null>(null);
  const [error, setError] = React.useState("");
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"" | UploadStatus>("");
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const read = async (f: File) => {
    setBusy(true); setError(""); setRows(null);
    try {
      const t = await readTable(f);
      const { rows: out, missing } = readRuleRows([t.headers, ...t.rows], fields, rules);
      if (missing.length) { setError(`The file has no header row with ${missing.join(", ")}.`); return; }
      if (!out.length) { setError("The file has the headers but no rule rows."); return; }
      setFile(f.name); setRows(out);
      setPicked(new Set(out.filter((r) => r.status !== "Invalid").map((r) => r.index)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally { setBusy(false); }
  };
  const term = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => (!status || r.status === status) && (!term || `${r.rule.id} ${r.rule.category} ${r.rule.relatedElement} ${r.rule.description}`.toLowerCase().includes(term)));
  const count = (s: UploadStatus) => (rows ?? []).filter((r) => r.status === s).length;
  const choosable = shown.filter((r) => r.status !== "Invalid");
  const allPicked = choosable.length > 0 && choosable.every((r) => picked.has(r.index));
  const toggle = (i: number) => setPicked((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const save = () => {
    const chosen = (rows ?? []).filter((r) => picked.has(r.index));
    const r = saveUploadedRules(chosen);
    if (!r.ok) { pushToast({ tone: "warn", text: r.problems[0] }); return; }
    pushToast({ tone: "ok", text: `${r.saved} NPHIES rule${r.saved === 1 ? "" : "s"} saved.`, detail: "Rules without a condition are saved switched off." });
    navigate("/rule-engine");
  };

  return (
    <div>
      <PageHeader
        title="Upload And Review NPHIES Rules"
        subtitle="Upload the NPHIES rules workbook, check how each rule maps to a claim field, then save the rules you want the review to run."
        right={<Button onClick={() => navigate("/rule-engine")}><ArrowLeft className="size-4" /> Back To Rules</Button>}
      />

      {!rows && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card>
            <label
              className={cn("m-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#03c1ac]/50 bg-[#39edd5]/[0.06] px-6 py-12 text-center transition-colors hover:bg-[#39edd5]/10",
                "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void read(f); }}
            >
              <span className="glass-icon flex size-12 items-center justify-center rounded-2xl"><FileSpreadsheet className="size-6" /></span>
              <span className="text-sm font-semibold">{busy ? "Reading the workbook..." : "Choose the NPHIES rules file, or drop it here"}</span>
              <span className="text-xs text-muted-foreground">Excel workbook (.xlsx) or CSV. The first sheet is read.</span>
              <input ref={input} type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} />
            </label>
            {error && <p role="alert" className="mx-4 mb-4 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-sm text-destructive">{error}</p>}
          </Card>
          <Card>
            <CardHeader title="Required Format" subtitle="The rules sheet is found by its headers; its position and name do not matter." right={<Button size="sm" onClick={() => downloadText("nphies-rules-sample.csv", sampleRulesCsv())}><Download className="size-4" /> Sample File</Button>} />
            <div className="flex flex-col gap-3 p-4 text-sm">
              <div>
                <p className="mb-1.5 font-medium">Required columns</p>
                <div className="flex flex-wrap gap-1.5">{UPLOAD_COLUMNS.required.map((c) => <Badge key={c} tone="primary">{c}</Badge>)}</div>
              </div>
              <div>
                <p className="mb-1.5 font-medium">Optional columns</p>
                <div className="flex flex-wrap gap-1.5">{UPLOAD_COLUMNS.optional.map((c) => <Badge key={c}>{c}</Badge>)}</div>
                <p className="mt-1.5 text-xs text-muted-foreground">Field names a mapped field (Field Mapping) by name or NPHIES path; Operator is one of Is Empty, Equals, Greater Than and so on. Other columns are ignored.</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {rows && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet className="size-4 text-[#035d53] dark:text-[#39edd5]" /> {file}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{rows.length} rules: {count("Ready")} ready, {count("Existing Rule")} update existing rules, {count("Needs Review")} need review, {count("Invalid")} invalid.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setRows(null); setFile(""); }}><RotateCcw className="size-4" /> Upload Again</Button>
              <Button variant="primary" disabled={!allowed || !picked.size} title={allowed ? undefined : "Needs the billing permission"} onClick={save}><Save className="size-4" /> Save Selected ({picked.size})</Button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2.5 border-b border-border px-4 py-3">
            <label className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm">
              <span className="sr-only">Search rules</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search Rule ID, type, element, description" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <Select aria-label="Filter by status" className="w-full sm:w-44" value={status} onChange={(e) => setStatus(e.target.value as "" | UploadStatus)}>
              <option value="">All Statuses</option>
              {(["Ready", "Existing Rule", "Needs Review", "Invalid"] as UploadStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          <Table>
            <thead>
              <tr>
                <Th className="w-10"><input type="checkbox" aria-label="Select every rule shown" checked={allPicked} onChange={() => setPicked((p) => { const n = new Set(p); choosable.forEach((r) => (allPicked ? n.delete(r.index) : n.add(r.index))); return n; })} className="size-4 accent-[#035d53]" /></Th>
                <Th numeric>Row</Th>
                <Th>Status</Th>
                <Th>Rule ID</Th>
                <Th>Rule</Th>
                <Th>Severity</Th>
                <Th>Mapped Condition</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><Td colSpan={7}><Empty>No rules match the search or filter.</Empty></Td></tr>}
              {shown.map((r) => (
                <tr key={r.index} className={cn("align-top", r.status === "Invalid" && "bg-destructive/[0.03]")}>
                  <Td><input type="checkbox" aria-label={`Select rule ${r.rule.id || `row ${r.index}`}`} disabled={r.status === "Invalid"} checked={picked.has(r.index)} onChange={() => toggle(r.index)} className="size-4 accent-[#035d53]" /></Td>
                  <Td numeric className="text-muted-foreground">{r.index}</Td>
                  <Td className="min-w-40"><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge><div className="mt-1 text-xs text-muted-foreground">{r.reason}</div></Td>
                  <Td className="whitespace-nowrap font-mono text-xs font-semibold">{r.rule.id || "None"}</Td>
                  <Td className="min-w-60">
                    <div className="font-medium">{r.rule.name}</div>
                    <div className="text-xs text-muted-foreground">{r.rule.category}{r.rule.relatedElement ? `, ${r.rule.relatedElement}` : ""}</div>
                  </Td>
                  <Td><SeverityChip severity={r.rule.severity} /></Td>
                  <Td className="min-w-48 text-sm">{r.rule.conditions?.length ? r.rule.conditions.map((c) => conditionText(c, fields)).join(", and ") : <span className="text-muted-foreground">Not mapped</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
