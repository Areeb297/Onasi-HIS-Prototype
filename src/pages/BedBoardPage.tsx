import { Ban, BedDouble, CalendarClock, CircleCheck, DoorOpen, Sparkles, UserRound } from "lucide-react";
import { useVisitActions } from "@/components/VisitActions";
import { Badge, Button, Card, CardHeader, PageHeader, cn } from "@/components/ui/primitives";
import { markBedReady, returnBedToService } from "@/lib/actions";
import { BED_STATES, bedCounts, bedInfos, type BedInfo, type BedState } from "@/lib/beds";
import { departureGap, gapText, niceDate } from "@/lib/discharge";
import { WARDS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { can, hasGlass, useSession } from "@/lib/session";
import { nowLocal, patientName, useHis } from "@/lib/store";

const WARD_BAR: Record<string, string> = { "3A": "border-t-move", "4B": "border-t-update", ICU: "border-t-cancel" };

/** Each state has its own words and icon as well as a colour, so the board reads without colour. */
const STATE_STYLE: Record<BedState, { box: string; tone: "admit" | "move" | "update" | "warn" | "merge" | "neutral"; icon: typeof BedDouble }> = {
  free: { box: "border-dashed border-admit/40 bg-admit/5", tone: "admit", icon: CircleCheck },
  occupied: { box: "border-move/50 bg-move/10", tone: "move", icon: UserRound },
  reserved: { box: "border-update/50 bg-update/10", tone: "update", icon: CalendarClock },
  discharging: { box: "border-warn/50 bg-warn/10", tone: "warn", icon: DoorOpen },
  cleaning: { box: "border-merge/50 bg-merge/10", tone: "merge", icon: Sparkles },
  out: { box: "border-border bg-muted", tone: "neutral", icon: Ban },
};

function StateBadge({ state }: { state: BedState }) {
  const s = STATE_STYLE[state];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone}>
      <Icon className="size-3.5" aria-hidden="true" />
      {BED_STATES.find((x) => x.id === state)!.label}
    </Badge>
  );
}

export function BedBoardPage() {
  const state = useHis();
  useSession();
  const { act, openRegister, openLeftWard, openBedService, dialogs } = useVisitActions();
  const infos = bedInfos(state);
  const counts = bedCounts(state);
  const mayAdt = can("adt.send");
  const mayWard = mayAdt || can("emr.write");

  const nameOf = (i: BedInfo): string => {
    const p = i.enc && state.patients.find((x) => x.id === i.enc!.patientId);
    return p?.confidential && !hasGlass(p.id) ? "Confidential patient" : patientName(p);
  };

  return (
    <div>
      <PageHeader
        title="Bed Board"
        subtitle="Every bed in the hospital and its state. Only a free bed can take a patient. After a discharge the bed is held until the patient leaves, then it is cleaned and marked ready."
        right={<Badge tone="admit">{counts.free} of {counts.total} beds free</Badge>}
      />

      <Card className="mb-4 px-4 py-3">
        <h2 className="text-sm font-semibold">Bed States</h2>
        <ul className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Bed states and counts">
          {BED_STATES.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span className="w-8 shrink-0 text-right text-lg font-semibold tabular-nums leading-6">{counts[s.id]}</span>
              <span className="min-w-0">
                <StateBadge state={s.id} />
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        {WARDS.map((w) => {
          const beds = infos.filter((i) => i.bed.ward === w.ward);
          const wc = bedCounts(state, w.ward);
          return (
            <Card key={w.ward} className={`border-t-4 ${WARD_BAR[w.ward]}`}>
              <CardHeader title={w.name} subtitle={`${wc.free} free, ${wc.occupied} occupied, ${wc.total - wc.free - wc.occupied} not ready, of ${wc.total} beds`} />
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
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
                        <StateBadge state={i.state} />
                      </div>

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
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button size="sm" disabled={!mayAdt} onClick={() => act("A02", enc.visitNumber)}>Transfer</Button>
                            <Button size="sm" disabled={!mayAdt} onClick={() => act("A03", enc.visitNumber)}>Discharge</Button>
                            <Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: enc.visitNumber })}>Open Chart</Button>
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
                            <Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: enc.visitNumber })}>Open Chart</Button>
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

                      {i.state === "out" && (
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
      {dialogs}
    </div>
  );
}
