import * as React from "react";
import { Activity, AirVent, BedDouble, ShieldAlert, Table2, Wind } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, PageHeader, Select, cn } from "@/components/ui/primitives";
import { KpiStrip, KpiTile } from "@/components/ui/glass";
import { GENDER_LABEL, useBedSetup } from "@/lib/bed-setup";
import { BED_STATES, bedInfos, type BedInfo } from "@/lib/beds";
import type { BedGender } from "@/lib/model";
import { WARDS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { hasGlass, useSession } from "@/lib/session";
import { patientName, useHis } from "@/lib/store";
import { STATE_STYLE, StateBadge } from "@/pages/BedBoardPage";

type GenderTab = "all" | BedGender;
const TABS: { id: GenderTab; label: string }[] = [
  { id: "all", label: "All Beds" },
  { id: "Male", label: GENDER_LABEL.Male },
  { id: "Female", label: GENDER_LABEL.Female },
  { id: "Any", label: "Any Gender" },
];

const DAY = 86_400_000;

/** Whole days since the patient took the bed (from the admission time). */
export function daysInBed(since: string | undefined, now: number = Date.now()): number | undefined {
  if (!since) return undefined;
  const t = new Date(since).getTime();
  return Number.isNaN(t) ? undefined : Math.max(0, Math.floor((now - t) / DAY));
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

interface Room { key: string; room: string; floor: string; roomType: string; beds: BedInfo[] }

function roomsOf(beds: BedInfo[]): Room[] {
  const map = new Map<string, Room>();
  for (const i of beds) {
    const key = `${i.bed.floor ?? ""}|${i.bed.room}`;
    if (!map.has(key)) map.set(key, { key, room: i.bed.room, floor: i.bed.floor ?? "", roomType: i.bed.roomType ?? "", beds: [] });
    map.get(key)!.beds.push(i);
  }
  return [...map.values()].sort((a, b) => natural(a.floor, b.floor) || natural(a.room, b.room));
}

function GenderChip({ beds }: { beds: BedInfo[] }) {
  const set = [...new Set(beds.map((i) => i.bed.gender ?? "Any"))];
  const label = set.length > 1 ? "Mixed" : set[0] === "Any" ? "Any Gender" : GENDER_LABEL[set[0]];
  return <Badge tone={set.length === 1 && set[0] === "Any" ? "neutral" : "primary"}>{label}</Badge>;
}

const EQUIP: { key: "isolation" | "oxygen" | "ventilator" | "monitor"; label: string; icon: typeof Wind }[] = [
  { key: "isolation", label: "Isolation", icon: ShieldAlert },
  { key: "oxygen", label: "Oxygen", icon: Wind },
  { key: "ventilator", label: "Ventilator", icon: AirVent },
  { key: "monitor", label: "Monitor", icon: Activity },
];

/** Ward View: beds by floor and room as a picture of the ward. Click a bed with a patient to open the chart. */
export function WardViewPage() {
  const state = useHis();
  useBedSetup();
  useSession();
  const [tab, setTab] = React.useState<GenderTab>("all");
  const [ward, setWard] = React.useState("");
  const now = Date.now();

  const all = bedInfos(state).filter((i) => !ward || i.bed.ward === ward);
  const byTab = (t: GenderTab) => (t === "all" ? all : all.filter((i) => (i.bed.gender ?? "Any") === t));
  const shown = byTab(tab);

  const patientOf = (i: BedInfo) => (i.enc ? state.patients.find((p) => p.id === i.enc!.patientId) : undefined);
  const nameOf = (i: BedInfo) => {
    const p = patientOf(i);
    return p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
  };

  function tile(i: BedInfo) {
    const b = i.bed;
    const p = patientOf(i);
    const days = i.state === "occupied" ? daysInBed(i.since, now) : undefined;
    const label = `Room ${b.room}, Bed ${b.bed}. ${BED_STATES.find((s) => s.id === i.state)!.label}${p ? `. ${nameOf(i)}` : ""}`;
    const body = (
      <>
        <div className="flex items-center justify-between gap-1">
          <span className="flex items-center gap-1 text-sm font-semibold">
            <BedDouble className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {b.bed}
          </span>
          <span className="flex gap-0.5 text-muted-foreground">
            {EQUIP.filter((e) => b[e.key]).map((e) => (
              <span key={e.key} title={e.label} className={cn("inline-flex", e.key === "isolation" && "text-warn")}>
                <e.icon className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{e.label}</span>
              </span>
            ))}
          </span>
        </div>
        <div className="mt-1.5"><StateBadge state={i.state} /></div>
        {p && (i.state === "occupied" || i.state === "discharging" || i.state === "reserved") && (
          <div className="mt-1.5 min-w-0">
            <div className="truncate text-xs font-medium">{i.state === "reserved" ? `For ${nameOf(i)}` : nameOf(i)}</div>
            <div className="text-xs text-muted-foreground">
              {p.sex === "M" ? "Male" : "Female"}
              {days !== undefined && `, ${days === 0 ? "admitted today" : `${days} ${days === 1 ? "day" : "days"} in bed`}`}
            </div>
          </div>
        )}
        {i.state === "out" && <div className="mt-1.5 truncate text-xs text-muted-foreground">{i.reason || "Out of service"}</div>}
      </>
    );
    const box = cn("block w-full min-w-0 rounded-lg border p-2 text-left", STATE_STYLE[i.state].box);
    return i.enc ? (
      <button key={b.id} type="button" aria-label={`${label}. Open the chart`} onClick={() => navigate("/chart", { visit: i.enc!.visitNumber })} className={cn(box, "transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring")}>
        {body}
      </button>
    ) : (
      <div key={b.id} className={box} aria-label={label} role="group">{body}</div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Ward View"
        subtitle="Beds by floor and room. The colour, the word and the icon on each bed show its state. Click a bed with a patient to open the chart."
        right={<Button onClick={() => navigate("/beds")}><Table2 className="size-4" />Bed Board</Button>}
      />

      <Card className="mb-4 px-4 py-3">
        <div className="flex flex-wrap items-end gap-4">
          <div role="tablist" aria-label="Gender restriction" className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const list = byTab(t.id);
              const free = list.filter((i) => i.state === "free").length;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring",
                    tab === t.id ? "border-[#03C1AC] bg-[#39EDD5]/14" : "border-[color:var(--glass-border)] bg-card hover:bg-muted",
                  )}
                >
                  <span className="block text-sm font-semibold">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{free} free of {list.length}</span>
                </button>
              );
            })}
          </div>
          <Field label="Ward" className="w-full sm:w-56">
            <Select value={ward} onChange={(e) => setWard(e.target.value)}>
              <option value="">All Wards</option>
              {WARDS.map((w) => <option key={w.ward} value={w.ward}>{w.name}</option>)}
            </Select>
          </Field>
        </div>
        <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Equipment icons">
          {EQUIP.map((e) => <li key={e.key} className="flex items-center gap-1"><e.icon className="size-3.5" aria-hidden="true" />{e.label}</li>)}
        </ul>
      </Card>

      <KpiStrip label="Bed states" className="mb-4 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
        {BED_STATES.map((s) => {
          const Icon = STATE_STYLE[s.id].icon;
          const n = shown.filter((i) => i.state === s.id).length;
          return <KpiTile key={s.id} dense icon={<Icon strokeWidth={1.75} />} label={s.label} value={n} accent={s.id === "out" && n ? "danger" : s.id === "discharging" && n ? "warn" : "brand"} />;
        })}
      </KpiStrip>

      {shown.length === 0 && <Card className="p-10 text-center text-sm text-muted-foreground">No beds for this gender restriction.</Card>}

      <div className="space-y-4">
        {WARDS.map((w) => {
          const beds = shown.filter((i) => i.bed.ward === w.ward);
          if (!beds.length) return null;
          const occupied = beds.filter((i) => i.state === "occupied").length;
          const floors = [...new Set(roomsOf(beds).map((r) => r.floor))];
          return (
            <Card key={w.ward}>
              <CardHeader
                title={w.name}
                subtitle={`${beds.filter((i) => i.state === "free").length} free, ${occupied} occupied, of ${beds.length} beds. ${Math.round((occupied / beds.length) * 100)}% occupancy.`}
                right={<GenderChip beds={beds} />}
              />
              <div className="space-y-4 p-4">
                {floors.map((fl) => (
                  <section key={fl} aria-label={`Floor ${fl}`}>
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Floor {fl || "Not set"}</h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      {roomsOf(beds).filter((r) => r.floor === fl).map((r) => (
                        <div key={r.key} className="glass-row rounded-xl p-2.5">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                            <span className="text-sm font-semibold">Room {r.room}</span>
                            <span className="flex items-center gap-1">
                              {r.roomType && <span className="text-xs text-muted-foreground">{r.roomType}</span>}
                              <GenderChip beds={r.beds} />
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[...r.beds].sort((a, b) => natural(a.bed.bed, b.bed.bed)).map(tile)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
