import * as React from "react";
import { FlaskConical, ListTree, Pencil, Plus, RotateCcw, Search, Trash2, Upload } from "lucide-react";
import { IconAlertTriangle, IconHandStop, IconOctagon, IconShieldCheck } from "@tabler/icons-react";
import { BrandChip, FilterField, Pagination, ResponsiveFilters, fmtDate, usePaging, useIsPhone } from "@/components/claims/RcmUi";
import { RuleDialog, ruleCondition, SeverityChip, TestRuleDialog } from "@/components/claims/RuleParts";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { Badge, Button, Card, Empty, Input, PageHeader, Select, Switch, Table, Td, Th, cn } from "@/components/ui/primitives";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CLAIM_TYPE_LABEL } from "@/lib/claims";
import { navigate } from "@/lib/router";
import { brokenFields, deleteRule, setRuleActive, SEVERITY_NAME, TRIGGER_LABEL, useRules, type Rule, type RuleSource, type RuleTrigger, type Severity } from "@/lib/rule-engine";
import { can, useSession } from "@/lib/session";
import { pushToast } from "@/lib/toast";

const TABS = ["Generic Rules", "NPHIES Rules"] as const;
type Tab = (typeof TABS)[number];
interface Filter { q: string; severity: "" | Severity; trigger: "" | RuleTrigger; status: "" | "active" | "inactive" }
const EMPTY: Filter = { q: "", severity: "", trigger: "", status: "" };

/** Rule engine: the rules the claim review runs, and the NPHIES validation rules. HIS rcm/rule-engine. */
export function RuleEnginePage() {
  const { rules, fields } = useRules();
  useSession();
  const phone = useIsPhone();
  const allowed = can("billing");
  const [tab, setTab] = React.useState<Tab>("Generic Rules");
  const [filter, setFilter] = React.useState<Filter>(EMPTY);
  const [editing, setEditing] = React.useState<{ rule?: Rule } | null>(null);
  const [testing, setTesting] = React.useState<Rule | null>(null);
  const source: RuleSource = tab === "Generic Rules" ? "generic" : "nphies";

  const inTab = rules.filter((r) => r.source === source);
  const q = filter.q.trim().toLowerCase();
  const shown = inTab
    .filter((r) => !q || `${r.id} ${r.name} ${r.description} ${r.category} ${r.nphiesCode ?? ""} ${r.relatedElement ?? ""}`.toLowerCase().includes(q))
    .filter((r) => !filter.severity || r.severity === filter.severity)
    .filter((r) => !filter.trigger || r.trigger === filter.trigger)
    .filter((r) => !filter.status || (filter.status === "active") === r.active);
  const paging = usePaging(shown.length, 25);
  const active = Object.values(filter).filter(Boolean).length;
  const set = <K extends keyof Filter>(k: K, v: Filter[K]) => { setFilter((f) => ({ ...f, [k]: v })); paging.setPage(1); };
  const on = rules.filter((r) => r.active);
  const toggle = (r: Rule, v: boolean) => {
    const res = setRuleActive(r.id, v);
    if (!res.ok) pushToast({ tone: "warn", text: res.problems[0] });
  };
  const remove = (r: Rule) => {
    if (!confirm(`Delete rule ${r.id}, ${r.name}?`)) return;
    const res = deleteRule(r.id);
    pushToast(res.ok ? { tone: "ok", text: `Rule ${r.id} deleted.` } : { tone: "warn", text: res.problems[0] });
  };

  const filters = (drawer: boolean) => (
    <div className={cn(drawer ? "flex flex-col gap-3" : "flex flex-wrap items-end gap-2.5 px-4 py-3")}>
      <FilterField label="Search" className={drawer ? undefined : "min-w-56 flex-1"}>
        <span className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Rule ID, name, NPHIES code" value={filter.q} onChange={(e) => set("q", e.target.value)} />
        </span>
      </FilterField>
      <FilterField label="Severity" className={drawer ? undefined : "w-48"}>
        <Select value={filter.severity} onChange={(e) => set("severity", e.target.value as Filter["severity"])}>
          <option value="">All Severities</option>
          {(Object.keys(SEVERITY_NAME) as Severity[]).map((s) => <option key={s} value={s}>{SEVERITY_NAME[s]}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Trigger" className={drawer ? undefined : "w-48"}>
        <Select value={filter.trigger} onChange={(e) => set("trigger", e.target.value as Filter["trigger"])}>
          <option value="">All Triggers</option>
          {(Object.keys(TRIGGER_LABEL) as RuleTrigger[]).map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}
        </Select>
      </FilterField>
      <FilterField label="Status" className={drawer ? undefined : "w-48"}>
        <Select value={filter.status} onChange={(e) => set("status", e.target.value as Filter["status"])}>
          <option value="">Active And Inactive</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </FilterField>
      {!drawer && <Button className="h-9" variant="ghost" disabled={!active} onClick={() => setFilter(EMPTY)} aria-label="Reset filters" title="Reset filters"><RotateCcw className="size-4" /><span className="xl:sr-only">Reset</span></Button>}
    </div>
  );

  const scope = (r: Rule) => (r.claimTypes.length ? r.claimTypes.map((t) => CLAIM_TYPE_LABEL[t]).join(", ") : "All Claim Types");
  const actions = (r: Rule) => (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={() => setTesting(r)} aria-label={`Test rule ${r.id} against a claim`} title="Test against a claim"><FlaskConical className="size-4" /></Button>
      <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => setEditing({ rule: r })} aria-label={`Edit rule ${r.id}`} title={allowed ? "Edit" : "Needs the billing permission"}><Pencil className="size-4" /></Button>
      {!r.check && <Button size="sm" variant="ghost" disabled={!allowed} onClick={() => remove(r)} aria-label={`Delete rule ${r.id}`} title="Delete"><Trash2 className="size-4" /></Button>}
    </div>
  );
  const broken = (r: Rule) => brokenFields(r, fields);

  return (
    <TooltipProvider>
      <PageHeader
        title="Rule Engine"
        subtitle="The checks the claim review runs before prior authorization and the claim go to the payer. Hard Stop blocks sending, Soft Stop needs a reason, Warning is for information."
        right={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate("/field-mapping")}><ListTree className="size-4" /> Field Mapping</Button>
            <Button onClick={() => navigate("/rule-engine/upload")}><Upload className="size-4" /> Upload Rules</Button>
            <Button variant="primary" disabled={!allowed} title={allowed ? undefined : "Needs the billing permission"} onClick={() => setEditing({})}><Plus className="size-4" /> Add Rule</Button>
          </div>
        }
      />

      <KpiStrip label="Rule totals" className="mb-4 grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        <KpiTile dense={phone} icon={<IconShieldCheck stroke={1.75} />} label="Active Rules" value={`${on.length} of ${rules.length}`} note="Run on every review" />
        <KpiTile dense={phone} icon={<IconOctagon stroke={1.75} />} label="Hard Stops" value={on.filter((r) => r.severity === "hard").length} note="Block sending" accent="danger" />
        <KpiTile dense={phone} icon={<IconHandStop stroke={1.75} />} label="Soft Stops" value={on.filter((r) => r.severity === "soft").length} note="Need a reason to send" accent="warn" />
        <KpiTile dense={phone} icon={<IconAlertTriangle stroke={1.75} />} label="Warnings" value={on.filter((r) => r.severity === "warning").length} note="For information" />
      </KpiStrip>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <GlassPillSwitch label="Rule list" value={tab} options={TABS} onChange={(t) => { setTab(t); paging.setPage(1); }} />
        <p className="text-sm text-muted-foreground">{tab === "Generic Rules" ? "Hospital claim scrubbing rules, including the review's built-in checks." : "NPHIES business validation rules, loaded from the NPHIES workbook."}</p>
      </div>

      <Card>
        <div className="border-b border-border px-4 py-3 md:p-0">
          <ResponsiveFilters render={filters} active={active} onReset={() => setFilter(EMPTY)} />
        </div>
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th>Rule ID</Th>
                <Th>Rule</Th>
                <Th>Severity</Th>
                <Th>Scope</Th>
                <Th>Condition</Th>
                <Th>Active</Th>
                <Th>Last Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && <tr><Td colSpan={8}><Empty>{inTab.length ? "No rules match the filters." : tab === "NPHIES Rules" ? "No NPHIES rules yet. Upload the NPHIES workbook to add them." : "No rules yet."}</Empty></Td></tr>}
              {paging.slice(shown).map((r) => (
                <tr key={r.id} className={cn("align-top hover:bg-muted/40", !r.active && "text-muted-foreground")}>
                  <Td className="whitespace-nowrap font-mono text-xs font-semibold">{r.id}</Td>
                  <Td className="min-w-56 max-w-80">
                    <div className="font-medium text-foreground">{r.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge>{r.category}</Badge>
                      {r.check && <BrandChip>Built-In</BrandChip>}
                      {r.nphiesCode && r.source === "generic" && <Badge tone="neutral">{r.nphiesCode}</Badge>}
                    </div>
                    {r.relatedElement && <div className="mt-1 font-mono text-xs text-muted-foreground">{r.relatedElement}</div>}
                  </Td>
                  <Td><SeverityChip severity={r.severity} /></Td>
                  <Td className="min-w-36 text-sm"><div>{TRIGGER_LABEL[r.trigger]}</div><div className="text-xs text-muted-foreground">{scope(r)}</div></Td>
                  <Td className="min-w-52 max-w-72 text-sm">
                    {ruleCondition(r, fields)}
                    {broken(r).length > 0 && <div className="mt-1 text-xs font-medium text-destructive">Uses a field switched off in Field Mapping.</div>}
                  </Td>
                  <Td><Switch checked={r.active} disabled={!allowed} onChange={(v) => toggle(r, v)} label={`${r.active ? "Switch off" : "Switch on"} rule ${r.id}`} /></Td>
                  <Td className="whitespace-nowrap text-sm"><div>{fmtDate(r.updatedAt)}</div><div className="text-xs text-muted-foreground">{r.updatedBy}</div></Td>
                  <Td>{actions(r)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <ul className="flex flex-col gap-2.5 p-3 md:hidden" aria-label="Rules">
          {shown.length === 0 && <li><Empty>No rules match the filters.</Empty></li>}
          {paging.slice(shown).map((r) => (
            <li key={r.id} className={cn("rounded-xl border border-border bg-card p-3", !r.active && "opacity-75")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-semibold">{r.id}</p>
                  <p className="font-medium leading-snug">{r.name}</p>
                </div>
                <Switch checked={r.active} disabled={!allowed} onChange={(v) => toggle(r, v)} label={`${r.active ? "Switch off" : "Switch on"} rule ${r.id}`} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1"><SeverityChip severity={r.severity} /><Badge>{TRIGGER_LABEL[r.trigger]}</Badge>{r.check && <BrandChip>Built-In</BrandChip>}</div>
              <p className="mt-2 text-sm text-muted-foreground">{ruleCondition(r, fields)}</p>
              <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{scope(r)}</span>{actions(r)}</div>
            </li>
          ))}
        </ul>
        <div className="border-t border-border">
          <Pagination total={shown.length} page={paging.page} size={paging.size} onPage={paging.setPage} onSize={paging.setSize} noun="rules" />
        </div>
      </Card>

      <RuleDialog open={!!editing} onClose={() => setEditing(null)} rule={editing?.rule} source={editing?.rule?.source ?? source} fields={fields} />
      <TestRuleDialog rule={testing} fields={fields} onClose={() => setTesting(null)} />
    </TooltipProvider>
  );
}
