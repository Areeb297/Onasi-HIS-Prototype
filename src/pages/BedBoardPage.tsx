import * as React from "react";
import { Ban, BedDouble, CalendarClock, CircleCheck, DoorOpen, LayoutGrid, Pencil, Plus, RotateCcw, Sparkles, Table2, UserRound } from "lucide-react";
import { BedSetupDialog, canSetUpBeds } from "@/components/beds/BedSetupDialog";
import { GlassPillSwitch, KpiStrip, KpiTile } from "@/components/ui/glass";
import { PatientFlagBadges } from "@/components/PatientBanner";
import { useVisitActions } from "@/components/VisitActions";
import { Badge, Button, Card, CardHeader, Empty, Field, Input, PageHeader, Select, Table, Td, Th, cn } from "@/components/ui/primitives";
import { markBedReady, returnBedToService } from "@/lib/actions";
import { BED_GENDERS, BED_TYPES, GENDER_LABEL, ROOM_TYPES, equipmentOf, isActive, useBedSetup } from "@/lib/bed-setup";
import { BED_STATES, bedInfos, type BedInfo, type BedState } from "@/lib/beds";
import { departureGap, gapText, niceDate } from "@/lib/discharge";
import { WARDS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { nowLocal, patientName, useHis } from "@/lib/store";
import { ActionIcon } from "@/components/ui/action-icons";

const WARD_BAR: Record<string, string> = { "3A": "border-t-move", "4B": "border-t-update", ICU: "border-t-cancel" };

/** Each state has its own words and icon as well as a colour, so the board reads without colour. */
export const STATE_STYLE: Record<BedState, { box: string; tone: "admit" | "move" | "update" | "warn" | "merge" | "neutral"; icon: typeof BedDouble }> = {
  free: { box: "border-dashed border-admit/40 bg-admit/5", tone: "admit", icon: CircleCheck },
  occupied: { box: "border-move/50 bg-move/10", tone: "move", icon: UserRound },
  reserved: { box: "border-update/50 bg-update/10", tone: "update", icon: CalendarClock },
  discharging: { box: "border-warn/50 bg-warn/10", tone: "warn", icon: DoorOpen },
  cleaning: { box: "border-merge/50 bg-merge/10", tone: "merge", icon: Sparkles },
  out: { box: "border-border bg-muted", tone: "neutral", icon: Ban },
};

export function StateBadge({ state }: { state: BedState }) {
  const s = STATE_STYLE[state];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className="size-3.5" aria-hidden="true" />
      {BED_STATES.find((x) => x.id === state)!.label}
    </Badge>
  );
}

/** Small badges for the bed's equipment and gender restriction. */
export function BedFeatures({ info, className }: { info: BedInfo; className?: string }) {
  const b = info.bed;
  const eq = equipmentOf(b);
  if (!eq.length && (!b.gender || b.gender === "Any")) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {b.gender && b.gender !== "Any" && <Badge tone="primary">{GENDER_LABEL[b.gender]}</Badge>}
      {eq.map((e) => <Badge key={e} tone={e === "Isolation" ? "warn" : "neutral"}>{e}</Badge>)}
    </div>
  );
}

const EQUIPMENT = ["Isolation", "Oxygen", "Ventilator", "Monitor"];

interface Filters { ward: string; floor: string; roomType: string; bedType: string; gender: string; equipment: string; active: string; state: string; q: string }
const NO_FILTERS: Filters = { ward: "", floor: "", roomType: "", bedType: "", gender: "", equipment: "", active: "", state: "", q: "" };

export function BedBoardPage() {
  const state = useHis();
  useBedSetup();
  useSession();
  const { act, openRegister, openLeftWard, openBedService, dialogs } = useVisitActions();
  const [view, setView] = React.useState<"cards" | "table">("cards");
  const [flt, setFlt] = React.useState<Filters>(NO_FILTERS);
  const [setup, setSetup] = React.useState<{ bedId?: string; ward?: string } | null>(null);
  const setF = (k: keyof Filters, v: string) => setFlt((x) => ({ ...x, [k]: v }));

  const all = bedInfos(state);
  const mayAdt = can("adt.send");
  const mayWard = mayAdt || can("emr.write");
  const maySetup = canSetUpBeds();

  const nameOf = (i: BedInfo): string => {
    const p = i.enc && state.patients.find((x) => x.id === i.enc!.patientId);
    return p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
  };

  const floors = [...new Set(all.map((i) => i.bed.floor ?? ""))].filter(Boolean).sort();
  const infos = all.filter((i) => {
    const b = i.bed;
    if (flt.ward && b.ward !== flt.ward) return false;
    if (flt.floor && b.floor !== flt.floor) return false;
    if (flt.roomType && b.roomType !== flt.roomType) return false;
    if (flt.bedType && b.bedType !== flt.bedType) return false;
    if (flt.gender && (b.gender ?? "Any") !== flt.gender) return false;
    if (flt.equipment && !equipmentOf(b).includes(flt.equipment)) return false;
    if (flt.active && (isActive(b) ? "Active" : "Inactive") !== flt.active) return false;
    if (flt.state && i.state !== flt.state) return false;
    if (flt.q && !`${b.room}-${b.bed} ${b.room} ${nameOf(i)}`.toLowerCase().includes(flt.q.toLowerCase())) return false;
    return true;
  });
  const count = (s: BedState) => infos.filter((i) => i.state === s).length;
  const free = count("free");
  const filtered = JSON.stringify(flt) !== JSON.stringify(NO_FILTERS);

  return (
    <div>
      <PageHeader
        title="Bed Board"
        subtitle="Every bed in the hospital and its state. Only a free, active bed can take a patient, and a bed with a gender restriction only a patient of that sex. After a discharge the bed is held until the patient leaves, then it is cleaned and marked ready."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="admit">{free} of {infos.length} beds free</Badge>
            <Button onClick={() => navigate("/ward-view")}><LayoutGrid className="size-4" />Ward View</Button>
            <Button variant="primary" disabled={!maySetup} onClick={() => setSetup({ ward: flt.ward || undefined })}><Plus className="size-4" />Add Bed</Button>
          </div>
        }
      />

      <KpiStrip label="Bed states and counts" className="mb-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {BED_STATES.map((s) => {
          const Icon = STATE_STYLE[s.id].icon;
          const on = flt.state === s.id;
          return (
            <KpiTile key={s.id} icon={<Icon strokeWidth={1.75} />} label={s.label} value={count(s.id)} note={on ? "Shown below" : s.hint.replace(/\.$/, "")}
              tone={on ? "ok" : undefined} accent={s.id === "out" && count(s.id) ? "danger" : s.id === "discharging" && count(s.id) ? "warn" : "brand"}
              className={on ? "outline-2 outline-offset-0 outline-[#03C1AC]" : undefined} onClick={() => setF("state", on ? "" : s.id)} />
          );
        })}
      </KpiStrip>

      <Card className="mb-4 px-4 py-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Ward">
            <Select value={flt.ward} onChange={(e) => setF("ward", e.target.value)}>
              <option value="">All</option>
              {WARDS.map((w) => <option key={w.ward} value={w.ward}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Floor">
            <Select value={flt.floor} onChange={(e) => setF("floor", e.target.value)}>
              <option value="">All</option>
              {floors.map((f) => <option key={f} value={f}>Floor {f}</option>)}
            </Select>
          </Field>
          <Field label="Room Type">
            <Select value={flt.roomType} onChange={(e) => setF("roomType", e.target.value)}>
              <option value="">All</option>
              {ROOM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Bed Type">
            <Select value={flt.bedType} onChange={(e) => setF("bedType", e.target.value)}>
              <option value="">All</option>
              {BED_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Gender Restriction">
            <Select value={flt.gender} onChange={(e) => setF("gender", e.target.value)}>
              <option value="">All</option>
              {BED_GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
            </Select>
          </Field>
          <Field label="Equipment">
            <Select value={flt.equipment} onChange={(e) => setF("equipment", e.target.value)}>
              <option value="">Any</option>
              {EQUIPMENT.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </Field>
          <Field label="Active Or Inactive">
            <Select value={flt.active} onChange={(e) => setF("active", e.target.value)}>
              <option value="">All</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
          </Field>
          <Field label="Bed State">
            <Select value={flt.state} onChange={(e) => setF("state", e.target.value)}>
              <option value="">All</option>
              {BED_STATES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Bed Or Patient"><Input value={flt.q} placeholder="Bed number or name" onChange={(e) => setF("q", e.target.value)} /></Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button onClick={() => setFlt(NO_FILTERS)} disabled={!filtered} aria-label="Reset filters"><RotateCcw className="size-4" />Reset</Button>
            <GlassPillSwitch label="View" size="sm" className="ms-auto" options={["Cards", "Table"] as const} value={view === "cards" ? "Cards" : "Table"} onChange={(v) => setView(v === "Cards" ? "cards" : "table")} />
          </div>
        </div>
      </Card>

      {view === "table" ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Bed</Th><Th>Ward</Th><Th>Floor</Th><Th>Room Type</Th><Th>Bed Type</Th><Th>Gender</Th><Th>Equipment</Th><Th>Status</Th><Th>State</Th><Th>Patient</Th><Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {infos.length === 0 && <tr><Td colSpan={11}><Empty>No beds match these filters.</Empty></Td></tr>}
              {infos.map((i) => {
                const b = i.bed;
                return (
                  <tr key={b.id} className="hover:bg-muted/40">
                    <Td className="whitespace-nowrap font-medium">Room {b.room}, Bed {b.bed}</Td>
                    <Td className="whitespace-nowrap">{b.wardName}</Td>
                    <Td>{b.floor}</Td>
                    <Td className="whitespace-nowrap">{b.roomType}</Td>
                    <Td className="whitespace-nowrap">{b.bedType}</Td>
                    <Td className="whitespace-nowrap">{GENDER_LABEL[b.gender ?? "Any"]}</Td>
                    <Td><span className="text-xs">{equipmentOf(b).join(", ") || "None"}</span></Td>
                    <Td><Badge tone={isActive(b) ? "ok" : "neutral"}>{isActive(b) ? "Active" : "Inactive"}</Badge></Td>
                    <Td><StateBadge state={i.state} /></Td>
                    <Td>
                      {i.enc ? (
                        <button type="button" onClick={() => navigate("/chart", { visit: i.enc!.visitNumber })} className="text-sm font-medium text-move hover:underline">
                          {i.state === "reserved" ? `Held for ${nameOf(i)}` : nameOf(i)}
                        </button>
                      ) : <span className="text-muted-foreground">None</span>}
                    </Td>
                    <Td>
                      <Button size="sm" variant="ghost" disabled={!maySetup} onClick={() => setSetup({ bedId: b.id })} aria-label={`Edit bed ${b.room}-${b.bed}`}>
                        <Pencil className="size-3.5" />Edit
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {WARDS.filter((w) => !flt.ward || w.ward === flt.ward).map((w) => {
            const beds = infos.filter((i) => i.bed.ward === w.ward);
            const wc = (s: BedState) => beds.filter((i) => i.state === s).length;
            return (
              <Card key={w.ward} className={`border-t-4 ${WARD_BAR[w.ward] ?? "border-t-border"}`}>
                <CardHeader title={w.name} subtitle={`${wc("free")} free, ${wc("occupied")} occupied, ${beds.length - wc("free") - wc("occupied")} not ready, of ${beds.length} beds${filtered ? " shown" : ""}`} />
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {beds.length === 0 && <p className="text-sm text-muted-foreground">No beds match these filters.</p>}
                  {beds.map((i) => {
                    const b = i.bed;
                    const enc = i.enc;
                    const gap = enc && i.state === "discharging" ? departureGap(enc, nowLocal()) : undefined;
                    return (
                      <div key={b.id} className={cn("rounded-lg border p-3", STATE_STYLE[i.state].box)}>
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <BedDouble className="size-3.5" aria-hidden="true" />
                            Room {b.room}, Bed {b.bed}
                          </span>
                          <span className="flex items-center gap-1">
                            <StateBadge state={i.state} />
                            {maySetup && (
                              <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => setSetup({ bedId: b.id })} aria-label={`Edit bed ${b.room}-${b.bed}`} title="Edit Bed">
                                <Pencil className="size-3.5" />
                              </Button>
                            )}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">Floor {b.floor}, {b.roomType}, {b.bedType}</div>
                        <BedFeatures info={i} className="mt-1.5" />

                        {i.state === "free" && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button size="sm" variant="primary" disabled={!mayAdt} onClick={() => openRegister("A01", { bedId: b.id })}>Admit Here</Button>
                            <Button size="sm" variant="ghost" disabled={!mayAdt} onClick={() => openBedService(b.id)}>Take Out Of Service</Button>
                          </div>
                        )}

                        {i.state === "occupied" && enc && (
                          <>
                            <div className="mt-2 text-sm font-medium">{nameOf(i)}</div>
                            <div className="text-xs text-muted-foreground">Admitted {niceDate(enc.admitAt)}</div>
                            <PatientFlagBadges patient={state.patients.find((x) => x.id === enc.patientId)} className="mt-1.5" />
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" disabled={!mayAdt} onClick={() => act("A02", enc.visitNumber)}>Transfer</Button>
                              <Button size="sm" disabled={!mayAdt} onClick={() => act("A03", enc.visitNumber)}>Discharge</Button>
                              <ActionIcon kind="chart" name={enc.visitNumber} onClick={() => navigate("/chart", { visit: enc.visitNumber })} />
                            </div>
                          </>
                        )}

                        {i.state === "reserved" && enc && (
                          <>
                            <div className="mt-2 text-sm font-medium">Held for {nameOf(i)}</div>
                            <div className="text-xs text-muted-foreground">Expected {niceDate(enc.expectedAdmitAt)}</div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" variant="primary" disabled={!mayAdt} onClick={() => act("A01", enc.visitNumber)}>Admit This Patient</Button>
                            </div>
                          </>
                        )}

                        {i.state === "discharging" && enc && (
                          <>
                            <div className="mt-2 text-sm font-medium">{nameOf(i)}</div>
                            <div className="text-xs text-muted-foreground">
                              Discharged {niceDate(enc.discharge?.orderedAt)}. Waiting to leave{gap ? `: ${gapText(gap.minutes)}` : ""}.
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" variant="primary" disabled={!mayWard} onClick={() => openLeftWard(enc.visitNumber)}>Patient Left The Ward</Button>
                              <ActionIcon kind="chart" name={enc.visitNumber} onClick={() => navigate("/chart", { visit: enc.visitNumber })} />
                            </div>
                          </>
                        )}

                        {i.state === "cleaning" && (
                          <>
                            <div className="mt-2 text-xs text-muted-foreground">The patient left {niceDate(i.since)}. Not ready yet.</div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" variant="primary" disabled={!mayWard} onClick={() => markBedReady(b.id)}>Mark Bed Ready</Button>
                              <Button size="sm" variant="ghost" disabled={!mayAdt} onClick={() => openBedService(b.id)}>Take Out Of Service</Button>
                            </div>
                          </>
                        )}

                        {i.state === "out" && i.inactive && (
                          <>
                            <div className="mt-2 text-sm font-medium">Inactive in Bed Setup</div>
                            <div className="text-xs text-muted-foreground">The bed is not offered for admissions or transfers.</div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" disabled={!maySetup} onClick={() => setSetup({ bedId: b.id })}>Edit Bed</Button>
                            </div>
                          </>
                        )}

                        {i.state === "out" && !i.inactive && (
                          <>
                            <div className="mt-2 text-sm font-medium">Reason: {i.reason || "Not recorded"}</div>
                            <div className="text-xs text-muted-foreground">Since {niceDate(i.since)}</div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <Button size="sm" disabled={!mayAdt} onClick={() => returnBedToService(b.id)}>Return To Service</Button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {setup && <BedSetupDialog key={setup.bedId ?? "new"} bedId={setup.bedId} ward={setup.ward} onClose={() => setSetup(null)} />}
      {dialogs}
    </div>
  );
}
