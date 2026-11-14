import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { FlagPill } from "@/components/emr/fhir-ui";
import { PatientIdStrip } from "@/components/emr/PatientIdStrip";
import { Button, Field, Input, RequiredNote, Table, Td, Th, cn } from "@/components/ui/primitives";
import { Textarea } from "@/components/ui/textarea";
import { formatResult } from "@/lib/fhir/lab-bundles";
import type { LabOrder } from "@/lib/fhir/types";
import {
  criticalCallProblems, hasCritical, leafTests, previousResult, resultDelta, sendBackLabResult, testByCode, useLab, verifierCheck,
  verifyAndReleaseLabResult,
} from "@/lib/lab";
import type { Patient } from "@/lib/model";
import { useSession } from "@/lib/session";
import { toLocalInput } from "@/lib/store";

const stamp = (iso: string) =>
  `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;

function deltaText(prev: string, cur: string): string {
  const d = resultDelta(prev, cur);
  if (!d) return prev.trim() === cur.trim() ? "No change" : "Changed";
  if (d.diff === 0) return "No change";
  const sign = d.diff > 0 ? "+" : "";
  return `${sign}${d.diff}${d.pct !== null ? ` (${sign}${d.pct}%)` : ""}`;
}

/**
 * The verification sign-off. The verifier sees every value next to the previous result of the same test, then
 * releases the results or sends them back with a reason. A critical value needs the call-back record first.
 */
export function LabVerifyDialog({ order, patient, onClose }: { order: LabOrder; patient: Patient; onClose: () => void }) {
  const lab = useLab();
  const { user } = useSession();
  const [mode, setMode] = React.useState<"review" | "send-back">("review");
  const [backReason, setBackReason] = React.useState("");
  const [override, setOverride] = React.useState("");
  const [toldTo, setToldTo] = React.useState("");
  const [toldBy, setToldBy] = React.useState(user.name);
  const [callAt, setCallAt] = React.useState(() => toLocalInput(new Date()));
  const [readBack, setReadBack] = React.useState(false);

  const who = verifierCheck(order, user);
  const critical = hasCritical(order);
  const call = { toldTo, toldBy, at: callAt ? new Date(callAt).toISOString() : "", readBack };
  const callGaps = critical ? criticalCallProblems({ ...call, at: callAt }) : [];
  const blocked = who.sameUser && !who.mayOverride;
  const needsOverride = who.sameUser && who.mayOverride;
  const ready = !blocked && callGaps.length === 0 && (!needsOverride || override.trim().length > 0);
  const tests = leafTests(order);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Verify Result"
      subtitle={order.codes.map((c) => testByCode(c)?.short ?? c).join(", ")}
      wide
      footer={
        mode === "send-back" ? (
          <>
            <Button onClick={() => setMode("review")}>Back To Review</Button>
            <Button variant="danger" disabled={!backReason.trim()} onClick={() => { if (sendBackLabResult(order.id, backReason)) onClose(); }}>
              Send Back To Entry
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button onClick={() => setMode("send-back")}>Send Back</Button>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                if (verifyAndReleaseLabResult(order.id, { overrideReason: needsOverride ? override : undefined, criticalCall: critical ? call : undefined })) onClose();
              }}
            >
              Verify And Release
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        <PatientIdStrip patient={patient} visitNumber={order.visitNumber} />
        <p className="text-xs text-foreground">
          <span className="font-semibold">Entered by</span> {order.enteredBy?.name ?? "Not recorded"}
          {order.submittedAt && `, ${stamp(order.submittedAt)}`}
          <span className="mx-2 text-muted-foreground">|</span>
          <span className="font-semibold">Verifying as</span> {user.name}
        </p>

        <div className="rounded-lg border border-border">
          <Table>
            <thead>
              <tr>
                <Th>Test</Th>
                <Th>Result</Th>
                <Th>Flag</Th>
                <Th>Previous Result</Th>
                <Th>Change</Th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => {
                const r = order.results[t.code];
                const prev = previousResult(lab.orders, order, t.code);
                const isCrit = r && (r.interp === "HH" || r.interp === "LL") && r.status !== "cancelled";
                return (
                  <tr key={t.code} className={cn(isCrit && "bg-destructive/10")}>
                    <Td className="py-1.5 font-medium">{t.short}</Td>
                    <Td className={cn("py-1.5 tabular-nums", isCrit && "font-semibold text-destructive")}>{r ? formatResult(t, r) : "Empty"}</Td>
                    <Td className="py-1.5">{r ? <FlagPill interp={r.interp} /> : null}</Td>
                    <Td className="py-1.5 text-xs tabular-nums text-foreground">
                      {prev ? (
                        <>
                          {formatResult(t, prev.result)}
                          <span className="block text-muted-foreground">{stamp(prev.result.at)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">No earlier result</span>
                      )}
                    </Td>
                    <Td className="py-1.5 text-xs tabular-nums text-foreground">{prev && r ? deltaText(prev.result.value, r.value) : ""}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>

        {mode === "send-back" ? (
          <Field label="Reason For Sending Back" required hint="The results return to entry. The person who entered them sees this reason.">
            <Textarea value={backReason} aria-required="true" onChange={(e) => setBackReason(e.target.value)} placeholder="For example: potassium looks too high, repeat on a new sample" />
          </Field>
        ) : (
          <>
            {critical && (
              <div className="space-y-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                  <ShieldAlert className="size-4" aria-hidden="true" /> Critical Result Call
                </div>
                <p className="text-xs text-foreground">A critical value must be phoned to the clinical team before release. Record the call here.</p>
                <RequiredNote />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Told To" required>
                    <Input value={toldTo} aria-required="true" onChange={(e) => setToldTo(e.target.value)} placeholder="Doctor or nurse name" />
                  </Field>
                  <Field label="Told By" required>
                    <Input value={toldBy} aria-required="true" onChange={(e) => setToldBy(e.target.value)} />
                  </Field>
                  <Field label="Time Of Call" required>
                    <Input type="datetime-local" value={callAt} aria-required="true" onChange={(e) => setCallAt(e.target.value)} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={readBack} aria-required="true" onChange={(e) => setReadBack(e.target.checked)} />
                  <span>
                    The person read the value back correctly
                    <span aria-hidden="true" className="ms-0.5 font-semibold text-destructive">*</span>
                  </span>
                </label>
              </div>
            )}

            {blocked && (
              <p role="alert" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
                <span className="font-semibold">You entered this result.</span> A different user must verify it. You can still send it back to entry.
              </p>
            )}
            {needsOverride && (
              <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
                <p className="text-sm">
                  <span className="font-semibold">You entered this result.</span> As an administrator you may verify it yourself, with a reason. This is recorded in the audit log.
                </p>
                <Field label="Reason For Verifying Your Own Result" required>
                  <Input value={override} aria-required="true" onChange={(e) => setOverride(e.target.value)} placeholder="For example: only one technologist on night shift" />
                </Field>
              </div>
            )}
            {!ready && !blocked && (
              <p className="text-xs font-medium text-warn" role="status">
                {callGaps.length > 0 ? `Still needed for the call record: ${callGaps.join(", ")}.` : "Give the reason to continue."}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
