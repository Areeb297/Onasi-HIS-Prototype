import * as React from "react";
import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/primitives";
import { createLeaveGate } from "./unsaved";

/**
 * Asks before work is lost. It covers three ways out:
 * - closing a dialog or side sheet: call guard(close) instead of close;
 * - moving to another page of the app (the hash route changes);
 * - closing or reloading the browser tab (the browser asks).
 *
 * Usage:
 *   const { guard, dialog } = useUnsavedChangesGuard(dirty, { onSaveDraft });
 *   <Sheet onOpenChange={(o) => !o && guard(onClose)}> ... {dialog}
 */
export function useUnsavedChangesGuard(
  dirty: boolean,
  opts: { onSaveDraft?: () => void; what?: string } = {},
): { guard: (proceed: () => void) => void; dialog: React.ReactNode; asking: boolean } {
  const [ask, setAsk] = React.useState<null | { proceed: () => void }>(null);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const askingRef = React.useRef(false);
  askingRef.current = !!ask;
  const gate = React.useRef(createLeaveGate()).current;

  // The browser tab: reload, close or typing a new address.
  React.useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // A route change inside the app. The capture listener runs before the router's own listener, so the page is not
  // swapped (and the typing lost) before the user answers. The address is put back while we ask.
  React.useEffect(() => {
    const onHash = (e: HashChangeEvent) => {
      if (!gate.shouldBlock(dirtyRef.current)) return;
      e.stopImmediatePropagation();
      const to = e.newURL;
      window.history.replaceState(window.history.state, "", e.oldURL);
      setAsk({ proceed: () => { gate.allowNext(); window.location.href = to; } });
    };
    window.addEventListener("hashchange", onHash, { capture: true });
    return () => window.removeEventListener("hashchange", onHash, { capture: true });
  }, [gate]);

  const guard = React.useCallback((proceed: () => void) => {
    if (askingRef.current) return; // already asking: a second Escape or click outside does nothing more
    if (!dirtyRef.current) proceed();
    else setAsk({ proceed });
  }, []);

  const stay = () => setAsk(null);
  const dialog = (
    <AlertDialog.Root open={!!ask} onOpenChange={(o) => { if (!o) stay(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[70] bg-black/40" />
        <AlertDialog.Content
          onKeyDown={(e) => { if (e.key === "Escape") e.nativeEvent.stopImmediatePropagation(); }}
          className="fixed top-1/2 left-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-solid)] p-5 text-card-foreground shadow-[inset_0_1px_0_var(--glass-hi),var(--glass-shadow-hover)] focus:outline-none"
        >
          <AlertDialog.Title className="text-base font-semibold">Leave without saving?</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-sm text-muted-foreground">
            {opts.what ?? "You have changes on this form that are not saved."} {opts.onSaveDraft ? "Save them as a draft to finish later, or discard them." : "If you leave now, they are lost."}
          </AlertDialog.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Keep Editing</Button>
            </AlertDialog.Cancel>
            {opts.onSaveDraft && (
              <Button onClick={() => { const p = ask; setAsk(null); opts.onSaveDraft?.(); p?.proceed(); }}>Save As Draft</Button>
            )}
            <AlertDialog.Action asChild>
              <Button variant="danger" onClick={() => { const p = ask; setAsk(null); p?.proceed(); }}>Discard Changes</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
  return { guard, dialog, asking: !!ask };
}

/** The guard for a whole page: asks before the user moves to another page or closes the tab with changes. */
export function UnsavedChangesGuard({ when, what }: { when: boolean; what?: string }) {
  const { dialog } = useUnsavedChangesGuard(when, { what });
  return <>{dialog}</>;
}
