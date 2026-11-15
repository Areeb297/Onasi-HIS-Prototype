import * as React from "react";
import { IconLock, IconTrash, IconX } from "@tabler/icons-react";
import { Field, Input, Select, cn } from "@/components/ui/primitives";
import {
  ACTIONS, ACTION_BY_ID, CONSULT_SPECIALTIES, FIELDS, FOLLOW_UP_CLINICS, HOSPITAL_ROLES, KINDS, OP_LABEL, PEOPLE, PLACEHOLDERS, PORT_LABEL, TRIGGERS,
  TRIGGER_BY_ID, WORKLISTS, nodeTitle, opsFor,
  type ActionKind, type CondOp, type Flow, type FlowNode, type Issue, type NodeSettings, type Port, type RoleId, type TriggerId,
} from "@/lib/automations";
import { KindIcon } from "./node-style";

const area = "min-h-[4.5rem] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted dark:bg-background";

/** Settings of one step, its connections, and what is wrong with it. Every control is a plain form control. */
export function NodeSettingsPanel({ flow, node, trigger, issues, readOnly, onPatch, onConnect, onRemoveEdge, onDelete, onClose }: {
  flow: Flow;
  node: FlowNode;
  trigger?: TriggerId;
  issues: Issue[];
  readOnly?: boolean;
  /** `key` names the field, so typing in one box is one Undo step. */
  onPatch: (patch: { label?: string; settings?: NodeSettings }, key: string) => void;
  onConnect: (port: Port, to: string) => void;
  onRemoveEdge: (id: string) => void;
  onDelete: () => void;
  onClose?: () => void;
}) {
  const s = node.settings;
  const set = (k: keyof NodeSettings, v: NodeSettings[keyof NodeSettings]) => onPatch({ settings: { [k]: v } as NodeSettings }, `${node.id}:${k}`);
  const given = trigger ? TRIGGER_BY_ID[trigger].fields : [];
  const others = flow.nodes.filter((n) => n.id !== node.id && n.kind !== "trigger");
  const outs = flow.edges.filter((e) => e.from === node.id);
  const def = s.action ? ACTION_BY_ID[s.action] : undefined;
  const id = (k: string) => `ns-${node.id}-${k}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-[rgba(20,32,28,0.08)] px-4 py-3">
        <KindIcon kind={node.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{KINDS[node.kind].label}</p>
          <h2 className="truncate text-[0.9375rem] font-semibold text-[#032C26] dark:text-foreground">{nodeTitle(node)}</h2>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close the settings" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-[#032C26]/[0.06] focus-visible:outline-2 focus-visible:outline-ring"><IconX className="size-4" aria-hidden="true" /></button>}
      </header>

      <fieldset disabled={readOnly} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {issues.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-destructive/25 bg-destructive/[0.05] px-3 py-2.5 text-[0.8125rem]" aria-label="Problems with this step">
            {issues.map((i, n) => <li key={n} className={i.level === "error" ? "text-destructive" : "text-warn"}>{i.text}</li>)}
          </ul>
        )}

        {node.kind !== "branch" && node.kind !== "end" && (
          <Field label="Step Name" hint="Optional. Left empty, the step is named from its settings.">
            <Input value={node.label ?? ""} onChange={(e) => onPatch({ label: e.target.value }, `${node.id}:label`)} placeholder={nodeTitle({ ...node, label: "" })} />
          </Field>
        )}

        {node.kind === "trigger" && (
          <>
            <Field label="When This Happens" required>
              <Select value={s.trigger ?? ""} onChange={(e) => set("trigger", (e.target.value || undefined) as TriggerId)}>
                <option value="">Choose an HIS event</option>
                {TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </Field>
            {s.trigger && (
              <div className="rounded-xl bg-[#032C26]/[0.04] px-3 py-2.5 text-[0.8125rem] dark:bg-white/5">
                <p>{TRIGGER_BY_ID[s.trigger].from}</p>
                <p className="mt-1.5 text-muted-foreground">Fields you can check: {TRIGGER_BY_ID[s.trigger].fields.map((f) => FIELDS[f].label).join(", ")}.</p>
              </div>
            )}
          </>
        )}

        {node.kind === "condition" && (
          <>
            <Field label="Field" required>
              <Select value={s.field ?? ""} onChange={(e) => onPatch({ settings: { field: e.target.value || undefined, op: opsFor(FIELDS[e.target.value]?.type ?? "text")[0], value: FIELDS[e.target.value]?.type === "yes-no" ? "yes" : "" } }, `${node.id}:field`)}>
                <option value="">Choose a field</option>
                {given.length > 0 && <optgroup label="Given By The Trigger">{given.map((f) => <option key={f} value={f}>{FIELDS[f].label}</option>)}</optgroup>}
                <optgroup label={given.length ? "Other Fields" : "Fields"}>{Object.values(FIELDS).filter((f) => !given.includes(f.key)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>
              </Select>
            </Field>
            {s.field && FIELDS[s.field] && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rule">
                  <Select value={s.op ?? "is"} onChange={(e) => set("op", e.target.value as CondOp)}>
                    {opsFor(FIELDS[s.field].type).map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                  </Select>
                </Field>
                <Field label={FIELDS[s.field].unit ? `Value (${FIELDS[s.field].unit})` : "Value"} required>
                  {FIELDS[s.field].type === "yes-no" ? (
                    <Select value={s.value ?? "yes"} onChange={(e) => set("value", e.target.value)}><option value="yes">Yes</option><option value="no">No</option></Select>
                  ) : FIELDS[s.field].options ? (
                    <Select value={s.value ?? ""} onChange={(e) => set("value", e.target.value)}>
                      <option value="">Choose</option>
                      {FIELDS[s.field].options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input inputMode={FIELDS[s.field].type === "number" ? "numeric" : undefined} value={s.value ?? ""} onChange={(e) => set("value", e.target.value)} />
                  )}
                </Field>
              </div>
            )}
            {s.field && FIELDS[s.field]?.live && <p className="text-xs text-muted-foreground">This field is read again from the record when the check runs, so a check after a Wait sees the record as it is then.</p>}
          </>
        )}

        {node.kind === "action" && (
          <>
            <Field label="Action" required>
              <Select value={s.action ?? ""} onChange={(e) => set("action", (e.target.value || undefined) as ActionKind)}>
                <option value="">Choose an action</option>
                <optgroup label="Changes No Record">{ACTIONS.filter((a) => !a.changesRecord).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>
                <optgroup label="Changes The Record, After Approval">{ACTIONS.filter((a) => a.changesRecord).map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>
              </Select>
            </Field>
            {def && (
              <p className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-[0.8125rem]", def.changesRecord ? "bg-[#4A554E]/[0.07] text-[#373D39] dark:text-[#C6DACD]" : "bg-[#39EDD5]/12 text-[#035D53] dark:text-[#52FCE3]")}>
                {def.changesRecord && <IconLock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                {def.hint}
              </p>
            )}
            {s.action === "notify" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="To A Role">
                    <Select value={s.role ?? ""} onChange={(e) => onPatch({ settings: { role: (e.target.value || undefined) as RoleId, person: e.target.value ? undefined : s.person } }, `${node.id}:to`)}>
                      <option value="">No role</option>
                      {HOSPITAL_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </Select>
                  </Field>
                  <Field label="Or A Person">
                    <Select value={s.person ?? ""} onChange={(e) => onPatch({ settings: { person: e.target.value || undefined, role: e.target.value ? undefined : s.role } }, `${node.id}:to`)}>
                      <option value="">No person</option>
                      {PEOPLE.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Field>
                </div>
              </>
            )}
            {(s.action === "reminder" || s.action === "create-task") && (
              <Field label={s.action === "create-task" ? "For The Role (Optional)" : "To The Role"} required={s.action === "reminder"}>
                <Select value={s.role ?? ""} onChange={(e) => set("role", (e.target.value || undefined) as RoleId)}>
                  <option value="">{s.action === "create-task" ? "Anyone on the worklist" : "Choose a role"}</option>
                  {HOSPITAL_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </Select>
              </Field>
            )}
            {s.action === "create-task" && (
              <Field label="Worklist" required>
                <Select value={s.worklist ?? ""} onChange={(e) => set("worklist", e.target.value || undefined)}>
                  <option value="">Choose a worklist</option>
                  {WORKLISTS.map((w) => <option key={w} value={w}>{w}</option>)}
                </Select>
              </Field>
            )}
            {s.action === "request-consult" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Specialty" required>
                  <Select value={s.specialty ?? ""} onChange={(e) => set("specialty", e.target.value || undefined)}>
                    <option value="">Choose</option>
                    {CONSULT_SPECIALTIES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                </Field>
                <Field label="Urgency" required>
                  <Select value={s.urgency ?? ""} onChange={(e) => set("urgency", (e.target.value || undefined) as NodeSettings["urgency"])}>
                    <option value="">Choose</option>
                    <option value="routine">Routine</option><option value="urgent">Urgent</option><option value="emergency">Emergency</option>
                  </Select>
                </Field>
              </div>
            )}
            {s.action === "request-follow-up" && (
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label="Clinic" required>
                  <Select value={s.clinic ?? ""} onChange={(e) => set("clinic", e.target.value || undefined)}>
                    <option value="">Choose</option>
                    {FOLLOW_UP_CLINICS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                </Field>
                <Field label="In Days" required>
                  <Input type="number" min={1} max={365} value={s.days ?? ""} onChange={(e) => set("days", e.target.value ? Number(e.target.value) : undefined)} />
                </Field>
              </div>
            )}
            {s.action && s.action !== "start-clearances" && s.action !== "ask-prior-auth" && (
              <Field
                label={s.action === "request-consult" ? "Clinical Question" : s.action === "request-follow-up" ? "Instructions For The Patient" : s.action === "audit-note" ? "Note" : s.action === "claim-review" ? "Reason" : "Message"}
                required={ACTION_BY_ID[s.action].needs.includes("message")}
                hint={`You can use ${PLACEHOLDERS.slice(0, 6).map((p) => `{${p}}`).join(" ")} and other field names in braces.`}
              >
                <textarea id={id("msg")} className={area} value={s.message ?? ""} onChange={(e) => set("message", e.target.value)} />
              </Field>
            )}
          </>
        )}

        {node.kind === "wait" && <WaitFields key={node.id} minutes={s.minutes} onChange={(m) => set("minutes", m)} />}

        {node.kind === "approval" && (
          <>
            <Field label="Who Approves" required>
              <Select value={s.role ?? ""} onChange={(e) => set("role", (e.target.value || undefined) as RoleId)}>
                <option value="">Choose a role</option>
                {HOSPITAL_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            <Field label="What They Check" hint="Shown to the approver.">
              <textarea className={area} value={s.note ?? ""} onChange={(e) => set("note", e.target.value)} />
            </Field>
            <p className="rounded-xl bg-[#4A554E]/[0.07] px-3 py-2 text-[0.8125rem] text-[#373D39] dark:text-[#C6DACD]">Nothing after this step runs until the role approves. Actions that change a record need this step before them.</p>
          </>
        )}

        {node.kind === "branch" && <p className="text-[0.8125rem] text-muted-foreground">Every path that leaves a Branch runs, each on its own. Use it to do two things at once, such as alerting the doctor and the charge nurse.</p>}

        {node.kind === "end" && (
          <Field label="Note" hint="Optional. Why the flow ends here.">
            <Input value={s.note ?? ""} onChange={(e) => set("note", e.target.value)} />
          </Field>
        )}

        {KINDS[node.kind].ports.length > 0 && (
          <section aria-label="Connections" className="space-y-3 border-t border-[rgba(20,32,28,0.08)] pt-4">
            <h3 className="text-sm font-semibold">Connections</h3>
            {node.kind === "branch" ? (
              <>
                <ul className="space-y-1.5">
                  {outs.map((e) => {
                    const to = flow.nodes.find((n) => n.id === e.to);
                    return (
                      <li key={e.id} className="flex items-center gap-2 rounded-lg border border-[rgba(20,32,28,0.08)] px-2.5 py-1.5 text-[0.8125rem]">
                        <span className="min-w-0 flex-1 truncate">{to ? nodeTitle(to) : "Missing step"}</span>
                        <button type="button" onClick={() => onRemoveEdge(e.id)} className="rounded-md px-1.5 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring">Remove</button>
                      </li>
                    );
                  })}
                </ul>
                <Field label="Add A Path To">
                  <Select value="" onChange={(e) => e.target.value && onConnect("out", e.target.value)}>
                    <option value="">Choose a step</option>
                    {others.filter((n) => !outs.some((e) => e.to === n.id)).map((n) => <option key={n.id} value={n.id}>{KINDS[n.kind].label}: {nodeTitle(n)}</option>)}
                  </Select>
                </Field>
              </>
            ) : (
              KINDS[node.kind].ports.map((port) => {
                const e = outs.find((x) => x.port === port);
                return (
                  <Field key={port} label={port === "out" ? "Next Step" : `${PORT_LABEL[port]} Goes To`}>
                    <Select value={e?.to ?? ""} onChange={(ev) => (ev.target.value ? onConnect(port, ev.target.value) : e && onRemoveEdge(e.id))}>
                      <option value="">Not connected</option>
                      {others.map((n) => <option key={n.id} value={n.id}>{KINDS[n.kind].label}: {nodeTitle(n)}</option>)}
                    </Select>
                  </Field>
                );
              })
            )}
          </section>
        )}
      </fieldset>

      {!readOnly && (
        <footer className="border-t border-[rgba(20,32,28,0.08)] px-4 py-3">
          <button type="button" onClick={onDelete} className="inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/[0.06] focus-visible:outline-2 focus-visible:outline-ring">
            <IconTrash className="size-4" aria-hidden="true" />Delete Step
          </button>
        </footer>
      )}
    </div>
  );
}

const UNITS = [["minutes", 1], ["hours", 60], ["days", 1440]] as const;

function WaitFields({ minutes, onChange }: { minutes?: number; onChange: (m: number | undefined) => void }) {
  const fit = [...UNITS].reverse().find(([, f]) => minutes && minutes % f === 0) ?? UNITS[0];
  const [unit, setUnit] = React.useState<number>(fit[1]);
  const amount = minutes ? minutes / unit : "";
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Wait For" required>
        <Input type="number" min={1} value={amount} onChange={(e) => onChange(e.target.value ? Math.round(Number(e.target.value) * unit) : undefined)} />
      </Field>
      <Field label="Unit">
        <Select value={unit} onChange={(e) => { const f = Number(e.target.value); setUnit(f); if (minutes) onChange(Math.round((minutes / unit) * f)); }}>
          {UNITS.map(([l, f]) => <option key={l} value={f}>{l[0].toUpperCase() + l.slice(1)}</option>)}
        </Select>
      </Field>
    </div>
  );
}
