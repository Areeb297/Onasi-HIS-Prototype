import * as React from "react";
import { X } from "lucide-react";
import { AiChartBrief } from "@/components/ai/AiChartBrief";
import { OnasiAiMark } from "@/components/ai/OnasiAiMark";
import { Button } from "@/components/ui/primitives";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ASSISTANT_NAME } from "@/lib/ai/brand";
import type { Encounter, Patient } from "@/lib/model";
import { can } from "@/lib/session";

/**
 * The patient summary window. It never opens by itself: the clinician opens it with the Patient Summary button,
 * and Onasi AI writes the summary inside it while the clinician watches.
 */
export function AiBriefModal({ enc, patient }: { enc: Encounter; patient: Patient }) {
  const [open, setOpen] = React.useState(false);

  // A different chart starts with the window closed.
  React.useEffect(() => setOpen(false), [enc.visitNumber]);

  if (!can("ai.use")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} title={`Patient summary by ${ASSISTANT_NAME}`}>
        <OnasiAiMark size={16} /> Patient Summary
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] gap-0 overflow-y-auto rounded-2xl border-0 bg-transparent p-0 shadow-2xl sm:max-w-2xl">
          <DialogTitle className="sr-only">Patient summary by {ASSISTANT_NAME}</DialogTitle>
          <DialogDescription className="sr-only">A short summary of this chart, written by the assistant. A clinician must review it.</DialogDescription>
          <div className="relative">
            <AiChartBrief enc={enc} patient={patient} onGo={() => setOpen(false)} inModal />
            <DialogClose className="absolute right-3 top-2.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label="Close the summary">
              <X className="size-4" />
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
