import { BedDouble } from "lucide-react";
import { useVisitActions } from "@/components/VisitActions";
import { Badge, Button, Card, CardHeader, PageHeader, cn } from "@/components/ui/primitives";
import { BEDS, WARDS } from "@/lib/reference-data";
import { navigate } from "@/lib/router";
import { occupiedBeds, patientName, useHis } from "@/lib/store";

const WARD_COLOR: Record<string, { bar: string; occupied: string; badge: "move" | "update" | "cancel" }> = {
  "3A": { bar: "border-t-move", occupied: "border-move/50 bg-move/10", badge: "move" },
  "4B": { bar: "border-t-update", occupied: "border-update/50 bg-update/10", badge: "update" },
  ICU: { bar: "border-t-cancel", occupied: "border-cancel/50 bg-cancel/10", badge: "cancel" },
};

export function BedBoardPage() {
  const state = useHis();
  const { act, openRegister, dialogs } = useVisitActions();
  const occ = occupiedBeds(state);
  const total = BEDS.length;
  const used = Object.keys(occ).length;

  return (
    <div>
      <PageHeader
        title="Bed Board"
        subtitle="Every bed in the hospital. Admit into a free bed, or move and discharge from an occupied one. Each action opens the matching ADT event."
        right={<Badge tone="admit">{used} of {total} beds in use</Badge>}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {WARDS.map((w) => {
          const beds = BEDS.filter((b) => b.ward === w.ward);
          const wardUsed = beds.filter((b) => occ[b.id]).length;
          return (
            <Card key={w.ward} className={`border-t-4 ${WARD_COLOR[w.ward].bar}`}>
              <CardHeader title={w.name} subtitle={`${wardUsed} of ${beds.length} beds in use`} />
              <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {beds.map((b) => {
                  const enc = occ[b.id];
                  const patient = enc && state.patients.find((p) => p.id === enc.patientId);
                  return (
                    <div
                      key={b.id}
                      className={cn(
                        "rounded-lg border p-3",
                        enc ? WARD_COLOR[w.ward].occupied : "border-dashed border-admit/40 bg-admit/5",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                          <BedDouble className="size-3.5" />
                          Room {b.room}, Bed {b.bed}
                        </span>
                        <Badge tone={enc ? WARD_COLOR[w.ward].badge : "admit"}>{enc ? "In Use" : "Free"}</Badge>
                      </div>
                      {enc ? (
                        <>
                          <div className="mt-2 text-sm font-medium">{patientName(patient)}</div>
                          <div className="font-mono text-xs text-muted-foreground">{enc.visitNumber}</div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <Button size="sm" onClick={() => act("A02", enc.visitNumber)}>Transfer</Button>
                            <Button size="sm" onClick={() => act("A03", enc.visitNumber)}>Discharge</Button>
                            <Button size="sm" variant="ghost" onClick={() => navigate("/chart", { visit: enc.visitNumber })}>Open Chart</Button>
                          </div>
                        </>
                      ) : (
                        <div className="mt-3">
                          <Button size="sm" variant="primary" onClick={() => openRegister("A01", { bedId: b.id })}>
                            Admit Here
                          </Button>
                        </div>
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
