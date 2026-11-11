import * as React from "react";
import { CheckCircle2, CircleAlert, FileCode2, X, AlertTriangle } from "lucide-react";
import { ChecksList } from "@/components/MessagePanel";
import { Dialog } from "@/components/Dialog";
import { CodeBlock } from "@/components/ui/code-block";
import { Button, cn } from "@/components/ui/primitives";
import { useDevMode } from "@/lib/devmode";
import { pretty } from "@/lib/hl7";
import type { LogEntry } from "@/lib/model";
import { dismissToast, useToasts, type Toast } from "@/lib/toast";

function ToastCard({ t, onView }: { t: Toast; onView: (e: LogEntry) => void }) {
  const dev = useDevMode();
  React.useEffect(() => {
    const timer = setTimeout(() => dismissToast(t.id), t.undo ? 12000 : 7000);
    return () => clearTimeout(timer);
  }, [t.id, t.undo]);
  const Icon = t.tone === "ok" ? CheckCircle2 : t.tone === "warn" ? CircleAlert : AlertTriangle;
  return (
    <div
      role="status"
      className={cn(
        "w-[360px] rounded-xl border bg-card p-3 shadow-lg",
        t.tone === "ok" && "border-ok/40",
        t.tone === "warn" && "border-warn/50",
        t.tone === "danger" && "border-destructive/50",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={cn("mt-0.5 size-5 shrink-0", t.tone === "ok" ? "text-ok" : t.tone === "warn" ? "text-warn" : "text-destructive")} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{t.text}</div>
          {dev && t.detail && <div className="mt-0.5 text-xs text-muted-foreground">{t.detail}</div>}
          {dev && t.entry && (t.entry.errors > 0 || t.entry.warnings > 0) && (
            <div className="mt-0.5 text-xs text-destructive">
              {t.entry.errors} errors, {t.entry.warnings} warnings in the message.
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.undo && (
              <Button size="sm" onClick={() => { t.undo!.run(); dismissToast(t.id); }}>
                {t.undo.label}
              </Button>
            )}
            {t.link && (
              <Button size="sm" onClick={() => { t.link!.run(); dismissToast(t.id); }}>
                {t.link.label}
              </Button>
            )}
            {dev && t.entry && (
              <Button size="sm" variant="ghost" onClick={() => onView(t.entry!)}>
                <FileCode2 className="size-3.5" />
                View HL7
              </Button>
            )}
          </div>
        </div>
        <button onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function ToastHost() {
  const toasts = useToasts();
  const [viewing, setViewing] = React.useState<LogEntry | null>(null);
  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <ToastCard key={t.id} t={t} onView={setViewing} />
        ))}
      </div>
      <Dialog open={!!viewing} onClose={() => setViewing(null)} title={viewing ? `${viewing.trigger} message ${viewing.controlId}` : ""} wide>
        {viewing && (
          <div className="space-y-4">
            <CodeBlock filename={`${viewing.trigger}_${viewing.controlId}.hl7`} code={pretty(viewing.message)} />
            <ChecksList checks={viewing.checks} />
          </div>
        )}
      </Dialog>
    </>
  );
}
