import * as React from "react";
import { X } from "lucide-react";
import { AiChartBrief } from "@/components/ai/AiChartBrief";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { Button } from "@/components/ui/primitives";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import type { Encounter, Patient } from "@/lib/model";
import { can } from "@/lib/session";

/** Charts whose summary already opened by itself in this session. It opens once per chart, then only on request. */
const shown = new Set<string>();

/**
 * The patient summary window. It opens over the chart the first time a chart is opened, and Onasi AI writes
 * the summary inside it while the clinician watches. The button reopens it at any time.
 */
export function AiBriefModal({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!can("ai.use") || shown.has(enc.visitNumber)) return;
    shown.add(enc.visitNumber);
    setOpen(true);
  }, [enc.visitNumber]);

  if (!can("ai.use")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title={`Patient summary by ${ASSISTANT_NAME}`}>
        <OnasiAiMark size={16} /> Patient Summary
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] gap-0 overflow-y-auto rounded-xl border-0 bg-transparent p-0 shadow-2xl sm:max-w-3xl">
          <DialogTitle className="sr-only">Patient summary by {ASSISTANT_NAME}</DialogTitle>
          <DialogDescription className="sr-only">A short summary of this chart, written by the assistant. A clinician must review it.</DialogDescription>
          <div className="relative">
            <AiChartBrief enc={enc} patient={patient} onGo={() => setOpen(false)} inModal />
            <DialogClose className="absolute right-3 top-2 rounded-md p-1.5 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white" aria-label="Close the summary">
              <X className="size-4" />
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
