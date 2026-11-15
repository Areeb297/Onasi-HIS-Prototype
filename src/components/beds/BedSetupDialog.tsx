import * as React from "react";
import { Dialog } from "@/components/Dialog";
import { Button, Field, Input, RequiredNote, Select, Switch, cn } from "@/components/ui/primitives";
import { audit } from "@/lib/audit";
import {
  BED_GENDERS, BED_TYPES, GENDER_LABEL, MAX_BATCH, ROOM_TYPES, bedSetupProblems, blankInput, inputFromBed, plannedBeds, saveBeds,
  type BedSetupInput,
} from "@/lib/bed-setup";
import type { Bed, BedGender } from "@/lib/model";
import { BED_BY_ID, WARDS } from "@/lib/reference-data";
import { can } from "@/lib/session";
import { useHis } from "@/lib/store";
import { pushToast } from "@/lib/toast";

/** Bed Setup belongs to the admissions office and the administrator. */
export const canSetUpBeds = (): boolean => can("adt.send") || can("admin");

const CAPABILITIES: { key: "isolation" | "oxygen" | "ventilator" | "monitor"; label: string }[] = [
  { key: "isolation", label: "Isolation" },
  { key: "oxygen", label: "Oxygen" },
  { key: "ventilator", label: "Ventilator" },
  { key: "monitor", label: "Monitor" },
];

/**
 * Add Bed or Edit Bed. Adding works for one bed or several at once (prefix, start number, count).
 * Editing keeps the ward, room and bed number, because messages already sent name the bed.
 */
export function BedSetupDialog({ bedId, ward, onClose }: { bedId?: string; ward?: string; onClose: () => void }) {
  const state = useHis();
  const editing: Bed | undefined = bedId ? BED_BY_ID[bedId] : undefined;
  const [f, setF] = React.useState<BedSetupInput>(() => (editing ? inputFromBed(editing) : blankInput(ward)));
  const [tried, setTried] = React.useState(false);
  const set = <K extends keyof BedSetupInput>(k: K, v: BedSetupInput[K]) => setF((x) => ({ ...x, [k]: v }));

  const problems = bedSetupProblems(f, state, bedId);
  const planned = editing ? [] : plannedBeds(f);

  function save() {
    setTried(true);
    if (!canSetUpBeds()) {
      audit("denied", "Bed Setup", { detail: "Changing beds needs the right to send ADT or administrator access." });
      pushToast({ tone: "danger", text: "Your role cannot change the bed setup." });
      return;
    }
    const r = saveBeds(f, state, bedId);
    if (!r.ok) return;
    const ids = r.value.map((b) => b.id).join(", ");
    audit(editing ? "update" : "create", editing ? `Bed ${ids}` : `Beds ${ids}`, {
      detail: `${f.roomType}, ${f.bedType}, floor ${f.floor}, ${GENDER_LABEL[f.gender]}, ${f.active ? "Active" : "Inactive"}`,
    });
    pushToast({
      tone: "ok",
      text: editing ? `Bed ${ids} saved.` : r.value.length === 1 ? `Bed ${ids} added.` : `${r.value.length} beds added.`,
      detail: editing ? undefined : r.value.length > 1 ? ids : "The bed is free for the next patient.",
    });
    onClose();
  }

  const wardName = WARDS.find((w) => w.ward === f.ward)?.name ?? f.ward;

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={editing ? `Edit Bed ${editing.room}-${editing.bed}` : "Add Bed"}
      subtitle={editing ? `${wardName}. The ward, room and bed number stay the same.` : "Add one bed, or several beds in the same room at once."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={tried && problems.length > 0}>
            {editing ? "Save Bed" : planned.length > 1 ? `Add ${planned.length} Beds` : "Add Bed"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <RequiredNote />
        {!editing && (
          <div role="radiogroup" aria-label="How many beds" className="flex w-fit rounded-md border border-border bg-muted p-0.5">
            {(["single", "multiple"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={f.mode === m}
                onClick={() => set("mode", m)}
                className={cn("rounded px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring", f.mode === m ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {m === "single" ? "Single Bed" : "Multiple Beds"}
              </button>
            ))}
          </div>
        )}

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">Location And Classification</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ward" required>
              <Select value={f.ward} disabled={!!editing} onChange={(e) => set("ward", e.target.value)}>
                {WARDS.map((w) => <option key={w.ward} value={w.ward}>{w.name}</option>)}
              </Select>
            </Field>
            <Field label="Room Number" required>
              <Input value={f.room} disabled={!!editing} placeholder="For example 305" onChange={(e) => set("room", e.target.value)} />
            </Field>
            <Field label="Floor" required>
              <Input value={f.floor} onChange={(e) => set("floor", e.target.value)} />
            </Field>
            <Field label="Room Type" required>
              <Select value={f.roomType} onChange={(e) => set("roomType", e.target.value)}>
                <option value="">Choose a room type</option>
                {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">{f.mode === "multiple" && !editing ? "Beds" : "Bed"}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {f.mode === "single" || editing ? (
              <Field label="Bed Number" required>
                <Input value={f.bedNo} disabled={!!editing} placeholder="For example A" onChange={(e) => set("bedNo", e.target.value)} />
              </Field>
            ) : (
              <>
                <Field label="Bed Prefix" required>
                  <Input value={f.prefix} placeholder="For example B" onChange={(e) => set("prefix", e.target.value)} />
                </Field>
                <Field label="Start Number" required>
                  <Input type="number" min={1} value={Number.isFinite(f.start) ? f.start : ""} onChange={(e) => set("start", e.target.valueAsNumber)} />
                </Field>
                <Field label="Number Of Beds" required hint={`Up to ${MAX_BATCH} at once.`}>
                  <Input type="number" min={1} max={MAX_BATCH} value={Number.isFinite(f.count) ? f.count : ""} onChange={(e) => set("count", e.target.valueAsNumber)} />
                </Field>
              </>
            )}
            <Field label="Bed Type" required>
              <Select value={f.bedType} onChange={(e) => set("bedType", e.target.value)}>
                <option value="">Choose a bed type</option>
                {BED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Gender Restriction" hint="Only patients of this sex are offered the bed.">
              <Select value={f.gender} onChange={(e) => set("gender", e.target.value as BedGender)}>
                {BED_GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
              </Select>
            </Field>
          </div>
          {planned.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Beds to add: {planned.slice(0, 6).map((b) => b.id).join(", ")}{planned.length > 6 ? ` and ${planned.length - 6} more` : ""}.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Bed Capabilities</legend>
          <div className="grid gap-2 sm:grid-cols-4">
            {CAPABILITIES.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <Switch checked={f[c.key]} onChange={(v) => set(c.key, v)} label={c.label} />
                {c.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Notes">
            <Input value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Status</legend>
            <label className="flex h-10 items-center gap-2 text-sm">
              <Switch checked={f.active} onChange={(v) => set("active", v)} label="Active" />
              {f.active ? "Active" : "Inactive"}
            </label>
          </fieldset>
        </div>

        {tried && problems.length > 0 && (
          <ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
